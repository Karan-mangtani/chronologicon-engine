const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenApiValidator = require('express-openapi-validator');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');
const fs = require('fs');
require('dotenv').config();

// Import database utilities and routes
const db = require('./src/utils/db');
const eventRoutes = require('./src/api/routes/eventRoutes');

const app = express();
const APP_PORT = process.env.APP_PORT || 3000;


// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// API Key authentication middleware
const apiKeyAuth = (req, res, next) => {

    if (process.env.NODE_ENV === 'development') {
        return next();
    }
    // Skip authentication for excluded paths
    const excludedPaths = ['/api-docs', '/health', '/api/openapi.json', '/'];
    const isExcludedPath = excludedPaths.some(path =>
        req.path === path || req.path.startsWith('/api-docs')
    );

    if (isExcludedPath) {
        return next();
    }

    // Check for API key in headers
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    const validApiKey = process.env.API_KEY;

    if (!validApiKey) {
        console.error('API_KEY not configured in environment variables');
        return res.status(500).json({
            error: 'Server Configuration Error',
            message: 'API authentication not properly configured'
        });
    }

    if (!apiKey) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'API key is required. Please provide it in the x-api-key header or Authorization header as Bearer token.'
        });
    }

    if (apiKey !== validApiKey) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid API key provided.'
        });
    }

    // API key is valid, proceed
    next();
};

// Apply API key authentication middleware
app.use(apiKeyAuth);



// Load and parse the OpenAPI specification
let apiSpec;
try {
  const openApiPath = path.join(__dirname, 'openapi.yml');
  const openApiContent = fs.readFileSync(openApiPath, 'utf8');
  apiSpec = yaml.load(openApiContent);
  console.log('OpenAPI specification loaded successfully');
} catch (error) {
  console.error('Failed to load OpenAPI specification:', error.message);
  process.exit(1);
}

// Health check endpoint (not included in OpenAPI spec)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});


// Swagger UI documentation routes
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Chronologicon Engine API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    // Enable authorization UI
    securityDefinitions: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key'
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer'
      }
    }
  }
}));

// Serve OpenAPI spec as JSON endpoint
app.get('/api/openapi.json', (req, res) => {
  res.json(apiSpec);
});

// Root route redirect to documentation
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});


// app.use('/api', 
//   OpenApiValidator.middleware({
//     apiSpec,
//     validateRequests: true,
//     validateResponses: false,
//     formats: {
//       'uuid': /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
//     }
//   })
// );

// =============================================
// Routes Setup
// =============================================

// Mount API routes
app.use('/api', eventRoutes);

// Catch-all route for undefined endpoints
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist`
  });
});



// OpenAPI validation error handler
app.use((err, req, res, next) => {
  if (err.status && err.status >= 400 && err.status < 500) {
    // Client errors (validation, bad request, etc.)
    console.error(`Client error on ${req.method} ${req.path}:`, err.message);
    return res.status(err.status).json({
      error: 'Validation Error',
      message: err.message,
      details: err.errors || null
    });
  }
  
  // Pass other errors to the global error handler
  next(err);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: isDevelopment ? err.message : 'An unexpected error occurred',
    details: isDevelopment ? err.stack : null
  });
});



const startServer = async () => {
  try {
    // Test database connection before starting the server
    await db.testConnection();
    console.log('Database connection verified');
    
    // Start the HTTP server
    const server = app.listen(APP_PORT, () => {
      console.log(`Chronologicon Engine server is running on port ${APP_PORT}`);
    });
    
    // Graceful shutdown handlers
    const gracefulShutdown = async (signal) => {
      console.log(`\n${signal} received. Starting graceful shutdown...`);
      
      server.close(async () => {
        console.log('HTTP server closed');
        
        try {
          await db.closePool();
          console.log('Database connections closed');
          process.exit(0);
        } catch (error) {
          console.error('Error during shutdown:', error);
          process.exit(1);
        }
      });
      
      // Force shutdown after 30 seconds
      setTimeout(() => {
        console.error('Forced shutdown due to timeout');
        process.exit(1);
      }, 30000);
    };
    
    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled rejection at:', promise, 'reason:', reason);
      gracefulShutdown('UNHANDLED_REJECTION');
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

// Export the app for testing purposes
module.exports = app;
