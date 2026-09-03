const express    = require("express");
const router     = express.Router();
const rateLimit  = require("express-rate-limit");
const User       = require("../models/User");
const AuditLog   = require("../models/AuditLog");
const { protect, logout } = require("../middleware/authMiddleware");

const {
  loginUser,
  saveFcmToken,
  signupUser,
  updateFreefireId,
} = require("../controllers/userController");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message: {
    success: false,
    message: "Too many attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      5,
  message: {
    success: false,
    message: "Too many login attempts. Account temporarily locked. Try again in 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

const profileLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max:      60,
  message: {
    success: false,
    message: "Too many profile requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

const fcmLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max:      10,
  message: {
    success: false,
    message: "Too many FCM token requests.",
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

const freefireIdLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      5,
  message: {
    success: false,
    message: "Too many Free Fire ID update attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

router.use((req, res, next) => {
  console.log("➡️ USER REQUEST BODY:", req.body);
  console.log("➡️ USER PARAMS:", req.params);
  console.log("➡️ USER QUERY:", req.query);
  next();
});

const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ success: false, message: "Please enter a valid email address" });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
  }

  req.body.email = email.trim().toLowerCase();
  next();
};

const validateFcmToken = (req, res, next) => {
  const { userId, fcmToken } = req.body;

  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    return res.status(400).json({ success: false, message: "userId is required" });
  }

  if (!fcmToken || typeof fcmToken !== "string" || fcmToken.trim().length === 0) {
    return res.status(400).json({ success: false, message: "fcmToken is required" });
  }

  next();
};

const validateUserId = (req, res, next) => {
  const { userId } = req.params;
  const objectIdRegex = /^[a-fA-F0-9]{24}$/;

  if (!objectIdRegex.test(userId)) {
    return res.status(400).json({ success: false, message: "Invalid user ID format" });
  }

  next();
};

router.post("/signup", (req, res, next) => {
  console.log("🔥🔥 SIGNUP ROUTE HIT");
  console.log("🔥 BODY:", req.body);
  next();
}, authLimiter, signupUser);

router.post("/login", loginLimiter, validateLogin, loginUser);

router.post("/logout", protect, logout);

router.post("/fcm-token", protect, fcmLimiter, validateFcmToken, async (req, res, next) => {
  next();
}, saveFcmToken);

router.put("/update-freefireid", protect, freefireIdLimiter, updateFreefireId);

router.get("/:userId", protect, profileLimiter, validateUserId, async (req, res) => {
  const { userId } = req.params;

  if (req.user._id.toString() !== userId) {
    try {
      await AuditLog.create({
        action:      "UNAUTHORIZED_PROFILE_ACCESS",
        performedBy: req.user._id,
        targetUser:  userId,
        ip:          req.ip,
        userAgent:   req.headers["user-agent"] || "",
        timestamp:   new Date(),
      });
    } catch (_) {}

    return res.status(403).json({ success: false, message: "Access denied" });
  }

  try {
    const user = await User.findById(userId).select("-password -fcmTokens");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    try {
      await AuditLog.create({
        action:      "PROFILE_FETCHED",
        performedBy: req.user._id,
        targetUser:  userId,
        ip:          req.ip,
        userAgent:   req.headers["user-agent"] || "",
        timestamp:   new Date(),
      });
    } catch (_) {}

    return res.json({
      success:      true,
      userID:       user._id,
      username:     user.username     || "",
      email:        user.email        || "",
      freefireId:   user.freefireId   || "",
      coins:        user.coins        ?? 0,
      deposit:      user.deposit      ?? 0,
      winning:      user.winning      ?? 0,
      bonus:        user.bonus        ?? 0,
      totalBalance: (user.deposit ?? 0) + (user.winning ?? 0) + (user.bonus ?? 0),
      level:        user.level        ?? 1,
      stars:        user.stars        ?? 0,
      category:     user.category     ?? "Bronze",
      totalMatches: user.totalMatches ?? 0,
      matchesWon:   user.matchesWon   ?? 0,
      totalKills:   user.totalKills   ?? 0,
      coinWin:      user.coinWin      ?? 0,
    });

  } catch (error) {
    console.error("❌ ERROR OCCURRED:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error:   error.message,
    });
  }
});

router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `User route '${req.method} ${req.originalUrl}' not found`,
  });
});

module.exports = router;