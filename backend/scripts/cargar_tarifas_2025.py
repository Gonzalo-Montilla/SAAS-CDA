"""
Script para cargar tarifas 2025 de todos los tipos de vehículos
CDASOFT
"""
import sys
import os
from decimal import Decimal
from datetime import date

# Agregar el directorio raíz al path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# Conexión a la base de datos
engine = create_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Tarifas 2025 por tipo de vehículo
tarifas_2025 = [
    # LIVIANO PARTICULAR
    {
        "tipo_vehiculo": "liviano_particular",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 0,
        "antiguedad_max": 2,
        "valor_rtm": Decimal("248710"),
        "valor_terceros": Decimal("54964"),
        "valor_total": Decimal("303674"),
        "descripcion_antiguedad": "0 a 2 años"
    },
    {
        "tipo_vehiculo": "liviano_particular",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 3,
        "antiguedad_max": 7,
        "valor_rtm": Decimal("248710"),
        "valor_terceros": Decimal("55364"),
        "valor_total": Decimal("304074"),
        "descripcion_antiguedad": "3 a 7 años"
    },
    {
        "tipo_vehiculo": "liviano_particular",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 8,
        "antiguedad_max": 17,
        "valor_rtm": Decimal("248710"),
        "valor_terceros": Decimal("55664"),
        "valor_total": Decimal("304374"),
        "descripcion_antiguedad": "8 a 17 años"
    },
    {
        "tipo_vehiculo": "liviano_particular",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 18,
        "antiguedad_max": None,
        "valor_rtm": Decimal("248710"),
        "valor_terceros": Decimal("55364"),
        "valor_total": Decimal("304074"),
        "descripcion_antiguedad": "Más de 17 años"
    },
    # LIVIANO PÚBLICO
    {
        "tipo_vehiculo": "liviano_publico",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 0,
        "antiguedad_max": 2,
        "valor_rtm": Decimal("245245"),
        "valor_terceros": Decimal("54464"),
        "valor_total": Decimal("299709"),
        "descripcion_antiguedad": "0 a 2 años"
    },
    {
        "tipo_vehiculo": "liviano_publico",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 3,
        "antiguedad_max": 7,
        "valor_rtm": Decimal("245245"),
        "valor_terceros": Decimal("54764"),
        "valor_total": Decimal("300009"),
        "descripcion_antiguedad": "3 a 7 años"
    },
    {
        "tipo_vehiculo": "liviano_publico",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 8,
        "antiguedad_max": 17,
        "valor_rtm": Decimal("245245"),
        "valor_terceros": Decimal("55064"),
        "valor_total": Decimal("300309"),
        "descripcion_antiguedad": "8 a 17 años"
    },
    {
        "tipo_vehiculo": "liviano_publico",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 18,
        "antiguedad_max": None,
        "valor_rtm": Decimal("245245"),
        "valor_terceros": Decimal("54864"),
        "valor_total": Decimal("300109"),
        "descripcion_antiguedad": "Más de 17 años"
    },
    # PESADO PARTICULAR
    {
        "tipo_vehiculo": "pesado_particular",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 0,
        "antiguedad_max": 2,
        "valor_rtm": Decimal("397560"),
        "valor_terceros": Decimal("54564"),
        "valor_total": Decimal("452124"),
        "descripcion_antiguedad": "0 a 2 años"
    },
    {
        "tipo_vehiculo": "pesado_particular",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 3,
        "antiguedad_max": 7,
        "valor_rtm": Decimal("397560"),
        "valor_terceros": Decimal("54864"),
        "valor_total": Decimal("452424"),
        "descripcion_antiguedad": "3 a 7 años"
    },
    {
        "tipo_vehiculo": "pesado_particular",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 8,
        "antiguedad_max": 17,
        "valor_rtm": Decimal("397560"),
        "valor_terceros": Decimal("55064"),
        "valor_total": Decimal("452624"),
        "descripcion_antiguedad": "8 a 17 años"
    },
    {
        "tipo_vehiculo": "pesado_particular",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 18,
        "antiguedad_max": None,
        "valor_rtm": Decimal("397560"),
        "valor_terceros": Decimal("54864"),
        "valor_total": Decimal("452424"),
        "descripcion_antiguedad": "Más de 17 años"
    },
    # PESADO PÚBLICO
    {
        "tipo_vehiculo": "pesado_publico",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 0,
        "antiguedad_max": 2,
        "valor_rtm": Decimal("397560"),
        "valor_terceros": Decimal("54164"),
        "valor_total": Decimal("451724"),
        "descripcion_antiguedad": "0 a 2 años"
    },
    {
        "tipo_vehiculo": "pesado_publico",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 3,
        "antiguedad_max": 7,
        "valor_rtm": Decimal("397560"),
        "valor_terceros": Decimal("54364"),
        "valor_total": Decimal("451924"),
        "descripcion_antiguedad": "3 a 7 años"
    },
    {
        "tipo_vehiculo": "pesado_publico",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 8,
        "antiguedad_max": 17,
        "valor_rtm": Decimal("397560"),
        "valor_terceros": Decimal("54564"),
        "valor_total": Decimal("452124"),
        "descripcion_antiguedad": "8 a 17 años"
    },
    {
        "tipo_vehiculo": "pesado_publico",
        "ano_vigencia": 2025,
        "vigencia_inicio": date(2025, 1, 1),
        "vigencia_fin": date(2025, 12, 31),
        "antiguedad_min": 18,
        "antiguedad_max": None,
        "valor_rtm": Decimal("397560"),
        "valor_terceros": Decimal("54364"),
        "valor_total": Decimal("451924"),
        "descripcion_antiguedad": "Más de 17 años"
    },
]


def main():
    """Cargar tarifas en la base de datos"""
    db = SessionLocal()
    try:
        print("Cargando tarifas 2025...")
        tenant_id = settings.SAAS_DEFAULT_TENANT_ID
        
        for tarifa_data in tarifas_2025:
            # Insertar usando SQL directo para evitar problemas de relaciones
            sql = text("""
                INSERT INTO tarifas (
                    id, tenant_id, ano_vigencia, vigencia_inicio, vigencia_fin, tipo_vehiculo,
                    antiguedad_min, antiguedad_max, valor_rtm, valor_terceros, 
                    valor_total, activa, created_at
                ) VALUES (
                    gen_random_uuid(), :tenant_id, :ano_vigencia, :vigencia_inicio, :vigencia_fin, :tipo_vehiculo,
                    :antiguedad_min, :antiguedad_max, :valor_rtm, :valor_terceros,
                    :valor_total, :activa, NOW()
                )
            """)
            
            # Remover descripcion_antiguedad (es una propiedad calculada)
            data = {k: v for k, v in tarifa_data.items() if k != 'descripcion_antiguedad'}
            data['activa'] = True
            data['tenant_id'] = tenant_id
            
            db.execute(sql, data)
            print(f"✓ {tarifa_data['tipo_vehiculo']} - {tarifa_data['descripcion_antiguedad']}: ${tarifa_data['valor_total']}")
        
        db.commit()
        print(f"\n✅ Se cargaron {len(tarifas_2025)} tarifas exitosamente")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    main()
