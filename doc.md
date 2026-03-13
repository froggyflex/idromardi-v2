# Repository Analysis: Idromardi v2

## Project Overview

**Idromardi v2** is a full-stack water utility management system ("Gestione Idrica") for managing condominiums (residential buildings), their water utenze (utilities/connections), readings (letture), tariffs (tariffe), and invoicing (fatture). It appears to be a web-based management dashboard for water service providers in Italy.

---

## Technology Stack

### Backend
- **Runtime**: Node.js with Express.js
- **Database**: MariaDB/MySQL (mysql2 driver with connection pooling)
- **API Style**: RESTful JSON API
- **Key Dependencies**:
  - `express` (v5.2.1) - Web framework
  - `mysql2` (v3.16.3) - MySQL database driver
  - `cors` - Cross-origin resource sharing
  - `dotenv` - Environment configuration
  - `multer` - File upload handling
  - `ejs` - Template engine
  - `leaflet` (v1.9.4) - Geocoding/mapping
  - `axios` - HTTP client
  - `uuid` - UUID generation
  - `wkhtmltopdf` - PDF generation

### Frontend
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router DOM v7
- **UI/Styling**: 
  - Tailwind CSS
  - Lucide React (icons)
- **Data Visualization**: Recharts
- **Maps**: React Leaflet (Leaflet + react-leaflet-cluster)
- **Date Handling**: date-fns, react-datepicker
- **HTTP Client**: Axios

---

## Project Structure

```
/home/salvatore/idromardi-v2
├── backend/                 # Express.js REST API
│   ├── src/
│   │   ├── app.js          # Main Express app (routes)
│   │   ├── config/
│   │   │   ├── db.js       # MySQL connection pool
│   │   │   └── multer.js   # File upload config
│   │   └── modules/        # Feature modules (MVC pattern)
│   │       ├── admin/           # Admin tools
│   │       ├── billingGroups/    # Billing groups
│   │       ├── condomini/        # Condominium management
│   │       ├── dashboard/        # Dashboard statistics
│   │       ├── fatture/          # Invoice management (large)
│   │       ├── geocoding/        # Address geocoding
│   │       ├── letture/          # Water meter readings
│   │       ├── prospetti/        # Financial statements
│   │       ├── tariffe/          # Tariff management
│   │       └── utenze/           # Utility connections
│   ├── uploads/             # Uploaded files
│   ├── package.json
│   └── server.js           # Entry point
│
├── frontend/                # React + TypeScript SPA
│   ├── src/
│   │   ├── api/            # API client & interfaces
│   │   ├── layouts/        # Page layouts
│   │   ├── pages/          # React pages/components
│   │   │   ├── admin/      # Admin pages
│   │   │   ├── components/ # Reusable components
│   │   │   ├── fatture/    # Invoice pages
│   │   │   └── [various]   # Other feature pages
│   │   ├── types/          # TypeScript interfaces
│   │   ├── App.tsx         # Main router
│   │   ├── main.tsx        # React entry
│   │   └── index.css       # Global styles
│   ├── package.json
│   └── tsconfig.json
│
├── migration_v1.sql        # Database schema (very large ~12K lines)
└── README.md               # Brief project notes
```

---

## Database Schema

The database (`miteamx1_fatturazione`) contains **22 tables**:

### Core Entity Tables

| Table | Purpose |
|-------|---------|
| `condomini_v2` | Condominium (building) records |
| `condomini_v2_map` | Condominium geographic/visual data |
| `condominio_contatti_v2` | Contacts for each condominium |
| `utenze_v2` | Utility connections (water accounts) |
| `utenza_profili_v2` | User profiles for utilities |
| `contatori_v2` | Water meter information |

### Billing & Invoicing

| Table | Purpose |
|-------|---------|
| `fatture_sessioni` | Invoice generation sessions |
| `fatture_righe` | Invoice line items |
| `fatture_acconti` | Advance payments |

### Readings & Meter Data

| Table | Purpose |
|-------|---------|
| `letture_sessioni` | Meter reading sessions |
| `letture_righe` | Individual meter readings |
| `letture_stati` | Reading status types |

### Tariff Structure

| Table | Purpose |
|-------|---------|
| `casa_idrica` | Water system zones |
| `casa_idrica_tariffe` | Tariff rates per year |
| `casa_idrica_tariff_categorie` | Tariff categories (e.g., RESIDENTE) |
| `casa_idrica_tariff_scaglioni` | Consumption tiers/pricing |
| `casa_idrica_tariff_componenti_mc` | Per-cubic-meter components (DEPURAZIONE, FOGNATURA) |
| `casa_idrica_tariff_quote_fisse` | Fixed quota charges |

### Utility & Views

| Table | Purpose |
|-------|---------|
| `utenze_test` | Test data for utilities |
| `v_utenze_grid` | View for utility grid display |
| `test_check` | Testing table |

---

## API Endpoints (Routes)

### Routes Mounted in app.js:

| Prefix | Module | Description |
|--------|--------|-------------|
| `/api/condomini` | condomini.routes.js | Condominium CRUD |
| `/api/utenze` | utenze.routes.js | Utility connections |
| `/api/letture` | letture.routes.js | Meter readings |
| `/api/tariffe` | tariffe.routes.js | Tariff management |
| `/api/fatture` | fatture.routes.js | Invoice management |
| `/api/billingGroups` | billingGroups.routes.js | Billing groups |
| `/api/prospetti` | prospetti.routes.js | Financial statements |
| `/api/dashboard` | dashboard.routes.js | Statistics & maps |
| `/api/admin` | admin.routes.js | Admin functions |

### Static Files
- `/uploads` - Serves uploaded files (factories, documents)

---

