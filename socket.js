const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("./config");

function initSocket(server) {
  const io = new Server(server, { cors: { origin: "*" } });

  // 🔐 Authenticate sockets
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Missing token"));

      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded; // attach { id, role }
      next();
    } catch (err) {
      console.error("❌ Socket auth error:", err.message);
      next(new Error("Authentication error"));
    }
  });

  // 📡 Socket events
  io.on("connection", (socket) => {
    if (!socket.user?.id) {
      console.error("⚠️ Connected socket has no user ID");
      return socket.disconnect();
    }

    console.log(`🔌 User connected: ${socket.user.id}`);
    socket.join(socket.user.id.toString()); // ✅ private room

    // 👥 Groups
    socket.on("joinGroup", (groupId) => {
      if (groupId) {
        socket.join("group:" + groupId);
        console.log(`👥 User ${socket.user.id} joined group ${groupId}`);
      }
    });

    socket.on("leaveGroup", (groupId) => {
      if (groupId) {
        socket.leave("group:" + groupId);
        console.log(`👤 User ${socket.user.id} left group ${groupId}`);
      }
    });

    // 💬 Messaging
    socket.on("sendMessage", (msg) => {
      if (!msg) return;

      const target = msg.receiverId
        ? msg.receiverId
        : msg.groupId
        ? "group:" + msg.groupId
        : null;

      if (!target) {
        console.warn("⚠️ Message missing target (receiverId/groupId).");
        return;
      }

      io.to(target).emit("message", {
        senderId: socket.user.id,
        ciphertext: msg.ciphertext,
        type: msg.type || "text",
        meta: msg.meta || {},
        createdAt: new Date()
      });

      console.log(`📩 Message from ${socket.user.id} → ${target}`);
    });

    socket.on("disconnect", () => {
      console.log(`❌ User disconnected: ${socket.user.id}`);
    });
  });

  return io;
}

module.exports = { initSocket };
