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

-- Label alineado con SQLAlchemy (nombres de miembro Enum), no el .value en minúsculas.
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
    AND a.attnum > 0 AND NOT a.attisdropped;

  SELECT t.typname INTO egr_typ
  FROM pg_attribute a
  JOIN pg_type t ON a.atttypid = t.oid
  WHERE a.attrelid = 'movimientos_tesoreria'::regclass
    AND a.attname = 'categoria_egreso'
    AND a.attnum > 0 AND NOT a.attisdropped;

  IF ing_typ IS NOT NULL THEN
    BEGIN
      EXECUTE format('ALTER TYPE %I ADD VALUE %L', ing_typ, 'AJUSTE_CORRECCION');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF egr_typ IS NOT NULL THEN
    BEGIN
      EXECUTE format('ALTER TYPE %I ADD VALUE %L', egr_typ, 'AJUSTE_CORRECCION');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $body$;

UPDATE movimientos_tesoreria SET categoria_ingreso = 'AJUSTE_CORRECCION'
WHERE categoria_ingreso IS NOT NULL AND categoria_ingreso::text = 'ajuste_correccion';

UPDATE movimientos_tesoreria SET categoria_egreso = 'AJUSTE_CORRECCION'
WHERE categoria_egreso IS NOT NULL AND categoria_egreso::text = 'ajuste_correccion';
