# Chronologicon Engine

A production-ready Node.js Express application for managing historical events with asynchronous file ingestion capabilities. The application provides a RESTful API for storing, querying, and analyzing historical events with support for hierarchical relationships and temporal insights.

## Features

- **Asynchronous File Ingestion**: Process large historical event files in the background
- **Hierarchical Event Structure**: Support for parent-child relationships between events
- **Temporal Analysis**: Find overlapping events, temporal gaps, and influence paths
- **Advanced Search**: Search and filter events with pagination and sorting
- **OpenAPI Integration**: Automatic request validation using OpenAPI 3.0 specification
- **Production Ready**: Includes error handling, logging, graceful shutdown, and connection pooling

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Client    │───▶│  Express Server │───▶│   PostgreSQL    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │  Worker Process │
                        └─────────────────┘
```

### Components

- **Express Server** (`server.js`): Main HTTP server with OpenAPI validation
- **Worker Process** (`worker.js`): Background job processor for file ingestion
- **Controllers**: Handle HTTP requests/responses
- **Services**: Contain business logic
- **Database Utils**: PostgreSQL interaction layer
- **Routes**: API endpoint definitions

## Project Structure

```
chronologicon-engine/
├── src/
│   ├── api/
│   │   ├── controllers/
│   │   │   └── eventController.js
│   │   ├── services/
│   │   │   └── eventService.js
│   │   └── routes/
│   │       └── eventRoutes.js
│   └── utils/
│       └── db.js
├── sample-data/
│   └── historical_events.jsonl
├── openapi.yml
├── setup.sql
├── server.js
├── worker.js
├── package.json
└── .env.example
```

## Quick Start

### Prerequisites

- Node.js 16+ 
- PostgreSQL 12+
- npm or yarn

### Installation

1. **Clone and install dependencies**:
   ```bash
   git clone <repository>
   cd chronologicon-engine
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Create and setup the database**:
   ```bash
   # Create database
   createdb chronologicon
   
   # Run the setup script
   psql -d chronologicon -f setup.sql
   ```

4. **Start the application**:
   ```bash
   # Terminal 1: Start the API server
   npm start
   
   # Terminal 2: Start the worker process
   npm run worker
   ```

### Development Mode

```bash
# Terminal 1: API server with auto-reload
npm run dev

# Terminal 2: Worker process with auto-reload
npm run dev:worker
```

## Docker Deployment

### Quick Start with Docker Compose

The easiest way to run the application is using Docker Compose, which sets up both the application and PostgreSQL database:

```bash
# Clone the repository
git clone <repository-url>
cd chronologicon-engine

# Start the application and database
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

The application will be available at `http://localhost:3000` with the API documentation at `http://localhost:3000/api-docs`.

### Building and Running with Docker

```bash
# Build the Docker image
docker build -t chronologicon-engine .

# Run with external database
docker run -d \
  --name chronologicon-app \
  -p 3000:3000 \
  -e DB_HOST=your-db-host \
  -e DB_PASSWORD=your-db-password \
  -e API_KEY=your-secret-api-key \
  chronologicon-engine
```

### Docker Environment Variables

When using Docker, set these environment variables in `docker-compose.yml` or pass them to `docker run`:

- `DB_HOST=postgres` (or your database host)
- `DB_PASSWORD=your-password`
- `API_KEY=your-secret-api-key`
- `NODE_ENV=production`

## Authentication

The API uses API key authentication for all endpoints except `/health`, `/api-docs`, and documentation routes.

### API Key Setup

1. Set the `API_KEY` environment variable in your `.env` file:
   ```bash
   API_KEY=your-secret-api-key-here
   ```

2. Include the API key in your requests using one of these methods:

   **Using x-api-key header:**
   ```bash
   curl -H "x-api-key: your-secret-api-key-here" \
        http://localhost:3000/api/events/search
   ```

   **Using Authorization header:**
   ```bash
   curl -H "Authorization: Bearer your-secret-api-key-here" \
        http://localhost:3000/api/events/search
   ```

### Protected Endpoints

All `/api/*` endpoints require authentication except:
- `/health` - Health check endpoint
- `/api-docs` - API documentation 
- `/api/openapi.json` - OpenAPI specification

Requests without a valid API key will receive a `401 Unauthorized` response.

## API Endpoints

### File Ingestion

- **POST** `/api/events/ingest` - Submit a file for processing
- **GET** `/api/events/ingestion-status/{jobId}` - Get job status

### Event Queries

- **GET** `/api/timeline/{rootEventId}` - Get hierarchical timeline
- **GET** `/api/events/search` - Search events with filters

### Insights

- **GET** `/api/insights/overlapping-events` - Find overlapping events
- **GET** `/api/insights/temporal-gaps` - Find temporal gaps
- **GET** `/api/insights/event-influence` - Find influence paths

## Usage Examples

### 1. Ingest Historical Events

```bash
curl -X POST http://localhost:3000/api/events/ingest \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/path/to/sample-data/historical_events.jsonl"}'
```

Response:
```json
{
  "jobId": "123e4567-e89b-12d3-a456-426614174000",
  "message": "Ingestion job created successfully"
}
```

### 2. Check Job Status

```bash
curl http://localhost:3000/api/events/ingestion-status/123e4567-e89b-12d3-a456-426614174000
```

### 3. Search Events

```bash
curl "http://localhost:3000/api/events/search?name=war&sortBy=start_date&page=1&limit=10"
```

### 4. Find Overlapping Events

```bash
curl "http://localhost:3000/api/insights/overlapping-events?startDate=1940-01-01T00:00:00Z&endDate=1950-12-31T23:59:59Z"
```

## Data Format

The application accepts historical events in JSON Lines format. Each line should be a JSON object with the following structure:

```json
{
  "eventName": "World War II",
  "description": "Global war involving most of the world's nations",
  "startDate": "1939-09-01T00:00:00Z",
  "endDate": "1945-09-02T23:59:59Z",
  "parentEventId": null,
  "metadata": {
    "type": "global_conflict",
    "continents": ["Europe", "Asia", "Africa"]
  }
}
```

### Required Fields

- `eventName`: String - Name of the event
- `startDate`: ISO 8601 timestamp - When the event started
- `endDate`: ISO 8601 timestamp - When the event ended

### Optional Fields

- `description`: String - Detailed description
- `parentEventId`: UUID - ID of parent event for hierarchy
- `metadata`: Object - Additional structured data

## Database Schema

The application uses two main tables:

### `historical_events`
- Stores event data with hierarchical relationships
- Includes temporal constraints and indexes for performance

### `ingestion_jobs`
- Tracks background file processing jobs
- Includes progress tracking and error logging

See `setup.sql` for the complete schema definition.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | chronologicon | Database name |
| `DB_USER` | postgres | Database user |
| `DB_PASSWORD` | password | Database password |
| `WORKER_POLLING_INTERVAL` | 5000 | Worker polling interval (ms) |
| `NODE_ENV` | development | Environment mode |
| `ALLOWED_ORIGINS` | http://localhost:3000 | CORS allowed origins |
| `API_KEY` | - | Required API key for authentication | 

