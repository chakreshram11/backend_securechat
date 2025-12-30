const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../config");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const { decryptPrivateKey, generateECDHKeyPair } = require("../utils/crypto");

const router = express.Router();

/* -------- Admin Creates User -------- */
router.post("/register", auth, isAdmin, async (req, res) => {
  try {
    const { username, password, displayName, role, ecdhPublicKey } = req.body;

    if (await User.findOne({ username })) {
      return res.status(400).json({ error: "User already exists" });
    }

    if (!ecdhPublicKey) {
      return res.status(400).json({ error: "Missing ECDH public key" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = new User({
      username,
      passwordHash,
      displayName,
      role: role || "user",
      ecdhPublicKey, // ✅ Save at registration
    });

    await user.save();

    res.json({
      ok: true,
      id: user._id,
      username: user.username,
      role: user.role,
    });
  } catch (err) {
    console.error("❌ Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* -------- User Login -------- */
router.post("/login", async (req, res) => {
  try {
    const { username, password, ecdhPublicKey, needPrivateKey } = req.body;

    console.log(`🔐 Login attempt for user: ${username}, needPrivateKey: ${needPrivateKey}`);

    const user = await User.findOne({ username });
    if (!user) {
      console.log(`❌ User not found: ${username}`);
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      console.log(`❌ Password mismatch for user: ${username}`);
      return res.status(400).json({ error: "Invalid credentials" });
    }

    console.log(`✅ Password verified for user: ${username}`);

    // If client provided a public key and it differs from stored, update it.
    if (ecdhPublicKey) {
      if (!user.ecdhPublicKey || user.ecdhPublicKey !== ecdhPublicKey) {
        user.ecdhPublicKey = ecdhPublicKey;
        await user.save();
        console.log(`🔑 Stored/updated public key for ${user.username}`);
      }
    }

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    const response = {
      token,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        ecdhPublicKey: user.ecdhPublicKey,
      },
    };

    // If user needs private key and server has it stored, decrypt and return it
    if (needPrivateKey && user.ecdhPrivateKeyEncrypted) {
      try {
        // Use the actual password (from request) to decrypt, not the password hash
        const decryptedPrivateKey = decryptPrivateKey(
          user.ecdhPrivateKeyEncrypted,
          password
        );
        response.ecdhPrivateKey = decryptedPrivateKey;
        console.log(`🔓 Decrypted and returned private key for ${user.username}`);
      } catch (err) {
        console.error("❌ Failed to decrypt private key:", err);
        console.error("Decryption error details:", err.message);
        // Continue without private key - user can still login
      }
    }

    console.log(`✅ Login successful for user: ${username}`);
    res.json(response);
  } catch (err) {
    console.error("❌ Login error:", err);
    console.error("Error stack:", err.stack);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

/* -------- Get Current User -------- */
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-passwordHash");
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
// POST /api/auth/uploadKey
router.post('/uploadKey', auth, async (req, res) => {
  try {
    const { ecdhPublicKey } = req.body;
    if (!ecdhPublicKey) return res.status(400).json({ error: "Missing ecdhPublicKey" });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.ecdhPublicKey = ecdhPublicKey;
    await user.save();

    res.json({ ok: true, message: "Public key saved" });
  } catch (err) {
    console.error("❌ uploadKey error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/auth/generateKeys - Generate keys on backend when Web Crypto is not available
router.post('/generateKeys', auth, async (req, res) => {
  try {
    console.log(`🔑 Generating keys on backend for user: ${req.user.id}`);

    // Generate ECDH key pair on the backend
    const { publicKeyB64, privateKeyB64 } = generateECDHKeyPair();

    // Store the public key in the user's record
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.ecdhPublicKey = publicKeyB64;
    await user.save();

    console.log(`✅ Generated keys on backend for user: ${req.user.id}`);

    res.json({
      ok: true,
      publicKey: publicKeyB64,
      privateKey: privateKeyB64,
      message: "Keys generated on backend successfully"
    });
  } catch (err) {
    console.error("❌ generateKeys error:", err);
    console.error("Error stack:", err.stack);
    res.status(500).json({ error: "Failed to generate keys on backend" });
  }
});


module.exports = router;
