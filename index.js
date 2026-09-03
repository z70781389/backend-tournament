const express   = require("express");
const connectDB = require("./db");
const cors      = require("cors");
const path      = require("path");
const helmet    = require("helmet");
const rateLimit = require("express-rate-limit");

const userRoutes       = require("./routes/userRoutes");
const tournamentRoutes = require("./routes/tournamentRoutes");
const matchRoutes      = require("./routes/matchRoutes");
const walletRoutes     = require("./routes/walletRoutes");
const apiRoutes        = require("./routes/api");
const depositRoutes    = require("./routes/deposit_route");
const withdrawRoutes   = require("./routes/withdraw_routes");
const adminAuthRoutes  = require("./routes/admin.auth.routes");
const dashboardRoutes  = require("./routes/dashboard.routes");
const supportRoute     = require("./routes/supportRoute");
const referralRoutes   = require("./routes/referralRoutes");   // ✅ REFERRAL: new import

const { protect }  = require("./middleware/authMiddleware");
const requestGuard = require("./middleware/requestGuard");

// ✅ FIX #1: cron import REMOVED from top-level
// Do NOT require notificationCron here — it was blocking event loop on startup

const app = express();

// ─── DB ───────────────────────────────────────────────────────────────────
connectDB()
  .then(() => {
    console.log("✅ Database connection successful");
    // ✅ FIX: cron sirf DB connect hone ke BAAD start karo
    // Aur sirf production mein
    if (process.env.NODE_ENV === "production") {
      try {
        const { startNotificationCron } = require("./cron/notificationCron");
        startNotificationCron();
        console.log("✅ Cron started");
      } catch (e) {
        console.error("❌ Cron failed to start:", e.message);
        // ✅ Cron fail hone par server crash nahi hoga
      }
    }
  })
  .catch((err) => console.error("❌ Database connection error:", err));

// ─── CORS ─────────────────────────────────────────────────────────────────
app.use(cors({
  origin:         "*",
  methods:        ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID", "X-Timestamp", "X-Device-ID"],
  credentials:    true,
}));

app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-Timestamp, X-Device-ID");
    return res.sendStatus(204);
  }
  next();
});

// ─── SECURITY ─────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: "10kb" }));

// ─── REQUEST LOGGER ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  req._startTime = Date.now();
  console.log(`\n➡️ [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  res.on("finish", () => {
    console.log(`✅ ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - req._startTime}ms)`);
  });
  next();
});

// ─── RATE LIMITERS ────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max:      100,
  message:  { success: false, message: "Too many requests" },
});
app.use(globalLimiter);

const walletLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max:      20,
  message:  { success: false, message: "Too many wallet requests" },
});

const joinLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max:      10,
  message:  { success: false, message: "Too many join requests" },
});

// ─── ROUTES ───────────────────────────────────────────────────────────────
app.use("/api/v1/users",   userRoutes);
app.use("/api/v1/admin",   require("./routes/adminRoutes"));

// ✅ FIX #2: tournamentRoutes sirf EK baar mount karo
app.use("/api/v1",         tournamentRoutes);

// ✅ FIX #3: /api/v1/join alag se mount NAHI karo — tournamentRoutes mein
// /join-tournament route already exist karta hai protect ke saath
// Duplicate mount hata diya — yahi 502 ka root cause tha

app.use(
  "/api/v1/wallet",
  protect,
  walletLimiter,
  requestGuard,
  walletRoutes
);

app.use("/api/v1/match",       matchRoutes);
app.use("/api/v1/match-api",   apiRoutes);
app.use("/api/v1/deposit",     depositRoutes);
app.use("/api/v1/withdraw",    withdrawRoutes);
app.use("/api/v1/admin/user",  adminAuthRoutes);
app.use("/api/v1/dashboard",   dashboardRoutes);
app.use("/api/v1/support",     supportRoute);
app.use("/api/v1/leaderboard", require("./routes/leaderboard_routes"));
app.use("/api/v1/referral",    referralRoutes);
app.use("/api/v1/admin/users", require("./routes/adminUserRoutes"));   // ✅ REFERRAL: new route mount

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ─── 404 ──────────────────────────────────────────────────────────────────
app.use((req, res) => {
  console.warn(`⚠️ 404: ${req.method} ${req.url}`);
  res.status(404).json({ message: "Route not found" });
});

// ─── GLOBAL ERROR ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`❌ Uncaught error: ${err.stack}`);
  res.status(500).json({ message: "Internal Server Error", error: err.message });
});

// ─── START ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
});

process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION:", err.stack || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 UNHANDLED REJECTION:", reason);
});