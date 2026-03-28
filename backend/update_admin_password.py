from app.db.database import SessionLocal
from app.models.usuario import Usuario
from app.core.security import get_password_hash

db = SessionLocal()

# Actualizar todos los usuarios admin
admin_users = db.query(Usuario).filter(Usuario.rol == "administrador").all()

for admin in admin_users:
    admin.email = "admin@cdasoft.com"
    admin.hashed_password = get_password_hash("admin123")
    print(f"✅ Actualizado: {admin.email}")

db.commit()
db.close()

print("\n🎉 Contraseñas actualizadas correctamente")
print("Email: admin@cdasoft.com")
print("Password: admin123")
