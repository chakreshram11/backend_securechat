const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const storage = require('../storage/storage');
const File = require('../models/File');

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// ============================================================
// IMPORTANT: Specific routes MUST come BEFORE parameterized routes
// Otherwise /list will be caught by /:fileId
// ============================================================

// File list endpoint (MUST be before /:fileId)
router.get('/list', auth, async (req, res) => {
  try {
    console.log('📋 File list request for user:', req.user.id);

    // Get files uploaded by the current user from MongoDB
    const files = await File.find({ uploadedBy: req.user.id })
      .sort({ uploadedAt: -1 })
      .limit(100);

    console.log('📋 Found files:', files.length);

    // Format the response
    const formattedFiles = files.map(file => ({
      name: file.originalname,
      size: file.size,
      lastModified: file.uploadedAt,
      fileId: file._id,
      url: `/api/files/${file._id}`,
      isImage: file.isImage,
      mimetype: file.mimetype
    }));

    res.json(formattedFiles);
  } catch (error) {
    console.error('❌ File list error:', error);
    res.status(500).json({
      error: 'Failed to list files',
      details: error.message
    });
  }
});

// Test MongoDB file storage endpoint (MUST be before /:fileId)
router.get('/test', auth, async (req, res) => {
  try {
    console.log('🧪 Testing MongoDB file storage...');

    // Test File model connection
    const testFile = new File({
      filename: 'test-file.txt',
      originalname: 'test-file.txt',
      mimetype: 'text/plain',
      size: 12,
      data: Buffer.from('test content'),
      uploadedBy: req.user.id,
      isImage: false
    });

    await testFile.save();
    console.log('✅ Test file saved successfully, ID:', testFile._id);

    // Clean up
    await File.findByIdAndDelete(testFile._id);
    console.log('✅ Test file cleaned up');

    // Test file count
    const fileCount = await File.countDocuments({ uploadedBy: req.user.id });
    console.log('📊 User file count:', fileCount);

    res.json({
      success: true,
      message: 'MongoDB file storage working correctly',
      fileCount: fileCount
    });
  } catch (error) {
    console.error('❌ MongoDB test failed:', error);
    res.status(500).json({
      success: false,
      error: 'MongoDB file storage test failed',
      details: error.message
    });
  }
});

// File upload endpoint
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    console.log('📁 File upload request received');

    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📁 Uploading file to MongoDB:', req.file.originalname);

    // Upload file to MongoDB
    const fileId = await storage.putFile(
      req.file.path,
      req.file.originalname,
      req.file.mimetype,
      req.user.id
    );
    console.log('✅ File uploaded to MongoDB, ID:', fileId);

    // Generate absolute file URL based on request origin
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers.host || `localhost:${process.env.PORT || 5000}`;
    const absoluteUrl = `${protocol}://${host}/api/files/${fileId}`;

    console.log(`📁 File URL: ${absoluteUrl}`);

    res.json({
      url: absoluteUrl,
      filename: req.file.originalname,
      fileId: fileId,
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('❌ File upload error:', error);
    res.status(500).json({
      error: 'File upload failed',
      details: error.message
    });
  }
});

// File download endpoint (parameterized - MUST be LAST)
// NOTE: No auth required - files are accessible by their unique ID
// This allows <img> tags to load images without auth headers
router.get('/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;

    // Validate that fileId looks like a MongoDB ObjectId
    if (!/^[0-9a-fA-F]{24}$/.test(fileId)) {
      return res.status(400).json({
        error: 'Invalid file ID format',
        details: 'File ID must be a 24-character hex string'
      });
    }

    // Get file from MongoDB
    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({
        error: 'File not found',
        details: 'File does not exist in database'
      });
    }

    // Set appropriate headers for file download
    res.set({
      'Content-Type': file.mimetype,
      'Content-Disposition': `inline; filename="${file.originalname}"`,
      'Content-Length': file.size
    });

    // Send file data
    res.send(file.data);
  } catch (error) {
    console.error('❌ File download error:', error);
    res.status(500).json({
      error: 'File download failed',
      details: error.message
    });
  }
});

// File delete endpoint
router.delete('/:fileId', auth, async (req, res) => {
  try {
    const fileId = req.params.fileId;

    // Validate that fileId looks like a MongoDB ObjectId
    if (!/^[0-9a-fA-F]{24}$/.test(fileId)) {
      return res.status(400).json({
        error: 'Invalid file ID format'
      });
    }

    // Find and delete file from MongoDB
    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Check ownership
    if (String(file.uploadedBy) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized to delete this file' });
    }

    await File.findByIdAndDelete(fileId);

    res.json({
      message: 'File deleted successfully',
      fileId: fileId
    });
  } catch (error) {
    console.error('❌ File delete error:', error);
    res.status(500).json({
      error: 'File deletion failed',
      details: error.message
    });
  }
});

module.exports = router;
