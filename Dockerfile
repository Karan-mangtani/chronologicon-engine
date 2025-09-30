# Use the official Node.js 18 LTS image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S chronologicon -u 1001

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm i && \
    npm cache clean --force

# Copy the rest of the application code
COPY . .

# Create uploads directory and set permissions
RUN mkdir -p uploads && \
    chown -R chronologicon:nodejs /app

# Switch to non-root user
USER chronologicon

# Expose the port the app runs on
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { host: 'localhost', port: 3000, path: '/health', timeout: 2000 }; const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

# Set environment to production by default
ENV NODE_ENV=production

# Start both server and worker processes
CMD ["npm", "run", "start:both"]
