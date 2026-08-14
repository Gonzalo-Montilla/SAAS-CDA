import apiClient from './client';

export interface AgendamientoMetricasResponse {
  periodo: string;
  fecha_generacion: string;
  total_citas: number;
  por_estado: {
    scheduled: number;
    confirmed: number;
    checked_in: number;
    cancelled: number;
    no_show: number;
  };
  por_origen: {
    public_link: number;
    manual: number;
    otros: number;
  };
  citas_con_email: number;
  citas_sin_email: number;
  recordatorios_enviados: number;
  recordatorios_pendientes: number;
  recordatorios_fallidos: number;
  recordatorios_omitidos: number;
  tasa_check_in_pct: number;
  serie_diaria: Array<{
    fecha: string;
    total: number;
    checked_in: number;
    canceladas: number;
    no_show: number;
  }>;
}

/** Cierres de caja para auditoría (GET /reportes/cierres-caja). */
export interface CierreCajaReporteItem {
  id: string;
  cajero_nombre: string;
  sucursal_nombre?: string | null;
  fecha_apertura: string;
  fecha_cierre?: string | null;
  turno: string;
  monto_inicial: number;
  monto_final_sistema?: number | null;
  monto_final_fisico?: number | null;
  diferencia?: number | null;
  observaciones_cierre?: string | null;
}

export interface DashboardOperativoResponse {
  periodo: string;
  resumen_operativo: {
    ingresados_periodo: number;
    pagados_periodo: number;
    reintentos_validados_periodo: number;
    terminados_periodo: number;
    pendientes_caja: number;
    pendientes_pista: number;
    en_pista: number;
    max_espera_caja_min: number;
  };
  sla: {
    objetivo_minutos: number;
    promedio_minutos: number;
    p50_minutos: number;
    p90_minutos: number;
    cumplimiento_objetivo_pct: number;
    muestra: number;
  };
  casos_en_riesgo: Array<{
    id: string;
    placa: string;
    cliente: string;
    estado: string;
    minutos_espera: number;
  }>;
  fecha_generacion: string;
}

export interface CxcClienteItem {
  cliente_nombre: string;
  cliente_documento: string;
  cliente_telefono?: string | null;
  cliente_email?: string | null;
  sucursal_nombre?: string | null;
  tramites_pendientes: number;
  monto_pendiente_total: number;
  antiguedad_max_dias: number;
  aging_tramo?: string;
  fecha_registro_mas_antigua?: string | null;
  placas: string[];
}

export interface CxcAgingBucket {
  monto: number;
  tramites: number;
  clientes: number;
}

export interface CxcGeneralClienteResponse {
  fecha_corte: string;
  resumen: {
    total_clientes: number;
    total_tramites_pendientes: number;
    saldo_total_pendiente: number;
    aging?: {
      '0_30': CxcAgingBucket;
      '31_60': CxcAgingBucket;
      '61_90': CxcAgingBucket;
      mas_90: CxcAgingBucket;
    };
  };
  clientes: CxcClienteItem[];
}

export interface CxcTramiteDetalleItem {
  vehiculo_id: string;
  placa?: string | null;
  fecha_registro?: string | null;
  antiguedad_dias: number;
  aging_tramo: string;
  total_cobrado: number;
  sucursal_nombre?: string | null;
  tipo_vehiculo?: string | null;
}

export interface CxcClienteDetalleResponse {
  fecha_corte: string;
  cliente_nombre: string;
  cliente_documento: string;
  resumen: { tramites: number; saldo_pendiente: number };
  tramites: CxcTramiteDetalleItem[];
}

export interface CierrePeriodoResumenResponse {
  periodo: string;
  fecha_corte: string;
  checklist: Array<{
    id: string;
    label: string;
    ok: boolean;
    valor: number;
    tab: string;
    detalle: string;
  }>;
  conciliacion: {
    ventas_cobradas: number;
    gastos_caja: number;
    gastos_tesoreria: number;
    gastos_totales: number;
    resultado_neto_estimado: number;
  };
  resumen: {
    cxc_abierta: number;
    obligaciones_saldo: number;
    obligaciones_vencidas: number;
    exogena_enabled: boolean;
    mapeos_exogena: number;
  };
}

