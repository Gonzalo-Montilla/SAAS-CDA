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
                plan_actual VARCHAR(30) NOT NULL DEFAULT 'demo',
                subscription_status VARCHAR(30) NOT NULL DEFAULT 'trial',
                sedes_totales INTEGER NOT NULL DEFAULT 1,
                plan_started_at TIMESTAMP WITHOUT TIME ZONE,
                plan_ends_at TIMESTAMP WITHOUT TIME ZONE,
                demo_ends_at TIMESTAMP WITHOUT TIME ZONE,
                billing_cycle_days INTEGER NOT NULL DEFAULT 30,
                next_billing_at TIMESTAMP WITHOUT TIME ZONE,
                last_payment_at TIMESTAMP WITHOUT TIME ZONE,
                nomina_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                sarlaft_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                sarlaft_mode VARCHAR(20) NOT NULL DEFAULT 'manual',
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
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_actual VARCHAR(30)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(30)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sedes_totales INTEGER"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_ends_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS demo_ends_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle_days INTEGER"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS next_billing_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nomina_enabled BOOLEAN"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sarlaft_enabled BOOLEAN"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sarlaft_mode VARCHAR(20)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nit_cda VARCHAR(30)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS correo_electronico VARCHAR(255)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nombre_representante VARCHAR(200)"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS celular VARCHAR(30)"))
    db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_nit_cda ON tenants(nit_cda) WHERE nit_cda IS NOT NULL"))

    db.execute(text("UPDATE tenants SET nombre_comercial = COALESCE(nombre_comercial, nombre)"))
    db.execute(text("UPDATE tenants SET color_primario = COALESCE(color_primario, '#2563eb')"))
    db.execute(text("UPDATE tenants SET color_secundario = COALESCE(color_secundario, '#0f172a')"))
    db.execute(text("UPDATE tenants SET plan_actual = COALESCE(plan_actual, 'demo')"))
    db.execute(text("UPDATE tenants SET subscription_status = COALESCE(subscription_status, 'trial')"))
    db.execute(text("UPDATE tenants SET sedes_totales = COALESCE(sedes_totales, 1)"))
    db.execute(text("UPDATE tenants SET demo_ends_at = COALESCE(demo_ends_at, NOW() + INTERVAL '15 day')"))
    db.execute(text("UPDATE tenants SET billing_cycle_days = COALESCE(billing_cycle_days, 30)"))
    db.execute(text("UPDATE tenants SET nomina_enabled = COALESCE(nomina_enabled, FALSE)"))
    db.execute(text("UPDATE tenants SET sarlaft_enabled = COALESCE(sarlaft_enabled, FALSE)"))
    db.execute(text("UPDATE tenants SET sarlaft_mode = COALESCE(NULLIF(sarlaft_mode, ''), 'manual')"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN nombre_comercial SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN color_primario SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN color_secundario SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN plan_actual SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN subscription_status SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN sedes_totales SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN billing_cycle_days SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN nomina_enabled SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN sarlaft_enabled SET NOT NULL"))
    db.execute(text("ALTER TABLE tenants ALTER COLUMN sarlaft_mode SET NOT NULL"))

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
                plan_actual,
                subscription_status,
                sedes_totales,
                plan_started_at,
                plan_ends_at,
                demo_ends_at,
                billing_cycle_days,
                next_billing_at,
                last_payment_at,
                nomina_enabled,
                sarlaft_enabled,
                sarlaft_mode,
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
                'demo',
                'trial',
                1,
                NOW(),
                NULL,
                NOW() + INTERVAL '15 day',
                30,
                NOW() + INTERVAL '15 day',
                NULL,
                FALSE,
                FALSE,
                'manual',
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
    db.execute(text("ALTER TABLE vehiculos_proceso ADD COLUMN IF NOT EXISTS cliente_email VARCHAR(255)"))
    db.execute(text("ALTER TABLE vehiculos_proceso ADD COLUMN IF NOT EXISTS cliente_direccion VARCHAR(300)"))
    db.execute(text("ALTER TABLE vehiculos_proceso ADD COLUMN IF NOT EXISTS cliente_factus_municipality_id INTEGER"))
    db.execute(text("ALTER TABLE vehiculos_proceso ADD COLUMN IF NOT EXISTS iva_base_gravable_servicio NUMERIC(12,2)"))
    db.execute(text("ALTER TABLE vehiculos_proceso ADD COLUMN IF NOT EXISTS iva_valor_servicio NUMERIC(12,2)"))
    db.execute(text("ALTER TABLE vehiculos_proceso ADD COLUMN IF NOT EXISTS valor_excluido_servicio NUMERIC(12,2)"))
    db.execute(
        text(
            "ALTER TABLE vehiculos_proceso ADD COLUMN IF NOT EXISTS cliente_tipo_documento VARCHAR(10) NOT NULL DEFAULT 'CC'"
        )
    )
    db.execute(text("ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS tenant_id UUID"))
    db.execute(
        text(
            "ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS valor_terceros_runt NUMERIC(10, 2) NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS valor_terceros_sicov NUMERIC(10, 2) NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS valor_terceros_bancarizacion NUMERIC(10, 2) NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS valor_terceros_ansv NUMERIC(10, 2) NOT NULL DEFAULT 0"
        )
    )
    # Fila legada: todo el monto de terceros en RUNT para poder facturar desglosado sin reingreso manual.
    db.execute(
        text(
            """
            UPDATE tarifas SET valor_terceros_runt = valor_terceros
            WHERE valor_terceros > 0
              AND COALESCE(valor_terceros_runt, 0) = 0
              AND COALESCE(valor_terceros_sicov, 0) = 0
              AND COALESCE(valor_terceros_bancarizacion, 0) = 0
              AND COALESCE(valor_terceros_ansv, 0) = 0
            """
        )
    )
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
            UPDATE vehiculos_proceso
            SET cliente_tipo_documento = 'CC'
            WHERE cliente_tipo_documento IS NULL OR btrim(cliente_tipo_documento) = ''
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


def ensure_saas_billing_factus_columns(db):
    """
    FE de suscripción SaaS: vínculo opcional facturas_electronicas ↔ checkout; columnas de error en checkout.
    """
    db.execute(text("ALTER TABLE tenant_billing_checkout_sessions ADD COLUMN IF NOT EXISTS saas_fe_status VARCHAR(20)"))
    db.execute(text("ALTER TABLE tenant_billing_checkout_sessions ADD COLUMN IF NOT EXISTS saas_fe_error TEXT"))
    db.execute(
        text(
            """
            ALTER TABLE facturas_electronicas
            ADD COLUMN IF NOT EXISTS billing_checkout_session_id UUID
            REFERENCES tenant_billing_checkout_sessions(id) ON DELETE SET NULL
            """
        )
    )
    db.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_fe_billing_checkout_session
            ON facturas_electronicas(billing_checkout_session_id)
            WHERE billing_checkout_session_id IS NOT NULL
            """
        )
    )


def ensure_tenant_billing_checkout_schema(db):
    """
    Intenciones de pago (pasarela) por tenant: plan, sedes, monto.
    """
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS tenant_billing_checkout_sessions (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                plan_code VARCHAR(30) NOT NULL,
                sedes_totales INTEGER NOT NULL,
                subtotal_cop NUMERIC(14, 2) NOT NULL,
                iva_cop NUMERIC(14, 2) NOT NULL,
                total_cop NUMERIC(14, 2) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                payment_provider VARCHAR(30),
                payment_ref VARCHAR(120),
                epayco_ref VARCHAR(120),
                idempotency_key VARCHAR(100) UNIQUE,
                last_webhook_payload JSONB,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                completed_at TIMESTAMP WITHOUT TIME ZONE
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_tb_checkout_tenant
            ON tenant_billing_checkout_sessions(tenant_id, created_at DESC)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_tb_checkout_status
            ON tenant_billing_checkout_sessions(status)
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE IF EXISTS tenant_billing_checkout_sessions
            ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(30)
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE IF EXISTS tenant_billing_checkout_sessions
            ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(120)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_tb_checkout_payment_provider
            ON tenant_billing_checkout_sessions(payment_provider)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_tb_checkout_payment_ref
            ON tenant_billing_checkout_sessions(payment_ref)
            """
        )
    )


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


