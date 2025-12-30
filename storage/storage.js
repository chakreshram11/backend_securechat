// MongoDB file storage
const fs = require('fs');
const path = require('path');
const File = require('../models/File');

async function putFile(localPath, name, contentType, userId) {
  try {
    // Read file data
    const fileData = fs.readFileSync(localPath);
    const fileStats = fs.statSync(localPath);

    // Determine if it's an image
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);

    // Create file record in MongoDB
    const file = new File({
      filename: name,
      originalname: name,
      mimetype: contentType || 'application/octet-stream',
      size: fileStats.size,
      data: fileData,
      uploadedBy: userId,
      isImage: isImage
    });

    await file.save();

    // Clean up temporary file
    fs.unlink(localPath, () => {});

    // Return the file ID for URL generation
    return file._id;
  } catch (err) {
    console.error('❌ MongoDB file storage error:', err);
    // Clean up temporary file even if save fails
    fs.unlink(localPath, () => {});
    throw new Error('File storage failed: ' + err.message);
  }
}

async function getFile(fileId) {
  try {
    const file = await File.findById(fileId);
    if (!file) {
      throw new Error('File not found');
    }
    return file;
  } catch (err) {
    console.error('❌ MongoDB file retrieval error:', err);
    throw new Error('File retrieval failed: ' + err.message);
  }
}

async function deleteFile(fileId) {
  try {
    await File.findByIdAndDelete(fileId);
  } catch (err) {
    console.error('❌ MongoDB file deletion error:', err);
    throw new Error('File deletion failed: ' + err.message);
  }
}

module.exports = { putFile, getFile, deleteFile };
