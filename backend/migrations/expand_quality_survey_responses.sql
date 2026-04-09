-- Encuesta de calidad ampliada (9 ítems 1–5 + comentario).
-- Ejecutar una vez en PostgreSQL al actualizar desde el esquema de 5 preguntas.
-- Instalaciones nuevas con el modelo actual no necesitan este script (solo create_all / tablas al día).

BEGIN;

ALTER TABLE quality_survey_responses
  ADD COLUMN IF NOT EXISTS facilidad_agendar_cita INTEGER,
  ADD COLUMN IF NOT EXISTS tiempo_espera_revision INTEGER,
  ADD COLUMN IF NOT EXISTS amabilidad_recepcion_caja INTEGER,
  ADD COLUMN IF NOT EXISTS limpieza_instalaciones INTEGER,
  ADD COLUMN IF NOT EXISTS amenidades_cda INTEGER,
  ADD COLUMN IF NOT EXISTS claridad_resultados_revision INTEGER,
  ADD COLUMN IF NOT EXISTS confianza_diagnostico_tecnico INTEGER,
  ADD COLUMN IF NOT EXISTS recomendar_cda INTEGER,
  ADD COLUMN IF NOT EXISTS experiencia_global INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'quality_survey_responses'
      AND c.column_name = 'atencion_recepcion'
  ) THEN
    UPDATE quality_survey_responses AS r
    SET
      facilidad_agendar_cita = v.m,
      tiempo_espera_revision = v.m,
      amabilidad_recepcion_caja = v.m2,
      limpieza_instalaciones = v.m,
      amenidades_cda = v.m,
      claridad_resultados_revision = v.m,
      confianza_diagnostico_tecnico = v.m,
      recomendar_cda = v.m,
      experiencia_global = v.gen
    FROM (
      SELECT
        id,
        atencion_general AS gen,
        LEAST(
          5,
          GREATEST(
            1,
            ROUND(
              (
                COALESCE(atencion_recepcion, 3)
                + COALESCE(atencion_caja, 3)
                + COALESCE(sala_espera, 3)
                + COALESCE(agrado_visita, 3)
                + COALESCE(atencion_general, 3)
              )::numeric
              / 5
            )
          )::integer
        ) AS m,
        LEAST(
          5,
          GREATEST(
            1,
            ROUND(
              (COALESCE(atencion_recepcion, 3) + COALESCE(atencion_caja, 3))::numeric / 2
            )::integer
          )
        ) AS m2
      FROM quality_survey_responses
    ) AS v
    WHERE r.id = v.id
      AND r.facilidad_agendar_cita IS NULL;
  END IF;
END $$;

UPDATE quality_survey_responses
SET
  facilidad_agendar_cita = COALESCE(facilidad_agendar_cita, 3),
  tiempo_espera_revision = COALESCE(tiempo_espera_revision, 3),
  amabilidad_recepcion_caja = COALESCE(amabilidad_recepcion_caja, 3),
  limpieza_instalaciones = COALESCE(limpieza_instalaciones, 3),
  amenidades_cda = COALESCE(amenidades_cda, 3),
  claridad_resultados_revision = COALESCE(claridad_resultados_revision, 3),
  confianza_diagnostico_tecnico = COALESCE(confianza_diagnostico_tecnico, 3),
  recomendar_cda = COALESCE(recomendar_cda, 3),
  experiencia_global = COALESCE(experiencia_global, 3);

ALTER TABLE quality_survey_responses ALTER COLUMN facilidad_agendar_cita SET NOT NULL;
ALTER TABLE quality_survey_responses ALTER COLUMN tiempo_espera_revision SET NOT NULL;
ALTER TABLE quality_survey_responses ALTER COLUMN amabilidad_recepcion_caja SET NOT NULL;
ALTER TABLE quality_survey_responses ALTER COLUMN limpieza_instalaciones SET NOT NULL;
ALTER TABLE quality_survey_responses ALTER COLUMN amenidades_cda SET NOT NULL;
ALTER TABLE quality_survey_responses ALTER COLUMN claridad_resultados_revision SET NOT NULL;
ALTER TABLE quality_survey_responses ALTER COLUMN confianza_diagnostico_tecnico SET NOT NULL;
ALTER TABLE quality_survey_responses ALTER COLUMN recomendar_cda SET NOT NULL;
ALTER TABLE quality_survey_responses ALTER COLUMN experiencia_global SET NOT NULL;

ALTER TABLE quality_survey_responses DROP COLUMN IF EXISTS atencion_recepcion;
ALTER TABLE quality_survey_responses DROP COLUMN IF EXISTS atencion_caja;
ALTER TABLE quality_survey_responses DROP COLUMN IF EXISTS sala_espera;
ALTER TABLE quality_survey_responses DROP COLUMN IF EXISTS agrado_visita;
ALTER TABLE quality_survey_responses DROP COLUMN IF EXISTS atencion_general;

COMMIT;
