const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalname: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true }, // Binary file data
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedAt: { type: Date, default: Date.now },
  // For file sharing context
  sharedInMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  isImage: { type: Boolean, default: false }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for file URL
FileSchema.virtual('url').get(function() {
  return `/api/files/${this._id}`;
});

module.exports = mongoose.model('File', FileSchema);
