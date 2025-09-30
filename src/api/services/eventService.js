const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../../utils/db');

/**
 * Initiates file ingestion by creating a job
 */
const initiateFileIngestion = async (filePath, metadata = {}) => {
  // Validate file path
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Valid file path is required');
  }
  
  // Check if file exists and is readable
  try {
    await fs.access(filePath, fs.constants.R_OK);
  } catch (error) {
    throw new Error(`File not accessible: ${filePath}`);
  }
  
  // Create ingestion job in database with metadata
  const job = await db.createIngestionJob(filePath, metadata);
  return {
    jobId: job.job_id,
    message: 'Ingestion job created successfully',
    originalFileName: metadata.originalName || path.basename(filePath),
    fileSize: metadata.fileSize
  };
};

/**
 * Gets the status of an ingestion job
 */
const getIngestionJobStatus = async (jobId) => {
  const job = await db.getJobStatus(jobId);
  
  if (!job) {
    const error = new Error('Job not found');
    error.status = 404;
    throw error;
  }
  
  // Handle errors field safely - it could be string, array, or null
  let parsedErrors = [];
  if (job.errors) {
    try {
      if (typeof job.errors === 'string') {
        const trimmedErrors = job.errors.trim();
        parsedErrors = trimmedErrors ? JSON.parse(trimmedErrors) : [];
      } else if (Array.isArray(job.errors)) {
        parsedErrors = job.errors;
      } else {
        parsedErrors = [job.errors]; // Single error object
      }
    } catch (parseError) {
      console.error('Error parsing job errors:', parseError);
      parsedErrors = [`Error parsing errors: ${job.errors}`];
    }
  }

  return {
    jobId: job.job_id,
    status: job.status,
    sourceLocation: job.source_location,
    totalLines: job.total_lines,
    processedLines: job.processed_lines || 0,
    errorLines: job.error_lines || 0,
    errors: parsedErrors,
    startTime: job.start_time,
    endTime: job.end_time,
    createdAt: job.created_at
  };
};

/**
 * Gets a hierarchical timeline for a root event
 */
const getEventTimeline = async (rootEventId) => {
  const flatEvents = await db.getTimelineByRootId(rootEventId);
  
  if (!flatEvents || flatEvents.length === 0) {
    const error = new Error('Event not found');
    error.status = 404;
    throw error;
  }
  
  // Transform flat data into nested structure
  const eventMap = new Map();
  
  // First pass: create all event objects
  flatEvents.forEach(event => {
    eventMap.set(event.event_id, {
      eventId: event.event_id,
      eventName: event.event_name,
      description: event.description,
      startDate: event.start_date,
      endDate: event.end_date,
      durationMinutes: event.duration_minutes,
      parentEventId: event.parent_event_id,
      metadata: event.metadata,
      children: []
    });
  });
  
  // Second pass: build the hierarchy
  let rootEvent = null;
  eventMap.forEach(event => {
    if (event.parentEventId && eventMap.has(event.parentEventId)) {
      const parent = eventMap.get(event.parentEventId);
      parent.children.push(event);
    } else if (event.eventId === rootEventId) {
      rootEvent = event;
    }
  });
  
  return rootEvent;
};

/**
 * Searches events with various filters
 */
const searchEvents = async (searchParams) => {
  // Validate pagination parameters
  const page = Math.max(1, parseInt(searchParams.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.limit) || 20));
  
  // Validate sort parameters
  const validSortFields = ['start_date', 'end_date', 'event_name', 'duration_minutes'];
  const sortBy = validSortFields.includes(searchParams.sortBy) ? searchParams.sortBy : 'start_date';
  const sortOrder = ['asc', 'desc'].includes(searchParams.sortOrder) ? searchParams.sortOrder : 'asc';
  
  const searchOptions = {
    name: searchParams.name,
    startDate: searchParams.startDate,
    endDate: searchParams.endDate,
    sortBy,
    sortOrder,
    page,
    limit
  };
  
  const result = await db.searchEvents(searchOptions);
  
  // Format events for response
  result.events = result.events.map(event => ({
    eventId: event.event_id,
    eventName: event.event_name,
    description: event.description,
    startDate: event.start_date,
    endDate: event.end_date,
    durationMinutes: event.duration_minutes,
    parentEventId: event.parent_event_id,
    metadata: event.metadata
  }));
  
  return result;
};

/**
 * Finds overlapping events within a date range
 */
