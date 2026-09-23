import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Copy, Loader2, MessageCircle } from 'lucide-react';
import {
  whatsappApi,
  type WhatsAppEventoPrueba,
  type WhatsAppPackItem,
  type WhatsAppProveedor,
  type WhatsAppSettingsUpdatePayload,
} from '../api/whatsapp';
import { useToast } from '../contexts/ToastContext';

const GRUPO_LABEL: Record<string, string> = {
  visita: 'Durante la visita',
  citas: 'Citas',
  vencimientos: 'Vencimientos',
  calidad: 'Después de la visita',
};

const GRUPO_ORDEN = ['visita', 'citas', 'vencimientos', 'calidad'];

const AVISO_OPTIONS: { value: WhatsAppEventoPrueba; label: string }[] = [
  { value: 'bienvenida', label: 'Recepción' },
  { value: 'caja', label: 'Pase a caja' },
  { value: 'recibo', label: 'Recibo / factura' },
  { value: 'aprobado', label: 'Aprobación' },
  { value: 'reinspeccion', label: 'Reinspección' },
  { value: 'cita', label: 'Cita confirmada' },
  { value: 'cita_recordatorio', label: 'Recordatorio cita' },
  { value: 'rtm', label: 'RTM anual' },
  { value: 'preventiva', label: 'Preventiva' },
  { value: 'calidad', label: 'Encuesta calidad' },
];

function fieldClass() {
  return 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
}

function mensajeErrorWhatsApp(raw: string | null | undefined): string {
  const texto = (raw || '').trim();
  if (!texto) return '';
  const low = texto.toLowerCase();
  if (low.includes('132001') || low.includes('does not exist')) {
    return 'Meta no encontró esa plantilla. Créela en 360dialog (Utility, español) y espere a que quede Approved.';
  }
  if (low.includes('paused') || low.includes('disabled')) {
    return 'La plantilla está pausada o deshabilitada en Meta. Revísela en 360dialog.';
  }
  try {
    const parsed = JSON.parse(texto) as { error?: { message?: string; error_data?: { details?: string } } };
    const details = parsed.error?.error_data?.details || parsed.error?.message;
    if (details) return String(details);
  } catch {
    /* texto plano */
  }
  return texto.length > 280 ? `${texto.slice(0, 277)}…` : texto;
}

function textoParaCopiar(item: WhatsAppPackItem): string {
  const categoria = item.grupo === 'calidad' ? 'Marketing (Meta suele dejarla así)' : 'Utility';
  return [
    `Nombre: ${item.nombre}`,
    `Categoría: ${categoria}`,
    'Idioma: es (Spanish)',
    `Variables: ${item.variables}`,
    '',
    item.cuerpo,
  ].join('\n');
}

