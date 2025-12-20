const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const Group = require("../models/Group");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

const router = express.Router();

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
    const user = new User({
      username,
      passwordHash,
      displayName,
      role: role || "user",
    });
    await user.save();

    // 🔔 Emit socket event
    const io = req.app.get("io");
    io.emit("userAdded", { id: user._id, username: user.username });

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
  await User.findByIdAndDelete(req.params.id);

  const io = req.app.get("io");
  io.emit("userDeleted", { id: req.params.id });

  res.json({ ok: true });
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
