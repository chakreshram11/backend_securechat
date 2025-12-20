const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true, required: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String },
    role: { type: String, enum: ["admin", "user"], default: "user" },

    // Privileges (admin can toggle these)
    canCreateGroups: { type: Boolean, default: true },
    canChat: { type: Boolean, default: true },
    canShareMedia: { type: Boolean, default: true },

    // ✅ Encryption
    ecdhPublicKey: { type: String, default: null }, // always stored at register
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