export default function OrganizacionWhatsApp() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-settings'],
    queryFn: whatsappApi.getSettings,
  });
  const { data: pack } = useQuery({
    queryKey: ['whatsapp-pack'],
    queryFn: whatsappApi.getPack,
  });

  const [proveedor, setProveedor] = useState<WhatsAppProveedor>('dialog360');
  const [habilitado, setHabilitado] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [dialogKey, setDialogKey] = useState('');
  const [displayPhone, setDisplayPhone] = useState('');
  const [avisosCalidad, setAvisosCalidad] = useState(false);
  const [asistenteHabilitado, setAsistenteHabilitado] = useState(false);
  const [plantillaCalidad, setPlantillaCalidad] = useState('encuesta_calidad');
  const [plantillaLang, setPlantillaLang] = useState('es');
  const [avisosOperativos, setAvisosOperativos] = useState(true);
  const [avisosCitas, setAvisosCitas] = useState(true);
  const [avisosVencimientos, setAvisosVencimientos] = useState(true);
  const [plantillaBienvenida, setPlantillaBienvenida] = useState('cdasoft_bienvenida');
  const [plantillaCaja, setPlantillaCaja] = useState('cdasoft_pase_caja');
  const [plantillaRecibo, setPlantillaRecibo] = useState('cdasoft_recibo');
  const [plantillaCita, setPlantillaCita] = useState('cdasoft_cita_ok');
  const [plantillaCitaRec, setPlantillaCitaRec] = useState('cdasoft_cita_recordatorio');
  const [plantillaRtm, setPlantillaRtm] = useState('cdasoft_rtm');
  const [plantillaPreventiva, setPlantillaPreventiva] = useState('cdasoft_preventiva');
  const [plantillaReinspeccion, setPlantillaReinspeccion] = useState('cdasoft_reinspeccion');
  const [plantillaAprobacion, setPlantillaAprobacion] = useState('cdasoft_aprobado');
  const [celularPrueba, setCelularPrueba] = useState('');
  const [eventoPrueba, setEventoPrueba] = useState<WhatsAppEventoPrueba>('bienvenida');
  const [openPack, setOpenPack] = useState(true);
  const [openNombres, setOpenNombres] = useState(false);
  const [packAbierta, setPackAbierta] = useState<string | null>(null);
  const [copiada, setCopiada] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setProveedor(data.proveedor);
    setHabilitado(data.habilitado);
    setPhoneNumberId(data.phone_number_id || '');
    setWabaId(data.waba_id || '');
    setDisplayPhone(data.display_phone_e164 || '');
    setAvisosCalidad(data.avisos_calidad);
    setAsistenteHabilitado(Boolean(data.asistente_habilitado));
    setPlantillaCalidad(data.plantilla_calidad || 'encuesta_calidad');
    setPlantillaLang(data.plantilla_calidad_lang || 'es');
    setAvisosOperativos(data.avisos_operativos !== false);
    setAvisosCitas(data.avisos_citas !== false);
    setAvisosVencimientos(data.avisos_vencimientos !== false);
    setPlantillaBienvenida(data.plantilla_bienvenida || 'cdasoft_bienvenida');
    setPlantillaCaja(data.plantilla_caja || 'cdasoft_pase_caja');
    setPlantillaRecibo(data.plantilla_recibo || 'cdasoft_recibo');
    setPlantillaCita(data.plantilla_cita || 'cdasoft_cita_ok');
    setPlantillaCitaRec(data.plantilla_cita_recordatorio || 'cdasoft_cita_recordatorio');
    setPlantillaRtm(data.plantilla_rtm || 'cdasoft_rtm');
    setPlantillaPreventiva(data.plantilla_preventiva || 'cdasoft_preventiva');
    setPlantillaReinspeccion(data.plantilla_reinspeccion || 'cdasoft_reinspeccion');
    setPlantillaAprobacion(data.plantilla_aprobacion || 'cdasoft_aprobado');
    setAccessToken('');
    setDialogKey('');
  }, [data]);

  const packAgrupado = useMemo(() => {
    const grupos = new Map<string, WhatsAppPackItem[]>();
    for (const item of pack || []) {
      const lista = grupos.get(item.grupo) || [];
      lista.push(item);
      grupos.set(item.grupo, lista);
    }
    return GRUPO_ORDEN.filter((g) => grupos.has(g)).map((g) => ({
      grupo: g,
      items: grupos.get(g) || [],
    }));
  }, [pack]);

  const saveMutation = useMutation({
    mutationFn: (payload: WhatsAppSettingsUpdatePayload) => whatsappApi.putSettings(payload),
    onSuccess: (saved) => {
      queryClient.setQueryData(['whatsapp-settings'], saved);
      showToast('success', 'WhatsApp', 'Configuración guardada. El token no se vuelve a mostrar.');
    },
    onError: (err: unknown) => {
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      showToast('error', 'WhatsApp', typeof detail === 'string' ? detail : 'No se pudo guardar.');
    },
  });

  const sendMutation = useMutation({
    mutationFn: ({ celular, evento }: { celular: string; evento: WhatsAppEventoPrueba }) =>
      whatsappApi.testSend(celular, evento),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-settings'] });
      if (result.ok) {
        showToast('success', 'WhatsApp enviado', result.message);
      } else {
        showToast('error', 'WhatsApp no salió', mensajeErrorWhatsApp(result.message) || result.message);
      }
    },
    onError: () => {
      showToast('error', 'WhatsApp', 'No se pudo enviar la prueba.');
    },
  });

  const testMutation = useMutation({
    mutationFn: whatsappApi.testConnection,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-settings'] });
      if (result.ok) {
        const extra = [result.verified_name, result.display_phone, result.quality_rating]
          .filter(Boolean)
          .join(' · ');
        showToast('success', 'Conexión WhatsApp', extra ? `${result.message} ${extra}` : result.message);
      } else {
        showToast('error', 'Conexión WhatsApp', mensajeErrorWhatsApp(result.message) || result.message);
      }
    },
    onError: () => {
      showToast('error', 'Conexión WhatsApp', 'No se pudo probar. Revise credenciales.');
    },
  });

  const onSave = () => {
    saveMutation.mutate({
      proveedor,
      habilitado,
      phone_number_id: phoneNumberId.trim() || null,
      waba_id: wabaId.trim() || null,
      access_token: accessToken.trim() || undefined,
      dialog360_api_key: dialogKey.trim() || undefined,
      display_phone_e164: displayPhone.trim() || null,
      avisos_calidad: avisosCalidad,
      plantilla_calidad: plantillaCalidad.trim() || null,
      plantilla_calidad_lang: plantillaLang.trim() || 'es',
      avisos_operativos: avisosOperativos,
      plantilla_bienvenida: plantillaBienvenida.trim() || null,
      plantilla_caja: plantillaCaja.trim() || null,
      plantilla_recibo: plantillaRecibo.trim() || null,
      avisos_citas: avisosCitas,
      plantilla_cita: plantillaCita.trim() || null,
      plantilla_cita_recordatorio: plantillaCitaRec.trim() || null,
      avisos_vencimientos: avisosVencimientos,
      plantilla_rtm: plantillaRtm.trim() || null,
      plantilla_preventiva: plantillaPreventiva.trim() || null,
      plantilla_reinspeccion: plantillaReinspeccion.trim() || null,
      plantilla_aprobacion: plantillaAprobacion.trim() || null,
      asistente_habilitado: asistenteHabilitado,
    });
  };

  const copiar = async (item: WhatsAppPackItem) => {
    try {
      await navigator.clipboard.writeText(textoParaCopiar(item));
      setCopiada(item.nombre);
      window.setTimeout(() => setCopiada((actual) => (actual === item.nombre ? null : actual)), 1600);
    } catch {
      showToast('error', 'WhatsApp', 'No se pudo copiar. Seleccione el texto a mano.');
    }
  };

  if (isLoading) {
    return (
      <div className="card-pos p-6 text-slate-500 text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Cargando WhatsApp…
      </div>
    );
  }

  const errorHumano = mensajeErrorWhatsApp(data?.last_error);

  return (
    <div className="card-pos space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary-600" />
            WhatsApp Business del CDA
          </h3>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Un solo número para <strong>todas las sedes</strong> (1 NIT = 1 WhatsApp). La visita sale con el
            nombre del CDA. En citas, si hay más de una sede, el mensaje incluye CDA y sede. Si no hay
            celular, no se envía WhatsApp; el correo sigue igual.
          </p>
        </div>
        {data?.listo_para_enviar ? (
          <span className="shrink-0 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold px-2.5 py-1">
            Canal listo
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-amber-50 text-amber-800 text-xs font-semibold px-2.5 py-1">
            Falta conectar
          </span>
        )}
      </div>

      {errorHumano && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{errorHumano}</p>
      )}

      <section className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">1. Conectar el número</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Pegue la API key de 360dialog del CDA. Luego marque el canal y guarde.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Proveedor</span>
            <select
              className={fieldClass()}
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value as WhatsAppProveedor)}
            >
              <option value="dialog360">360dialog (recomendado)</option>
              <option value="cloud_api">Meta Cloud API</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Número del CDA</span>
            <input
              className={fieldClass()}
              value={displayPhone}
              onChange={(e) => setDisplayPhone(e.target.value)}
              placeholder="312 612 7992"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 sm:pt-7">
            <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} />
            Canal habilitado
          </label>
        </div>

        {proveedor === 'cloud_api' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Phone number ID</span>
              <input
                className={fieldClass()}
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">WABA ID (opcional)</span>
              <input className={fieldClass()} value={wabaId} onChange={(e) => setWabaId(e.target.value)} autoComplete="off" />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-semibold text-slate-700">
                Access token {data?.access_token_configured ? `(guardado ${data.access_token_hint || ''})` : ''}
              </span>
              <input
                type="password"
                className={fieldClass()}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={data?.access_token_configured ? 'Dejar vacío para no cambiar' : 'Pegar token permanente'}
                autoComplete="new-password"
              />
            </label>
          </div>
        ) : (
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">
              API key de 360dialog {data?.dialog360_api_key_configured ? `(guardada ${data.dialog360_api_key_hint || ''})` : ''}
            </span>
            <input
              type="password"
              className={fieldClass()}
              value={dialogKey}
              onChange={(e) => setDialogKey(e.target.value)}
              placeholder={data?.dialog360_api_key_configured ? 'Dejar vacío para no cambiar' : 'Pegar D360-API-KEY'}
              autoComplete="new-password"
            />
          </label>
        )}
      </section>

      <section className="border-t border-slate-100 pt-4">
        <p className="text-sm font-semibold text-slate-800 mb-1">2. Qué avisos enviar</p>
        <p className="text-xs text-slate-500 mb-3">Se puede apagar un grupo sin desconectar el canal. Recuerde guardar.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-start gap-2 text-sm text-slate-800 rounded-lg border border-slate-100 px-3 py-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={avisosOperativos}
              onChange={(e) => setAvisosOperativos(e.target.checked)}
            />
            <span>
              <span className="font-semibold">Visita</span>
              <span className="block text-xs text-slate-500">
                Recepción, pase a caja, pago (recibo o factura), aprobación y reinspección
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-800 rounded-lg border border-slate-100 px-3 py-2">
            <input className="mt-0.5" type="checkbox" checked={avisosCitas} onChange={(e) => setAvisosCitas(e.target.checked)} />
            <span>
              <span className="font-semibold">Citas</span>
              <span className="block text-xs text-slate-500">Confirmación al agendar y recordatorio</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-800 rounded-lg border border-slate-100 px-3 py-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={avisosVencimientos}
              onChange={(e) => setAvisosVencimientos(e.target.checked)}
            />
            <span>
              <span className="font-semibold">Vencimientos</span>
              <span className="block text-xs text-slate-500">RTM anual y preventiva van por separado, nunca mezcladas</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-800 rounded-lg border border-slate-100 px-3 py-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={avisosCalidad}
              onChange={(e) => setAvisosCalidad(e.target.checked)}
            />
            <span>
              <span className="font-semibold">Encuesta de calidad</span>
              <span className="block text-xs text-slate-500">Tres horas después del cobro. Meta la trata como Marketing</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-800 rounded-lg border border-slate-100 px-3 py-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={asistenteHabilitado}
              onChange={(e) => setAsistenteHabilitado(e.target.checked)}
            />
            <span>
              <span className="font-semibold">Asistente de entrada</span>
              <span className="block text-xs text-slate-500">
                Si el cliente escribe (precio, documentos, agendar, medios de pago), responde CDASoft con datos
                reales. Apagado por defecto. No es un bot de menú.
              </span>
            </span>
          </label>
        </div>
        {asistenteHabilitado && data?.webhook_url ? (
          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-700">Webhook para 360dialog</p>
            <p className="text-xs text-slate-500 mt-0.5">
              En 360dialog, URL de webhook de este CDA. Sin esto el asistente no recibe el mensaje.
            </p>
            <p className="mt-1 text-xs font-mono break-all text-slate-800">{data.webhook_url}</p>
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-primary-700 hover:underline"
              onClick={() => navigator.clipboard.writeText(data.webhook_url || '')}
            >
              Copiar URL
            </button>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-pos btn-primary" onClick={onSave} disabled={saveMutation.isLoading}>
          {saveMutation.isLoading ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          className="btn-pos btn-secondary"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isLoading}
        >
          {testMutation.isLoading ? 'Probando…' : 'Probar conexión'}
        </button>
      </div>

      <details
        className="border border-slate-200 rounded-xl overflow-hidden"
        open={openPack}
        onToggle={(e) => setOpenPack((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          <span>3. Crear plantillas en 360dialog</span>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition ${openPack ? 'rotate-180' : ''}`} />
        </summary>
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 pt-3">
            En cada plantilla use exactamente este nombre, categoría Utility (salvo la encuesta), idioma{' '}
            <strong>es</strong>, sin botones. Copie, cree, espere Approved. El PDF del recibo sigue por correo. Si el
            CDA no tiene Factus, no necesita la plantilla <span className="font-mono">cdasoft_recibo_fe</span>.
          </p>
          {packAgrupado.map((grupo) => (
            <div key={grupo.grupo} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {GRUPO_LABEL[grupo.grupo] || grupo.grupo}
              </p>
              {grupo.items.map((item) => {
                const abierta = packAbierta === item.nombre;
                return (
                  <div key={item.nombre} className="rounded-lg border border-slate-100">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        className="flex-1 text-left min-w-0"
                        onClick={() => setPackAbierta(abierta ? null : item.nombre)}
                      >
                        <span className="font-mono text-xs font-semibold text-slate-800">{item.nombre}</span>
                        <span className="ml-2 text-xs text-slate-500">{item.variables} var.</span>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-slate-100"
                        onClick={() => void copiar(item)}
                      >
                        {copiada === item.nombre ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiada === item.nombre ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                    {abierta && (
                      <pre className="px-3 pb-3 text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">
                        {item.cuerpo}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </details>

      <section className="border-t border-slate-100 pt-4">
        <p className="text-sm font-semibold text-slate-800">4. Enviar una prueba</p>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">
          Use un celular suyo, no el del canal. Recibo / factura prueba el mensaje con enlace; si esa plantilla no
          existe, se envía el recibo simple.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Aviso</span>
            <select
              className={`${fieldClass()} w-52`}
              value={eventoPrueba}
              onChange={(e) => setEventoPrueba(e.target.value as WhatsAppEventoPrueba)}
            >
              {AVISO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Celular</span>
            <input
              className={`${fieldClass()} w-44`}
              value={celularPrueba}
              onChange={(e) => setCelularPrueba(e.target.value)}
              placeholder="3235492939"
            />
          </label>
          <button
            type="button"
            className="btn-pos btn-secondary"
            onClick={() => sendMutation.mutate({ celular: celularPrueba.trim(), evento: eventoPrueba })}
            disabled={sendMutation.isLoading || !celularPrueba.trim()}
          >
            {sendMutation.isLoading ? 'Enviando…' : 'Enviar prueba'}
          </button>
        </div>
      </section>

      <details
        className="border border-slate-200 rounded-xl overflow-hidden"
        open={openNombres}
        onToggle={(e) => setOpenNombres((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          <span>Avanzado: si el nombre en Meta no es el de CDASoft</span>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition ${openNombres ? 'rotate-180' : ''}`} />
        </summary>
        <div className="px-4 pb-4 border-t border-slate-100">
          <p className="text-xs text-slate-500 pt-3 mb-3">
            Déjelo como está si copió los nombres de arriba. Solo cámbielo si en 360dialog la plantilla se llama
            distinto.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Recepción</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaBienvenida} onChange={(e) => setPlantillaBienvenida(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Pase a caja</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaCaja} onChange={(e) => setPlantillaCaja(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Recibo</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaRecibo} onChange={(e) => setPlantillaRecibo(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Reinspección</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaReinspeccion} onChange={(e) => setPlantillaReinspeccion(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Aprobación</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaAprobacion} onChange={(e) => setPlantillaAprobacion(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Cita</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaCita} onChange={(e) => setPlantillaCita(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Recordatorio cita</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaCitaRec} onChange={(e) => setPlantillaCitaRec(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">RTM anual</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaRtm} onChange={(e) => setPlantillaRtm(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Preventiva</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaPreventiva} onChange={(e) => setPlantillaPreventiva(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Encuesta calidad</span>
              <input className={`${fieldClass()} font-mono text-xs`} value={plantillaCalidad} onChange={(e) => setPlantillaCalidad(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Idioma</span>
              <input className={fieldClass()} value={plantillaLang} onChange={(e) => setPlantillaLang(e.target.value)} />
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}
