"""
Aplica la migración de rate limit para onboarding (registro público CDA).
"""
import psycopg2
from app.core.config import settings


def parse_database_url(db_url: str):
    normalized = db_url.replace("postgresql://", "", 1)
    auth, rest = normalized.split("@", 1)
    user, password = auth.split(":", 1)
    host_port, database = rest.split("/", 1)
    host, port = host_port.split(":", 1)
    return {
        "user": user,
        "password": password,
        "host": host,
        "port": int(port),
        "database": database,
    }


def apply_migration():
    params = parse_database_url(settings.DATABASE_URL)
    print(f"Conectando a {params['host']}:{params['port']}/{params['database']}...")
    conn = psycopg2.connect(
        user=params["user"],
        password=params["password"],
        host=params["host"],
        port=params["port"],
        database=params["database"],
    )

    try:
        with open("migrations/add_onboarding_rate_limit.sql", "r", encoding="utf-8") as f:
            sql = f.read()

        print("Aplicando migración de seguridad onboarding (rate limit)...")
        cursor = conn.cursor()
        cursor.execute(sql)
        conn.commit()
        cursor.close()
        print("✅ Migración aplicada exitosamente")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error al aplicar migración: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    apply_migration()
