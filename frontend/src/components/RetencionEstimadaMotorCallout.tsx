import { Loader2, Shield } from 'lucide-react';
import { formatCurrency } from '../utils/formatNumber';
import type { DseRetencionPreviewOut } from '../api/dseRetencion';
import { useDseRetencionPreview } from '../hooks/useDseRetencionPreview';

type Props = {
  anio: number;
  loading: boolean;
  error: string | null;
  data: DseRetencionPreviewOut | null;
};

export function RetencionEstimadaMotorCallout({ anio, loading, error, data }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" aria-hidden />
        <span>Retención estimada (motor)…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-900">
        <span className="font-medium">Retención estimada:</span> {error}
      </div>
    );
  }

  if (!data) return null;

  const retNum = data.retencion_cop != null ? Number(data.retencion_cop) : NaN;
  const muestraMonto = data.aplica && Number.isFinite(retNum);

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2.5 text-xs text-violet-950">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-violet-900">
        <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Retención estimada (motor DIAN)
      </div>
      <p className="text-[11px] text-violet-800/90">Parámetros UVT/tasas · año {anio}</p>
      {muestraMonto ? (
        <p className="mt-1 text-sm font-bold text-violet-950">${formatCurrency(retNum)}</p>
      ) : (
        <p className="mt-1 text-violet-900">{data.motivo_sin_calculo ?? 'Sin retención según reglas actuales.'}</p>
      )}
    </div>
  );
}

/** Egreso con proveedor de catálogo: estimación con debounce vía POST /dse-retencion/preview. */
export function RetencionEstimadaMotorInline(props: {
  montoPositivo: number;
  conceptoRetencionDse: string | null | undefined;
  anio?: number;
  enabled: boolean;
}) {
  const anio = props.anio ?? new Date().getFullYear();
  const innerEnabled =
    props.enabled &&
    Boolean(props.conceptoRetencionDse?.trim()) &&
    props.montoPositivo > 0;
  const { data, loading, error } = useDseRetencionPreview({
    montoPositivo: props.montoPositivo,
    concepto: props.conceptoRetencionDse,
    anio,
    enabled: innerEnabled,
  });

  if (!props.enabled) return null;

  if (!innerEnabled && !loading && !error) return null;

  return (
    <div className="mb-4">
      <RetencionEstimadaMotorCallout anio={anio} loading={loading} error={error} data={data} />
    </div>
  );
}
