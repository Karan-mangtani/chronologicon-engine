-- Use a transaction to ensure all commands succeed or none do.
BEGIN;

-- Drop existing objects in reverse order of dependency to avoid errors.
DROP TABLE IF EXISTS ingestion_jobs;
DROP TABLE IF EXISTS historical_events;
DROP TYPE IF EXISTS JOB_STATUS;


-- Create a custom ENUM type for job status to ensure data integrity.
-- This restricts the 'status' column to only these specific values.
CREATE TYPE JOB_STATUS AS ENUM (
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED'
);


CREATE TABLE historical_events (
    -- The primary identifier for the event. Using UUID is a good practice for distributed data.
    event_id UUID PRIMARY KEY,

    -- The name or title of the historical event. Cannot be empty.
    event_name VARCHAR(255) NOT NULL,

    -- A detailed description of the event. Can be NULL if not provided.
    description TEXT,

    -- Timestamps are stored with time zone information for accuracy.
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,

    -- Calculated field for quick access to the event's duration in minutes.
    duration_minutes INTEGER NOT NULL,

    parent_event_id UUID ,

    metadata JSONB,

    CONSTRAINT check_end_date_after_start_date CHECK (end_date >= start_date)
);


CREATE TABLE ingestion_jobs (
    -- The primary key for the job.
    job_id UUID PRIMARY KEY,

    -- This critical column tells the worker where to find the data to process.
    -- It could be a local file path (e.g., 'uploads/data.txt') or a cloud storage URI (e.g., 'gs://bucket/data.txt').
    source_location TEXT NOT NULL,

    -- The current status of the job, using our custom ENUM type.
    status JOB_STATUS NOT NULL DEFAULT 'PENDING',

    -- File processing metrics.
    total_lines INTEGER,
    processed_lines INTEGER DEFAULT 0,
    error_lines INTEGER DEFAULT 0,

    -- Stores an array of error messages encountered during ingestion.
    errors JSONB,

    -- Timestamps to track the job's duration.
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,

    -- Timestamp for when the job was created, useful for polling workers.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Indexes on date columns to speed up time-based queries (e.g., search, temporal gaps).
CREATE INDEX idx_events_start_date ON historical_events(start_date);
CREATE INDEX idx_events_end_date ON historical_events(end_date);

-- Index on the parent_event_id for faster traversal of the event hierarchy (e.g., timeline reconstruction).
CREATE INDEX idx_events_parent_id ON historical_events(parent_event_id);

-- Index to help workers efficiently find the next available 'PENDING' job to process.
CREATE INDEX idx_jobs_status_created_at ON ingestion_jobs(status, created_at);

-- Commit the transaction to make the changes permanent.
COMMIT;

-- End of script