const mongoose = require("mongoose");

const BlockedFreeFireIdSchema = new mongoose.Schema({
  freefireId: { type: String, required: true, unique: true, trim: true },

  // Reference only — the block lives on the ID itself, not the account
  originalUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  reason: { type: String, required: true },

  // Allows admin to lift the block without losing audit history
  active: { type: Boolean, default: true },

}, { timestamps: true });

module.exports = mongoose.model("BlockedFreeFireId", BlockedFreeFireIdSchema);