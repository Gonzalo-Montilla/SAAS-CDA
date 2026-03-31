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
                nit_cda VARCHAR(30),
                correo_electronico VARCHAR(255),
                nombre_representante VARCHAR(200),
                celular VARCHAR(30),
                nombre_comercial VARCHAR(200) NOT NULL DEFAULT 'CDASOFT',
                logo_url VARCHAR(500),
                color_primario VARCHAR(20) NOT NULL DEFAULT '#2563eb',
                color_secundario VARCHAR(20) NOT NULL DEFAULT '#0f172a',
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            )
            """
        )
    )

    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nombre_comercial VARCHAR(200)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS color_primario VARCHAR(20)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS color_secundario VARCHAR(20)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nit_cda VARCHAR(30)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS correo_electronico VARCHAR(255)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nombre_representante VARCHAR(200)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS celular VARCHAR(30)"))
    db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_nit_cda ON tenants(nit_cda) WHERE nit_cda IS NOT NULL"))

    db.execute(text("UPDATE tenants SET nombre_comercial = COALESCE(nombre_comercial, nombre)"))
    db.execute(text("UPDATE tenants SET color_primario = COALESCE(color_primario, '#2563eb')"))
    db.execute(text("UPDATE tenants SET color_secundario = COALESCE(color_secundario, '#0f172a')"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN nombre_comercial SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN color_primario SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN color_secundario SET NOT NULL"))

    db.execute(
        text(
            """
            INSERT INTO tenants (
                id,
                nombre,
                slug,
                activo,
                nit_cda,
                correo_electronico,
                nombre_representante,
                celular,
                nombre_comercial,
                logo_url,
                color_primario,
                color_secundario,
                created_at
            )
            VALUES (
                :tenant_id,
                :tenant_name,
                :tenant_slug,
                TRUE,
                NULL,
                NULL,
                NULL,
                NULL,
                :tenant_name,
                NULL,
                '#2563eb',
                '#0f172a',
                NOW()
            )
            ON CONFLICT (slug) DO NOTHING
            """
        ),
        {
            "tenant_id": default_tenant_id,
            "tenant_name": default_tenant_name,
            "tenant_slug": default_tenant_slug,
        },
    )

    db.execute(
        text(
            """
            UPDATE tenants
            SET nombre_comercial = :tenant_name,
                color_primario = '#2563eb',
                color_secundario = '#0f172a'
            WHERE slug = :tenant_slug
              AND (nombre_comercial IS NULL OR nombre_comercial = '')
            """
        ),
        {
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


def ensure_tenant_domain_schema(db):
    """
    Asegura columnas tenant_id en tablas de dominio para fase 2.
    """
    db.execute(text("ALTER TABLE cajas ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(text("ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(text("ALTER TABLE desglose_efectivo_cierre ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(text("ALTER TABLE vehiculos_proceso ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(text("ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(text("ALTER TABLE comisiones_soat ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(text("ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(text("ALTER TABLE desglose_efectivo_tesoreria ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(text("ALTER TABLE configuracion_tesoreria ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(text("ALTER TABLE notificaciones_cierre_caja ADD COLUMN IF NOT EXISTS tenant_id UUID"))

    db.execute(
        text(
            """
            UPDATE cajas c
            SET tenant_id = u.tenant_id
            FROM usuarios u
            WHERE c.tenant_id IS NULL AND c.usuario_id = u.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE movimientos_caja m
            SET tenant_id = c.tenant_id
            FROM cajas c
            WHERE m.tenant_id IS NULL AND m.caja_id = c.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE desglose_efectivo_cierre d
            SET tenant_id = c.tenant_id
            FROM cajas c
            WHERE d.tenant_id IS NULL AND d.caja_id = c.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE vehiculos_proceso v
            SET tenant_id = u.tenant_id
            FROM usuarios u
            WHERE v.tenant_id IS NULL AND v.registrado_por = u.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE vehiculos_proceso v
            SET tenant_id = c.tenant_id
            FROM cajas c
            WHERE v.tenant_id IS NULL AND v.caja_id = c.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE tarifas t
            SET tenant_id = u.tenant_id
            FROM usuarios u
            WHERE t.tenant_id IS NULL AND t.created_by = u.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE comisiones_soat c
            SET tenant_id = u.tenant_id
            FROM usuarios u
            WHERE c.tenant_id IS NULL AND c.created_by = u.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE movimientos_tesoreria m
            SET tenant_id = u.tenant_id
            FROM usuarios u
            WHERE m.tenant_id IS NULL AND m.created_by = u.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE desglose_efectivo_tesoreria d
            SET tenant_id = m.tenant_id
            FROM movimientos_tesoreria m
            WHERE d.tenant_id IS NULL AND d.movimiento_id = m.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE configuracion_tesoreria c
            SET tenant_id = u.tenant_id
            FROM usuarios u
            WHERE c.tenant_id IS NULL AND c.updated_by = u.id
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE notificaciones_cierre_caja n
            SET tenant_id = c.tenant_id
            FROM cajas c
            WHERE n.tenant_id IS NULL AND n.caja_id = c.id
            """
        )
    )

    db.execute(text("UPDATE cajas SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})
    db.execute(text("UPDATE movimientos_caja SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})
    db.execute(text("UPDATE desglose_efectivo_cierre SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})
    db.execute(text("UPDATE vehiculos_proceso SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})
    db.execute(text("UPDATE tarifas SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})
    db.execute(text("UPDATE comisiones_soat SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})
    db.execute(text("UPDATE movimientos_tesoreria SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})
    db.execute(text("UPDATE desglose_efectivo_tesoreria SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})
    db.execute(text("UPDATE configuracion_tesoreria SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})
    db.execute(text("UPDATE notificaciones_cierre_caja SET tenant_id = :tenant_id WHERE tenant_id IS NULL"), {"tenant_id": settings.SAAS_DEFAULT_TENANT_ID})


def ensure_onboarding_security_schema(db):
    """
    Asegura tabla para rate limiting del onboarding público.
    """
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS onboarding_registration_attempts (
                id SERIAL PRIMARY KEY,
                ip_address VARCHAR(64) NOT NULL,
                admin_email VARCHAR(255) NOT NULL,
                tenant_nombre VARCHAR(200),
                successful BOOLEAN NOT NULL DEFAULT FALSE,
                failure_reason VARCHAR(120),
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_onboarding_attempts_ip_created
            ON onboarding_registration_attempts(ip_address, created_at)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_onboarding_attempts_email_created
            ON onboarding_registration_attempts(admin_email, created_at)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS onboarding_email_verifications (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                code_hash VARCHAR(128) NOT NULL,
                expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                verified BOOLEAN NOT NULL DEFAULT FALSE,
                verified_at TIMESTAMP WITHOUT TIME ZONE,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_onboarding_email_verifications_expires
            ON onboarding_email_verifications(expires_at)
            """
        )
    )


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
    from app.models.saas_user import SaaSUser
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

        ensure_tenant_domain_schema(db)
        ensure_onboarding_security_schema(db)
        db.commit()

        # Verificar y crear owner global SaaS
        saas_owner = db.query(SaaSUser).filter(SaaSUser.email == settings.SAAS_OWNER_EMAIL).first()
        if not saas_owner:
            owner = SaaSUser(
                email=settings.SAAS_OWNER_EMAIL,
                hashed_password=get_password_hash(settings.SAAS_OWNER_PASSWORD),
                nombre_completo=settings.SAAS_OWNER_NAME,
                rol_global="owner",
                activo=True,
            )
            db.add(owner)
            db.commit()
            print("[OK] Usuario global SaaS owner creado")
            print(f"   Email: {settings.SAAS_OWNER_EMAIL}")
            print("   Password: [SAAS_OWNER_PASSWORD desde .env]")

        # Verificar si ya existe usuario admin
        admin_exists = db.query(Usuario).filter(Usuario.email == "admin@cdasoft.com").first()
        
        if not admin_exists:
            print("[INIT] Creando usuario administrador inicial...")
            
            # Crear usuario administrador
            admin = Usuario(
                tenant_id=default_tenant.id,
                email="admin@cdasoft.com",
                hashed_password=get_password_hash("admin123"),
                nombre_completo="Administrador CDA",
                rol="administrador",
                activo=True
            )
            db.add(admin)
            db.flush()
            
            print("[OK] Usuario administrador creado")
            print("   Email: admin@cdasoft.com")
            print("   Password: admin123")
            
            # Crear tarifas 2025 para motos
            print("\n[INIT] Creando tarifas 2025...")
            
            tarifas_2025 = [
                # 0-2 años (modelos 2023-2025)
                Tarifa(
                    tenant_id=default_tenant.id,
                    ano_vigencia=2025,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=date(2025, 12, 31),
                    tipo_vehiculo="moto",
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
                    tenant_id=default_tenant.id,
                    ano_vigencia=2025,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=date(2025, 12, 31),
                    tipo_vehiculo="moto",
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
                    tenant_id=default_tenant.id,
                    ano_vigencia=2025,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=date(2025, 12, 31),
                    tipo_vehiculo="moto",
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
                    tenant_id=default_tenant.id,
                    ano_vigencia=2025,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=date(2025, 12, 31),
                    tipo_vehiculo="moto",
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
            
            print("[OK] Tarifas 2025 creadas (4 rangos de antiguedad)")
            
            # Crear comisiones SOAT
            print("\n[INIT] Creando comisiones SOAT...")
            
            comisiones = [
                ComisionSOAT(
                    tenant_id=default_tenant.id,
                    tipo_vehiculo="moto",
                    valor_comision=30000,
                    vigencia_inicio=date(2025, 1, 1),
                    vigencia_fin=None,
                    activa=True,
                    created_by=admin.id
                ),
                ComisionSOAT(
                    tenant_id=default_tenant.id,
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
            
            print("[OK] Comisiones SOAT creadas (Moto: $30K, Carro: $50K)")
            
            db.commit()
            print("\n[OK] Base de datos inicializada correctamente\n")
        else:
            print("[INFO] Base de datos ya inicializada")
            
    except Exception as e:
        print(f"[ERROR] Error inicializando base de datos: {e}")
        db.rollback()
    finally:
        db.close()
