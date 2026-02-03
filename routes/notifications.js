const express = require("express");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth");

const router = express.Router();

// Get current user's notifications
router.get("/", auth, async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(notifications);
    } catch (err) {
        console.error("❌ Get notifications error:", err);
        res.status(500).json({ error: "Failed to get notifications" });
    }
});

// Get unread count
router.get("/unread-count", auth, async (req, res) => {
    try {
        const count = await Notification.countDocuments({
            userId: req.user.id,
            read: false
        });
        res.json({ count });
    } catch (err) {
        res.status(500).json({ error: "Failed to get unread count" });
    }
});

// Mark notification as read
router.put("/:id/read", auth, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { read: true },
            { new: true }
        );
        if (!notification) {
            return res.status(404).json({ error: "Notification not found" });
        }
        res.json(notification);
    } catch (err) {
        res.status(500).json({ error: "Failed to mark as read" });
    }
});

// Mark all as read
router.put("/mark-all-read", auth, async (req, res) => {
    try {
        await Notification.updateMany(
            { userId: req.user.id, read: false },
            { read: true }
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to mark all as read" });
    }
});

module.exports = router;
