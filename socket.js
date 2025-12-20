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

    /* ---------------- MESSAGING ---------------- */
    socket.on("sendMessage", async (msg) => {
      if (!msg?.ciphertext) return;

      console.log(" Incoming ciphertext:", {
        len: msg.ciphertext.length,
        preview: msg.ciphertext.slice(0, 40),
      });

      const target = msg.receiverId
        ? msg.receiverId.toString()
        : msg.groupId
        ? "group:" + msg.groupId
        : null;

      if (!target) return;

      try {
        if (msg.receiverId) {
          const receiver = await User.findById(msg.receiverId).select("ecdhPublicKey");
          if (!receiver?.ecdhPublicKey) {
            return socket.emit("errorSending", {
              reason: "recipient_missing_key",
              receiverId: msg.receiverId,
              message: "Recipient has not uploaded an encryption key.",
            });
          }
        }

        //  Before saving to DB
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
