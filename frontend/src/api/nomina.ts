import apiClient, { apiBaseUrl } from './client';

export interface NominaPeriodo {
  id: string;
  tenant_id: string;
  anio: string;
  mes: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_pago?: string | null;
  estado: string;
  observaciones?: string | null;
  created_at: string;
}

export interface NominaPeriodoCreatePayload {
  anio: string;
  mes: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_pago?: string | null;
  observaciones?: string | null;
}

export interface NominaLiquidacion {
  id: string;
  tenant_id: string;
  periodo_id: string;
  empleado_id: string;
  contrato_id: string;
  salario_base: number;
  total_devengos: number;
  total_deducciones: number;
  neto_pagar: number;
  auxilio_transporte_devengo: number;
  base_cotizacion: number;
  aporte_salud_empleado: number;
  aporte_pension_empleado: number;
  aporte_fsp_empleado: number;
  aporte_subsistencia_empleado: number;
  retencion_fuente_empleado: number;
  aporte_salud_empresa: number;
  aporte_pension_empresa: number;
  aporte_arl_empresa: number;
  aporte_caja_empresa: number;
  aporte_sena_empresa: number;
  aporte_icbf_empresa: number;
  provision_prima: number;
  provision_cesantias: number;
  provision_intereses_cesantias: number;
  provision_vacaciones: number;
  costo_total_empresa: number;
  desprendible_folio?: string | null;
  desprendible_version: number;
  desprendible_pdf_sha256?: string | null;
  desprendible_generated_at?: string | null;
  observaciones?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NominaEmpleado {
  id: string;
  tenant_id: string;
  sucursal_id?: string | null;
  centro_costo_id?: string | null;
  codigo_interno?: string | null;
  documento_tipo: string;
  documento_numero: string;
  nombres: string;
  apellidos: string;
  email?: string | null;
  celular?: string | null;
  fecha_ingreso?: string;
  activo?: string;
  created_at?: string;
}

export interface NominaEmpleadoCreatePayload {
  sucursal_id?: string | null;
  centro_costo_id?: string | null;
  codigo_interno?: string | null;
  documento_tipo: string;
  documento_numero: string;
  nombres: string;
  apellidos: string;
  email?: string | null;
  celular?: string | null;
  fecha_ingreso: string;
}

export interface NominaContrato {
  id: string;
  tenant_id: string;
  empleado_id: string;
  es_salario_integral: boolean;
  centro_costo_id?: string | null;
  tipo_contrato: string;
  periodicidad: string;
  salario_base: number;
  fecha_inicio: string;
  fecha_fin?: string | null;
  estado: string;
  observaciones?: string | null;
  created_at: string;
}

export interface NominaContratoCreatePayload {
  empleado_id: string;
  es_salario_integral?: boolean;
  centro_costo_id?: string | null;
  tipo_contrato: 'fijo' | 'indefinido' | 'obra_labor' | 'aprendizaje' | 'temporal';
  periodicidad: 'quincenal' | 'mensual';
  salario_base: number;
  fecha_inicio: string;
  fecha_fin?: string | null;
  observaciones?: string | null;
}

export interface NominaNovedad {
  id: string;
  tenant_id: string;
  periodo_id: string;
  empleado_id: string;
  tipo: 'devengo' | 'deduccion';
  concepto: string;
  unidades: number;
  valor_unitario: number;
  valor_total: number;
  observaciones?: string | null;
  created_at: string;
}

export interface NominaNovedadCreatePayload {
  periodo_id: string;
  empleado_id: string;
  tipo: 'devengo' | 'deduccion';
  concepto: string;
  unidades: number;
  valor_unitario: number;
  valor_total: number;
  observaciones?: string | null;
}

export interface NominaPreliquidacionResumen {
  periodo_id: string;
  empleados_liquidados: number;
  total_salario_base: number;
  total_devengos: number;
  total_deducciones: number;
  total_neto_pagar: number;
}

export interface NominaParametroLegal {
  id: string;
  tenant_id: string;
  salario_minimo_mensual: number;
  auxilio_transporte_mensual: number;
  uvt: number;
  tope_ibc_smmlv: number;
  umbral_exoneracion_smmlv: number;
  exoneracion_aportes_activa: boolean;
  aplica_auxilio_transporte: boolean;
  umbral_auxilio_transporte_smmlv: number;
  aplica_fsp: boolean;
  umbral_fsp_smmlv: number;
  pct_fsp_base: number;
  aplica_subsistencia: boolean;
  aplica_retencion_fuente: boolean;
  umbral_retencion_uvt: number;
  pct_retencion_base: number;
  pct_ibc_salario_integral: number;
  pct_salud_empleado: number;
  pct_pension_empleado: number;
  pct_salud_empresa: number;
  pct_pension_empresa: number;
  pct_arl_empresa: number;
  pct_caja_empresa: number;
  pct_sena_empresa: number;
  pct_icbf_empresa: number;
  updated_at?: string | null;
}

export type NominaParametroLegalUpdatePayload = Partial<Omit<NominaParametroLegal, 'id' | 'tenant_id' | 'updated_at'>>;

export interface NominaCentroCosto {
  id: string;
  tenant_id: string;
  sucursal_id?: string | null;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  activo: string;
  created_at: string;
}

export interface NominaCentroCostoCreatePayload {
  sucursal_id?: string | null;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
}

export interface NominaDesprendibleVersion {
  id: string;
  liquidacion_id: string;
  periodo_id: string;
  empleado_id: string;
  folio?: string | null;
  version: number;
  pdf_relpath: string;
  pdf_sha256: string;
  generated_at: string;
  generated_by: string;
  motivo: string;
}

export interface NominaReemitirResponse {
  ok: boolean;
  liquidacion_id: string;
  folio: string;
  version: number;
  pdf_sha256?: string | null;
  pdf_bytes: number;
}

async function fetchPdf(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = localStorage.getItem('access_token');
  if (!token) {
    throw new Error('No hay token de autenticacion');
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`No se pudo descargar el PDF (HTTP ${response.status})`);
  }
  const blob = await response.blob();
  const contentDisposition = response.headers.get('content-disposition') || '';
  const match = contentDisposition.match(/filename="?(.+?)"?$/i);
  return {
    blob,
    filename: (match?.[1] || 'desprendible.pdf').trim(),
  };
}

