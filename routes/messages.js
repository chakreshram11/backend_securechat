const express = require('express');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { v4: uuidv4 } = require('uuid');
const storage = require('../storage/storage');

const router = express.Router();

// 📌 Send message
router.post('/', auth, [
  body('ciphertext').isString(),
  body('type').isIn(['text','file']),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

  try {
    const { receiverId, groupId, ciphertext, type, meta } = req.body;

    const m = new Message({
      senderId: req.user.id, // ✅ always use id from JWT
      receiverId: receiverId || null,
      groupId: groupId || null,
      ciphertext,
      type,
      meta: meta || {}
    });
    await m.save();

    // 📡 emit via socket
    const io = req.app.get('io');
    io.to(receiverId || 'group:' + groupId).emit('message', {
      id: m._id,
      senderId: m.senderId,
      receiverId: m.receiverId,
      groupId: m.groupId,
      ciphertext: m.ciphertext,
      type: m.type,
      meta: m.meta,
      createdAt: m.createdAt
    });

    res.json({ ok: true, id: m._id });
  } catch (err) {
    console.error("❌ Error saving message:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 📌 Upload file (encrypted before sending)
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    const { originalname, path, mimetype } = req.file;
    const objectName = `uploads/${uuidv4()}-${originalname}`;
    const url = await storage.putFile(path, objectName, mimetype);
    res.json({ ok: true, url, objectName });
  } catch (err) {
    console.error("❌ File upload failed:", err.message);
    res.status(500).json({ error: 'upload failed' });
  }
});

// 📌 Get chat history with another user
router.get('/history/:otherId', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const otherId = req.params.otherId;

    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: otherId },
        { senderId: otherId, receiverId: userId }
      ]
    }).sort({ createdAt: 1 }).limit(100);

    const messagesData = messages.map(m => {
      const msgObj = m.toObject();
      // Ensure meta is always an object
      if (!msgObj.meta || typeof msgObj.meta !== 'object') {
        msgObj.meta = {};
      }
      // Log meta for debugging
      if (msgObj.meta && Object.keys(msgObj.meta).length > 0) {
        console.log("📥 Message meta:", {
          id: msgObj._id,
          hasSenderPublicKey: !!msgObj.meta.senderPublicKey,
          senderPublicKeyLength: msgObj.meta.senderPublicKey?.length
        });
      }
      return msgObj;
    });

    res.json(messagesData);
  } catch (err) {
    console.error("❌ Error fetching history:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 📌 Get group chat history
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const groupId = req.params.groupId;

    const messages = await Message.find({
      groupId: groupId
    }).sort({ createdAt: 1 }).limit(100).populate('senderId', 'username displayName');

    const messagesData = messages.map(m => {
      const msgObj = m.toObject();
      // Ensure meta is always an object
      if (!msgObj.meta || typeof msgObj.meta !== 'object') {
        msgObj.meta = {};
      }
      return msgObj;
    });

    res.json(messagesData);
  } catch (err) {
    console.error("❌ Error fetching group history:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});



module.exports = router;
