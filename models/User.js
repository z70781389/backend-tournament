const mongoose = require("mongoose");

const WarningSchema = new mongoose.Schema({
  reason:     { type: String, required: true },
  issuedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  createdAt:  { type: Date, default: Date.now },
}, { _id: true });

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  // Free Fire ID — unique across all accounts
  freefireId: { type: String, required: true, unique: true, trim: true },

  isAdmin: { type: Boolean, default: false },

  coins: { type: Number, default: 0 },
  deposit: { type: Number, default: 0 },
  winning: { type: Number, default: 0 },
  bonus: { type: Number, default: 0 },

  balance: { type: Number, default: 0 },

  totalMatches: { type: Number, default: 0 },
  matchesWon: { type: Number, default: 0 },
  totalKills: { type: Number, default: 0 },

  coinWin: { type: Number, default: 0 },
  totalWins: { type: Number, default: 0 },
  rank: { type: Number, default: 0 },

  level: { type: Number, default: 1 },
  stars: { type: Number, default: 0 },
  category: { type: String, default: "Bronze" },

  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: String, default: null },

  referralRewardsClaimed: { type: [Number], default: [] },

  userID: { type: String, sparse: true },

  fcmToken: { type: String, default: "" },
  fcmTokens: [{ type: String }],

  // Mobile number — used by Admin panel (not yet collected at signup; see notes)
  mobile: { type: String, default: "" },

  // Block / Warning system
  isBlocked:   { type: Boolean, default: false },
  blockReason: { type: String, default: null },
  blockedAt:   { type: Date, default: null },
  warnings:    { type: [WarningSchema], default: [] },

}, { timestamps: true });

module.exports = mongoose.model("User", UserSchema);