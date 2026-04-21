import { useState, useEffect } from 'react';
import { dseRetencionApi, type DseRetencionPreviewOut } from '../api/dseRetencion';
import { extractApiErrorMessage } from '../utils/apiError';

export function useDseRetencionPreview(opts: {
  montoPositivo: number;
  concepto: string | null | undefined;
  anio: number;
  enabled: boolean;
}): {
  data: DseRetencionPreviewOut | null;
  loading: boolean;
  error: string | null;
} {
  const { montoPositivo, concepto, anio, enabled } = opts;
  const [data, setData] = useState<DseRetencionPreviewOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !concepto?.trim() || montoPositivo <= 0) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let cancelled = false;
    const timer = window.setTimeout(() => {
      dseRetencionApi
        .postPreview({
          monto: montoPositivo,
          concepto: concepto.trim(),
          anio,
        })
        .then((out) => {
          if (cancelled) return;
          setData(out);
          setLoading(false);
        })
        .catch((e) => {
          if (cancelled) return;
          setData(null);
          setError(extractApiErrorMessage(e, 'No se pudo calcular la retención.'));
          setLoading(false);
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, montoPositivo, concepto, anio]);

  return { data, loading, error };
}
