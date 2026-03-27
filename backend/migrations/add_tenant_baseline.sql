-- Baseline multitenant Fase 1
-- 1) Crear tabla tenants
-- 2) Crear tenant default
-- 3) Agregar tenant_id a usuarios + backfill + FK + índice

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY,
    nombre VARCHAR(200) NOT NULL,
    slug VARCHAR(120) UNIQUE NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE
);

INSERT INTO tenants (id, nombre, slug, activo, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Tenant Default CDA',
    'default',
    TRUE,
    NOW()
)
ON CONFLICT (slug) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'usuarios' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE usuarios ADD COLUMN tenant_id UUID;
    END IF;
END $$;

UPDATE usuarios
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE usuarios
ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_usuarios_tenant_id'
    ) THEN
        ALTER TABLE usuarios
        ADD CONSTRAINT fk_usuarios_tenant_id
        FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_usuarios_tenant_id ON usuarios(tenant_id);
