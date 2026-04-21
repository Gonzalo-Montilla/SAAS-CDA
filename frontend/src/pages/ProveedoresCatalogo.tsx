import { useState, useEffect, useRef } from 'react';
import { isAxiosError } from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { extractApiErrorMessage } from '../utils/apiError';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import FactusMunicipalitySearchField from '../components/FactusMunicipalitySearchField';
import {
  proveedoresCatalogoApi,
  type ConceptoRetencionDse,
  type ProveedorCatalogo,
  type ProveedorCatalogoCreate,
} from '../api/proveedoresCatalogo';
import { factusApi, type FactusSettings } from '../api/factus';
import {
  dseRetencionApi,
  type DseRetencionParametrosPut,
  type DseRetencionPreviewOut,
} from '../api/dseRetencion';
import { useAuth } from '../contexts/AuthContext';
import {
  BookUser,
  Plus,
  Pencil,
  X,
  FileText,
  Eye,
  Trash2,
  SlidersHorizontal,
  Percent,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

const LS_DSE_ENTORNO_ABIERTO = 'proveedores-catalogo:dse-entorno-retencion-abierto';
const LS_DSE_MOTOR_ABIERTO = 'proveedores-catalogo:dse-motor-retencion-abierto';

function readCollapsedPref(key: string): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* private mode / SSR */
  }
  return false;
}

/** Evita 2.5000 / 11.0000 al cargar desde API; el usuario sigue pudiendo editar a mano. */
function formatearTasaDesdeApi(n: number): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return String(parseFloat(x.toFixed(6)));
}

/** UVT en pesos: sin ceros de más (52374 en vez de 52374.00). */
function formatearUvtDesdeApi(n: number): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return String(parseFloat(x.toFixed(2)));
}

const LABEL_CONCEPTO_DSE: Record<ConceptoRetencionDse, string> = {
  compras: 'Compras',
  servicios: 'Servicios',
  arrendamiento: 'Arrendamiento',
  honorarios: 'Honorarios',
};

const CONCEPTOS_DSE_ORDER: ConceptoRetencionDse[] = ['compras', 'servicios', 'arrendamiento', 'honorarios'];

function conceptosDisponiblesParaFormulario(cfg: FactusSettings | undefined): { value: ConceptoRetencionDse; label: string }[] {
  if (!cfg) {
    return CONCEPTOS_DSE_ORDER.map((value) => ({ value, label: LABEL_CONCEPTO_DSE[value] }));
  }
  return CONCEPTOS_DSE_ORDER.filter((c) => {
    if (c === 'compras') return cfg.dse_retencion_usar_compras !== false;
    if (c === 'servicios') return cfg.dse_retencion_usar_servicios !== false;
    if (c === 'arrendamiento') return cfg.dse_retencion_usar_arrendamiento !== false;
    return cfg.dse_retencion_usar_honorarios !== false;
  }).map((value) => ({ value, label: LABEL_CONCEPTO_DSE[value] }));
}

function proveedorToForm(p: ProveedorCatalogo): ProveedorCatalogoCreate {
  return {
    alias: p.alias || '',
    razon_social_rut: p.razon_social_rut,
    tipo_identificacion: p.tipo_identificacion,
    numero_identificacion: p.numero_identificacion,
    direccion: p.direccion,
    email: p.email,
    telefono: p.telefono,
    factus_municipality_id: p.factus_municipality_id,
    activo: p.activo,
    concepto_retencion_dse: p.concepto_retencion_dse ?? 'servicios',
  };
}

const TIPOS_ID = ['NIT', 'C.C', 'TARJETA DE IDENTIDAD', 'C.E', 'PASAPORTE', 'P.E.P'] as const;

const emptyForm: ProveedorCatalogoCreate = {
  alias: '',
  razon_social_rut: '',
  tipo_identificacion: 'NIT',
  numero_identificacion: '',
  direccion: '',
  email: '',
  telefono: '',
  factus_municipality_id: 1,
  activo: true,
  concepto_retencion_dse: 'servicios',
};

