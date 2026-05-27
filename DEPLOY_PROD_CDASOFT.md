# Despliegue a producción — CDASOFT (referencia fija)

Usar **solo estas rutas y dominios** para no mezclar con otras apps del mismo VPS (`cda-piendamo`, `cda-laflorida`, etc.).

| Qué | Valor exacto |
|-----|----------------|
| Dominio público (HTTPS) | `https://www.cdasoft.com.co` (también `https://cdasoft.com.co`) |
| API en el navegador | `https://www.cdasoft.com.co/api/v1` |
| Health (mismo host) | `https://www.cdasoft.com.co/health` |
| Repo Git en el servidor | `/var/www/cdasoft/repo` |
| Backend (código, `.env`, `venv`) | `/var/www/cdasoft/repo/backend` |
| Frontend servido por Nginx | **`/var/www/cdasoft/repo/frontend/dist`** ← `root` en `sites-enabled/cdasoft` |
| Servicio systemd | `cdasoft-backend.service` |
| Puerto interno Uvicorn | `127.0.0.1:8010` |
| SSH (ejemplo) | `root@31.97.144.9` |

**No usar** para CDASOFT: `/var/www/cdasoft/backend` (carpeta suelta sin `venv`; el deploy real está bajo `repo/backend`).

---

## Regla obligatoria (frontend)

Si el commit toca cualquier archivo de `frontend/src` o `frontend/public`, el deploy **debe** incluir:

1. `npm run build` en local con `VITE_API_URL` de producción.
2. `scp` del contenido de `frontend/dist/*` al VPS.

No basta con hacer `git pull` + reinicio de backend.  
Sin `build + scp`, en producción se seguirá viendo el frontend anterior.

---

## 1. En tu PC (Windows, PowerShell)

### 1.1 Build del frontend

La URL debe ser la misma que usará el navegador para llamar al API (mismo dominio + `/api/v1`):

```powershell
cd C:\Proyectos\SAAS-CDA\frontend
$env:VITE_API_URL="https://www.cdasoft.com.co/api/v1"
npm run build
```

Comprobar que exista `C:\Proyectos\SAAS-CDA\frontend\dist\index.html`.

### 1.2 Subir solo el `dist` al servidor

```powershell
cd C:\Proyectos\SAAS-CDA
scp -r frontend/dist/* root@31.97.144.9:/var/www/cdasoft/repo/frontend/dist/
```

(Ajustar usuario/IP si no entras como `root` o la IP cambia.)

---

## 2. En el VPS (SSH)

```bash
ssh root@31.97.144.9
```

### 2.1 Código (backend + fuente front en repo)

```bash
cd /var/www/cdasoft/repo
git pull origin main
```

### 2.2 Dependencias Python (como `www-data`, mismo dueño que el servicio)

```bash
cd /var/www/cdasoft/repo/backend
sudo -u www-data ./venv/bin/pip install -r requirements.txt
```

### 2.3 Reiniciar API CDASOFT

**Importante:** en este servidor hay varios servicios (`cda-backend`, `cda-laflorida`, `cdasoft-backend`). Para **este** producto:

```bash
sudo systemctl restart cdasoft-backend
sudo systemctl status cdasoft-backend --no-pager
```

### 2.4 Permisos del `dist` y Nginx

```bash
sudo chown -R www-data:www-data /var/www/cdasoft/repo/frontend/dist
sudo nginx -t && sudo systemctl reload nginx
```

### 2.5 Comprobaciones rápidas

```bash
curl -s http://127.0.0.1:8010/health
curl -sI https://www.cdasoft.com.co/health | head -5
```

---

## 3. Tras desplegar

- Probar la web en **ventana privada** o recarga fuerte (**Ctrl+F5**) para evitar caché del `index.html` viejo.
- Si solo reiniciaste backend y “no se ve nada nuevo” en pantalla, casi siempre falta el paso **`npm run build` + `scp` a `repo/frontend/dist`**.

---

## 4. Unit systemd (referencia)

Archivo: `/etc/systemd/system/cdasoft-backend.service`

Debe incluir al menos:

- `WorkingDirectory=/var/www/cdasoft/repo/backend`
- `EnvironmentFile=/var/www/cdasoft/repo/backend/.env`
- `ExecStart=.../var/www/cdasoft/repo/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010 --proxy-headers`

Si usas documentos / `private_uploads`, en `[Service]` puede ir:

```ini
ReadWritePaths=/var/www/cdasoft/repo/backend/uploads /var/www/cdasoft/repo/backend/private_uploads
```

(Esa línea va **dentro del archivo** del servicio, no se ejecuta en la consola.)

Luego: `sudo systemctl daemon-reload` y `sudo systemctl restart cdasoft-backend`.

---

## 5. Checklist mínimo

- [ ] `git push` desde tu PC (rama `main`) antes del `git pull` en el VPS.
- [ ] `git pull` en `/var/www/cdasoft/repo`.
- [ ] `pip install -r requirements.txt` en `repo/backend` (como `www-data`).
- [ ] `systemctl restart cdasoft-backend` (no confundir con `cda-backend`).
- [ ] Si hubo cambios en frontend: `npm run build` con `VITE_API_URL` de **`.com.co`**.
- [ ] Si hubo cambios en frontend: `scp` de `dist/*` a **`/var/www/cdasoft/repo/frontend/dist/`**.
- [ ] `chown` + `reload nginx` si hace falta.
- [ ] Probar en navegador con caché limpia.
