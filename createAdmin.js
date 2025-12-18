require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const User = require("./models/User");
const { encryptPrivateKey } = require("./utils/crypto");
const { MONGO_URI } = require("./config");

async function createAdmin() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");

    const username = "admin";
    const password = "admin123"; // change later
    const displayName = "Administrator";

    // ❌ Prevent duplicate admin
    const exists = await User.findOne({ username });
    if (exists) {
      console.log("⚠️ Admin already exists");
      process.exit(0);
    }

    // 🔑 Generate ECDH key pair (Node)
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();

    const ecdhPublicKey = ecdh.getPublicKey("base64");
    const ecdhPrivateKey = ecdh.getPrivateKey("base64");

    const passwordHash = await bcrypt.hash(password, 12);

    const admin = new User({
      username,
      passwordHash,
      displayName,
      role: "admin",
      ecdhPublicKey,
      ecdhPrivateKeyEnc: encryptPrivateKey(ecdhPrivateKey),
      canCreateGroups: true,
      canChat: true,
      canShareMedia: true,
    });

    await admin.save();

    console.log("🎉 Admin created successfully");
    console.log("👤 Username:", username);
    console.log("🔑 Password:", password);

    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to create admin:", err);
    process.exit(1);
  }
}

createAdmin();
