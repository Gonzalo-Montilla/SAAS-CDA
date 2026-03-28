# Configuración de Email para Recuperación de Contraseña

Este documento explica cómo configurar el envío de emails usando Gmail para la funcionalidad de "Olvidé mi contraseña".

## Requisitos

- Cuenta de Gmail: `cdasoft@gmail.com` (o la que uses)
- Acceso a la configuración de seguridad de Google

## Pasos para Configurar

### 1. Generar Contraseña de Aplicación en Gmail

Google no permite usar tu contraseña normal para aplicaciones. Debes crear una "Contraseña de Aplicación":

#### Opción A: Si tienes verificación en 2 pasos activada

1. Inicia sesión en Gmail con `cdasoft@gmail.com`
2. Ve a: https://myaccount.google.com/security
3. En "Cómo inicias sesión en Google", busca "Contraseñas de aplicaciones"
4. Haz clic en "Contraseñas de aplicaciones"
5. Selecciona:
   - **App**: Correo
   - **Dispositivo**: Otro (nombre personalizado)
   - Nombre: "CDASOFT Sistema"
6. Haz clic en "Generar"
7. Google te mostrará una contraseña de 16 caracteres (ej: `abcd efgh ijkl mnop`)
8. **IMPORTANTE**: Copia esta contraseña, la necesitarás para el `.env`

#### Opción B: Si NO tienes verificación en 2 pasos

1. Primero activa la verificación en 2 pasos:
   - Ve a: https://myaccount.google.com/security
   - Busca "Verificación en 2 pasos" y actívala
   - Sigue los pasos (necesitarás tu teléfono)
2. Luego sigue los pasos de la "Opción A"

### 2. Configurar Variables de Entorno

Edita el archivo `backend/.env` y agrega estas líneas:

```env
# Configuración SMTP para envío de emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=cdasoft@gmail.com
SMTP_PASSWORD=xxxx xxxx xxxx xxxx
FRONTEND_URL=http://localhost:5173
```

**Reemplaza**:
- `SMTP_USER`: Email de Gmail que usarás
- `SMTP_PASSWORD`: La contraseña de aplicación de 16 caracteres que generaste en el paso 1
- `FRONTEND_URL`: URL del frontend (en producción será tu dominio real)

### 3. Ejecutar Migración de Base de Datos

Ejecuta la migración SQL para crear la tabla de tokens:

```bash
# Conéctate a PostgreSQL
psql -U postgres -d cdasoft

# Ejecuta la migración
\i backend/migrations/create_password_reset_tokens.sql

# Sal de psql
\q
```

### 4. Reiniciar Backend

Reinicia el servidor backend para que cargue las nuevas variables de entorno.

## Cómo Funciona

1. **Usuario olvida contraseña**:
   - En el login, hace clic en "¿Olvidaste tu contraseña?"
   - Ingresa su email

2. **Sistema envía email**:
   - Backend genera token único válido por 30 minutos
   - Envía email a través de Gmail con enlace de recuperación
   - Email contiene: `http://localhost:5173/reset-password?token=abc123...`

3. **Usuario hace clic en el enlace**:
   - Se abre página de reset password
   - Ingresa nueva contraseña
   - Token se valida y marca como usado
   - Contraseña se actualiza

## Seguridad

- ✅ Los tokens expiran en **30 minutos**
- ✅ Los tokens solo se pueden usar **una vez**
- ✅ Los tokens son **aleatorios y seguros** (32 bytes)
- ✅ Las contraseñas se guardan **hasheadas** con bcrypt
- ✅ No se revela si un email existe en el sistema

## Troubleshooting

### Error: "Error al enviar el email"

**Causa**: Contraseña de aplicación incorrecta o no configurada

**Solución**:
1. Verifica que `SMTP_PASSWORD` en `.env` sea correcto
2. Asegúrate de usar la contraseña de aplicación (16 caracteres), NO tu contraseña de Gmail normal
3. Reinicia el backend después de cambiar `.env`

### Error: "Token inválido o expirado"

**Causa**: El token expiró (más de 30 minutos) o ya fue usado

**Solución**:
- Solicita un nuevo enlace de recuperación desde el login

### No llega el email

**Posibles causas**:
1. **Email en spam**: Revisa la carpeta de spam/correo no deseado
2. **Cuenta Gmail bloqueada**: Gmail puede bloquear el envío si detecta actividad sospechosa
3. **Variables mal configuradas**: Verifica `SMTP_USER` y `SMTP_PASSWORD` en `.env`

**Solución**:
1. Revisa logs del backend para ver errores específicos
2. Verifica que la cuenta Gmail esté activa
3. Intenta enviar un email de prueba desde Gmail manualmente

## Testing

Para probar la funcionalidad:

1. Ve al login: `http://localhost:5173/login`
2. Haz clic en "¿Olvidaste tu contraseña?"
3. Ingresa un email de usuario existente
4. Revisa el email
5. Haz clic en el enlace del email
6. Ingresa nueva contraseña
7. Intenta hacer login con la nueva contraseña

## Producción

Cuando despliegues en producción:

1. Actualiza `FRONTEND_URL` en `.env` con tu dominio real:
   ```env
   FRONTEND_URL=https://tudominio.com
   ```

2. Los emails llegarán con enlaces como:
   ```
   https://tudominio.com/reset-password?token=abc123...
   ```

3. Considera usar un servicio SMTP profesional para mejor deliverability:
   - SendGrid (gratis hasta 100 emails/día)
   - AWS SES (muy económico)
   - Mailgun (gratis hasta 5000 emails/mes)

## Contacto

Si tienes problemas, revisa:
- Logs del backend
- Configuración de Gmail
- Variables de entorno en `.env`
