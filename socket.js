// socket.js
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("./config");
const Message = require("./models/Message");
const User = require("./models/User");
const Group = require("./models/Group");

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

    // Allow sockets to join/leave group rooms so broadcasts reach connected members
    socket.on('joinGroup', async (groupId) => {
      try {
        if (!groupId) return;
        const group = await Group.findById(groupId).select('members');
        if (!group) {
          console.warn(`⚠️ joinGroup: group not found: ${groupId}`);
          return socket.emit('errorJoiningGroup', { reason: 'not_found', groupId });
        }
        const isMember = group.members.map(m => String(m)).includes(String(userId));
        if (!isMember) {
          console.warn(`⚠️ joinGroup: user ${userId} denied for group ${groupId} (not a member)`);
          return socket.emit('errorJoiningGroup', { reason: 'not_a_member', groupId });
        }
        socket.join('group:' + groupId);
        console.log(` ${userId} joined group:${groupId}`);
      } catch (err) {
        console.error('Failed to join group room:', err.message);
      }
    });

    socket.on('leaveGroup', (groupId) => {
      try {
        if (!groupId) return;
        socket.leave('group:' + groupId);
        console.log(` ${userId} left group:${groupId}`);
      } catch (err) {
        console.warn('Failed to leave group room:', err.message);
      }
    });

    /* ---------------- MESSAGING ---------------- */
    socket.on("sendMessage", async (msg) => {
      // 1. Basic validation
      if (!msg?.ciphertext) {
        console.error("❌ REJECTED: No ciphertext provided");
        return socket.emit("errorSending", { reason: "no_ciphertext" });
      }

      // Validate ciphertext length (min 29 bytes for encrypted)
      if (msg.ciphertext.length < 29) {
        if (!msg.meta || typeof msg.meta !== 'object') msg.meta = {};
        if (msg.meta.unencrypted !== true) {
          console.warn("⚠️ Short ciphertext received over socket - coercing to unencrypted", {
            provided: msg.ciphertext.length,
            minimum: 29
          });
          msg.meta.unencrypted = true;
        }
      }

      console.log("✅ Ciphertext validated (or coerced to unencrypted):", {
        len: msg.ciphertext.length,
        isUnencrypted: msg.meta?.unencrypted === true
      });

      // 2. Identify Target using strict logic to avoid accidental broadcasting
      let target = null;
      if (msg.receiverId) {
        target = msg.receiverId.toString();
      } else if (msg.groupId) {
        target = "group:" + msg.groupId;
      }

      if (!target) {
        console.error("❌ REJECTED: No target (no receiverId or groupId)");
        return socket.emit("errorSending", { reason: "no_target" });
      }

      try {
        /* ---------------- STRICT GROUP SECURITY CHECK ---------------- */
        if (msg.groupId) {
          const group = await Group.findById(msg.groupId);
          if (!group) {
            console.warn(`❌ REJECTED: Group ${msg.groupId} not found`);
            return socket.emit("errorSending", { reason: "group_not_found" });
          }

          const senderIdStr = userId.toString();

          // Verify Sender is a member of the group
          // We use map(String) to ensure ObjectId comparison works
          const isSenderMember = group.members.some(m => m.toString() === senderIdStr);

          if (!isSenderMember) {
            console.warn(`🛑 Blocked message from non-member ${senderIdStr} to group ${msg.groupId}`);
            return socket.emit("errorSending", { reason: "not_a_member" });
          }

          // If looking to send to a specific receiver in the group, verify they are also a member
          if (msg.receiverId) {
            const receiverIdStr = msg.receiverId.toString();
            const isReceiverMember = group.members.some(m => m.toString() === receiverIdStr);

            if (!isReceiverMember) {
              console.warn(`🛑 Blocked message to non-member ${receiverIdStr} inside group ${msg.groupId}`);
              return socket.emit("errorSending", { reason: "recipient_not_member" });
            }
          }
        }
        /* --------------------------------------------------------- */

        if (msg.receiverId) {
          // Check for encryption keys if not plaintext
          if (msg.meta?.unencrypted !== true) {
            const receiverCaps = userCapabilities.get(String(msg.receiverId));
            const isRecipientOnline = onlineUsers.has(String(msg.receiverId));

            // If recipient is online but has no private key, we can't send encrypted
            if (isRecipientOnline && receiverCaps && receiverCaps.hasPrivateKey === false) {
              console.warn('❌ REJECTED: Recipient online but no private key');
              return socket.emit('errorSending', {
                reason: 'recipient_no_private_key',
                receiverId: msg.receiverId,
                message: 'Recipient is online but cannot decrypt.'
              });
            }
          }
        }

        const m = new Message({
          senderId: userId,
          receiverId: msg.receiverId || null,
          groupId: msg.groupId || null,
          ciphertext: msg.ciphertext,
          type: msg.type || "text",
          meta: msg.meta || {},
          read: false,
        });

        await m.save();

        const payload = {
          _id: m._id,
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

        // For group messages, use socket.to() to exclude sender (prevents duplicate)
        // For direct messages, use io.to() to ensure recipient receives it
        if (msg.groupId) {
          socket.to(target).emit("message", payload);
        } else {
          io.to(target).emit("message", payload);
        }
        console.log(`📡 Sent message from ${userId} to ${target} (type=${m.type})`);

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
