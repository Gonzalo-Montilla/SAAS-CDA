import apiClient from './client';

/** GET/PUT /dse-retencion/parametros/{anio} — solo admin. */
export interface DseRetencionParametros {
  anio: number;
  valor_uvt_cop: number | null;
  tasas: Partial<Record<'compras' | 'servicios' | 'arrendamiento' | 'honorarios', number | null>>;
}

export type DseRetencionParametrosPut = {
  valor_uvt_cop?: number | null;
  tasas?: Partial<Record<'compras' | 'servicios' | 'arrendamiento' | 'honorarios', number | null>>;
};

export interface DseRetencionPreviewOut {
  retencion_cop: string | null;
  aplica: boolean;
  base_minima_cop: string | null;
  umbral_uvt: string;
  tasa_porcentaje: string | null;
  valor_uvt_cop: string | null;
  motivo_sin_calculo: string | null;
}

export const dseRetencionApi = {
  getParametros: async (anio: number): Promise<DseRetencionParametros> => {
    const { data } = await apiClient.get<DseRetencionParametros>(`/dse-retencion/parametros/${anio}`);
    return data;
  },

  putParametros: async (anio: number, body: DseRetencionParametrosPut): Promise<DseRetencionParametros> => {
    const { data } = await apiClient.put<DseRetencionParametros>(`/dse-retencion/parametros/${anio}`, body);
    return data;
  },

  /** POST /dse-retencion/preview — admin o contador. */
  postPreview: async (body: {
    monto: number;
    concepto: string;
    anio: number;
  }): Promise<DseRetencionPreviewOut> => {
    const { data } = await apiClient.post<DseRetencionPreviewOut>('/dse-retencion/preview', body);
    return data;
  },
};
