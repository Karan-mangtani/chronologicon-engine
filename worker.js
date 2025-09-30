const db = require('./src/utils/db');
const eventService = require('./src/api/services/eventService');
require('dotenv').config();


const POLLING_INTERVAL = parseInt(process.env.WORKER_POLLING_INTERVAL) || 5000; // 5 seconds
const MAX_RETRIES = parseInt(process.env.WORKER_MAX_RETRIES) || 3;

console.log('Starting Chronologicon Engine Worker...');


/**
 * Main worker loop - continuously polls for and processes jobs
 */
const workerLoop = async () => {
  let isShuttingDown = false;
  
  const processNextJob = async () => {
    try {
      // Find and lock the next available job
      const job = await db.findAndLockJob();
      
      if (!job) {
        // No jobs available, wait before polling again
        return false;
      }
      
      console.log(` Found job ${job.job_id} for file: ${job.source_location}`);
      
      // Update job status to PROCESSING
      await db.setJobStatus(job.job_id, 'PROCESSING');
      console.log(`Started processing job ${job.job_id}`);
      
      try {
        // Process the ingestion job
        await eventService.processIngestionJob(job);
        
        // Mark job as completed
        await db.setJobStatus(job.job_id, 'COMPLETED');
        console.log(` Job ${job.job_id} completed successfully`);
        
      } catch (processingError) {
        console.error(` Job ${job.job_id} failed:`, processingError.message);
        
        // Mark job as failed with error details
        await db.setJobStatus(job.job_id, 'FAILED', [processingError.message]);
      }
      
      return true;
      
    } catch (error) {
      console.error('💥 Error in job processing cycle:', error.message);
      return false;
    }
  };
  
  // Main worker loop
  while (!isShuttingDown) {
    try {
      const jobProcessed = await processNextJob();
      
      if (!jobProcessed) {
        // No job was processed, wait before polling again
        await sleep(POLLING_INTERVAL);
      }
      // If a job was processed, immediately check for another one
      
    } catch (error) {
      console.error('Fatal error in worker loop:', error);
      
      // Wait longer after fatal errors to prevent spam
      await sleep(POLLING_INTERVAL * 2);
    }
  }
  
  console.log(' Worker loop stopped');
};

/**
 * Sleep utility function
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Graceful shutdown handler
 */
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting worker shutdown...`);
  
  try {
    // Close database connections
    await db.closePool();
    console.log('Database connections closed');
    
    console.log('Worker shutdown completed');
    process.exit(0);
    
  } catch (error) {
    console.error('Error during worker shutdown:', error);
    process.exit(1);
  }
};

/**
 * Worker startup sequence
 */
const startWorker = async () => {
  try {
    // Test database connection
    await db.testConnection();
    console.log(' Database connection verified');
    
    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception in worker:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error(' Unhandled rejection in worker at:', promise, 'reason:', reason);
      gracefulShutdown('UNHANDLED_REJECTION');
    });
    
    console.log(' Worker started successfully');

    
    // Start the main worker loop
    await workerLoop();
    
  } catch (error) {
    console.error('Failed to start worker:', error);
    process.exit(1);
  }
};

// Start the worker
startWorker();
