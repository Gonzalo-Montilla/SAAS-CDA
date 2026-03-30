-- Fase 3: Auth global SaaS + RBAC global baseline

CREATE TABLE IF NOT EXISTS saas_users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    nombre_completo VARCHAR(200) NOT NULL,
    rol_global VARCHAR(30) NOT NULL DEFAULT 'soporte',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    intentos_fallidos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta TIMESTAMP WITHOUT TIME ZONE NULL,
    session_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NULL
);

CREATE INDEX IF NOT EXISTS ix_saas_users_email ON saas_users(email);
CREATE INDEX IF NOT EXISTS ix_saas_users_rol_global ON saas_users(rol_global);

ALTER TABLE saas_users
    DROP CONSTRAINT IF EXISTS ck_saas_users_rol_global;

ALTER TABLE saas_users
    ADD CONSTRAINT ck_saas_users_rol_global
    CHECK (rol_global IN ('owner', 'finanzas', 'comercial', 'soporte'));
