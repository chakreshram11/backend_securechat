const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const Group = require("../models/Group");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const { generateKeyPairSync } = require("crypto");
const { encryptPrivateKey } = require("../utils/crypto");

const router = express.Router();

/* ================= USER MANAGEMENT ================= */

/* ✅ GET ALL USERS (FIXES 404) */
router.get("/users", auth, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select(
      "username displayName role"
    );
    res.json(users);
  } catch (err) {
    console.error("❌ Admin get users error:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

/* ✅ CREATE USER */
router.post("/users", auth, isAdmin, async (req, res) => {
  try {
    const { username, password, displayName, role } = req.body;

    if (await User.findOne({ username })) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // 🔐 Generate ECDH key pair (PKCS8 – browser compatible)
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1", // P-256
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });

    const ecdhPublicKey = publicKey.toString("base64");
    const ecdhPrivateKey = privateKey.toString("base64");

    const passwordHash = await bcrypt.hash(password, 12);

    const user = new User({
      username,
      passwordHash,
      displayName,
      role: role || "user",
      ecdhPublicKey,
      ecdhPrivateKeyEnc: encryptPrivateKey(ecdhPrivateKey),
    });

    await user.save();

    // 🔔 Socket broadcast
    const io = req.app.get("io");
    if (io) {
      io.emit("user:new", {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      });
    }

    res.json({
      user: {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("❌ Admin add user error:", err);
    res.status(500).json({ error: "Failed to add user" });
  }
});

/* ✅ UPDATE USER */
router.put("/users/:id", auth, isAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).select("username displayName role");

    res.json(user);
  } catch (err) {
    console.error("❌ Admin update user error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

/* ✅ DELETE USER */
router.delete("/users/:id", auth, isAdmin, async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const io = req.app.get("io");
    if (io) {
      io.emit("user:deleted", { _id: req.params.id });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Admin delete user error:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

/* ================= GROUP MANAGEMENT ================= */

router.get("/groups", auth, isAdmin, async (req, res) => {
  const groups = await Group.find().populate(
    "members",
    "username displayName role"
  );
  res.json(groups);
});

router.post("/groups", auth, isAdmin, async (req, res) => {
  const group = new Group(req.body);
  await group.save();

  const io = req.app.get("io");
  if (io) io.emit("groupAdded", { id: group._id });

  res.json(group);
});

router.put("/groups/:id", auth, isAdmin, async (req, res) => {
  const group = await Group.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  ).populate("members", "username displayName role");

  const io = req.app.get("io");
  if (io) io.emit("groupUpdated", { id: group._id });

  res.json(group);
});

router.delete("/groups/:id", auth, isAdmin, async (req, res) => {
  await Group.findByIdAndDelete(req.params.id);

  const io = req.app.get("io");
  if (io) io.emit("groupDeleted", { id: req.params.id });

  res.json({ ok: true });
});

module.exports = router;
