const express = require('express');
const multer = require('multer');
const path = require('path');
const eventController = require('../controllers/eventController');

const router = express.Router();

// Configure multer for file uploads - using memory storage for testing
const storage = multer.memoryStorage();

// File filter to accept only specific file types
const fileFilter = (req, file, cb) => {
  console.log(`Checking file: ${file.originalname}, mimetype: ${file.mimetype}`);
  const allowedTypes = ['.json', '.jsonl', '.csv', '.txt'];
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(fileExtension)) {
    console.log(`File type ${fileExtension} accepted`);
    cb(null, true);
  } else {
    console.log(`File type ${fileExtension} rejected`);
    cb(new Error(`File type ${fileExtension} not supported. Allowed types: ${allowedTypes.join(', ')}`), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: fileFilter
});

// Simple upload handler with better error handling
const handleFileUpload = (req, res, next) => {
  console.log(` Starting file upload...`);
  
  const uploadSingle = upload.single('file');
  
  uploadSingle(req, res, function(err) {
    if (err) {
      console.log(`Upload error:`, err.message);
      
      // Handle specific multer errors
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            return res.status(400).json({
              success: false,
              message: 'File too large. Maximum size is 10MB.',
              error: 'FILE_TOO_LARGE'
            });
          case 'LIMIT_UNEXPECTED_FILE':
            return res.status(400).json({
              success: false,
              message: 'Unexpected file field. Use "file" field name.',
              error: 'UNEXPECTED_FIELD'
            });
        }
      }
      
      // Handle "Unexpected end of form" specifically
      if (err.message.includes('Unexpected end of form')) {
        return res.status(400).json({
          success: false,
          message: 'File upload was interrupted or malformed. Please try again.',
          error: 'UPLOAD_INTERRUPTED'
        });
      }
      
      // Generic error handling
      return res.status(400).json({
        success: false,
        message: 'Upload failed: ' + err.message,
        error: 'UPLOAD_ERROR'
      });
    }
    
    console.log(`File upload completed successfully`);
    next();
  });
};

// File ingestion endpoints
router.post('/events/ingest', handleFileUpload, eventController.ingestFile);


router.get('/events/ingestion-status/:jobId', eventController.getIngestionStatus);

// Event query endpoints
router.get('/timeline/:rootEventId', eventController.getTimeline);
router.get('/events/search', eventController.searchEvents);

// Insights endpoints
router.get('/insights/overlapping-events', eventController.getOverlappingEvents);
router.get('/insights/temporal-gaps', eventController.getTemporalGaps);
router.get('/insights/event-influence', eventController.getEventInfluence);

module.exports = router;
