// socket.js
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("./config");
const Message = require("./models/Message");
const User = require("./models/User");

function initSocket(server) {
  const io = new Server(server, { cors: { origin: "*" } });

  // Track online users + lastSeen
  const onlineUsers = new Map(); // userId -> [socketIds]
  const lastSeen = new Map();    // userId -> Date
  // Track per-user capabilities reported by clients (e.g., hasPrivateKey)
  const userCapabilities = new Map(); // userId -> { hasPrivateKey: boolean, hasWebCrypto: boolean }

  //  Authenticate sockets with JWT
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Missing token"));
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded; // { id, role }
      next();
    } catch (err) {
      console.error(" Socket auth error:", err.message);
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    if (!socket.user?.id) {
      console.error(" Connected socket has no user ID");
      return socket.disconnect(true);
    }

    const userId = socket.user.id;
    console.log(` User connected: ${userId}`);
    socket.join(userId.toString());

    //  Add user to online list
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, []);
    onlineUsers.get(userId).push(socket.id);

    //  Clear last seen
    lastSeen.delete(userId);

    // Broadcast updated list
    io.emit("onlineUsers", {
      online: Array.from(onlineUsers.keys()),
      lastSeen: Object.fromEntries(lastSeen),
    });

    // Listen for capability reports from client
    socket.on('capabilities', (caps) => {
      try {
        userCapabilities.set(userId, { hasPrivateKey: !!caps.hasPrivateKey, hasWebCrypto: !!caps.hasWebCrypto });
        console.log(`⚙️ Capabilities updated for ${userId}:`, userCapabilities.get(userId));
      } catch (err) {
        console.warn('⚠️ Failed to set capabilities:', err.message);
      }
    });

    // Optionally let client ask for current capabilities of another user
    socket.on('getUserCapabilities', (targetUserId, cb) => {
      cb && cb(userCapabilities.get(String(targetUserId)) || null);
    });

    /* ---------------- MESSAGING ---------------- */
    socket.on("sendMessage", async (msg) => {
      if (!msg?.ciphertext) {
        console.error("❌ REJECTED: No ciphertext provided");
        return socket.emit("errorSending", { reason: "no_ciphertext" });
      }

      // Validate ciphertext length - must be at least 12 (IV) + 1 (data) + 16 (auth tag) = 29 bytes minimum
      if (msg.ciphertext.length < 29) {
        // Treat short ciphertexts as plaintext (unencrypted) for backward compatibility
        if (!msg.meta || typeof msg.meta !== 'object') msg.meta = {};
        if (msg.meta.unencrypted !== true) {
          console.warn("⚠️ Short ciphertext received over socket - coercing to unencrypted", {
            provided: msg.ciphertext.length,
            minimum: 29,
            preview: msg.ciphertext.substring(0, 50)
          });
          msg.meta.unencrypted = true;
        }
      }

      console.log("✅ Ciphertext validated (or coerced to unencrypted):", {
        len: msg.ciphertext.length,
        preview: msg.ciphertext.slice(0, 40),
        metaKeys: Object.keys(msg.meta || {}),
        isUnencrypted: msg.meta?.unencrypted === true
      });

      const target = msg.receiverId
        ? msg.receiverId.toString()
        : msg.groupId
        ? "group:" + msg.groupId
        : null;

      if (!target) {
        console.error("❌ REJECTED: No target (no receiverId or groupId)");
        return socket.emit("errorSending", { reason: "no_target" });
      }

      try {
        if (msg.receiverId) {
          const receiver = await User.findById(msg.receiverId).select("ecdhPublicKey");
          if (!receiver?.ecdhPublicKey && msg.meta?.unencrypted !== true) {
            return socket.emit("errorSending", {
              reason: "recipient_missing_key",
              receiverId: msg.receiverId,
              message: "Recipient has not uploaded an encryption key.",
            });
          }
        }

        //  Before saving to DB
        // If recipient is online but reports they do NOT have a local private key, reject encrypted sends and request sender to resend unencrypted
        if (msg.receiverId && msg.meta?.unencrypted !== true) {
          const receiverCaps = userCapabilities.get(String(msg.receiverId));
          const isRecipientOnline = onlineUsers.has(String(msg.receiverId));
          if (isRecipientOnline && receiverCaps && receiverCaps.hasPrivateKey === false) {
            console.warn('❌ REJECTED: Recipient is online but cannot decrypt encrypted messages; asking sender to resend unencrypted', {
              receiverId: msg.receiverId,
              receiverCaps,
            });
            return socket.emit('errorSending', {
              reason: 'recipient_no_private_key',
              receiverId: msg.receiverId,
              message: 'Recipient is online but cannot decrypt encrypted messages; please resend without encryption.'
            });
          }
        }

        console.log(" Saving ciphertext:", {
          len: msg.ciphertext?.length,
          preview: msg.ciphertext?.slice(0, 50),
        });

        const m = new Message({
          senderId: userId,
          receiverId: msg.receiverId || null,
          groupId: msg.groupId || null,
          ciphertext: msg.ciphertext,
          type: msg.type || "text",
          meta: msg.meta || {},
          read: false,
        });
        
        // Log meta before saving to verify it's present
        console.log("💾 Saving message with meta:", {
          hasMeta: !!m.meta,
          hasSenderPublicKey: !!m.meta?.senderPublicKey,
          senderPublicKeyLength: m.meta?.senderPublicKey?.length,
          metaKeys: Object.keys(m.meta || {})
        });
        
        await m.save();
        
        // Verify meta was saved correctly
        const saved = await Message.findById(m._id);
        console.log("✅ Message saved, verifying meta:", {
          hasMeta: !!saved.meta,
          hasSenderPublicKey: !!saved.meta?.senderPublicKey,
          senderPublicKeyLength: saved.meta?.senderPublicKey?.length,
          metaKeys: Object.keys(saved.meta || {})
        });

        const payload = {
          id: m._id,
          senderId: m.senderId,
          receiverId: m.receiverId,
          groupId: m.groupId,
          ciphertext: m.ciphertext,
          type: m.type,
          meta: m.meta,
          createdAt: m.createdAt,
          read: m.read,
        };

        console.log("📤 Outgoing payload:", {
          ciphertextLen: payload.ciphertext.length,
          ciphertextPreview: payload.ciphertext.slice(0, 40),
          hasMeta: !!payload.meta,
          metaKeys: Object.keys(payload.meta || {}),
          hasSenderPublicKey: !!payload.meta?.senderPublicKey,
          senderPublicKeyLength: payload.meta?.senderPublicKey?.length,
          senderPublicKeyPreview: payload.meta?.senderPublicKey?.substring(0, 50)
        });

        io.to(target).emit("message", payload);
        console.log(` ${userId}  ${target} | type=${m.type}`);
      } catch (err) {
        console.error(" Failed to save/send message:", err.message);
        socket.emit("errorSending", { reason: "save_error", message: err.message });
      }
    });

    /* ---------------- READ RECEIPTS ---------------- */
    socket.on("markRead", async ({ otherId, groupId }) => {
      try {
        if (groupId) {
          await Message.updateMany(
            { groupId, read: { $ne: true }, receiverId: null },
            { $set: { read: true } }
          );
          io.to("group:" + groupId).emit("messagesRead", {
            readerId: userId,
            groupId,
          });
        } else if (otherId) {
          await Message.updateMany(
            { senderId: otherId, receiverId: userId, read: { $ne: true } },
            { $set: { read: true } }
          );
          io.to(otherId).emit("messagesRead", { readerId: userId });
        }
      } catch (err) {
        console.error(" Failed to mark as read:", err.message);
      }
    });

    /* ---------------- DISCONNECT ---------------- */
    socket.on("disconnect", () => {
      console.log(` User disconnected: ${userId}`);

      if (onlineUsers.has(userId)) {
        const sockets = onlineUsers.get(userId).filter((id) => id !== socket.id);
        if (sockets.length === 0) {
          onlineUsers.delete(userId);
          lastSeen.set(userId, new Date().toISOString());
          // Remove capabilities when user fully disconnects
          userCapabilities.delete(userId);
        } else {
          onlineUsers.set(userId, sockets);
        }
      }

      io.emit("onlineUsers", {
        online: Array.from(onlineUsers.keys()),
        lastSeen: Object.fromEntries(lastSeen),
      });
    });
  });

  return io;
}

module.exports = { initSocket };
