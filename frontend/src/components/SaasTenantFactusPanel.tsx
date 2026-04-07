import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, ListOrdered, Loader2, Save, Wifi } from 'lucide-react';
import { saasFactusApi } from '../api/saasFactus';
import type { FactusNumberingRangeItem, FactusSettings, FactusSettingsUpdatePayload } from '../api/factus';

interface Props {
  tenantId: string;
}

export default function SaasTenantFactusPanel({ tenantId }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['saas-factus-settings', tenantId],
    queryFn: () => saasFactusApi.getSettings(tenantId),
  });

  const [modo, setModo] = useState<'manual' | 'factus'>('manual');
  const [useSandbox, setUseSandbox] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [apiUsername, setApiUsername] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [rangeId, setRangeId] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null,
  );
  const [rangesPreview, setRangesPreview] = useState<FactusNumberingRangeItem[] | null>(null);

  useEffect(() => {
    if (!data) return;
    setModo(data.modo);
    setUseSandbox(data.use_sandbox);
    setClientId('');
    setClientSecret('');
    setApiUsername(data.api_username ?? '');
    setApiPassword('');
    setRangeId(data.default_numbering_range_id != null ? String(data.default_numbering_range_id) : '');
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: FactusSettingsUpdatePayload) =>
      saasFactusApi.updateSettings(tenantId, payload),
    onSuccess: async (next: FactusSettings) => {
      await queryClient.invalidateQueries({ queryKey: ['saas-factus-settings', tenantId] });
      setClientSecret('');
      setApiPassword('');
      setFeedback({
        type: 'success',
        message:
          next.modo === 'factus'
            ? 'Configuración Factus guardada. En caja del CDA se emitirá la factura electrónica al cobrar.'
            : 'Modo manual guardado. En caja se pedirá el número de factura (DIAN) como antes.',
      });
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'No se pudo guardar.';
      setFeedback({ type: 'error', message: typeof msg === 'string' ? msg : 'Error al guardar.' });
    },
  });

  const rangesMutation = useMutation({
    mutationFn: () => saasFactusApi.listNumberingRanges(tenantId),
    onSuccess: (rows) => {
      setRangesPreview(rows);
      setFeedback({
        type: 'info',
        message:
          rows.length === 0
            ? 'Factus no devolvió rangos activos. Verifica resoluciones en el panel Factus.'
            : `Se encontraron ${rows.length} rango(s). Usa el id de «Factura de Venta» (factura electrónica, documento 01).`,
      });
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'No se pudieron consultar los rangos.';
      setFeedback({ type: 'error', message: typeof msg === 'string' ? msg : 'Error al consultar rangos.' });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => saasFactusApi.testConnection(tenantId),
    onSuccess: (r) => {
      setFeedback({
        type: 'info',
        message: `${r.message} (${r.environment === 'sandbox' ? 'Sandbox' : 'Producción'})`,
      });
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'No se pudo conectar con Factus.';
      setFeedback({ type: 'error', message: typeof msg === 'string' ? msg : 'Error de conexión.' });
    },
  });

  const handleGuardar = () => {
    setFeedback(null);
    const rid = rangeId.trim();
    const payload: FactusSettingsUpdatePayload = {
      modo,
      use_sandbox: useSandbox,
      api_username: apiUsername.trim() || null,
      default_numbering_range_id: rid === '' ? null : parseInt(rid, 10),
    };
    if (Number.isNaN(payload.default_numbering_range_id as number)) {
      setFeedback({ type: 'error', message: 'ID de rango de numeración debe ser un número entero.' });
      return;
    }
    const cid = clientId.trim();
    if (cid) {
      payload.client_id = cid;
    }
    if (clientSecret.trim()) {
      payload.client_secret = clientSecret.trim();
    }
    if (apiPassword.trim()) {
      payload.api_password = apiPassword.trim();
    }
    saveMutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-600">
        <Loader2 className="w-6 h-6 animate-spin" />
        Cargando configuración…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="border border-red-200 bg-red-50 text-red-900 rounded-xl p-6 text-sm">
        No se pudo cargar la configuración de facturación.{' '}
        {(error as Error)?.message ? String((error as Error).message) : 'Intenta de nuevo más tarde.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Landmark className="w-8 h-8 text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-lg font-bold text-slate-900">Facturación electrónica (DIAN / Factus)</h3>
          <p className="text-slate-600 text-sm mt-1">
            Configure si este CDA usa la integración con <strong>Factus</strong> o si la factura la gestionan con otro
            sistema y solo registran el número en caja.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : feedback.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-sky-50 border-sky-200 text-sky-900'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setModo('manual');
            setFeedback(null);
          }}
          className={`text-left rounded-xl border p-4 transition ${
            modo === 'manual'
              ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <p className="font-bold text-slate-900">Sin Factus (manual)</p>
          <p className="text-sm text-slate-600 mt-2">
            Otro proveedor o factura en papel. En <strong>Caja</strong> el cajero ingresa el número de factura DIAN
            antes de cobrar.
          </p>
        </button>
        <button
          type="button"
          onClick={() => {
            setModo('factus');
            setFeedback(null);
          }}
          className={`text-left rounded-xl border p-4 transition ${
            modo === 'factus'
              ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <p className="font-bold text-slate-900">Integración Factus</p>
          <p className="text-sm text-slate-600 mt-2">
            Emisión electrónica al confirmar el cobro. Complete credenciales y rango de numeración de la cuenta Factus
            del CDA.
          </p>
        </button>
      </div>

      {modo === 'factus' && (
        <div className="space-y-4 border border-slate-200 rounded-xl p-4 bg-slate-50/80">
          <p className="text-xs text-slate-500">
            API base: <code className="bg-white px-1 rounded">{data.base_url_effective}</code>
          </p>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useSandbox}
              onChange={(e) => setUseSandbox(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-sm font-medium text-slate-800">Usar ambiente sandbox (pruebas)</span>
          </label>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Client ID (Factus OAuth)</label>
            <input
              className="input w-full font-mono text-sm"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={data.client_id_hint ? `Configurado: …${data.client_id_hint} (ingrese uno nuevo para cambiar)` : 'Client ID'}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Client secret</label>
            <input
              type="password"
              className="input w-full font-mono text-sm"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={data.client_secret_configured ? 'Dejar vacío para mantener el secret actual' : 'Client secret'}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Usuario API Factus</label>
            <input
              className="input w-full"
              value={apiUsername}
              onChange={(e) => setApiUsername(e.target.value)}
              placeholder="Usuario de la API"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Contraseña API</label>
            <input
              type="password"
              className="input w-full"
              value={apiPassword}
              onChange={(e) => setApiPassword(e.target.value)}
              placeholder={data.api_password_configured ? 'Dejar vacío para mantener la contraseña actual' : 'Contraseña'}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              ID rango de numeración (Factus)
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <input
                className="input w-full max-w-xs"
                value={rangeId}
                onChange={(e) => setRangeId(e.target.value.replace(/\D/g, ''))}
                placeholder="Ej. 4"
              />
              <button
                type="button"
                disabled={rangesMutation.isPending || saveMutation.isPending}
                onClick={() => {
                  setFeedback(null);
                  rangesMutation.mutate();
                }}
                className="btn-corporate-muted inline-flex items-center gap-2 shrink-0"
              >
                {rangesMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ListOrdered className="w-4 h-4" />
                )}
                Consultar rangos en Factus
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Debe ser el <strong>id numérico</strong> de un rango activo de tu cuenta en el mismo ambiente (sandbox vs
              producción). Para la factura electrónica de venta elige el rango tipo «Factura de Venta» (no un ejemplo de
              otro entorno).
            </p>
            {rangesPreview && rangesPreview.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white overflow-x-auto max-h-56 overflow-y-auto text-xs">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-100 text-slate-600 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5">Id</th>
                      <th className="px-2 py-1.5">Documento</th>
                      <th className="px-2 py-1.5">Prefijo</th>
                      <th className="px-2 py-1.5">Resolución</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {rangesPreview.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-mono font-semibold">{r.id}</td>
                        <td className="px-2 py-1.5">{r.document ?? '—'}</td>
                        <td className="px-2 py-1.5 font-mono">{r.prefix ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.resolution_number ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            className="text-indigo-600 font-semibold hover:underline"
                            onClick={() => {
                              setRangeId(String(r.id));
                              setFeedback({
                                type: 'info',
                                message: `ID ${r.id} copiado al campo. Guarda la configuración para aplicar.`,
                              });
                            }}
                          >
                            Usar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={testMutation.isPending || saveMutation.isPending}
            onClick={() => {
              setFeedback(null);
              testMutation.mutate();
            }}
            className="btn-corporate-muted inline-flex items-center gap-2"
          >
            {testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            Probar conexión con Factus
          </button>
          <p className="text-xs text-slate-500">
            Requiere modo Factus, credenciales guardadas y rango configurado. Primero guarde los cambios si acaba de
            pegar secretos nuevos.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={handleGuardar}
          className="btn-corporate-primary inline-flex items-center gap-2"
        >
          {saveMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          Guardar configuración
        </button>
      </div>
    </div>
  );
}
