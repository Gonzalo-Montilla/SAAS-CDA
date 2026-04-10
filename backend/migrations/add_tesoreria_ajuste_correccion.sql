-- Tesorería: categoría ajuste_correccion + FK opcional al movimiento corregido.
-- Idempotente en PostgreSQL. Si ya aplicaste ensure_tesoreria_correccion_schema vía init_db, puedes omitir esto.

ALTER TABLE movimientos_tesoreria ADD COLUMN IF NOT EXISTS corrige_movimiento_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_movimientos_tesoreria_corrige_movimiento_id'
  ) THEN
    ALTER TABLE movimientos_tesoreria
      ADD CONSTRAINT fk_movimientos_tesoreria_corrige_movimiento_id
      FOREIGN KEY (corrige_movimiento_id) REFERENCES movimientos_tesoreria(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $body$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT t.typname AS tn FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE e.enumlabel = 'otro_ingreso'
  LOOP
    BEGIN
      EXECUTE format('ALTER TYPE %I ADD VALUE %L', r.tn, 'ajuste_correccion');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
  FOR r IN
    SELECT DISTINCT t.typname AS tn FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE e.enumlabel = 'otros_gastos'
  LOOP
    BEGIN
      EXECUTE format('ALTER TYPE %I ADD VALUE %L', r.tn, 'ajuste_correccion');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $body$;
