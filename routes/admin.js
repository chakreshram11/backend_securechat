const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const Group = require("../models/Group");
const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const { generateECDHKeyPair, encryptPrivateKey, generateGroupKey, encryptGroupKeyForMember } = require("../utils/crypto");

const router = express.Router();

/* -------- Audit Logs -------- */
router.get("/audit-logs", auth, isAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const logs = await AuditLog.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('adminId', 'username displayName')
      .populate('targetUserId', 'username displayName');

    const total = await AuditLog.countDocuments();

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("❌ Get audit logs error:", err);
    res.status(500).json({ error: "Failed to get audit logs" });
  }
});

/* -------- User Management -------- */
router.get("/users", auth, isAdmin, async (req, res) => {
  const users = await User.find().select("-passwordHash");
  res.json(users);
});

router.post("/users", auth, isAdmin, async (req, res) => {
  try {
    const { username, password, displayName, role } = req.body;

    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: "Username already exists" });

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

    // 🔔 Emit socket event
    const io = req.app.get("io");
    io.emit("user:new", user);
    io.emit("userAdded", user);

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add user" });
  }
});

router.put("/users/:id", auth, isAdmin, async (req, res) => {
  const updates = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, updates, {
    new: true,
  }).select("-passwordHash");

  const io = req.app.get("io");
  io.emit("userUpdated", { id: user._id });

  res.json(user);
});

router.delete("/users/:id", auth, isAdmin, async (req, res) => {
  // Prevent administrators from deleting their own account
  if (req.params.id === req.user.id) {
    return res.status(403).json({ error: "You cannot delete your own account" });
  }

  const deletedUser = await User.findByIdAndDelete(req.params.id);

  const io = req.app.get("io");
  io.emit("user:deleted", deletedUser);
  io.emit("userDeleted", deletedUser);

  res.json({ ok: true });
});

/* -------- Group Management -------- */
router.get("/groups", auth, isAdmin, async (req, res) => {
  const groups = await Group.find().populate("members", "username displayName role");
  res.json(groups);
});

router.post("/groups", auth, isAdmin, async (req, res) => {
  try {
    const { name, members } = req.body;

    // Generate a random AES key for this group
    const groupKey = generateGroupKey();
    console.log(`🔐 Generated group key for new group: ${name}`);

    // Encrypt the group key for each member
    const encryptedKeys = [];
    if (members && members.length > 0) {
      // Fetch members' public keys
      const memberUsers = await User.find({ _id: { $in: members } }).select('_id ecdhPublicKey username');

      for (const member of memberUsers) {
        if (member.ecdhPublicKey) {
          try {
            const encryptedKey = encryptGroupKeyForMember(groupKey, member.ecdhPublicKey);
            encryptedKeys.push({
              memberId: member._id,
              encryptedKey: encryptedKey
            });
            console.log(`🔑 Encrypted group key for member: ${member.username}`);
          } catch (err) {
            console.warn(`⚠️ Failed to encrypt group key for ${member.username}:`, err.message);
          }
        } else {
          console.warn(`⚠️ Member ${member.username} has no public key - cannot encrypt group key`);
        }
      }
    }

    const group = new Group({ name, members, encryptedKeys });
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

/* -------- Admin Resets User Password -------- */
router.post("/users/:id/reset-password", auth, isAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: "New password is required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    user.passwordHash = newPasswordHash;

    // Clear encrypted private key - user will need to regenerate
    user.ecdhPrivateKeyEncrypted = null;

    await user.save();

    // Get admin info for logging
    const admin = await User.findById(req.user.id).select('username displayName');
    const adminName = admin?.displayName || admin?.username || 'Unknown Admin';

    // Create audit log
    await AuditLog.create({
      action: 'PASSWORD_RESET',
      adminId: req.user.id,
      targetUserId: user._id,
      details: `Password reset by ${adminName}`,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown'
    });

    // Create notification for the user
    await Notification.create({
      userId: user._id,
      type: 'PASSWORD_RESET',
      title: '🔐 Password Reset Alert',
      message: `Your password was reset by an administrator (${adminName}) on ${new Date().toLocaleString()}. If you did not request this, please contact support immediately.`
    });

    // Emit notification via socket if available
    const io = req.app.get('io');
    if (io) {
      io.to(user._id.toString()).emit('notification', {
        type: 'PASSWORD_RESET',
        title: '🔐 Password Reset Alert',
        message: `Your password was reset by an administrator.`
      });
    }

    console.log(`✅ Admin reset password for user: ${user.username} (logged and notified)`);

    res.json({ ok: true, message: `Password reset for ${user.username}` });
  } catch (err) {
    console.error("❌ Admin reset password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

module.exports = router;
