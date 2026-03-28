-- Fase 2 multitenant: scope de tenant en dominio operacional
-- Idempotente: agrega tenant_id, backfill, constraints e índices.

-- ==================== Columnas tenant_id ====================
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE desglose_efectivo_cierre ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE vehiculos_proceso ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE comisiones_soat ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE desglose_efectivo_tesoreria ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE configuracion_tesoreria ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE notificaciones_cierre_caja ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- ==================== Backfill tenant_id ====================
UPDATE cajas c
SET tenant_id = u.tenant_id
FROM usuarios u
WHERE c.tenant_id IS NULL AND c.usuario_id = u.id;

UPDATE movimientos_caja m
SET tenant_id = c.tenant_id
FROM cajas c
WHERE m.tenant_id IS NULL AND m.caja_id = c.id;

UPDATE desglose_efectivo_cierre d
SET tenant_id = c.tenant_id
FROM cajas c
WHERE d.tenant_id IS NULL AND d.caja_id = c.id;

UPDATE vehiculos_proceso v
SET tenant_id = u.tenant_id
FROM usuarios u
WHERE v.tenant_id IS NULL AND v.registrado_por = u.id;

UPDATE vehiculos_proceso v
SET tenant_id = c.tenant_id
FROM cajas c
WHERE v.tenant_id IS NULL AND v.caja_id = c.id;

UPDATE tarifas t
SET tenant_id = u.tenant_id
FROM usuarios u
WHERE t.tenant_id IS NULL AND t.created_by = u.id;

UPDATE comisiones_soat c
SET tenant_id = u.tenant_id
FROM usuarios u
WHERE c.tenant_id IS NULL AND c.created_by = u.id;

UPDATE movimientos_tesoreria m
SET tenant_id = u.tenant_id
FROM usuarios u
WHERE m.tenant_id IS NULL AND m.created_by = u.id;

UPDATE desglose_efectivo_tesoreria d
SET tenant_id = m.tenant_id
FROM movimientos_tesoreria m
WHERE d.tenant_id IS NULL AND d.movimiento_id = m.id;

UPDATE configuracion_tesoreria c
SET tenant_id = u.tenant_id
FROM usuarios u
WHERE c.tenant_id IS NULL AND c.updated_by = u.id;

UPDATE notificaciones_cierre_caja n
SET tenant_id = c.tenant_id
FROM cajas c
WHERE n.tenant_id IS NULL AND n.caja_id = c.id;

-- Fallback con tenant default para cualquier huérfano
UPDATE vehiculos_proceso SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE tarifas SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE comisiones_soat SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE movimientos_tesoreria SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE desglose_efectivo_tesoreria SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE configuracion_tesoreria SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE notificaciones_cierre_caja SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE cajas SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE movimientos_caja SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE desglose_efectivo_cierre SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- ==================== NOT NULL ====================
ALTER TABLE cajas ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE movimientos_caja ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE desglose_efectivo_cierre ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE vehiculos_proceso ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tarifas ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE comisiones_soat ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE movimientos_tesoreria ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE desglose_efectivo_tesoreria ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE configuracion_tesoreria ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE notificaciones_cierre_caja ALTER COLUMN tenant_id SET NOT NULL;

-- ==================== FK ====================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cajas_tenant_id') THEN
        ALTER TABLE cajas ADD CONSTRAINT fk_cajas_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_movimientos_caja_tenant_id') THEN
        ALTER TABLE movimientos_caja ADD CONSTRAINT fk_movimientos_caja_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_desglose_cierre_tenant_id') THEN
        ALTER TABLE desglose_efectivo_cierre ADD CONSTRAINT fk_desglose_cierre_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vehiculos_tenant_id') THEN
        ALTER TABLE vehiculos_proceso ADD CONSTRAINT fk_vehiculos_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tarifas_tenant_id') THEN
        ALTER TABLE tarifas ADD CONSTRAINT fk_tarifas_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_comisiones_soat_tenant_id') THEN
        ALTER TABLE comisiones_soat ADD CONSTRAINT fk_comisiones_soat_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_movimientos_tesoreria_tenant_id') THEN
        ALTER TABLE movimientos_tesoreria ADD CONSTRAINT fk_movimientos_tesoreria_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_desglose_tesoreria_tenant_id') THEN
        ALTER TABLE desglose_efectivo_tesoreria ADD CONSTRAINT fk_desglose_tesoreria_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_config_tesoreria_tenant_id') THEN
        ALTER TABLE configuracion_tesoreria ADD CONSTRAINT fk_config_tesoreria_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notificaciones_tenant_id') THEN
        ALTER TABLE notificaciones_cierre_caja ADD CONSTRAINT fk_notificaciones_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
END $$;

-- ==================== Índices ====================
CREATE INDEX IF NOT EXISTS ix_cajas_tenant_id ON cajas(tenant_id);
CREATE INDEX IF NOT EXISTS ix_movimientos_caja_tenant_id ON movimientos_caja(tenant_id);
CREATE INDEX IF NOT EXISTS ix_desglose_efectivo_cierre_tenant_id ON desglose_efectivo_cierre(tenant_id);
CREATE INDEX IF NOT EXISTS ix_vehiculos_proceso_tenant_id ON vehiculos_proceso(tenant_id);
CREATE INDEX IF NOT EXISTS ix_tarifas_tenant_id ON tarifas(tenant_id);
CREATE INDEX IF NOT EXISTS ix_comisiones_soat_tenant_id ON comisiones_soat(tenant_id);
CREATE INDEX IF NOT EXISTS ix_movimientos_tesoreria_tenant_id ON movimientos_tesoreria(tenant_id);
CREATE INDEX IF NOT EXISTS ix_desglose_efectivo_tesoreria_tenant_id ON desglose_efectivo_tesoreria(tenant_id);
CREATE INDEX IF NOT EXISTS ix_configuracion_tesoreria_tenant_id ON configuracion_tesoreria(tenant_id);
CREATE INDEX IF NOT EXISTS ix_notificaciones_cierre_caja_tenant_id ON notificaciones_cierre_caja(tenant_id);