export default function ProveedoresCatalogoPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const esAdmin = user?.rol === 'administrador';
  const puedeVistaPreviaMotor = user?.rol === 'administrador' || user?.rol === 'contador';

  const [entornoRetencionAbierto, setEntornoRetencionAbierto] = useState(() =>
    readCollapsedPref(LS_DSE_ENTORNO_ABIERTO),
  );
  const [motorRetencionAbierto, setMotorRetencionAbierto] = useState(() =>
    readCollapsedPref(LS_DSE_MOTOR_ABIERTO),
  );

  useEffect(() => {
    try {
      localStorage.setItem(LS_DSE_ENTORNO_ABIERTO, entornoRetencionAbierto ? '1' : '0');
    } catch {
      /* noop */
    }
  }, [entornoRetencionAbierto]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_DSE_MOTOR_ABIERTO, motorRetencionAbierto ? '1' : '0');
    } catch {
      /* noop */
    }
  }, [motorRetencionAbierto]);
  const { data: factusCfg } = useQuery({
    queryKey: ['factus-settings'],
    queryFn: () => factusApi.getSettings(),
    staleTime: 60_000,
  });
  const { data: items, isLoading } = useQuery({
    queryKey: ['proveedores-catalogo-admin'],
    queryFn: () => proveedoresCatalogoApi.listar(false),
    staleTime: 15_000,
  });

  const [modal, setModal] = useState<'crear' | 'editar' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProveedorCatalogoCreate>(emptyForm);
  /** Refleja adjunto RUT en el proveedor en edición (lista + respuestas API). */
  const [tieneAdjuntoRut, setTieneAdjuntoRut] = useState(false);
  const [rutFile, setRutFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitulo, setPreviewTitulo] = useState('');
  const previewBlobRef = useRef<string | null>(null);

  const revocarPreviewBlob = () => {
    if (previewBlobRef.current) {
      URL.revokeObjectURL(previewBlobRef.current);
      previewBlobRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewTitulo('');
  };

  useEffect(() => () => revocarPreviewBlob(), []);

  /** Solo la fila (o el modal del mismo id) muestra “cargando…” al pedir el PDF. */
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  const abrirPreviewPdf = async (id: string, titulo: string) => {
    try {
      revocarPreviewBlob();
      setPreviewLoadingId(id);
      const blob = await proveedoresCatalogoApi.descargarDocumentoRutBlob(id);
      const url = URL.createObjectURL(blob);
      previewBlobRef.current = url;
      setPreviewUrl(url);
      setPreviewTitulo(titulo);
    } catch (err: unknown) {
      const st = isAxiosError(err) ? err.response?.status : undefined;
      let detail = '';
      if (isAxiosError(err) && err.response?.data instanceof Blob) {
        try {
          const t = await err.response.data.text();
          const j = JSON.parse(t) as { detail?: unknown };
          if (typeof j.detail === 'string') detail = j.detail;
        } catch {
          /* usar mensajes genéricos */
        }
      }
      if (st === 404) {
        window.alert(
          detail ||
            'No hay PDF del RUT guardado para este proveedor, o el archivo ya no está en el servidor.\n\n' +
              'Si acaba de subirlo, cierre este aviso y pulse de nuevo tras unos segundos. ' +
              'Si persiste, use «Editar» y vuelva a subir la certificación RUT (PDF) de la DIAN.',
        );
      } else if (st === 403) {
        window.alert(
          detail ||
            'No tiene permiso para descargar este documento. Se requiere rol cajero o administrador.',
        );
      } else {
        window.alert(
          extractApiErrorMessage(err, 'No se pudo cargar el PDF. Compruebe su sesión y el servidor.'),
        );
      }
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const cerrarModal = () => {
    revocarPreviewBlob();
    setModal(null);
    setEditId(null);
    setForm(emptyForm);
    setTieneAdjuntoRut(false);
    setRutFile(null);
  };

  const crear = useMutation({
    mutationFn: proveedoresCatalogoApi.crear,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      setEditId(data.id);
      setForm(proveedorToForm(data));
      setTieneAdjuntoRut(data.tiene_documento_rut);
      setRutFile(null);
      setModal('editar');
    },
  });

  const actualizar = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof proveedoresCatalogoApi.actualizar>[1] }) =>
      proveedoresCatalogoApi.actualizar(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      cerrarModal();
    },
  });

  const subirRut = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      proveedoresCatalogoApi.subirDocumentoRut(id, file),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      setTieneAdjuntoRut(data.tiene_documento_rut);
      setRutFile(null);
      if (!data.tiene_documento_rut) {
        window.alert(
          'La subida terminó pero el servidor no registró el PDF. Revise que el backend esté actualizado y que exista la columna rut_pdf_relpath en proveedores_catalogo. Si el problema continúa, copie el mensaje de la consola del servidor.',
        );
      }
    },
    onError: (error) => {
      window.alert(
        extractApiErrorMessage(
          error,
          'No se pudo guardar el PDF. Si es la primera vez, compruebe que su usuario sea administrador.',
        ),
      );
    },
  });

  const eliminarRut = useMutation({
    mutationFn: (id: string) => proveedoresCatalogoApi.eliminarDocumentoRut(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      setTieneAdjuntoRut(data.tiene_documento_rut);
    },
  });

  const patchEntornoRetenciones = useMutation({
    mutationFn: factusApi.patchDocumentoSoporteEntornoRetenciones,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factus-settings'] });
    },
    onError: (err: unknown) => {
      window.alert(extractApiErrorMessage(err, 'No se pudo guardar el entorno de retenciones.'));
    },
  });

  const [anioMotor, setAnioMotor] = useState(() => new Date().getFullYear());
  const { data: motorParams, isLoading: motorLoading } = useQuery({
    queryKey: ['dse-retencion-parametros', anioMotor],
    queryFn: () => dseRetencionApi.getParametros(anioMotor),
    enabled: esAdmin,
    staleTime: 30_000,
  });
  const [uvtDraft, setUvtDraft] = useState('');
  const [tasasDraft, setTasasDraft] = useState<Partial<Record<ConceptoRetencionDse, string>>>({});

  useEffect(() => {
    if (!motorParams) return;
    setUvtDraft(
      motorParams.valor_uvt_cop != null && motorParams.valor_uvt_cop !== undefined
        ? formatearUvtDesdeApi(Number(motorParams.valor_uvt_cop))
        : '',
    );
    const t: Partial<Record<ConceptoRetencionDse, string>> = {};
    for (const c of CONCEPTOS_DSE_ORDER) {
      const v = motorParams.tasas[c];
      t[c] = v != null && v !== undefined ? formatearTasaDesdeApi(Number(v)) : '';
    }
    setTasasDraft(t);
  }, [motorParams]);

  const guardarMotorParams = useMutation({
    mutationFn: async () => {
      const rawUvt = uvtDraft.trim();
      let valorUvt: number | null;
      if (rawUvt === '') {
        valorUvt = null;
      } else {
        const u = parseFloat(rawUvt.replace(',', '.'));
        if (Number.isNaN(u) || u < 0) {
          window.alert('Indique un valor de UVT válido (pesos) o déjelo vacío para borrarlo.');
          throw new Error('uvt');
        }
        valorUvt = u;
      }
      const habilitados = conceptosDisponiblesParaFormulario(factusCfg).map((x) => x.value);
      const tasas: NonNullable<DseRetencionParametrosPut['tasas']> = {};
      for (const c of habilitados) {
        const raw = (tasasDraft[c] ?? '').trim();
        if (raw === '') {
          tasas[c] = null;
        } else {
          const p = parseFloat(raw.replace(',', '.'));
          if (Number.isNaN(p) || p < 0 || p > 100) {
            window.alert(
              `La tasa de ${LABEL_CONCEPTO_DSE[c]} debe ser un número entre 0 y 100, o vacío para borrarla.`,
            );
            throw new Error('tasa');
          }
          tasas[c] = p;
        }
      }
      return dseRetencionApi.putParametros(anioMotor, { valor_uvt_cop: valorUvt, tasas });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dse-retencion-parametros', anioMotor] });
    },
    onError: (err: unknown) => {
      if ((err as Error)?.message === 'uvt' || (err as Error)?.message === 'tasa') return;
      window.alert(extractApiErrorMessage(err, 'No se pudieron guardar los parámetros del motor.'));
    },
  });

  const [previewMonto, setPreviewMonto] = useState('');
  const [previewConcepto, setPreviewConcepto] = useState<ConceptoRetencionDse>('servicios');
  const [previewResult, setPreviewResult] = useState<DseRetencionPreviewOut | null>(null);

  const previewMotor = useMutation({
    mutationFn: () => {
      const m = parseFloat(previewMonto.replace(',', '.'));
      if (Number.isNaN(m) || m <= 0) {
        window.alert('Indique un monto de pago mayor a cero.');
        return Promise.reject(new Error('monto'));
      }
      return dseRetencionApi.postPreview({ monto: m, concepto: previewConcepto, anio: anioMotor });
    },
    onSuccess: (data) => setPreviewResult(data),
    onError: (err: unknown) => {
      if ((err as Error)?.message === 'monto') return;
      window.alert(extractApiErrorMessage(err, 'No se pudo calcular la vista previa.'));
      setPreviewResult(null);
    },
  });

  const aplicarToggleEntorno = (
    campo:
      | 'dse_retencion_usar_compras'
      | 'dse_retencion_usar_servicios'
      | 'dse_retencion_usar_arrendamiento'
      | 'dse_retencion_usar_honorarios',
    valor: boolean,
  ) => {
    if (!factusCfg) return;
    patchEntornoRetenciones.mutate({
      dse_retencion_usar_compras: factusCfg.dse_retencion_usar_compras ?? true,
      dse_retencion_usar_servicios: factusCfg.dse_retencion_usar_servicios ?? true,
      dse_retencion_usar_arrendamiento: factusCfg.dse_retencion_usar_arrendamiento ?? true,
      dse_retencion_usar_honorarios: factusCfg.dse_retencion_usar_honorarios ?? true,
      [campo]: valor,
    });
  };

  const abrirCrear = () => {
    setForm({ ...emptyForm, tipo_identificacion: 'NIT', factus_municipality_id: 1 });
    setEditId(null);
    setTieneAdjuntoRut(false);
    setRutFile(null);
    setModal('crear');
  };

  const abrirEditar = (p: ProveedorCatalogo) => {
    setEditId(p.id);
    setForm(proveedorToForm(p));
    setTieneAdjuntoRut(p.tiene_documento_rut);
    setRutFile(null);
    setModal('editar');
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const mid = Number(form.factus_municipality_id);
    if (!Number.isFinite(mid) || mid < 1) {
      window.alert('Indique un id de municipio Factus válido.');
      return;
    }
    const payload: ProveedorCatalogoCreate = {
      ...form,
      alias: form.alias?.trim() || null,
      razon_social_rut: form.razon_social_rut.trim(),
      tipo_identificacion: form.tipo_identificacion.trim(),
      numero_identificacion: form.numero_identificacion.trim(),
      direccion: form.direccion.trim(),
      email: form.email.trim().toLowerCase(),
      telefono: form.telefono.trim(),
      factus_municipality_id: mid,
      activo: form.activo !== false,
      concepto_retencion_dse: form.concepto_retencion_dse ?? 'servicios',
    };
    if (modal === 'crear') {
      crear.mutate(payload);
      return;
    }
    if (modal === 'editar' && editId) {
      if (rutFile) {
        try {
          const up = await proveedoresCatalogoApi.subirDocumentoRut(editId.trim(), rutFile);
          qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
          qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
          setTieneAdjuntoRut(up.tiene_documento_rut);
          setRutFile(null);
          if (!up.tiene_documento_rut) {
            window.alert(
              'El PDF no quedó registrado en el servidor. Revise la consola del backend y que exista la columna rut_pdf_relpath.',
            );
            return;
          }
        } catch (err) {
          window.alert(
            extractApiErrorMessage(
              err,
              'No se pudo guardar el PDF del RUT. Compruebe que sea administrador y que el archivo sea un PDF válido.',
            ),
          );
          return;
        }
      }
      actualizar.mutate({ id: editId, body: payload });
    }
  };

  const errMsg =
    (crear.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (actualizar.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  const errRut =
    (subirRut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (eliminarRut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  return (
    <Layout title="Catálogo de proveedores">
      <section className="module-hero">
        <p className="module-hero-title flex items-center gap-2">
          <BookUser className="w-5 h-5 text-primary-600 shrink-0" />
          Catálogo de proveedores (documento soporte DIAN)
        </p>
        <p className="module-hero-subtitle max-w-3xl">
          Registre una vez el nombre y número de identificación (como en el RUT/DIAN), más dirección, correo, teléfono y
          municipio Factus. Adjunte solo el PDF de certificación RUT emitido por la DIAN (no cédula escaneada). En caja y
          tesorería podrá elegir el proveedor sin volver a teclear esos datos.
        </p>
      </section>

      {esAdmin && (
        <section className="card-pos mb-6">
          <button
            type="button"
            className="w-full flex items-start gap-2 sm:gap-3 text-left rounded-xl -m-1 p-1 hover:bg-slate-50/90 transition-colors"
            onClick={() => setEntornoRetencionAbierto((v) => !v)}
            aria-expanded={entornoRetencionAbierto}
            aria-controls="panel-dse-entorno"
            id="heading-dse-entorno"
          >
            <span className="shrink-0 mt-1 text-slate-500" aria-hidden>
              {entornoRetencionAbierto ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </span>
            <SlidersHorizontal className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900">Entorno retención (documento soporte)</h2>
              {entornoRetencionAbierto ? (
                <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">
                  Indique qué conceptos de retención en la fuente aplican en su organización. Luego asigne a cada
                  proveedor un concepto por defecto (solo entre los habilitados aquí). Abajo puede cargar UVT y tasas por
                  año; el uso automático en egresos y el envío a Factus se conectará después.
                </p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">Pulsa para expandir y configurar conceptos habilitados.</p>
              )}
            </div>
          </button>
          {entornoRetencionAbierto && (
            <div className="mt-4 pt-2 border-t border-slate-100" id="panel-dse-entorno">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    ['dse_retencion_usar_compras', 'Compras'] as const,
                    ['dse_retencion_usar_servicios', 'Servicios'] as const,
                    ['dse_retencion_usar_arrendamiento', 'Arrendamiento'] as const,
                    ['dse_retencion_usar_honorarios', 'Honorarios'] as const,
                  ] as const
                ).map(([campo, etiqueta]) => (
                  <label key={campo} className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={factusCfg?.[campo] !== false}
                      disabled={!factusCfg || patchEntornoRetenciones.isLoading}
                      onChange={(e) => aplicarToggleEntorno(campo, e.target.checked)}
                    />
                    {etiqueta}
                  </label>
                ))}
              </div>
              {patchEntornoRetenciones.isLoading && (
                <p className="text-xs text-slate-500 mt-3">Guardando entorno…</p>
              )}
            </div>
          )}
        </section>
      )}

      {esAdmin && (
        <section className="card-pos mb-6">
          <button
            type="button"
            className="w-full flex items-start gap-2 sm:gap-3 text-left rounded-xl -m-1 p-1 hover:bg-slate-50/90 transition-colors"
            onClick={() => setMotorRetencionAbierto((v) => !v)}
            aria-expanded={motorRetencionAbierto}
            aria-controls="panel-dse-motor"
            id="heading-dse-motor"
          >
            <span className="shrink-0 mt-1 text-slate-500" aria-hidden>
              {motorRetencionAbierto ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </span>
            <Percent className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900">Parámetros motor retención (por año)</h2>
              {motorRetencionAbierto ? (
                <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">
                  Valor de 1 UVT en pesos (referencia DIAN para el año) y tasas de retención % por concepto habilitado en
                  el entorno. Deje un campo vacío y guarde para borrarlo. Solo administrador.
                </p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">Pulsa para expandir UVT y tasas por año fiscal.</p>
              )}
            </div>
          </button>
          {motorRetencionAbierto && (
            <div className="mt-4 pt-2 border-t border-slate-100" id="panel-dse-motor">
              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Año fiscal</label>
                  <input
                    type="number"
                    className="input-pos w-28 tabular-nums"
                    min={2000}
                    max={2100}
                    value={anioMotor}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!Number.isNaN(n)) setAnioMotor(Math.max(2000, Math.min(2100, n)));
                    }}
                  />
                </div>
              </div>
              {motorLoading ? (
                <LoadingSpinner message="Cargando parámetros…" />
              ) : (
                <>
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Valor 1 UVT (COP)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input-pos max-w-xs"
                      placeholder="Ej. 51500"
                      value={uvtDraft}
                      onChange={(e) => setUvtDraft(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mb-2">
                    Vacío = no hay tasa guardada para ese concepto (no es 0%). El rango válido al escribir es 0–100.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    {conceptosDisponiblesParaFormulario(factusCfg).map(({ value: c, label }) => (
                      <div key={c}>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Tasa {label} (%)
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input-pos w-full tabular-nums"
                          placeholder="Ej. 4"
                          title="Porcentaje entre 0 y 100. Dejar vacío y guardar borra la tasa."
                          value={tasasDraft[c] ?? ''}
                          onChange={(e) =>
                            setTasasDraft((prev) => ({
                              ...prev,
                              [c]: e.target.value,
                            }))
                          }
                          autoComplete="off"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn-pos btn-primary"
                    disabled={guardarMotorParams.isLoading}
                    onClick={() => guardarMotorParams.mutate()}
                  >
                    {guardarMotorParams.isLoading ? 'Guardando…' : 'Guardar parámetros del año'}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {puedeVistaPreviaMotor && (
        <section className="card-pos mb-6 border border-dashed border-slate-200 bg-slate-50/60">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Vista previa del motor (simulación)</h2>
          <p className="text-sm text-slate-500 mb-4 max-w-3xl">
            Usa el UVT, la tasa del año <span className="font-mono tabular-nums">{anioMotor}</span> y los umbrales UVT por
            concepto (referencia tipo tabla DIAN). No guarda nada; sirve para validar parámetros.
          </p>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Monto del pago (COP)</label>
              <input
                type="text"
                inputMode="decimal"
                className="input-pos w-40 tabular-nums"
                placeholder="Ej. 1500000"
                value={previewMonto}
                onChange={(e) => setPreviewMonto(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Concepto</label>
              <select
                className="input-pos min-w-[200px]"
                value={previewConcepto}
                onChange={(e) => setPreviewConcepto(e.target.value as ConceptoRetencionDse)}
              >
                {conceptosDisponiblesParaFormulario(factusCfg).map(({ value: c, label }) => (
                  <option key={c} value={c}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-pos btn-secondary"
              disabled={previewMotor.isLoading}
              onClick={() => previewMotor.mutate()}
            >
              {previewMotor.isLoading ? 'Calculando…' : 'Calcular'}
            </button>
          </div>
          {previewResult && (
            <div className="text-sm rounded-xl border border-slate-200 bg-white px-3 py-2.5 space-y-1">
              <p>
                <span className="font-medium text-slate-700">Retención sugerida:</span>{' '}
                {previewResult.retencion_cop != null ? (
                  <span className="font-semibold text-slate-900">
                    ${Number(previewResult.retencion_cop).toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                  </span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </p>
              {previewResult.base_minima_cop != null && (
                <p className="text-slate-600">
                  Base mínima (pesos):{' '}
                  <span className="tabular-nums">
                    ${Number(previewResult.base_minima_cop).toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                  </span>{' '}
                  (umbral {previewResult.umbral_uvt} UVT)
                </p>
              )}
              <p className="text-xs text-slate-500">
                UVT año: {previewResult.valor_uvt_cop ?? '—'} · Tasa: {previewResult.tasa_porcentaje ?? '—'}%
              </p>
              {previewResult.motivo_sin_calculo && previewResult.motivo_sin_calculo !== 'monto_cero' && (
                <p className="text-xs text-amber-800">
                  {previewResult.motivo_sin_calculo === 'falta_valor_uvt' &&
                    'Configure el valor UVT del año en parámetros (administrador).'}
                  {previewResult.motivo_sin_calculo === 'monto_bajo_base_minima' &&
                    'El monto no alcanza la base mínima en pesos para aplicar retención.'}
                  {previewResult.motivo_sin_calculo === 'sin_tasa_configurada' &&
                    'No hay tasa % configurada para ese concepto y año.'}
                  {previewResult.motivo_sin_calculo === 'tasa_invalida' && 'Tasa en base de datos inválida.'}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {isLoading ? (
        <div className="card-pos flex justify-center py-16">
          <LoadingSpinner message="Cargando catálogo de proveedores…" />
        </div>
      ) : (
        <div className="card-pos">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Proveedores registrados</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Datos usados en egresos de caja y tesorería y en documento soporte Factus.
              </p>
            </div>
            <button type="button" onClick={abrirCrear} className="btn-pos btn-primary inline-flex items-center gap-2 shrink-0">
              <Plus className="w-5 h-5" />
              Nuevo proveedor
            </button>
          </div>

          <div className="table-shell">
            <table className="table-enterprise">
              <thead>
                <tr>
                  <th>Alias</th>
                  <th>Razón social / nombre RUT</th>
                  <th>Doc.</th>
                  <th>Correo</th>
                  <th>Mcp. Factus</th>
                  <th>Activo</th>
                  <th>Retención</th>
                  <th>RUT (PDF)</th>
                  <th className="table-enterprise-col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items?.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-sm text-slate-600 text-center py-10">
                      No hay proveedores. Cree el primero con «Nuevo proveedor».
                    </td>
                  </tr>
                ) : (
                  (items ?? []).map((p) => (
                    <tr key={p.id}>
                      <td className="text-slate-700">{p.alias || '—'}</td>
                      <td className="font-medium text-slate-900">{p.razon_social_rut}</td>
                      <td className="text-slate-600 whitespace-nowrap">
                        {p.tipo_identificacion} {p.numero_identificacion}
                      </td>
                      <td className="text-slate-600">{p.email}</td>
                      <td className="text-slate-600 tabular-nums">{p.factus_municipality_id}</td>
                      <td>{p.activo ? 'Sí' : 'No'}</td>
                      <td className="text-slate-600 text-sm">
                        {LABEL_CONCEPTO_DSE[p.concepto_retencion_dse] ?? p.concepto_retencion_dse ?? '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={previewLoadingId === p.id}
                          title="Abrir o comprobar el PDF del RUT (certificación DIAN)"
                          onClick={() => void abrirPreviewPdf(p.id, p.razon_social_rut)}
                          className="text-primary-600 hover:text-primary-700 hover:underline inline-flex items-center gap-1.5 text-left"
                        >
                          <Eye className="w-4 h-4 shrink-0" />
                          {previewLoadingId === p.id ? 'Abriendo…' : 'Vista previa'}
                        </button>
                      </td>
                      <td className="table-enterprise-col-actions">
                        <button
                          type="button"
                          onClick={() => abrirEditar(p)}
                          className="text-primary-600 hover:text-primary-700 hover:underline inline-flex items-center gap-1.5 font-medium"
                        >
                          <Pencil className="w-4 h-4" />
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="modal-panel max-w-2xl w-full max-h-[92vh] overflow-y-auto relative p-5 sm:p-6">
            <button
              type="button"
              className="modal-close-btn absolute top-3 right-3"
              onClick={cerrarModal}
              aria-label="Cerrar"
            >
              <X className="w-5 h-5 mx-auto" />
            </button>
            <h3 className="text-xl font-bold text-slate-900 mb-1 pr-12">
              {modal === 'crear' ? 'Nuevo proveedor' : 'Editar proveedor'}
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Los mismos datos se reutilizan al registrar egresos y al emitir documento soporte.
            </p>
            {errMsg && (
              <div className="mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                {typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}
              </div>
            )}
            {errRut && (
              <div className="mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                {typeof errRut === 'string' ? errRut : JSON.stringify(errRut)}
              </div>
            )}
            <form onSubmit={guardar} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Alias (opcional)</label>
                <input
                  className="input-pos w-full"
                  value={form.alias ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))}
                  placeholder="Ej: Papelera Central"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nombre o razón social (RUT)</label>
                <input
                  className="input-pos w-full"
                  value={form.razon_social_rut}
                  onChange={(e) => setForm((f) => ({ ...f, razon_social_rut: e.target.value }))}
                  required
                  minLength={2}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo de identificación</label>
                <select
                  className="input-pos w-full max-w-xs"
                  value={form.tipo_identificacion}
                  onChange={(e) => setForm((f) => ({ ...f, tipo_identificacion: e.target.value }))}
                >
                  {TIPOS_ID.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Número de identificación (como en el RUT / registro DIAN)
                </label>
                <input
                  className="input-pos w-full"
                  value={form.numero_identificacion}
                  onChange={(e) => setForm((f) => ({ ...f, numero_identificacion: e.target.value }))}
                  required
                  minLength={4}
                  placeholder="Ej. 900.123.456-8 o 900123456-8"
                  autoComplete="off"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Un solo campo: incluya guion y dígito de verificación si aplica. El servidor quita separadores de miles y
                  unifica el formato para validar y para el documento soporte.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Dirección</label>
                <textarea
                  className="input-pos w-full min-h-[72px]"
                  value={form.direccion}
                  onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                  required
                  minLength={8}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Correo</label>
                  <input
                    type="email"
                    className="input-pos w-full"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Teléfono</label>
                  <input
                    className="input-pos w-full"
                    value={form.telefono}
                    onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <FactusMunicipalitySearchField
                value={String(form.factus_municipality_id || '')}
                onChange={(idDigits) =>
                  setForm((f) => ({
                    ...f,
                    factus_municipality_id: parseInt(idDigits, 10) || 0,
                  }))
                }
                disabled={factusCfg?.modo !== 'factus'}
                searchLabel="Municipio (Factus)"
                idInputLabel="Id municipio Factus"
                helperText="Mismo catálogo que en Organización."
              />
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Concepto de retención (documento soporte)
                </label>
                <select
                  className="input-pos w-full max-w-md"
                  value={form.concepto_retencion_dse ?? 'servicios'}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      concepto_retencion_dse: e.target.value as ConceptoRetencionDse,
                    }))
                  }
                >
                  {conceptosDisponiblesParaFormulario(factusCfg).map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  {form.concepto_retencion_dse &&
                    !conceptosDisponiblesParaFormulario(factusCfg).some((o) => o.value === form.concepto_retencion_dse) && (
                      <option value={form.concepto_retencion_dse}>
                        {LABEL_CONCEPTO_DSE[form.concepto_retencion_dse] ?? form.concepto_retencion_dse} (desactivado en
                        entorno; cambie el entorno o elija otro concepto)
                      </option>
                    )}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Debe coincidir con un concepto habilitado arriba (solo administrador). Por defecto suele ser servicios.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.activo !== false}
                  onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
                />
                Activo (visible en caja / tesorería)
              </label>

              {editId && (
                <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50/90">
                  <div className="flex items-start gap-2">
                    <FileText className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-slate-800 uppercase tracking-wide">Certificación RUT (PDF)</p>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        Solo el PDF oficial del RUT (DIAN). No use cédula escaneada ni otros documentos.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="text-sm text-slate-700 max-w-full"
                      onChange={(e) => setRutFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      disabled={!rutFile || subirRut.isLoading}
                      className="btn-pos btn-primary text-sm py-1.5 px-3"
                      onClick={() => {
                        if (editId && rutFile) subirRut.mutate({ id: editId, file: rutFile });
                      }}
                    >
                      {subirRut.isLoading ? 'Subiendo…' : 'Subir PDF'}
                    </button>
                    {tieneAdjuntoRut && (
                      <>
                        <button
                          type="button"
                          className="btn-pos btn-secondary text-sm py-1.5 px-3 inline-flex items-center gap-1"
                          onClick={() => editId && abrirPreviewPdf(editId, form.razon_social_rut)}
                          disabled={!!editId && previewLoadingId === editId}
                        >
                          <Eye className="w-4 h-4" />
                          {editId && previewLoadingId === editId ? 'Abriendo…' : 'Vista previa'}
                        </button>
                        <button
                          type="button"
                          className="text-sm text-red-700 hover:underline inline-flex items-center gap-1 py-1.5"
                          disabled={eliminarRut.isLoading}
                          onClick={() => {
                            if (editId && window.confirm('¿Quitar el PDF del RUT adjunto a este proveedor?')) {
                              eliminarRut.mutate(editId);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                          Quitar PDF
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={crear.isLoading || actualizar.isLoading}
                  className="flex-1 btn-pos btn-primary"
                >
                  {crear.isLoading || actualizar.isLoading ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" className="flex-1 btn-pos btn-secondary" onClick={cerrarModal}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa PDF"
        >
          <div className="w-full max-w-5xl h-[min(90vh,900px)] flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_20px_50px_-30px_rgba(15,23,42,0.45)]">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 shrink-0 rounded-t-2xl bg-white">
              <p className="text-sm font-semibold text-slate-900 truncate pr-2" title={previewTitulo}>
                {previewTitulo || 'Certificación RUT'}
              </p>
              <button
                type="button"
                className="modal-close-btn shrink-0"
                aria-label="Cerrar vista previa"
                onClick={revocarPreviewBlob}
              >
                <X className="w-5 h-5 mx-auto" />
              </button>
            </div>
            <iframe title="Vista previa" src={previewUrl} className="flex-1 w-full min-h-0 border-0 bg-slate-100" />
          </div>
        </div>
      )}
    </Layout>
  );
}
