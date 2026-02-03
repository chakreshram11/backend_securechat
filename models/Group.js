const mongoose = require("mongoose");

const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Store group AES key encrypted for each member using their public key
  encryptedKeys: [{
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    encryptedKey: String  // Base64 encoded: IV + encrypted AES key
  }]
}, { timestamps: true });

module.exports = mongoose.model("Group", GroupSchema);
