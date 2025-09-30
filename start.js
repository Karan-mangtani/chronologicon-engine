#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Load environment variables first
require('dotenv').config();

console.log('Starting Chronologicon Engine...');
console.log('Server and Worker will start in parallel');

// Start the server process
const server = spawn('node', ['server.js'], {
  cwd: __dirname,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, PROCESS_TYPE: 'SERVER' }
});

// Start the worker process
const worker = spawn('node', ['worker.js'], {
  cwd: __dirname,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, PROCESS_TYPE: 'WORKER' }
});

// Prefix output with process type
const prefixOutput = (process, prefix, stream) => {
  process[stream].on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    lines.forEach(line => {
      console.log(`[${prefix}] ${line}`);
    });
  });
};

// Setup output prefixing
prefixOutput(server, 'SERVER', 'stdout');
prefixOutput(server, 'SERVER', 'stderr');
prefixOutput(worker, 'WORKER', 'stdout');
prefixOutput(worker, 'WORKER', 'stderr');

// Handle process exits
server.on('close', (code) => {
  console.log(`[SERVER] Process exited with code ${code}`);
  if (code !== 0) {
    console.log(' Server crashed, stopping worker...');
    worker.kill('SIGTERM');
  }
});

worker.on('close', (code) => {
  console.log(`[WORKER] Process exited with code ${code}`);
  if (code !== 0) {
    console.log(' Worker crashed, stopping server...');
    server.kill('SIGTERM');
  }
});

// Handle shutdown signals
const shutdown = (signal) => {
  console.log(`\n Received ${signal}, shutting down...`);
  
  server.kill('SIGTERM');
  worker.kill('SIGTERM');
  
  // Force kill after 10 seconds
  setTimeout(() => {
    console.log('Force killing processes...');
    server.kill('SIGKILL');
    worker.kill('SIGKILL');
    process.exit(1);
  }, 10000);
  
  // Wait for both processes to exit
  let serverExited = false;
  let workerExited = false;
  
  const checkExit = () => {
    if (serverExited && workerExited) {
      console.log('All processes stopped cleanly');
      process.exit(0);
    }
  };
  
  server.on('close', () => {
    serverExited = true;
    checkExit();
  });
  
  worker.on('close', () => {
    workerExited = true;
    checkExit();
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(' Both processes started successfully');
