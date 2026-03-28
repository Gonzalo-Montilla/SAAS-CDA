# 🔐 Sistema de Recuperación de Contraseña

## Estado Actual

✅ **Implementado y funcional**
- Modal "¿Olvidaste tu contraseña?" en el login
- Endpoints backend completos
- Base de datos configurada
- Página de reset password
- Tokens seguros con expiración de 30 minutos

⚠️ **Pendiente**: Configuración de credenciales SMTP de Gmail

---

## Funcionamiento

El sistema está **completamente implementado** pero el envío de emails está **desactivado** hasta que se configuren las credenciales SMTP.

### Sin configuración SMTP:
- ✅ Login funciona normalmente
- ✅ Todos los módulos operativos
- ✅ Modal visible en login
- ❌ No se pueden enviar emails de recuperación

### Con configuración SMTP:
- ✅ Todo lo anterior
- ✅ Envío automático de emails de recuperación
- ✅ Usuarios pueden resetear su contraseña sin admin

---

## 🚀 Activar Envío de Emails

### Paso 1: Generar Contraseña de Aplicación en Gmail

1. Inicia sesión en Gmail: `cdasoft@gmail.com`
2. Ve a: https://myaccount.google.com/security
3. Activa "Verificación en 2 pasos" (si no está activada)
4. Busca "Contraseñas de aplicaciones"
5. Genera contraseña para "CDASOFT Sistema"
6. Copia la contraseña de 16 caracteres

### Paso 2: Actualizar Configuración

Edita `backend/.env`:

```env
SMTP_USER=cdasoft@gmail.com
SMTP_PASSWORD=tu_contraseña_de_16_caracteres_aqui
```

### Paso 3: Reiniciar Backend

```powershell
# Detén el backend (Ctrl+C)
# Inicia nuevamente
python run.py
```

### Paso 4: Probar

1. Ve al login
2. Haz clic en "¿Olvidaste tu contraseña?"
3. Ingresa un email de usuario existente
4. Revisa el email en `cdasoft@gmail.com`
5. Haz clic en el enlace
6. Cambia la contraseña

---

## 📁 Archivos Relacionados

### Backend
- `backend/app/api/v1/endpoints/auth.py` - Endpoints de recuperación
- `backend/app/models/password_reset_token.py` - Modelo de tokens
- `backend/app/utils/email.py` - Utilidad de envío de emails
- `backend/migrations/create_password_reset_tokens.sql` - Migración (✅ ejecutada)
- `backend/app/core/config.py` - Configuración SMTP

### Frontend
- `frontend/src/pages/Login.tsx` - Modal "¿Olvidaste tu contraseña?"
- `frontend/src/pages/ResetPassword.tsx` - Página de reset

### Documentación
- `CONFIGURACION_EMAIL.md` - Guía detallada de configuración

---

## 🔒 Seguridad

- ✅ Tokens válidos por **30 minutos**
- ✅ Tokens de **un solo uso**
- ✅ Tokens **aleatorios** (32 bytes)
- ✅ Contraseñas **hasheadas** con bcrypt
- ✅ No revela si un email existe
- ✅ Email con template HTML profesional

---

## 🐛 Troubleshooting

### "Error al enviar el email"
- Verifica que `SMTP_PASSWORD` sea la contraseña de aplicación (no la contraseña normal)
- Reinicia el backend después de cambiar `.env`

### No llega el email
- Revisa la carpeta de spam
- Verifica que las credenciales sean correctas
- Revisa logs del backend para errores específicos

### Token inválido o expirado
- Los tokens expiran en 30 minutos
- Solicita un nuevo enlace de recuperación

---

## 📝 Notas

- El sistema funciona **sin configuración SMTP** para desarrollo
- La funcionalidad se **activa automáticamente** al configurar credenciales
- No requiere cambios en el código, solo configuración
- Ideal para uso en producción con dominio propio

---

## 📞 Contacto

Para configurar o si tienes problemas, revisa:
1. Este README
2. `CONFIGURACION_EMAIL.md`
3. Logs del backend
