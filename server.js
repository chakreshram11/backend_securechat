const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { PORT, MONGO_URI } = require('./config');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const messagesRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');
const { initSocket } = require('./socket');

const app = express();

// Middlewares
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: "Backend running 🚀" });
});

// API routes
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/messages', messagesRoutes);

// Static files (for uploaded media)
app.use('/files', express.static('files'));

// Create HTTP + Socket.io server
const server = http.createServer(app);
const io = initSocket(server); // Make sure initSocket handles io.on("connection")
app.set('io', io);

// Start server with Mongo connection
async function start() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected");

    server.listen(PORT, () => {
      console.log(`✅ Server started on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB", err.message);
    process.exit(1);
  }
}

start();
