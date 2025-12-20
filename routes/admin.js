const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const Group = require("../models/Group");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const { generateECDHKeyPair, encryptPrivateKey } = require("../utils/crypto");

const router = express.Router();

/* -------- User Management -------- */
/* -------- User Management -------- */
router.get("/users", auth, isAdmin, async (req, res) => {
  const users = await User.find().select("-passwordHash");
  res.json(users);
});

router.post("/users", auth, isAdmin, async (req, res) => {
  try {
    const { username, password, displayName, role } = req.body;

    const existing = await User.findOne({ username });
    if (existing)
      return res.status(400).json({ error: "Username already exists" });

    const passwordHash = await bcrypt.hash(password, 12);
    
    // Generate ECDH key pair on server
    const { publicKeyB64, privateKeyB64 } = generateECDHKeyPair();
    
    // Encrypt private key using the actual password (not hash, since we need deterministic encryption)
    const encryptedPrivateKey = encryptPrivateKey(privateKeyB64, password);
    
    const user = new User({
      username,
      passwordHash,
      displayName,
      role: role || "user",
      ecdhPublicKey: publicKeyB64,
      ecdhPrivateKeyEncrypted: encryptedPrivateKey,
    });
    await user.save();

    // ✅ Emit unified socket event for creation
    const io = req.app.get("io");
    if (io) {
      io.emit("user:new", {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      });

      // 💬 Optional: broadcast welcome message
      io.emit("message", {
        type: "system",
        ciphertext: `🎉 ${user.displayName || user.username} has been added by Admin!`,
        createdAt: new Date(),
      });

      console.log(`📢 Admin added new user: ${user.username}`);
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
  try {
    const { name, members } = req.body;
    const group = new Group({ name, members });
    await group.save();

    const io = req.app.get("io");
    if (io) {
      io.emit("groupAdded", { id: group._id });
    }

    res.json(group);
  } catch (err) {
    console.error("❌ Admin create group error:", err);
    res.status(500).json({ error: "Failed to create group" });
  }
});

router.put("/groups/:id", auth, isAdmin, async (req, res) => {
  try {
    const { name, members } = req.body;
    
    // Validate members array - ensure all are valid ObjectIds
    if (members && Array.isArray(members)) {
      const mongoose = require("mongoose");
      const validMembers = members.filter(m => mongoose.Types.ObjectId.isValid(m));
      if (validMembers.length !== members.length) {
        console.warn("⚠️ Some invalid member IDs were filtered out");
      }
      
      const updateData = { name };
      if (members.length > 0) {
        updateData.members = validMembers;
      } else {
        updateData.members = []; // Allow empty groups
      }
      
      const group = await Group.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      ).populate("members", "username displayName role");

      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }

      const io = req.app.get("io");
      if (io) {
        io.emit("groupUpdated", { id: group._id });
      }

      res.json(group);
    } else {
      // If members is not provided or not an array, just update name
      const group = await Group.findByIdAndUpdate(
        req.params.id,
        { name },
        { new: true }
      ).populate("members", "username displayName role");

      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }

      const io = req.app.get("io");
      if (io) {
        io.emit("groupUpdated", { id: group._id });
      }

      res.json(group);
    }
  } catch (err) {
    console.error("❌ Admin update group error:", err);
    res.status(500).json({ error: "Failed to update group" });
  }
});

router.delete("/groups/:id", auth, isAdmin, async (req, res) => {
  try {
    const deletedGroup = await Group.findByIdAndDelete(req.params.id);
    
    if (!deletedGroup) {
      return res.status(404).json({ error: "Group not found" });
    }

    const io = req.app.get("io");
    if (io) {
      io.emit("groupDeleted", { id: req.params.id });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Admin delete group error:", err);
    res.status(500).json({ error: "Failed to delete group" });
  }
});

module.exports = router;
