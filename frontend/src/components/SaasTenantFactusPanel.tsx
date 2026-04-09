import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, ListOrdered, Loader2, Save, Wifi } from 'lucide-react';
import { saasFactusApi } from '../api/saasFactus';
import type { FactusNumberingRangeItem, FactusSettings, FactusSettingsUpdatePayload } from '../api/factus';
import FactusMultiSedeGuide from './FactusMultiSedeGuide';

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
  const [sbClientId, setSbClientId] = useState('');
  const [sbClientSecret, setSbClientSecret] = useState('');
  const [sbApiUser, setSbApiUser] = useState('');
  const [sbApiPass, setSbApiPass] = useState('');
  const [prClientId, setPrClientId] = useState('');
  const [prClientSecret, setPrClientSecret] = useState('');
  const [prApiUser, setPrApiUser] = useState('');
  const [prApiPass, setPrApiPass] = useState('');
  const [rangeId, setRangeId] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null,
  );
  const [rangesPreview, setRangesPreview] = useState<FactusNumberingRangeItem[] | null>(null);

  useEffect(() => {
    if (!data) return;
    setModo(data.modo);
    setUseSandbox(data.use_sandbox);
    setSbClientId('');
    setSbClientSecret('');
    setSbApiUser(data.sandbox.api_username ?? '');
    setSbApiPass('');
    setPrClientId('');
    setPrClientSecret('');
    setPrApiUser(data.production.api_username ?? '');
    setPrApiPass('');
    setRangeId(data.default_numbering_range_id != null ? String(data.default_numbering_range_id) : '');
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: FactusSettingsUpdatePayload) =>
      saasFactusApi.updateSettings(tenantId, payload),
    onSuccess: async (next: FactusSettings) => {
      await queryClient.invalidateQueries({ queryKey: ['saas-factus-settings', tenantId] });
      setSbClientSecret('');
      setSbApiPass('');
      setPrClientSecret('');
      setPrApiPass('');
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
      api_username: sbApiUser.trim() || null,
      production_api_username: prApiUser.trim() || null,
      default_numbering_range_id: rid === '' ? null : parseInt(rid, 10),
    };
    if (Number.isNaN(payload.default_numbering_range_id as number)) {
      setFeedback({ type: 'error', message: 'ID de rango de numeración debe ser un número entero.' });
      return;
    }
    const sbc = sbClientId.trim();
    if (sbc) payload.client_id = sbc;
    if (sbClientSecret.trim()) payload.client_secret = sbClientSecret.trim();
    if (sbApiPass.trim()) payload.api_password = sbApiPass.trim();

    const prc = prClientId.trim();
    if (prc) payload.production_client_id = prc;
    if (prClientSecret.trim()) payload.production_client_secret = prClientSecret.trim();
    if (prApiPass.trim()) payload.production_api_password = prApiPass.trim();

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

      <FactusMultiSedeGuide variant="saas_backoffice" />

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
            Emisión electrónica al confirmar el cobro. Complete credenciales de pruebas y de producción; elige cuál
            ambiente está activo para emitir y consultar.
          </p>
        </button>
      </div>

      {modo === 'factus' && (
        <div className="space-y-6 border border-slate-200 rounded-xl p-4 bg-slate-50/80">
          <div>
            <p className="text-sm font-semibold text-slate-800 mb-2">Ambiente activo (emisión, consulta de factura y rangos)</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setUseSandbox(true);
                  setFeedback(null);
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  useSandbox
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-200'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                Pruebas (sandbox)
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseSandbox(false);
                  setFeedback(null);
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  !useSandbox
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-200'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                Producción
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              URL en uso ahora: <code className="bg-white px-1 rounded">{data.base_url_effective}</code>
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <p className="font-bold text-slate-900">Credenciales — pruebas (sandbox)</p>
              <p className="text-xs text-slate-500 break-all">
                API: <code className="bg-slate-50 px-1 rounded">{data.sandbox.base_url}</code>
              </p>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Client ID</label>
                <input
                  className="input w-full font-mono text-sm"
                  value={sbClientId}
                  onChange={(e) => setSbClientId(e.target.value)}
                  placeholder={
                    data.sandbox.client_id_hint
                      ? `Configurado: ${data.sandbox.client_id_hint} (ingrese uno nuevo para cambiar)`
                      : 'Client ID sandbox'
                  }
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Client secret</label>
                <input
                  type="password"
                  className="input w-full font-mono text-sm"
                  value={sbClientSecret}
                  onChange={(e) => setSbClientSecret(e.target.value)}
                  placeholder={
                    data.sandbox.client_secret_configured ? 'Vacío = mantener el secret actual' : 'Client secret'
                  }
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Usuario API</label>
                <input
                  className="input w-full"
                  value={sbApiUser}
                  onChange={(e) => setSbApiUser(e.target.value)}
                  placeholder="Usuario API sandbox"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Contraseña API</label>
                <input
                  type="password"
                  className="input w-full"
                  value={sbApiPass}
                  onChange={(e) => setSbApiPass(e.target.value)}
                  placeholder={
                    data.sandbox.api_password_configured ? 'Vacío = mantener la contraseña actual' : 'Contraseña'
                  }
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <p className="font-bold text-slate-900">Credenciales — producción</p>
              <p className="text-xs text-slate-500 break-all">
                API: <code className="bg-slate-50 px-1 rounded">{data.production.base_url}</code>
              </p>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Client ID</label>
                <input
                  className="input w-full font-mono text-sm"
                  value={prClientId}
                  onChange={(e) => setPrClientId(e.target.value)}
                  placeholder={
                    data.production.client_id_hint
                      ? `Configurado: ${data.production.client_id_hint} (ingrese uno nuevo para cambiar)`
                      : 'Client ID producción'
                  }
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Client secret</label>
                <input
                  type="password"
                  className="input w-full font-mono text-sm"
                  value={prClientSecret}
                  onChange={(e) => setPrClientSecret(e.target.value)}
                  placeholder={
                    data.production.client_secret_configured ? 'Vacío = mantener el secret actual' : 'Client secret'
                  }
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Usuario API</label>
                <input
                  className="input w-full"
                  value={prApiUser}
                  onChange={(e) => setPrApiUser(e.target.value)}
                  placeholder="Usuario API producción"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Contraseña API</label>
                <input
                  type="password"
                  className="input w-full"
                  value={prApiPass}
                  onChange={(e) => setPrApiPass(e.target.value)}
                  placeholder={
                    data.production.api_password_configured ? 'Vacío = mantener la contraseña actual' : 'Contraseña'
                  }
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Rango Factus predeterminado del CDA (fallback)
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
                disabled={rangesMutation.isLoading || saveMutation.isLoading}
                onClick={() => {
                  setFeedback(null);
                  rangesMutation.mutate();
                }}
                className="btn-corporate-muted inline-flex items-center gap-2 shrink-0"
              >
                {rangesMutation.isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ListOrdered className="w-4 h-4" />
                )}
                Consultar rangos en Factus
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Se usa cuando una <strong>sede no tiene rango propio</strong> (Organización → editar sede). Cada ciudad /
              resolución DIAN suele tener su propio rango: configúrelo por sede y deje este valor como respaldo o para
              un solo punto de venta. Mismo <strong>ambiente activo</strong> (pruebas o producción); documento 01 —
              «Factura de Venta».
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
            disabled={testMutation.isLoading || saveMutation.isLoading}
            onClick={() => {
              setFeedback(null);
              testMutation.mutate();
            }}
            className="btn-corporate-muted inline-flex items-center gap-2"
          >
            {testMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            Probar conexión con Factus
          </button>
          <p className="text-xs text-slate-500">
            Usa las credenciales del <strong>ambiente activo</strong>. Guarde antes si acaba de pegar secretos nuevos.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={saveMutation.isLoading}
          onClick={handleGuardar}
          className="btn-corporate-primary inline-flex items-center gap-2"
        >
          {saveMutation.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          Guardar configuración
        </button>
      </div>
    </div>
  );
}
