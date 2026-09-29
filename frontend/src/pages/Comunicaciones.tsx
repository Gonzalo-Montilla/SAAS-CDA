import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Megaphone,
  RefreshCw,
  Sparkles,
  Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Layout from '../components/Layout';
import { campanasApi, type CampanaExcelFila, type CampanaFiltros, type CampanaTipo } from '../api/campanas';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { downloadXlsx } from '../utils/downloadXlsx';
import type { Usuario } from '../types';

const TIPOS: { value: CampanaTipo; label: string; help: string; nombre: string }[] = [
  {
    value: 'por_vencer',
    label: 'RTM por vencer',
    help: 'Toda la base de vencimientos (moto, liviano y pesado) con revisión en el rango de días y autorización de recordatorio. No vuelve a avisar si ya se les escribió esta semana.',
    nombre: 'Campaña RTM por vencer',
  },
  {
    value: 'inactivos',
    label: 'Inactivos',
    help: 'Clientes de toda la base (moto, liviano y pesado) que hace meses no vienen y autorizaron contacto comercial.',
    nombre: 'Campaña inactivos',
  },
  {
    value: 'excel',
    label: 'Lista Excel',
    help: 'Jornada, temporada o lista propia. Cada fila necesita autorización (si) y al menos celular o correo.',
    nombre: 'Campaña lista Excel',
  },
];

function apiDetail(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const d = error.response?.data?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d.length > 0) {
      const first = d[0] as { msg?: string; loc?: unknown[] };
      if (typeof first?.msg === 'string') {
        const loc = Array.isArray(first.loc)
          ? first.loc.filter((x) => x !== 'body' && typeof x !== 'number').join(' ')
          : '';
        return loc ? `${loc}: ${first.msg}` : first.msg;
      }
    }
  }
  return fallback;
}

function normHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/á/g, 'a')
    .replace(/é/g, 'e')
    .replace(/í/g, 'i')
    .replace(/ó/g, 'o')
    .replace(/ú/g, 'u')
    .replace(/ /g, '_');
}

