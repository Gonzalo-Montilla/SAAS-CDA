-- Campos de facturación SaaS por tenant

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_actual VARCHAR(30);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(30);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sedes_totales INTEGER;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_ends_at TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS demo_ends_at TIMESTAMP WITHOUT TIME ZONE;

UPDATE tenants SET plan_actual = COALESCE(plan_actual, 'demo');
UPDATE tenants SET subscription_status = COALESCE(subscription_status, 'trial');
UPDATE tenants SET sedes_totales = COALESCE(sedes_totales, 1);
UPDATE tenants SET demo_ends_at = COALESCE(demo_ends_at, NOW() + INTERVAL '15 day');

ALTER TABLE tenants ALTER COLUMN plan_actual SET NOT NULL;
ALTER TABLE tenants ALTER COLUMN subscription_status SET NOT NULL;
ALTER TABLE tenants ALTER COLUMN sedes_totales SET NOT NULL;