export interface CxpProveedorItem {
  proveedor_nombre: string;
  proveedor_documento: string;
  proveedor_tipo_documento?: string | null;
  proveedor_email?: string | null;
  proveedor_telefono?: string | null;
  proveedor_direccion?: string | null;
  sucursal_nombre?: string | null;
  desde_catalogo: boolean;
  proveedor_catalogo_id?: string | null;
  concepto_retencion_dse?: string | null;
  movimientos_egreso: number;
  valor_egresado_total: number;
  fecha_ultimo_egreso?: string | null;
  referencias_comprobante: string[];
}

export interface CxpGeneralProveedorResponse {
  periodo: string;
  resumen: {
    total_proveedores: number;
    total_movimientos: number;
    valor_egresado_total: number;
  };
  proveedores: CxpProveedorItem[];
}

export interface VentaVendedorItem {
  vendedor_id?: string | null;
  vendedor_nombre: string;
  sucursal_nombre?: string | null;
  tramites_vendidos: number;
  total_vendido: number;
  ticket_promedio: number;
  primera_venta_at?: string | null;
  ultima_venta_at?: string | null;
  placas: string[];
  metodos_pago: Record<string, number>;
}

export interface VentasVendedorResponse {
  periodo: string;
  resumen: {
    total_vendedores: number;
    total_tramites: number;
    total_vendido: number;
    ticket_promedio_general: number;
  };
  vendedores: VentaVendedorItem[];
}

export interface VentaSucursalItem {
  sucursal_id?: string | null;
  sucursal_nombre: string;
  sucursal_codigo?: string | null;
  tramites_vendidos: number;
  total_vendido: number;
  ticket_promedio: number;
  vendedores_unicos: number;
  primera_venta_at?: string | null;
  ultima_venta_at?: string | null;
  placas: string[];
  metodos_pago: Record<string, number>;
}

export interface VentasSucursalResponse {
  periodo: string;
  resumen: {
    total_sucursales: number;
    total_tramites: number;
    total_vendido: number;
    ticket_promedio_general: number;
  };
  sucursales: VentaSucursalItem[];
}

export interface EstadoSituacionGerencialResponse {
  fecha_corte: string;
  alcance: string;
  notas: string[];
  activos: {
    efectivo_equivalente: number;
    cxc_operativa: number;
    total_activos: number;
  };
  pasivos: {
    cxp_proveedores: number;
    total_pasivos: number;
  };
  patrimonio: {
    patrimonio_estimado: number;
  };
}

export interface BalancePruebaCuentaItem {
  codigo: string;
  nombre: string;
  naturaleza: string;
  debito: number;
  credito: number;
  saldo: number;
  origenes: string[];
}

export interface BalancePruebaGerencialResponse {
  fecha_corte: string;
  alcance: string;
  notas: string[];
  resumen: {
    total_debitos: number;
    total_creditos: number;
    diferencia_debito_credito: number;
    cuadre_ok: boolean;
    total_cuentas: number;
  };
  cuentas: BalancePruebaCuentaItem[];
}

export interface BalancePruebaTerceroItem {
  codigo_cuenta: string;
  nombre_cuenta: string;
  tercero_tipo_documento: string;
  tercero_documento: string;
  tercero_nombre: string;
  debito: number;
  credito: number;
  saldo: number;
  origenes: string[];
}

export interface BalancePruebaTerceroGerencialResponse {
  fecha_corte: string;
  alcance: string;
  notas: string[];
  resumen: {
    total_debitos: number;
    total_creditos: number;
    diferencia_debito_credito: number;
    cuadre_ok: boolean;
    total_filas: number;
  };
  filas: BalancePruebaTerceroItem[];
}

