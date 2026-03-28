import asyncio
import asyncpg
from app.core.config import settings

async def apply_migration():
    # Extraer parámetros de la URL de conexión
    # DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cdasoft
    db_url = settings.DATABASE_URL
    parts = db_url.replace("postgresql://", "").split("@")
    user_pass = parts[0].split(":")
    host_db = parts[1].split("/")
    host_port = host_db[0].split(":")
    
    user = user_pass[0]
    password = user_pass[1]
    host = host_port[0]
    port = int(host_port[1])
    database = host_db[1]
    
    print(f"Conectando a {host}:{port}/{database}...")
    
    conn = await asyncpg.connect(
        user=user,
        password=password,
        database=database,
        host=host,
        port=port
    )
    
    try:
        # Leer archivo SQL
        with open('migrations/add_desglose_efectivo_cierre.sql', 'r', encoding='utf-8') as f:
            sql = f.read()
        
        print("Aplicando migración...")
        await conn.execute(sql)
        print("✅ Migración aplicada exitosamente")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        raise
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(apply_migration())
