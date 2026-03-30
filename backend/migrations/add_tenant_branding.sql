-- Fase 3-B: Branding por tenant (white-label base)

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nombre_comercial VARCHAR(200);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS color_primario VARCHAR(20);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS color_secundario VARCHAR(20);

UPDATE tenants
SET nombre_comercial = COALESCE(nombre_comercial, nombre),
    color_primario = COALESCE(color_primario, '#2563eb'),
    color_secundario = COALESCE(color_secundario, '#0f172a');

ALTER TABLE tenants ALTER COLUMN nombre_comercial SET NOT NULL;
ALTER TABLE tenants ALTER COLUMN color_primario SET NOT NULL;
ALTER TABLE tenants ALTER COLUMN color_secundario SET NOT NULL;
