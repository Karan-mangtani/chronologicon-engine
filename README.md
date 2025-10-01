# Chronologicon Engine


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
   npm run start:both
   ```

### Development Mode

```bash
# Terminal 1: API server with auto-reload
npm run start:both


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


### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | 3000 | Server port |
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | chronologicon | Database name |
| `DB_USER` | postgres | Database user |
| `DB_PASSWORD` | password | Database password |
| `WORKER_POLLING_INTERVAL` | 5000 | Worker polling interval (ms) |
| `NODE_ENV` | development | Environment mode |
| `ALLOWED_ORIGINS` | http://localhost:3000 | CORS allowed origins |
| `API_KEY` | - | Required API key for authentication | 

