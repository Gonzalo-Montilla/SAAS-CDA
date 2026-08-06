import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Filter,
  Download,
  Eye,
  File,
  FileCheck,
  FileStack,
  FileText,
  Folder,
  History,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  List,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  ShieldCheck,
  ScrollText,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import {
  documentosApi,
  type AlcanceSedeFiltro,
  type TenantDocumento,
} from '../api/documentos';
import type { Usuario } from '../types';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tipos que el navegador suele mostrar bien dentro de un iframe con blob: URL. */
function mimePermiteVistaPreviaEnIframe(mime: string): boolean {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (m === 'application/pdf') return true;
  if (m.startsWith('image/')) return true;
  if (m === 'text/plain' || m === 'text/csv') return true;
  return false;
}

/** Extensiones que el backend puede convertir a PDF con LibreOffice. */
function nombreArchivoEsOfficeConPreview(nombre: string): boolean {
  const i = nombre.lastIndexOf('.');
  if (i < 0) return false;
  const ext = nombre.slice(i + 1).toLowerCase();
  return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext);
}

function etiquetaAccionAuditoria(accion: string): string {
  const m: Record<string, string> = {
    subir: 'Subida',
    descargar: 'Descarga',
    metadata_update: 'Cambio de metadatos',
    eliminar: 'Eliminación',
    certificacion_cuenta: 'Certificación en cuenta',
  };
  return m[accion] ?? accion;
}

/** Alineado con extensiones permitidas en el backend (documentos). */
const EXTENSIONES_DOCUMENTO_PERMITIDAS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.csv',
]);

const MAX_DOCUMENTO_BYTES = 25 * 1024 * 1024;
const UNCATEGORIZED_FOLDER_KEY = '__sin_categoria__';
const VISTA_CARPETA_STORAGE_KEY = 'cdasoft-documentos-vista-carpeta';

function leerVistaCarpetaGuardada(): 'tabla' | 'tarjetas' {
  try {
    const raw = localStorage.getItem(VISTA_CARPETA_STORAGE_KEY);
    if (raw === 'tabla' || raw === 'tarjetas') return raw;
  } catch {
    /* modo privado / no disponible */
  }
  return 'tarjetas';
}

type CarpetaCategoria = {
  key: string;
  nombre: string;
  total: number;
};

type OrdenDocumentosCampo = 'fecha' | 'titulo';
type OrdenDocumentosDir = 'desc' | 'asc';

function extensionDeNombre(nombre: string): string {
  const i = nombre.lastIndexOf('.');
  if (i < 0) return '';
  return nombre.slice(i).toLowerCase();
}

function categoriaFolderKey(categoria: string | null | undefined): string {
  const c = (categoria ?? '').trim();
  if (!c) return UNCATEGORIZED_FOLDER_KEY;
  return c.toLocaleLowerCase('es-CO');
}

function validarArchivoDocumento(file: File, maxBytes: number = MAX_DOCUMENTO_BYTES): string | null {
  const ext = extensionDeNombre(file.name);
  if (!ext || !EXTENSIONES_DOCUMENTO_PERMITIDAS.has(ext)) {
    return 'Tipo de archivo no permitido. Use PDF, Office, imágenes o texto.';
  }
  if (file.size > maxBytes) {
    const mb = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
    return `El archivo supera el límite de ${mb} MB.`;
  }
  return null;
}

/** Propone un título legible a partir del nombre del archivo (sin extensión). */
function tituloSugeridoDesdeNombre(nombreArchivo: string): string {
  const base = nombreArchivo.replace(/\\/g, '/').split('/').pop() ?? nombreArchivo;
  const sinExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const limpio = sinExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return limpio.slice(0, 300);
}

/** Etiqueta corta para la columna Tipo; el MIME completo va en title. */
function etiquetaTipoArchivo(mime: string): string {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (m === 'application/pdf') return 'PDF';
  if (m.includes('wordprocessingml') || m === 'application/msword' || m.includes('word')) return 'Word';
  if (m.includes('spreadsheetml') || m.includes('excel') || m.includes('spreadsheet')) return 'Excel';
  if (m.includes('presentationml') || m.includes('powerpoint') || m.includes('presentation')) {
    return 'PowerPoint';
  }
  if (m.startsWith('image/')) return 'Imagen';
  if (m === 'text/plain' || m === 'text/csv') return 'Texto';
  if (m === 'application/octet-stream') return 'Archivo';
  const short = m.split('/').pop();
  return short ? short.slice(0, 12) : 'Archivo';
}

