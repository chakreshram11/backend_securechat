const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const { MINIO } = require('../config');
const Minio = require('minio');
const storage = require('../storage/storage');
const File = require('../models/File');

// Configure MinIO client
let minioClient = null;
if (MINIO.endPoint) {
  minioClient = new Minio.Client({
    endPoint: MINIO.endPoint,
    port: MINIO.port,
    useSSL: MINIO.useSSL,
    accessKey: MINIO.accessKey,
    secretKey: MINIO.secretKey
  });
} else {
  console.warn('⚠️ MinIO endpoint not configured in files.js, file operations will be disabled');
}

const BUCKET = 'chat-files';

// Ensure bucket exists
async function ensureBucketExists() {
  if (!minioClient) {
    console.warn('⚠️ MinIO not configured, skipping bucket check');
    return;
  }
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET);
      console.log(`✅ Created MinIO bucket: ${BUCKET}`);
    }
  } catch (err) {
    console.error('❌ MinIO bucket error:', err);
    throw err;
  }
}

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// File upload endpoint
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    console.log('📁 File upload request received');
    console.log('🔍 Request file info:', req.file);

    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📁 Uploading file to MongoDB:', req.file.originalname);
    console.log('📁 Temp file path:', req.file.path);

    // Upload file to MongoDB
    const fileId = await storage.putFile(
      req.file.path,
      req.file.originalname,
      req.file.mimetype,
      req.user.id
    );
    console.log('✅ File uploaded to MongoDB, ID:', fileId);

    // Generate file URL
    const fileUrl = `/api/files/${fileId}`;

    res.json({
      url: fileUrl,
      filename: req.file.originalname,
      fileId: fileId,
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('❌ File upload error:', error);
    console.error('🔍 Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({
      error: 'File upload failed',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// File download endpoint for MongoDB files
router.get('/:fileId', auth, async (req, res) => {
  try {
    const fileId = req.params.fileId;

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

// File download endpoint (legacy MinIO support)
router.get('/download/:filename', auth, async (req, res) => {
  try {
    if (!minioClient) {
      console.warn('⚠️ MinIO not configured, file download disabled');
      return res.status(503).json({
        error: 'File storage not available',
        details: 'MinIO endpoint not configured'
      });
    }

    const filename = req.params.filename;

    // Generate a presigned URL for the file
    const presignedUrl = await minioClient.presignedGetObject(BUCKET, filename, 24 * 60 * 60); // 24 hours expiry

    res.json({ url: presignedUrl });
  } catch (error) {
    console.error('❌ File download error:', error);
    res.status(500).json({
      error: 'File download failed',
      details: error.message
    });
  }
});

// File list endpoint for MongoDB
router.get('/list', auth, async (req, res) => {
  try {
    console.log('📋 File list request for user:', req.user.id);

    // First, try a simple MongoDB connection test
    try {
      const testResult = await File.findOne({ uploadedBy: req.user.id });
      console.log('📋 MongoDB connection test result:', testResult ? 'Found file' : 'No files found');
    } catch (testError) {
      console.error('❌ MongoDB connection test failed:', testError.message);
      console.error('🔍 Test error stack:', testError.stack);
    }

    // Get files uploaded by the current user from MongoDB
    const files = await File.find({ uploadedBy: req.user.id })
      .sort({ uploadedAt: -1 })
      .limit(100);

    console.log('📋 Found files:', files.length);

    // Format the response to match expected format
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
    console.error('🔍 Error stack:', error.stack);
    console.error('🔍 Error name:', error.name);
    console.error('🔍 Error code:', error.code);
    res.status(500).json({
      error: 'Failed to list files',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// File delete endpoint
router.delete('/delete/:filename', auth, async (req, res) => {
  try {
    if (!minioClient) {
      console.warn('⚠️ MinIO not configured, file delete disabled');
      return res.status(503).json({
        error: 'File storage not available',
        details: 'MinIO endpoint not configured'
      });
    }

    const filename = req.params.filename;
    await minioClient.removeObject(BUCKET, filename);
    res.json({
      message: 'File deleted successfully',
      filename: filename
    });
  } catch (error) {
    console.error('❌ File delete error:', error);
    res.status(500).json({
      error: 'File deletion failed',
      details: error.message
    });
  }
});

// Test MongoDB file storage endpoint
router.get('/test-mongodb', auth, async (req, res) => {
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
    console.error('🔍 Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'MongoDB file storage test failed',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test MinIO connection endpoint (no auth for testing)
router.get('/test-connection', async (req, res) => {
  try {
    if (!minioClient) {
      console.warn('⚠️ MinIO not configured, connection test disabled');
      return res.status(503).json({
        success: false,
        error: 'File storage not available',
        details: 'MinIO endpoint not configured'
      });
    }

    console.log('🧪 Testing MinIO connection...');

    // Test bucket existence
    const bucketExists = await minioClient.bucketExists(BUCKET);
    console.log(`📦 Bucket ${BUCKET} exists: ${bucketExists}`);

    // Test listing buckets
    const buckets = await minioClient.listBuckets();
    console.log('📦 Available buckets:', buckets.map(b => b.name));

    res.json({
      success: true,
      bucketExists,
      buckets: buckets.map(b => b.name),
      message: 'MinIO connection successful'
    });
  } catch (error) {
    console.error('❌ MinIO connection test failed:', error);
    res.status(500).json({
      success: false,
      error: 'MinIO connection failed',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

module.exports = router;