export const nominaApi = {
  listarPeriodos: async (): Promise<NominaPeriodo[]> => {
    const response = await apiClient.get<NominaPeriodo[]>('/nomina/periodos');
    return response.data;
  },

  crearPeriodo: async (payload: NominaPeriodoCreatePayload): Promise<NominaPeriodo> => {
    const response = await apiClient.post<NominaPeriodo>('/nomina/periodos', payload);
    return response.data;
  },

  obtenerParametrosLegales: async (): Promise<NominaParametroLegal> => {
    const response = await apiClient.get<NominaParametroLegal>('/nomina/parametros-legales');
    return response.data;
  },

  actualizarParametrosLegales: async (
    payload: NominaParametroLegalUpdatePayload
  ): Promise<NominaParametroLegal> => {
    const response = await apiClient.put<NominaParametroLegal>('/nomina/parametros-legales', payload);
    return response.data;
  },

  listarCentrosCosto: async (): Promise<NominaCentroCosto[]> => {
    const response = await apiClient.get<NominaCentroCosto[]>('/nomina/centros-costo');
    return response.data;
  },

  crearCentroCosto: async (payload: NominaCentroCostoCreatePayload): Promise<NominaCentroCosto> => {
    const response = await apiClient.post<NominaCentroCosto>('/nomina/centros-costo', payload);
    return response.data;
  },

  listarEmpleados: async (): Promise<NominaEmpleado[]> => {
    const response = await apiClient.get<NominaEmpleado[]>('/nomina/empleados');
    return response.data;
  },

  crearEmpleado: async (payload: NominaEmpleadoCreatePayload): Promise<NominaEmpleado> => {
    const response = await apiClient.post<NominaEmpleado>('/nomina/empleados', payload);
    return response.data;
  },

  listarContratos: async (): Promise<NominaContrato[]> => {
    const response = await apiClient.get<NominaContrato[]>('/nomina/contratos');
    return response.data;
  },

  crearContrato: async (payload: NominaContratoCreatePayload): Promise<NominaContrato> => {
    const response = await apiClient.post<NominaContrato>('/nomina/contratos', payload);
    return response.data;
  },

  listarLiquidacionesPeriodo: async (
    periodoId: string,
    params?: { empleado_id?: string; sucursal_id?: string; centro_costo_id?: string }
  ): Promise<NominaLiquidacion[]> => {
    const response = await apiClient.get<NominaLiquidacion[]>(`/nomina/periodos/${periodoId}/liquidaciones`, { params });
    return response.data;
  },

  listarNovedadesPeriodo: async (
    periodoId: string,
    params?: { empleado_id?: string; sucursal_id?: string; centro_costo_id?: string }
  ): Promise<NominaNovedad[]> => {
    const response = await apiClient.get<NominaNovedad[]>(`/nomina/novedades`, {
      params: { periodo_id: periodoId, ...params },
    });
    return response.data;
  },

  crearNovedad: async (payload: NominaNovedadCreatePayload): Promise<NominaNovedad> => {
    const response = await apiClient.post<NominaNovedad>('/nomina/novedades', payload);
    return response.data;
  },

  listarVersionesDesprendible: async (liquidacionId: string): Promise<NominaDesprendibleVersion[]> => {
    const response = await apiClient.get<NominaDesprendibleVersion[]>(
      `/nomina/liquidaciones/${liquidacionId}/desprendibles/versiones`
    );
    return response.data;
  },

  reemitirDesprendible: async (liquidacionId: string): Promise<NominaReemitirResponse> => {
    const response = await apiClient.post<NominaReemitirResponse>(
      `/nomina/liquidaciones/${liquidacionId}/reemitir-desprendible`
    );
    return response.data;
  },

  preliquidarPeriodo: async (periodoId: string): Promise<NominaPreliquidacionResumen> => {
    const response = await apiClient.post<NominaPreliquidacionResumen>(`/nomina/periodos/${periodoId}/preliquidar`);
    return response.data;
  },

  aprobarPeriodo: async (periodoId: string): Promise<NominaPeriodo> => {
    const response = await apiClient.post<NominaPeriodo>(`/nomina/periodos/${periodoId}/aprobar`);
    return response.data;
  },

  cerrarPeriodo: async (periodoId: string): Promise<NominaPeriodo> => {
    const response = await apiClient.post<NominaPeriodo>(`/nomina/periodos/${periodoId}/cerrar`);
    return response.data;
  },

  marcarPagadaPeriodo: async (periodoId: string): Promise<NominaPeriodo> => {
    const response = await apiClient.post<NominaPeriodo>(`/nomina/periodos/${periodoId}/marcar-pagada`);
    return response.data;
  },

  descargarDesprendibleActual: (liquidacionId: string) =>
    fetchPdf(`/nomina/liquidaciones/${liquidacionId}/desprendible.pdf`),

  descargarDesprendibleVersion: (liquidacionId: string, version: number) =>
    fetchPdf(`/nomina/liquidaciones/${liquidacionId}/desprendibles/versiones/${version}/pdf`),
};
