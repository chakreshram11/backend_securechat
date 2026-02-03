const router = require("express").Router();
const auth = require("../middleware/auth");
const Group = require("../models/Group");

router.get("/my", auth, async (req, res) => {
  const groups = await Group.find({
    members: req.user.id,
  }).select("_id name");

  res.json(groups);
});

// Get the encrypted group key for the current user
router.get("/:id/key", auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    // Check if user is a member
    const isMember = group.members.some(m => m.toString() === req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: "Not a member of this group" });
    }

    // Find the encrypted key for this user
    const userKey = group.encryptedKeys?.find(
      k => k.memberId.toString() === req.user.id
    );

    if (!userKey) {
      return res.status(404).json({ error: "No encrypted key found for user" });
    }

    res.json({
      encryptedKey: userKey.encryptedKey,
      groupId: group._id
    });
  } catch (err) {
    console.error("❌ Get group key error:", err);
    res.status(500).json({ error: "Failed to get group key" });
  }
});

module.exports = router;