function claseColorTipoArchivo(mime: string): string {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (m === 'application/pdf') return 'bg-red-50 text-red-700 border-red-200';
  if (m.includes('wordprocessingml') || m === 'application/msword' || m.includes('word')) {
    return 'bg-blue-50 text-blue-700 border-blue-200';
  }
  if (m.includes('spreadsheetml') || m.includes('excel') || m.includes('spreadsheet')) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (m.includes('presentationml') || m.includes('powerpoint') || m.includes('presentation')) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  if (m.startsWith('image/')) return 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200';
  if (m === 'text/plain' || m === 'text/csv') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function IconoTipoArchivo({ mime }: { mime: string }) {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (m.startsWith('image/')) return <ImageIcon className="w-5 h-5" />;
  if (m === 'application/pdf') return <FileText className="w-5 h-5" />;
  if (m.includes('word') || m.includes('excel') || m.includes('powerpoint') || m.includes('presentation')) {
    return <FileText className="w-5 h-5" />;
  }
  return <File className="w-5 h-5" />;
}

export default function Documentos() {
  const { user } = useAuth();
  const tenantUser = user && 'tenant_id' in user ? (user as Usuario) : null;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [titulo, setTitulo] = useState('');
  const [categoriaNueva, setCategoriaNueva] = useState('');
  const [sucursalSubida, setSucursalSubida] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [carpetaActiva, setCarpetaActiva] = useState<string | null>(null);
  const [vistaCarpeta, setVistaCarpetaState] = useState<'tabla' | 'tarjetas'>(leerVistaCarpetaGuardada);
  const setVistaCarpeta = useCallback((next: 'tabla' | 'tarjetas') => {
    setVistaCarpetaState(next);
    try {
      localStorage.setItem(VISTA_CARPETA_STORAGE_KEY, next);
    } catch {
      /* ignorar */
    }
  }, []);
  const [ordenCampo, setOrdenCampo] = useState<OrdenDocumentosCampo>('fecha');
  const [ordenDir, setOrdenDir] = useState<OrdenDocumentosDir>('desc');
  const [alcanceSede, setAlcanceSede] = useState<AlcanceSedeFiltro>('todas');
  const [soloActuales, setSoloActuales] = useState(true);
  const [historialPara, setHistorialPara] = useState<TenantDocumento | null>(null);
  const [nuevaVersionPara, setNuevaVersionPara] = useState<TenantDocumento | null>(null);
  const [nvTitulo, setNvTitulo] = useState('');
  const [nvCategoria, setNvCategoria] = useState('');
  const [nvSucursalId, setNvSucursalId] = useState('');
  const [nvDragActivo, setNvDragActivo] = useState(false);
  const fileInputNvRef = useRef<HTMLInputElement>(null);
  const [docAccionesMenuId, setDocAccionesMenuId] = useState<string | null>(null);
  const [subidaSeccionAbierta, setSubidaSeccionAbierta] = useState(false);
  const [subidaDragActivo, setSubidaDragActivo] = useState(false);
  const [archivoSubiendoNombre, setArchivoSubiendoNombre] = useState<string | null>(null);
  /** Archivo elegido pero aún no enviado al servidor (subida nueva). */
  const [archivoPendientePrincipal, setArchivoPendientePrincipal] = useState<File | null>(null);
  /** Archivo pendiente en el modal «nueva versión». */
  const [archivoPendienteNv, setArchivoPendienteNv] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [editing, setEditing] = useState<TenantDocumento | null>(null);
  const [editTitulo, setEditTitulo] = useState('');
  const [editCategoria, setEditCategoria] = useState('');
  const [editSucursalId, setEditSucursalId] = useState<string>('');

  const [previewDoc, setPreviewDoc] = useState<TenantDocumento | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error' | 'unsupported' | 'preview_pending'
  >('idle');
  const [auditoriaQ, setAuditoriaQ] = useState('');
  const [auditoriaQDebounced, setAuditoriaQDebounced] = useState('');
  const [auditoriaAccion, setAuditoriaAccion] = useState('');
  const [auditoriaFechaInicio, setAuditoriaFechaInicio] = useState('');
  const [auditoriaFechaFin, setAuditoriaFechaFin] = useState('');
  const [auditoriaSort, setAuditoriaSort] = useState<'asc' | 'desc'>('desc');
  const [auditoriaPage, setAuditoriaPage] = useState(0);
  const [auditoriaPageSize, setAuditoriaPageSize] = useState(50);

  const esAdmin = user?.rol === 'administrador';
  const activeSucursalId = tenantUser?.active_sucursal_id?.trim() || null;
  const sucursales = tenantUser?.sucursales ?? [];

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const t = setTimeout(() => setAuditoriaQDebounced(auditoriaQ.trim()), 300);
    return () => clearTimeout(t);
  }, [auditoriaQ]);

  const nombreSedePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sucursales) m.set(s.id, s.nombre);
    return m;
  }, [sucursales]);

  const listFilters = useMemo(
    () => ({
      skip: 0,
      limit: 100,
      q: debouncedSearch || undefined,
      sucursalId: activeSucursalId,
      alcanceSede,
      soloActuales,
    }),
    [debouncedSearch, activeSucursalId, alcanceSede, soloActuales]
  );

  const categoriasQuery = useQuery({
    queryKey: ['tenant-documentos-categorias'],
    queryFn: () => documentosApi.listarCategorias(),
  });

  const storageQuery = useQuery({
    queryKey: ['tenant-documentos-almacenamiento'],
    queryFn: () => documentosApi.usoAlmacenamiento(),
    staleTime: 60_000,
  });

  const maxDocumentoBytes = storageQuery.data?.max_file_bytes ?? MAX_DOCUMENTO_BYTES;

  const listQuery = useQuery({
    queryKey: ['tenant-documentos', listFilters],
    queryFn: () => documentosApi.listar(listFilters),
  });

  const carpetas = useMemo<CarpetaCategoria[]>(() => {
    const map = new Map<string, CarpetaCategoria>();
    for (const doc of listQuery.data ?? []) {
      const nombre = (doc.categoria ?? '').trim() || 'Sin categoría';
      const key = categoriaFolderKey(doc.categoria);
      const prev = map.get(key);
      if (prev) {
        prev.total += 1;
        continue;
      }
      map.set(key, { key, nombre, total: 1 });
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === UNCATEGORIZED_FOLDER_KEY) return 1;
      if (b.key === UNCATEGORIZED_FOLDER_KEY) return -1;
      return a.nombre.localeCompare(b.nombre, 'es-CO');
    });
  }, [listQuery.data]);

  const documentosCarpetaActiva = useMemo(() => {
    const docs = listQuery.data ?? [];
    const filtrados = carpetaActiva ? docs.filter((d) => categoriaFolderKey(d.categoria) === carpetaActiva) : docs;
    const out = [...filtrados];
    out.sort((a, b) => {
      let cmp = 0;
      if (ordenCampo === 'fecha') {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else {
        cmp = a.titulo.localeCompare(b.titulo, 'es-CO');
      }
      return ordenDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [listQuery.data, carpetaActiva, ordenCampo, ordenDir]);

  const nombreCarpetaActiva = useMemo(() => {
    if (!carpetaActiva) return null;
    const found = carpetas.find((c) => c.key === carpetaActiva);
    return found?.nombre ?? 'Sin categoría';
  }, [carpetaActiva, carpetas]);

  const auditoriaParams = useMemo(
    () => ({
      skip: auditoriaPage * auditoriaPageSize,
      limit: auditoriaPageSize,
      q: auditoriaQDebounced || undefined,
      accion: auditoriaAccion || undefined,
      fecha_inicio: auditoriaFechaInicio || undefined,
      fecha_fin: auditoriaFechaFin || undefined,
      sort: auditoriaSort,
    }),
    [
      auditoriaPage,
      auditoriaPageSize,
      auditoriaQDebounced,
      auditoriaAccion,
      auditoriaFechaInicio,
      auditoriaFechaFin,
      auditoriaSort,
    ]
  );

  const auditoriaQuery = useQuery({
    queryKey: ['tenant-documentos-auditoria', auditoriaParams],
    queryFn: () => documentosApi.listarAuditoria(auditoriaParams),
    enabled: esAdmin,
    staleTime: 30_000,
  });
  const auditoriaItems = auditoriaQuery.data?.items ?? [];
  const auditoriaTotal = auditoriaQuery.data?.total ?? 0;
  const auditoriaTotalPages = Math.max(1, Math.ceil(auditoriaTotal / Math.max(1, auditoriaPageSize)));

  const versionesQuery = useQuery({
    queryKey: ['tenant-documentos-versiones', historialPara?.id],
    queryFn: () => documentosApi.listarVersiones(historialPara!.id),
    enabled: Boolean(historialPara?.id),
  });

  const invalidateDocumentos = () => {
    void queryClient.invalidateQueries({ queryKey: ['tenant-documentos'] });
    void queryClient.invalidateQueries({ queryKey: ['tenant-documentos-categorias'] });
    void queryClient.invalidateQueries({ queryKey: ['tenant-documentos-versiones'] });
    void queryClient.invalidateQueries({ queryKey: ['tenant-documentos-auditoria'] });
    void queryClient.invalidateQueries({ queryKey: ['tenant-documentos-almacenamiento'] });
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (nuevaVersionPara) {
        return documentosApi.subir(file, {
          titulo: nvTitulo.trim() || undefined,
          categoria: nvCategoria.trim() || undefined,
          sucursal_id: nvSucursalId.trim() || null,
          sustituye_a_id: nuevaVersionPara.id,
        });
      }
      return documentosApi.subir(file, {
        titulo: titulo || undefined,
        categoria:
          categoriaNueva ||
          (carpetaActiva && carpetaActiva !== UNCATEGORIZED_FOLDER_KEY ? nombreCarpetaActiva ?? undefined : undefined),
        sucursal_id: sucursalSubida.trim() || null,
        sustituye_a_id: null,
      });
    },
    onMutate: (file: File) => {
      setArchivoSubiendoNombre(file.name);
    },
    onSettled: () => {
      setArchivoSubiendoNombre(null);
    },
    onSuccess: () => {
      const fueNuevaVersion = Boolean(nuevaVersionPara);
      setFeedback({
        type: 'success',
        message: fueNuevaVersion ? 'Nueva versión registrada correctamente.' : 'Archivo cargado correctamente.',
      });
      if (fueNuevaVersion) {
        setNuevaVersionPara(null);
        setNvTitulo('');
        setNvCategoria('');
        setNvSucursalId('');
        setArchivoPendienteNv(null);
        if (fileInputNvRef.current) fileInputNvRef.current.value = '';
      } else {
        setTitulo('');
        setCategoriaNueva('');
        setSucursalSubida('');
        setArchivoPendientePrincipal(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      invalidateDocumentos();
    },
    onError: (e: unknown) => {
      const msg =
        typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setFeedback({
        type: 'error',
        message: typeof msg === 'string' ? msg : 'No se pudo subir el archivo.',
      });
    },
  });

  const patchMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      body: Parameters<typeof documentosApi.actualizarMetadata>[1];
      prevSucursalId: string | null;
    }) => documentosApi.actualizarMetadata(payload.id, payload.body),
    onSuccess: (_data, variables) => {
      const { body, prevSucursalId } = variables;
      const sedeCambio =
        body.sucursal_id !== undefined &&
        String(prevSucursalId ?? '') !== String(body.sucursal_id ?? '');
      setFeedback({
        type: 'success',
        message: sedeCambio
          ? 'Documento actualizado. Si no lo ve en la tabla, elija «Todas las sedes» en Alcance o cambie la sede activa arriba.'
          : 'Documento actualizado.',
      });
      setEditing(null);
      if (sedeCambio) setAlcanceSede('todas');
      invalidateDocumentos();
    },
    onError: (e: unknown) => {
      const msg =
        typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setFeedback({
        type: 'error',
        message: typeof msg === 'string' ? msg : 'No se pudo guardar los cambios.',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentosApi.eliminar(id),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Documento eliminado.' });
      invalidateDocumentos();
    },
    onError: () => {
      setFeedback({ type: 'error', message: 'No se pudo eliminar el documento.' });
    },
  });

  const certificarCuentaMutation = useMutation({
    mutationFn: () =>
      documentosApi.generarCertificacionCuenta({
        incluir_hash: true,
        solo_actuales: true,
      }),
    onSuccess: async ({ blob, suggestedFilename, codigoVerificacion }) => {
      setFeedback({
        type: 'success',
        message: codigoVerificacion
          ? `Certificación generada. Código de verificación: ${codigoVerificacion}. El PDF se descargó (no se guarda en la biblioteca).`
          : 'Certificación generada. El PDF se descargó (no se guarda en la biblioteca).',
      });
      void queryClient.invalidateQueries({ queryKey: ['tenant-documentos-auditoria'] });
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = suggestedFilename;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // no-op
      }
    },
    onError: (e: unknown) => {
      const msg = (() => {
        if (typeof e !== 'object' || e === null || !('response' in e)) return undefined;
        const data = (e as { response?: { data?: unknown } }).response?.data;
        if (typeof data === 'string' && data.trim()) return data;
        if (
          typeof data === 'object' &&
          data !== null &&
          'detail' in data &&
          typeof (data as { detail?: unknown }).detail === 'string'
        ) {
          return (data as { detail: string }).detail;
        }
        return undefined;
      })();
      setFeedback({
        type: 'error',
        message: typeof msg === 'string' ? msg : 'No se pudo generar la certificación en cuenta.',
      });
    },
  });

  const handleDownload = async (id: string, nombre: string) => {
    try {
      const blob = await documentosApi.descargarBlob(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setFeedback({ type: 'error', message: 'No se pudo descargar el archivo.' });
    }
  };

  const cerrarModalNuevaVersion = useCallback(() => {
    setNuevaVersionPara(null);
    setNvTitulo('');
    setNvCategoria('');
    setNvSucursalId('');
    setNvDragActivo(false);
    setArchivoPendienteNv(null);
    if (fileInputNvRef.current) fileInputNvRef.current.value = '';
  }, []);

  const abrirNuevaVersionDesdeFila = (row: TenantDocumento) => {
    setNuevaVersionPara(row);
    setNvTitulo(row.titulo);
    setNvCategoria(row.categoria ?? '');
    setNvSucursalId(row.sucursal_id ?? '');
    setArchivoPendienteNv(null);
    if (fileInputNvRef.current) fileInputNvRef.current.value = '';
    setArchivoPendientePrincipal(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setHistorialPara(null);
    setEditing(null);
    setDocAccionesMenuId(null);
  };

  const cerrarVistaPrevia = useCallback(() => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewDoc(null);
    setPreviewStatus('idle');
  }, []);

  const abrirVistaPrevia = async (doc: TenantDocumento) => {
    setHistorialPara(null);
    setEditing(null);
    cerrarModalNuevaVersion();
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewDoc(doc);

    // PDF, imágenes y texto: el navegador muestra el archivo original (descarga autenticada).
    if (mimePermiteVistaPreviaEnIframe(doc.mime_type)) {
      setPreviewStatus('loading');
      try {
        const blob = await documentosApi.descargarBlob(doc.id);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewStatus('ready');
      } catch {
        setPreviewStatus('error');
      }
      return;
    }

    // Office: el backend convierte a PDF (GET /preview genera el PDF si aún no existe).
    if (nombreArchivoEsOfficeConPreview(doc.nombre_archivo_original)) {
      setPreviewStatus('loading');
      try {
        const blob = await documentosApi.obtenerVistaPreviaPdf(doc.id);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewStatus('ready');
        void queryClient.invalidateQueries({ queryKey: ['tenant-documentos'] });
      } catch {
        setPreviewStatus('preview_pending');
      }
      return;
    }

    setPreviewStatus('unsupported');
  };

  useEffect(() => {
    const hayModal =
      Boolean(previewDoc) ||
      Boolean(historialPara) ||
      Boolean(editing && esAdmin) ||
      Boolean(nuevaVersionPara);
    if (!hayModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (previewDoc) cerrarVistaPrevia();
      else if (historialPara) setHistorialPara(null);
      else if (editing && esAdmin) setEditing(null);
      else if (nuevaVersionPara) cerrarModalNuevaVersion();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    previewDoc,
    historialPara,
    editing,
    esAdmin,
    nuevaVersionPara,
    cerrarVistaPrevia,
    cerrarModalNuevaVersion,
  ]);

  const openEdit = (row: TenantDocumento) => {
    setEditing(row);
    setEditTitulo(row.titulo);
    setEditCategoria(row.categoria ?? '');
    setEditSucursalId(row.sucursal_id ?? '');
    setHistorialPara(null);
    cerrarModalNuevaVersion();
  };

  const sedeLabel = (row: TenantDocumento) => {
    if (!row.sucursal_id) return 'Todas las sedes';
    return nombreSedePorId.get(row.sucursal_id) ?? row.sucursal_id.slice(0, 8) + '…';
  };

  const limpiarFiltros = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setCarpetaActiva(null);
    setAlcanceSede('todas');
    setSoloActuales(true);
  }, []);

  const asignarArchivoSeleccionado = (file: File | undefined, origen: 'principal' | 'nv') => {
    if (!file) return;
    const err = validarArchivoDocumento(file, maxDocumentoBytes);
    if (err) {
      setFeedback({ type: 'error', message: err });
      return;
    }
    if (origen === 'principal') {
      setArchivoPendientePrincipal(file);
      setTitulo((t) => (t.trim() ? t : tituloSugeridoDesdeNombre(file.name)));
    } else {
      setArchivoPendienteNv(file);
    }
  };

  const quitarArchivoPendientePrincipal = () => {
    setArchivoPendientePrincipal(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const quitarArchivoPendienteNv = () => {
    setArchivoPendienteNv(null);
    if (fileInputNvRef.current) fileInputNvRef.current.value = '';
  };

  const ejecutarSubidaPrincipal = () => {
    if (!archivoPendientePrincipal) {
      setFeedback({ type: 'error', message: 'Seleccione un archivo para subir.' });
      return;
    }
    if (!titulo.trim()) {
      setFeedback({ type: 'error', message: 'Indique un título para el documento antes de subir.' });
      return;
    }
    uploadMutation.mutate(archivoPendientePrincipal);
  };

  const ejecutarSubidaNv = () => {
    if (!nuevaVersionPara) return;
    if (!archivoPendienteNv) {
      setFeedback({ type: 'error', message: 'Seleccione un archivo.' });
      return;
    }
    if (!nvTitulo.trim()) {
      setFeedback({ type: 'error', message: 'Indique un título para el documento.' });
      return;
    }
    uploadMutation.mutate(archivoPendienteNv);
  };

  useEffect(() => {
    if (!docAccionesMenuId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-documento-menu]')) setDocAccionesMenuId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [docAccionesMenuId]);

  useEffect(() => {
    setAuditoriaPage(0);
  }, [auditoriaQDebounced, auditoriaAccion, auditoriaFechaInicio, auditoriaFechaFin, auditoriaSort, auditoriaPageSize]);

  useEffect(() => {
    const maxPage = Math.max(0, auditoriaTotalPages - 1);
    if (auditoriaPage > maxPage) {
      setAuditoriaPage(maxPage);
    }
  }, [auditoriaPage, auditoriaTotalPages]);

  const totalListado = documentosCarpetaActiva.length;

  return (
    <Layout title="Documentos del CDA">
      <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <FileStack className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Biblioteca documental</h1>
              <p className="text-sm text-slate-600">
                Versionado, categorías y sede. La descarga requiere sesión iniciada.
              </p>
            </div>
          </div>
          {esAdmin && (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={certificarCuentaMutation.isLoading}
              onClick={() => certificarCuentaMutation.mutate()}
            >
              <ShieldCheck className="w-4 h-4" />
              {certificarCuentaMutation.isLoading ? 'Generando certificación…' : 'Certificación en cuenta'}
            </button>
          )}
        </div>

        {feedback && (
          <div
            className={`rounded-xl px-4 py-3 text-sm ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {feedback.message}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                <Filter className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Filtros</h2>
            </div>
            <button
              type="button"
              className="text-sm text-primary-700 font-medium hover:underline"
              onClick={limpiarFiltros}
            >
              Limpiar filtros
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Buscar</label>
              <input
                type="search"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Título o nombre de archivo…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Carpeta (categoría)</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={carpetaActiva ?? ''}
                onChange={(e) => setCarpetaActiva(e.target.value || null)}
              >
                <option value="">Todas las carpetas</option>
                {carpetas.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.nombre} ({c.total})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Alcance por sede</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={alcanceSede}
                onChange={(e) => setAlcanceSede(e.target.value as AlcanceSedeFiltro)}
                disabled={!activeSucursalId}
              >
                <option value="todas">Todas las sedes</option>
                <option value="contexto" disabled={!activeSucursalId}>
                  Sede actual + generales
                </option>
                <option value="solo_sede" disabled={!activeSucursalId}>
                  Solo sede actual
                </option>
              </select>
              <details className="mt-1.5 text-xs text-slate-500">
                <summary className="cursor-pointer text-slate-600 hover:text-slate-800 select-none">
                  ¿Cómo funciona el alcance por sede?
                </summary>
                <p className="mt-2 leading-snug pl-0.5">
                  «Sede actual + generales» muestra documentos <strong>sin sede</strong> o de la{' '}
                  <strong>sede activa</strong> (selector en la barra). Si un archivo pertenece a otra sede, use
                  «Todas las sedes» o cambie la sede activa para verlo.
                </p>
              </details>
              {!activeSucursalId && (
                <p className="text-xs text-amber-700 mt-1">Selecciona sede en la barra para usar los otros dos modos.</p>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 mt-4 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={soloActuales}
              onChange={(e) => setSoloActuales(e.target.checked)}
            />
            Mostrar solo la versión vigente de cada documento
          </label>
        </section>

        {storageQuery.data && (
          <section
            className="rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm"
            aria-label="Uso de almacenamiento documental"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <p className="font-medium text-slate-800">
                Almacenamiento:{' '}
                <span className="tabular-nums">{formatBytes(storageQuery.data.used_bytes)}</span>
                {storageQuery.data.quota_bytes != null ? (
                  <>
                    {' '}
                    de <span className="tabular-nums">{formatBytes(storageQuery.data.quota_bytes)}</span>
                  </>
                ) : (
                  <span className="text-slate-500 font-normal"> (sin cuota fija)</span>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {storageQuery.data.documentos_count} archivo
                {storageQuery.data.documentos_count === 1 ? '' : 's'} · máx.{' '}
                {formatBytes(storageQuery.data.max_file_bytes)} por archivo
                {storageQuery.data.quota_source === 'tenant'
                  ? ' · cuota personalizada'
                  : storageQuery.data.quota_source === 'default'
                    ? ' · cuota estándar'
                    : storageQuery.data.quota_source === 'unlimited'
                      ? ' · sin tope'
                      : ''}
              </p>
            </div>
            {storageQuery.data.quota_bytes != null && storageQuery.data.used_pct != null && (
              <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    storageQuery.data.used_pct >= 95
                      ? 'bg-red-500'
                      : storageQuery.data.used_pct >= 80
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                  }`}
                  style={{ width: `${Math.min(100, storageQuery.data.used_pct)}%` }}
                />
              </div>
            )}
            {storageQuery.data.quota_bytes != null && (storageQuery.data.used_pct ?? 0) >= 95 && (
              <p className="mt-2 text-xs text-red-700">
                Cuota casi llena: elimine versiones antiguas o solicite ampliar el espacio.
              </p>
            )}
          </section>
        )}

        <section
          id="documentos-seccion-subida"
          className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 shadow-md shadow-slate-200/40 scroll-mt-4 overflow-hidden ring-1 ring-slate-100"
        >
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left bg-gradient-to-r from-primary-50/80 via-white to-slate-50/50 border-b border-slate-100/80 hover:from-primary-50 transition-colors"
            onClick={() => setSubidaSeccionAbierta((o) => !o)}
            aria-expanded={subidaSeccionAbierta}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary-600 text-white flex items-center justify-center shadow-md shadow-primary-600/25 shrink-0">
                <Upload className="w-5 h-5" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">Subir archivo</h2>
                <p className="text-xs text-slate-500 mt-0.5">Añada documentos a la biblioteca del CDA</p>
              </div>
            </div>
            {subidaSeccionAbierta ? (
              <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" aria-hidden />
            )}
          </button>
          {subidaSeccionAbierta && (
            <div className="px-5 pb-6 pt-5 space-y-5">
              <ol className="flex flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm">
                <li className="inline-flex items-center gap-2 rounded-full bg-primary-50 border border-primary-100/80 px-3 py-1.5 text-primary-900 font-medium shadow-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-[11px] text-white font-bold">
                    1
                  </span>
                  Archivo
                </li>
                <li className="hidden sm:inline text-slate-300 self-center">→</li>
                <li className="inline-flex items-center gap-2 rounded-full bg-slate-50 border border-slate-200/80 px-3 py-1.5 text-slate-700 font-medium">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[11px] text-slate-700 font-bold">
                    2
                  </span>
                  Datos
                </li>
                <li className="hidden sm:inline text-slate-300 self-center">→</li>
                <li className="inline-flex items-center gap-2 rounded-full bg-slate-50 border border-slate-200/80 px-3 py-1.5 text-slate-700 font-medium">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[11px] text-slate-700 font-bold">
                    3
                  </span>
                  Confirmar
                </li>
              </ol>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  asignarArchivoSeleccionado(e.target.files?.[0], 'principal');
                  e.target.value = '';
                }}
              />
              <div
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSubidaDragActivo(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSubidaDragActivo(false);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSubidaDragActivo(false);
                  asignarArchivoSeleccionado(e.dataTransfer.files?.[0], 'principal');
                }}
                onClick={() => !uploadMutation.isLoading && fileInputRef.current?.click()}
                className={`group relative rounded-2xl border-2 border-dashed px-5 py-8 text-center cursor-pointer transition-all duration-200 ${
                  subidaDragActivo
                    ? 'border-primary-500 bg-gradient-to-b from-primary-50 to-primary-100/30 scale-[1.01] shadow-lg shadow-primary-500/10'
                    : 'border-slate-200/90 bg-gradient-to-b from-slate-50/80 to-white hover:border-primary-300 hover:shadow-md hover:shadow-slate-200/50'
                } ${uploadMutation.isLoading ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-slate-100 text-primary-700 shadow-inner ring-4 ring-white/80 group-hover:from-primary-50 group-hover:to-primary-100/80 transition-colors">
                  <Upload className="w-8 h-8" strokeWidth={1.75} aria-hidden />
                </div>
                <p className="text-base text-slate-800 font-semibold">
                  Arrastre aquí o haga clic para elegir
                </p>
                <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                  PDF, Office, imágenes o texto · máx. {formatBytes(maxDocumentoBytes)} · no se envía hasta pulsar «Subir documento»
                </p>
                <p className="text-[11px] text-slate-400 mt-3 max-w-lg mx-auto">
                  Para reemplazar un documento ya cargado use «Más acciones → Subir nueva versión» en la tabla.
                </p>
              </div>
              {archivoPendientePrincipal && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/90 to-teal-50/40 px-4 py-3 text-sm shadow-sm ring-1 ring-emerald-100/50">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="shrink-0 mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-sm">
                      <FileCheck className="w-5 h-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800/90">
                        Listo para enviar
                      </p>
                      <p className="text-slate-800 font-medium truncate" title={archivoPendientePrincipal.name}>
                        {archivoPendientePrincipal.name}
                      </p>
                      <p className="text-xs text-emerald-800/70">{formatBytes(archivoPendientePrincipal.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 shrink-0 disabled:opacity-50 transition-colors"
                    disabled={uploadMutation.isLoading}
                    onClick={quitarArchivoPendientePrincipal}
                  >
                    Quitar
                  </button>
                </div>
              )}
              <div className="rounded-2xl border border-slate-100 bg-white/80 p-4 shadow-sm space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Metadatos</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Título <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-shadow"
                      placeholder="Ej. Manual de procedimientos 2026"
                      value={titulo}
                      onChange={(e) => setTitulo(e.target.value)}
                    />
                    <p className="text-xs text-slate-400 mt-1.5">
                      Si estaba vacío al elegir archivo, se sugirió el nombre del fichero.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Categoría (opcional)</label>
                    <input
                      type="text"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-shadow"
                      placeholder="Ej. Legal, RTM, RRHH…"
                      value={categoriaNueva}
                      onChange={(e) => setCategoriaNueva(e.target.value)}
                      list="documentos-categorias-sugerencias"
                    />
                    <datalist id="documentos-categorias-sugerencias">
                      {(categoriasQuery.data ?? []).map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Sede (opcional)</label>
                    <select
                      className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-shadow"
                      value={sucursalSubida}
                      onChange={(e) => setSucursalSubida(e.target.value)}
                    >
                      <option value="">Todas las sedes (visible según filtros)</option>
                      {sucursales.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary-600 text-white text-sm font-bold shadow-lg shadow-primary-600/25 hover:bg-primary-700 hover:shadow-primary-600/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all"
                  disabled={
                    !archivoPendientePrincipal ||
                    !titulo.trim() ||
                    uploadMutation.isLoading ||
                    Boolean(nuevaVersionPara)
                  }
                  onClick={ejecutarSubidaPrincipal}
                >
                  <Upload className="w-4 h-4 opacity-90" aria-hidden />
                  {uploadMutation.isLoading && !nuevaVersionPara && archivoSubiendoNombre
                    ? `Subiendo ${archivoSubiendoNombre}…`
                    : 'Subir documento'}
                </button>
                <button
                  type="button"
                  className="px-5 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 transition-colors"
                  disabled={uploadMutation.isLoading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Cambiar archivo
                </button>
              </div>
              <p className="text-xs text-slate-500 text-center sm:text-left rounded-xl bg-slate-50/80 border border-slate-100 px-4 py-3">
                <span className="text-slate-600">Tip:</span> los administradores pueden editar o eliminar documentos
                desde la tabla después de subirlos.
              </p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              {!carpetaActiva && (
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                  <Folder className="w-5 h-5" />
                </div>
              )}
              {carpetaActiva && (
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
                  <Folder className="w-5 h-5" />
                </div>
              )}
              <div className="min-w-0">
              {carpetaActiva && (
                <p className="text-xs text-slate-500 mb-0.5">
                  Documentos <span className="mx-1">/</span> <span className="text-slate-700">{nombreCarpetaActiva}</span>{' '}
                  <span className="mx-1 text-slate-300">·</span>
                  <span>{documentosCarpetaActiva.length} archivo{documentosCarpetaActiva.length === 1 ? '' : 's'}</span>
                </p>
              )}
              <h2 className="text-lg font-semibold text-slate-900">
                {carpetaActiva ? `Carpeta: ${nombreCarpetaActiva}` : 'Carpetas'}
              </h2>
              {listQuery.data && !listQuery.isLoading && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {carpetaActiva
                    ? `Mostrando ${totalListado} documento${totalListado === 1 ? '' : 's'} en esta carpeta`
                    : `Mostrando ${carpetas.length} carpeta${carpetas.length === 1 ? '' : 's'}`}
                </p>
              )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {carpetaActiva && (
                <>
                <select
                  className="text-xs rounded-lg border border-slate-200 px-2 py-1.5 text-slate-700 bg-white"
                  value={ordenCampo}
                  onChange={(e) => setOrdenCampo(e.target.value as OrdenDocumentosCampo)}
                  title="Campo de orden"
                >
                  <option value="fecha">Orden: Fecha</option>
                  <option value="titulo">Orden: Título</option>
                </select>
                <button
                  type="button"
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                  onClick={() => setOrdenDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  title="Cambiar dirección de orden"
                >
                  {ordenDir === 'asc' ? 'Asc' : 'Desc'}
                </button>
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                  <button
                    type="button"
                    className={`px-2 py-1 rounded-md text-xs inline-flex items-center gap-1 ${
                      vistaCarpeta === 'tabla' ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                    onClick={() => setVistaCarpeta('tabla')}
                    title="Vista de tabla"
                  >
                    <List className="w-3.5 h-3.5" />
                    Tabla
                  </button>
                  <button
                    type="button"
                    className={`px-2 py-1 rounded-md text-xs inline-flex items-center gap-1 ${
                      vistaCarpeta === 'tarjetas' ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                    onClick={() => setVistaCarpeta('tarjetas')}
                    title="Vista de tarjetas"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Tarjetas
                  </button>
                </div>
                </>
              )}
              {carpetaActiva && (
                <button
                  type="button"
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                  onClick={() => setCarpetaActiva(null)}
                >
                  Volver a carpetas
                </button>
              )}
              {listQuery.isFetching && <span className="text-xs text-slate-500">Actualizando…</span>}
            </div>
          </div>
          {listQuery.isError && (
            <p className="p-5 text-sm text-red-600">No se pudo cargar el listado. Intenta de nuevo.</p>
          )}
          {listQuery.data && listQuery.data.length === 0 && (
            <div className="p-8 text-center text-slate-600 text-sm space-y-3 max-w-md mx-auto">
              <p>No hay documentos con estos filtros.</p>
              <ol className="text-left text-xs text-slate-600 space-y-1.5 list-decimal list-inside border border-slate-100 rounded-lg p-4 bg-slate-50/80">
                <li>Abra «Subir archivo» y elija un PDF, Word u otro formato admitido.</li>
                <li>
                  Elija el archivo, complete el título y pulse <strong>Subir documento</strong> (la subida no es
                  automática).
                </li>
                <li>Use la tabla para descargar, vista previa o subir una nueva versión (menú de cada fila).</li>
              </ol>
            </div>
          )}
          {listQuery.data && listQuery.data.length > 0 && !carpetaActiva && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {carpetas.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCarpetaActiva(c.key)}
                  className="text-left rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-3 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <Folder className="w-4 h-4 text-amber-600" />
                    <p className="font-medium text-slate-900 truncate">{c.nombre}</p>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {c.total} documento{c.total === 1 ? '' : 's'}
                  </p>
                </button>
              ))}
            </div>
          )}
          {listQuery.data && listQuery.data.length > 0 && carpetaActiva && documentosCarpetaActiva.length === 0 && (
            <div className="p-8 text-center text-slate-600 text-sm">
              No hay documentos en esta carpeta con los filtros actuales.
            </div>
          )}
          {listQuery.data && listQuery.data.length > 0 && carpetaActiva && documentosCarpetaActiva.length > 0 && (
            <>
            {vistaCarpeta === 'tabla' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium w-14">Ver.</th>
                    <th className="px-4 py-3 font-medium">Título</th>
                    <th className="px-4 py-3 font-medium">Categoría</th>
                    <th className="px-4 py-3 font-medium">Sede</th>
                    <th className="px-4 py-3 font-medium">Archivo</th>
                    <th className="px-4 py-3 font-medium w-28">Tipo</th>
                    <th className="px-4 py-3 font-medium">Tamaño</th>
                    <th className="px-4 py-3 font-medium">Creado</th>
                    <th className="px-4 py-3 font-medium min-w-[10rem]">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documentosCarpetaActiva.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-800">
                          v{row.version_seq}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{row.titulo}</td>
                      <td className="px-4 py-3 text-slate-600">{row.categoria ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{sedeLabel(row)}</td>
                      <td
                        className="px-4 py-3 text-slate-700 max-w-[220px] truncate"
                        title={row.nombre_archivo_original}
                      >
                        {row.nombre_archivo_original}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span
                          className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800"
                          title={row.mime_type}
                        >
                          {etiquetaTipoArchivo(row.mime_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatBytes(row.tamano_bytes)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {new Date(row.created_at).toLocaleString('es-CO')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-0.5">
                          <button
                            type="button"
                            className="p-2 rounded-lg text-primary-600 hover:bg-primary-50"
                            title="Descargar"
                            aria-label={`Descargar ${row.titulo}`}
                            onClick={() => void handleDownload(row.id, row.nombre_archivo_original)}
                          >
                            <Download className="w-4 h-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50"
                            title="Vista previa"
                            aria-label={`Vista previa de ${row.titulo}`}
                            onClick={() => void abrirVistaPrevia(row)}
                          >
                            <Eye className="w-4 h-4" aria-hidden />
                          </button>
                          <div className="relative inline-block text-left" data-documento-menu>
                            <button
                              type="button"
                              className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
                              title="Más acciones"
                              aria-label={`Más acciones: ${row.titulo}`}
                              aria-expanded={docAccionesMenuId === row.id}
                              aria-haspopup="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDocAccionesMenuId((id) => (id === row.id ? null : row.id));
                              }}
                            >
                              <MoreHorizontal className="w-4 h-4" aria-hidden />
                            </button>
                            {docAccionesMenuId === row.id && (
                              <ul
                                className="absolute right-0 z-50 mt-1 min-w-[13rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                                role="menu"
                              >
                                <li role="none">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="w-full text-left px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 flex items-center gap-2"
                                    onClick={() => {
                                      setHistorialPara(row);
                                      setEditing(null);
                                      cerrarModalNuevaVersion();
                                      setDocAccionesMenuId(null);
                                    }}
                                  >
                                    <History className="w-4 h-4 shrink-0 text-slate-500" aria-hidden />
                                    Historial de versiones
                                  </button>
                                </li>
                                <li role="none">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="w-full text-left px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 flex items-center gap-2"
                                    onClick={() => {
                                      abrirNuevaVersionDesdeFila(row);
                                    }}
                                  >
                                    <Layers className="w-4 h-4 shrink-0 text-teal-700" aria-hidden />
                                    Subir nueva versión
                                  </button>
                                </li>
                                {esAdmin && (
                                  <>
                                    <li role="separator" className="my-1 border-t border-slate-100" />
                                    <li role="none">
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="w-full text-left px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 flex items-center gap-2"
                                        onClick={() => {
                                          openEdit(row);
                                          setDocAccionesMenuId(null);
                                        }}
                                      >
                                        <Pencil className="w-4 h-4 shrink-0 text-slate-500" aria-hidden />
                                        Editar metadatos
                                      </button>
                                    </li>
                                    <li role="none">
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50 flex items-center gap-2 disabled:opacity-50"
                                        disabled={deleteMutation.isLoading}
                                        onClick={() => {
                                          setDocAccionesMenuId(null);
                                          if (
                                            window.confirm(
                                              '¿Eliminar esta versión? Si era la actual, la versión anterior pasará a ser la vigente.'
                                            )
                                          ) {
                                            deleteMutation.mutate(row.id);
                                          }
                                        }}
                                      >
                                        <Trash2 className="w-4 h-4 shrink-0" aria-hidden />
                                        Eliminar esta versión
                                      </button>
                                    </li>
                                  </>
                                )}
                              </ul>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            ) : (
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {documentosCarpetaActiva.map((row) => (
                  <article key={row.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${claseColorTipoArchivo(row.mime_type)}`}
                            title={row.mime_type}
                          >
                            <IconoTipoArchivo mime={row.mime_type} />
                          </span>
                          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${claseColorTipoArchivo(row.mime_type)}`}>
                            {etiquetaTipoArchivo(row.mime_type)}
                          </span>
                        </div>
                        <p className="font-semibold text-slate-900 truncate">{row.titulo}</p>
                        <p className="text-xs text-slate-500 truncate" title={row.nombre_archivo_original}>
                          {row.nombre_archivo_original}
                        </p>
                      </div>
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700 shrink-0">
                        v{row.version_seq}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-600">
                      <p>Tipo MIME: {row.mime_type}</p>
                      <p>Sede: {sedeLabel(row)}</p>
                      <p>Tamaño: {formatBytes(row.tamano_bytes)}</p>
                      <p>Creado: {new Date(row.created_at).toLocaleString('es-CO')}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        className="p-2 rounded-lg text-primary-600 hover:bg-primary-50"
                        title="Descargar"
                        onClick={() => void handleDownload(row.id, row.nombre_archivo_original)}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50"
                        title="Vista previa"
                        onClick={() => void abrirVistaPrevia(row)}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
                        title="Historial de versiones"
                        onClick={() => {
                          setHistorialPara(row);
                          setEditing(null);
                          cerrarModalNuevaVersion();
                        }}
                      >
                        <History className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-lg text-teal-700 hover:bg-teal-50"
                        title="Subir nueva versión"
                        onClick={() => abrirNuevaVersionDesdeFila(row)}
                      >
                        <Layers className="w-4 h-4" />
                      </button>
                      {esAdmin && (
                        <>
                          <button
                            type="button"
                            className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
                            title="Editar metadatos"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="p-2 rounded-lg text-red-700 hover:bg-red-50"
                            title="Eliminar versión"
                            disabled={deleteMutation.isLoading}
                            onClick={() => {
                              if (
                                window.confirm(
                                  '¿Eliminar esta versión? Si era la actual, la versión anterior pasará a ser la vigente.'
                                )
                              ) {
                                deleteMutation.mutate(row.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            </>
          )}
        </section>

        {esAdmin && (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                  <ScrollText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">Registro de actividad</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Subidas, descargas, cambios de metadatos y eliminaciones. Util para trazabilidad (NTC 5385 /
                    buenas practicas de seguridad de la informacion).
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
                disabled={auditoriaQuery.isFetching}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['tenant-documentos-auditoria'] })}
              >
                <RefreshCw className={`w-4 h-4 ${auditoriaQuery.isFetching ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
                <input
                  type="search"
                  className="xl:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Buscar usuario o detalle…"
                  value={auditoriaQ}
                  onChange={(e) => setAuditoriaQ(e.target.value)}
                />
                <select
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={auditoriaAccion}
                  onChange={(e) => setAuditoriaAccion(e.target.value)}
                >
                  <option value="">Todas las acciones</option>
                  <option value="subir">Subida</option>
                  <option value="descargar">Descarga</option>
                  <option value="metadata_update">Cambio metadatos</option>
                  <option value="eliminar">Eliminación</option>
                  <option value="certificacion_cuenta">Certificación en cuenta</option>
                </select>
                <input
                  type="date"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={auditoriaFechaInicio}
                  onChange={(e) => setAuditoriaFechaInicio(e.target.value)}
                  title="Desde"
                />
                <input
                  type="date"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={auditoriaFechaFin}
                  onChange={(e) => setAuditoriaFechaFin(e.target.value)}
                  title="Hasta"
                />
                <div className="flex gap-2">
                  <select
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={auditoriaSort}
                    onChange={(e) => setAuditoriaSort(e.target.value as 'asc' | 'desc')}
                  >
                    <option value="desc">Más reciente</option>
                    <option value="asc">Más antiguo</option>
                  </select>
                  <select
                    className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                    value={auditoriaPageSize}
                    onChange={(e) => setAuditoriaPageSize(Number(e.target.value))}
                    title="Filas por página"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
            </div>
            {auditoriaQuery.isError && (
              <p className="p-5 text-sm text-red-600">
                No se pudo cargar el registro de actividad. Verifique que su usuario sea administrador.
              </p>
            )}
            {auditoriaQuery.data && auditoriaItems.length === 0 && (
              <p className="p-8 text-center text-slate-600 text-sm">Aún no hay eventos registrados.</p>
            )}
            {auditoriaQuery.data && auditoriaItems.length > 0 && (
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 font-medium">Fecha</th>
                      <th className="px-4 py-2 font-medium">Acción</th>
                      <th className="px-4 py-2 font-medium">Usuario</th>
                      <th className="px-4 py-2 font-medium">Documento (id)</th>
                      <th className="px-4 py-2 font-medium">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditoriaItems.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                          {new Date(ev.created_at).toLocaleString('es-CO')}
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                            {etiquetaAccionAuditoria(ev.accion)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-slate-700">
                          {ev.usuario_nombre?.trim() ? (
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 truncate" title={ev.usuario_nombre}>
                                {ev.usuario_nombre}
                              </div>
                              {ev.usuario_email?.trim() ? (
                                <div className="text-xs text-slate-500 truncate" title={ev.usuario_email}>
                                  {ev.usuario_email}
                                </div>
                              ) : null}
                            </div>
                          ) : ev.usuario_id ? (
                            <span
                              className="font-mono text-xs text-slate-600"
                              title={ev.usuario_id}
                            >{`${ev.usuario_id.slice(0, 8)}…`}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">
                          {ev.documento_id ? `${ev.documento_id.slice(0, 8)}…` : '—'}
                        </td>
                        <td className="px-4 py-2 text-slate-700 max-w-md truncate" title={ev.detalle ?? ''}>
                          {ev.detalle ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-5 py-3 border-t border-slate-100 bg-white flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Página {Math.min(auditoriaPage + 1, auditoriaTotalPages)} de {auditoriaTotalPages}
                {auditoriaQuery.data
                  ? ` · ${auditoriaItems.length} fila${auditoriaItems.length === 1 ? '' : 's'} (total ${auditoriaTotal})`
                  : ''}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  disabled={auditoriaPage === 0 || auditoriaQuery.isFetching}
                  onClick={() => setAuditoriaPage((p) => Math.max(0, p - 1))}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  disabled={auditoriaQuery.isFetching || (auditoriaPage + 1) >= auditoriaTotalPages}
                  onClick={() => setAuditoriaPage((p) => p + 1)}
                >
                  Siguiente
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      {historialPara && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="documentos-historial-titulo"
          onClick={() => setHistorialPara(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
              <h2
                id="documentos-historial-titulo"
                className="text-lg font-semibold text-slate-900 truncate min-w-0 pr-2"
              >
                Historial de versiones — {historialPara.titulo}
              </h2>
              <button
                type="button"
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/80 shrink-0"
                aria-label="Cerrar historial"
                onClick={() => setHistorialPara(null)}
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 min-h-0">
              {versionesQuery.isLoading && (
                <p className="text-sm text-slate-600">Cargando versiones…</p>
              )}
              {versionesQuery.isError && (
                <p className="text-sm text-red-600">No se pudo cargar el historial.</p>
              )}
              {versionesQuery.data && versionesQuery.data.length > 0 && (
                <div className="overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">Ver.</th>
                        <th className="px-3 py-2 font-medium">Archivo</th>
                        <th className="px-3 py-2 font-medium">Tamaño</th>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium w-24"> </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {versionesQuery.data.map((v) => (
                        <tr key={v.id}>
                          <td className="px-3 py-2 font-mono text-slate-800">v{v.version_seq}</td>
                          <td className="px-3 py-2 text-slate-700">{v.nombre_archivo_original}</td>
                          <td className="px-3 py-2 text-slate-600">{formatBytes(v.tamano_bytes)}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {new Date(v.created_at).toLocaleString('es-CO')}
                          </td>
                          <td className="px-3 py-2">
                            {v.es_version_actual ? (
                              <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                                Actual
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500">Anterior</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-primary-600 text-xs font-medium hover:underline"
                              onClick={() => void handleDownload(v.id, v.nombre_archivo_original)}
                            >
                              Descargar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {versionesQuery.data && versionesQuery.data.length === 0 && !versionesQuery.isLoading && (
                <p className="text-sm text-slate-600">No hay versiones en el historial.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {editing && esAdmin && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="documentos-editar-titulo"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <h2 id="documentos-editar-titulo" className="text-lg font-semibold text-slate-900">
                Editar metadatos
              </h2>
              <button
                type="button"
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/80"
                aria-label="Cerrar"
                onClick={() => setEditing(null)}
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Título</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editTitulo}
                  onChange={(e) => setEditTitulo(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Categoría</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Vacío = sin categoría"
                  value={editCategoria}
                  onChange={(e) => setEditCategoria(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Sede</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editSucursalId}
                  onChange={(e) => setEditSucursalId(e.target.value)}
                >
                  <option value="">Todas las sedes</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2 pt-2 justify-end">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm"
                  onClick={() => setEditing(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50"
                  disabled={patchMutation.isLoading || !editTitulo.trim()}
                  onClick={() => {
                    const body: Parameters<typeof documentosApi.actualizarMetadata>[1] = {
                      titulo: editTitulo.trim(),
                    };
                    body.categoria = editCategoria.trim() ? editCategoria.trim() : null;
                    body.sucursal_id = editSucursalId.trim() || null;
                    patchMutation.mutate({
                      id: editing.id,
                      body,
                      prevSucursalId: editing.sucursal_id,
                    });
                  }}
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {nuevaVersionPara && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="documentos-nv-titulo"
          onClick={cerrarModalNuevaVersion}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
              <div className="min-w-0">
                <h2 id="documentos-nv-titulo" className="text-lg font-semibold text-slate-900">
                  Subir nueva versión
                </h2>
                <p className="text-xs text-slate-500 truncate mt-0.5" title={nuevaVersionPara.titulo}>
                  {nuevaVersionPara.titulo}
                </p>
              </div>
              <button
                type="button"
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/80 shrink-0"
                aria-label="Cerrar"
                onClick={cerrarModalNuevaVersion}
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-600">
                El nuevo archivo reemplazará la versión actual; las anteriores quedan en el historial. La subida no
                comienza hasta que pulse <strong>Subir nueva versión</strong>.
              </p>
              <input
                ref={fileInputNvRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  asignarArchivoSeleccionado(e.target.files?.[0], 'nv');
                  e.target.value = '';
                }}
              />
              <div
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputNvRef.current?.click();
                  }
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setNvDragActivo(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setNvDragActivo(false);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setNvDragActivo(false);
                  asignarArchivoSeleccionado(e.dataTransfer.files?.[0], 'nv');
                }}
                onClick={() => !uploadMutation.isLoading && fileInputNvRef.current?.click()}
                className={`rounded-xl border-2 border-dashed px-4 py-5 text-center cursor-pointer transition-colors ${
                  nvDragActivo
                    ? 'border-primary-500 bg-primary-50/50'
                    : 'border-slate-200 bg-slate-50/50 hover:border-slate-300'
                } ${uploadMutation.isLoading ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <Upload className="w-7 h-7 text-slate-400 mx-auto mb-2" aria-hidden />
                <p className="text-sm text-slate-700 font-medium">Paso 1: elija el archivo (aún no se sube)</p>
                <p className="text-xs text-slate-500 mt-1">Máx. 25 MB · PDF, Office, imágenes o texto</p>
              </div>
              {archivoPendienteNv && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-sm">
                  <span className="text-slate-800 min-w-0 truncate" title={archivoPendienteNv.name}>
                    <span className="font-medium text-emerald-900">Archivo:</span> {archivoPendienteNv.name} (
                    {formatBytes(archivoPendienteNv.size)})
                  </span>
                  <button
                    type="button"
                    className="text-sm font-medium text-red-700 hover:underline shrink-0 disabled:opacity-50"
                    disabled={uploadMutation.isLoading}
                    onClick={quitarArchivoPendienteNv}
                  >
                    Quitar
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Título <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={nvTitulo}
                    onChange={(e) => setNvTitulo(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Categoría (opcional)</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={nvCategoria}
                    onChange={(e) => setNvCategoria(e.target.value)}
                    list="documentos-categorias-sugerencias"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Sede (opcional)</label>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={nvSucursalId}
                    onChange={(e) => setNvSucursalId(e.target.value)}
                  >
                    <option value="">Todas las sedes</option>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm"
                  disabled={uploadMutation.isLoading}
                  onClick={cerrarModalNuevaVersion}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="px-5 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={
                    !archivoPendienteNv ||
                    !nvTitulo.trim() ||
                    uploadMutation.isLoading ||
                    !nuevaVersionPara
                  }
                  onClick={ejecutarSubidaNv}
                >
                  {uploadMutation.isLoading && nuevaVersionPara && archivoSubiendoNombre
                    ? `Subiendo ${archivoSubiendoNombre}…`
                    : 'Subir nueva versión'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewDoc && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="documentos-preview-title"
          onClick={cerrarVistaPrevia}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <div className="min-w-0">
                <h2 id="documentos-preview-title" className="text-sm font-semibold text-slate-900 truncate">
                  {previewDoc.titulo}
                </h2>
                <p className="text-xs text-slate-500 truncate">{previewDoc.nombre_archivo_original}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  onClick={() => void handleDownload(previewDoc.id, previewDoc.nombre_archivo_original)}
                >
                  Descargar
                </button>
                <button
                  type="button"
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/80"
                  title="Cerrar"
                  onClick={cerrarVistaPrevia}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-[50vh] bg-slate-100 relative">
              {previewStatus === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-600">
                  Cargando vista previa…
                </div>
              )}
              {previewStatus === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-red-700">
                  No se pudo cargar el archivo. Intente descargarlo.
                </div>
              )}
              {previewStatus === 'preview_pending' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-700">
                  <p>
                    La vista previa PDF se genera en el servidor al subir el archivo (requiere LibreOffice).
                    Espere unos segundos, pulse &quot;Actualizar&quot; en el listado y vuelva a abrir la vista
                    previa. Si nunca aparece, configure DOCUMENTOS_LIBREOFFICE_PATH en el backend o descargue el
                    archivo.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50"
                      onClick={() => void queryClient.invalidateQueries({ queryKey: ['tenant-documentos'] })}
                    >
                      Actualizar listado
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg border border-primary-200 text-primary-800 text-sm font-medium hover:bg-primary-50 disabled:opacity-50"
                      disabled={listQuery.isFetching}
                      onClick={() => {
                        const fresh = listQuery.data?.find((d) => d.id === previewDoc.id);
                        if (fresh) void abrirVistaPrevia(fresh);
                      }}
                    >
                      Probar de nuevo
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium"
                      onClick={() => void handleDownload(previewDoc.id, previewDoc.nombre_archivo_original)}
                    >
                      Descargar archivo
                    </button>
                  </div>
                </div>
              )}
              {previewStatus === 'unsupported' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-700">
                  <p>
                    No hay vista previa integrada para este tipo de archivo ({previewDoc.mime_type}). Puede
                    descargarlo y abrirlo en su equipo.
                  </p>
                  <button
                    type="button"
                    className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium"
                    onClick={() => void handleDownload(previewDoc.id, previewDoc.nombre_archivo_original)}
                  >
                    Descargar archivo
                  </button>
                </div>
              )}
              {previewStatus === 'ready' && previewUrl && (
                <iframe
                  title={`Vista previa: ${previewDoc.titulo}`}
                  src={previewUrl}
                  className="w-full h-[min(75vh,720px)] border-0 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
