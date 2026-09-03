const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ✅ Blacklisted tokens (logout/session invalidation)
// Production میں Redis use کرو — یہ in-memory fallback ہے
const tokenBlacklist = new Set();

const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    // ✅ Blacklist check (logout / session invalidation)
    if (tokenBlacklist.has(token)) {
      return res.status(401).json({ success: false, message: "Session expired. Please login again." });
    }

    // ✅ Strict expiry verification
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],  // explicit algorithm — prevents alg:none attack
      });
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ success: false, message: "Token expired. Please login again." });
      }
      return res.status(401).json({ success: false, message: "Invalid token." });
    }

    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ success: false, message: "User not found." });
    }

    // ✅ Blocked-account enforcement — checked fresh from DB on every request,
    // so an already-logged-in user is cut off on their very next call after being blocked.
    if (user.isBlocked) {
      const reasonText = user.blockReason ? ` Reason: ${user.blockReason}.` : "";
      return res.status(403).json({
        success: false,
        message: `Your account has been blocked by Admin.${reasonText} Please contact Admin.`,
        blocked: true,
      });
    }

    // ✅ Token issued-at check — agar password change hua to purana token invalid
    if (user.passwordChangedAt) {
      const changedAt = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (decoded.iat < changedAt) {
        return res.status(401).json({ success: false, message: "Password changed. Please login again." });
      }
    }

    req.user = user;
    req.token = token; // logout ke liye
    next();

  } catch (error) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }
};

// ✅ Admin-only middleware — double check (token + DB)
const adminOnly = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(403).json({ success: false, message: "Access Denied" });
    }

    if (tokenBlacklist.has(token)) {
      return res.status(403).json({ success: false, message: "Session expired." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      });
    } catch (err) {
      return res.status(403).json({ success: false, message: "Access Denied" });
    }

    if (!decoded.isAdmin) {
      return res.status(403).json({ success: false, message: "Access Denied" });
    }

    const user = await User.findById(decoded.id).select("-password");

    if (!user || !user.isAdmin) {
      return res.status(403).json({ success: false, message: "Access Denied" });
    }

    req.user = user;
    req.token = token;
    next();

  } catch (error) {
    return res.status(403).json({ success: false, message: "Access Denied" });
  }
};

// ✅ Logout — token blacklist میں ڈالو
const logout = (req, res) => {
  const token = req.token || (req.headers.authorization?.split(" ")[1]);
  if (token) {
    tokenBlacklist.add(token);
    // Production: Redis میں TTL کے ساتھ store کرو
    // await redis.setex(`bl_${token}`, 7 * 24 * 3600, "1");
  }
  res.json({ success: true, message: "Logged out successfully" });
};

module.exports = { protect, adminOnly, logout, tokenBlacklist };