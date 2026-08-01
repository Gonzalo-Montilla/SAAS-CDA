# Despliegue de CDASOFT en VPS (sin interferir con otros proyectos)

Guía pensada para quien tiene **SSH**, un **dominio** y un servidor donde **ya corren otras apps**. CDASOFT quedará **aislado** en su propia carpeta, su propio **puerto interno**, su propio **sitio Nginx** y su propia **base de datos**.

Antes de tocar el servidor, revisa **[`PRODUCTION_CHECKLIST.md`](PRODUCTION_CHECKLIST.md)** y prepara el archivo **`.env`** del backend (secretos, CORS, SMTP).

---

## 1. Cómo evitamos afectar otros proyectos

| Aislamiento | Qué hacemos |
|-------------|-------------|
| Carpetas | Todo bajo una ruta fija, p. ej. `/var/www/cdasoft/` (no mezclamos archivos con otros sitios). |
| Puerto del API | El backend solo escucha en **127.0.0.1** y un puerto que **tú eliges** (ej. **8010**). Los otros proyectos siguen con sus puertos. |
| Nginx | Un archivo de sitio **nuevo** (`cdasoft` o tu dominio). No editamos los `server` de los otros sitios salvo que tu arquitectura lo requiera. |
| PostgreSQL | Base y usuario **solo para CDASOFT** (ej. `cdasoft_prod`). |
| systemd | Un servicio nuevo, p. ej. `cdasoft-backend.service`. |

---

## 2. Datos que debes tener a mano (rellénalos tú)

Copia esto en un bloc de notas y complétalo:

```
DOMINIO_WEB=https://app.tudominio.com          # donde verán el React (o https://tudominio.com si usas misma raíz)
DOMINIO_API=https://api.tudominio.com          # OPCIÓN A: subdominio solo API
# OPCIÓN B (recomendada si un solo dominio): API en la misma web bajo /api/
#   DOMINIO_WEB=https://tudominio.com y no hace falta subdominio API

USUARIO_SSH=root                               # o el usuario que uses (ubuntu, deploy, etc.)
IP_VPS=123.45.67.89

PUERTO_INTERNO_API=8010                        # cambia si ya está ocupado (8011, 8020…)

POSTGRES_DB=cdasoft_prod
POSTGRES_USER=cda_app_user
POSTGRES_PASSWORD=(contraseña fuerte)
```

**Recomendación para CORS y cookies:** si el front y el API comparten el mismo dominio (ej. `https://tudominio.com` y el API en `https://tudominio.com/api/v1`), suele ser lo más simple. Si usas dos subdominios (`app.` y `api.`), en `.env` del backend **`BACKEND_CORS_ORIGINS`** debe incluir **exactamente** el origen del front (con `https://`).

---

## 3. En tu computadora (Windows): construir el frontend correctamente

El build **debe** conocer la URL pública del API (ver `frontend/.env.example`).

### Estándar CDASOFT producción (obligatorio)

Para evitar errores intermitentes de CORS/SSL por dominios cruzados, el frontend de producción debe compilarse siempre contra el dominio canónico:

```powershell
$env:VITE_API_URL="https://cdasoft.com.co/api/v1"
```

> No usar `https://www.cdasoft.com/api/v1` como destino de build mientras ese host no sea el canónico operativo.

Abre PowerShell en la carpeta del proyecto:

```powershell
cd C:\Proyectos\SAAS-CDA\frontend

# OPCIÓN misma web: API en /api/v1 del mismo dominio
$env:VITE_API_URL="https://tudominio.com/api/v1"
npm run build
```

O si el API va en subdominio:

```powershell
$env:VITE_API_URL="https://api.tudominio.com/api/v1"
npm run build
```

