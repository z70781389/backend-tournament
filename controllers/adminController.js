const User     = require("../models/User");
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");
const JoinTournament   = require("../models/JoinTournament");
const TournamentResult = require("../models/tournamentResult");
const Deposit  = require("../models/deposit_model");
const Withdraw = require("../models/withdraw_model");
const BlockedFreeFireId = require("../models/BlockedFreeFireId");

// 🔍 SEARCH USER — by name, email, mobile, or Free Fire ID
exports.searchUser = async (req, res) => {
  try {
    const { query } = req.body;
    const q = (query || "").toString().trim();

    const searchConditions = [
      { email: { $regex: q, $options: "i" } },
      { username: { $regex: q, $options: "i" } },
      { freefireId: { $regex: q, $options: "i" } },
      { mobile: { $regex: q, $options: "i" } },
    ];

    if (mongoose.Types.ObjectId.isValid(q)) {
      searchConditions.push({ _id: q });
    }

    const users = await User.find({ $or: searchConditions }).limit(20);

    if (!users.length) {
      return res.json([]);
    }

    const result = users.map((user) => ({
      id: user._id,
      name: user.username,
      email: user.email,
      mobile: user.mobile || "",
      freefireId: user.freefireId,
      coins: user.coins,
      isBlocked: user.isBlocked,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 📋 ALL USERS (paginated)
exports.getAllUsers = async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const [users, total] = await Promise.all([
      User.find()
        .select("username email mobile freefireId isBlocked coins createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(),
    ]);

    const data = users.map((u) => ({
      id: u._id,
      name: u.username,
      email: u.email,
      mobile: u.mobile || "",
      freefireId: u.freefireId,
      isBlocked: u.isBlocked,
      coins: u.coins,
      registeredAt: u.createdAt,
    }));

    res.json({ success: true, page, limit, total, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💰 ADD BALANCE
exports.addBalance = async (req, res) => {
  try {
    const { userID, amount } = req.body;

    const user = await User.findById(userID);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const addAmount = Number(amount);
    if (!Number.isFinite(addAmount) || addAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    user.deposit += addAmount;
    user.coins += addAmount;
    await user.save();

    res.json({
      message: "Deposit added successfully",
      coins: user.coins,
      deposit: user.deposit,
      winning: user.winning,
      bonus: user.bonus,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 📄 USER DETAILS — basic info + wallet + deposit/withdraw history + tournament stats + warnings
exports.getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const [deposits, withdrawals, joinedMatches, results] = await Promise.all([
      Deposit.find({ user: userObjectId }).sort({ createdAt: -1 }),
      Withdraw.find({ userId: userObjectId }).sort({ createdAt: -1 }),
      JoinTournament.find({ userID: userId }),
      TournamentResult.find({ "winners.userId": userId }),
    ]);

    const totalWithdraw = withdrawals
      .filter(w => w.status === "approved")
      .reduce((sum, w) => sum + (w.amount || 0), 0);

    const totalDeposit = deposits
      .filter(d => d.status === "approved")
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    let totalWins = 0;
    let totalPrize = 0;
    for (const r of results) {
      const mine = r.winners.filter(w => w.userId.toString() === userId.toString());
      if (mine.length > 0) {
        totalWins += mine.length;
        totalPrize += mine.reduce((s, w) => s + (w.prize || 0), 0);
      }
    }
    const totalPlayed  = joinedMatches.length;
    const totalLosses  = Math.max(totalPlayed - totalWins, 0);

    res.json({
      success: true,
      data: {
        basic: {
          userId: user._id,
          name: user.username,
          email: user.email,
          mobile: user.mobile || "",
          freefireId: user.freefireId,
          isBlocked: user.isBlocked,
          blockReason: user.blockReason,
          blockedAt: user.blockedAt,
          registeredAt: user.createdAt,
        },
        wallet: {
          currentBalance: (user.deposit || 0) + (user.winning || 0) + (user.bonus || 0),
          deposit: user.deposit || 0,
          winning: user.winning || 0,
          bonus: user.bonus || 0,
          totalDeposit,
          totalWithdraw,
          depositHistory: deposits,
          withdrawHistory: withdrawals,
        },
        tournamentStats: {
          totalPlayed,
          totalWins,
          totalLosses,
          totalPrizeEarned: totalPrize,
        },
        warnings: user.warnings || [],
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ⚠️ WARN USER
exports.warnUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim() === "") {
      return res.status(400).json({ success: false, message: "Warning reason is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.warnings.push({
      reason: reason.trim(),
      issuedBy: req.user?._id || null,
      createdAt: new Date(),
    });
    await user.save();

    res.json({ success: true, message: "Warning issued", warnings: user.warnings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🚫 BLOCK USER — also blacklists their current Free Fire ID
exports.blockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim() === "") {
      return res.status(400).json({ success: false, message: "Block reason is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.isBlocked   = true;
    user.blockReason = reason.trim();
    user.blockedAt   = new Date();
    await user.save();

    await BlockedFreeFireId.findOneAndUpdate(
      { freefireId: user.freefireId },
      {
        $set: {
          freefireId: user.freefireId,
          originalUserId: user._id,
          reason: reason.trim(),
          active: true,
        },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "User blocked" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ UNBLOCK USER
exports.unblockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.isBlocked   = false;
    user.blockReason = null;
    user.blockedAt   = null;
    await user.save();

    await BlockedFreeFireId.findOneAndUpdate(
      { freefireId: user.freefireId },
      { $set: { active: false } }
    );

    res.json({ success: true, message: "User unblocked" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};