FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src ./src
COPY server.js ./
COPY uploads ./uploads

# Create uploads directories if they don't exist
RUN mkdir -p uploads/fatture-import

# Expose port
EXPOSE 4000

# Start server
CMD ["node", "server.js"]
