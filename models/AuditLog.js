const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
    action: {
        type: String,
        required: true,
        enum: ["PASSWORD_RESET", "USER_CREATED", "USER_DELETED", "ROLE_CHANGED", "GROUP_CREATED", "GROUP_DELETED"]
    },
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    targetUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    targetGroupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group"
    },
    details: {
        type: String
    },
    ipAddress: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for querying logs
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ adminId: 1 });
auditLogSchema.index({ targetUserId: 1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
