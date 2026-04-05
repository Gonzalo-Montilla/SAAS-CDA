/**
 * Formato COP entero (sin decimales) — usar en toda la app para montos en pantalla/PDF.
 * `formatCurrency`: solo dígitos y separadores; `formatCOP`: con prefijo $.
 * No depende del locale del sistema (evita inconsistencias entre equipos).
 */
export function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) return '0';
  
  // Convertir a string y separar parte entera de decimal
  const parts = num.toFixed(0).split('.');
  const integerPart = parts[0];
  
  // Agregar separadores de miles (puntos)
  const withSeparators = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  
  return withSeparators;
}

/**
 * Formatea con símbolo de peso
 */
export function formatCOP(value: number | string): string {
  return `$${formatCurrency(value)}`;
}
