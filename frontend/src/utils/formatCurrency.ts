/**
 * Punto único de reexportación: todo COP sin decimales pasa por `formatNumber`.
 * Evita duplicar lógica (antes aquí se usaba `toLocaleString` distinto al resto).
 */
export { formatCurrency, formatCOP } from './formatNumber';
