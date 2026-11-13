const ETIQUETAS_TIPO_VEHICULO: Record<string, string> = {
  moto: 'Motocicleta',
  liviano_particular: 'Liviano particular',
  liviano_publico: 'Liviano público',
  pesado_particular: 'Pesado particular',
  pesado_publico: 'Pesado público',
  motocarro_particular: 'Motocarro particular',
  motocarro_publico: 'Motocarro público',
  preventiva: 'Preventiva',
  pruebas_auditoria: 'Pruebas de auditoría',
};

export function etiquetaTipoVehiculo(tipo?: string | null): string {
  const key = (tipo || '').trim().toLowerCase();
  if (!key) return '—';
  return ETIQUETAS_TIPO_VEHICULO[key] || key.replaceAll('_', ' ');
}

export function etiquetaTipoVehiculoMayus(tipo?: string | null): string {
  const label = etiquetaTipoVehiculo(tipo);
  return label === '—' ? label : label.toUpperCase();
}

export function esTipoMotocarro(tipo?: string | null): boolean {
  return (tipo || '').trim().toLowerCase().startsWith('motocarro');
}
