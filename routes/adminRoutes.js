const express  = require("express");
const router   = express.Router();
const User     = require("../models/User");
const Withdraw = require("../models/withdraw_model");
const Deposit  = require("../models/deposit_model");
const mongoose = require("mongoose");

// ✅ REFERRAL: new imports
const Referral = require("../models/Referral");
const AuditLog = require("../models/AuditLog");
const { adminOnly } = require("../middleware/authMiddleware");
const { MILESTONES, getMilestoneStatuses } = require("../utils/referralHelper");

// ── ALL DEPOSITS (ADMIN LIST) ──────────────────────────────────────────────
router.get("/all-deposits", async (req, res) => {
  try {
    const deposits = await Deposit.find()
      .populate("user", "username email")
      .sort({ createdAt: -1 });

    const result = deposits.map((d) => ({
      _id:           d._id,
      userId:        d.user?._id?.toString() || "",
      userName:      d.user?.username        || "Unknown",
      email:         d.user?.email           || "Unknown",
      accountNumber: d.userTillId            || "N/A",
      accountName:   d.userTillId            || "N/A",
      method:        d.paymentMethod         || "N/A",
      amount:        d.amount                || 0,
      status:        d.status                || "pending",
      note:          d.note                  || "",
      createdAt:     d.createdAt,
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── APPROVE DEPOSIT ────────────────────────────────────────────────────────
router.put("/deposit/:id/approve", async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id).populate(
      "user", "username email deposit coins"
    );

    if (!deposit) {
      return res.status(404).json({ success: false, message: "Deposit not found" });
    }

    if (deposit.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Deposit already processed",
      });
    }

    deposit.status = "approved";
    await deposit.save();

    const user = await User.findById(deposit.user._id);
    if (user) {
      user.deposit += deposit.amount;
      user.coins   += deposit.amount;
      await user.save();
    }

    // ✅ REFERRAL: qualification hook.
    // findOneAndUpdate with { qualified: false } in the filter makes this
    // atomic and idempotent — if this route is ever hit twice for the same
    // deposit, or another deposit for the same user is approved later,
    // the referral can never be counted/qualified more than once.
    try {
      const qualifiedReferral = await Referral.findOneAndUpdate(
        { referred: deposit.user._id, qualified: false },
        { $set: { qualified: true, qualifiedAt: new Date(), depositId: deposit._id } },
        { new: true }
      );

      if (qualifiedReferral) {
        await AuditLog.create({
          userId: qualifiedReferral.referrer,
          action: "REFERRAL_QUALIFIED",
          targetId: qualifiedReferral._id.toString(),
          targetType: "Referral",
          meta: {
            referredUserId: deposit.user._id.toString(),
            depositId: deposit._id.toString(),
          },
          status: "success",
        });
      }
    } catch (referralError) {
      // ✅ Referral qualification must never block a successful deposit approval.
      console.error("Referral qualification error:", referralError.message);
    }

    res.json({
      success:    true,
      message:    "Deposit approved",
      newBalance: user?.coins || 0,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── REJECT DEPOSIT ─────────────────────────────────────────────────────────
router.put("/deposit/:id/reject", async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id);

    if (!deposit) {
      return res.status(404).json({ success: false, message: "Deposit not found" });
    }

    if (deposit.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Deposit already processed",
      });
    }

    deposit.status = "rejected";
    await deposit.save();

    res.json({ success: true, message: "Deposit rejected" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── USER FINANCIAL STATS ───────────────────────────────────────────────────
router.get("/user-stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const approvedWithdraws = await Withdraw.find({
      userId: userObjectId,
      status: "approved",
    });

    const totalWithdraw = approvedWithdraws.reduce(
      (sum, w) => sum + (w.amount || 0), 0
    );

    res.json({
      totalDeposit:  user.deposit || 0,
      totalWinning:  user.winning || 0,
      totalBonus:    user.bonus   || 0,
      totalWithdraw: totalWithdraw,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── USER DEPOSIT HISTORY ───────────────────────────────────────────────────
router.get("/user-deposits/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const deposits = await Deposit.find({ user: userObjectId })
      .sort({ createdAt: -1 });

    const result = deposits.map((d) => ({
      _id:           d._id,
      userName:      user.username    || "",
      email:         user.email       || "",
      accountNumber: d.userTillId     || "N/A",
      method:        d.paymentMethod  || "N/A",
      amount:        d.amount         || 0,
      status:        d.status         || "pending",
      createdAt:     d.createdAt,
    }));

    return res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── USER WITHDRAW HISTORY ──────────────────────────────────────────────────
router.get("/user-withdrawals/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const withdrawals = await Withdraw.find({ userId: userObjectId })
      .sort({ createdAt: -1 });

    const result = withdrawals.map((w) => ({
      _id:           w._id,
      userName:      w.userName      || "",
      email:         w.email         || "",
      accountNumber: w.accountNumber || "N/A",
      method:        w.method        || "N/A",
      amount:        w.amount        || 0,
      status:        w.status        || "pending",
      createdAt:     w.createdAt,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── UPDATE STATS ───────────────────────────────────────────────────────────
router.post("/update-stats/:userId", async (req, res) => {
  const { userId } = req.params;
  const { totalMatches, matchesWon, totalKills, coinWin } = req.body;

  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.totalMatches = totalMatches ?? user.totalMatches;
    user.matchesWon   = matchesWon   ?? user.matchesWon;
    user.totalKills   = totalKills   ?? user.totalKills;
    user.coinWin      = coinWin      ?? user.coinWin;

    await user.save();
    res.json({ message: "Stats updated successfully", user });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ✅ REFERRAL MANAGEMENT (ADMIN)
// Note: protected with adminOnly. The routes above in this file currently
// have NO auth middleware at all — that's a pre-existing gap, flagged
// separately, not silently changed here.
// ════════════════════════════════════════════════════════════════════════════

// ── REFERRAL STATS OVERVIEW ────────────────────────────────────────────────
router.get("/referral-stats", adminOnly, async (req, res) => {
  try {
    const totalReferralUsers = await Referral.distinct("referrer").then((r) => r.length);
    const totalRegistered = await Referral.countDocuments();
    const totalQualified = await Referral.countDocuments({ qualified: true });

    const rewardLogs = await AuditLog.find({ action: "REFERRAL_REWARD_CLAIMED" });
    const totalRewardsPaid = rewardLogs.reduce((sum, log) => sum + (log.amount || 0), 0);

    res.json({
      success: true,
      data: {
        totalReferralUsers,
        totalRegistered,
        totalQualified,
        totalRewardsPaid,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── ALL REFERRAL USERS (referrers with their aggregate stats) ─────────────
router.get("/referral-users", adminOnly, async (req, res) => {
  try {
    const referrerIds = await Referral.distinct("referrer");
    const users = await User.find({ _id: { $in: referrerIds } })
      .select("username email referralCode referralRewardsClaimed");

    const data = await Promise.all(
      users.map(async (u) => {
        const totalReferrals = await Referral.countDocuments({ referrer: u._id });
        const qualifiedReferrals = await Referral.countDocuments({ referrer: u._id, qualified: true });
        const claimedRewards = (u.referralRewardsClaimed || [])
          .map((c) => MILESTONES.find((m) => m.count === c)?.reward || 0)
          .reduce((a, b) => a + b, 0);

        return {
          userId: u._id,
          username: u.username,
          email: u.email,
          referralCode: u.referralCode,
          totalReferrals,
          qualifiedReferrals,
          claimedRewards,
        };
      })
    );

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── SPECIFIC USER'S REFERRAL DETAIL (full chain) ───────────────────────────
router.get("/referral-user/:userId", adminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const user = await User.findById(userId).select(
      "username email referralCode referralRewardsClaimed"
    );
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const referrals = await Referral.find({ referrer: userId })
      .populate("referred", "username email createdAt");

    const qualifiedCount = referrals.filter((r) => r.qualified).length;
    const milestones = getMilestoneStatuses(user, qualifiedCount);

    const referredUsers = referrals.map((r) => ({
      username: r.referred?.username || "Unknown",
      email: r.referred?.email || "",
      signupDate: r.referred?.createdAt,
      qualified: r.qualified,
      qualifiedAt: r.qualifiedAt,
    }));

    res.json({
      success: true,
      data: {
        username: user.username,
        email: user.email,
        referralCode: user.referralCode,
        qualifiedCount,
        milestones,
        referredUsers,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── REFERRAL REWARD CLAIM HISTORY ──────────────────────────────────────────
router.get("/referral-reward-history", adminOnly, async (req, res) => {
  try {
    const logs = await AuditLog.find({ action: "REFERRAL_REWARD_CLAIMED" })
      .populate("userId", "username email")
      .sort({ createdAt: -1 });

    const data = logs.map((log) => ({
      username: log.userId?.username || "Unknown",
      email: log.userId?.email || "",
      amount: log.amount,
      milestone: log.meta?.milestone || null,
      claimedAt: log.createdAt,
    }));

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;