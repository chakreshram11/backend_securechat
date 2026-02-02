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
  body('type').isIn(['text', 'file']),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

  try {
    const { receiverId, groupId, ciphertext, type } = req.body;
    let meta = req.body.meta || {};

    // Accept both encrypted and unencrypted messages
    // - Encrypted: at least 29 bytes (12 IV + 1 data + 16 auth tag)
    // - Unencrypted (plaintext): any length if meta.unencrypted is true

    if (!ciphertext || ciphertext.length === 0) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }

    // If message is marked as unencrypted, allow any non-empty length
    // If ciphertext is short (<29) but not explicitly marked, treat it as plaintext (coerce)
    if (ciphertext.length < 29 && meta?.unencrypted !== true) {
      console.warn("⚠️ Short ciphertext received - treating as unencrypted and coercing meta.unencrypted=true", {
        provided: ciphertext?.length,
        minimum: 29,
        preview: ciphertext?.substring(0, 50)
      });
      // Coerce to unencrypted to preserve backward compatibility with older clients
      meta = { ...meta, unencrypted: true };
    }

    const m = new Message({
      senderId: req.user.id, // ✅ always use id from JWT
      receiverId: receiverId || null,
      groupId: groupId || null,
      ciphertext,
      type,
      meta: meta || {}
    });

    console.log("💾 Saving message:", {
      ciphertextLength: ciphertext.length,
      type,
      isUnencrypted: meta?.unencrypted,
      hasMeta: !!meta,
      metaKeys: Object.keys(meta || {})
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

    // Upload file to MongoDB
    const fileId = await storage.putFile(
      path,
      originalname,
      mimetype,
      req.user.id
    );

    // Generate absolute file URL based on request origin
    // This ensures the URL works regardless of which hostname/IP the client uses
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers.host || `localhost:${process.env.PORT || 5000}`;
    const absoluteUrl = `${protocol}://${host}/api/files/${fileId}`;

    // Also provide relative URL for clients that prefer it
    const relativeUrl = `/api/files/${fileId}`;

    console.log(`📁 File uploaded: ${originalname} -> ${absoluteUrl}`);

    res.json({ ok: true, url: absoluteUrl, relativeUrl, fileId });
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
      // Log meta for debugging - show ALL messages
      console.log("📥 History message:", {
        id: msgObj._id,
        hasMeta: !!msgObj.meta,
        metaKeys: Object.keys(msgObj.meta || {}),
        hasSenderPublicKey: !!msgObj.meta.senderPublicKey,
        senderPublicKeyLength: msgObj.meta.senderPublicKey?.length,
        senderPublicKeyPreview: msgObj.meta.senderPublicKey?.substring(0, 50),
        ciphertextLength: msgObj.ciphertext?.length
      });
      return msgObj;
    });

    console.log(`📤 Sending ${messagesData.length} messages in history response`);

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

    const userId = req.user.id;

    // Only return messages that are either public to the group (receiverId == null),
    // or explicitly targeted to the requesting user.
    // We REMOVED { senderId: userId } to prevent the sender from fetching all copies
    // they sent to other members (which they can't decrypt easily anyway).
    // The sender's own copy is covered by { receiverId: userId } assuming the client
    // sends a copy to self (which the current frontend loop does).
    const messages = await Message.find({
      groupId: groupId,
      $or: [
        { receiverId: null },
        { receiverId: userId }
      ]
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