## Frontend Pages (Routes)

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | Dashboard | Main dashboard with KPIs, charts, map |
| `/condomini` | CondominiList | List all condominiums |
| `/condomini/new` | CondominioCreate | Create new condominium |
| `/condomini/:id` | CondominioOverview | View condominium details |
| `/condomini/:id/edit` | CondominioEdit | Edit condominium |
| `/condomini/:id/contatti` | CondominioContatti | Manage contacts |
| `/condomini/:id/utenze` | CondominioUtenze | Manage utilities |
| `/condomini/:id/letture` | LetturePage | Meter readings |
| `/condomini/:id/fatture` | CondominioFatturePage | Invoice management |
| `/admin` | AdminDashboard | Admin overview |
| `/admin/tools` | AdminTools | Admin utilities |
| `/admin/tariffe` | AdminTariffe | Tariff administration |

---

## Key Features Inferred

### 1. Condominium Management
- Create, read, update, delete (CRUD) condominiums
- Auto-geocoding of addresses via geocoding service
- Manage contacts per condominium
- Track additional info: VAT, section, role, NUAE, category, contract
- Store payment registration and billing preferences

### 2. Utility (Utenza) Management
- Track water utility connections per condominium
- Each utenza has:
  - User ID (auto-incremented, gap-filled)
  - Name/Surname
  - Apartment/Unit number (Interno)
  - Status (ATTIVA, etc.)
- Link to meters (contatori)

### 3. Meter Reading (Letture)
- Record water meter readings
- Track reading sessions with dates
- Reading status tracking

### 4. Tariff Management
- Complex multi-tier tariff structure:
  - Per water system (casa_idrica)
  - Per year
  - Categories (e.g., RESIDENTE)
  - Consumption tiers (scaglioni) with different pricing
  - Fixed charges (quote fisse)
  - Per-cubic-meter components (depurazione, fognatura)
- Supports "moltiplica_per_nucleo" (multiplier by household size)

### 5. Invoicing (Fatture)
- Invoice generation sessions
- Line items for invoices
- Advance payment tracking
- Invoice document import (PDF parsing placeholder exists)
- Validation of imported invoices

### 6. Dashboard & Analytics
- KPI cards: Active condominiums, active utilities
- Pie charts showing billing status by year
- Interactive map with clustered markers (Leaflet)
- Geographic visualization of condominiums

### 7. Admin Functions
- Admin dashboard
- Tariff administration
- Utility admin tools

---

## Architecture Patterns

### Backend: Modular MVC
- Each feature is a module with:
  - `.routes.js` - Express routes
  - `.controller.js` - Request handling
  - `.service.js` - Business logic & DB queries
- Database: Connection pooling via mysql2
- UUIDs for primary keys
- Transactions for multi-step operations

### Frontend: Component-Based SPA
- React Router for navigation
- TypeScript interfaces for type safety
- Axios for API calls
- Tailwind CSS for styling
- Recharts for data visualization
- Leaflet for maps

---

## Environment Configuration

```env
PORT=4000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=miteamx1_fatturazione
DB_PORT=3306
```

---

## Current Development Status

Based on the codebase analysis:

- **Active Development**: The repository shows recent commits (March 2026)
- **Working Core**: Basic CRUD operations implemented for main entities
- **In Development**:
  - PDF invoice parsing is a placeholder
  - Some complex billing calculations may need refinement
- **Frontend**: React SPA with routing, dashboard, and CRUD pages
- **Database**: Complete schema with sample data

---

## Potential Improvements / Notes

1. **PDF Parsing**: The fatture module has placeholder code for PDF extraction - needs implementation
2. **Authentication**: No auth module detected - may need to be added
3. **Validation**: Basic validation present; could be enhanced
4. **Error Handling**: Could be more robust in places
5. **Testing**: No test files visible
6. **TypeScript Backend**: Backend is JavaScript (not TypeScript)

---

## Summary

**Idromardi v2** is a comprehensive water utility management system designed for Italian water service providers. It manages the full lifecycle of water service for residential buildings (condomini), including:

- Building management
- Utility connections (utenze)
- Meter readings (letture)
- Complex tariff structures
- Invoice generation
- Geographic visualization

The system uses a modern React frontend with maps and charts, backed by an Express API with a MySQL/MariaDB database. The architecture is modular and follows standard patterns for Node.js/React applications.

---

## Docker Configuration

The project is fully containerized with Docker Compose.

### Services

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 3000 | React production build (served with serve) |
| Backend | 4000 | Express.js REST API |
| Database | 3306 | MySQL 8.0 |

### Quick Start

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f
```

### Access

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000/api
- **Database**: localhost:3306

### API URL Configuration

The frontend API URL is set at build time via the `VITE_API_URL` argument in docker-compose.yml.

Default: `http://localhost:4000/api`

To change:
```bash
VITE_API_URL=http://your-api:4000/api docker-compose up -d --build
```

### Docker Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Rebuild a specific service
docker-compose up -d --build frontend
docker-compose up -d --build backend

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f db

# Full reset (removes volumes)
docker-compose down -v
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4000 | Backend port |
| `DB_HOST` | db | Database host (Docker service name) |
| `DB_USER` | idromardi | Database user |
| `DB_PASSWORD` | idromardi123 | Database password |
| `DB_NAME` | miteamx1_fatturazione | Database name |

### Database

- **SQL File**: `miteamx1_fatturazione.sql` - Database schema and initial data
- Auto-initialized on first run via Docker volume

### Frontend Dockerfile

The frontend uses a multi-stage build:
1. **Builder stage**: Installs dependencies and builds React app with Vite
2. **Production stage**: Serves static files with `serve`

To run in development mode (with hot reload), modify the frontend Dockerfile to use `npm run dev` instead of the production build.