Comprueba que exista la carpeta `frontend\dist\` con `index.html` dentro.

---

## 4. Conectar por SSH

```bash
ssh USUARIO_SSH@IP_VPS
```

(Sustituye `USUARIO_SSH` e `IP_VPS`.)

---

## 5. Instalar lo necesario en el VPS (Ubuntu / Debian)

Si ya tienes Nginx, PostgreSQL y Python, puedes saltar lo que esté instalado.

```bash
sudo apt update
sudo apt install -y git nginx python3 python3-venv python3-pip postgresql postgresql-contrib certbot python3-certbot-nginx
```

**Opcional — vista previa PDF de Office en el módulo documental:** instalar componentes LibreOffice y dejar `DOCUMENTOS_LIBREOFFICE_PATH` vacío si `soffice` queda en el `PATH` del servicio, o fijar la ruta en `.env`.

```bash
sudo apt install -y libreoffice-writer libreoffice-calc libreoffice-impress
```

Sin esto, subida/descarga y certificación siguen funcionando; solo falla la conversión a PDF en el navegador para `.docx`, `.xlsx`, etc.

---

## 6. PostgreSQL: base y usuario solo para CDASOFT

```bash
sudo -u postgres psql
```

Dentro de `psql` (ajusta nombres y contraseña; termina cada línea con `;`):

```sql
CREATE DATABASE cdasoft_prod;
CREATE USER cda_app_user WITH ENCRYPTED PASSWORD 'TU_PASSWORD_FUERTE';
GRANT ALL PRIVILEGES ON DATABASE cdasoft_prod TO cda_app_user;
\c cdasoft_prod
GRANT ALL ON SCHEMA public TO cda_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO cda_app_user;
\q
```

---

## 7. Carpetas del proyecto en el servidor

Usamos una sola raíz para no mezclar con otros sitios:

```bash
sudo mkdir -p /var/www/cdasoft
sudo chown -R $USER:$USER /var/www/cdasoft
cd /var/www/cdasoft
```

### Opción A: clonar con Git (recomendado si el repo es privado o quieres `git pull` después)

```bash
cd /var/www/cdasoft
git clone https://github.com/TU_USUARIO/SAAS-CDA.git repo
# Si el repo es privado: configura SSH key en el servidor o usa token HTTPS.
```

Estructura resultante: `/var/www/cdasoft/repo/backend`, `/var/www/cdasoft/repo/frontend`, etc.

### Opción B: subir desde tu PC con `scp` (sin Git en el servidor)

En **tu PC** (PowerShell), desde la raíz del proyecto:

```powershell
cd C:\Proyectos\SAAS-CDA
scp -r backend frontend\dist USUARIO_SSH@IP_VPS:/var/www/cdasoft/upload_tmp/
```

En el servidor, mueve cosas a su sitio (ajusta rutas si usas otra estructura).

---

Para el resto de la guía asumimos:

- Backend: `/var/www/cdasoft/repo/backend` (si clonaste) o `/var/www/cdasoft/backend`
- Front compilado: `/var/www/cdasoft/repo/frontend/dist` o `/var/www/cdasoft/frontend-dist`

**Ajusta los comandos** si tu ruta es distinta.

---

## 8. Entorno virtual Python e instalación de dependencias

```bash
cd /var/www/cdasoft/repo/backend   # o .../backend

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
```

---

## 9. Archivo `.env` del backend en el servidor

```bash
nano /var/www/cdasoft/repo/backend/.env
```

Mínimo imprescindible (adapta valores; ver `backend/.env.example` y `backend/GUIA_ENV_PRODUCCION.md`):

```env
ENVIRONMENT=production
DEBUG=False
DATABASE_URL=postgresql://cda_app_user:TU_PASSWORD_FUERTE@127.0.0.1:5432/cdasoft_prod
SECRET_KEY=(genera una larga con python -c "import secrets; print(secrets.token_urlsafe(64))")

BACKEND_CORS_ORIGINS=https://app.tudominio.com
FRONTEND_URL=https://app.tudominio.com
BACKEND_PUBLIC_BASE_URL=https://api.tudominio.com

SAAS_OWNER_EMAIL=...
SAAS_OWNER_PASSWORD=...

SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
```

- Si el front está en **`https://tudominio.com`** y el API detrás del mismo dominio con **`/api/`**, entonces:
  - `BACKEND_CORS_ORIGINS=https://tudominio.com`
  - `FRONTEND_URL=https://tudominio.com`
  - `BACKEND_PUBLIC_BASE_URL=https://tudominio.com`

Guarda el archivo y restringe permisos:

```bash
chmod 600 /var/www/cdasoft/repo/backend/.env
```

---

## 10. Probar el backend a mano (una vez)