def ensure_support_schema(db):
    """
    Asegura ajustes de compatibilidad para tickets de soporte.
    """
    db.execute(
        text(
            """
            ALTER TABLE IF EXISTS saas_support_tickets
            ALTER COLUMN created_by_saas_user_id DROP NOT NULL
            """
        )
    )
    db.execute(text("ALTER TABLE IF EXISTS saas_support_tickets ADD COLUMN IF NOT EXISTS responded_by_saas_user_id UUID"))
    db.execute(text("ALTER TABLE IF EXISTS saas_support_tickets ADD COLUMN IF NOT EXISTS tenant_response_message TEXT"))
    db.execute(text("ALTER TABLE IF EXISTS saas_support_tickets ADD COLUMN IF NOT EXISTS tenant_responded_at TIMESTAMP WITHOUT TIME ZONE"))


def ensure_usuario_roles_schema(db):
    """
    Asegura compatibilidad del enum de roles en usuarios.
    """
    enum_type_name = db.execute(
        text(
            """
            SELECT udt_name
            FROM information_schema.columns
            WHERE table_name = 'usuarios' AND column_name = 'rol'
            LIMIT 1
            """
        )
    ).scalar()

    if enum_type_name:
        db.execute(text(f"ALTER TYPE {enum_type_name} ADD VALUE IF NOT EXISTS 'comercial'"))


def ensure_appointments_schema(db):
    """
    Asegura compatibilidad de columnas de agendamiento.
    """
    db.execute(text("ALTER TABLE IF EXISTS appointments ADD COLUMN IF NOT EXISTS public_token VARCHAR(120)"))
    db.execute(text("ALTER TABLE IF EXISTS appointments ADD COLUMN IF NOT EXISTS reminder_scheduled_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE IF EXISTS appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE IF EXISTS appointments ADD COLUMN IF NOT EXISTS reminder_attempted_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE IF EXISTS appointments ADD COLUMN IF NOT EXISTS reminder_status VARCHAR(20)"))

    db.execute(text("UPDATE appointments SET reminder_status = COALESCE(reminder_status, 'pending')"))
    db.execute(text("UPDATE appointments SET public_token = COALESCE(NULLIF(public_token, ''), md5(random()::text || clock_timestamp()::text))"))

    db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_appointments_public_token ON appointments(public_token)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_appointments_reminder_scheduled_at ON appointments(reminder_scheduled_at)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_appointments_reminder_status ON appointments(reminder_status)"))


