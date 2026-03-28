# CDASOFT - Sistema de Punto de Venta

Sistema completo de gestión y punto de venta. CDASOFT — sistema integral para administracion de cda.

## 🚀 Características

- ✅ **Módulo de Recepción**: Registro rápido de vehículos
- ✅ **Módulo de Caja**: Interfaz tipo POS para cobros
- ✅ **Gestión de Tarifas**: Tarifas anuales con antigüedad de vehículo
- ✅ **Comisiones SOAT**: Registro automático de comisiones
- ✅ **Métodos de Pago**: Efectivo, Tarjeta, Transferencia, CrediSmart
- ✅ **Integración DIAN/RUNT/SICOV**: Modals para facturación y registros
- ✅ **Apertura/Cierre de Caja**: Control total de efectivo con arqueo
- ✅ **Multi-turno**: Soporte para múltiples turnos (mañana/tarde/noche)
- ✅ **Roles de Usuario**: Administrador, Cajero, Recepcionista
- ✅ **Auditoría Completa**: Logs de todas las operaciones

## 📋 Stack Tecnológico

### Backend
- **FastAPI** 0.109.0
- **PostgreSQL** (SQLAlchemy ORM)
- **JWT** para autenticación
- **Python** 3.10+

### Frontend  
- **React** 18 + TypeScript
- **Vite** para desarrollo
- **Tailwind CSS** para UI
- **TanStack Query** para manejo de estado
- **Axios** para HTTP requests

## 🛠️ Instalación

### Requisitos Previos
- Python 3.10 o superior
- PostgreSQL 13 o superior
- Node.js 18 o superior
- Git

### 1. Clonar el repositorio

```bash
git clone <repository-url>
cd SAAS-CDA
```

### 2. Configurar Backend

```bash
cd backend

# Crear entorno virtual
python -m venv venv

# Activar entorno (Windows)
venv\Scripts\activate

# Activar entorno (Linux/Mac)
source venv/bin/activate

# Instalar dependencias
pip install -r requirements.txt

# Copiar .env.example a .env
copy .env.example .env  # Windows
cp .env.example .env    # Linux/Mac

# Editar .env con tus credenciales de PostgreSQL
```

### 3. Crear Base de Datos

```sql
-- En PostgreSQL
CREATE DATABASE cdasoft;
```

### 4. Iniciar Backend

```bash
# Desde backend/
python run.py

# O alternativamente:
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

El backend estará disponible en `http://localhost:8000`
- **Documentación API**: `http://localhost:8000/docs` ← Aquí puedes probar todos los endpoints
- **Health check**: `http://localhost:8000/health`

### 5. Probar el Backend

Abre tu navegador en `http://localhost:8000/docs` y verás la documentación interactiva Swagger.

**Endpoints principales:**

1. **POST /api/v1/auth/login** - Iniciar sesión
   - Username: `admin@cdasoft.com`
   - Password: `admin123`
   - Copiar el `access_token` de la respuesta

2. **Authorize** (botón verde arriba a la derecha)
   - Pegar el token: `Bearer {tu_access_token}`
   - Ahora puedes probar todos los endpoints autenticados

3. **GET /api/v1/tarifas/vigentes** - Ver tarifas 2025

4. **POST /api/v1/cajas/abrir** - Abrir caja

5. **POST /api/v1/vehiculos/registrar** - Registrar vehículo

6. **GET /api/v1/vehiculos/pendientes** - Ver vehículos pendientes

7. **POST /api/v1/vehiculos/cobrar** - Cobrar vehículo

### 6. Configurar Frontend (Pendiente)

```bash
cd frontend

# Instalar dependencias
npm install

# Crear .env.local
echo "VITE_API_URL=http://localhost:8000/api/v1" > .env.local

# Iniciar desarrollo
npm run dev
```

El frontend estará disponible en `http://localhost:5173`

## 👤 Usuario Inicial

Al iniciar por primera vez, se crea automáticamente un usuario administrador:

```
Email: admin@cdasoft.com
Password: admin123
```

⚠️ **IMPORTANTE**: Cambiar la contraseña después del primer login.

## 📊 Tarifas 2025