function parseExcelFile(file: File): Promise<CampanaExcelFila[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        const filas: CampanaExcelFila[] = rows.map((row) => {
          const lower: Record<string, string> = {};
          for (const [k, v] of Object.entries(row)) {
            lower[normHeader(k)] = String(v ?? '').trim();
          }
          return {
            nombre: lower.nombre || lower.cliente || lower.cliente_nombre || lower.name || '',
            celular: String(lower.celular || lower.telefono || lower.whatsapp || lower.movil || '')
              .replace(/\s+/g, '')
              .replace(/\.0$/, ''),
            correo: lower.correo || lower.email || lower.mail || '',
            autorizo_habeas: lower.autorizo_habeas || lower.habeas || lower.autorizo || lower.autorizacion || '',
          };
        });
        resolve(filas.filter((f) => f.nombre && (f.celular || f.correo)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function esMovilCo(valor: string | null | undefined): boolean {
  return /^57\d{10,}$/.test((valor || '').trim());
}

function vacioLista(tipo: CampanaTipo): string {
  if (tipo === 'inactivos') {
    return 'Nadie cumple meses sin visita, habeas comercial y un celular o correo válido. Pruebe bajar los meses.';
  }
  if (tipo === 'excel' || tipo === 'temporada') {
    return 'Nadie de esa lista tiene habeas (si) y un celular colombiano o un correo válido.';
  }
  return 'En ese rango nadie tiene habeas de recordatorio y un celular o correo válido. Pruebe ampliar los días (por ejemplo 5 a 30).';
}

function estadoChip(estado: string): string {
  const v = (estado || '').toLowerCase();
  if (v === 'enviada') return 'badge badge-success';
  if (v === 'ok') return 'badge badge-success';
  if (v === 'enviando') return 'badge badge-info';
  if (v === 'fallida' || v === 'fail') return 'badge badge-danger';
  return 'badge bg-slate-100 text-slate-700';
}

function estadoLabel(estado: string): string {
  const v = (estado || '').toLowerCase();
  if (v === 'borrador') return 'Borrador';
  if (v === 'enviando') return 'Enviando';
  if (v === 'enviada') return 'Enviada';
  if (v === 'fallida') return 'Falló';
  if (v === 'pendiente') return 'Pendiente';
  if (v === 'ok') return 'Ok';
  if (v === 'fail') return 'Falló';
  if (v === 'omitido') return 'Omitido';
  if (v === 'no_aplica') return '—';
  return estado || '—';
}

function canalChip(estado: string | null | undefined): string {
  const v = (estado || '').toLowerCase();
  if (v === 'ok') return 'badge badge-success';
  if (v === 'fail') return 'badge badge-danger';
  if (v === 'omitido') return 'badge bg-amber-50 text-amber-800';
  return 'badge bg-slate-100 text-slate-700';
}

function exportarDestinatarios(nombre: string, dests: { cliente_nombre: string; placa?: string | null; destino_e164: string; cliente_email?: string | null; estado_whatsapp?: string | null; estado_correo?: string | null; error_whatsapp?: string | null; error_correo?: string | null; error?: string | null; motivo?: string }[]) {
  const seguro = (nombre || 'campana').replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/gi, '-').slice(0, 40);
  downloadXlsx(
    `campana-${seguro || 'lista'}.xlsx`,
    ['nombre', 'placa', 'celular', 'correo', 'whatsapp', 'correo_envio', 'motivo', 'detalle'],
    dests.map((d) => [
      d.cliente_nombre,
      d.placa || '',
      esMovilCo(d.destino_e164) ? d.destino_e164 : '',
      d.cliente_email || '',
      estadoLabel(d.estado_whatsapp || ''),
      estadoLabel(d.estado_correo || ''),
      d.motivo || '',
      [d.error_whatsapp, d.error_correo, d.error].filter(Boolean).join(' · '),
    ]),
  );
}

function tipoLabel(tipo: string): string {
  if (tipo === 'por_vencer') return 'RTM por vencer';
  if (tipo === 'inactivos') return 'Inactivos';
  if (tipo === 'temporada') return 'Temporada';
  if (tipo === 'excel') return 'Lista Excel';
  return tipo;
}

const PAGE_ENVIOS = 5;
const PAGE_DEST = 10;

function Paginador({
  pagina,
  totalPaginas,
  total,
  pageSize,
  onChange,
}: {
  pagina: number;
  totalPaginas: number;
  total: number;
  pageSize: number;
  onChange: (n: number) => void;
}) {
  if (total <= pageSize) return null;
  return (
    <div className="mt-3 flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, pagina - 1))}
        disabled={pagina <= 1}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Anterior
      </button>
      <span className="text-sm text-slate-600">
        Página {pagina} de {totalPaginas} · {total}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPaginas, pagina + 1))}
        disabled={pagina >= totalPaginas}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Siguiente
      </button>
    </div>
  );
}

