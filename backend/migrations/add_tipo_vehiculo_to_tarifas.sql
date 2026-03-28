-- Migración: Agregar campo tipo_vehiculo a tabla tarifas
-- Fecha: 2024-12-29
-- Proyecto: CDASOFT

-- 1. Agregar columna tipo_vehiculo
ALTER TABLE tarifas 
ADD COLUMN tipo_vehiculo VARCHAR(50);

-- 2. Actualizar tarifas existentes (motos de Piendamó) con el tipo
UPDATE tarifas 
SET tipo_vehiculo = 'moto' 
WHERE tipo_vehiculo IS NULL;

-- 3. Hacer la columna NOT NULL después de llenar los datos
ALTER TABLE tarifas 
ALTER COLUMN tipo_vehiculo SET NOT NULL;

-- 4. Crear índice para mejorar búsquedas
CREATE INDEX idx_tarifas_tipo_vehiculo ON tarifas(tipo_vehiculo);

-- 5. Crear índice compuesto para búsquedas por tipo + antigüedad + vigencia
CREATE INDEX idx_tarifas_busqueda ON tarifas(tipo_vehiculo, antiguedad_min, antiguedad_max, activa, vigencia_inicio, vigencia_fin);

-- Verificar cambios
SELECT 
    tipo_vehiculo,
    antiguedad_min,
    antiguedad_max,
    valor_total,
    activa
FROM tarifas
ORDER BY tipo_vehiculo, antiguedad_min;