def ensure_rtm_reminders_schema(db):
    """
    Asegura tabla de recordatorios de próxima RTM.
    """
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS rtm_renewal_reminders (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id),
                vehiculo_id UUID NOT NULL REFERENCES vehiculos_proceso(id) UNIQUE,
                placa VARCHAR(10) NOT NULL,
                tipo_vehiculo VARCHAR(40) NOT NULL,
                cliente_nombre VARCHAR(200) NOT NULL,
                cliente_email VARCHAR(255),
                cliente_celular VARCHAR(30),
                last_paid_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                next_due_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                scheduled_send_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                commercial_status VARCHAR(30) NOT NULL DEFAULT 'pendiente',
                commercial_notes TEXT,
                assigned_to_name VARCHAR(200),
                last_management_at TIMESTAMP WITHOUT TIME ZONE,
                last_management_channel VARCHAR(30),
                management_count INTEGER NOT NULL DEFAULT 0,
                next_contact_at TIMESTAMP WITHOUT TIME ZONE,
                sent_at TIMESTAMP WITHOUT TIME ZONE,
                last_manual_sent_at TIMESTAMP WITHOUT TIME ZONE,
                send_error TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_rtm_reminders_tenant_id ON rtm_renewal_reminders(tenant_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_rtm_reminders_scheduled_send_at ON rtm_renewal_reminders(scheduled_send_at)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_rtm_reminders_status ON rtm_renewal_reminders(status)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_rtm_reminders_next_due_at ON rtm_renewal_reminders(next_due_at)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_rtm_reminders_cliente_email ON rtm_renewal_reminders(cliente_email)"))
    db.execute(text("ALTER TABLE IF EXISTS rtm_renewal_reminders ADD COLUMN IF NOT EXISTS commercial_status VARCHAR(30)"))
    db.execute(text("ALTER TABLE IF EXISTS rtm_renewal_reminders ADD COLUMN IF NOT EXISTS commercial_notes TEXT"))
    db.execute(text("ALTER TABLE IF EXISTS rtm_renewal_reminders ADD COLUMN IF NOT EXISTS assigned_to_name VARCHAR(200)"))
    db.execute(text("ALTER TABLE IF EXISTS rtm_renewal_reminders ADD COLUMN IF NOT EXISTS last_management_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE IF EXISTS rtm_renewal_reminders ADD COLUMN IF NOT EXISTS last_management_channel VARCHAR(30)"))
    db.execute(text("ALTER TABLE IF EXISTS rtm_renewal_reminders ADD COLUMN IF NOT EXISTS management_count INTEGER"))
    db.execute(text("ALTER TABLE IF EXISTS rtm_renewal_reminders ADD COLUMN IF NOT EXISTS next_contact_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("ALTER TABLE IF EXISTS rtm_renewal_reminders ADD COLUMN IF NOT EXISTS last_manual_sent_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(text("UPDATE rtm_renewal_reminders SET commercial_status = COALESCE(commercial_status, 'pendiente')"))
    db.execute(text("UPDATE rtm_renewal_reminders SET management_count = COALESCE(management_count, 0)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_rtm_reminders_commercial_status ON rtm_renewal_reminders(commercial_status)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_rtm_reminders_next_contact_at ON rtm_renewal_reminders(next_contact_at)"))


def ensure_sucursales_schema(db):
    """
    Tabla sucursales + FKs operativos. Idempotente.
    Crea sede principal por tenant y backfill a datos existentes.
    """
    import uuid as uuid_lib

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sucursales (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                nombre VARCHAR(200) NOT NULL,
                codigo VARCHAR(40),
                activa BOOLEAN NOT NULL DEFAULT TRUE,
                es_principal BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_sucursales_tenant_id ON sucursales(tenant_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_sucursales_codigo ON sucursales(tenant_id, codigo)"))

    rows = db.execute(text("SELECT id, nombre FROM tenants")).fetchall()
    for row in rows:
        tid = row[0]
        cnt = db.execute(
            text("SELECT COUNT(*) FROM sucursales WHERE tenant_id = :tid"),
            {"tid": tid},
        ).scalar()
        if int(cnt or 0) == 0:
            sid = str(uuid_lib.uuid4())
            nombre_sede = "Sede principal"
            db.execute(
                text(
                    """
                    INSERT INTO sucursales (id, tenant_id, nombre, codigo, activa, es_principal, created_at)
                    VALUES (:id, :tid, :nombre, NULL, TRUE, TRUE, NOW())
                    """
                ),
                {"id": sid, "tid": tid, "nombre": nombre_sede},
            )

    def _add_column_if_table_exists(table: str):
        db.execute(
            text(
                f"""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = '{table}'
                    ) THEN
                        EXECUTE 'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS sucursal_id UUID';
                    END IF;
                END $$;
                """
            )
        )

    _add_column_if_table_exists("usuarios")
    _add_column_if_table_exists("vehiculos_proceso")
    _add_column_if_table_exists("cajas")
    _add_column_if_table_exists("movimientos_tesoreria")
    _add_column_if_table_exists("desglose_efectivo_tesoreria")
    _add_column_if_table_exists("configuracion_tesoreria")

    def _ensure_fk_sucursal(table: str):
        db.execute(
            text(
                f"""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = '{table}'
                    ) AND NOT EXISTS (
                        SELECT 1
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                          ON tc.constraint_schema = kcu.constraint_schema
                         AND tc.constraint_name = kcu.constraint_name
                        WHERE tc.table_schema = 'public'
                          AND tc.table_name = '{table}'
                          AND kcu.column_name = 'sucursal_id'
                          AND tc.constraint_type = 'FOREIGN KEY'
                    ) THEN
                        EXECUTE '
                            ALTER TABLE {table}
                            ADD CONSTRAINT fk_{table}_sucursal_id
                            FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
                        ';
                    END IF;
                END $$;
                """
            )
        )

    _ensure_fk_sucursal("usuarios")
    for tbl in ("vehiculos_proceso", "cajas", "movimientos_tesoreria", "desglose_efectivo_tesoreria", "configuracion_tesoreria"):
        _ensure_fk_sucursal(tbl)

    db.execute(
        text(
            """
            UPDATE usuarios u
            SET sucursal_id = s.id
            FROM sucursales s
            WHERE u.tenant_id = s.tenant_id
              AND s.es_principal = TRUE
              AND u.sucursal_id IS NULL
            """
        )
    )
    for tbl in ("vehiculos_proceso", "cajas", "movimientos_tesoreria", "desglose_efectivo_tesoreria", "configuracion_tesoreria"):
        db.execute(
            text(
                f"""
                UPDATE {tbl} t
                SET sucursal_id = s.id
                FROM sucursales s
                WHERE t.tenant_id = s.tenant_id
                  AND s.es_principal = TRUE
                  AND t.sucursal_id IS NULL
                """
            )
        )

    db.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_sucursales_one_principal_per_tenant
            ON sucursales (tenant_id)
            WHERE es_principal IS TRUE
            """
        )
    )


def ensure_movimiento_tesoreria_beneficiario_columns(db):
    """Beneficiario y tipo de identificación en egresos de tesorería."""
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return
    db.execute(text("ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS beneficiario VARCHAR(300)"))
    db.execute(
        text(
            "ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS beneficiario_tipo_identificacion VARCHAR(80)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS beneficiario_numero_identificacion VARCHAR(80)"
        )
    )


def ensure_movimiento_caja_beneficiario_columns(db):
    """Beneficiario y tipo de identificación en gastos/devoluciones/ajustes de caja (egresos)."""
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return
    db.execute(text("ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS beneficiario VARCHAR(300)"))
    db.execute(
        text(
            "ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS beneficiario_tipo_identificacion VARCHAR(80)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS beneficiario_numero_identificacion VARCHAR(80)"
        )
    )


def ensure_movimiento_proveedor_contacto_documento_soporte(db):
    """Dirección, correo, teléfono y municipio Factus del proveedor (egresos caja y tesorería)."""
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in ("movimientos_caja", "movimientos_tesoreria"):
        db.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS beneficiario_direccion TEXT"))
        db.execute(
            text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS beneficiario_email VARCHAR(255)")
        )
        db.execute(
            text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS beneficiario_telefono VARCHAR(30)")
        )
        db.execute(
            text(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS beneficiario_factus_municipality_id INTEGER"
            )
        )


def ensure_proveedores_catalogo_schema(db):
    """Catálogo de proveedores por tenant y vínculo opcional en egresos."""
    bind = db.get_bind()
    dialect = bind.dialect.name
    if dialect == "sqlite":
        # En dev con SQLite el bloque PostgreSQL no corre; columnas extra deben existir igual.
        try:
            db.execute(
                text("ALTER TABLE proveedores_catalogo ADD COLUMN rut_pdf_relpath VARCHAR(500)")
            )
        except Exception:
            pass
        try:
            db.execute(
                text(
                    "ALTER TABLE proveedores_catalogo ADD COLUMN concepto_retencion_dse VARCHAR(32) NOT NULL DEFAULT 'servicios'"
                )
            )
        except Exception:
            pass
        return
    if dialect != "postgresql":
        return
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS proveedores_catalogo (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                alias VARCHAR(120),
                razon_social_rut VARCHAR(300) NOT NULL,
                tipo_identificacion VARCHAR(80) NOT NULL,
                numero_identificacion VARCHAR(80) NOT NULL,
                direccion TEXT NOT NULL,
                email VARCHAR(255) NOT NULL,
                telefono VARCHAR(30) NOT NULL,
                factus_municipality_id INTEGER NOT NULL,
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
            CREATE INDEX IF NOT EXISTS ix_proveedores_catalogo_tenant
            ON proveedores_catalogo(tenant_id)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_proveedores_catalogo_tenant_activo
            ON proveedores_catalogo(tenant_id, activo)
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE movimientos_caja
            ADD COLUMN IF NOT EXISTS proveedor_catalogo_id UUID
            REFERENCES proveedores_catalogo(id) ON DELETE SET NULL
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE movimientos_tesoreria
            ADD COLUMN IF NOT EXISTS proveedor_catalogo_id UUID
            REFERENCES proveedores_catalogo(id) ON DELETE SET NULL
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_mov_caja_proveedor_cat
            ON movimientos_caja(proveedor_catalogo_id)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_mov_tes_proveedor_cat
            ON movimientos_tesoreria(proveedor_catalogo_id)
            """
        )
    )
    db.execute(
        text(
            "ALTER TABLE proveedores_catalogo ADD COLUMN IF NOT EXISTS rut_pdf_relpath VARCHAR(500)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE proveedores_catalogo ADD COLUMN IF NOT EXISTS concepto_retencion_dse VARCHAR(32) NOT NULL DEFAULT 'servicios'"
        )
    )


def ensure_tesoreria_anulacion_y_enum(db):
    """
    Anulación de movimientos (soft delete) y etiqueta enum AJUSTE_CORRECCION en PostgreSQL.

    SQLAlchemy persiste los *nombres* de miembro del Enum (p. ej. TRASLADO_CAJA, AJUSTE_CORRECCION).
    Un script anterior añadió por error el valor ``ajuste_correccion`` (minúsculas); aquí se añade
    ``AJUSTE_CORRECCION`` y se migran filas al label correcto.
    """
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return
    db.execute(
        text(
            """
            ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS anulado BOOLEAN NOT NULL DEFAULT FALSE
            """
        )
    )
    db.execute(text("ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT"))
    db.execute(
        text(
            "ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS anulado_por UUID REFERENCES usuarios(id)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMP"
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_movimientos_tesoreria_anulado
            ON movimientos_tesoreria(anulado)
            """
        )
    )
    db.execute(
        text(
            """
            DO $body$
            DECLARE
              ing_typ text;
              egr_typ text;
            BEGIN
              SELECT t.typname INTO ing_typ
              FROM pg_attribute a
              JOIN pg_type t ON a.atttypid = t.oid
              WHERE a.attrelid = 'movimientos_tesoreria'::regclass
                AND a.attname = 'categoria_ingreso'
                AND a.attnum > 0
                AND NOT a.attisdropped;

              SELECT t.typname INTO egr_typ
              FROM pg_attribute a
              JOIN pg_type t ON a.atttypid = t.oid
              WHERE a.attrelid = 'movimientos_tesoreria'::regclass
                AND a.attname = 'categoria_egreso'
                AND a.attnum > 0
                AND NOT a.attisdropped;

              IF ing_typ IS NOT NULL THEN
                BEGIN
                  EXECUTE format('ALTER TYPE %I ADD VALUE %L', ing_typ, 'ajuste_correccion');
                EXCEPTION
                  WHEN duplicate_object THEN NULL;
                END;
                BEGIN
                  EXECUTE format('ALTER TYPE %I ADD VALUE %L', ing_typ, 'AJUSTE_CORRECCION');
                EXCEPTION
                  WHEN duplicate_object THEN NULL;
                END;
              END IF;

              IF egr_typ IS NOT NULL THEN
                BEGIN
                  EXECUTE format('ALTER TYPE %I ADD VALUE %L', egr_typ, 'ajuste_correccion');
                EXCEPTION
                  WHEN duplicate_object THEN NULL;
                END;
                BEGIN
                  EXECUTE format('ALTER TYPE %I ADD VALUE %L', egr_typ, 'AJUSTE_CORRECCION');
                EXCEPTION
                  WHEN duplicate_object THEN NULL;
                END;
              END IF;
            END $body$;
            """
        )
    )


def ensure_facturacion_ubicacion_schema(db):
    """Municipio y dirección para Factus: matriz (tenant) y override opcional por sede."""
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS factus_municipality_id INTEGER"))
    db.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS direccion_facturacion VARCHAR(500)"))
    db.execute(text("ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS factus_municipality_id INTEGER"))
    db.execute(text("ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS direccion VARCHAR(500)"))
    db.execute(text("ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS ciudad VARCHAR(200)"))
    db.execute(text("ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS factus_numbering_range_id INTEGER"))


def ensure_factus_schema(db):
    """Facturación electrónica Factus: tablas por tenant y trazas de documentos."""
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS tenant_factus_settings (
                tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
                modo VARCHAR(20) NOT NULL DEFAULT 'manual',
                use_sandbox BOOLEAN NOT NULL DEFAULT TRUE,
                client_id VARCHAR(200),
                client_secret_encrypted TEXT,
                api_username VARCHAR(255),
                api_password_encrypted TEXT,
                default_numbering_range_id INTEGER,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS facturas_electronicas (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                vehiculo_proceso_id UUID REFERENCES vehiculos_proceso(id) ON DELETE SET NULL,
                reference_code VARCHAR(120) NOT NULL,
                factus_bill_id INTEGER,
                numero_documento VARCHAR(80),
                cufe VARCHAR(200),
                public_url VARCHAR(800),
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_facturas_electronicas_tenant ON facturas_electronicas(tenant_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_facturas_electronicas_ref ON facturas_electronicas(tenant_id, reference_code)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_facturas_electronicas_veh ON facturas_electronicas(vehiculo_proceso_id)"))
    db.execute(text("ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS production_client_id VARCHAR(200)"))
    db.execute(text("ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS production_client_secret_encrypted TEXT"))
    db.execute(text("ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS production_api_username VARCHAR(255)"))
    db.execute(text("ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS production_api_password_encrypted TEXT"))
    db.execute(
        text(
            "ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS documento_soporte_numbering_range_id INTEGER"
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS documento_soporte_notificar_proveedor_factus BOOLEAN NOT NULL DEFAULT TRUE
            """
        )
    )
    db.execute(
        text(
            "ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS documento_soporte_correo_notificacion_cda VARCHAR(255)"
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS documentos_soporte_electronicos (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                source_module VARCHAR(20) NOT NULL,
                movimiento_id UUID NOT NULL,
                reference_code VARCHAR(120) NOT NULL,
                factus_document_id INTEGER,
                numero_documento VARCHAR(80),
                cuds VARCHAR(200),
                public_url VARCHAR(800),
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_documentos_soporte_tenant_mod_mov "
            "ON documentos_soporte_electronicos(tenant_id, source_module, movimiento_id)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_documentos_soporte_tenant ON documentos_soporte_electronicos(tenant_id)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_documentos_soporte_tenant_ref "
            "ON documentos_soporte_electronicos(tenant_id, reference_code)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE facturas_electronicas ADD COLUMN IF NOT EXISTS emitido_por_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL"
        )
    )
    db.execute(text("ALTER TABLE facturas_electronicas ADD COLUMN IF NOT EXISTS pdf_storage_relpath VARCHAR(512)"))
    db.execute(text("ALTER TABLE facturas_electronicas ADD COLUMN IF NOT EXISTS pdf_sha256_hex VARCHAR(64)"))
    db.execute(
        text(
            "ALTER TABLE documentos_soporte_electronicos ADD COLUMN IF NOT EXISTS emitido_por_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL"
        )
    )
    db.execute(text("ALTER TABLE documentos_soporte_electronicos ADD COLUMN IF NOT EXISTS pdf_storage_relpath VARCHAR(512)"))
    db.execute(text("ALTER TABLE documentos_soporte_electronicos ADD COLUMN IF NOT EXISTS pdf_sha256_hex VARCHAR(64)"))
    db.execute(
        text(
            "ALTER TABLE documentos_soporte_electronicos ADD COLUMN IF NOT EXISTS concepto_retencion_dse VARCHAR(32)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE documentos_soporte_electronicos ADD COLUMN IF NOT EXISTS retencion_calculada_cop NUMERIC(14,2)"
        )
    )
    db.execute(
        text(
            "ALTER TABLE documentos_soporte_electronicos ADD COLUMN IF NOT EXISTS retencion_calculo_anio INTEGER"
        )
    )
    db.execute(
        text(
            "ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS dse_retencion_usar_compras BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )
    db.execute(
        text(
            "ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS dse_retencion_usar_servicios BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )
    db.execute(
        text(
            "ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS dse_retencion_usar_arrendamiento BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )
    db.execute(
        text(
            "ALTER TABLE tenant_factus_settings ADD COLUMN IF NOT EXISTS dse_retencion_usar_honorarios BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )


def ensure_quality_survey_responses_schema(db):
    """
    Migra quality_survey_responses del esquema de 5 preguntas al de 9 dimensiones.
    Idempotente: seguro en arranque repetido y en BD nuevas (create_all ya alineado).
    """
    tbl = "quality_survey_responses"
    exists = db.execute(
        text(
            """
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = :t
            """
        ),
        {"t": tbl},
    ).scalar()
    if not exists:
        return

    db.execute(
        text(
            f"""
            ALTER TABLE {tbl}
            ADD COLUMN IF NOT EXISTS facilidad_agendar_cita INTEGER,
            ADD COLUMN IF NOT EXISTS tiempo_espera_revision INTEGER,
            ADD COLUMN IF NOT EXISTS amabilidad_recepcion_caja INTEGER,
            ADD COLUMN IF NOT EXISTS limpieza_instalaciones INTEGER,
            ADD COLUMN IF NOT EXISTS amenidades_cda INTEGER,
            ADD COLUMN IF NOT EXISTS claridad_resultados_revision INTEGER,
            ADD COLUMN IF NOT EXISTS confianza_diagnostico_tecnico INTEGER,
            ADD COLUMN IF NOT EXISTS recomendar_cda INTEGER,
            ADD COLUMN IF NOT EXISTS experiencia_global INTEGER
            """
        )
    )

    legacy = db.execute(
        text(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :t AND column_name = 'atencion_recepcion'
            """
        ),
        {"t": tbl},
    ).scalar()

    if legacy:
        db.execute(
            text(
                f"""
                UPDATE {tbl} AS r
                SET
                  facilidad_agendar_cita = v.m,
                  tiempo_espera_revision = v.m,
                  amabilidad_recepcion_caja = v.m2,
                  limpieza_instalaciones = v.m,
                  amenidades_cda = v.m,
                  claridad_resultados_revision = v.m,
                  confianza_diagnostico_tecnico = v.m,
                  recomendar_cda = v.m,
                  experiencia_global = v.gen
                FROM (
                  SELECT
                    id,
                    atencion_general AS gen,
                    LEAST(
                      5,
                      GREATEST(
                        1,
                        ROUND(
                          (
                            COALESCE(atencion_recepcion, 3)
                            + COALESCE(atencion_caja, 3)
                            + COALESCE(sala_espera, 3)
                            + COALESCE(agrado_visita, 3)
                            + COALESCE(atencion_general, 3)
                          )::numeric
                          / 5
                        )
                      )::integer
                    ) AS m,
                    LEAST(
                      5,
                      GREATEST(
                        1,
                        ROUND(
                          (COALESCE(atencion_recepcion, 3) + COALESCE(atencion_caja, 3))::numeric / 2
                        )::integer
                      )
                    ) AS m2
                  FROM {tbl}
                ) AS v
                WHERE r.id = v.id AND r.facilidad_agendar_cita IS NULL
                """
            )
        )

    db.execute(
        text(
            f"""
            UPDATE {tbl}
            SET
              facilidad_agendar_cita = COALESCE(facilidad_agendar_cita, 3),
              tiempo_espera_revision = COALESCE(tiempo_espera_revision, 3),
              amabilidad_recepcion_caja = COALESCE(amabilidad_recepcion_caja, 3),
              limpieza_instalaciones = COALESCE(limpieza_instalaciones, 3),
              amenidades_cda = COALESCE(amenidades_cda, 3),
              claridad_resultados_revision = COALESCE(claridad_resultados_revision, 3),
              confianza_diagnostico_tecnico = COALESCE(confianza_diagnostico_tecnico, 3),
              recomendar_cda = COALESCE(recomendar_cda, 3),
              experiencia_global = COALESCE(experiencia_global, 3)
            """
        )
    )

    for col in (
        "facilidad_agendar_cita",
        "tiempo_espera_revision",
        "amabilidad_recepcion_caja",
        "limpieza_instalaciones",
        "amenidades_cda",
        "claridad_resultados_revision",
        "confianza_diagnostico_tecnico",
        "recomendar_cda",
        "experiencia_global",
    ):
        db.execute(text(f"ALTER TABLE {tbl} ALTER COLUMN {col} SET NOT NULL"))

    for col in (
        "atencion_recepcion",
        "atencion_caja",
        "sala_espera",
        "agrado_visita",
        "atencion_general",
    ):
        db.execute(text(f"ALTER TABLE {tbl} DROP COLUMN IF EXISTS {col}"))


def ensure_quality_survey_invites_sucursal_schema(db):
    """Añade sede a invitaciones de encuesta y hace backfill desde vehículo/sucursal."""
    inv = "quality_survey_invites"
    exists = db.execute(
        text(
            "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=:t"
        ),
        {"t": inv},
    ).scalar()
    if not exists:
        return
    db.execute(
        text(f"ALTER TABLE {inv} ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id)")
    )
    db.execute(text(f"ALTER TABLE {inv} ADD COLUMN IF NOT EXISTS sucursal_nombre VARCHAR(200)"))
    db.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_quality_survey_invites_sucursal_id ON {inv}(sucursal_id)"
        )
    )
    db.execute(
        text(
            f"""
            UPDATE {inv} AS i
            SET sucursal_id = v.sucursal_id
            FROM vehiculos_proceso v
            WHERE i.vehiculo_id = v.id
              AND i.sucursal_id IS NULL
              AND v.sucursal_id IS NOT NULL
            """
        )
    )
    db.execute(
        text(
            f"""
            UPDATE {inv} AS i
            SET sucursal_nombre = s.nombre
            FROM sucursales s
            WHERE i.sucursal_id = s.id
              AND (i.sucursal_nombre IS NULL OR TRIM(i.sucursal_nombre) = '')
            """
        )
    )


def ensure_tenant_documentos_schema(db):
    """Columnas de categoría y sede en documentos del tenant (tabla puede existir desde create_all)."""
    tbl = "tenant_documentos"
    exists = db.execute(
        text(
            "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=:t"
        ),
        {"t": tbl},
    ).scalar()
    if not exists:
        return
    db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS categoria VARCHAR(120)"))
    db.execute(
        text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id)")
    )
    db.execute(text(f"CREATE INDEX IF NOT EXISTS ix_tenant_documentos_categoria ON {tbl}(categoria)"))
    db.execute(
        text(f"CREATE INDEX IF NOT EXISTS ix_tenant_documentos_sucursal_id ON {tbl}(sucursal_id)")
    )
    db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS grupo_id UUID"))
    db.execute(
        text(
            f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS version_seq INTEGER NOT NULL DEFAULT 1"
        )
    )
    db.execute(
        text(
            f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS es_version_actual BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )
    db.execute(
        text(
            f"""
            UPDATE {tbl}
            SET grupo_id = id
            WHERE grupo_id IS NULL
            """
        )
    )
    db.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_tenant_documentos_grupo_actual ON {tbl}(grupo_id, es_version_actual)"
        )
    )
    db.execute(
        text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_documentos_grupo_version ON {tbl}(grupo_id, version_seq)"
        )
    )
    db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS preview_pdf_relpath VARCHAR(800)"))
    db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(
        text(
            f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES usuarios(id)"
        )
    )


def ensure_tenant_documento_auditoria_schema(db):
    """Trazabilidad de acciones sobre documentos (NTC 5385 / prácticas tipo ISO 27002)."""
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS tenant_documento_auditoria (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id),
                documento_id UUID REFERENCES tenant_documentos(id) ON DELETE SET NULL,
                usuario_id UUID REFERENCES usuarios(id),
                accion VARCHAR(40) NOT NULL,
                detalle TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_doc_aud_tenant_fecha ON tenant_documento_auditoria(tenant_id, created_at DESC)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_doc_aud_documento ON tenant_documento_auditoria(documento_id)"
        )
    )


def ensure_runt_metricas_schema(db):
    """
    Tabla de trazabilidad para métricas de consultas RUNT por proveedor.
    """
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS runt_consultas_metricas (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
                usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                placa_consultada VARCHAR(12) NOT NULL,
                document_type VARCHAR(10),
                document_number_last4 VARCHAR(4),
                provider_configured VARCHAR(30) NOT NULL,
                provider_resolved VARCHAR(30) NOT NULL,
                providers_attempted VARCHAR(80) NOT NULL,
                fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
                status VARCHAR(20) NOT NULL,
                encontrado BOOLEAN NOT NULL DEFAULT FALSE,
                cached BOOLEAN NOT NULL DEFAULT FALSE,
                error_detail VARCHAR(500),
                estimated_cost_cop NUMERIC(14,2) NOT NULL DEFAULT 0,
                estimated_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0,
                fx_rate_usd_cop_applied NUMERIC(14,6) NOT NULL DEFAULT 0,
                resolved_cost_cop NUMERIC(14,2) NOT NULL DEFAULT 0,
                resolved_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0,
                fallback_extra_cost_cop NUMERIC(14,2) NOT NULL DEFAULT 0,
                fallback_extra_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            "ALTER TABLE runt_consultas_metricas ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "ALTER TABLE runt_consultas_metricas ADD COLUMN IF NOT EXISTS fx_rate_usd_cop_applied NUMERIC(14,6) NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "ALTER TABLE runt_consultas_metricas ADD COLUMN IF NOT EXISTS resolved_cost_cop NUMERIC(14,2) NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "ALTER TABLE runt_consultas_metricas ADD COLUMN IF NOT EXISTS resolved_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "ALTER TABLE runt_consultas_metricas ADD COLUMN IF NOT EXISTS fallback_extra_cost_cop NUMERIC(14,2) NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "ALTER TABLE runt_consultas_metricas ADD COLUMN IF NOT EXISTS fallback_extra_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_runt_metricas_tenant_fecha ON runt_consultas_metricas(tenant_id, created_at DESC)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_runt_metricas_tenant_provider ON runt_consultas_metricas(tenant_id, provider_resolved)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_runt_metricas_tenant_status ON runt_consultas_metricas(tenant_id, status)"
        )
    )


def ensure_iva_provision_schema(db):
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS iva_provision_registros (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id),
                lote_id UUID NOT NULL,
                vehiculo_id UUID NOT NULL UNIQUE REFERENCES vehiculos_proceso(id) ON DELETE CASCADE,
                sucursal_id UUID NULL REFERENCES sucursales(id),
                periodo_desde DATE NOT NULL,
                periodo_hasta DATE NOT NULL,
                iva_causado_cop NUMERIC(14,2) NOT NULL DEFAULT 0,
                provisionado_por UUID NOT NULL REFERENCES usuarios(id),
                provisionado_en TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_iva_provision_tenant_fecha ON iva_provision_registros(tenant_id, provisionado_en DESC)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_iva_provision_tenant_vehiculo ON iva_provision_registros(tenant_id, vehiculo_id)"
        )
    )


def ensure_sarlaft_schema(db):
    """
    Esquema base SARLAFT (Sprint 1).
    """
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sarlaft_profiles (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
                enabled BOOLEAN NOT NULL DEFAULT FALSE,
                mode VARCHAR(20) NOT NULL DEFAULT 'manual',
                cash_threshold_cop NUMERIC(14,2) NOT NULL DEFAULT 0,
                api_trigger_mode VARCHAR(20) NOT NULL DEFAULT 'risk_only',
                api_provider VARCHAR(50),
                api_fallback_to_manual BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sarlaft_cases (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                sede_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
                operacion_ref VARCHAR(120) NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'open',
                risk_level VARCHAR(20) NOT NULL DEFAULT 'verde',
                risk_score NUMERIC(5,2) NOT NULL DEFAULT 0,
                transaction_amount_cop NUMERIC(14,2) NOT NULL DEFAULT 0,
                cash_amount_cop NUMERIC(14,2) NOT NULL DEFAULT 0,
                payment_method VARCHAR(30) NOT NULL DEFAULT 'otro',
                created_by_user_id UUID NOT NULL REFERENCES usuarios(id),
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sarlaft_case_parties (
                id UUID PRIMARY KEY,
                case_id UUID NOT NULL REFERENCES sarlaft_cases(id) ON DELETE CASCADE,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                role VARCHAR(30) NOT NULL,
                doc_type VARCHAR(20) NOT NULL,
                doc_number VARCHAR(40) NOT NULL,
                full_name VARCHAR(220) NOT NULL,
                phone VARCHAR(30),
                email VARCHAR(255),
                city VARCHAR(120),
                address VARCHAR(300),
                metadata_json JSONB,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sarlaft_audit_logs (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                actor_user_id UUID REFERENCES usuarios(id),
                entity_type VARCHAR(50) NOT NULL,
                entity_id UUID,
                action VARCHAR(60) NOT NULL,
                before_json JSONB,
                after_json JSONB,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sarlaft_manual_checks (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                created_by_user_id UUID NOT NULL REFERENCES usuarios(id),
                subject_type VARCHAR(20) NOT NULL DEFAULT 'natural',
                full_name VARCHAR(220) NOT NULL,
                doc_type VARCHAR(20),
                doc_number VARCHAR(60),
                email VARCHAR(255),
                phone VARCHAR(30),
                economic_activity VARCHAR(200),
                legal_representative VARCHAR(220),
                dataset VARCHAR(60) NOT NULL DEFAULT 'sanctions',
                algorithm VARCHAR(40) NOT NULL DEFAULT 'best',
                risk_level VARCHAR(20) NOT NULL DEFAULT 'verde',
                risk_score NUMERIC(5,2) NOT NULL DEFAULT 0,
                alert BOOLEAN NOT NULL DEFAULT FALSE,
                hits_count INTEGER NOT NULL DEFAULT 0,
                hits_json JSONB,
                notes TEXT,
                certificate_code VARCHAR(120),
                certificate_pdf_relpath VARCHAR(512),
                certificate_pdf_sha256 VARCHAR(64),
                certificate_issued_at TIMESTAMP WITHOUT TIME ZONE,
                certificate_issued_by_user_id UUID REFERENCES usuarios(id),
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(text("ALTER TABLE sarlaft_manual_checks ADD COLUMN IF NOT EXISTS economic_activity VARCHAR(200)"))
    db.execute(text("ALTER TABLE sarlaft_manual_checks ADD COLUMN IF NOT EXISTS legal_representative VARCHAR(220)"))
    db.execute(text("ALTER TABLE sarlaft_manual_checks ADD COLUMN IF NOT EXISTS email VARCHAR(255)"))
    db.execute(text("ALTER TABLE sarlaft_manual_checks ADD COLUMN IF NOT EXISTS phone VARCHAR(30)"))
    db.execute(text("ALTER TABLE sarlaft_manual_checks ADD COLUMN IF NOT EXISTS certificate_code VARCHAR(120)"))
    db.execute(text("ALTER TABLE sarlaft_manual_checks ADD COLUMN IF NOT EXISTS certificate_pdf_relpath VARCHAR(512)"))
    db.execute(text("ALTER TABLE sarlaft_manual_checks ADD COLUMN IF NOT EXISTS certificate_pdf_sha256 VARCHAR(64)"))
    db.execute(text("ALTER TABLE sarlaft_manual_checks ADD COLUMN IF NOT EXISTS certificate_issued_at TIMESTAMP WITHOUT TIME ZONE"))
    db.execute(
        text(
            """
            ALTER TABLE sarlaft_manual_checks
            ADD COLUMN IF NOT EXISTS certificate_issued_by_user_id UUID REFERENCES usuarios(id)
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE sarlaft_manual_checks
            SET subject_type = CASE
                WHEN subject_type = 'persona' THEN 'natural'
                WHEN subject_type = 'proveedor' THEN 'juridica'
                ELSE subject_type
            END
            """
        )
    )
    db.execute(text("ALTER TABLE sarlaft_manual_checks ALTER COLUMN subject_type SET DEFAULT 'natural'"))
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sarlaft_sirel_reports (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                case_id UUID NOT NULL UNIQUE REFERENCES sarlaft_cases(id) ON DELETE CASCADE,
                status VARCHAR(30) NOT NULL DEFAULT 'pendiente_envio',
                report_type VARCHAR(20) NOT NULL DEFAULT 'ros',
                sirel_reference VARCHAR(120),
                sent_at TIMESTAMP WITHOUT TIME ZONE,
                sent_by_user_id UUID REFERENCES usuarios(id),
                pre_ros_text TEXT,
                notes TEXT,
                evidence_url VARCHAR(500),
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sarlaft_batch_jobs (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                created_by_user_id UUID NOT NULL REFERENCES usuarios(id),
                filename VARCHAR(255) NOT NULL,
                dataset VARCHAR(60) NOT NULL DEFAULT 'sanctions',
                status VARCHAR(30) NOT NULL DEFAULT 'queued',
                total_records INTEGER NOT NULL DEFAULT 0,
                processed_records INTEGER NOT NULL DEFAULT 0,
                success_records INTEGER NOT NULL DEFAULT 0,
                error_records INTEGER NOT NULL DEFAULT 0,
                verde_records INTEGER NOT NULL DEFAULT 0,
                amarillo_records INTEGER NOT NULL DEFAULT 0,
                rojo_records INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                started_at TIMESTAMP WITHOUT TIME ZONE,
                finished_at TIMESTAMP WITHOUT TIME ZONE,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sarlaft_batch_rows (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                batch_job_id UUID NOT NULL REFERENCES sarlaft_batch_jobs(id) ON DELETE CASCADE,
                row_index INTEGER NOT NULL,
                subject_type VARCHAR(20),
                full_name VARCHAR(220),
                doc_type VARCHAR(20),
                doc_number VARCHAR(60),
                email VARCHAR(255),
                phone VARCHAR(30),
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                risk_level VARCHAR(20),
                hits_count INTEGER NOT NULL DEFAULT 0,
                alert BOOLEAN NOT NULL DEFAULT FALSE,
                source_labels_json JSONB,
                source_coverage_json JSONB,
                error_detail TEXT,
                created_manual_check_id UUID REFERENCES sarlaft_manual_checks(id),
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sarlaft_cases_tenant_created ON sarlaft_cases(tenant_id, created_at DESC)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sarlaft_parties_doc ON sarlaft_case_parties(tenant_id, doc_number)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sarlaft_audit_entity ON sarlaft_audit_logs(tenant_id, entity_type, entity_id, created_at DESC)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sarlaft_manual_checks_tenant_created ON sarlaft_manual_checks(tenant_id, created_at DESC)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sarlaft_manual_checks_doc ON sarlaft_manual_checks(tenant_id, doc_number)"
        )
    )
    db.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_sarlaft_manual_checks_cert_code ON sarlaft_manual_checks(certificate_code) WHERE certificate_code IS NOT NULL"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sarlaft_sirel_reports_tenant_case ON sarlaft_sirel_reports(tenant_id, case_id)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sarlaft_sirel_reports_tenant_status ON sarlaft_sirel_reports(tenant_id, status, created_at DESC)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sarlaft_batch_jobs_tenant_created ON sarlaft_batch_jobs(tenant_id, created_at DESC)"
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sarlaft_batch_rows_job ON sarlaft_batch_rows(batch_job_id, row_index)"
        )
    )
    import uuid as uuid_lib

    tenant_rows = db.execute(
        text(
            """
            SELECT id, COALESCE(sarlaft_enabled, FALSE) AS sarlaft_enabled, COALESCE(NULLIF(sarlaft_mode, ''), 'manual') AS sarlaft_mode
            FROM tenants
            """
        )
    ).fetchall()
    for row in tenant_rows:
        exists = db.execute(
            text("SELECT 1 FROM sarlaft_profiles WHERE tenant_id = :tid"),
            {"tid": row[0]},
        ).scalar()
        if exists:
            continue
        db.execute(
            text(
                """
                INSERT INTO sarlaft_profiles (
                    id,
                    tenant_id,
                    enabled,
                    mode,
                    cash_threshold_cop,
                    api_trigger_mode,
                    api_fallback_to_manual,
                    created_at
                ) VALUES (
                    :id,
                    :tenant_id,
                    :enabled,
                    :mode,
                    0,
                    'risk_only',
                    TRUE,
                    NOW()
                )
                """
            ),
            {
                "id": str(uuid_lib.uuid4()),
                "tenant_id": row[0],
                "enabled": bool(row[1]),
                "mode": row[2] or "manual",
            },
        )


def ensure_nomina_schema(db):
    """
    Esquema inicial de nómina multitenant (MVP base).
    """
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS nomina_centros_costo (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
                codigo VARCHAR(30) NOT NULL,
                nombre VARCHAR(160) NOT NULL,
                descripcion TEXT,
                activo VARCHAR(10) NOT NULL DEFAULT 'si',
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE,
                created_by UUID NOT NULL REFERENCES usuarios(id),
                CONSTRAINT ux_nomina_centro_costo_codigo_tenant UNIQUE (tenant_id, codigo)
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_cc_tenant ON nomina_centros_costo(tenant_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_cc_sucursal ON nomina_centros_costo(sucursal_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_cc_activo ON nomina_centros_costo(activo)"))

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS nomina_parametros_legales (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                salario_minimo_mensual NUMERIC(14,2) NOT NULL DEFAULT 0,
                auxilio_transporte_mensual NUMERIC(14,2) NOT NULL DEFAULT 0,
                uvt NUMERIC(14,2) NOT NULL DEFAULT 0,
                tope_ibc_smmlv NUMERIC(6,2) NOT NULL DEFAULT 25,
                umbral_exoneracion_smmlv NUMERIC(6,2) NOT NULL DEFAULT 10,
                exoneracion_aportes_activa BOOLEAN NOT NULL DEFAULT TRUE,
                aplica_auxilio_transporte BOOLEAN NOT NULL DEFAULT TRUE,
                umbral_auxilio_transporte_smmlv NUMERIC(6,2) NOT NULL DEFAULT 2,
                aplica_fsp BOOLEAN NOT NULL DEFAULT TRUE,
                umbral_fsp_smmlv NUMERIC(6,2) NOT NULL DEFAULT 4,
                pct_fsp_base NUMERIC(6,5) NOT NULL DEFAULT 0.01,
                aplica_subsistencia BOOLEAN NOT NULL DEFAULT TRUE,
                aplica_retencion_fuente BOOLEAN NOT NULL DEFAULT FALSE,
                umbral_retencion_uvt NUMERIC(8,2) NOT NULL DEFAULT 95,
                pct_retencion_base NUMERIC(6,5) NOT NULL DEFAULT 0.19,
                pct_ibc_salario_integral NUMERIC(6,5) NOT NULL DEFAULT 0.70,
                pct_salud_empleado NUMERIC(6,5) NOT NULL DEFAULT 0.04,
                pct_pension_empleado NUMERIC(6,5) NOT NULL DEFAULT 0.04,
                pct_salud_empresa NUMERIC(6,5) NOT NULL DEFAULT 0.085,
                pct_pension_empresa NUMERIC(6,5) NOT NULL DEFAULT 0.12,
                pct_arl_empresa NUMERIC(6,5) NOT NULL DEFAULT 0.00522,
                pct_caja_empresa NUMERIC(6,5) NOT NULL DEFAULT 0.04,
                pct_sena_empresa NUMERIC(6,5) NOT NULL DEFAULT 0.02,
                pct_icbf_empresa NUMERIC(6,5) NOT NULL DEFAULT 0.03,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE,
                created_by UUID NOT NULL REFERENCES usuarios(id),
                updated_by UUID REFERENCES usuarios(id),
                CONSTRAINT ux_nomina_parametros_legales_tenant UNIQUE (tenant_id)
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_param_legal_tenant ON nomina_parametros_legales(tenant_id)"))

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS nomina_empleados (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
                centro_costo_id UUID REFERENCES nomina_centros_costo(id) ON DELETE SET NULL,
                codigo_interno VARCHAR(50),
                documento_tipo VARCHAR(20) NOT NULL,
                documento_numero VARCHAR(40) NOT NULL,
                nombres VARCHAR(120) NOT NULL,
                apellidos VARCHAR(120) NOT NULL,
                email VARCHAR(255),
                celular VARCHAR(30),
                fecha_ingreso DATE NOT NULL,
                activo VARCHAR(10) NOT NULL DEFAULT 'si',
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE,
                created_by UUID NOT NULL REFERENCES usuarios(id),
                CONSTRAINT ux_nomina_empleado_doc_tenant UNIQUE (tenant_id, documento_tipo, documento_numero)
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_empleados_tenant ON nomina_empleados(tenant_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_empleados_sucursal ON nomina_empleados(sucursal_id)"))
    db.execute(text("ALTER TABLE nomina_empleados ADD COLUMN IF NOT EXISTS centro_costo_id UUID"))
    db.execute(
        text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'fk_nomina_empleados_centro_costo'
                ) THEN
                    ALTER TABLE nomina_empleados
                    ADD CONSTRAINT fk_nomina_empleados_centro_costo
                    FOREIGN KEY (centro_costo_id) REFERENCES nomina_centros_costo(id) ON DELETE SET NULL;
                END IF;
            END$$;
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_empleados_cc ON nomina_empleados(centro_costo_id)"))

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS nomina_contratos (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
                es_salario_integral BOOLEAN NOT NULL DEFAULT FALSE,
                centro_costo_id UUID REFERENCES nomina_centros_costo(id) ON DELETE SET NULL,
                tipo_contrato VARCHAR(30) NOT NULL,
                periodicidad VARCHAR(20) NOT NULL DEFAULT 'mensual',
                salario_base NUMERIC(14, 2) NOT NULL,
                fecha_inicio DATE NOT NULL,
                fecha_fin DATE,
                estado VARCHAR(20) NOT NULL DEFAULT 'activo',
                observaciones TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE,
                created_by UUID NOT NULL REFERENCES usuarios(id)
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_contratos_tenant ON nomina_contratos(tenant_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_contratos_empleado ON nomina_contratos(empleado_id)"))
    db.execute(text("ALTER TABLE nomina_contratos ADD COLUMN IF NOT EXISTS es_salario_integral BOOLEAN NOT NULL DEFAULT FALSE"))
    db.execute(text("ALTER TABLE nomina_contratos ADD COLUMN IF NOT EXISTS centro_costo_id UUID"))
    db.execute(
        text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'fk_nomina_contratos_centro_costo'
                ) THEN
                    ALTER TABLE nomina_contratos
                    ADD CONSTRAINT fk_nomina_contratos_centro_costo
                    FOREIGN KEY (centro_costo_id) REFERENCES nomina_centros_costo(id) ON DELETE SET NULL;
                END IF;
            END$$;
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_contratos_cc ON nomina_contratos(centro_costo_id)"))

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS nomina_periodos (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                anio VARCHAR(4) NOT NULL,
                mes VARCHAR(2) NOT NULL,
                fecha_inicio DATE NOT NULL,
                fecha_fin DATE NOT NULL,
                fecha_pago DATE,
                estado VARCHAR(20) NOT NULL DEFAULT 'borrador',
                observaciones TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE,
                opened_by UUID NOT NULL REFERENCES usuarios(id),
                closed_by UUID REFERENCES usuarios(id),
                CONSTRAINT ux_nomina_periodo_tenant_mes UNIQUE (tenant_id, anio, mes)
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_periodos_tenant ON nomina_periodos(tenant_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_periodos_estado ON nomina_periodos(estado)"))

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS nomina_novedades (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                periodo_id UUID NOT NULL REFERENCES nomina_periodos(id) ON DELETE CASCADE,
                empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
                tipo VARCHAR(20) NOT NULL,
                concepto VARCHAR(120) NOT NULL,
                unidades NUMERIC(10,2) NOT NULL DEFAULT 1,
                valor_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
                valor_total NUMERIC(14,2) NOT NULL DEFAULT 0,
                observaciones TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                created_by UUID NOT NULL REFERENCES usuarios(id)
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_novedades_tenant ON nomina_novedades(tenant_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_novedades_periodo ON nomina_novedades(periodo_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_novedades_empleado ON nomina_novedades(empleado_id)"))

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS nomina_liquidaciones (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                periodo_id UUID NOT NULL REFERENCES nomina_periodos(id) ON DELETE CASCADE,
                empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
                contrato_id UUID NOT NULL REFERENCES nomina_contratos(id) ON DELETE CASCADE,
                salario_base NUMERIC(14,2) NOT NULL DEFAULT 0,
                total_devengos NUMERIC(14,2) NOT NULL DEFAULT 0,
                total_deducciones NUMERIC(14,2) NOT NULL DEFAULT 0,
                neto_pagar NUMERIC(14,2) NOT NULL DEFAULT 0,
                auxilio_transporte_devengo NUMERIC(14,2) NOT NULL DEFAULT 0,
                base_cotizacion NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_salud_empleado NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_pension_empleado NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_fsp_empleado NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_subsistencia_empleado NUMERIC(14,2) NOT NULL DEFAULT 0,
                retencion_fuente_empleado NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_salud_empresa NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_pension_empresa NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_arl_empresa NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_caja_empresa NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_sena_empresa NUMERIC(14,2) NOT NULL DEFAULT 0,
                aporte_icbf_empresa NUMERIC(14,2) NOT NULL DEFAULT 0,
                provision_prima NUMERIC(14,2) NOT NULL DEFAULT 0,
                provision_cesantias NUMERIC(14,2) NOT NULL DEFAULT 0,
                provision_intereses_cesantias NUMERIC(14,2) NOT NULL DEFAULT 0,
                provision_vacaciones NUMERIC(14,2) NOT NULL DEFAULT 0,
                costo_total_empresa NUMERIC(14,2) NOT NULL DEFAULT 0,
                observaciones TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE,
                created_by UUID NOT NULL REFERENCES usuarios(id),
                updated_by UUID REFERENCES usuarios(id),
                CONSTRAINT ux_nomina_liq_tenant_periodo_empleado UNIQUE (tenant_id, periodo_id, empleado_id)
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_liquidaciones_tenant ON nomina_liquidaciones(tenant_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_liquidaciones_periodo ON nomina_liquidaciones(periodo_id)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_nomina_liquidaciones_empleado ON nomina_liquidaciones(empleado_id)"))
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS desprendible_folio VARCHAR(30)")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS desprendible_version INTEGER NOT NULL DEFAULT 1")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS desprendible_pdf_relpath VARCHAR(512)")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS desprendible_pdf_sha256 VARCHAR(64)")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS desprendible_generated_at TIMESTAMP WITHOUT TIME ZONE")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS base_cotizacion NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_salud_empleado NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_pension_empleado NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_fsp_empleado NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_subsistencia_empleado NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS retencion_fuente_empleado NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS auxilio_transporte_devengo NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_salud_empresa NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_pension_empresa NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_arl_empresa NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_caja_empresa NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_sena_empresa NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS aporte_icbf_empresa NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS provision_prima NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS provision_cesantias NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS provision_intereses_cesantias NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS provision_vacaciones NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_liquidaciones ADD COLUMN IF NOT EXISTS costo_total_empresa NUMERIC(14,2) NOT NULL DEFAULT 0")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS aplica_auxilio_transporte BOOLEAN NOT NULL DEFAULT TRUE")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS umbral_auxilio_transporte_smmlv NUMERIC(6,2) NOT NULL DEFAULT 2")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS aplica_fsp BOOLEAN NOT NULL DEFAULT TRUE")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS umbral_fsp_smmlv NUMERIC(6,2) NOT NULL DEFAULT 4")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS pct_fsp_base NUMERIC(6,5) NOT NULL DEFAULT 0.01")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS aplica_subsistencia BOOLEAN NOT NULL DEFAULT TRUE")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS aplica_retencion_fuente BOOLEAN NOT NULL DEFAULT FALSE")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS umbral_retencion_uvt NUMERIC(8,2) NOT NULL DEFAULT 95")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS pct_retencion_base NUMERIC(6,5) NOT NULL DEFAULT 0.19")
    )
    db.execute(
        text("ALTER TABLE nomina_parametros_legales ADD COLUMN IF NOT EXISTS pct_ibc_salario_integral NUMERIC(6,5) NOT NULL DEFAULT 0.70")
    )
    db.execute(
        text("CREATE INDEX IF NOT EXISTS ix_nomina_liquidaciones_folio ON nomina_liquidaciones(desprendible_folio)")
    )

    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS nomina_desprendible_versiones (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                liquidacion_id UUID NOT NULL REFERENCES nomina_liquidaciones(id) ON DELETE CASCADE,
                periodo_id UUID NOT NULL REFERENCES nomina_periodos(id) ON DELETE CASCADE,
                empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
                folio VARCHAR(30),
                version INTEGER NOT NULL,
                pdf_relpath VARCHAR(512) NOT NULL,
                pdf_sha256 VARCHAR(64) NOT NULL,
                generated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                generated_by UUID NOT NULL REFERENCES usuarios(id),
                motivo VARCHAR(40) NOT NULL DEFAULT 'generacion',
                CONSTRAINT ux_nomina_desprendible_version UNIQUE (tenant_id, liquidacion_id, version)
            )
            """
        )
    )
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_nomina_desprendibles_liquidacion ON nomina_desprendible_versiones(liquidacion_id)"
        )
    )
    db.execute(
        text("CREATE INDEX IF NOT EXISTS ix_nomina_desprendibles_tenant ON nomina_desprendible_versiones(tenant_id)")
    )
    db.execute(
        text("CREATE INDEX IF NOT EXISTS ix_nomina_desprendibles_version ON nomina_desprendible_versiones(version)")
    )


def get_db():
    """
    Dependency para obtener sesión de base de datos
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    """
    Inicializar base de datos: crear tablas y datos iniciales
    """
    from app.models.usuario import Usuario
    from app.models.tenant import Tenant
    from app.models.tenant_billing_checkout import TenantBillingCheckoutSession  # noqa: F401 — FK desde facturas_electronicas
    from app.models.tarifa import Tarifa, ComisionSOAT
    from app.models.caja import Caja, MovimientoCaja
    from app.models.vehiculo import VehiculoProceso
    from app.models.saas_user import SaaSUser
    from app.models.support_ticket import SaaSSupportTicket
    from app.models.quality import QualitySurveyInvite, QualitySurveyResponse
    from app.models.appointment import Appointment
    from app.models.rtm_reminder import RTMRenewalReminder
    from app.models.sucursal import Sucursal  # noqa: F401 — register model
    from app.models.tesoreria import MovimientoTesoreria, DesgloseEfectivoTesoreria, ConfiguracionTesoreria  # noqa: F401
    from app.models.factus import TenantFactusSettings, FacturaElectronica  # noqa: F401 — register model
    from app.models.documento_tenant import TenantDocumento  # noqa: F401 — register model
    from app.models.documento_auditoria import TenantDocumentoAuditoria  # noqa: F401 — register model
    from app.models.proveedor_catalogo import ProveedorCatalogo  # noqa: F401 — register model
    from app.models.dse_retencion_motor import DseRetencionTasaConcepto, DseUvtPorAnio  # noqa: F401
    from app.models.runt_metrica import RuntConsultaMetrica  # noqa: F401
    from app.models.sarlaft_profile import SarlaftProfile  # noqa: F401
    from app.models.sarlaft_case import SarlaftCase  # noqa: F401
    from app.models.sarlaft_case_party import SarlaftCaseParty  # noqa: F401
    from app.models.sarlaft_audit_log import SarlaftAuditLog  # noqa: F401
    from app.models.sarlaft_manual_check import SarlaftManualCheck  # noqa: F401
    from app.models.sarlaft_sirel_report import SarlaftSirelReport  # noqa: F401
    from app.models.sarlaft_batch_job import SarlaftBatchJob  # noqa: F401
    from app.models.sarlaft_batch_row import SarlaftBatchRow  # noqa: F401
    from app.models.iva_provision import IvaProvisionRegistro  # noqa: F401
    nomina_available = True
    try:
        from app.models.nomina import (
            NominaCentroCosto,
            NominaParametroLegal,
            NominaEmpleado,
            NominaContrato,
            NominaPeriodo,
            NominaNovedad,
            NominaLiquidacion,
            NominaDesprendibleVersion,
        )  # noqa: F401
    except ModuleNotFoundError:
        nomina_available = False
    from app.core.security import get_password_hash
    from datetime import date
    
    # Crear todas las tablas
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    try:
        ensure_tenant_baseline_schema(db)

        # Esquemas que hacen ALTER en tenants/sucursales deben ejecutarse antes del primer
        # db.query(Tenant): el modelo ORM incluye todas las columnas mapeadas y fallaría
        # con UndefinedColumn si la BD aún no las tiene (y el except más abajo ocultaría el error).
        ensure_tenant_domain_schema(db)
        ensure_tenant_billing_checkout_schema(db)
        ensure_saas_billing_factus_columns(db)
        ensure_onboarding_security_schema(db)
        ensure_support_schema(db)
        ensure_usuario_roles_schema(db)
        ensure_appointments_schema(db)
        ensure_rtm_reminders_schema(db)
        ensure_sucursales_schema(db)
        ensure_tesoreria_anulacion_y_enum(db)
        ensure_movimiento_tesoreria_beneficiario_columns(db)
        ensure_movimiento_caja_beneficiario_columns(db)
        ensure_movimiento_proveedor_contacto_documento_soporte(db)
        ensure_proveedores_catalogo_schema(db)
        ensure_facturacion_ubicacion_schema(db)
        ensure_factus_schema(db)
        ensure_quality_survey_responses_schema(db)
        ensure_quality_survey_invites_sucursal_schema(db)
        ensure_tenant_documentos_schema(db)
        ensure_runt_metricas_schema(db)
        ensure_iva_provision_schema(db)
        ensure_sarlaft_schema(db)
        if nomina_available:
            ensure_nomina_schema(db)
        db.commit()

        default_tenant = db.query(Tenant).filter(
            Tenant.slug == settings.SAAS_DEFAULT_TENANT_SLUG
        ).first()
        if not default_tenant:
            raise RuntimeError("No se pudo inicializar tenant default")

        # Verificar y crear owner global SaaS
        saas_owner = db.query(SaaSUser).filter(SaaSUser.email == settings.SAAS_OWNER_EMAIL).first()
        if not saas_owner:
            owner = SaaSUser(
                email=settings.SAAS_OWNER_EMAIL,
                hashed_password=get_password_hash(settings.SAAS_OWNER_PASSWORD),
                nombre_completo=settings.SAAS_OWNER_NAME,
                rol_global="owner",
                activo=True,
                mfa_enabled=True,
            )
            db.add(owner)
            db.commit()
            print("[OK] Usuario global SaaS owner creado")
            print(f"   Email: {settings.SAAS_OWNER_EMAIL}")
            print("   Password: [SAAS_OWNER_PASSWORD desde .env]")
        else:
            if not saas_owner.mfa_enabled:
                saas_owner.mfa_enabled = True
                db.commit()
                print("[INFO] MFA habilitado automáticamente para owner SaaS por política de seguridad")

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
                    valor_terceros_runt=24056,
                    valor_terceros_sicov=0,
                    valor_terceros_bancarizacion=0,
                    valor_terceros_ansv=0,
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
                    valor_terceros_runt=24056,
                    valor_terceros_sicov=0,
                    valor_terceros_bancarizacion=0,
                    valor_terceros_ansv=0,
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
                    valor_terceros_runt=24056,
                    valor_terceros_sicov=0,
                    valor_terceros_bancarizacion=0,
                    valor_terceros_ansv=0,
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
                    valor_terceros_runt=24056,
                    valor_terceros_sicov=0,
                    valor_terceros_bancarizacion=0,
                    valor_terceros_ansv=0,
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
