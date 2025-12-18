const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const Group = require("../models/Group");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

const router = express.Router();
const crypto = require("crypto");
const { encryptPrivateKey } = require("../utils/crypto");

/* -------- User Management -------- */
router.post("/users", auth, isAdmin, async (req, res) => {
  try {
    const { username, password, displayName, role } = req.body;

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // 🔐 Generate ECDH key pair
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();

    const ecdhPublicKey = ecdh.getPublicKey("base64");
    const ecdhPrivateKey = ecdh.getPrivateKey("base64");

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

      io.emit("message", {
        type: "system",
        ciphertext: `🎉 ${user.displayName || user.username} was added by Admin.`,
        createdAt: new Date(),
      });
    }

    res.json({
      user: {
        id: user._id,
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

router.put("/users/:id", auth, isAdmin, async (req, res) => {
  try {
    const updates = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    }).select("-passwordHash");

    const io = req.app.get("io");
    if (io) {
      io.emit("user:updated", {
        _id: user._id,
        username: user.username,
        role: user.role,
      });
    }

    res.json(user);
  } catch (err) {
    console.error("❌ Admin update user error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.delete("/users/:id", auth, isAdmin, async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);

    if (!deletedUser)
      return res.status(404).json({ error: "User not found" });

    const io = req.app.get("io");
    if (io) {
      // ✅ Unified delete event
      io.emit("user:deleted", {
        _id: req.params.id,
        username: deletedUser.username,
      });

      // 💬 Optional broadcast
      io.emit("message", {
        type: "system",
        ciphertext: `❌ ${deletedUser.displayName || deletedUser.username} was removed by Admin.`,
        createdAt: new Date(),
      });

      console.log(`🗑️ Admin deleted user: ${deletedUser.username}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Admin delete user error:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});


/* -------- Group Management -------- */
router.get("/groups", auth, isAdmin, async (req, res) => {
  const groups = await Group.find().populate("members", "username displayName role");
  res.json(groups);
});

router.post("/groups", auth, isAdmin, async (req, res) => {
  const { name, members } = req.body;
  const group = new Group({ name, members });
  await group.save();

  const io = req.app.get("io");
  io.emit("groupAdded", { id: group._id });

  res.json(group);
});

router.put("/groups/:id", auth, isAdmin, async (req, res) => {
  const { name, members } = req.body;
  const group = await Group.findByIdAndUpdate(
    req.params.id,
    { name, members },
    { new: true }
  ).populate("members", "username displayName role");

  const io = req.app.get("io");
  io.emit("groupUpdated", { id: group._id });

  res.json(group);
});

router.delete("/groups/:id", auth, isAdmin, async (req, res) => {
  await Group.findByIdAndDelete(req.params.id);

  const io = req.app.get("io");
  io.emit("groupDeleted", { id: req.params.id });

  res.json({ ok: true });
});

module.exports = router;
