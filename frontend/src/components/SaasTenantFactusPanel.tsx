import { useEffect, useMemo, useState } from 'react';
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
  const [supportRangeId, setSupportRangeId] = useState<string>('');
  const [dsNotificarProveedor, setDsNotificarProveedor] = useState(true);
  const [dsCorreoCda, setDsCorreoCda] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null,
  );
  const [rangesPreview, setRangesPreview] = useState<FactusNumberingRangeItem[] | null>(null);
  /** Qué campo se está eligiendo con la tabla (evita mezclar factura 01 con documento soporte 24). */
  const [rangesPickerTarget, setRangesPickerTarget] = useState<'invoice' | 'support' | null>(null);

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
    setSupportRangeId(
      data.documento_soporte_numbering_range_id != null ? String(data.documento_soporte_numbering_range_id) : '',
    );
    setDsNotificarProveedor(data.documento_soporte_notificar_proveedor_factus !== false);
    setDsCorreoCda(data.documento_soporte_correo_notificacion_cda ?? '');
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
    mutationFn: async (target: 'invoice' | 'support') => {
      const rows = await saasFactusApi.listNumberingRanges(tenantId);
      return { rows, target };
    },
    onSuccess: ({ rows, target }) => {
      setRangesPickerTarget(target);
      setRangesPreview(rows);
      const docLabel = target === 'invoice' ? 'facturación (DIAN 01)' : 'documento soporte (DIAN 24)';
      setFeedback({
        type: 'info',
        message:
          rows.length === 0
            ? 'Factus no devolvió rangos activos. Verifica resoluciones en el panel Factus.'
            : `Lista para ${docLabel}: ${rows.length} rango(s). Pulse «Usar» en la fila correcta; solo se asignará a ese campo.`,
      });
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'No se pudieron consultar los rangos.';
      setFeedback({ type: 'error', message: typeof msg === 'string' ? msg : 'Error al consultar rangos.' });
    },
  });

  const { displayedRanges, showRangesFallbackToAll } = useMemo(() => {
    if (!rangesPreview || !rangesPickerTarget) {
      return { displayedRanges: [] as FactusNumberingRangeItem[], showRangesFallbackToAll: false };
    }
    const code = rangesPickerTarget === 'invoice' ? '01' : '24';
    const filtered = rangesPreview.filter((r) => String(r.document ?? '').trim() === code);
    if (filtered.length > 0) {
      return { displayedRanges: filtered, showRangesFallbackToAll: false };
    }
    return {
      displayedRanges: rangesPreview,
      showRangesFallbackToAll: rangesPreview.length > 0,
    };
  }, [rangesPreview, rangesPickerTarget]);

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
    const srid = supportRangeId.trim();
    const payload: FactusSettingsUpdatePayload = {
      modo,
      use_sandbox: useSandbox,
      api_username: sbApiUser.trim() || null,
      production_api_username: prApiUser.trim() || null,
      default_numbering_range_id: rid === '' ? null : parseInt(rid, 10),
      documento_soporte_numbering_range_id: srid === '' ? null : parseInt(srid, 10),
      documento_soporte_notificar_proveedor_factus: dsNotificarProveedor,
      documento_soporte_correo_notificacion_cda: dsCorreoCda.trim() || null,
    };
    if (Number.isNaN(payload.default_numbering_range_id as number)) {
      setFeedback({ type: 'error', message: 'ID de rango de facturación debe ser un número entero.' });
      return;
    }
    if (Number.isNaN(payload.documento_soporte_numbering_range_id as number)) {
      setFeedback({ type: 'error', message: 'ID de rango de documento soporte debe ser un número entero.' });
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
              Rango Factus — factura de venta (fallback, documento DIAN 01)
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
                  rangesMutation.mutate('invoice');
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
              un solo punto de venta. Mismo <strong>ambiente activo</strong> (pruebas o producción); documento{' '}
              <strong>01</strong> — «Factura de Venta». La tabla mostrará solo rangos 01 (si Factus los etiqueta así).
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Rango Factus — documento soporte en adquisiciones (documento DIAN 24)
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <input
                className="input w-full max-w-xs"
                value={supportRangeId}
                onChange={(e) => setSupportRangeId(e.target.value.replace(/\D/g, ''))}
                placeholder="Ej. rango distinto al de factura"
              />
              <button
                type="button"
                disabled={rangesMutation.isLoading || saveMutation.isLoading}
                onClick={() => {
                  setFeedback(null);
                  rangesMutation.mutate('support');
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
              Obligatorio para emitir <strong>documento soporte</strong> desde Reportes (egresos). Debe ser la
              resolución autorizada para el tipo <strong>24</strong> en Factus, no el mismo id que la factura 01. Si lo
              deja vacío, el sistema intentará elegir un rango activo con documento 24 (menos fiable). Use este botón:
              la tabla solo aplicará el id al campo de <strong>documento soporte</strong>.
            </p>
            <p className="text-xs text-amber-950 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2">
              <strong>Adquiriente en el PDF:</strong> el sistema envía <strong>establecimiento</strong> (razón social,
              dirección, municipio, contacto) desde el tenant/sede, como en factura. El <strong>NIT</strong> del
              adquiriente corresponde al <strong>contribuyente de la cuenta Factus</strong> (pruebas: suele ser{' '}
              <strong>FACTUS SAS</strong>). En producción, credenciales y NIT en Factus deben ser los del CDA.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-800">Notificaciones — documento soporte</p>
            <p className="text-xs text-slate-600">
              Igual que la factura de venta usa <code className="text-xs">send_email</code> hacia el cliente, el
              documento soporte puede pedir a Factus el envío al <strong>correo del proveedor</strong> registrado en
              cada egreso. Opcionalmente indique un correo del CDA para recibir copia vía CDASOFT al validar.
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={dsNotificarProveedor}
                onChange={(e) => setDsNotificarProveedor(e.target.checked)}
                className="rounded border-slate-300"
              />
              Solicitar a Factus enviar notificación al correo del proveedor al validar documento soporte
            </label>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Correo interno del CDA (copia opcional vía SMTP CDASOFT)
              </label>
              <input
                type="email"
                className="input w-full max-w-md"
                value={dsCorreoCda}
                onChange={(e) => setDsCorreoCda(e.target.value)}
                placeholder="contabilidad@su-cda.com"
                autoComplete="off"
              />
            </div>
          </div>

          {rangesPickerTarget && rangesPreview && rangesPreview.length > 0 && displayedRanges.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                {rangesPickerTarget === 'invoice'
                  ? 'Asignar rango a facturación electrónica (documento 01)'
                  : 'Asignar rango a documento soporte (documento 24)'}
              </p>
              {showRangesFallbackToAll ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  No se detectaron filas con código de documento {rangesPickerTarget === 'invoice' ? '01' : '24'} en
                  Factus; se muestran todos los rangos. Elija la fila que corresponda y confirme en la columna
                  «Documento».
                </p>
              ) : null}
              <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto max-h-56 overflow-y-auto text-xs">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-100 text-slate-600 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5">Id</th>
                      <th className="px-2 py-1.5">Documento</th>
                      <th className="px-2 py-1.5">Prefijo</th>
                      <th className="px-2 py-1.5">Resolución</th>
                      <th className="px-2 py-1.5">
                        {rangesPickerTarget === 'invoice' ? 'Usar para facturación' : 'Usar para doc. soporte'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRanges.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-mono font-semibold">{r.id}</td>
                        <td className="px-2 py-1.5">{r.document ?? '—'}</td>
                        <td className="px-2 py-1.5 font-mono">{r.prefix ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.resolution_number ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            className={
                              rangesPickerTarget === 'invoice'
                                ? 'text-indigo-600 font-semibold hover:underline'
                                : 'text-emerald-700 font-semibold hover:underline'
                            }
                            onClick={() => {
                              if (rangesPickerTarget === 'invoice') {
                                setRangeId(String(r.id));
                                setFeedback({
                                  type: 'info',
                                  message: `Rango ${r.id} asignado solo a facturación (01). Guarde la configuración.`,
                                });
                              } else {
                                setSupportRangeId(String(r.id));
                                setFeedback({
                                  type: 'info',
                                  message: `Rango ${r.id} asignado solo a documento soporte (24). Guarde la configuración.`,
                                });
                              }
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
            </div>
          )}

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
