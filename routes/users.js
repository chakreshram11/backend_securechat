const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Group = require('../models/Group');

const router = express.Router();

// 📌 Get current user (must come first!)
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.toObject());
  } catch (err) {
    console.error("❌ Error fetching profile:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 📌 Get all users
router.get('/', auth, async (req, res) => {
  try {
    const users = await User.find()
      .select('username displayName _id ecdhPublicKey role createdAt');
    res.json(users.map(u => u.toObject()));
  } catch (err) {
    console.error("❌ Error fetching users:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 📌 Get user by ID
router.get("/:id", auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      "username displayName ecdhPublicKey"
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("❌ /api/users/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 📌 Get groups the current user is a member of
router.get('/groups/mine', auth, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user.id })
      .populate('members', 'username displayName role _id')
      .sort({ createdAt: -1 });
    res.json(groups);
  } catch (err) {
    console.error("❌ Error fetching user groups:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
