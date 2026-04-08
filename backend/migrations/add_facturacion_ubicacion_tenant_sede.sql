-- Municipio Factus y dirección: matriz (tenant) y override por sucursal (idempotente manual)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS factus_municipality_id INTEGER;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS direccion_facturacion VARCHAR(500);
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS factus_municipality_id INTEGER;
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS direccion VARCHAR(500);
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS ciudad VARCHAR(200);
