const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema(
  {
    // کس نے کیا
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // کیا کیا
    action: {
      type: String,
      required: true,
      enum: [
        "DEPOSIT",
        "WITHDRAW",
        "BALANCE_CHANGE",
        "TOURNAMENT_JOIN",
        "TOURNAMENT_CREATE",
        "TOURNAMENT_UPDATE",
        "TOURNAMENT_DELETE",
        "RESULT_SUBMIT",
        "ADMIN_LOGIN",
        "USER_LOGIN",
        "USER_SIGNUP",
        "PRIZE_DISTRIBUTED",
        "SEAT_BOOKED",
        "ADMIN_ACTION",
        "REFERRAL_QUALIFIED",       // ✅ REFERRAL: new action value
        "REFERRAL_REWARD_CLAIMED",  // ✅ REFERRAL: new action value
      ],
    },

    // کتنا
    amount: { type: Number, default: null },

    // کس چیز پر
    targetId: { type: String, default: null },   // tournamentId, transactionId etc
    targetType: { type: String, default: null }, // "Tournament", "User", etc

    // پہلے کیا تھا / بعد میں کیا ہوا
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after:  { type: mongoose.Schema.Types.Mixed, default: null },

    // extra info
    meta: { type: mongoose.Schema.Types.Mixed, default: null },

    // IP address
    ip: { type: String, default: null },

    status: {
      type: String,
      enum: ["success", "failed", "blocked"],
      default: "success",
    },
  },
  { timestamps: true }
);

// Fast queries by userId and action
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", AuditLogSchema);