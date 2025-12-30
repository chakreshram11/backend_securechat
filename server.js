const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { PORT, MONGO_URI } = require('./config');


const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const messagesRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');
const filesRoutes = require('./routes/files');
const { initSocket } = require('./socket');

// Load File model to ensure it's registered with Mongoose
require('./models/File');

const app = express();

// Middlewares
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: "Backend running 🚀" });
});

// Handle OPTIONS requests for all routes (CORS preflight)
app.options('*', cors());
app.post('/api/debug/ping', (req, res) => {
  console.log("🔍 Debug ping received from:", req.headers.origin);
  res.json({ ok: true, timestamp: new Date().toISOString(), message: "Pong!" });
});

// API routes
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/files', filesRoutes);

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
      maxPoolSize: 10, // Max number of connections in pool
      minPoolSize: 2,  // Min number of connections in pool
      maxIdleTimeMS: 45000,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ MongoDB connected with connection pooling enabled");

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server started on http://0.0.0.0:${PORT}`);
      console.log(`   Accessible at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB", err.message);
    process.exit(1);
  }
}

start();
