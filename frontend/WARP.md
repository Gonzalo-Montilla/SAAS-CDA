# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is the React + TypeScript frontend for **CDA Piendamó**, a Point of Sale (POS) system for an automotive technical inspection center (Centro de Diagnóstico Automotor). The application manages vehicle inspections (RTM - Revisión Técnico-Mecánica), SOAT insurance commissions, cash register operations, and multi-role user access.

**Business Context**: This system is deployed on a Hostinger VPS and handles:
- Client and vehicle registration for inspections
- Multi-shift cash register management (morning/afternoon/night)
- Fee calculations based on vehicle age
- Integration with external systems (RUNT, SICOV, INDRA, DIAN)
- Role-based dashboards for administrators, cashiers, and receptionists

## Development Commands

### Run Development Server
```bash
npm run dev
```
Server runs at `http://localhost:5173` (default Vite port)

### Build for Production
```bash
npm run build
```
Output directory: `dist/`

TypeScript compilation occurs first (`tsc -b`), then Vite bundles the app.

### Lint Code
```bash
npm run lint
```
Uses ESLint with React-specific rules.

### Preview Production Build
```bash
npm run preview
```

### Environment Configuration
The app requires `.env.local` file with:
```
VITE_API_URL=http://localhost:8000/api/v1
```
Change this for production deployment.

## Architecture

### Tech Stack
- **React 19** with **TypeScript** (strict mode)
- **Vite** for development and building
- **Tailwind CSS** for styling (custom POS-themed components)
- **React Router DOM v7** for routing
- **TanStack Query v5** for server state management
- **Axios** for API requests

### Authentication Flow
The app uses JWT-based authentication with automatic token refresh:
1. User logs in via `/login` → stores `access_token` and `refresh_token` in localStorage
2. `apiClient` (Axios instance) automatically attaches `Bearer` token to all requests
3. On 401 errors, automatically attempts token refresh using `/auth/refresh` endpoint
4. If refresh fails, redirects to `/login` and clears tokens
5. `AuthContext` manages authentication state app-wide

### Project Structure

```
src/
├── api/
│   └── client.ts           # Axios instance with JWT interceptors
├── contexts/
│   └── AuthContext.tsx     # Authentication provider and useAuth hook
├── pages/
│   ├── Login.tsx           # Login page
│   └── Dashboard.tsx       # Main dashboard with role-based modules
├── types/
│   └── index.ts            # TypeScript type definitions for all entities
├── components/             # Reusable React components (currently empty)
├── hooks/                  # Custom React hooks (currently empty)
├── utils/                  # Utility functions (currently empty)
├── App.tsx                 # Main app with routing and providers
└── main.tsx                # React entry point
```

### Key Design Patterns

**API Client**: A single Axios instance (`apiClient`) is configured in `src/api/client.ts` with:
- Base URL from environment variable
- Request interceptor to add JWT token
- Response interceptor to handle token refresh on 401 errors
- Automatic redirect to login on authentication failure

**Authentication**: `AuthContext` provides:
- `user`: Current logged-in user object or null
- `loading`: Boolean indicating auth check in progress
- `login(credentials)`: Login function
- `logout()`: Logout function
- `isAuthenticated`: Boolean derived from user state

**Protected Routes**: `ProtectedRoute` component wraps routes requiring authentication, showing a loading state during auth verification.

**Route Structure**:
- `/login` - Public login page
- `/dashboard` - Protected main dashboard
- `/` - Redirects to `/dashboard`
- Future routes: `/recepcion`, `/caja`, `/tarifas`, `/reportes`, `/usuarios`

### Role-Based Access

Three user roles exist (`Usuario.rol`):
- `administrador`: Full system access
- `cajero`: Cash register operations, vehicle payments
- `recepcionista`: Vehicle and client registration only

The Dashboard conditionally renders modules based on user role.

### Styling System

Custom Tailwind CSS utility classes are defined in `src/index.css`:

**Buttons** (POS-style with large touch targets):
- `.btn-pos` - Base button style with hover scale
- `.btn-primary` - Blue primary button
- `.btn-success` - Green success button
- `.btn-danger` - Red danger button
- `.btn-secondary` - Gray secondary button