```bash
cd /var/www/cdasoft/repo/backend
source venv/bin/activate
export $(grep -v '^#' .env | xargs)   # carga variables; en algunos shells usa set -a; source .env; set +a
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

En otra sesión SSH:

```bash
curl -s http://127.0.0.1:8010/health
```

Debe responder JSON con `"status":"ok"`. Luego `Ctrl+C` en la primera terminal para detener uvicorn.

---

## 11. Servicio systemd (arranque automático)

Crea el unit (cambia rutas y puerto si aplica):

```bash
sudo nano /etc/systemd/system/cdasoft-backend.service
```

Contenido:

```ini
[Unit]
Description=CDASOFT API (FastAPI / Uvicorn)
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/cdasoft/repo/backend
EnvironmentFile=/var/www/cdasoft/repo/backend/.env
ExecStart=/var/www/cdasoft/repo/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010 --proxy-headers
Restart=always
RestartSec=5

# Subidas persistidas: logos de tenant y módulo documental (ajusta si cambias rutas en .env)
ReadWritePaths=/var/www/cdasoft/repo/backend/uploads /var/www/cdasoft/repo/backend/private_uploads

[Install]
WantedBy=multi-user.target
```

Permisos para que `www-data` lea el código y el `.env`:

```bash
sudo chown -R www-data:www-data /var/www/cdasoft/repo/backend
sudo chmod 600 /var/www/cdasoft/repo/backend/.env
sudo mkdir -p /var/www/cdasoft/repo/backend/uploads/tenant-logos
sudo mkdir -p /var/www/cdasoft/repo/backend/private_uploads/documentos
sudo chown -R www-data:www-data /var/www/cdasoft/repo/backend/uploads
sudo chown -R www-data:www-data /var/www/cdasoft/repo/backend/private_uploads
```

Si en `.env` usas otras rutas absolutas para `TENANT_LOGO_UPLOAD_DIR` o `DOCUMENTOS_STORAGE_DIR`, crea esos directorios y añade las mismas rutas en `ReadWritePaths=` del unit (systemd restringe escritura fuera de lo listado en algunas configuraciones).

Activa el servicio:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cdasoft-backend
sudo systemctl start cdasoft-backend
sudo systemctl status cdasoft-backend
```

Si falla: `sudo journalctl -u cdasoft-backend -n 80 --no-pager`

---

## 12. Nginx: un sitio nuevo (no toca los demás)

### Patrón recomendado: un dominio, front en `/` y API en `/api/`

Crea el archivo del sitio:

```bash
sudo nano /etc/nginx/sites-available/cdasoft
```

Contenido (ajusta `server_name` y rutas a `dist`):

```nginx
server {
    listen 80;
    server_name tudominio.com www.tudominio.com;

    # Subidas al API (documentos hasta ~25 MB por defecto; sube el valor si aumentas DOCUMENTOS_MAX_SIZE_MB)
    client_max_body_size 30M;

    root /var/www/cdasoft/repo/frontend/dist;
    index index.html;

    # Health check del API (FastAPI expone /health en la raíz, no bajo /api/v1)
    location = /health {
        proxy_pass http://127.0.0.1:8010/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Marca en páginas HTML del API (verificación certificación): logo completo, favicon y compat.
    location = /cdasoft-brand-logo.png {
        proxy_pass http://127.0.0.1:8010/cdasoft-brand-logo.png;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location = /cdasoft-favicon.png {
        proxy_pass http://127.0.0.1:8010/cdasoft-favicon.png;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location = /cdasoft-brand-icon.png {
        proxy_pass http://127.0.0.1:8010/cdasoft-brand-icon.png;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8010/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:8010/uploads/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Recursos de marca (`/cdasoft-*.png`) y comprobaciones con `curl`

El backend expone en la **raíz de la app** (no bajo `/api/v1`) tres PNG de marca para HTML generado por el API (p. ej. verificación de certificación en cuenta):

| Ruta | Uso |
|------|-----|
| `/cdasoft-brand-logo.png` | Logo completo |
| `/cdasoft-favicon.png` | Favicon (`<link rel="icon">`) |
| `/cdasoft-brand-icon.png` | Mismo recurso que el favicon (compatibilidad) |

Implementación: `backend/app/main.py` (resolución de archivos desde `app/utils`, `frontend/public`, etc.). Nginx debe tener los `location =` **antes** de `location /`, como en el ejemplo de arriba, para que el proxy llegue a Uvicorn.

**GET y HEAD:** las rutas aceptan **GET** y **HEAD**. Los navegadores usan GET; herramientas como `curl -I` envían **HEAD**. Si solo estuviera registrado GET, una petición HEAD devolvería **405** Method Not Allowed con `Allow: GET` y cuerpo JSON de error, aunque el recurso fuera correcto. Tras desplegar código que incluya ambos métodos, `curl -I https://tudominio.com/cdasoft-favicon.png` debe responder **200** y `Content-Type: image/png`.

