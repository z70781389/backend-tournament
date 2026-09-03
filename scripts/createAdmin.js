require("dotenv").config({path: "../.env"});
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    const existing = await User.findOne({
      email: "gameArenaAdmin@ga.com"
    });

    if (existing) {
      console.log("⚠️  Admin already exists");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash("GA@Admin#9x7K", 10);

    const admin = new User({
      username: "GameArena Admin",
      email: "gameArenaAdmin@ga.com",
      password: hashedPassword,

      freefireId: "ADMIN",
      isAdmin: true,
      coins: 0,
      deposit: 0,
      winning: 0,
      bonus: 0,
      balance: 0,
      // ✅ referralCode unique rakha
      referralCode: "GAADMIN001",
    });

    await admin.save();

    console.log("✅ Admin created successfully");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
   
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
};

createAdmin();