**Cards**:
- `.card-pos` - White card with shadow
- `.vehicle-card` - Card for vehicle lists with hover border

**Inputs**:
- `.input-pos` - Large input fields suitable for POS terminals

**Theme Colors**:
Custom primary color palette defined in `tailwind.config.js` (blue shades from 50 to 900).

## Type System

All API types are centralized in `src/types/index.ts`:

**Core Entities**:
- `Usuario` - User with role (`administrador`, `cajero`, `recepcionista`)
- `Vehiculo` - Vehicle in inspection process with state machine
- `Caja` - Cash register session (open/closed)
- `MovimientoCaja` - Cash register transactions
- `Tarifa` - RTM inspection fees by vehicle age
- `ComisionSOAT` - SOAT insurance commissions

**State Management**:
- `Vehiculo.estado`: `'registrado' | 'pagado' | 'en_pista' | 'aprobado' | 'rechazado' | 'completado'`
- `Caja.estado`: `'abierta' | 'cerrada'`
- `Caja.turno`: `'mañana' | 'tarde' | 'noche'`

When adding new features, always define types in this file first.

## Backend Integration

The backend is a **FastAPI** application running at `http://localhost:8000` (development).

**API Structure**: All endpoints are prefixed with `/api/v1/`

**Key Endpoints Used**:
- `POST /auth/login` - Login (form-data with username/password)
- `POST /auth/refresh` - Refresh access token
- `GET /auth/me` - Get current user info

**API Documentation**: Available at `http://localhost:8000/docs` (Swagger UI)

**Authentication**: OAuth2 password flow with JWT tokens. Login requires `application/x-www-form-urlencoded` format (see `AuthContext.tsx`).

## Common Development Tasks

### Adding a New Page
1. Create component in `src/pages/PageName.tsx`
2. Add route in `src/App.tsx` inside `<Routes>`
3. Wrap with `<ProtectedRoute>` if authentication required
4. Add navigation link in `Dashboard.tsx` if needed

### Adding a New API Endpoint
1. Define request/response types in `src/types/index.ts`
2. Use `apiClient` from `src/api/client.ts`
3. Prefer TanStack Query hooks for data fetching

### Testing Authentication
Default credentials (created by backend on first run):
- **Email**: `admin@cdasoft.com`
- **Password**: `admin123`

### Working with Forms
Use controlled components with React state. Forms in this app typically:
- Use large input fields (`.input-pos` class)
- Show loading states during submission
- Display error messages in red alert boxes
- Use large, touch-friendly buttons (`.btn-pos`)

## Important Notes

- **No test framework configured**: Tests are not currently set up
- **No components library yet**: The `components/` directory is empty; all UI is inline in pages
- **TypeScript strict mode**: Ensure all types are properly defined
- **Windows environment**: This project is developed on Windows with PowerShell
- **Backend dependency**: Frontend requires backend running on port 8000
- **localStorage**: Tokens are stored in localStorage (not cookies)
- **Spanish UI**: All user-facing text is in Spanish (e.g., "Iniciar Sesión", "Cargando...")

## Deployment Considerations

- Backend must be accessible at URL specified in `VITE_API_URL`
- Build output (`dist/`) is static and can be served by any web server
- Token refresh mechanism assumes backend `/auth/refresh` endpoint exists
- System is designed for deployment on Hostinger VPS

## Business Domain Context

Understanding the business flow helps when implementing features:

1. **Reception Flow**: Receptionist registers vehicle → calculates fee based on vehicle year → sends to cashier
2. **Cashier Flow**: Cashier views pending vehicles → processes payment → registers in external systems (RUNT, SICOV, INDRA) → issues DIAN invoice
3. **Cash Register**: Must be opened at shift start with initial cash → all transactions tracked → closed at shift end with physical cash count
4. **Inspection**: After payment, vehicle goes to inspection bay → technician approves or fails → if failed, client can return for free re-inspection

Vehicle age determines RTM fee (4 pricing tiers based on model year). SOAT commissions are fixed by vehicle type (moto/carro).
