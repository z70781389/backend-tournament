const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const {
  getMyReferral,
  getReferralStats,
  getReferredUsers,
  claimReward,
} = require("../controllers/referralController");

router.get("/my-referral", protect, getMyReferral);
router.get("/stats", protect, getReferralStats);
router.get("/referred-users", protect, getReferredUsers);
router.post("/claim", protect, claimReward);

module.exports = router;