export default function Comunicaciones() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const tenantUser: Usuario | null = user && 'tenant_id' in user ? (user as Usuario) : null;
  const sedes = tenantUser?.sucursales || [];

  const [tipo, setTipo] = useState<CampanaTipo>('por_vencer');
  const [nombre, setNombre] = useState('Campaña RTM por vencer');
  const [etiqueta, setEtiqueta] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [diasDesde, setDiasDesde] = useState(10);
  const [diasHasta, setDiasHasta] = useState(20);
  const [mesesInactivo, setMesesInactivo] = useState(11);
  const [filasExcel, setFilasExcel] = useState<CampanaExcelFila[]>([]);
  const [excelNombre, setExcelNombre] = useState('');
  const [campanaId, setCampanaId] = useState<string | null>(null);
  const [paginaEnvios, setPaginaEnvios] = useState(1);
  const [paginaDest, setPaginaDest] = useState(1);
  const [asuntoCorreo, setAsuntoCorreo] = useState('');
  const [cuerpoCorreo, setCuerpoCorreo] = useState('');
  const [notasCorreo, setNotasCorreo] = useState('');
  const [htmlCorreo, setHtmlCorreo] = useState('');
  const [correoEditado, setCorreoEditado] = useState(false);
  const [listaGuardada, setListaGuardada] = useState(false);

  const usaExcel = tipo === 'excel' || tipo === 'temporada';
  const tipoMeta = TIPOS.find((t) => t.value === tipo) || TIPOS[0];

  const filtros = useMemo<CampanaFiltros>(
    () => ({
      tipo,
      sucursal_id: sucursalId || null,
      tipo_vehiculo: null,
      dias_desde: diasDesde,
      dias_hasta: diasHasta,
      meses_inactivo: mesesInactivo,
      etiqueta: etiqueta || null,
      filas_excel: usaExcel ? filasExcel : undefined,
    }),
    [tipo, sucursalId, diasDesde, diasHasta, mesesInactivo, etiqueta, filasExcel, usaExcel],
  );

  const listQuery = useQuery({
    queryKey: ['campanas'],
    queryFn: campanasApi.list,
    refetchInterval: 8000,
  });

  const previewMutation = useMutation({
    mutationFn: () => campanasApi.preview(filtros),
    onSuccess: (data) => {
      setListaGuardada(false);
      if (!correoEditado) {
        setAsuntoCorreo(data.email_asunto || '');
        setCuerpoCorreo(data.email_cuerpo || '');
        setHtmlCorreo(data.email_html || '');
      }
    },
    onError: (error: unknown) => showToast('error', 'Lista', apiDetail(error, 'No se pudo armar la lista.')),
  });

  const crearMutation = useMutation({
    mutationFn: () =>
      campanasApi.crear({
        ...filtros,
        nombre: nombre.trim(),
        email_asunto: asuntoCorreo.trim() || null,
        email_cuerpo: cuerpoCorreo.trim() || null,
      }),
    onSuccess: (row) => {
      setCampanaId(row.id);
      setListaGuardada(true);
      queryClient.invalidateQueries({ queryKey: ['campanas'] });
      queryClient.invalidateQueries({ queryKey: ['campana', row.id] });
      showToast('success', 'Campaña lista', `${row.total_destinatarios} destinatarios. Envíe desde la tabla de abajo.`);
    },
    onError: (error: unknown) => showToast('error', 'Campaña', apiDetail(error, 'No se pudo guardar.')),
  });

  const enviarMutation = useMutation({
    mutationFn: (id: string) => campanasApi.enviar(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['campanas'] });
      queryClient.invalidateQueries({ queryKey: ['campana', res.id] });
      showToast('success', 'Enviando', res.message);
    },
    onError: (error: unknown) => showToast('error', 'Envío', apiDetail(error, 'No se pudo enviar.')),
  });

  const muestra = previewMutation.data?.destinatarios?.[0];

  const renderCorreoMutation = useMutation({
    mutationFn: () =>
      campanasApi.previewCorreo({
        tipo,
        etiqueta: etiqueta || null,
        email_asunto: asuntoCorreo.trim() || null,
        email_cuerpo: cuerpoCorreo.trim(),
        nombre_muestra: muestra?.cliente_nombre,
        placa_muestra: muestra?.placa,
        motivo_muestra: muestra?.motivo,
      }),
    onSuccess: (data) => {
      setHtmlCorreo(data.email_html || '');
    },
    onError: (error: unknown) => showToast('error', 'Correo', apiDetail(error, 'No se pudo ver la carta.')),
  });

  const grokCorreoMutation = useMutation({
    mutationFn: () =>
      campanasApi.grokCorreo({
        tipo,
        etiqueta: etiqueta || null,
        notas: notasCorreo.trim() || null,
        cuerpo_actual: cuerpoCorreo.trim() || null,
      }),
    onSuccess: async (res) => {
      setAsuntoCorreo(res.asunto);
      setCuerpoCorreo(res.cuerpo);
      setCorreoEditado(true);
      showToast('success', 'Redacción lista', 'Revise el texto y cómo llega el correo abajo. Luego Guardar.');
      try {
        const data = await campanasApi.previewCorreo({
          tipo,
          etiqueta: etiqueta || null,
          email_asunto: res.asunto,
          email_cuerpo: res.cuerpo,
          nombre_muestra: previewMutation.data?.destinatarios?.[0]?.cliente_nombre,
          placa_muestra: previewMutation.data?.destinatarios?.[0]?.placa,
          motivo_muestra: previewMutation.data?.destinatarios?.[0]?.motivo,
        });
        setHtmlCorreo(data.email_html || '');
      } catch {
        /* el texto ya quedó; la vista de abajo se actualiza sola */
      }
    },
    onError: (error: unknown) => showToast('error', 'Asistente CDASoft', apiDetail(error, 'No se pudo redactar. Escríbalo usted.')),
  });

  useEffect(() => {
    if (!correoEditado) return;
    if (cuerpoCorreo.trim().length < 8) return;
    const timer = window.setTimeout(() => {
      renderCorreoMutation.mutate();
    }, 700);
    return () => window.clearTimeout(timer);
    // mutate es estable; no incluir la mutation completa para no rearmar el timer en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asuntoCorreo, cuerpoCorreo, correoEditado, tipo, etiqueta, muestra?.cliente_nombre, muestra?.placa, muestra?.motivo]);

  const preview = previewMutation.data;
  const campañas = listQuery.data || [];
  const detalleQuery = useQuery({
    queryKey: ['campana', campanaId],
    queryFn: () => campanasApi.get(campanaId as string),
    enabled: Boolean(campanaId),
    refetchInterval: 8000,
  });
  const detalle = detalleQuery.data;
  const dests = detalle?.destinatarios || [];
  const totalPaginasEnvios = Math.max(1, Math.ceil(campañas.length / PAGE_ENVIOS));
  const paginaEnviosActual = Math.min(paginaEnvios, totalPaginasEnvios);
  const campañasPagina = useMemo(() => {
    const start = (paginaEnviosActual - 1) * PAGE_ENVIOS;
    return campañas.slice(start, start + PAGE_ENVIOS);
  }, [campañas, paginaEnviosActual]);
  const totalPaginasDest = Math.max(1, Math.ceil(dests.length / PAGE_DEST));
  const paginaDestActual = Math.min(paginaDest, totalPaginasDest);
  const destsPagina = useMemo(() => {
    const start = (paginaDestActual - 1) * PAGE_DEST;
    return dests.slice(start, start + PAGE_DEST);
  }, [dests, paginaDestActual]);

  useEffect(() => {
    setPaginaDest(1);
  }, [campanaId]);

  const toggleDetalle = (id: string) => {
    setCampanaId((prev) => (prev === id ? null : id));
  };
  const enviadas = campañas.filter((c) => c.estado === 'enviada').length;
  const enviando = campañas.filter((c) => c.estado === 'enviando').length;
  const fallidas = campañas.filter((c) => c.estado === 'fallida').length;
  const puedeArmarLista = !usaExcel || filasExcel.length > 0;

  const elegirTipo = (value: CampanaTipo) => {
    const meta = TIPOS.find((t) => t.value === value) || TIPOS[0];
    setTipo(value);
    setNombre(meta.nombre);
    setCampanaId(null);
    setAsuntoCorreo('');
    setCuerpoCorreo('');
    setNotasCorreo('');
    setHtmlCorreo('');
    setCorreoEditado(false);
    setListaGuardada(false);
    previewMutation.reset();
  };

  return (
    <Layout title="Comunicaciones">
      <div className="space-y-6">
        <section className="module-hero">
          <p className="module-hero-title">
            <Megaphone className="w-5 h-5 text-orange-600" />
            Comunicaciones
          </p>
          <p className="module-hero-subtitle">
            Arme la lista, redacte el correo (usted o el Asistente CDASoft) y envíe. Si el CDA tiene WhatsApp, también sale la
            plantilla de Meta. Sin WhatsApp, la campaña va solo por correo.
          </p>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Campañas</p>
            <p className="text-2xl font-bold text-slate-900">{campañas.length}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Enviadas</p>
            <p className="text-2xl font-bold text-emerald-700">{enviadas}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Enviando</p>
            <p className="text-2xl font-bold text-cyan-700">{enviando}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Fallidas</p>
            <p className="text-2xl font-bold text-red-700">{fallidas}</p>
          </div>
        </section>

        <section className="section-card p-2">
          <div className="flex flex-wrap gap-2">
            {TIPOS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => elegirTipo(item.value)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  tipo === item.value ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="section-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="min-w-[16rem] flex-1">
              <p className="text-sm font-semibold text-slate-800">{tipoMeta.label}</p>
              <p className="text-xs text-slate-500 mt-1">{tipoMeta.help}</p>
            </div>
            <button
              type="button"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isLoading || !puedeArmarLista}
              className="btn-corporate-primary px-4 inline-flex items-center gap-2 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${previewMutation.isLoading ? 'animate-spin' : ''}`} />
              {previewMutation.isLoading ? 'Armando lista...' : 'Armar lista'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            <label className="block text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nombre</span>
              <input
                className="input-corporate mt-1 w-full bg-slate-50 text-slate-700 cursor-default"
                value={nombre}
                readOnly
                tabIndex={-1}
                aria-readonly="true"
              />
            </label>
            {sedes.length > 1 && (
              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sede</span>
                <select className="input-corporate mt-1 w-full" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                  <option value="">Todas las sedes</option>
                  {sedes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tipo === 'por_vencer' && (
              <label className="block text-sm md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vence entre (días)</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    className="input-corporate w-full"
                    value={diasDesde}
                    min={1}
                    max={40}
                    aria-label="Días desde"
                    onChange={(e) => setDiasDesde(Number(e.target.value))}
                  />
                  <span className="text-sm text-slate-500 shrink-0">y</span>
                  <input
                    type="number"
                    className="input-corporate w-full"
                    value={diasHasta}
                    min={1}
                    max={40}
                    aria-label="Días hasta"
                    onChange={(e) => setDiasHasta(Number(e.target.value))}
                  />
                  <span className="text-sm text-slate-500 shrink-0">días</span>
                </div>
              </label>
            )}
            {tipo === 'inactivos' && (
              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Meses sin visita</span>
                <input
                  type="number"
                  className="input-corporate mt-1 w-full"
                  value={mesesInactivo}
                  min={3}
                  max={36}
                  onChange={(e) => setMesesInactivo(Number(e.target.value))}
                />
              </label>
            )}
            {usaExcel && (
              <label className="block text-sm md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Motivo (frase completa)
                </span>
                <input
                  className="input-corporate mt-1 w-full"
                  value={etiqueta}
                  onChange={(e) => setEtiqueta(e.target.value)}
                  placeholder="Ej. Queremos atenderlo de nuevo en nuestro CDA."
                />
                <span className="text-xs text-slate-500">
                  Oración completa. En WhatsApp queda: «Hola (nombre), le escribe (CDA). (esto). Pulse Agendar…»
                </span>
              </label>
            )}
          </div>

          {usaExcel && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <button
                type="button"
                className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                onClick={() =>
                  downloadXlsx(
                    'plantilla-campana-cdasoft.xlsx',
                    ['nombre', 'celular', 'correo', 'autorizo_habeas'],
                    [['ANA PEREZ', '3001234567', 'ana@correo.com', 'si']],
                  )
                }
              >
                <FileSpreadsheet className="w-4 h-4" />
                Descargar plantilla
              </button>
              <label className="btn-corporate-muted px-4 inline-flex items-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" />
                {excelNombre || 'Subir Excel'}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const filas = await parseExcelFile(file);
                      setFilasExcel(filas);
                      setExcelNombre(`${file.name} · ${filas.length} filas`);
                      previewMutation.reset();
                    } catch {
                      showToast('error', 'Excel', 'No se pudo leer el archivo.');
                    }
                  }}
                />
              </label>
              <p className="text-xs text-slate-500">
                Columnas: nombre, celular, correo, autorizo_habeas. En habeas escriba si. Basta celular o
                correo (o ambos). Tope 500.
              </p>
            </div>
          )}

          {preview && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{preview.total}</span> destinatarios
                  {preview.omitidos > 0 ? ` · ${preview.omitidos} omitidos` : ''}
                  {preview.destinatarios.length < preview.total
                    ? ` · se muestran los primeros ${preview.destinatarios.length}`
                    : ''}
                  {(preview.con_correo ?? 0) > 0 ? ` · ${preview.con_correo} con correo` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                    disabled={preview.destinatarios.length === 0}
                    onClick={() => exportarDestinatarios(nombre, preview.destinatarios)}
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Excel
                  </button>
                  <button
                    type="button"
                    className="btn-corporate-primary px-4 disabled:opacity-60"
                    disabled={preview.total === 0 || crearMutation.isLoading || listaGuardada}
                    onClick={() => crearMutation.mutate()}
                  >
                    {crearMutation.isLoading ? 'Guardando...' : listaGuardada ? 'Campaña guardada' : 'Guardar campaña'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500 -mt-1">
                Guardar deja un borrador. Todavía no se envía. El botón Enviar aparece abajo, en Envíos.
              </p>
              {!preview.canal_listo && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  {preview.canal_motivo}{' '}
                  {(preview.con_correo ?? 0) > 0
                    ? `Puede enviar igual, solo por correo, a ${preview.con_correo} de ${preview.total} que tienen email. El resto no recibe nada hasta que conecte WhatsApp.`
                    : 'Sin WhatsApp y sin correos en la lista no se puede enviar. Cargue emails o conéctelo en Sedes y usuarios.'}{' '}
                  <Link to="/organizacion?tab=whatsapp" className="font-semibold underline underline-offset-2">
                    Abrir WhatsApp del CDA
                  </Link>
                </p>
              )}
              {!preview.ventana_ok && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  {preview.ventana_motivo}
                </p>
              )}
              {(preview.whatsapp_hoy ?? 0) > 0 && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  {preview.whatsapp_hoy} de esta lista ya recibieron un WhatsApp comercial hoy. En el envío ese
                  número va por correo; Meta suele no entregar el segundo mensaje de campaña.
                </p>
              )}
              <div className="table-shell">
                <table className="table-enterprise">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Placa</th>
                      <th>Celular</th>
                      <th>Correo</th>
                      <th>Por qué entra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.destinatarios.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-sm text-slate-500">
                          {vacioLista(tipo)}
                        </td>
                      </tr>
                    ) : (
                      preview.destinatarios.map((row) => (
                        <tr key={`${row.destino_e164}-${row.placa || ''}`}>
                          <td>{row.cliente_nombre}</td>
                          <td className="font-semibold text-slate-900">{row.placa || '—'}</td>
                          <td>{esMovilCo(row.destino_e164) ? row.destino_e164 : '—'}</td>
                          <td className="text-slate-600">{row.cliente_email || '—'}</td>
                          <td className="text-slate-600">{row.motivo}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div
                  className={`rounded-lg border px-3 py-3 space-y-2 ${
                    preview.canal_listo
                      ? 'border-slate-200 bg-white'
                      : 'border-slate-200 bg-slate-50 order-2 lg:order-2'
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp (así sale)</p>
                  {preview.canal_listo ? (
                    <>
                  <p className="text-sm text-slate-800 leading-relaxed">
                    {preview.whatsapp_preview || preview.plantilla_cuerpo || preview.plantilla}
                  </p>
                  <p className="text-xs text-slate-500">
                    {preview.plantilla}.{' '}
                    {usaExcel
                      ? 'Meta fija el saludo; usted escribe el motivo (oración completa). Si el envío falla, cree la plantilla cdasoft_campana_jornada en Sedes y usuarios → WhatsApp y espere Approved.'
                      : tipo === 'inactivos'
                        ? 'Meta no deja cambiar esta frase; CDASoft rellena nombre, CDA y placa.'
                        : 'Meta no deja cambiar esta frase; CDASoft rellena nombre, CDA, placa y fecha.'}
                  </p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Este CDA no tiene WhatsApp conectado. Si más adelante lo activa en Sedes y usuarios, las
                      campañas usarán esta plantilla de Meta ({preview.plantilla}). Hoy el envío es solo correo.
                    </p>
                  )}
                </div>
                <div
                  className={`rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-2 ${
                    preview.canal_listo ? '' : 'order-1 lg:order-1'
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Correo (usted lo redacta)
                  </p>
                  <p className="text-xs text-slate-500">
                    {preview.canal_listo
                      ? 'WhatsApp no cambia. Aquí sí: escriba el cuerpo o pida redacción al Asistente CDASoft. Use '
                      : 'Este es el mensaje que llega. Escríbalo usted o pida redacción al Asistente CDASoft. Use '}
                    {'{{nombre}}'}, {'{{cda}}'}, {'{{placa}}'}. El botón Agendar lo pone CDASoft.
                  </p>
                  <label className="block text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Asunto</span>
                    <input
                      className="input-corporate mt-1 w-full"
                      value={asuntoCorreo}
                      onChange={(e) => {
                        setCorreoEditado(true);
                        setAsuntoCorreo(e.target.value);
                      }}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cuerpo</span>
                    <textarea
                      className="input-corporate mt-1 w-full min-h-[140px]"
                      value={cuerpoCorreo}
                      onChange={(e) => {
                        setCorreoEditado(true);
                        setCuerpoCorreo(e.target.value);
                      }}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Datos para el Asistente (hechos)
                    </span>
                    <input
                      className="input-corporate mt-1 w-full"
                      value={notasCorreo}
                      onChange={(e) => setNotasCorreo(e.target.value)}
                      placeholder="Ej. este fin de semana horario 8:00 a.m. a 8:00 p.m."
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-corporate-muted px-3 py-2 text-xs inline-flex items-center gap-1"
                      disabled={grokCorreoMutation.isLoading}
                      onClick={() => grokCorreoMutation.mutate()}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {grokCorreoMutation.isLoading ? 'Redactando...' : 'Pedir redacción'}
                    </button>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Así llega el correo
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 mb-2">
                      {renderCorreoMutation.isLoading
                        ? 'Actualizando la vista…'
                        : 'Carta con membrete, nombre relleno y el botón Agendar. Se actualiza al escribir.'}
                    </p>
                    {htmlCorreo ? (
                      <iframe
                        title="Vista previa del correo"
                        className="w-full h-[360px] rounded-md border border-slate-100 bg-slate-50"
                        sandbox=""
                        srcDoc={htmlCorreo}
                      />
                    ) : (
                      <p className="text-sm text-slate-500 rounded-md border border-dashed border-slate-200 px-3 py-6 text-center">
                        Escriba el cuerpo (mínimo una frase) para ver la carta.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="section-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Envíos</p>
              <p className="text-xs text-slate-500 mt-1">
                Si el CDA tiene WhatsApp, Enviar manda la plantilla de Meta y, si hay email, el correo
                corporativo. Si no tiene WhatsApp, sale solo el correo a quien lo tenga. Meta factura el
                WhatsApp. Horario: lunes a sábado, 7:00 a.m. a 7:00 p.m. (Colombia), no festivos.
              </p>
            </div>
            <button
              type="button"
              className="btn-corporate-muted px-4 inline-flex items-center gap-2"
              onClick={() => listQuery.refetch()}
            >
              <RefreshCw className={`w-4 h-4 ${listQuery.isFetching ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
          <div className="table-shell">
            <table className="table-enterprise">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Destinatarios</th>
                  <th>Ok / falló</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr>
                    <td colSpan={6} className="text-sm text-slate-500">
                      Cargando campañas...
                    </td>
                  </tr>
                ) : campañasPagina.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-sm text-slate-500">
                      Aún no hay campañas. Arme una lista arriba y guárdela para poder enviarla.
                    </td>
                  </tr>
                ) : (
                  campañasPagina.map((row) => {
                    const abierta = campanaId === row.id;
                    return (
                    <tr key={row.id} className={abierta ? 'bg-primary-50/60' : undefined}>
                      <td className="font-semibold text-slate-900">
                        {row.nombre}
                        {row.etiqueta ? <span className="block text-xs font-normal text-slate-500">{row.etiqueta}</span> : null}
                      </td>
                      <td>{tipoLabel(row.tipo)}</td>
                      <td>
                        <span className={estadoChip(row.estado)}>{estadoLabel(row.estado)}</span>
                        {row.error ? <p className="text-xs text-red-700 mt-1 max-w-xs">{row.error}</p> : null}
                      </td>
                      <td>{row.total_destinatarios}</td>
                      <td>
                        {row.enviados_ok} / {row.enviados_fail}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="btn-corporate-muted px-3 py-1.5 text-xs inline-flex items-center gap-1"
                            onClick={() => toggleDetalle(row.id)}
                            aria-expanded={abierta}
                          >
                            {abierta ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            {abierta ? 'Ocultar' : 'Ver'}
                          </button>
                          {(row.estado === 'borrador' || row.estado === 'fallida' || (row.estado === 'enviada' && row.enviados_ok === 0)) && (
                            <button
                              type="button"
                              className="btn-corporate-primary px-3 py-1.5 text-xs"
                              disabled={enviarMutation.isLoading}
                              onClick={() => {
                                const ok = window.confirm(
                                  `¿Enviar esta campaña a ${row.total_destinatarios} destinatarios? Sale por WhatsApp si el CDA lo tiene conectado, y por correo a quien tenga email.`,
                                );
                                if (ok) {
                                  setCampanaId(row.id);
                                  enviarMutation.mutate(row.id);
                                }
                              }}
                            >
                              Enviar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Paginador
            pagina={paginaEnviosActual}
            totalPaginas={totalPaginasEnvios}
            total={campañas.length}
            pageSize={PAGE_ENVIOS}
            onChange={setPaginaEnvios}
          />
          {campanaId && (
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button
                  type="button"
                  className="text-left min-w-0 flex-1"
                  onClick={() => setCampanaId(null)}
                  aria-expanded
                >
                  <p className="text-sm font-semibold text-slate-800 inline-flex items-center gap-1">
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                    Destinatarios{detalle ? ` · ${detalle.nombre}` : ''}
                  </p>
              <p className="text-xs text-slate-500 mt-1">
                WhatsApp y correo por separado. Omitido = ya se le escribió comercial hoy. Celular en blanco =
                esa fila iba solo por correo.
              </p>
                </button>
                <button
                  type="button"
                  className="btn-corporate-muted px-3 py-1.5 text-xs shrink-0 inline-flex items-center gap-1"
                  disabled={dests.length === 0}
                  onClick={() => exportarDestinatarios(detalle?.nombre || nombre, dests)}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel
                </button>
                <button
                  type="button"
                  className="btn-corporate-muted px-3 py-1.5 text-xs shrink-0"
                  onClick={() => setCampanaId(null)}
                >
                  Ocultar
                </button>
              </div>
              <div className="table-shell mt-3">
                <table className="table-enterprise">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Placa</th>
                      <th>Celular</th>
                      <th>Correo</th>
                      <th>WhatsApp</th>
                      <th>Correo</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleQuery.isLoading ? (
                      <tr>
                        <td colSpan={6} className="text-sm text-slate-500">
                          Cargando destinatarios...
                        </td>
                      </tr>
                    ) : dests.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-sm text-slate-500">
                          No hay destinatarios en esta campaña.
                        </td>
                      </tr>
                    ) : (
                      destsPagina.map((row) => (
                        <tr key={row.id || `${row.destino_e164}-${row.placa || ''}`}>
                          <td>{row.cliente_nombre}</td>
                          <td className="font-semibold text-slate-900">{row.placa || '—'}</td>
                          <td>{esMovilCo(row.destino_e164) ? row.destino_e164 : '—'}</td>
                          <td className="text-slate-600">{row.cliente_email || '—'}</td>
                          <td>
                            <span className={canalChip(row.estado_whatsapp)}>{estadoLabel(row.estado_whatsapp || '')}</span>
                          </td>
                          <td>
                            <span className={canalChip(row.estado_correo)}>{estadoLabel(row.estado_correo || '')}</span>
                          </td>
                          <td className="text-xs text-slate-600 max-w-xs">
                            {[row.error_whatsapp, row.error_correo, row.error].filter(Boolean).join(' · ') || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <Paginador
                pagina={paginaDestActual}
                totalPaginas={totalPaginasDest}
                total={dests.length}
                pageSize={PAGE_DEST}
                onChange={setPaginaDest}
              />
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