Para comprobar solo cabeceras sin depender de HEAD:

```bash
curl -sD - -o /dev/null https://tudominio.com/cdasoft-favicon.png | head -8
```

Tras cambios en `main.py`, recuerda **`sudo systemctl restart cdasoft-backend`** en el VPS.

Habilita el sitio y recarga Nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/cdasoft /etc/nginx/sites-enabled/cdasoft
sudo nginx -t
sudo systemctl reload nginx
```

Si **otro proyecto** ya usa `server_name tudominio.com`, **no dupliques** el nombre: usa un subdominio solo para CDASOFT, por ejemplo `app.tudominio.com`, y pon ese nombre en `server_name`.

### Patrón alternativo: subdominio `app` + `api`

Dos archivos o dos bloques `server`, cada uno con su `server_name`, uno con `root` al `dist` y otro solo con `location /` hacia el proxy al 8010.

---

## 13. HTTPS con Let’s Encrypt

Cuando el DNS del dominio apunte a tu VPS:

```bash
sudo certbot --nginx -d tudominio.com -d www.tudominio.com
```

Certbot suele modificar el `server` para escuchar en 443. Vuelve a probar:

```bash
curl -s https://tudominio.com/health
```

Con el bloque `location = /health` anterior, ese path llega al backend. (La API REST sigue bajo `/api/v1/...`.)

**Importante:** en FastAPI el router está en prefijo `/api/v1`, pero **`/health`** está en la raíz de la app. Con el bloque anterior, la URL pública es **`https://tudominio.com/health`** (sin `/api/v1`). Para comprobar el API también puedes usar cualquier ruta bajo `/api/v1/` que no requiera auth, o temporalmente revisar logs.

---

## 14. Cron: automatizaciones (recordatorios, encuestas, etc.)

Desde la raíz del repo en el servidor (donde está `run_saas_automation.sh`):

```bash
crontab -e
```

Línea ejemplo (ajusta la ruta):

```cron
*/10 * * * * cd /var/www/cdasoft/repo && /bin/bash ./run_saas_automation.sh >> /var/www/cdasoft/repo/logs/saas_automation.log 2>&1
```

Crea la carpeta de logs si no existe:

```bash
mkdir -p /var/www/cdasoft/repo/logs
```

---

## 15. Actualizar CDASOFT sin romper otros proyectos

### 15.1 Protocolo fijo (obligatorio)

No hagas deploy si falla alguno de estos puntos:

- `main` está actualizado en remoto y fue validado en local/staging.
- `git status --porcelain` está **vacío** tanto en local como en VPS.
- Pull en VPS con `--ff-only` (evita merges inesperados durante deploy).
- Prechecks backend (`py_compile` + `import-ok`) pasan antes de reiniciar servicio.
- Existe tag estable de referencia para rollback rápido (ejemplo: `prod-stable-YYYY-MM-DD`).

### 15.2 Flujo recomendado de despliegue

En local (Windows/PC):

```bash
cd C:\Proyectos\SAAS-CDA
git checkout main
git pull --ff-only origin main
git status --porcelain
```

Si no está limpio, **detente** y no despliegues hasta resolver.

Build frontend con URL final:

```bash
cd frontend
# CDASOFT PROD: usar siempre el dominio canónico
# PowerShell: $env:VITE_API_URL="https://cdasoft.com.co/api/v1"
npm run build
```

> Si por operación excepcional compilas en el VPS (y no en local), primero exporta el canónico en esa sesión:
>
> ```bash
> cd /var/www/cdasoft/repo/frontend
> export VITE_API_URL="https://cdasoft.com.co/api/v1"
> npm run build
> ```
>
> Nunca ejecutar `npm run build` sin fijar `VITE_API_URL` en producción; puede incrustar `localhost` y provocar `Network Error` en login.

Verifica antes de subir que el build quedó con la URL correcta:

