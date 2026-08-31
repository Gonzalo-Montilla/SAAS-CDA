"""Sanea reinspecciones con tarifa y deja CHECK para que no vuelva a ocurrir."""
from sqlalchemy import create_engine, text

from app.core.config import settings

STATEMENTS = [
    """
    UPDATE vehiculos_proceso
    SET
      valor_rtm = 0,
      comision_soat = 0,
      total_cobrado = 0,
      tiene_soat = FALSE
    WHERE reinspeccion_exenta IS TRUE
      AND (
        COALESCE(valor_rtm, 0) <> 0
        OR COALESCE(comision_soat, 0) <> 0
        OR COALESCE(total_cobrado, 0) <> 0
        OR tiene_soat IS TRUE
      )
    """,
    """
    UPDATE vehiculos_proceso
    SET
      valor_rtm = 0,
      comision_soat = 0,
      total_cobrado = 0,
      tiene_soat = FALSE
    WHERE LOWER(TRIM(COALESCE(tipo_vehiculo, ''))) = 'pruebas_auditoria'
      AND (
        COALESCE(valor_rtm, 0) <> 0
        OR COALESCE(comision_soat, 0) <> 0
        OR COALESCE(total_cobrado, 0) <> 0
        OR tiene_soat IS TRUE
      )
    """,
    """
    ALTER TABLE vehiculos_proceso
      DROP CONSTRAINT IF EXISTS chk_vehiculo_exento_sin_cobro
    """,
    """
    ALTER TABLE vehiculos_proceso
      ADD CONSTRAINT chk_vehiculo_exento_sin_cobro
      CHECK (
        (
          reinspeccion_exenta IS NOT TRUE
          AND LOWER(TRIM(COALESCE(tipo_vehiculo, ''))) <> 'pruebas_auditoria'
        )
        OR (
          COALESCE(valor_rtm, 0) = 0
          AND COALESCE(comision_soat, 0) = 0
          AND COALESCE(total_cobrado, 0) = 0
          AND tiene_soat IS NOT TRUE
        )
      )
    """,
]


def main() -> None:
    engine = create_engine(settings.DATABASE_URL)
    with engine.begin() as conn:
        for stmt in STATEMENTS:
            conn.execute(text(stmt))
    print("OK: reinspeccion/auditoria sin cobro saneada y CHECK aplicado.")


if __name__ == "__main__":
    main()
