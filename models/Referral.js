const mongoose = require("mongoose");

const ReferralSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // unique: a user can only ever be referred once — prevents duplicate
    // relationships / being referred multiple times at the DB level.
    referred: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    referralCode: {
      type: String,
      required: true,
    },
    qualified: {
      type: Boolean,
      default: false,
    },
    qualifiedAt: {
      type: Date,
      default: null,
    },
    // Links qualification to the specific approved deposit — useful for
    // audit/debugging, and guards against accidental double-processing.
    depositId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deposit",
      default: null,
    },
  },
  { timestamps: true }
);

ReferralSchema.index({ referrer: 1, qualified: 1 });

module.exports = mongoose.model("Referral", ReferralSchema);