const findOverlappingEvents = async (startDate, endDate) => {
  // Validate date range
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    const error = new Error('Invalid date format. Use ISO 8601 format.');
    error.status = 400;
    throw error;
  }
  
  if (start >= end) {
    const error = new Error('Start date must be before end date');
    error.status = 400;
    throw error;
  }
  
  const overlaps = await db.findOverlappingEvents(startDate, endDate);
  
  // Group overlapping events
  const overlappingGroups = [];
  const processedPairs = new Set();
  
  overlaps.forEach(overlap => {
    const pairKey = `${overlap.event1_id}-${overlap.event2_id}`;
    if (!processedPairs.has(pairKey)) {
      processedPairs.add(pairKey);
      
      overlappingGroups.push({
        events: [
          {
            eventId: overlap.event1_id,
            eventName: overlap.event1_name,
            startDate: overlap.event1_start,
            endDate: overlap.event1_end
          },
          {
            eventId: overlap.event2_id,
            eventName: overlap.event2_name,
            startDate: overlap.event2_start,
            endDate: overlap.event2_end
          }
        ],
        overlapStart: overlap.overlap_start,
        overlapEnd: overlap.overlap_end
      });
    }
  });
  
  return { overlappingGroups };
};

/**
 * Finds temporal gaps between events
 */
const findTemporalGaps = async (startDate, endDate) => {
  // Validate date range
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    const error = new Error('Invalid date format. Use ISO 8601 format.');
    error.status = 400;
    throw error;
  }
  
  if (start >= end) {
    const error = new Error('Start date must be before end date');
    error.status = 400;
    throw error;
  }
  
  const gaps = await db.findLargestTemporalGap(startDate, endDate);
  
  if (!gaps || gaps.length === 0) {
    return {
      largestGap: null,
      allGaps: []
    };
  }
  
  // Format the gaps
  const formattedGaps = gaps.map(gap => ({
    gapStart: gap.gap_start,
    gapEnd: gap.gap_end,
    gapDurationMinutes: Math.round(gap.gap_minutes),
    precedingEvent: gap.preceding_event_id ? {
      eventId: gap.preceding_event_id,
      eventName: gap.preceding_event_name
    } : null,
    followingEvent: {
      eventId: gap.following_event_id,
      eventName: gap.following_event_name
    }
  }));
  
  return {
    largestGap: formattedGaps[0] || null,
    allGaps: formattedGaps
  };
};

/**
 * Finds the shortest influence path between two events
 */
const findEventInfluencePath = async (sourceEventId, targetEventId) => {
  if (!sourceEventId || !targetEventId) {
    const error = new Error('Both source and target event IDs are required');
    error.status = 400;
    throw error;
  }
  
  if (sourceEventId === targetEventId) {
    const error = new Error('Source and target events cannot be the same');
    error.status = 400;
    throw error;
  }
  
  const pathResult = await db.findShortestInfluencePath(sourceEventId, targetEventId);
  
  if (!pathResult) {
    const error = new Error('No influence path found between the specified events');
    error.status = 404;
    throw error;
  }
  
  // Get full event details for each event in the path
  const shortestPath = [];
  let totalDurationMinutes = 0;
  
  for (const eventId of pathResult.path_ids) {
    try {
      const eventDetails = await db.getEventById(eventId);
      if (eventDetails) {
        const eventData = {
          event_id: eventDetails.event_id,
          event_name: eventDetails.event_name,
          duration_minutes: eventDetails.duration_minutes || 0
        };
        shortestPath.push(eventData);
        totalDurationMinutes += eventDetails.duration_minutes || 0;
      }
    } catch (error) {
      console.error(`Error fetching event details for ${eventId}:`, error);
      // Add basic info if detailed query fails
      const eventIndex = pathResult.path_ids.indexOf(eventId);
      shortestPath.push({
        event_id: eventId,
        event_name: pathResult.path_names[eventIndex] || 'Unknown Event',
        duration_minutes: 0
      });
    }
  }
  
  return {
    sourceEventId,
    targetEventId,
    shortestPath,
    totalDurationMinutes,
    message: "Shortest temporal path found from source to target event."
  };
};

/**
 * Processes an ingestion job (called by worker)
 */