export interface EstadoResultadoGerencialResponse {
  periodo: string;
  alcance: string;
  notas: string[];
  ingresos: {
    operacionales_brutos: number;
    contra_ingresos: number;
    operacionales_netos: number;
    otros_ingresos: number;
    otros_ingresos_detalle: Record<string, number>;
  };
  gastos: {
    gastos_caja: number;
    gastos_tesoreria: number;
    gastos_tesoreria_detalle: Record<string, number>;
    gastos_operacionales_totales: number;
  };
  resultado: {
    utilidad_operacional: number;
    resultado_antes_impuestos: number;
    impuesto_estimado: number;
    resultado_neto_estimado: number;
    margen_neto_pct: number;
  };
}

export interface EstadoFlujoEfectivoGerencialResponse {
  periodo: string;
  alcance: string;
  notas: string[];
  saldos: {
    saldo_inicial: number;
    saldo_final: number;
    variacion_neta: number;
  };
  operacion: {
    entradas: number;
    salidas: number;
    neto: number;
  };
  inversion: {
    entradas: number;
    salidas: number;
    neto: number;
  };
  financiacion: {
    entradas: number;
    salidas: number;
    neto: number;
  };
  internos: {
    traslados_caja_tesoreria: number;
  };
  conciliacion: {
    saldo_inicial_mas_flujos: number;
    saldo_final_real: number;
    diferencia_conciliacion: number;
    conciliacion_ok: boolean;
  };
}

export interface EstadoCambiosPatrimonioGerencialResponse {
  periodo: string;
  alcance: string;
  notas: string[];
  patrimonio: {
    patrimonio_inicial_estimado: number;
    patrimonio_final_estimado: number;
    patrimonio_final_real: number;
  };
  movimientos: {
    resultado_neto_estimado_periodo: number;
    aportes_socios: number;
    retiros_socios: number;
    ajustes_patrimoniales_netos: number;
  };
  conciliacion: {
    patrimonio_inicial_mas_cambios: number;
    patrimonio_final_real: number;
    diferencia_conciliacion: number;
    conciliacion_ok: boolean;
  };
}

export interface GastoPeriodoItem {
  id: string;
  origen: 'caja' | 'tesoreria' | string;
  fecha?: string | null;
  tipo: string;
  clasificacion: 'gasto' | 'devolucion' | string;
  categoria?: string | null;
  concepto: string;
  beneficiario?: string | null;
  documento?: string | null;
  metodo_pago?: string | null;
  monto: number;
  sucursal_id?: string | null;
  sucursal_nombre?: string | null;
  numero_comprobante?: string | null;
  tiene_factura_soporte?: boolean;
  factura_soporte_nombre?: string | null;
}

export interface GastosPeriodoResponse {
  periodo: string;
  alcance: string;
  notas: string[];
  resumen: {
    total_movimientos: number;
    total_caja: number;
    total_tesoreria: number;
    total_gastos: number;
    total_devoluciones: number;
    total_egresado: number;
    por_categoria: Record<string, number>;
  };
  items: GastoPeriodoItem[];
}

export interface FacturacionContingenciaItem {
  vehiculo_id: string;
  fecha_pago?: string | null;
  sucursal_id?: string | null;
  sucursal_nombre?: string | null;
  placa: string;
  cliente_nombre: string;
  cliente_documento: string;
  total_cobrado: number;
  metodo_pago: string;
  numero_factura_dian?: string | null;
  motivo_pendiente: string;
  puede_emitir: boolean;
}

export interface FacturacionContingenciaListResponse {
  total: number;
  dias_consulta: number;
  modo_factus_activo: boolean;
  credenciales_factus_ok: boolean;
  items: FacturacionContingenciaItem[];
}

export interface FacturacionContingenciaEmitResponse {
  vehiculo_id: string;
  numero_factura_dian: string;
  cufe?: string | null;
  public_url?: string | null;
  emitted_at: string;
}

