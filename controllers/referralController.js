const mongoose = require("mongoose");
const User = require("../models/User");
const Referral = require("../models/Referral");
const Transaction = require("../models/Transaction");
const AuditLog = require("../models/AuditLog");
const {
  buildReferralLink,
  getQualifiedCount,
  getTotalReferredCount,
  getMilestoneStatuses,
  findMilestone,
} = require("../utils/referralHelper");

// ════════════════════════════════════════════════════════════════════════════
// GET /api/v1/referral/my-referral
// ════════════════════════════════════════════════════════════════════════════
exports.getMyReferral = async (req, res) => {
  try {
    const user = req.user; // set by protect middleware

    if (!user.referralCode) {
      return res.status(400).json({
        success: false,
        message: "No referral code found for this account",
      });
    }

    return res.json({
      success: true,
      data: {
        referralCode: user.referralCode,
        referralLink: buildReferralLink(user.referralCode),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// GET /api/v1/referral/stats
// ════════════════════════════════════════════════════════════════════════════
exports.getReferralStats = async (req, res) => {
  try {
    const user = req.user;

    const [qualifiedCount, totalReferred] = await Promise.all([
      getQualifiedCount(user._id),
      getTotalReferredCount(user._id),
    ]);

    const milestones = getMilestoneStatuses(user, qualifiedCount);

    const claimedRewards = milestones
      .filter((m) => m.status === "claimed")
      .reduce((sum, m) => sum + m.reward, 0);

    const availableRewards = milestones
      .filter((m) => m.status === "available")
      .reduce((sum, m) => sum + m.reward, 0);

    return res.json({
      success: true,
      data: {
        referralCode: user.referralCode,
        referralLink: buildReferralLink(user.referralCode),
        totalInvited: totalReferred,
        totalRegistered: totalReferred,
        totalQualified: qualifiedCount,
        claimedRewards,
        availableRewards,
        milestones,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// GET /api/v1/referral/referred-users
// ════════════════════════════════════════════════════════════════════════════
exports.getReferredUsers = async (req, res) => {
  try {
    const referrals = await Referral.find({ referrer: req.user._id })
      .populate("referred", "username email createdAt")
      .sort({ createdAt: -1 });

    const data = referrals.map((r) => ({
      username: r.referred?.username || "Unknown",
      email: r.referred?.email || "",
      signupDate: r.referred?.createdAt || r.createdAt,
      qualified: r.qualified,
      qualifiedAt: r.qualifiedAt,
    }));

    return res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// POST /api/v1/referral/claim
// body: { milestone: 5 | 10 }
// 🚨 Backend-authoritative — client NEVER controls the reward amount.
// ════════════════════════════════════════════════════════════════════════════
exports.claimReward = async (req, res) => {
  const { milestone } = req.body;
  const milestoneCount = Number(milestone);

  const milestoneConfig = findMilestone(milestoneCount);
  if (!milestoneConfig) {
    return res.status(400).json({ success: false, message: "Invalid milestone" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;

    const qualifiedCount = await Referral.countDocuments({
      referrer: userId,
      qualified: true,
    }).session(session);

    if (qualifiedCount < milestoneConfig.count) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Milestone not yet unlocked",
      });
    }

    // Atomic conditional update — prevents double-claim race conditions.
    // Only succeeds if this milestone is NOT already in referralRewardsClaimed.
    const beforeUser = await User.findById(userId).session(session);
    const before = { bonus: beforeUser.bonus };

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, referralRewardsClaimed: { $ne: milestoneConfig.count } },
      {
        $push: { referralRewardsClaimed: milestoneConfig.count },
        $inc: { bonus: milestoneConfig.reward },
      },
      { new: true, session }
    );

    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Reward already claimed",
      });
    }

    const transaction = new Transaction({
      userId,
      amount: milestoneConfig.reward,
      type: "credit",
      source: "bonus",
      description: `Referral milestone reward (${milestoneConfig.count} qualified referrals)`,
      status: "success",
    });
    await transaction.save({ session });

    await AuditLog.create(
      [
        {
          userId,
          action: "REFERRAL_REWARD_CLAIMED",
          amount: milestoneConfig.reward,
          targetId: transaction._id.toString(),
          targetType: "Transaction",
          before,
          after: { bonus: updatedUser.bonus },
          meta: { milestone: milestoneConfig.count },
          ip: req.ip,
          status: "success",
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: "Reward claimed successfully",
      data: {
        rewardCredited: milestoneConfig.reward,
        newBonusBalance: updatedUser.bonus,
        totalBalance:
          (updatedUser.deposit || 0) +
          (updatedUser.winning || 0) +
          (updatedUser.bonus || 0),
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: error.message });
  }
};