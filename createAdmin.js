require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("./models/User");
const { encryptPrivateKey } = require("./utils/crypto");
const { MONGO_URI } = require("./config");

async function createAdmin() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");

    const username = "Server@admin";
    const password = "Server@admin123"; // change later
    const displayName = "Administrator";

    // ❌ Prevent duplicate admin
    const exists = await User.findOne({ username });
    if (exists) {
      console.log("⚠️ Admin already exists");
      process.exit(0);
    }

    // 🔐 Generate admin ECDH key pair (PKCS8 compatible)
    const { generateKeyPairSync } = require("crypto");
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: {
        type: "spki",
        format: "der",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "der",
      },
    });

    const ecdhPublicKey = publicKey.toString("base64");
    const ecdhPrivateKey = privateKey.toString("base64");

    const passwordHash = await bcrypt.hash(password, 12);

    // Use configured KEY_ENCRYPT_SECRET if available; otherwise fall back to admin password
    const keyEncryptSecret = process.env.KEY_ENCRYPT_SECRET || password;
    if (!process.env.KEY_ENCRYPT_SECRET) {
      console.warn("⚠️ KEY_ENCRYPT_SECRET not set; falling back to admin password for key encryption");
    }

    const admin = new User({
      username,
      passwordHash,
      displayName,
      role: "admin",
      ecdhPublicKey,
      ecdhPrivateKeyEncrypted: encryptPrivateKey(ecdhPrivateKey, keyEncryptSecret),
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
