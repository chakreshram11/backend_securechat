const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // either receiver or groupId
  groupId: { type: String, default: null },
  type: { type: String, enum: ['text','file'], default: 'text' },
  ciphertext: { type: String, required: true }, // base64 encoded AES-GCM ciphertext + iv concatenated
  meta: { 
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }, // e.g., filename, mimetype, senderPublicKey
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, {
  // Ensure virtuals and nested objects are included when converting to JSON
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

module.exports = mongoose.model('Message', MessageSchema);