const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const mongoose = require("mongoose");
const User     = require("../models/User");
const Referral = require("../models/Referral");
const BlockedFreeFireId = require("../models/BlockedFreeFireId");

function generateReferralCode() {
  return Math.random().toString(36).substring(2, 8);
}

// Pakistani mobile number with +92 prefix, e.g. +923001234567
const MOBILE_REGEX = /^\+92[0-9]{10}$/;

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/signup
// ════════════════════════════════════════════════════════════════════════════
exports.signupUser = async (req, res) => {
  console.log("🚀🚀 signupUser CONTROLLER HIT");
  console.log("📦 REQUEST BODY:", req.body);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { username, email, freefireId, password, confirmPassword, referralCode, mobile } = req.body;

    if (!username || !email || !freefireId || !password || !confirmPassword || !mobile) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    if (password !== confirmPassword) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }

    if (password.length < 6) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const trimmedFreefireId = freefireId.toString().trim();
    if (trimmedFreefireId === "") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Free Fire ID is required" });
    }

    const trimmedMobile = mobile.toString().trim();
    if (!MOBILE_REGEX.test(trimmedMobile)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Enter a valid WhatsApp number in the format +923001234567",
      });
    }

    const existingUser = await User.findOne({ email }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    // Explicit backend uniqueness check (in addition to schema's unique index)
    const existingFreefireId = await User.findOne({ freefireId: trimmedFreefireId }).session(session);
    if (existingFreefireId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "This Free Fire ID is already registered with another account. Please enter your own Free Fire ID.",
      });
    }

    // Reject signup if this Free Fire ID was previously blocked for cheating
    const blockedFreefireId = await BlockedFreeFireId.findOne({
      freefireId: trimmedFreefireId,
      active: true,
    }).session(session);
    if (blockedFreefireId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "This Free Fire ID is not allowed to register.",
      });
    }

    let referrer = null;
    if (referralCode && referralCode.trim() !== "") {
      referrer = await User.findOne({ referralCode: referralCode.trim() }).session(session);
      if (!referrer) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Invalid referral code" });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      email,
      freefireId: trimmedFreefireId,
      mobile: trimmedMobile,
      password: hashedPassword,
      coins:    0,
      deposit:  0,
      winning:  0,
      bonus:    0,
      referralCode: generateReferralCode(),
      referredBy: referrer ? referrer.referralCode : null,
    });

    await user.save({ session });

    if (referrer) {
      await Referral.create(
        [{ referrer: referrer._id, referred: user._id, referralCode: referrer.referralCode }],
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    const token = jwt.sign(
      { id: user._id, userName: user.username, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      success: true,
      message: "Signup successful",
      token,
      data: {
        userID:       user._id,
        name:         user.username,
        email:        user.email,
        freefireId:   user.freefireId,
        mobile:       user.mobile,
        coins:        user.coins,
        deposit:      user.deposit,
        winning:      user.winning,
        bonus:        user.bonus,
        referralCode: user.referralCode,
        totalBalance: user.deposit + user.winning + user.bonus,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("signupUser error:", error);
    console.error(error.stack);

    if (error.code === 11000 && error.keyPattern && error.keyPattern.freefireId) {
      return res.status(400).json({
        success: false,
        message: "This Free Fire ID is already registered with another account. Please enter your own Free Fire ID.",
      });
    }

    return res.status(500).json({ success: false, message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/login
// ════════════════════════════════════════════════════════════════════════════
exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ success: false, message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid password" });
    }

    // Blocked account cannot log in
    if (user.isBlocked) {
      const reasonText = user.blockReason ? ` Reason: ${user.blockReason}.` : "";
      return res.status(403).json({
        success: false,
        message: `Your account has been blocked by Admin.${reasonText} Please contact Admin.`,
        blocked: true,
      });
    }

    const token = jwt.sign(
      { id: user._id, userName: user.username, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("✅ SENDING RESPONSE TO FRONTEND");

    return res.json({
      success: true,
      message: "Login successful",
      token,
      data: {
        userID:       user._id,
        name:         user.username,
        email:        user.email,
        freefireId:   user.freefireId,
        mobile:       user.mobile,
        coins:        user.coins,
        deposit:      user.deposit,
        winning:      user.winning,
        bonus:        user.bonus,
        totalBalance: user.deposit + user.winning + user.bonus,
      },
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/save-fcm-token
// ════════════════════════════════════════════════════════════════════════════
exports.saveFcmToken = async (req, res) => {
  try {
    const { userId, fcmToken } = req.body;
    if (!userId || !fcmToken) {
      return res.status(400).json({ success: false, message: "userId and fcmToken required" });
    }
    await User.findByIdAndUpdate(userId, {
      $set:      { fcmToken },
      $addToSet: { fcmTokens: fcmToken },
    });
    res.json({ success: true, message: "FCM token saved" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// PUT /users/update-freefireid   (protected)
// ════════════════════════════════════════════════════════════════════════════
exports.updateFreefireId = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const { freefireId } = req.body;
    const newId = (freefireId || "").toString().trim();

    if (newId === "") {
      return res.status(400).json({ success: false, message: "Free Fire ID is required" });
    }

    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (currentUser.freefireId === newId) {
      return res.json({
        success: true,
        message: "Free Fire ID unchanged",
        data: { freefireId: currentUser.freefireId },
      });
    }

    const owner = await User.findOne({ freefireId: newId });
    if (owner && owner._id.toString() !== userId.toString()) {
      return res.status(400).json({
        success: false,
        message: "This Free Fire ID is already registered with another account. Please enter your own Free Fire ID.",
      });
    }

    const blocked = await BlockedFreeFireId.findOne({ freefireId: newId, active: true });
    if (blocked) {
      return res.status(403).json({
        success: false,
        message: "This Free Fire ID is not allowed to participate in tournaments.",
      });
    }

    currentUser.freefireId = newId;
    await currentUser.save();

    return res.json({
      success: true,
      message: "Free Fire ID updated successfully",
      data: { freefireId: currentUser.freefireId },
    });

  } catch (error) {
    if (error.code === 11000 && error.keyPattern && error.keyPattern.freefireId) {
      return res.status(400).json({
        success: false,
        message: "This Free Fire ID is already registered with another account. Please enter your own Free Fire ID.",
      });
    }
    return res.status(500).json({ success: false, message: "Unable to update Free Fire ID." });
  }
};