const processIngestionJob = async (job) => {
  const jobId = job.job_id;
  const filePath = job.source_location;
  
  console.log(`Processing ingestion job ${jobId} for file: ${filePath}`);
  
  try {
    // Read the file content
    const fileContent = await fs.readFile(filePath, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    
    await db.updateJobProgress(jobId, {
      processed: 0,
      errors: [],
      totalLines: lines.length - 1
    });
    
    // Detect delimiter for non-JSON files
    const delimiter = detectDelimiter(lines);
    
    const events = [];
    let errors = [];
    let processedCount = 0;
    let isFirstLine = true;
    
    // Process each line
    for (let i = 0; i < lines.length; i++) {
      try {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Skip header line if it contains common header keywords
        if (isFirstLine && (line.toLowerCase().includes('eventid') || line.toLowerCase().includes('event_id') || line.toLowerCase().includes('eventname'))) {
          console.log(`Skipping header line: ${line}`);
          isFirstLine = false;
          continue;
        }
        isFirstLine = false;
        
        // Parse line as JSON (expecting structured event data)
        let eventData;
        try {
          eventData = JSON.parse(line);
        } catch (parseError) {
          // If not JSON, try to parse as CSV or other format
          eventData = parseEventLine(line, i + 1, delimiter);
        }
        
        // Validate required fields
        const validatedEvent = validateAndTransformEvent(eventData, i + 1);
        // events.push(validatedEvent);
        
        
        // Batch insert every 100 events
        // if (events.length >= 100) {
          await db.batchInsertEvents([validatedEvent]);
          // events.length = 0; // Clear the array
            processedCount++;
          // Update progress
          await db.updateJobProgress(jobId, {
            processed: processedCount,
            errors
          });
        // }
        
      } catch (error) {
        errors.push(`Line ${i + 1}: ${error.message}`);
        console.error(`Error processing line ${i + 1}:`, error.message);
        console.log(`DEBUG: errors array now has ${errors.length} items:`, errors);
      }
    }
    
    // Insert remaining events
    if (events.length > 0) {
      await db.batchInsertEvents(events);
    }
    
    // Final progress update
    console.log(` DEBUG: Final update - errors array:`, errors);
    await db.updateJobProgress(jobId, {
      processed: processedCount,
      errors
    });
    
    console.log(`Job ${jobId} completed. Processed: ${processedCount}, Errors: ${errors.length}`);
    
    // Clean up the uploaded file after successful processing
    try {
      await fs.unlink(filePath);
      console.log(` Cleaned up processed file: ${filePath}`);
    } catch (cleanupError) {
      console.error(`Warning: Could not clean up file ${filePath}:`, cleanupError.message);
    }
    
  } catch (error) {
    console.error(`Fatal error processing job ${jobId}:`, error);
    
    // Still try to clean up the file even if processing failed
    try {
      await fs.unlink(filePath);
      console.log(`Cleaned up failed file: ${filePath}`);
    } catch (cleanupError) {
      console.error(`Warning: Could not clean up file ${filePath}:`, cleanupError.message);
    }
    
    throw error;
  }
};

/**
 * Detects delimiter in CSV-like files
 */
const detectDelimiter = (lines) => {
  const delimiters = [',', '|', '\t', ';'];
  const testLine = lines.find(line => line.trim() && !line.startsWith('#')) || lines[0];
  
  if (!testLine) return ',';
  
  let bestDelimiter = ',';
  let maxFields = 0;
  
  for (const delimiter of delimiters) {
    const fields = testLine.split(delimiter);
    if (fields.length > maxFields) {
      maxFields = fields.length;
      bestDelimiter = delimiter;
    }
  }
  
  return bestDelimiter;
};

/**
 * Parses a non-JSON event line (e.g., CSV format) with auto-detected delimiter
 */
const parseEventLine = (line, lineNumber, delimiter = ',') => {
  // Support various formats: CSV, pipe-delimited, tab-separated
  const parts = line.split(delimiter).map(part => part.replace(/^"|"$/g, '').trim());
  
  if (parts.length < 4) {
    throw new Error(`Invalid format. Expected at least 4 fields, got ${parts.length}`);
  }
  
  // Support different column orders - try to detect based on header or content
  // Format: eventId|eventName|startDate|endDate|parentId|researchValue|description
  if (parts.length >= 7) {
    return {
      eventId: parts[0],
      eventName: parts[1],
      description: parts[6] || null,
      startDate: parts[2],
      endDate: parts[3],
      parentId: parts[4] && parts[4] !== 'NULL' ? parts[4] : null,
      metadata: parts[5] ? { researchValue: parseInt(parts[5]) || 0 } : {}
    };
  }
  
  // Fallback to original format: eventName|description|startDate|endDate
  return {
    eventName: parts[0],
    description: parts[1] || null,
    startDate: parts[2],
    endDate: parts[3],
    parentEventId: parts[4] || null,
    metadata: parts[5] ? JSON.parse(parts[5]) : null
  };
};

/**
 * Validates and transforms event data
 */
const validateAndTransformEvent = (eventData, lineNumber) => {
  if (!eventData.eventName || typeof eventData.eventName !== 'string') {
    throw new Error('Event name is required and must be a string');
  }
  
  if (!eventData.startDate || !eventData.endDate) {
    throw new Error('Start date and end date are required');
  }
  
  const startDate = new Date(eventData.startDate);
  const endDate = new Date(eventData.endDate);
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid date format. Use ISO 8601 format.');
  }
  
  if (startDate >= endDate) {
    throw new Error('Start date must be before end date');
  }
  
  const durationMinutes = Math.ceil((endDate - startDate) / (1000 * 60));
  
  return {
    eventId: eventData.eventId,
    eventName: eventData.eventName.trim(),
    description: eventData.description ? eventData.description.trim() : null,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    durationMinutes,
    parentEventId: eventData.parentId || null,
    metadata: eventData.metadata || null
  };
};

module.exports = {
  initiateFileIngestion,
  getIngestionJobStatus,
  getEventTimeline,
  searchEvents,
  findOverlappingEvents,
  findTemporalGaps,
  findEventInfluencePath,
  processIngestionJob
};
