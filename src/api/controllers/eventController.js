const eventService = require('../services/eventService');

/**
 * POST /api/events/ingest
 * Initiates file ingestion from uploaded file
 */
const ingestFile = async (req, res, next) => {
  const fs = require('fs').promises;
  const path = require('path');
  let tempFilePath = null;
  
  try {
    // Check if file was uploaded
    if (!req.file) {
      const error = new Error('No file uploaded. Please provide a file in the "file" field.');
      error.status = 400;
      return next(error);
    }
    
    // Since we're using memory storage, write the buffer to a temporary file
    const uploadDir = path.join(__dirname, '../../../uploads/');
    await fs.mkdir(uploadDir, { recursive: true });
    
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    tempFilePath = path.join(uploadDir, `temp-${uniqueSuffix}-${req.file.originalname}`);
    
    await fs.writeFile(tempFilePath, req.file.buffer);
    
    const description = req.body.description || null;
    const originalName = req.file.originalname;
    
    console.log(`File uploaded: ${originalName} -> ${tempFilePath} (${req.file.size} bytes)`);
    
    const result = await eventService.initiateFileIngestion(tempFilePath, {
      originalName,
      description,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });
    
    // Return 202 Accepted with job ID
    res.status(202).json(result);
  } catch (error) {
    // Clean up temporary file if there's an error
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
        console.log(` Cleaned up temporary file: ${tempFilePath}`);
      } catch (cleanupError) {
        console.error(`Error cleaning up temporary file: ${cleanupError.message}`);
      }
    }
    next(error);
  }
};

/**
 * GET /api/events/ingestion-status/:jobId
 * Gets ingestion job status
 */
const getIngestionStatus = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    
    const status = await eventService.getIngestionJobStatus(jobId);
    
    res.status(200).json(status);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/timeline/:rootEventId
 * Gets hierarchical timeline for an event
 */
const getTimeline = async (req, res, next) => {
  try {
    const { rootEventId } = req.params;
    
    const timeline = await eventService.getEventTimeline(rootEventId);
    
    res.status(200).json(timeline);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/events/search
 * Searches events with filters
 */
const searchEvents = async (req, res, next) => {
  try {
    const searchParams = {
      name: req.query.name,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder,
      page: req.query.page,
      limit: req.query.limit
    };
    
    const result = await eventService.searchEvents(searchParams);
    
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/insights/overlapping-events
 * Finds overlapping events
 */
const getOverlappingEvents = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      const error = new Error('Both startDate and endDate are required');
      error.status = 400;
      return next(error);
    }
    
    const result = await eventService.findOverlappingEvents(startDate, endDate);
    
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/insights/temporal-gaps
 * Finds temporal gaps between events
 */
const getTemporalGaps = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      const error = new Error('Both startDate and endDate are required');
      error.status = 400;
      return next(error);
    }
    
    const result = await eventService.findTemporalGaps(startDate, endDate);
    
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/insights/event-influence
 * Finds influence path between events
 */
const getEventInfluence = async (req, res, next) => {
  try {
    const { sourceEventId, targetEventId } = req.query;
    
    if (!sourceEventId || !targetEventId) {
      const error = new Error('Both sourceEventId and targetEventId are required');
      error.status = 400;
      return next(error);
    }
    
    const result = await eventService.findEventInfluencePath(sourceEventId, targetEventId);
    
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  ingestFile,
  getIngestionStatus,
  getTimeline,
  searchEvents,
  getOverlappingEvents,
  getTemporalGaps,
  getEventInfluence
};
