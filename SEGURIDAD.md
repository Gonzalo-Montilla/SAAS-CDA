# 🔐 Documentación de Seguridad - CDA Piendamó

## Índice
1. [Autenticación](#autenticación)
2. [Autorización y Roles](#autorización-y-roles)
3. [Protección de Datos](#protección-de-datos)
4. [Auditoría](#auditoría)
5. [Configuración de Producción](#configuración-de-producción)
6. [Checklist de Deployment](#checklist-de-deployment)

---

## Autenticación

### JWT (JSON Web Tokens)
El sistema utiliza JWT para autenticación stateless:

- **Access Token**: Válido por 30 minutos
- **Refresh Token**: Válido por 7 días
- **Algoritmo**: HS256
- **Secret Key**: Almacenada en variable de entorno

### Flujo de Autenticación
```
1. Usuario → POST /api/v1/auth/login (email + password)
2. Backend valida credenciales
3. Backend genera Access Token + Refresh Token
4. Frontend almacena tokens (httpOnly cookies recomendado)
5. Cada request incluye Access Token en header:
   Authorization: Bearer {access_token}
6. Cuando Access Token expira:
   POST /api/v1/auth/refresh con Refresh Token
```

### Endpoints de Autenticación
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh` - Renovar tokens
- `GET /api/v1/auth/me` - Información del usuario actual
- `POST /api/v1/auth/change-password` - Cambiar contraseña propia
- `POST /api/v1/auth/forgot-password` - Solicitar recuperación
- `POST /api/v1/auth/reset-password` - Restablecer con token

### Hashing de Contraseñas
- **Algoritmo**: PBKDF2 con SHA256
- **Librería**: passlib
- Nunca se almacenan contraseñas en texto plano

---

## Autorización y Roles

### Roles del Sistema
| Rol | Descripción | Permisos |
|-----|-------------|----------|
| **ADMINISTRADOR** | Acceso total | Todos los módulos + gestión usuarios |
| **CAJERO** | Operador de caja | Caja, vehículos (lectura), tarifas (lectura) |
| **RECEPCIONISTA** | Recepción de vehículos | Registro vehículos, tarifas (lectura) |
| **CONTADOR** | Contabilidad | Reportes, tesorería, caja (lectura) |

### Protección de Endpoints

#### Dependencias de Seguridad
```python
from app.core.deps import (
    get_current_user,      # Usuario autenticado
    get_admin,             # Solo administradores
    get_cajero_or_admin,   # Cajeros o administradores
    get_recepcionista_or_admin  # Recepcionistas o admin
)
```

#### Ejemplo de Uso
```python
@router.post("/usuarios/")
def crear_usuario(
    usuario_data: UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)  # Solo admin
):
    ...
```

### Matriz de Permisos por Módulo

| Módulo | ADMIN | CAJERO | RECEPCIONISTA | CONTADOR |
|--------|-------|--------|---------------|----------|
| Usuarios | ✅ Todos | ❌ | ❌ | ❌ |
| Caja | ✅ Todos | ✅ Operar | ❌ | 👁️ Consulta |
| Tesorería | ✅ Todos | ❌ | ❌ | ✅ Todos |
| Tarifas | ✅ Todos | 👁️ Consulta | 👁️ Consulta | 👁️ Consulta |
| Vehículos | ✅ Todos | 👁️ Consulta | ✅ Registro | 👁️ Consulta |
| Reportes | ✅ Todos | 👁️ Básicos | 👁️ Básicos | ✅ Todos |

---

## Protección de Datos

### Variables de Entorno
**NUNCA** commit archivos `.env` con credenciales reales.

#### Desarrollo (.env)
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cdasoft
SECRET_KEY=clave-de-desarrollo-cambiar-en-produccion
```

#### Producción (.env.production)
```bash
DATABASE_URL=postgresql://usuario_prod:password_complejo@localhost:5432/cdasoft_prod
SECRET_KEY=<generar con: python -c "import secrets; print(secrets.token_urlsafe(64))">
BACKEND_CORS_ORIGINS=["https://tu-dominio.com"]
DEBUG=False
ENVIRONMENT=production
```

### Headers de Seguridad HTTP
El sistema implementa estos headers automáticamente:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self' (solo en producción)
```

### CORS (Cross-Origin Resource Sharing)
- **Desarrollo**: Permite `localhost:5173` y `localhost:3000`
- **Producción**: SOLO el dominio específico del frontend
- **Nunca** usar `"*"` en producción

### SQL Injection
- ✅ **Protección**: Uso de SQLAlchemy ORM
- ✅ **Validación**: Pydantic schemas
- ✅ **Parametrización**: Todas las queries son parametrizadas

### XSS (Cross-Site Scripting)
- ✅ **Sanitización**: Validación de inputs con Pydantic
- ✅ **Headers**: X-XSS-Protection habilitado
- ✅ **Content-Type**: Siempre especificado

---

## Auditoría

### Sistema de Logs
Todas las operaciones críticas se registran en la tabla `audit_logs`.

### Acciones Auditadas
- ✅ Login/Logout (exitosos y fallidos)
- ✅ Creación/modificación/eliminación de usuarios
- ✅ Apertura/cierre de caja
- ✅ Movimientos de tesorería
- ✅ Cambios en tarifas
- ✅ Registro de vehículos

### Información Registrada
```json
{
  "action": "login",
  "description": "Login exitoso: admin@cdasoft.com",
  "usuario_email": "admin@cdasoft.com",
  "usuario_rol": "administrador",
  "ip_address": "192.168.1.100",
  "user_agent": "Mozilla/5.0...",
  "success": "success",
  "created_at": "2025-11-25 15:30:00"
}
```

### Consultar Logs de Auditoría
```sql
-- Últimos 100 logs
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100;

-- Acciones de un usuario específico
SELECT * FROM audit_logs 
WHERE usuario_email = 'cajero@cdasoft.com'
ORDER BY created_at DESC;

-- Intentos de login fallidos
SELECT * FROM audit_logs 
WHERE action = 'failed_login' 
ORDER BY created_at DESC;

-- Actividad del último mes
SELECT * FROM audit_logs 
WHERE created_at >= NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;
```

---

## Configuración de Producción

### Checklist Pre-Deployment

#### 1. Variables de Entorno
- [ ] Generar `SECRET_KEY` criptográficamente segura
- [ ] Configurar `DATABASE_URL` de producción
- [ ] Actualizar `BACKEND_CORS_ORIGINS` con dominio real
- [ ] Configurar `SMTP_*` para emails
- [ ] Set `DEBUG=False`
- [ ] Set `ENVIRONMENT=production`

#### 2. Base de Datos
- [ ] Crear BD de producción separada
- [ ] Ejecutar todas las migraciones
- [ ] Configurar backups automáticos diarios
- [ ] Crear usuario administrador inicial

#### 3. Servidor (Hostinger VPS)
- [ ] Instalar Nginx como reverse proxy
- [ ] Configurar SSL/TLS con Let's Encrypt
- [ ] Configurar systemd/supervisor para FastAPI
- [ ] Habilitar firewall (UFW): solo puertos 80, 443, SSH

#### 4. Aplicación
- [ ] Deshabilitar `/docs` y `/redoc` en producción
- [ ] Verificar todos los endpoints tienen auth
- [ ] Configurar logs a archivo
- [ ] Configurar rate limiting (opcional)

---

## Checklist de Deployment

### Backend (FastAPI)

```bash
# 1. Instalar dependencias
cd backend
pip install -r requirements.txt

# 2. Configurar variables de entorno
cp .env.production.example .env.production
nano .env.production  # Editar con valores reales

# 3. Ejecutar migraciones
psql -U usuario_prod -d cdasoft_prod -f migrations/create_audit_logs.sql

# 4. Iniciar con Uvicorn
uvicorn app.main:app --host 0.0.0.0 --port 8000 --env-file .env.production
```

### Frontend (React)

```bash
# 1. Instalar dependencias
cd frontend
npm install

# 2. Configurar API URL de producción
# En .env.production:
VITE_API_URL=https://api.tu-dominio.com

# 3. Build de producción
npm run build

# 4. Servir con Nginx
# Los archivos de dist/ van a /var/www/cdasoft/
```

### Nginx Configuración

```nginx
# /etc/nginx/sites-available/cdasoft

# Backend API
server {
    listen 443 ssl;
    server_name api.tu-dominio.com;
    
    ssl_certificate /etc/letsencrypt/live/api.tu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.tu-dominio.com/privkey.pem;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Frontend
server {
    listen 443 ssl;
    server_name tu-dominio.com www.tu-dominio.com;
    
    ssl_certificate /etc/letsencrypt/live/tu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tu-dominio.com/privkey.pem;
    
    root /var/www/cdasoft;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Mantenimiento

### Backups Recomendados
```bash
# Script de backup diario (crontab)
0 2 * * * pg_dump -U usuario_prod cdasoft_prod | gzip > /backups/cda_$(date +\%Y\%m\%d).sql.gz
```

### Monitoreo
- Revisar logs de auditoría semanalmente
- Verificar intentos de login fallidos
- Monitorear uso de recursos del servidor
- Alertas en caso de downtime

---

## Contacto de Seguridad
En caso de detectar vulnerabilidades de seguridad, contactar inmediatamente al administrador del sistema.

**Última actualización**: 2025-11-25
