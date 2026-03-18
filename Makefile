.PHONY: up down build logs clean

# Docker Compose shortcuts
up:
	docker-compose up -d

down:
	docker-compose down

build:
	docker-compose build

logs:
	docker-compose logs -f

logs-backend:
	docker-compose logs -f backend

logs-frontend:
	docker-compose logs -f frontend

logs-db:
	docker-compose logs -f db

clean:
	docker-compose down -v

# Rebuild a specific service
rebuild-backend:
	docker-compose build backend
	docker-compose up -d backend

rebuild-frontend:
	docker-compose build frontend
	docker-compose up -d frontend

# Development mode (with volume mounts for hot reload)
dev:
	docker-compose up -d db backend
	@echo "Backend running at http://localhost:4000"
	@echo "Use 'npm run dev' in frontend folder for development"

# Full production build
prod: build up
	@echo "Services starting..."
	@echo "Frontend: http://localhost"
	@echo "Backend API: http://localhost:4000"
	@echo "Database: localhost:3306"
