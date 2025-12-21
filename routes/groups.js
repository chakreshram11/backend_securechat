const router = require("express").Router();
const auth = require("../middleware/auth");
const Group = require("../models/Group");

router.get("/my", auth, async (req, res) => {
  const groups = await Group.find({
    members: req.user.id,
  }).select("_id name");

  res.json(groups);
});

module.exports = router;
