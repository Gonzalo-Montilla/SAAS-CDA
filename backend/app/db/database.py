"""
Configuración de base de datos PostgreSQL
"""
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from uuid import UUID
from app.core.config import settings

# Motor de base de datos
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20
)

# Sesión
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base para modelos
Base = declarative_base()


def ensure_tenant_baseline_schema(db):
    """
    Asegura baseline multitenant sin romper instalaciones existentes.
    """
    default_tenant_id = settings.SAAS_DEFAULT_TENANT_ID
    default_tenant_slug = settings.SAAS_DEFAULT_TENANT_SLUG
    default_tenant_name = settings.SAAS_DEFAULT_TENANT_NAME

    # Validar formato UUID del tenant default configurado
    UUID(default_tenant_id)

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS tenants (
                id UUID PRIMARY KEY,
                nombre VARCHAR(200) NOT NULL,
                slug VARCHAR(120) UNIQUE NOT NULL,
                activo BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            )
            """
        )
    )

    db.execute(
        text(
            """
            INSERT INTO tenants (id, nombre, slug, activo, created_at)
            VALUES (:tenant_id, :tenant_name, :tenant_slug, TRUE, NOW())
            ON CONFLICT (slug) DO NOTHING
            """
        ),
        {
            "tenant_id": default_tenant_id,
            "tenant_name": default_tenant_name,
            "tenant_slug": default_tenant_slug,
        },
    )

    tenant_column_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'usuarios' AND column_name = 'tenant_id'
            """
        )
    ).scalar()

    if not tenant_column_exists:
        db.execute(text("ALTER TABLE usuarios ADD COLUMN tenant_id UUID"))

    db.execute(
        text(
            """
            UPDATE usuarios
            SET tenant_id = :tenant_id
            WHERE tenant_id IS NULL
            """
        ),
        {"tenant_id": default_tenant_id},
    )

    db.execute(text("ALTER TABLE usuarios ALTER COLUMN tenant_id SET NOT NULL"))

    fk_exists = db.execute(
        text(
            """
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_usuarios_tenant_id'
            """
        )
    ).scalar()
    if not fk_exists:
        db.execute(
            text(
                """
                ALTER TABLE usuarios
                ADD CONSTRAINT fk_usuarios_tenant_id
                FOREIGN KEY (tenant_id) REFERENCES tenants(id)
                """
            )
        )

    idx_exists = db.execute(
        text(
            """
            SELECT 1
            FROM pg_indexes
            WHERE tablename = 'usuarios' AND indexname = 'ix_usuarios_tenant_id'
            """
        )
    ).scalar()
    if not idx_exists:
        db.execute(text("CREATE INDEX ix_usuarios_tenant_id ON usuarios(tenant_id)"))


def get_db():
    """
    Dependency para obtener sesión de base de datos
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    Inicializar base de datos: crear tablas y datos iniciales
    """
    from app.models.usuario import Usuario
    from app.models.tenant import Tenant
    from app.models.tarifa import Tarifa, ComisionSOAT
    from app.models.caja import Caja, MovimientoCaja
    from app.models.vehiculo import VehiculoProceso
    from app.core.security import get_password_hash
    from datetime import date
    
    # Crear todas las tablas
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    try:
        ensure_tenant_baseline_schema(db)

        default_tenant = db.query(Tenant).filter(
            Tenant.slug == settings.SAAS_DEFAULT_TENANT_SLUG
        ).first()
        if not default_tenant:
            raise RuntimeError("No se pudo inicializar tenant default")

        # Verificar si ya existe usuario admin
        admin_exists = db.query(Usuario).filter(Usuario.email == "admin@cdalaflorida.com").first()
        
        if not admin_exists:
            print("📝 Creando usuario administrador inicial...")
            
            # Crear usuario administrador
            admin = Usuario(
                tenant_id=default_tenant.id,
                email="admin@cdalaflorida.com",
                hashed_password=get_password_hash("admin123"),
                nombre_completo="Administrador CDA",
                rol="administrador",
                activo=True
            )
            db.add(admin)
            db.flush()
            
            print("✅ Usuario administrador creado")
            print("   Email: admin@cdalaflorida.com")
            print("   Password: admin123")
            
            # Crear tarifas 2025 para motos
            print("\n📋 Creando tarifas 2025...")
            
            tarifas_2025 = [
                # 0-2 años (modelos 2023-2025)
                Tarifa(
                    ano_vigencia=2025,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=date(2025, 12, 31),
                    antiguedad_min=0,
                    antiguedad_max=2,
                    valor_rtm=181596,
                    valor_terceros=24056,
                    valor_total=205652,
                    activa=True,
                    created_by=admin.id
                ),
                # 3-7 años (modelos 2018-2022)
                Tarifa(
                    ano_vigencia=2025,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=date(2025, 12, 31),
                    antiguedad_min=3,
                    antiguedad_max=7,
                    valor_rtm=181896,
                    valor_terceros=24056,
                    valor_total=205952,
                    activa=True,
                    created_by=admin.id
                ),
                # 8-16 años (modelos 2009-2017)
                Tarifa(
                    ano_vigencia=2025,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=date(2025, 12, 31),
                    antiguedad_min=8,
                    antiguedad_max=16,
                    valor_rtm=182196,
                    valor_terceros=24056,
                    valor_total=206252,
                    activa=True,
                    created_by=admin.id
                ),
                # 17+ años (modelos 2008 hacia atrás)
                Tarifa(
                    ano_vigencia=2025,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=date(2025, 12, 31),
                    antiguedad_min=17,
                    antiguedad_max=None,
                    valor_rtm=181896,
                    valor_terceros=24056,
                    valor_total=205952,
                    activa=True,
                    created_by=admin.id
                ),
            ]
            
            for tarifa in tarifas_2025:
                db.add(tarifa)
            
            print("✅ Tarifas 2025 creadas (4 rangos de antigüedad)")
            
            # Crear comisiones SOAT
            print("\n💰 Creando comisiones SOAT...")
            
            comisiones = [
                ComisionSOAT(
                    tipo_vehiculo="moto",
                    valor_comision=30000,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=None,
                    activa=True,
                    created_by=admin.id
                ),
                ComisionSOAT(
                    tipo_vehiculo="carro",
                    valor_comision=50000,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=None,
                    activa=True,
                    created_by=admin.id
                ),
            ]
            
            for comision in comisiones:
                db.add(comision)
            
            print("✅ Comisiones SOAT creadas (Moto: $30K, Carro: $50K)")
            
            db.commit()
            print("\n🎉 Base de datos inicializada correctamente\n")
        else:
            print("ℹ️  Base de datos ya inicializada")
            
    except Exception as e:
        print(f"❌ Error inicializando base de datos: {e}")
        db.rollback()
    finally:
        db.close()