El sistema viene preconfigura do con las tarifas 2025 para motos según antigüedad:

| Antigüedad | Modelos | RTM + Terceros | Total |
|------------|---------|----------------|-------|
| 0-2 años | 2023-2025 | $181,596 + $24,056 | **$205,652** |
| 3-7 años | 2018-2022 | $181,896 + $24,056 | **$205,952** |
| 8-16 años | 2009-2017 | $182,196 + $24,056 | **$206,252** |
| 17+ años | ≤ 2008 | $181,896 + $24,056 | **$205,952** |

**Comisiones SOAT:**
- Moto: $30,000
- Carro: $50,000

## 🔐 Roles y Permisos

### Administrador
- Acceso total al sistema
- Gestión de usuarios
- Configuración de tarifas
- Ver todas las cajas y reportes
- Auditoría completa

### Cajero
- Apertura/cierre de su caja
- Cobro de inspecciones
- Registro en RUNT/SICOV
- Ver historial de su caja

### Recepcionista
- Registro de vehículos
- Consulta de tarifas
- NO acceso a movimientos de caja
- NO acceso a reportes financieros

## 📱 Flujo de Trabajo

### 1. Recepción
1. Cliente llega y pregunta por el servicio
2. Recepcionista registra vehículo (placa, año, datos cliente)
3. Indica si compró SOAT
4. Sistema calcula automáticamente la tarifa según antigüedad
5. Envía a caja

### 2. Caja
1. Cajera ve vehículo en lista de pendientes
2. Hace clic en "COBRAR"
3. Confirma el servicio RTM
4. Agrega comisión SOAT si aplica (botones visuales)
5. Selecciona método de pago
6. Registra en RUNT (popup/iframe)
7. Registra en SICOV (popup/iframe)
8. Registra en INDRA Paynet (popup/iframe)
9. Marca facturación DIAN (programa local)
10. Confirma pago
11. Imprime comprobante

### 3. Inspección
1. Vehículo pasa a estado "EN_PISTA"
2. Técnico realiza RTM
3. Aprueba o rechaza
4. Si rechaza → cliente puede volver (re-inspección gratuita)

## 🗄️ Base de Datos

### Tablas Principales
- `usuarios`: Gestión de usuarios del sistema
- `tarifas`: Tarifas RTM con vigencias anuales
- `comisiones_soat`: Comisiones por intermediación
- `cajas`: Cajas diarias de trabajo
- `movimientos_caja`: Todos los movimientos (ingresos/egresos)
- `vehiculos_proceso`: Vehículos en proceso de inspección

## 🚢 Despliegue

### Railway (Recomendado)

1. Crear cuenta en [Railway.app](https://railway.app)
2. Crear nuevo proyecto
3. Agregar PostgreSQL
4. Agregar servicio Backend (Python)
5. Agregar servicio Frontend (Node.js)
6. Configurar variables de entorno
7. Deploy automático desde GitHub

### VPS (Hostinger u otro)

Ver `DEPLOY.md` para instrucciones detalladas de despliegue en VPS.

## 📝 Desarrollo

### Estructura del Proyecto

```
SAAS-CDA/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/     # Endpoints REST
│   │   ├── core/                 # Config y seguridad
│   │   ├── db/                   # Database
│   │   ├── models/               # Modelos SQLAlchemy
│   │   ├── schemas/              # Schemas Pydantic
│   │   └── main.py               # FastAPI app
│   ├── requirements.txt
│   └── .env
│
├── frontend/
│   ├── src/
│   │   ├── api/                  # API client
│   │   ├── components/           # React components
│   │   ├── pages/                # Páginas principales
│   │   ├── types/                # TypeScript types
│   │   └── App.tsx
│   ├── package.json
│   └── .env.local
│
└── README.md
```

## 🤝 Contribuir

Este es un proyecto privado para CDASOFT. Contactar al administrador para contribuciones.

## 📄 Licencia

Propietario: CDASOFT, sistema integral para administracion de cda
Todos los derechos reservados.

## 📞 Soporte

Para soporte técnico, contactar al administrador del sistema.

---

**Versión**: 1.0.0  
**Última actualización**: Noviembre 2025
