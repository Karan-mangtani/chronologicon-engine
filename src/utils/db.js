const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

// Create a connection pool for efficient database connections
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'chronologicon',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 20, // Maximum number of connections in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 2000, // How long to wait when connecting
});

// Test the database connection on startup
const testConnection = async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('Database connection established successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error.message);
    throw error;
  }
};

// =============================================
// Ingestion Job Functions
// =============================================

const createIngestionJob = async (filePath, metadata = {}) => {
  const jobId = uuidv4();
  const query = `
    INSERT INTO ingestion_jobs (job_id, source_location, status, created_at)
    VALUES ($1, $2, 'PENDING', NOW())
    RETURNING job_id, source_location, status, created_at
  `;
  
  try {
    const result = await pool.query(query, [jobId, filePath]);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating ingestion job:', error);
    throw new Error('Failed to create ingestion job');
  }
};

const getJobStatus = async (jobId) => {
  const query = `
    SELECT 
      job_id,
      source_location,
      status,
      total_lines,
      processed_lines,
      error_lines,
      errors,
      start_time,
      end_time,
      created_at
    FROM ingestion_jobs 
    WHERE job_id = $1
  `;
  
  try {
    const result = await pool.query(query, [jobId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting job status:', error);
    throw new Error('Failed to retrieve job status');
  }
};

const findAndLockJob = async () => {
  const query = `
    SELECT 
      job_id,
      source_location,
      status,
      total_lines,
      processed_lines,
      error_lines,
      errors,
      created_at
    FROM ingestion_jobs 
    WHERE status = 'PENDING'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;
  
  try {
    const result = await pool.query(query);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error finding and locking job:', error);
    throw new Error('Failed to find available job');
  }
};

const updateJobProgress = async (jobId, { processed, errors, totalLines = null }) => {
  let query;
  let params;
  
  // Ensure errors is an array and stringify it for database storage
  const errorsArray = Array.isArray(errors) ? errors : [];
  const errorsJson = JSON.stringify(errorsArray);
  
  console.log(`DEBUG updateJobProgress: jobId=${jobId}, processed=${processed}, errors=${JSON.stringify(errors)}, errorsArray.length=${errorsArray.length}`);
  
  if (totalLines !== null) {
    query = `
      UPDATE ingestion_jobs 
      SET 
        processed_lines = $2,
        error_lines = $3,
        errors = $4,
        total_lines = $5
      WHERE job_id = $1
    `;
    params = [jobId, processed, errorsArray.length, errorsJson, totalLines];
  } else {
    query = `
      UPDATE ingestion_jobs 
      SET 
        processed_lines = $2,
        error_lines = $3,
        errors = $4
      WHERE job_id = $1
    `;
    params = [jobId, processed, errorsArray.length, errorsJson];
  }
  
  try {
    console.log(`Updating job ${jobId}: processed=${processed}, errors=${errorsArray.length}, total=${totalLines}`);
    console.log(`DEBUG SQL params:`, params);
    await pool.query(query, params);
  } catch (error) {
    console.error('Error updating job progress:', error);
    throw new Error('Failed to update job progress');
  }
};

const setJobStatus = async (jobId, status, errors = []) => {
  const query = `
    UPDATE ingestion_jobs 
    SET 
      status = $2,
      ${status === 'PROCESSING' ? 'start_time = NOW()' : ''}
      ${status === 'COMPLETED' || status === 'FAILED' ? 'end_time = NOW()' : ''}
      ${ errors?.length > 0 ? ',errors = $3' : ''}
    WHERE job_id = $1
  `;
  
  try {
    console.log('....query',query)
    const params = [jobId, status];
    if (errors?.length > 0) {
      params.push(JSON.stringify(errors));
    }
    await pool.query(query, params);
  } catch (error) {
    console.error('Error setting job status:', error);
    throw new Error('Failed to update job status');
  }
};



const batchInsertEvents = async (events) => {
  if (!events || events.length === 0) return;

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const query = `
      INSERT INTO historical_events (
        event_id, event_name, description, start_date, end_date, 
        duration_minutes, parent_event_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    
    for (const event of events) {
      const {
        eventId = uuidv4(),
        eventName,
        description,
        startDate,
        endDate,
        durationMinutes,
        parentEventId,
        metadata
      } = event;
      
      await client.query(query, [
        eventId,
        eventName,
        description,
        startDate,
        endDate,
        durationMinutes,
        parentEventId,
        metadata ? JSON.stringify(metadata) : null
      ]);
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error batch inserting events:', error);
    throw new Error(error?.message || 'Failed to insert events');
  } finally {
    client.release();
  }
};

const getTimelineByRootId = async (rootEventId) => {
  const query = `
    WITH RECURSIVE event_hierarchy AS (
      -- Base case: start with the root event
      SELECT 
        event_id,
        event_name,
        description,
        start_date,
        end_date,
        duration_minutes,
        parent_event_id,
        metadata,
        0 as level,
        ARRAY[start_date] as path
      FROM historical_events 
      WHERE event_id = $1
      
      UNION ALL
      
      -- Recursive case: find children of events in the hierarchy
      SELECT 
        he.event_id,
        he.event_name,
        he.description,
        he.start_date,
        he.end_date,
        he.duration_minutes,
        he.parent_event_id,
        he.metadata,
        eh.level + 1,
        eh.path || he.start_date
      FROM historical_events he
      INNER JOIN event_hierarchy eh ON he.parent_event_id = eh.event_id
    )
    SELECT * FROM event_hierarchy 
    ORDER BY level, start_date
  `;
  
  try {
    const result = await pool.query(query, [rootEventId]);
    return result.rows;
  } catch (error) {
    console.error('Error getting timeline:', error);
    throw new Error('Failed to retrieve timeline');
  }
};

const searchEvents = async (params) => {
  const {
    name,
    startDate,
    endDate,
    sortBy = 'start_date',
    sortOrder = 'asc',
    page = 1,
    limit = 20
  } = params;
  
  let whereConditions = [];
  let queryParams = [];
  let paramIndex = 1;
  
  if (name) {
    whereConditions.push(`event_name ILIKE $${paramIndex}`);
    queryParams.push(`%${name}%`);
    paramIndex++;
  }
  
  if (startDate) {
    whereConditions.push(`start_date >= $${paramIndex}`);
    queryParams.push(startDate);
    paramIndex++;
  }
  
  if (endDate) {
    whereConditions.push(`end_date <= $${paramIndex}`);
    queryParams.push(endDate);
    paramIndex++;
  }
  
  const whereClause = whereConditions.length > 0 
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';
  
  const offset = (page - 1) * limit;
  
  // Count total results
  const countQuery = `
    SELECT COUNT(*) as total
    FROM historical_events
    ${whereClause}
  `;
  
  // Get paginated results
  const dataQuery = `
    SELECT 
      event_id,
      event_name,
      description,
      start_date,
      end_date,
      duration_minutes,
      parent_event_id,
      metadata
    FROM historical_events
    ${whereClause}
    ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  
  try {
    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, queryParams),
      pool.query(dataQuery, [...queryParams, limit, offset])
    ]);
    
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);
    
    return {
      events: dataResult.rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: total,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    };
  } catch (error) {
    console.error('Error searching events:', error);
    throw new Error('Failed to search events');
  }
};



const findOverlappingEvents = async (startDate, endDate) => {
  const query = `
    SELECT 
      e1.event_id as event1_id,
      e1.event_name as event1_name,
      e1.start_date as event1_start,
      e1.end_date as event1_end,
      e2.event_id as event2_id,
      e2.event_name as event2_name,
      e2.start_date as event2_start,
      e2.end_date as event2_end,
      GREATEST(e1.start_date, e2.start_date) as overlap_start,
      LEAST(e1.end_date, e2.end_date) as overlap_end
    FROM historical_events e1
    INNER JOIN historical_events e2 ON e1.event_id < e2.event_id
    WHERE 
      e1.start_date >= $1 AND e1.end_date <= $2
      AND e2.start_date >= $1 AND e2.end_date <= $2
      AND e1.start_date <= e2.end_date 
      AND e1.end_date >= e2.start_date
    ORDER BY overlap_start
  `;
  
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows;
  } catch (error) {
    console.error('Error finding overlapping events:', error);
    throw new Error('Failed to find overlapping events');
  }
};

const findLargestTemporalGap = async (startDate, endDate) => {
  const query = `
    WITH event_gaps AS (
      SELECT 
        event_id,
        event_name,
        start_date,
        end_date,
        LAG(end_date) OVER (ORDER BY start_date) as prev_end_date,
        LEAD(start_date) OVER (ORDER BY start_date) as next_start_date
      FROM historical_events
      WHERE start_date >= $1 AND end_date <= $2
      ORDER BY start_date
    ),
    calculated_gaps AS (
      SELECT 
        event_id,
        event_name,
        start_date,
        end_date,
        prev_end_date,
        CASE 
          WHEN prev_end_date IS NOT NULL AND start_date > prev_end_date
          THEN EXTRACT(EPOCH FROM (start_date - prev_end_date)) / 60
          ELSE 0
        END as gap_minutes,
        CASE 
          WHEN prev_end_date IS NOT NULL AND start_date > prev_end_date
          THEN prev_end_date
          ELSE NULL
        END as gap_start,
        CASE 
          WHEN prev_end_date IS NOT NULL AND start_date > prev_end_date
          THEN start_date
          ELSE NULL
        END as gap_end
      FROM event_gaps
    )
    SELECT 
      gap_start,
      gap_end,
      gap_minutes,
      LAG(event_id) OVER (ORDER BY start_date) as preceding_event_id,
      LAG(event_name) OVER (ORDER BY start_date) as preceding_event_name,
      event_id as following_event_id,
      event_name as following_event_name
    FROM calculated_gaps
    WHERE gap_minutes > 0
    ORDER BY gap_minutes DESC
  `;
  
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows;
  } catch (error) {
    console.error('Error finding temporal gaps:', error);
    throw new Error('Failed to find temporal gaps');
  }
};

const findShortestInfluencePath = async (sourceId, targetId) => {
  const query = `
    WITH RECURSIVE influence_path AS (
      -- Base case: start from source event
      SELECT 
        event_id,
        event_name,
        parent_event_id,
        1 as path_length,
        ARRAY[event_id::text] as path_ids,
        ARRAY[event_name::text] as path_names
      FROM historical_events 
      WHERE event_id = $1
      
      UNION ALL
      
      -- Recursive case: follow parent-child relationships
      SELECT 
        he.event_id,
        he.event_name,
        he.parent_event_id,
        ip.path_length + 1,
        ip.path_ids || he.event_id::text,
        ip.path_names || he.event_name::text
      FROM historical_events he
      INNER JOIN influence_path ip ON (
        he.parent_event_id = ip.event_id OR 
        he.event_id = ip.parent_event_id
      )
      WHERE 
        he.event_id::text <> ALL(ip.path_ids) -- Prevent cycles
        AND ip.path_length < 10 -- Prevent infinite recursion
    )
    SELECT 
      path_length,
      path_ids,
      path_names
    FROM influence_path 
    WHERE event_id = $2
    ORDER BY path_length ASC
    LIMIT 1
  `;
  
  try {
    const result = await pool.query(query, [sourceId, targetId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error finding influence path:', error);
    throw new Error('Failed to find influence path');
  }
};

/**
 * Get event details by ID
 */
const getEventById = async (eventId) => {
  const query = `
    SELECT 
      event_id,
      event_name,
      description,
      start_date,
      end_date,
      duration_minutes,
      parent_event_id,
      metadata
    FROM historical_events 
    WHERE event_id = $1
  `;
  
  try {
    const result = await pool.query(query, [eventId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting event by ID:', error);
    throw new Error('Failed to retrieve event details');
  }
};

// =============================================
// Utility Functions
// =============================================

const closePool = async () => {
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch (error) {
    console.error('Error closing database pool:', error);
  }
};

// Export all functions
module.exports = {
  // Connection management
  testConnection,
  closePool,
  
  // Ingestion job functions
  createIngestionJob,
  getJobStatus,
  findAndLockJob,
  updateJobProgress,
  setJobStatus,
  
  // Event management functions
  batchInsertEvents,
  getTimelineByRootId,
  searchEvents,
  getEventById,
  
  // Insights functions
  findOverlappingEvents,
  findLargestTemporalGap,
  findShortestInfluencePath
};