```bash
cd ..
grep -R -n "https://www\.cdasoft\.com/api/v1" frontend/dist/assets && echo "ERROR: build con URL no canónica" || echo "OK: build canónico"
grep -R -n "https://cdasoft\.com\.co/api/v1" frontend/dist/assets | head -n 5
grep -R -n "localhost:8000\|127\.0\.0\.1:8000\|http://127\.0\.0\.1" frontend/dist/assets && echo "ERROR: build apunta a localhost" || echo "OK: build sin localhost"
```

Si aparece algún `ERROR` en estos checks, **no** continúes el deploy.

Subir solo `dist` (o preferiblemente `dist_new` para swap atómico):

```bash
# ejemplo con rsync desde Git Bash / WSCP / scp
rsync -avz --delete ./frontend/dist/ USUARIO@IP:/var/www/cdasoft/repo/frontend/dist/
```

Alternativa recomendada para minimizar riesgo en horario operativo:

```bash
# Subir a carpeta temporal
rsync -avz --delete ./frontend/dist/ USUARIO@IP:/var/www/cdasoft/repo/frontend/dist_new/

# En VPS: swap atómico + rollback rápido
cd /var/www/cdasoft/repo/frontend
TS=$(date +%F-%H%M)
sudo mv dist "dist.prev-$TS"
sudo mv dist_new dist
sudo chown -R www-data:www-data dist
sudo nginx -t && sudo systemctl reload nginx
```

En VPS:

```bash
cd /var/www/cdasoft/repo
git status --porcelain
git pull --ff-only origin main
cd backend
sudo -u www-data ./venv/bin/python -m py_compile app/api/v1/endpoints/vehiculos.py app/api/v1/endpoints/exogena.py app/db/database.py app/models/factus.py app/models/exogena.py
sudo -u www-data ./venv/bin/python -c "import app.main; print('import-ok')"
sudo systemctl restart cdasoft-backend
curl -s http://127.0.0.1:8010/health
sudo chown -R www-data:www-data /var/www/cdasoft/repo/frontend/dist
sudo nginx -t && sudo systemctl reload nginx
```

### 15.3 Si el VPS no está limpio

Si `git status --porcelain` en VPS muestra cambios locales:

1. **No** ejecutes `git pull` todavía.
2. Evalúa si son cambios operativos reales o basura temporal.
3. Guarda temporalmente con `git stash push -m "vps-local-before-pull-YYYYMMDD"` solo si entiendes qué estás guardando.
4. Luego sí: `git pull --ff-only origin main`.

### 15.4 Rollback rápido (incidente)

Si algo falla tras deploy:

```bash
cd /var/www/cdasoft/repo
git fetch --tags
git checkout prod-stable-2026-06-26
cd backend
sudo systemctl restart cdasoft-backend
curl -s http://127.0.0.1:8010/health
```

Cuando estabilices, crea la rama/commit correcto para volver a `main` con trazabilidad.

---

## 16. Si algo falla (orden de revisión)

1. `sudo systemctl status cdasoft-backend` y `journalctl -u cdasoft-backend -n 100`
2. `sudo nginx -t` y `tail -n 50 /var/log/nginx/error.log`
3. `curl http://127.0.0.1:8010/health` desde el VPS
4. En el navegador, F12 → pestaña Red: ver a qué URL pega el front y si hay errores CORS

---

## 17. Qué más hay que hacer (resumen)

- [ ] DNS del dominio apuntando al VPS.
- [ ] `.env` de producción completo y **`DEBUG=False`**.
- [ ] **`VITE_API_URL`** coherente con cómo quedó Nginx.
- [ ] **`BACKEND_CORS_ORIGINS`** con la URL exacta del front.
- [ ] Contraseñas fuertes (DB, owner SaaS, JWT `SECRET_KEY`).
- [ ] Certbot / HTTPS.
- [ ] Cron de automatización.
- [ ] Backups de PostgreSQL (fuera del alcance de esta guía, imprescindible en producción).
- [ ] Backup del disco de **`private_uploads/documentos`** (y logos) si usan el módulo documental.

Si me indicas **si usarás un solo dominio con `/api/` o dos subdominios**, y el **sistema del VPS** (Ubuntu 22.04, etc.), puedes pegar aquí tu `server_name` y rutas y te devuelvo los bloques Nginx y el valor exacto de `VITE_API_URL` sin ambigüedad.
