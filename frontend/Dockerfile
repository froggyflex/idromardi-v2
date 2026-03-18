FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build argument - passed from docker-compose
ARG VITE_API_URL

# Build the application with the API URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Production stage - serve static files with serve
FROM node:20-alpine

# Install serve for static file serving
RUN npm install -g serve

WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/dist .

# Expose port
EXPOSE 3000

# Start serve with SPA fallback
CMD ["serve", "-s", ".", "-l", "3000"]