async function fetchFacturaSoporteGastoBlob(
  origen: 'caja' | 'tesoreria' | string,
  movimientoId: string,
): Promise<{ blob: Blob; filename: string; mime: string }> {
  const response = await apiClient.get(
    `/reportes/gastos/${origen}/${movimientoId}/factura-soporte`,
    { responseType: 'blob' },
  );
  const cd = String(response.headers['content-disposition'] || '');
  const match = cd.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || `factura_soporte_${movimientoId}`;
  const blob = response.data as Blob;
  const headerMime = String(response.headers['content-type'] || '');
  const mime = (blob.type || headerMime || 'application/octet-stream').split(';')[0].trim();

  // Si el backend devolvió JSON de error con status 200 raro, o axios entregó error como blob
  if (mime.includes('json') || mime.includes('text/html')) {
    let detail = 'No se pudo obtener la factura adjunta.';
    try {
      const text = await blob.text();
      const parsed = JSON.parse(text);
      if (typeof parsed?.detail === 'string') detail = parsed.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  return { blob, filename, mime: mime || 'application/pdf' };
}

export const reportesApi = {
  getAgendamientoMetricas: async (queryParams: string): Promise<AgendamientoMetricasResponse> => {
    const response = await apiClient.get<AgendamientoMetricasResponse>(
      `/reportes/agendamiento-metricas?${queryParams}`,
    );
    return response.data;
  },

  getDashboardOperativo: async (params: {
    modoVista: 'dia' | 'rango';
    fechaSeleccionada: string;
    fechaInicio: string;
    fechaFin: string;
    /** e.g. `&consolidar_todas=true` or `&sucursal_id=uuid` */
    sedeQuerySuffix?: string;
  }): Promise<DashboardOperativoResponse> => {
    const query =
      params.modoVista === 'rango'
        ? `fecha_inicio=${params.fechaInicio}&fecha_fin=${params.fechaFin}`
        : `fecha=${params.fechaSeleccionada}`;
    const suffix = params.sedeQuerySuffix ?? '';
    const response = await apiClient.get<DashboardOperativoResponse>(
      `/reportes/dashboard-operativo?${query}${suffix}`,
    );
    return response.data;
  },

  getCierresCaja: async (queryString: string): Promise<CierreCajaReporteItem[]> => {
    const response = await apiClient.get<CierreCajaReporteItem[]>(`/reportes/cierres-caja?${queryString}`);
    return response.data;
  },

  getCxcGeneralCliente: async (params?: {
    fechaCorte?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
    limit?: number;
  }): Promise<CxcGeneralClienteResponse> => {
    const qp = new URLSearchParams();
    if (params?.fechaCorte) qp.set('fecha_corte', params.fechaCorte);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    if (params?.limit) qp.set('limit', String(params.limit));
    const suffix = qp.toString();
    const response = await apiClient.get<CxcGeneralClienteResponse>(
      `/reportes/cxc-general-cliente${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getCxcClienteDetalle: async (params: {
    clienteDocumento: string;
    clienteNombre?: string;
    fechaCorte?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
    limit?: number;
  }): Promise<CxcClienteDetalleResponse> => {
    const qp = new URLSearchParams();
    qp.set('cliente_documento', params.clienteDocumento);
    if (params.clienteNombre) qp.set('cliente_nombre', params.clienteNombre);
    if (params.fechaCorte) qp.set('fecha_corte', params.fechaCorte);
    if (params.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params.sucursalId) qp.set('sucursal_id', params.sucursalId);
    if (params.limit) qp.set('limit', String(params.limit));
    const response = await apiClient.get<CxcClienteDetalleResponse>(
      `/reportes/cxc-cliente-detalle?${qp.toString()}`,
    );
    return response.data;
  },

  getCierrePeriodoResumen: async (params?: {
    fechaInicio?: string;
    fechaFin?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
  }): Promise<CierrePeriodoResumenResponse> => {
    const qp = new URLSearchParams();
    if (params?.fechaInicio) qp.set('fecha_inicio', params.fechaInicio);
    if (params?.fechaFin) qp.set('fecha_fin', params.fechaFin);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    const suffix = qp.toString();
    const response = await apiClient.get<CierrePeriodoResumenResponse>(
      `/reportes/cierre-periodo-resumen${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getCxpGeneralProveedor: async (params?: {
    fechaInicio?: string;
    fechaFin?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
    limit?: number;
  }): Promise<CxpGeneralProveedorResponse> => {
    const qp = new URLSearchParams();
    if (params?.fechaInicio) qp.set('fecha_inicio', params.fechaInicio);
    if (params?.fechaFin) qp.set('fecha_fin', params.fechaFin);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    if (params?.limit) qp.set('limit', String(params.limit));
    const suffix = qp.toString();
    const response = await apiClient.get<CxpGeneralProveedorResponse>(
      `/reportes/cxp-general-proveedor${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getVentasPorVendedor: async (params?: {
    fecha?: string;
    fechaInicio?: string;
    fechaFin?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
    limit?: number;
  }): Promise<VentasVendedorResponse> => {
    const qp = new URLSearchParams();
    if (params?.fecha) qp.set('fecha', params.fecha);
    if (params?.fechaInicio) qp.set('fecha_inicio', params.fechaInicio);
    if (params?.fechaFin) qp.set('fecha_fin', params.fechaFin);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    if (params?.limit) qp.set('limit', String(params.limit));
    const suffix = qp.toString();
    const response = await apiClient.get<VentasVendedorResponse>(
      `/reportes/ventas-por-vendedor${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getVentasPorSucursal: async (params?: {
    fecha?: string;
    fechaInicio?: string;
    fechaFin?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
    limit?: number;
  }): Promise<VentasSucursalResponse> => {
    const qp = new URLSearchParams();
    if (params?.fecha) qp.set('fecha', params.fecha);
    if (params?.fechaInicio) qp.set('fecha_inicio', params.fechaInicio);
    if (params?.fechaFin) qp.set('fecha_fin', params.fechaFin);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    if (params?.limit) qp.set('limit', String(params.limit));
    const suffix = qp.toString();
    const response = await apiClient.get<VentasSucursalResponse>(
      `/reportes/ventas-por-sucursal${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getEstadoSituacionGerencial: async (params?: {
    fechaCorte?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
  }): Promise<EstadoSituacionGerencialResponse> => {
    const qp = new URLSearchParams();
    if (params?.fechaCorte) qp.set('fecha_corte', params.fechaCorte);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    const suffix = qp.toString();
    const response = await apiClient.get<EstadoSituacionGerencialResponse>(
      `/reportes/estado-situacion-gerencial${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getBalancePruebaGerencial: async (params?: {
    fechaCorte?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
  }): Promise<BalancePruebaGerencialResponse> => {
    const qp = new URLSearchParams();
    if (params?.fechaCorte) qp.set('fecha_corte', params.fechaCorte);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    const suffix = qp.toString();
    const response = await apiClient.get<BalancePruebaGerencialResponse>(
      `/reportes/balance-prueba-gerencial${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getBalancePruebaTerceroGerencial: async (params?: {
    fechaCorte?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
    limit?: number;
  }): Promise<BalancePruebaTerceroGerencialResponse> => {
    const qp = new URLSearchParams();
    if (params?.fechaCorte) qp.set('fecha_corte', params.fechaCorte);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    if (params?.limit) qp.set('limit', String(params.limit));
    const suffix = qp.toString();
    const response = await apiClient.get<BalancePruebaTerceroGerencialResponse>(
      `/reportes/balance-prueba-tercero-gerencial${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getEstadoResultadoGerencial: async (params?: {
    fecha?: string;
    fechaInicio?: string;
    fechaFin?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
  }): Promise<EstadoResultadoGerencialResponse> => {
    const qp = new URLSearchParams();
    if (params?.fecha) qp.set('fecha', params.fecha);
    if (params?.fechaInicio) qp.set('fecha_inicio', params.fechaInicio);
    if (params?.fechaFin) qp.set('fecha_fin', params.fechaFin);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    const suffix = qp.toString();
    const response = await apiClient.get<EstadoResultadoGerencialResponse>(
      `/reportes/estado-resultado-gerencial${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getEstadoFlujoEfectivoGerencial: async (params?: {
    fecha?: string;
    fechaInicio?: string;
    fechaFin?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
  }): Promise<EstadoFlujoEfectivoGerencialResponse> => {
    const qp = new URLSearchParams();
    if (params?.fecha) qp.set('fecha', params.fecha);
    if (params?.fechaInicio) qp.set('fecha_inicio', params.fechaInicio);
    if (params?.fechaFin) qp.set('fecha_fin', params.fechaFin);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    const suffix = qp.toString();
    const response = await apiClient.get<EstadoFlujoEfectivoGerencialResponse>(
      `/reportes/estado-flujo-efectivo-gerencial${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getGastosPeriodo: async (params?: {
    fecha?: string;
    fechaInicio?: string;
    fechaFin?: string;
    origen?: 'caja' | 'tesoreria';
    incluirDevoluciones?: boolean;
    consolidarTodas?: boolean;
    sucursalId?: string;
    limit?: number;
  }): Promise<GastosPeriodoResponse> => {
    const qp = new URLSearchParams();
    if (params?.fecha) qp.set('fecha', params.fecha);
    if (params?.fechaInicio) qp.set('fecha_inicio', params.fechaInicio);
    if (params?.fechaFin) qp.set('fecha_fin', params.fechaFin);
    if (params?.origen) qp.set('origen', params.origen);
    if (params?.incluirDevoluciones === false) qp.set('incluir_devoluciones', 'false');
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    if (params?.limit) qp.set('limit', String(params.limit));
    const suffix = qp.toString();
    const response = await apiClient.get<GastosPeriodoResponse>(
      `/reportes/gastos-periodo${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  obtenerFacturaSoporteGastoBlob: fetchFacturaSoporteGastoBlob,

  descargarFacturaSoporteGasto: async (
    origen: 'caja' | 'tesoreria' | string,
    movimientoId: string,
  ): Promise<void> => {
    const { blob, filename } = await fetchFacturaSoporteGastoBlob(origen, movimientoId);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  getEstadoCambiosPatrimonioGerencial: async (params?: {
    fecha?: string;
    fechaInicio?: string;
    fechaFin?: string;
    consolidarTodas?: boolean;
    sucursalId?: string;
  }): Promise<EstadoCambiosPatrimonioGerencialResponse> => {
    const qp = new URLSearchParams();
    if (params?.fecha) qp.set('fecha', params.fecha);
    if (params?.fechaInicio) qp.set('fecha_inicio', params.fechaInicio);
    if (params?.fechaFin) qp.set('fecha_fin', params.fechaFin);
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    const suffix = qp.toString();
    const response = await apiClient.get<EstadoCambiosPatrimonioGerencialResponse>(
      `/reportes/estado-cambios-patrimonio-gerencial${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  getFacturacionContingencia: async (params?: {
    dias?: number;
    consolidarTodas?: boolean;
    sucursalId?: string;
    limit?: number;
  }): Promise<FacturacionContingenciaListResponse> => {
    const qp = new URLSearchParams();
    if (params?.dias != null) qp.set('dias', String(params.dias));
    if (params?.consolidarTodas) qp.set('consolidar_todas', 'true');
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    if (params?.limit != null) qp.set('limit', String(params.limit));
    const suffix = qp.toString();
    const response = await apiClient.get<FacturacionContingenciaListResponse>(
      `/reportes/facturacion-contingencia${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  emitirFacturaContingencia: async (
    vehiculoId: string,
    params?: { sucursalId?: string | null },
  ): Promise<FacturacionContingenciaEmitResponse> => {
    const qp = new URLSearchParams();
    if (params?.sucursalId) qp.set('sucursal_id', params.sucursalId);
    const suffix = qp.toString();
    const response = await apiClient.post<FacturacionContingenciaEmitResponse>(
      `/reportes/facturacion-contingencia/${vehiculoId}/emitir${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },
};

