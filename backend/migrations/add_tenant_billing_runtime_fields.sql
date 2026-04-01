-- Campos operativos para ciclo de facturación SaaS por tenant

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle_days INTEGER;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS next_billing_at TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMP WITHOUT TIME ZONE;

UPDATE tenants SET billing_cycle_days = COALESCE(billing_cycle_days, 30);
UPDATE tenants
SET next_billing_at = COALESCE(
    next_billing_at,
    CASE
        WHEN plan_actual = 'demo' THEN demo_ends_at
        WHEN plan_ends_at IS NOT NULL THEN plan_ends_at
        ELSE NOW() + (billing_cycle_days || ' day')::interval
    END
);

ALTER TABLE tenants ALTER COLUMN billing_cycle_days SET NOT NULL;
