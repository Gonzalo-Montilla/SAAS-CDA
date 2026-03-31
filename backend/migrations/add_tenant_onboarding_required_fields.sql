-- Campos obligatorios de onboarding de CDA y unicidad de NIT

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nit_cda VARCHAR(30);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS correo_electronico VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nombre_representante VARCHAR(200);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS celular VARCHAR(30);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_nit_cda
ON tenants(nit_cda)
WHERE nit_cda IS NOT NULL;
