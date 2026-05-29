import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, DollarSign, CheckCircle2, RotateCcw, Search, X, Calendar, CalendarDays, CalendarRange, BarChart3, Camera, Car, Edit, AlertTriangle, Download, ChevronDown, ChevronUp, FileText, CircleDot } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import CapturaFotos from '../components/CapturaFotos';
import ErrorBoundary from '../components/ErrorBoundary';
import FactusMunicipalitySearchField from '../components/FactusMunicipalitySearchField';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { configApi } from '../api/config';
import { vehiculosApi, type TarifaCalculada } from '../api/vehiculos';
import { tarifasApi } from '../api/tarifas';
import type { VehiculoRegistro, VehiculoConsultaRunt, Usuario, ReinspeccionElegibilidad } from '../types';
import { formatCOP } from '../utils/formatNumber';

type SnNoNa = 'si' | 'no' | 'na' | '';
type SnNo = 'si' | 'no' | '';
const DEFAULT_FORMAT_VERSION = 'RTM-01-FR v13';

type PresionLlantaItem = {
  posicion_id: string;
  posicion_label: string;
  psi: string;
  is_repuesto: boolean;
};

type RecepcionPreparacionChecklist = {
  limpieza_descargado: SnNoNa;
  licencia_y_confrontacion_datos: SnNoNa;
  conversion_gas_vigente: SnNoNa;
  presion_llantas_adecuada_cda: SnNoNa;
  tapa_o_capuchones_valvula: SnNoNa;
  niveles_fluidos_visibles: SnNoNa;
  sin_accesorios_que_impidan_acople: SnNoNa;
  retiro_elementos_cabina_carga: SnNoNa;
  liberacion_carga_para_inspeccion: SnNoNa;
  tablero_instrumentos_ok: SnNoNa;
  cinturones_sillas_accesos_ok: SnNoNa;
  combustible_suficiente: SnNoNa;
  placa_identificacion_legible: SnNoNa;
  llanta_repuesto_accesible: SnNoNa;
  luces_funcionales: SnNoNa;
  extintor_central_funcional_moto: SnNoNa;
  adaptaciones_discapacidad: SnNoNa;
  viable_ingreso_linea: SnNo;
};

type RecepcionAutorizacionesDatos = {
  contacto_fuerza_comercial: SnNo;
  contacto_encuestas_confirmacion: SnNo;
  contacto_recordatorio_rtm_soat: SnNo;
};

type FirmaDigital = {
  data_url: string;
  signed_at: string;
  signer_name: string;
};

type RecepcionFormatoExtra = {
  version: string;
  fecha_formato: string;
  no_inspeccion: string;
  tipo_vehiculo_formato: string;
  datos_tecnicos: {
    clase_vehiculo: string;
    marca: string;
    linea: string;
    modelo: string;
    color: string;
    servicio: string;
    tipo_combustible: string;
    carga_pasajeros: string;
    ensenanza: SnNo;
    kilometraje: string;
    blindado: SnNoNa;
    polarizado: SnNoNa;
    cilindraje: string;
    presion_inflado: string;
    presion_llantas: PresionLlantaItem[];
    observaciones_tecnicas: string;
  };
  preparacion_checklist: {
    limpieza_descargado: SnNoNa;
    licencia_y_confrontacion_datos: SnNoNa;
    conversion_gas_vigente: SnNoNa;
    presion_llantas_adecuada_cda: SnNoNa;
    tapa_o_capuchones_valvula: SnNoNa;
    niveles_fluidos_visibles: SnNoNa;
    sin_accesorios_que_impidan_acople: SnNoNa;
    retiro_elementos_cabina_carga: SnNoNa;
    liberacion_carga_para_inspeccion: SnNoNa;
    tablero_instrumentos_ok: SnNoNa;
    cinturones_sillas_accesos_ok: SnNoNa;
    combustible_suficiente: SnNoNa;
    placa_identificacion_legible: SnNoNa;
    llanta_repuesto_accesible: SnNoNa;
    luces_funcionales: SnNoNa;
    extintor_central_funcional_moto: SnNoNa;
    adaptaciones_discapacidad: SnNoNa;
    viable_ingreso_linea: SnNo;
  };
  observaciones_recepcion: string;
  titular_datos: {
    nombre_apellidos: string;
    numero_documento: string;
    celular_telefono: string;
    email: string;
    ciudad_direccion: string;
  };
  pre_revision: {
    firma_operario: FirmaDigital | null;
  };
  autorizaciones_datos: {
    contacto_fuerza_comercial: SnNo;
    contacto_encuestas_confirmacion: SnNo;
    contacto_recordatorio_rtm_soat: SnNo;
  };
  firma_titular: FirmaDigital | null;
};

const createDefaultFormatoExtra = (): RecepcionFormatoExtra => ({
  version: DEFAULT_FORMAT_VERSION,
  fecha_formato: '',
  no_inspeccion: '',
  tipo_vehiculo_formato: '',
  datos_tecnicos: {
    clase_vehiculo: '',
    marca: '',
    linea: '',
    modelo: '',
    color: '',
    servicio: '',
    tipo_combustible: '',
    carga_pasajeros: '',
    ensenanza: '',
    cilindraje: '',
    kilometraje: '',
    blindado: '',
    polarizado: '',
    presion_inflado: '',
    presion_llantas: [],
    observaciones_tecnicas: '',
  },
  preparacion_checklist: {
    limpieza_descargado: '',
    licencia_y_confrontacion_datos: '',
    conversion_gas_vigente: '',
    presion_llantas_adecuada_cda: '',
    tapa_o_capuchones_valvula: '',
    niveles_fluidos_visibles: '',
    sin_accesorios_que_impidan_acople: '',
    retiro_elementos_cabina_carga: '',
    liberacion_carga_para_inspeccion: '',
    tablero_instrumentos_ok: '',
    cinturones_sillas_accesos_ok: '',
    combustible_suficiente: '',
    placa_identificacion_legible: '',
    llanta_repuesto_accesible: '',
    luces_funcionales: '',
    extintor_central_funcional_moto: '',
    adaptaciones_discapacidad: '',
    viable_ingreso_linea: '',
  },
  observaciones_recepcion: '',
  titular_datos: {
    nombre_apellidos: '',
    numero_documento: '',
    celular_telefono: '',
    email: '',
    ciudad_direccion: '',
  },
  pre_revision: {
    firma_operario: null,
  },
  autorizaciones_datos: {
    contacto_fuerza_comercial: '',
    contacto_encuestas_confirmacion: '',
    contacto_recordatorio_rtm_soat: '',
  },
  firma_titular: null,
});

const buildPreparacionItems = (tenantDisplayName: string): Array<{ key: keyof RecepcionPreparacionChecklist; label: string }> => [
  { key: 'limpieza_descargado', label: '¿El vehículo se encuentra en un estado de limpieza adecuado y descargado? (peso adicional que no hace parte del vehículo) y, si aplica, con la alarma desactivada?' },
  { key: 'licencia_y_confrontacion_datos', label: '¿Se presenta la licencia de tránsito (tarjeta de propiedad) del vehículo? ¿La confrontación de los datos: Placa – Marca - Clase – Modelo – Servicio – Color con el vehículo, ¿es correcto?' },
  { key: 'conversion_gas_vigente', label: 'El vehículo (si aplica), cuenta con certificado de conversión a gas VIGENTE (registrar fecha en el evento que aplique)' },
  { key: 'tapa_o_capuchones_valvula', label: '¿El vehículo se presenta sin copas o tapacubos ( o slider) que cubran el rin y/o los pernos o tuercas?' },
  { key: 'presion_llantas_adecuada_cda', label: `¿La presión de inflado de las llantas son adecuadas de acuerdo con las disposiciones de ${tenantDisplayName.toUpperCase()} (ver procedimiento de pre-revisión y post-revisión RTM-04-PR)` },
  { key: 'sin_accesorios_que_impidan_acople', label: '¿La motocicleta NO cuenta con accesorios que impida la ubicación adecuada del acople (si aplica) y la introducción de la sonda de muestreo?' },
  { key: 'niveles_fluidos_visibles', label: 'Los depósitos de los niveles de líquido de frenos son visibles (que no presenten alteraciones que no permitan inspeccionar el nivel en las líneas de inspección).' },
  { key: 'liberacion_carga_para_inspeccion', label: 'Si aplica, se deja libre la carpa con el objetivo de verificar las puertas y compuertas de carga para brindar las condiciones necesarias para realizar la inspección a conformidad.' },
  { key: 'retiro_elementos_cabina_carga', label: 'Se retiran candados (o dejarlos abiertos) o seguros de la(s) cubierta(s) de la(s) batería(s), puertas, compuertas, cabina basculante (cuando aplique), tapa de combustible y el brazo utilizado como soporte exterior de la llanta de repuesto (si aplica), así como amarres, cintas, forros, fundas, los protectores o tapas de las exploradoras y demás elementos que protejan parte del vehículo para asegurarse que se tenga acceso a los mismos y brindar las condiciones necesarias para realizar la inspección a conformidad.' },
  { key: 'viable_ingreso_linea', label: '¿El vehículo se presenta sin fugas de combustible, aceite, líquidos de frenos, líquido refrigerante (si aplica), con la tapa del combustible y no cuenta con otras condiciones que impidan que se realicen las pruebas de manera segura (ver procedimiento de pre-revisión y post-revisión RTM-04-PR)' },
  { key: 'tablero_instrumentos_ok', label: 'El tablero de instrumentos se encuentra en un estado tal que permita visualizar los indicadores de falla del motor, presión de aceite y temperatura.' },
  { key: 'cinturones_sillas_accesos_ok', label: '¿Los cinturones de seguridad, las sillas / asientos son de fácil acceso, para permitir su verificación en las líneas de inspección?' },
  { key: 'combustible_suficiente', label: 'El vehículo cuenta con el combustible suficiente para el desarrollo de la inspección' },
  { key: 'placa_identificacion_legible', label: '¿La placa del vehículo está en buen estado y posicionamiento que garantice su plena identificación?' },
  { key: 'llanta_repuesto_accesible', label: 'En vehículos en los que la llanta de repuesto vaya fijada en el soporte exterior, se retira el protector, seguro o forro de la llanta de repuesto. En vehículos tipo sedán/coupé se deja libre la llanta de repuesto para que sea accesible a los inspectores durante la inspección.' },
  { key: 'luces_funcionales', label: '¿El vehículo cuenta con al menos una luz funcional?' },
  { key: 'extintor_central_funcional_moto', label: '¿Si es una motocicleta automática, ¿cuenta con el soporte central funcional?' },
  { key: 'adaptaciones_discapacidad', label: '¿El vehículo cuenta con adaptaciones para personas con discapacidad?' },
];

const AUTORIZACION_ITEMS: Array<{ key: keyof RecepcionAutorizacionesDatos; label: string }> = [
  { key: 'contacto_fuerza_comercial', label: 'Autoriza contacto de fuerza comercial / investigación de mercados' },
  { key: 'contacto_encuestas_confirmacion', label: 'Autoriza contacto para encuestas y confirmación de datos' },
  { key: 'contacto_recordatorio_rtm_soat', label: 'Autoriza recordatorio de RTM y SOAT' },
];

const SERVICIO_OPTIONS = ['PARTICULAR', 'PUBLICO', 'OFICIAL', 'EXTRANJERO', 'DIPLOMATICO', 'TEMPORAL'] as const;
const TIPO_LLAYOUT = {
  moto: [
    { id: 'moto_delantera', label: 'Delantera', is_repuesto: false },
    { id: 'moto_trasera', label: 'Trasera', is_repuesto: false },
  ],
  liviano: [
    { id: 'liv_del_izq', label: 'Delantera izquierda', is_repuesto: false },
    { id: 'liv_del_der', label: 'Delantera derecha', is_repuesto: false },
    { id: 'liv_tra_izq', label: 'Trasera izquierda', is_repuesto: false },
    { id: 'liv_tra_der', label: 'Trasera derecha', is_repuesto: false },
    { id: 'liv_rep_1', label: 'Repuesto', is_repuesto: true },
  ],
  pesado: [
    { id: 'pes_e1_izq', label: 'Eje 1 izquierda', is_repuesto: false },
    { id: 'pes_e1_der', label: 'Eje 1 derecha', is_repuesto: false },
    { id: 'pes_e2_izq_ext', label: 'Eje 2 izquierda externa', is_repuesto: false },
    { id: 'pes_e2_izq_int', label: 'Eje 2 izquierda interna', is_repuesto: false },
    { id: 'pes_e2_der_int', label: 'Eje 2 derecha interna', is_repuesto: false },
    { id: 'pes_e2_der_ext', label: 'Eje 2 derecha externa', is_repuesto: false },
    { id: 'pes_e3_izq_ext', label: 'Eje 3 izquierda externa', is_repuesto: false },
    { id: 'pes_e3_izq_int', label: 'Eje 3 izquierda interna', is_repuesto: false },
    { id: 'pes_e3_der_int', label: 'Eje 3 derecha interna', is_repuesto: false },
    { id: 'pes_e3_der_ext', label: 'Eje 3 derecha externa', is_repuesto: false },
    { id: 'pes_e4_izq_ext', label: 'Eje 4 izquierda externa', is_repuesto: false },
    { id: 'pes_e4_der_ext', label: 'Eje 4 derecha externa', is_repuesto: false },
    { id: 'pes_rep_1', label: 'Repuesto 1', is_repuesto: true },
    { id: 'pes_rep_2', label: 'Repuesto 2', is_repuesto: true },
  ],
} as const;

const formatTodayYmd = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const mapTipoVehiculoFormato = (tipo: string): string => {
  const t = (tipo || '').toLowerCase();
  if (t === 'moto') return 'MOTOCICLETA 4T';
  if (t.includes('pesado')) return 'PESADO';
  return 'LIVIANO';
};

const buildNoInspeccionProvisional = (placa: string): string => {
  const stamp = formatTodayYmd().replace(/-/g, '');
  const p = (placa || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-4) || 'SNPL';
  return `PR-${stamp}-${p}`;
};

const resolveTipoLlantasKey = (tipoVehiculo: string): keyof typeof TIPO_LLAYOUT => {
  const t = (tipoVehiculo || '').toLowerCase();
  if (t === 'moto') return 'moto';
  if (t.includes('pesado')) return 'pesado';
  return 'liviano';
};

const buildPresionResumen = (items: PresionLlantaItem[]): string => {
  const parts = items
    .map((it) => ({
      label: (it.posicion_label || '').trim(),
      psi: (it.psi || '').trim(),
    }))
    .filter((it) => it.psi.length > 0)
    .map((it) => `${it.label}: ${it.psi} PSI`);
  return parts.join(', ');
};

const countTecnicosDiligenciados = (dt: RecepcionFormatoExtra['datos_tecnicos']): number => {
  const scalarKeys: Array<keyof RecepcionFormatoExtra['datos_tecnicos']> = [
    'clase_vehiculo',
    'marca',
    'linea',
    'modelo',
    'color',
    'servicio',
    'tipo_combustible',
    'carga_pasajeros',
    'ensenanza',
    'kilometraje',
    'blindado',
    'polarizado',
    'cilindraje',
    'presion_inflado',
    'observaciones_tecnicas',
  ];
  const scalarCount = scalarKeys.filter((k) => String(dt[k] || '').trim().length > 0).length;
  const psiCount = (dt.presion_llantas || []).filter((x) => String(x.psi || '').trim().length > 0).length;
  return scalarCount + psiCount;
};

const countPreRevisionDiligenciada = (preRevision: RecepcionFormatoExtra['pre_revision']): number => {
  return preRevision.firma_operario?.data_url ? 1 : 0;
};

export default function Recepcion() {
  const normalizarDocumentoCliente = (
    raw: string,
    tipo: VehiculoRegistro['cliente_tipo_documento']
  ): string => {
    const upper = (raw || '').toUpperCase();
    if (tipo === 'NIT') {
      const cleaned = upper.replace(/[^0-9-]/g, '');
      const firstHyphen = cleaned.indexOf('-');
      if (firstHyphen < 0) {
        return cleaned.slice(0, 20);
      }
      const left = cleaned.slice(0, firstHyphen).replace(/-/g, '');
      const right = cleaned.slice(firstHyphen + 1).replace(/-/g, '');
      if (!left) return right.slice(0, 19);
      if (!right) return `${left.slice(0, 20)}-`;
      return `${left.slice(0, 20)}-${right.slice(0, 1)}`;
    }
    return upper.replace(/[^A-Z0-9]/g, '').slice(0, 20);
  };

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const tenantUser = user && 'tenant_id' in user ? (user as Usuario) : null;
  const { showToast } = useToast();
  const anoActual = new Date().getFullYear();
  const [tarifaCalculada, setTarifaCalculada] = useState<TarifaCalculada | null>(null);
  const [tarifaError, setTarifaError] = useState<string>('');
  const [fotosVehiculo, setFotosVehiculo] = useState<string[]>([]);
  const [runtSugerencia, setRuntSugerencia] = useState<VehiculoConsultaRunt | null>(null);
  const [clienteFactusMunicipalityId, setClienteFactusMunicipalityId] = useState('');
  const [clienteFactusMunicipalityLabel, setClienteFactusMunicipalityLabel] = useState('');
  const [reinspeccionInfo, setReinspeccionInfo] = useState<ReinspeccionElegibilidad | null>(null);
  const [mostrarModalReinspeccion, setMostrarModalReinspeccion] = useState(false);
  const [placaEvaluadaReinspeccion, setPlacaEvaluadaReinspeccion] = useState('');
  const [esReingresoRechazoInicial, setEsReingresoRechazoInicial] = useState(false);

  // Estado para edición
  const [modoEdicion, setModoEdicion] = useState(false);
  const [vehiculoEditando, setVehiculoEditando] = useState<string | null>(null);

  // Estado del formulario
  const [formData, setFormData] = useState<VehiculoRegistro>({
    placa: '',
    tipo_vehiculo: 'moto',
    marca: '',
    modelo: '',
    ano_modelo: anoActual, // Año actual por defecto
    cliente_nombre: '',
    cliente_tipo_documento: 'CC',
    cliente_documento: '',
    cliente_telefono: '',
    cliente_email: '',
    cliente_direccion: '',
    tiene_soat: false,
    observaciones: '',
  });
  const [mostrarFormatoExtra, setMostrarFormatoExtra] = useState(false);
  const [formatoExtra, setFormatoExtra] = useState<RecepcionFormatoExtra>(createDefaultFormatoExtra());
  const firmaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const firmaOperarioCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [firmaDibujando, setFirmaDibujando] = useState(false);
  const [firmaOperarioDibujando, setFirmaOperarioDibujando] = useState(false);
  const [firmaTrazoPendiente, setFirmaTrazoPendiente] = useState(false);
  const [firmaOperarioTrazoPendiente, setFirmaOperarioTrazoPendiente] = useState(false);
  const [consultaRunt, setConsultaRunt] = useState<{
    document_type: 'CC' | 'CE' | 'PA' | 'NIT';
    document_number: string;
  }>({
    document_type: 'CC',
    document_number: '',
  });
  const versionFormatoTenant =
    (tenantUser?.tenant_branding?.formato_prerevision_version || '').trim() || DEFAULT_FORMAT_VERSION;
  const preparacionItems = useMemo(
    () => buildPreparacionItems((tenantUser?.tenant_branding?.nombre_comercial || 'CDASOFT').trim() || 'CDASOFT'),
    [tenantUser?.tenant_branding?.nombre_comercial]
  );

  const formatoExtraResumen = useMemo(() => {
    const tecnicoCount = countTecnicosDiligenciados(formatoExtra.datos_tecnicos);
    const checklistCount = Object.values(formatoExtra.preparacion_checklist).filter((v) => v === 'si' || v === 'no' || v === 'na').length;
    const preRevisionCount = countPreRevisionDiligenciada(formatoExtra.pre_revision);
    const total = tecnicoCount + checklistCount + preRevisionCount;
    if (total === 0) return { estado: 'Sin diligenciar', className: 'bg-slate-100 text-slate-700' };
    if (checklistCount === preparacionItems.length) {
      return { estado: 'Completo', className: 'bg-emerald-100 text-emerald-700' };
    }
    return { estado: 'Parcial', className: 'bg-amber-100 text-amber-700' };
  }, [formatoExtra, preparacionItems.length]);

  const firmaCapturada = Boolean(formatoExtra.firma_titular?.data_url);
  const firmaOperarioCapturada = Boolean(formatoExtra.pre_revision.firma_operario?.data_url);
  const requiereFirmaFormato = useMemo(() => {
    // Opcional por tenant: solo exigir firmas cuando realmente se diligencia el checklist
    // de pre-revisión (SI/NO/N/A) o cuando ya existe alguna firma capturada.
    const checklistCount = Object.values(formatoExtra.preparacion_checklist).filter(
      (v) => v === 'si' || v === 'no' || v === 'na'
    ).length;
    return checklistCount > 0 || firmaCapturada || firmaOperarioCapturada;
  }, [formatoExtra.preparacion_checklist, firmaCapturada, firmaOperarioCapturada]);
  const bloqueoFirmaRegistro = requiereFirmaFormato && (!firmaCapturada || !firmaOperarioCapturada);
  const layoutLlantas = useMemo(() => {
    const key = resolveTipoLlantasKey(formData.tipo_vehiculo);
    return TIPO_LLAYOUT[key];
  }, [formData.tipo_vehiculo]);

  useEffect(() => {
    if (!mostrarFormatoExtra) return;
    setFormatoExtra((prev) => {
      const current = (prev.version || '').trim();
      if (!current || current === DEFAULT_FORMAT_VERSION) {
        return { ...prev, version: versionFormatoTenant };
      }
      return prev;
    });
  }, [mostrarFormatoExtra, versionFormatoTenant]);

  useEffect(() => {
    if (modoEdicion) return;
    const placaUpper = (formData.placa || '').trim().toUpperCase();
    if (placaUpper.length < 5) {
      setReinspeccionInfo(null);
      setMostrarModalReinspeccion(false);
      setPlacaEvaluadaReinspeccion('');
      setEsReingresoRechazoInicial(false);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const data = await vehiculosApi.consultarElegibilidadReinspeccion(placaUpper);
        setReinspeccionInfo(data);
        if (!data.elegible_reingreso) {
          setEsReingresoRechazoInicial(false);
        }
        const esNuevaPlaca = placaEvaluadaReinspeccion !== placaUpper;
        if (data.tiene_historial && esNuevaPlaca) {
          setMostrarModalReinspeccion(true);
          setPlacaEvaluadaReinspeccion(placaUpper);
        }
      } catch {
        setReinspeccionInfo(null);
      }
    }, 450);
    return () => window.clearTimeout(handle);
  }, [formData.placa, modoEdicion, placaEvaluadaReinspeccion]);

  type PrefillState = {
    agendamiento_prefill?: {
      placa?: string;
      tipo_vehiculo?: string;
      cliente_nombre?: string;
      cliente_telefono?: string;
      cliente_email?: string;
    } | null;
  };

  // Obtener comisiones SOAT
  const { data: comisionesSOAT } = useQuery({
    queryKey: ['comisiones-soat'],
    queryFn: tarifasApi.obtenerComisionesSOAT,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
  const { data: facturacionUbicacion } = useQuery({
    queryKey: ['facturacion-ubicacion-recepcion'],
    queryFn: configApi.obtenerFacturacionUbicacion,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const defaultClienteFactusMunicipalityId = useMemo(
    () =>
      facturacionUbicacion?.factus_municipality_id != null
        ? String(facturacionUbicacion.factus_municipality_id)
        : '',
    [facturacionUbicacion?.factus_municipality_id]
  );

  // Estado para filtros y paginación
  const [buscar, setBuscar] = useState('');
  const [filtroFecha, setFiltroFecha] = useState<'hoy' | 'semana' | 'mes' | 'personalizado'>('hoy');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [exportandoListado, setExportandoListado] = useState(false);
  const [descargandoFormatoVehiculoId, setDescargandoFormatoVehiculoId] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{
    blobUrl: string;
    title: string;
    fileName: string;
  } | null>(null);
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 12;

  // Calcular fechas según filtro
  const calcularFechas = () => {
    const hoy = new Date();
    
    // Función para formatear fecha local sin convertir a UTC
    // Esto evita desfase de zona horaria (crítico para producción)
    const formatearFechaLocal = (fecha: Date) => {
      const year = fecha.getFullYear();
      const month = String(fecha.getMonth() + 1).padStart(2, '0');
      const day = String(fecha.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    let desde = '';
    let hasta = formatearFechaLocal(hoy);

    switch (filtroFecha) {
      case 'hoy':
        desde = hasta;
        break;
      case 'semana':
        desde = formatearFechaLocal(new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000));
        break;
      case 'mes':
        desde = formatearFechaLocal(new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000));
        break;
      case 'personalizado':
        desde = fechaDesde;
        hasta = fechaHasta;
        break;
    }

    return { desde, hasta };
  };

  const { desde, hasta } = calcularFechas();

  // Obtener total de vehículos con filtros
  const { data: totalVehiculos = 0 } = useQuery({
    queryKey: ['vehiculos-count', buscar, desde, hasta],
    queryFn: () => vehiculosApi.contarTotal({
      buscar: buscar || undefined,
      fecha_desde: desde,
      fecha_hasta: hasta,
    }),
    refetchInterval: 15000, // Actualizar cada 15 segundos
    retry: 1,
  });

  // Calcular paginación
  const totalPaginas = Math.ceil(totalVehiculos / registrosPorPagina);
  const skip = (paginaActual - 1) * registrosPorPagina;

  // Obtener vehículos con filtros y paginación
  const { data: vehiculos = [], isLoading: loadingVehiculos } = useQuery({
    queryKey: ['vehiculos', buscar, desde, hasta, paginaActual],
    queryFn: () => vehiculosApi.listar({
      buscar: buscar || undefined,
      fecha_desde: desde,
      fecha_hasta: hasta,
      skip,
      limit: registrosPorPagina,
    }),
    refetchInterval: 15000, // Actualizar cada 15 segundos
    retry: 1,
  });

  // Mutación para registrar vehículo - VERSIÓN ESTABLE
  const registrarMutation = useMutation({
    mutationFn: vehiculosApi.registrar,
    onSuccess: () => {
      const cantidadFotos = fotosVehiculo.length;
      
      // 1. Mostrar notificación GLOBAL (NO afectada por ErrorBoundary)
      showToast(
        'success',
        'Vehículo registrado exitosamente.',
        cantidadFotos > 0 
          ? `${cantidadFotos} foto${cantidadFotos !== 1 ? 's' : ''} adjuntada${cantidadFotos !== 1 ? 's' : ''}`
          : undefined
      );
      
      // 2. Limpiar formulario después de un momento (para que el toast capture los datos)
      setTimeout(() => {
        setFotosVehiculo([]);
        resetForm();
      }, 100);
      
      // 3. Refrescar datos con un pequeño delay (React 17 necesita esto)
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['vehiculos-hoy'] });
        queryClient.invalidateQueries({ queryKey: ['vehiculos-count'] });
        queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
        queryClient.invalidateQueries({ queryKey: ['vehiculos-pendientes'] });
      }, 300);
    },
    onError: (error: any) => {
      // Manejo de errores robusto
      const errorMessage = error?.response?.data?.detail || 'No fue posible registrar el vehículo. Intenta nuevamente.';
      showToast(
        'error',
        'No fue posible registrar el vehículo',
        typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage)
      );
    }
  });

  // Mutación para editar vehículo
  const editarMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: VehiculoRegistro }) => vehiculosApi.editar(id, data),
    onSuccess: () => {
      showToast('success', 'Vehículo actualizado exitosamente.');
      
      setModoEdicion(false);
      setVehiculoEditando(null);
      setFotosVehiculo([]);
      resetForm();
      
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
        queryClient.invalidateQueries({ queryKey: ['vehiculos-count'] });
        queryClient.invalidateQueries({ queryKey: ['vehiculos-pendientes'] });
      }, 300);
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.detail || 'No fue posible actualizar el vehículo. Intenta nuevamente.';
      showToast(
        'error',
        'No fue posible actualizar el vehículo',
        typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage)
      );
    }
  });

  const consultarRuntMutation = useMutation({
    mutationFn: (params: { placa: string; documentType: string; documentNumber: string }) =>
      vehiculosApi.consultarRuntPorPlaca(params.placa, {
        documentType: params.documentType,
        documentNumber: params.documentNumber,
      }),
    onSuccess: (data, variables) => {
      setRuntSugerencia(data);
      setFormData((prev) => {
        const docTypeFromQuery =
          variables.documentType && ['CC', 'CE', 'PA', 'NIT'].includes(variables.documentType)
            ? (variables.documentType as 'CC' | 'CE' | 'PA' | 'NIT')
            : prev.cliente_tipo_documento;
        const docTypeResolved =
          data.document_type && ['CC', 'CE', 'PA', 'NIT'].includes(data.document_type)
            ? (data.document_type as 'CC' | 'CE' | 'PA' | 'NIT')
            : docTypeFromQuery;
        const documentFromResponse = data.document_number ? String(data.document_number) : '';
        const documentFromQuery = variables.documentNumber ? String(variables.documentNumber) : '';
        const finalDocument = (documentFromResponse || documentFromQuery).trim();
        return {
          ...prev,
          cliente_tipo_documento: docTypeResolved,
          cliente_documento: finalDocument
            ? normalizarDocumentoCliente(finalDocument, docTypeResolved)
            : prev.cliente_documento,
          cliente_nombre: data.titular_nombre ? String(data.titular_nombre).toUpperCase() : prev.cliente_nombre,
        };
      });
      if (mostrarFormatoExtra) {
        setFormatoExtra((prev) => ({
          ...prev,
          datos_tecnicos: {
            ...prev.datos_tecnicos,
            clase_vehiculo: data.clase_vehiculo || prev.datos_tecnicos.clase_vehiculo,
            marca: data.marca || prev.datos_tecnicos.marca || '',
            linea: data.linea || prev.datos_tecnicos.linea,
            modelo: data.modelo || prev.datos_tecnicos.modelo || '',
            servicio: data.tipo_servicio || prev.datos_tecnicos.servicio,
            color: data.color || prev.datos_tecnicos.color,
            cilindraje: data.cilindraje || prev.datos_tecnicos.cilindraje,
          },
        }));
      }
      if (!data.encontrado) {
        showToast(
          'warning',
          'Sin datos para autocompletar',
          `No se encontró información RUNT para ${data.placa_consultada}. Puedes continuar manualmente.`
        );
        return;
      }
      const resumen = [
        data.marca,
        data.linea,
        data.modelo,
        data.ano_modelo ? String(data.ano_modelo) : null,
      ].filter(Boolean).join(' · ');
      showToast(
        'success',
        'Consulta RUNT exitosa',
        resumen || `Placa ${data.placa_consultada} encontrada`
      );
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.detail || 'No fue posible consultar RUNT en este momento.';
      setRuntSugerencia(null);
      showToast(
        'error',
        'Error consultando RUNT',
        typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage)
      );
    },
  });

  // Calcular tarifa cuando cambia el año del modelo o el tipo de vehículo
  useEffect(() => {
    if (modoEdicion) return;
    if (clienteFactusMunicipalityId.trim().length > 0) return;
    if (defaultClienteFactusMunicipalityId) {
      setClienteFactusMunicipalityId(defaultClienteFactusMunicipalityId);
    }
  }, [modoEdicion, clienteFactusMunicipalityId, defaultClienteFactusMunicipalityId]);

  useEffect(() => {
    const state = location.state as PrefillState | null;
    const prefill = state?.agendamiento_prefill;
    if (!prefill) return;

    const allowedTipoVehiculo = new Set([
      'liviano_particular',
      'liviano_publico',
      'pesado_particular',
      'pesado_publico',
      'moto',
      'preventiva',
    ]);

    const tipoMap: Record<string, string> = {
      pesado: 'pesado_particular',
      liviano: 'liviano_particular',
    };

    const tipoRaw = (prefill.tipo_vehiculo || '').trim().toLowerCase();
    const tipoPrefill = allowedTipoVehiculo.has(tipoRaw)
      ? tipoRaw
      : (tipoMap[tipoRaw] || 'liviano_particular');

    setFormData((prev) => ({
      ...prev,
      placa: (prefill.placa || prev.placa || '').toUpperCase(),
      tipo_vehiculo: tipoPrefill,
      cliente_nombre: (prefill.cliente_nombre || prev.cliente_nombre || '').toUpperCase(),
      cliente_telefono: prefill.cliente_telefono || prev.cliente_telefono || '',
      cliente_email: (prefill.cliente_email || prev.cliente_email || '').toLowerCase(),
    }));

    showToast(
      'success',
      'Datos precargados desde Agendamiento.',
      'Completa documento y demás campos para registrar el vehículo.',
    );

    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, showToast]);

  // Vista previa de tarifa solo para este formulario (no el vehículo del modal de Caja).
  useEffect(() => {
    let cancelled = false;

    // Si es preventiva, no calcular tarifa
    if (formData.tipo_vehiculo === 'preventiva') {
      setTarifaCalculada(null);
      setTarifaError('');
      return;
    }

    // Evitar consultas innecesarias para años futuros (suelen no tener vigencia configurada aún).
    if (formData.ano_modelo > anoActual) {
      setTarifaCalculada(null);
      setTarifaError(
        `El año modelo ${formData.ano_modelo} es mayor al año actual (${anoActual}). Ajusta el año o configura tarifas futuras antes de continuar.`,
      );
      return;
    }
    
    if (formData.ano_modelo >= 1950 && formData.ano_modelo <= 2030 && formData.tipo_vehiculo) {
      setTarifaError('');
      vehiculosApi.calcularTarifa(formData.ano_modelo, formData.tipo_vehiculo)
        .then((tarifa) => {
          if (cancelled) return;
          setTarifaCalculada(tarifa);
          setTarifaError('');
        })
        .catch((error: any) => {
          if (cancelled) return;
          setTarifaCalculada(null);
          if (error?.response?.status === 404) {
            setTarifaError(
              `No hay tarifa vigente para ${formData.tipo_vehiculo} modelo ${formData.ano_modelo}. Configura tarifas para continuar.`,
            );
            return;
          }
          setTarifaError('No fue posible calcular la tarifa en este momento.');
        });
    }

    return () => {
      cancelled = true;
    };
  }, [formData.ano_modelo, formData.tipo_vehiculo, anoActual]);

  const resetForm = () => {
    // Limpiar fotos
    setFotosVehiculo([]);
    
    // Limpiar formulario PERO mantener el año para que la tarifa siga visible
    setFormData({
      placa: '',
      tipo_vehiculo: 'moto',
      marca: '',
      modelo: '',
      ano_modelo: anoActual, // Mantener año actual para que la tarifa persista
      cliente_nombre: '',
      cliente_tipo_documento: 'CC',
      cliente_documento: '',
      cliente_telefono: '',
      cliente_email: '',
      cliente_direccion: '',
      tiene_soat: false,
      observaciones: '',
    });
    setClienteFactusMunicipalityId(defaultClienteFactusMunicipalityId || '');
    setClienteFactusMunicipalityLabel('');
    setRuntSugerencia(null);
    setFormatoExtra(createDefaultFormatoExtra());
    setMostrarFormatoExtra(false);
    setConsultaRunt({
      document_type: 'CC',
      document_number: '',
    });
    setReinspeccionInfo(null);
    setMostrarModalReinspeccion(false);
    setPlacaEvaluadaReinspeccion('');
    setEsReingresoRechazoInicial(false);
    
    // NO limpiar tarifaCalculada aquí - dejar que el useEffect lo maneje
    // Esto permite que la tarifa permanezca visible después del registro
  };

  const iniciarEdicion = (vehiculo: any) => {
    // Extraer fotos de observaciones
    const fotos = extraerFotosDeObservaciones(vehiculo.observaciones);
    
    // Extraer texto de observaciones
    let textoObservaciones = '';
    try {
      const parsed = JSON.parse(vehiculo.observaciones || '{}');
      textoObservaciones = parsed.texto || '';
    } catch {
      textoObservaciones = vehiculo.observaciones || '';
    }
    
    setModoEdicion(true);
    setVehiculoEditando(vehiculo.id);
    setFotosVehiculo(fotos);
    setConsultaRunt({
      document_type: (vehiculo.cliente_tipo_documento || 'CC') as 'CC' | 'CE' | 'PA' | 'NIT',
      document_number: vehiculo.cliente_documento || '',
    });
    setFormData({
      placa: vehiculo.placa,
      tipo_vehiculo: vehiculo.tipo_vehiculo,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      ano_modelo: vehiculo.ano_modelo,
      cliente_nombre: vehiculo.cliente_nombre,
      cliente_tipo_documento: vehiculo.cliente_tipo_documento || 'CC',
      cliente_documento: normalizarDocumentoCliente(
        vehiculo.cliente_documento || '',
        (vehiculo.cliente_tipo_documento || 'CC') as VehiculoRegistro['cliente_tipo_documento']
      ),
      cliente_telefono: vehiculo.cliente_telefono || '',
      cliente_email: vehiculo.cliente_email || '',
      cliente_direccion: vehiculo.cliente_direccion || '',
      tiene_soat: vehiculo.tiene_soat,
      observaciones: textoObservaciones,
    });
    setClienteFactusMunicipalityId(
      vehiculo.cliente_factus_municipality_id != null
        ? String(vehiculo.cliente_factus_municipality_id)
        : defaultClienteFactusMunicipalityId || ''
    );
    setClienteFactusMunicipalityLabel('');
    const formatoGuardado = hidratarFormatoExtra(vehiculo.recepcion_formato_extra_json);
    setFormatoExtra(formatoGuardado);
    const tecnicoCountGuardado = countTecnicosDiligenciados(formatoGuardado.datos_tecnicos);
    const tieneFormatoGuardado =
      tecnicoCountGuardado > 0 ||
      Object.values(formatoGuardado.preparacion_checklist).some((v) => v === 'si' || v === 'no' || v === 'na') ||
      countPreRevisionDiligenciada(formatoGuardado.pre_revision) > 0;
    setMostrarFormatoExtra(tieneFormatoGuardado);
    
    // Scroll al formulario
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelarEdicion = () => {
    setModoEdicion(false);
    setVehiculoEditando(null);
    setFotosVehiculo([]);
    setRuntSugerencia(null);
    resetForm();
  };

  const camposSugeribles = useMemo(() => {
    if (!runtSugerencia || !runtSugerencia.encontrado) return [];
    return [
      { key: 'marca', label: 'Marca', valor: runtSugerencia.marca },
      { key: 'modelo', label: 'Modelo', valor: runtSugerencia.linea || runtSugerencia.modelo },
      { key: 'ano_modelo', label: 'Año', valor: runtSugerencia.ano_modelo ? String(runtSugerencia.ano_modelo) : null },
      { key: 'tipo_vehiculo', label: 'Tipo sugerido', valor: runtSugerencia.tipo_vehiculo_sugerido },
    ].filter((c) => c.valor);
  }, [runtSugerencia]);

  const aplicarSugerenciaRunt = () => {
    if (!runtSugerencia || !runtSugerencia.encontrado) return;
    const ok = window.confirm(
      `Se aplicarán sugerencias RUNT para la placa ${runtSugerencia.placa_consultada}. ¿Deseas continuar?`
    );
    if (!ok) return;
    setFormData((prev) => ({
      ...prev,
      marca: runtSugerencia.marca || prev.marca || '',
      modelo: runtSugerencia.linea || runtSugerencia.modelo || prev.modelo || '',
      ano_modelo: runtSugerencia.ano_modelo || prev.ano_modelo,
      tipo_vehiculo: runtSugerencia.tipo_vehiculo_sugerido || prev.tipo_vehiculo,
    }));
    setFormatoExtra((prev) => ({
      ...prev,
      datos_tecnicos: {
        ...prev.datos_tecnicos,
        clase_vehiculo: runtSugerencia.clase_vehiculo || prev.datos_tecnicos.clase_vehiculo,
        marca: runtSugerencia.marca || prev.datos_tecnicos.marca || '',
        linea: runtSugerencia.linea || prev.datos_tecnicos.linea,
        modelo: runtSugerencia.modelo || prev.datos_tecnicos.modelo || '',
        servicio: runtSugerencia.tipo_servicio || prev.datos_tecnicos.servicio,
        color: runtSugerencia.color || prev.datos_tecnicos.color,
        cilindraje: runtSugerencia.cilindraje || prev.datos_tecnicos.cilindraje,
      },
    }));
    showToast('success', 'Sugerencias aplicadas', 'Se aplicaron datos sugeridos desde RUNT.');
  };

  useEffect(() => {
    if (!mostrarFormatoExtra || !runtSugerencia?.encontrado) return;
    setFormatoExtra((prev) => ({
      ...prev,
      datos_tecnicos: {
        ...prev.datos_tecnicos,
        // Solo completamos vacíos para no pisar edición manual del usuario.
        clase_vehiculo: prev.datos_tecnicos.clase_vehiculo || runtSugerencia.clase_vehiculo || '',
        marca: prev.datos_tecnicos.marca || runtSugerencia.marca || '',
        linea: prev.datos_tecnicos.linea || runtSugerencia.linea || '',
        modelo: prev.datos_tecnicos.modelo || runtSugerencia.modelo || '',
        servicio: prev.datos_tecnicos.servicio || runtSugerencia.tipo_servicio || '',
        color: prev.datos_tecnicos.color || runtSugerencia.color || '',
        cilindraje: prev.datos_tecnicos.cilindraje || runtSugerencia.cilindraje || '',
      },
    }));
  }, [mostrarFormatoExtra, runtSugerencia]);

  const consultarRunt = () => {
    const placa = (formData.placa || '').trim().toUpperCase();
    if (placa.length < 5) {
      showToast('warning', 'Placa incompleta', 'Ingresa una placa válida antes de consultar.');
      return;
    }
    const documentNumber = (consultaRunt.document_number || '').replace(/\D/g, '');
    consultarRuntMutation.mutate({
      placa,
      documentType: consultaRunt.document_type,
      documentNumber,
    });
  };

  const construirFormatoExtraPayload = (): RecepcionFormatoExtra | undefined => {
    const titularAuto = {
      nombre_apellidos: (formData.cliente_nombre || '').trim(),
      numero_documento: (formData.cliente_documento || '').trim(),
      celular_telefono: (formData.cliente_telefono || '').trim(),
      email: (formData.cliente_email || '').trim().toLowerCase(),
      ciudad_direccion: (formData.cliente_direccion || '').trim(),
    };
    const payload: RecepcionFormatoExtra = {
      version: (formatoExtra.version || DEFAULT_FORMAT_VERSION).trim(),
      fecha_formato: (formatoExtra.fecha_formato || formatTodayYmd()).trim(),
      no_inspeccion: (formatoExtra.no_inspeccion || buildNoInspeccionProvisional(formData.placa)).trim(),
      tipo_vehiculo_formato: (formatoExtra.tipo_vehiculo_formato || mapTipoVehiculoFormato(formData.tipo_vehiculo)).trim(),
      datos_tecnicos: {
        clase_vehiculo: (formatoExtra.datos_tecnicos.clase_vehiculo || '').trim(),
        marca: (formatoExtra.datos_tecnicos.marca || '').trim(),
        linea: (formatoExtra.datos_tecnicos.linea || '').trim(),
        modelo: (formatoExtra.datos_tecnicos.modelo || '').trim(),
        color: (formatoExtra.datos_tecnicos.color || '').trim(),
        servicio: (formatoExtra.datos_tecnicos.servicio || '').trim(),
        tipo_combustible: (formatoExtra.datos_tecnicos.tipo_combustible || '').trim(),
        carga_pasajeros: (formatoExtra.datos_tecnicos.carga_pasajeros || '').trim(),
        ensenanza: formatoExtra.datos_tecnicos.ensenanza || '',
        kilometraje: (formatoExtra.datos_tecnicos.kilometraje || '').trim(),
        blindado: formatoExtra.datos_tecnicos.blindado || '',
        polarizado: formatoExtra.datos_tecnicos.polarizado || '',
        cilindraje: (formatoExtra.datos_tecnicos.cilindraje || '').trim(),
        presion_inflado: (formatoExtra.datos_tecnicos.presion_inflado || '').trim(),
        presion_llantas: (formatoExtra.datos_tecnicos.presion_llantas || [])
          .map((item) => ({
            posicion_id: String(item.posicion_id || '').trim(),
            posicion_label: String(item.posicion_label || '').trim(),
            psi: String(item.psi || '').trim(),
            is_repuesto: Boolean(item.is_repuesto),
          }))
          .filter((item) => item.posicion_id.length > 0),
        observaciones_tecnicas: (formatoExtra.datos_tecnicos.observaciones_tecnicas || '').trim(),
      },
      preparacion_checklist: { ...formatoExtra.preparacion_checklist },
      observaciones_recepcion: (formData.observaciones || '').trim(),
      titular_datos: titularAuto,
      pre_revision: {
        firma_operario: formatoExtra.pre_revision.firma_operario?.data_url
          ? {
              data_url: formatoExtra.pre_revision.firma_operario.data_url,
              signed_at: formatoExtra.pre_revision.firma_operario.signed_at || new Date().toISOString(),
              signer_name:
                formatoExtra.pre_revision.firma_operario.signer_name ||
                (user?.nombre_completo || '').trim() ||
                'Operario pre-revision',
            }
          : null,
      },
      autorizaciones_datos: {
        // Fuente: módulo Habeas Data / consentimiento general del flujo.
        contacto_fuerza_comercial: 'si',
        contacto_encuestas_confirmacion: 'si',
        contacto_recordatorio_rtm_soat: 'si',
      },
      firma_titular: formatoExtra.firma_titular?.data_url
        ? {
            data_url: formatoExtra.firma_titular.data_url,
            signed_at: formatoExtra.firma_titular.signed_at || new Date().toISOString(),
            signer_name: formatoExtra.firma_titular.signer_name || (formData.cliente_nombre || '').trim(),
          }
        : null,
    };
    const hasPsi = (payload.datos_tecnicos.presion_llantas || []).some((x) => String(x.psi || '').trim().length > 0);
    const hasScalarTecnico =
      [
        payload.datos_tecnicos.clase_vehiculo,
        payload.datos_tecnicos.marca,
        payload.datos_tecnicos.linea,
        payload.datos_tecnicos.modelo,
        payload.datos_tecnicos.color,
        payload.datos_tecnicos.servicio,
        payload.datos_tecnicos.tipo_combustible,
        payload.datos_tecnicos.carga_pasajeros,
        payload.datos_tecnicos.ensenanza,
        payload.datos_tecnicos.kilometraje,
        payload.datos_tecnicos.blindado,
        payload.datos_tecnicos.polarizado,
        payload.datos_tecnicos.cilindraje,
        payload.datos_tecnicos.presion_inflado,
        payload.datos_tecnicos.observaciones_tecnicas,
      ].some((v) => String(v || '').trim().length > 0);
    const hasValues =
      hasScalarTecnico ||
      hasPsi ||
      String(payload.observaciones_recepcion || '').trim().length > 0 ||
      Object.values(payload.preparacion_checklist).some((v) => v === 'si' || v === 'no' || v === 'na') ||
      Boolean(payload.pre_revision.firma_operario?.data_url);
    return hasValues ? payload : undefined;
  };

  const hidratarFormatoExtra = (raw: unknown): RecepcionFormatoExtra => {
    const base = createDefaultFormatoExtra();
    if (!raw || typeof raw !== 'object') return base;
    const input = raw as Record<string, unknown>;
    const dt = (input.datos_tecnicos as Record<string, unknown>) || {};
    const ck = ((input.preparacion_checklist as Record<string, unknown>) || (input.checklist as Record<string, unknown>) || {});
    const titular = (input.titular_datos as Record<string, unknown>) || {};
    const preRevision = (input.pre_revision as Record<string, unknown>) || {};
    const auth = (input.autorizaciones_datos as Record<string, unknown>) || {};
    const firma = (input.firma_titular as Record<string, unknown>) || {};
    const pickSn = (value: unknown): SnNoNa => {
      const v = String(value || '').toLowerCase();
      if (v === 'si' || v === 'no' || v === 'na') return v as SnNoNa;
      return '';
    };
    const pickSnNo = (value: unknown): SnNo => {
      const v = String(value || '').toLowerCase();
      if (v === 'si' || v === 'no') return v as SnNo;
      return '';
    };
    return {
      version: String(input.version || base.version),
      fecha_formato: String(input.fecha_formato || ''),
      no_inspeccion: String(input.no_inspeccion || ''),
      tipo_vehiculo_formato: String(input.tipo_vehiculo_formato || ''),
      datos_tecnicos: {
        clase_vehiculo: String(dt.clase_vehiculo || ''),
        marca: String(dt.marca || ''),
        linea: String(dt.linea || ''),
        modelo: String(dt.modelo || ''),
        color: String(dt.color || ''),
        servicio: String(dt.servicio || dt.tipo_servicio || ''),
        tipo_combustible: String(dt.tipo_combustible || ''),
        carga_pasajeros: String(dt.carga_pasajeros || ''),
        ensenanza: pickSnNo(dt.ensenanza),
        kilometraje: String(dt.kilometraje || ''),
        blindado: pickSn(dt.blindado),
        polarizado: pickSn(dt.polarizado),
        cilindraje: String(dt.cilindraje || ''),
        presion_inflado: String(dt.presion_inflado || ''),
        presion_llantas: Array.isArray(dt.presion_llantas)
          ? dt.presion_llantas
              .filter((x) => typeof x === 'object' && x !== null)
              .map((x) => {
                const item = x as Record<string, unknown>;
                return {
                  posicion_id: String(item.posicion_id || ''),
                  posicion_label: String(item.posicion_label || ''),
                  psi: String(item.psi || ''),
                  is_repuesto: Boolean(item.is_repuesto),
                };
              })
          : [],
        observaciones_tecnicas: String(dt.observaciones_tecnicas || ''),
      },
      preparacion_checklist: {
        limpieza_descargado: pickSn(ck.limpieza_descargado || ck.estado_limpieza_preinspeccion),
        licencia_y_confrontacion_datos: pickSn(ck.licencia_y_confrontacion_datos),
        conversion_gas_vigente: pickSn(ck.conversion_gas_vigente),
        presion_llantas_adecuada_cda: pickSn(ck.presion_llantas_adecuada_cda),
        tapa_o_capuchones_valvula: pickSn(ck.tapa_o_capuchones_valvula),
        niveles_fluidos_visibles: pickSn(ck.niveles_fluidos_visibles),
        sin_accesorios_que_impidan_acople: pickSn(ck.sin_accesorios_que_impidan_acople),
        retiro_elementos_cabina_carga: pickSn(ck.retiro_elementos_cabina_carga),
        liberacion_carga_para_inspeccion: pickSn(ck.liberacion_carga_para_inspeccion),
        tablero_instrumentos_ok: pickSn(ck.tablero_instrumentos_ok),
        cinturones_sillas_accesos_ok: pickSn(ck.cinturones_sillas_accesos_ok || ck.cinturones_visibles),
        combustible_suficiente: pickSn(ck.combustible_suficiente),
        placa_identificacion_legible: pickSn(ck.placa_identificacion_legible),
        llanta_repuesto_accesible: pickSn(ck.llanta_repuesto_accesible),
        luces_funcionales: pickSn(ck.luces_funcionales),
        extintor_central_funcional_moto: pickSn(ck.extintor_central_funcional_moto),
        adaptaciones_discapacidad: pickSn(ck.adaptaciones_discapacidad),
        viable_ingreso_linea: pickSnNo(ck.viable_ingreso_linea),
      },
      observaciones_recepcion: String(input.observaciones_recepcion || ''),
      titular_datos: {
        nombre_apellidos: String(titular.nombre_apellidos || ''),
        numero_documento: String(titular.numero_documento || ''),
        celular_telefono: String(titular.celular_telefono || ''),
        email: String(titular.email || ''),
        ciudad_direccion: String(titular.ciudad_direccion || ''),
      },
      pre_revision: {
        firma_operario: (() => {
          const firmaOperarioRaw =
            (preRevision.firma_operario as Record<string, unknown>) ||
            (input.firma_operario_pre_revision as Record<string, unknown>) ||
            {};
          if (typeof firmaOperarioRaw.data_url !== 'string' || String(firmaOperarioRaw.data_url).trim().length === 0) {
            return null;
          }
          return {
            data_url: String(firmaOperarioRaw.data_url),
            signed_at: String(firmaOperarioRaw.signed_at || ''),
            signer_name: String(
              firmaOperarioRaw.signer_name ||
              preRevision.operario_pre_revision ||
              user?.nombre_completo ||
              ''
            ),
          };
        })(),
      },
      autorizaciones_datos: {
        contacto_fuerza_comercial: pickSnNo(auth.contacto_fuerza_comercial),
        contacto_encuestas_confirmacion: pickSnNo(auth.contacto_encuestas_confirmacion),
        contacto_recordatorio_rtm_soat: pickSnNo(auth.contacto_recordatorio_rtm_soat),
      },
      firma_titular:
        typeof firma.data_url === 'string' && String(firma.data_url).trim().length > 0
          ? {
              data_url: String(firma.data_url),
              signed_at: String(firma.signed_at || ''),
              signer_name: String(firma.signer_name || ''),
            }
          : null,
    };
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    
    const clienteEmailNormalizado = (formData.cliente_email || '').trim().toLowerCase();
    const telDigits = (formData.cliente_telefono || '').replace(/\D/g, '');
    if (telDigits.length < 7) {
      alert('Ingrese un celular válido (mínimo 7 dígitos).');
      return;
    }
    if (!clienteEmailNormalizado || !clienteEmailNormalizado.includes('@')) {
      alert('Ingrese un correo electrónico válido.');
      return;
    }
    const dirCliente = (formData.cliente_direccion || '').trim();
    const midDigits = (clienteFactusMunicipalityId || '').replace(/\D/g, '').trim();
    const clienteFactusMunicipalityIdParsed = midDigits ? parseInt(midDigits, 10) : undefined;
    const recepcionFormatoExtra = construirFormatoExtraPayload();
    if (requiereFirmaFormato && !recepcionFormatoExtra?.firma_titular?.data_url) {
      showToast(
        'warning',
        'Firma requerida',
        'Si diligencias el Formato Prerevision debes capturar y guardar la firma del titular antes de registrar.'
      );
      return;
    }
    if (requiereFirmaFormato && !recepcionFormatoExtra?.pre_revision.firma_operario?.data_url) {
      showToast(
        'warning',
        'Firma requerida',
        'Si diligencias el Formato Prerevision debes capturar y guardar la firma del operario antes de registrar.'
      );
      return;
    }
    if (!modoEdicion && reinspeccionInfo?.elegible_reingreso && !esReingresoRechazoInicial) {
      showToast(
        'warning',
        'Confirma tipo de ingreso',
        'Esta placa tiene reinspección elegible. Marca "Sí, es reingreso por rechazo inicial" antes de registrar.'
      );
      setMostrarModalReinspeccion(true);
      return;
    }
    // Preparar datos incluyendo fotos en observaciones
    const dataConFotos = {
      ...formData,
      placa: (formData.placa || '').trim().toUpperCase(),
      cliente_documento: normalizarDocumentoCliente(formData.cliente_documento, formData.cliente_tipo_documento),
      cliente_telefono: telDigits,
      cliente_email: clienteEmailNormalizado,
      cliente_direccion: dirCliente ? dirCliente.slice(0, 300) : undefined,
      cliente_factus_municipality_id: clienteFactusMunicipalityIdParsed,
      recepcion_formato_extra: recepcionFormatoExtra,
      observaciones: JSON.stringify({
        texto: formData.observaciones || '',
        fotos: fotosVehiculo
      }),
      es_reingreso_rechazo_inicial: esReingresoRechazoInicial,
      reinspeccion_vehiculo_origen_id:
        esReingresoRechazoInicial && reinspeccionInfo?.vehiculo_origen_id
          ? reinspeccionInfo.vehiculo_origen_id
          : undefined,
    };
    
    if (modoEdicion && vehiculoEditando) {
      editarMutation.mutate({ id: vehiculoEditando, data: dataConFotos });
    } else {
      registrarMutation.mutate(dataConFotos);
    }
  };

  const handleInputChange = (field: keyof VehiculoRegistro, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFormatoTecnicoChange = (
    field: Exclude<keyof RecepcionFormatoExtra['datos_tecnicos'], 'presion_llantas'>,
    value: string
  ) => {
    setFormatoExtra((prev) => ({
      ...prev,
      datos_tecnicos: {
        ...prev.datos_tecnicos,
        [field]: value,
      },
    }));
  };

  const handlePresionLlantaChange = (posicionId: string, posicionLabel: string, isRepuesto: boolean, psiRaw: string) => {
    const psi = (psiRaw || '').replace(/[^0-9.,]/g, '').slice(0, 8);
    setFormatoExtra((prev) => {
      const existingById = new Map(
        (prev.datos_tecnicos.presion_llantas || []).map((item) => [item.posicion_id, item])
      );
      const nextItems: PresionLlantaItem[] = layoutLlantas.map((slot) => {
        const current = existingById.get(slot.id);
        if (slot.id === posicionId) {
          return {
            posicion_id: posicionId,
            posicion_label: posicionLabel,
            psi,
            is_repuesto: isRepuesto,
          };
        }
        return {
          posicion_id: slot.id,
          posicion_label: slot.label,
          psi: (current?.psi || '').trim(),
          is_repuesto: Boolean(slot.is_repuesto),
        };
      });
      return {
        ...prev,
        datos_tecnicos: {
          ...prev.datos_tecnicos,
          presion_llantas: nextItems,
          presion_inflado: buildPresionResumen(nextItems),
        },
      };
    });
  };

  const handleFormatoEncabezadoChange = (
    field: 'fecha_formato' | 'no_inspeccion' | 'tipo_vehiculo_formato',
    value: string
  ) => {
    setFormatoExtra((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const getFirmaCanvasPos = (
    canvas: HTMLCanvasElement | null,
    event: MouseEvent | ReactMouseEvent<HTMLCanvasElement> | TouchEvent | ReactTouchEvent<HTMLCanvasElement>
  ) => {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in event && event.touches.length > 0) {
      return {
        x: event.touches[0].clientX - rect.left,
        y: event.touches[0].clientY - rect.top,
      };
    }
    if ('changedTouches' in event && event.changedTouches.length > 0) {
      return {
        x: event.changedTouches[0].clientX - rect.left,
        y: event.changedTouches[0].clientY - rect.top,
      };
    }
    const mouseEvt = event as MouseEvent | ReactMouseEvent<HTMLCanvasElement>;
    return {
      x: mouseEvt.clientX - rect.left,
      y: mouseEvt.clientY - rect.top,
    };
  };

  const prepareFirmaCanvas = (canvas: HTMLCanvasElement | null, dataUrl?: string | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 640;
    const cssHeight = window.innerWidth < 640 ? 140 : 160;
    canvas.width = Math.floor(cssWidth * ratio);
    canvas.height = Math.floor(cssHeight * ratio);
    canvas.style.height = `${cssHeight}px`;
    canvas.style.touchAction = 'none';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    if (dataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
      };
      img.src = dataUrl;
    }
  };

  const iniciarTrazoFirma = (event: ReactMouseEvent<HTMLCanvasElement> | ReactTouchEvent<HTMLCanvasElement>) => {
    const canvas = firmaCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getFirmaCanvasPos(canvas, event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setFirmaDibujando(true);
    setFirmaTrazoPendiente(true);
  };

  const moverTrazoFirma = (event: ReactMouseEvent<HTMLCanvasElement> | ReactTouchEvent<HTMLCanvasElement>) => {
    if (!firmaDibujando) return;
    const canvas = firmaCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getFirmaCanvasPos(canvas, event);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const terminarTrazoFirma = () => {
    setFirmaDibujando(false);
  };

  const limpiarFirmaCanvas = () => {
    const canvas = firmaCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setFirmaTrazoPendiente(false);
    setFormatoExtra((prev) => ({
      ...prev,
      firma_titular: null,
    }));
  };

  const iniciarTrazoFirmaOperario = (event: ReactMouseEvent<HTMLCanvasElement> | ReactTouchEvent<HTMLCanvasElement>) => {
    const canvas = firmaOperarioCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getFirmaCanvasPos(canvas, event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setFirmaOperarioDibujando(true);
    setFirmaOperarioTrazoPendiente(true);
  };

  const moverTrazoFirmaOperario = (event: ReactMouseEvent<HTMLCanvasElement> | ReactTouchEvent<HTMLCanvasElement>) => {
    if (!firmaOperarioDibujando) return;
    const canvas = firmaOperarioCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getFirmaCanvasPos(canvas, event);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const terminarTrazoFirmaOperario = () => {
    setFirmaOperarioDibujando(false);
  };

  const limpiarFirmaCanvasOperario = () => {
    const canvas = firmaOperarioCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setFirmaOperarioTrazoPendiente(false);
    setFormatoExtra((prev) => ({
      ...prev,
      pre_revision: {
        ...prev.pre_revision,
        firma_operario: null,
      },
    }));
  };

  const guardarFirmaCanvas = () => {
    const canvas = firmaCanvasRef.current;
    if (!canvas) return;
    if (!firmaTrazoPendiente && !firmaCapturada) {
      showToast('warning', 'Firma vacía', 'Realiza la firma en el recuadro antes de guardar.');
      return;
    }
    const dataUrl = canvas.toDataURL('image/png');
    setFormatoExtra((prev) => ({
      ...prev,
      firma_titular: {
        data_url: dataUrl,
        signed_at: new Date().toISOString(),
        signer_name: (formData.cliente_nombre || '').trim() || 'Titular',
      },
    }));
    setFirmaTrazoPendiente(false);
    showToast('success', 'Firma guardada', 'La firma quedó registrada para este formulario.');
  };

  const guardarFirmaCanvasOperario = () => {
    const canvas = firmaOperarioCanvasRef.current;
    if (!canvas) return;
    if (!firmaOperarioTrazoPendiente && !firmaOperarioCapturada) {
      showToast('warning', 'Firma vacía', 'Realiza la firma del operario en el recuadro antes de guardar.');
      return;
    }
    const dataUrl = canvas.toDataURL('image/png');
    setFormatoExtra((prev) => ({
      ...prev,
      pre_revision: {
        ...prev.pre_revision,
        firma_operario: {
          data_url: dataUrl,
          signed_at: new Date().toISOString(),
          signer_name: (user?.nombre_completo || '').trim() || 'Operario pre-revision',
        },
      },
    }));
    setFirmaOperarioTrazoPendiente(false);
    showToast('success', 'Firma guardada', 'La firma del operario quedó registrada para este formulario.');
  };

  useEffect(() => {
    const repaint = () => prepareFirmaCanvas(firmaCanvasRef.current, formatoExtra.firma_titular?.data_url);
    repaint();
    window.addEventListener('resize', repaint);
    return () => window.removeEventListener('resize', repaint);
  }, [formatoExtra.firma_titular?.data_url, mostrarFormatoExtra, requiereFirmaFormato]);

  useEffect(() => {
    const repaint = () => prepareFirmaCanvas(firmaOperarioCanvasRef.current, formatoExtra.pre_revision.firma_operario?.data_url);
    repaint();
    window.addEventListener('resize', repaint);
    return () => window.removeEventListener('resize', repaint);
  }, [formatoExtra.pre_revision.firma_operario?.data_url, mostrarFormatoExtra, requiereFirmaFormato]);

  useEffect(() => {
    if (requiereFirmaFormato) return;
    setFormatoExtra((prev) => ({
      ...prev,
      firma_titular: null,
      pre_revision: {
        ...prev.pre_revision,
        firma_operario: null,
      },
    }));
    setFirmaTrazoPendiente(false);
    setFirmaOperarioTrazoPendiente(false);
  }, [requiereFirmaFormato]);

  useEffect(() => {
    setFormatoExtra((prev) => {
      const existingById = new Map(
        (prev.datos_tecnicos.presion_llantas || []).map((item) => [item.posicion_id, item])
      );
      const normalized: PresionLlantaItem[] = layoutLlantas.map((slot) => {
        const cur = existingById.get(slot.id);
        return {
          posicion_id: slot.id,
          posicion_label: slot.label,
          psi: (cur?.psi || '').trim(),
          is_repuesto: Boolean(slot.is_repuesto),
        };
      });
      const nextResumen = buildPresionResumen(normalized);
      const prevResumen = (prev.datos_tecnicos.presion_inflado || '').trim();
      const changedArray =
        JSON.stringify(normalized) !== JSON.stringify(prev.datos_tecnicos.presion_llantas || []);
      const changedResumen = nextResumen !== prevResumen && nextResumen.length > 0;
      if (!changedArray && !changedResumen) {
        return prev;
      }
      return {
        ...prev,
        datos_tecnicos: {
          ...prev.datos_tecnicos,
          presion_llantas: normalized,
          presion_inflado: nextResumen || prevResumen,
        },
      };
    });
  }, [layoutLlantas]);

  const handleFormatoChecklistChange = (field: keyof RecepcionFormatoExtra['preparacion_checklist'], value: SnNoNa | SnNo) => {
    setFormatoExtra((prev) => ({
      ...prev,
      preparacion_checklist: {
        ...prev.preparacion_checklist,
        [field]: value,
      },
    }));
  };

  // Mapear tipo de vehículo a tipo de comisión SOAT
  const mapearTipoVehiculoAComision = (tipoVehiculo: string): string => {
    if (tipoVehiculo === 'moto') {
      return 'moto';
    }
    // Todos los demás tipos (livianos y pesados) se mapean a 'carro'
    return 'carro';
  };

  // Calcular total con SOAT si aplica
  const calcularTotalConSOAT = () => {
    if (!tarifaCalculada) return 0;
    
    // Convertir a número para evitar concatenación de strings
    const valorTotal = Number(tarifaCalculada.valor_total);
    
    if (!formData.tiene_soat) return valorTotal;
    
    // Usar el mapeo para buscar la comisión correcta
    const tipoComision = mapearTipoVehiculoAComision(formData.tipo_vehiculo);
    const comision = comisionesSOAT?.find(c => c.tipo_vehiculo === tipoComision);
    const valorComision = comision ? Number(comision.valor_comision) : 0;
    
    return valorTotal + valorComision;
  };

  // Obtener comisión SOAT usando el mapeo
  const tipoComisionActual = mapearTipoVehiculoAComision(formData.tipo_vehiculo);
  const comisionSOAT = comisionesSOAT?.find(c => c.tipo_vehiculo === tipoComisionActual);

  // Helper para extraer fotos de observaciones
  const extraerFotosDeObservaciones = (observaciones?: string): string[] => {
    if (!observaciones) return [];
    try {
      const parsed = JSON.parse(observaciones);
      return parsed.fotos || [];
    } catch {
      return [];
    }
  };

  const escaparCsv = (value: unknown): string => {
    const text = String(value ?? '');
    if (text.includes('"') || text.includes(',') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const exportarVehiculosFiltradosCsv = async () => {
    if (exportandoListado) return;
    setExportandoListado(true);
    try {
      const paramsBase = {
        buscar: buscar || undefined,
        fecha_desde: desde || undefined,
        fecha_hasta: hasta || undefined,
      };
      const total = await vehiculosApi.contarTotal(paramsBase);
      if (!total || total <= 0) {
        showToast('warning', 'Sin datos para exportar', 'No hay vehículos en el rango/filtro seleccionado.');
        return;
      }

      const rows: Awaited<ReturnType<typeof vehiculosApi.listar>> = [];
      const batchSize = 200;
      for (let skipExport = 0; skipExport < total; skipExport += batchSize) {
        const chunk = await vehiculosApi.listar({ ...paramsBase, skip: skipExport, limit: batchSize });
        rows.push(...chunk);
      }

      const headers = [
        'id',
        'fecha_registro',
        'placa',
        'tipo_vehiculo',
        'estado',
        'cliente_nombre',
        'cliente_documento',
        'cliente_telefono',
        'cliente_email',
        'cliente_direccion',
        'total_cobrado',
        'fotos_count',
        'foto_1',
        'foto_2',
        'foto_3',
        'foto_4',
        'foto_5',
      ];
      const lines = [headers.join(',')];

      for (const vehiculo of rows) {
        const fotos = extraerFotosDeObservaciones(vehiculo.observaciones).slice(0, 5);
        const line = [
          escaparCsv(vehiculo.id),
          escaparCsv(vehiculo.fecha_registro ? new Date(vehiculo.fecha_registro).toISOString() : ''),
          escaparCsv(vehiculo.placa),
          escaparCsv(vehiculo.tipo_vehiculo),
          escaparCsv(vehiculo.estado),
          escaparCsv(vehiculo.cliente_nombre),
          escaparCsv(vehiculo.cliente_documento),
          escaparCsv(vehiculo.cliente_telefono),
          escaparCsv(vehiculo.cliente_email),
          escaparCsv(vehiculo.cliente_direccion),
          escaparCsv(vehiculo.total_cobrado),
          escaparCsv(fotos.length),
          escaparCsv(fotos[0] || ''),
          escaparCsv(fotos[1] || ''),
          escaparCsv(fotos[2] || ''),
          escaparCsv(fotos[3] || ''),
          escaparCsv(fotos[4] || ''),
        ];
        lines.push(line.join(','));
      }

      const csvContent = lines.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeDesde = (desde || 'NA').replace(/[^0-9-]/g, '');
      const safeHasta = (hasta || 'NA').replace(/[^0-9-]/g, '');
      anchor.href = url;
      anchor.download = `vehiculos_recepcion_${safeDesde}_${safeHasta}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      showToast('success', 'Exportación completada', `Se exportaron ${rows.length} vehículo(s) en CSV.`);
    } catch (error: any) {
      const detail = error?.response?.data?.detail || 'No fue posible exportar el listado.';
      showToast('error', 'Error al exportar', typeof detail === 'string' ? detail : JSON.stringify(detail));
    } finally {
      setExportandoListado(false);
    }
  };

  const cerrarPdfPreview = () => {
    setPdfPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.blobUrl);
      return null;
    });
  };

  useEffect(() => {
    if (!pdfPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrarPdfPreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pdfPreview]);

  const generarFormatoRecepcionPdf = async (vehiculoId: string, placa: string) => {
    if (descargandoFormatoVehiculoId) return;
    setDescargandoFormatoVehiculoId(vehiculoId);
    try {
      const { blob, filename } = await vehiculosApi.descargarFormatoRecepcionPdf(vehiculoId);
      if (!blob || blob.size === 0) {
        showToast('error', 'PDF vacío', 'No se pudo generar el PDF del formato de recepción.');
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      setPdfPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.blobUrl);
        return {
          blobUrl,
          title: `Formato recepción ${placa}`,
          fileName: filename || `recepcion_formato_${placa}.pdf`,
        };
      });
      showToast('success', 'PDF generado', `Se abrió la previsualización del formato para ${placa}.`);
    } catch (error: any) {
      const detail = error?.response?.data?.detail || 'No fue posible generar el PDF del formato.';
      showToast('error', 'Error al generar PDF', typeof detail === 'string' ? detail : JSON.stringify(detail));
    } finally {
      setDescargandoFormatoVehiculoId(null);
    }
  };

  return (
    <Layout title="Módulo de Recepción">
      {/* Toast ahora es GLOBAL - está en ToastProvider */}

      <div className="module-hero">
        <h2 className="module-hero-title">
          <ClipboardList className="w-8 h-8 text-primary-600" />
          Registrar Vehículo
        </h2>
        <p className="module-hero-subtitle">
          Ingrese los datos del vehículo y cliente para iniciar el proceso de inspección RTM
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulario de Registro */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="section-card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-900">
                {modoEdicion ? 'Editando Vehículo' : 'Datos del Vehículo y Cliente'}
              </h3>
              {modoEdicion && (
                <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-semibold">
                  MODO EDICIÓN
                </span>
              )}
            </div>

            {/* Los mensajes de éxito y error ahora se manejan con el componente Toast */}

            <div className="mb-6 p-4 border border-slate-200 rounded-lg bg-slate-50 space-y-3">
              <p className="text-sm font-semibold text-slate-800">
                Datos para consulta RUNT (titular)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Placa <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.placa}
                    onChange={(e) => {
                      const nextPlaca = e.target.value.toUpperCase();
                      handleInputChange('placa', nextPlaca);
                      setRuntSugerencia(null);
                      setEsReingresoRechazoInicial(false);
                      if ((nextPlaca || '').trim().toUpperCase() !== placaEvaluadaReinspeccion) {
                        setReinspeccionInfo(null);
                        setMostrarModalReinspeccion(false);
                      }
                    }}
                    required
                    className="input-pos uppercase"
                    placeholder="ABC123"
                    maxLength={10}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Tipo de documento <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={consultaRunt.document_type}
                    onChange={(e) =>
                      setConsultaRunt((prev) => ({
                        ...prev,
                        document_type: e.target.value as typeof prev.document_type,
                      }))
                    }
                    className="input-pos"
                  >
                    <option value="CC">CC</option>
                    <option value="CE">CE</option>
                    <option value="PA">PA</option>
                    <option value="NIT">NIT</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Número de documento <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={consultaRunt.document_number}
                    onChange={(e) =>
                      setConsultaRunt((prev) => ({
                        ...prev,
                        document_number: e.target.value.replace(/\D/g, ''),
                      }))
                    }
                    className="input-pos"
                    placeholder="123456789"
                    maxLength={20}
                  />
                </div>
                <div className="md:col-span-3 flex items-end">
                  <button
                    type="button"
                    onClick={consultarRunt}
                    disabled={consultarRuntMutation.isLoading}
                    className="w-full px-4 py-3 rounded-xl border border-primary-300 text-primary-700 text-sm font-medium bg-white hover:bg-primary-50 disabled:opacity-60 whitespace-nowrap"
                  >
                    {consultarRuntMutation.isLoading ? 'Consultando...' : 'Consultar RUNT'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Consulta por placa para autocompletar datos técnicos del vehículo. Los datos del cliente se registran manualmente.
              </p>
              {reinspeccionInfo?.tiene_historial && (
                <div className="mt-1 text-xs rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800 flex flex-wrap items-center gap-2">
                  <span>
                    Historial detectado para placa {reinspeccionInfo.placa}. Intentos usados: {reinspeccionInfo.intentos_usados}/
                    {reinspeccionInfo.intentos_totales_permitidos}.
                  </span>
                  <button
                    type="button"
                    onClick={() => setMostrarModalReinspeccion(true)}
                    className="underline font-semibold"
                  >
                    Ver detalle
                  </button>
                  {esReingresoRechazoInicial && reinspeccionInfo.elegible_reingreso && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700 font-semibold">
                      Reingreso sin cobro activado
                    </span>
                  )}
                </div>
              )}
              {runtSugerencia && (
                <div className="mt-2 p-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-700">
                  <p className="font-semibold mb-1">
                    {runtSugerencia.encontrado
                      ? `Sugerencias RUNT para ${runtSugerencia.placa_consultada}`
                      : `Sin datos RUNT para ${runtSugerencia.placa_consultada}`}
                  </p>
                  {runtSugerencia.encontrado && camposSugeribles.length > 0 && (
                    <>
                      <p className="mb-1">
                        {camposSugeribles.map((c) => `${c.label}: ${c.valor}`).join(' | ')}
                      </p>
                      {!runtSugerencia.titular_nombre && (
                        <p className="mb-1 text-amber-700">
                          Nombre del titular no disponible
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={aplicarSugerenciaRunt}
                        className="text-primary-700 underline font-semibold"
                      >
                        Aplicar sugerencias al formulario
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Tipo de Vehículo */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Tipo de Vehículo <span className="text-red-600">*</span>
                </label>
                <select
                  value={formData.tipo_vehiculo}
                  onChange={(e) => handleInputChange('tipo_vehiculo', e.target.value)}
                  required
                  className="input-pos"
                >
                  <option value="">Seleccione tipo...</option>
                  <option value="liviano_particular">Liviano Particular</option>
                  <option value="liviano_publico">Liviano Público</option>
                  <option value="pesado_particular">Pesado Particular</option>
                  <option value="pesado_publico">Pesado Público</option>
                  <option value="moto">Motocicleta</option>
                  <option value="preventiva">Preventiva (valor en Caja)</option>
                </select>
              </div>

              {/* Marca */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Marca
                </label>
                <input
                  type="text"
                  value={formData.marca}
                  onChange={(e) => handleInputChange('marca', e.target.value.toUpperCase())}
                  list="marcas-motos"
                  className="input-pos uppercase"
                  placeholder="Selecciona o escribe la marca"
                />
                <datalist id="marcas-motos">
                  {/* MARCAS DE CARROS - PRIORIDAD */}
                  <option value="KIA" />
                  <option value="RENAULT" />
                  <option value="TOYOTA" />
                  <option value="MAZDA" />
                  <option value="CHEVROLET" />
                  <option value="SUZUKI" />
                  <option value="VOLKSWAGEN" />
                  <option value="NISSAN" />
                  <option value="FORD" />
                  <option value="HYUNDAI" />
                  <option value="BYD" />
                  <option value="JAC" />
                  <option value="FOTON" />
                  <option value="CHERY" />
                  <option value="DFSK" />
                  <option value="GREAT WALL MOTORS" />
                  <option value="JETOUR" />
                  <option value="CHANGAN" />
                  <option value="ZEEKR" />
                  <option value="MERCEDES-BENZ" />
                  <option value="BMW" />
                  <option value="AUDI" />
                  <option value="VOLVO" />
                  <option value="LAND ROVER" />
                  <option value="MINI" />
                  <option value="PORSCHE" />
                  <option value="SUBARU" />
                  <option value="CITROËN" />
                  <option value="PEUGEOT" />
                  <option value="MITSUBISHI" />
                  <option value="HONDA" />
                  <option value="MG" />
                  <option value="SSANGYONG" />
                  {/* MARCAS DE MOTOS */}
                  <option value="YAMAHA" />
                  <option value="AKT" />
                  <option value="BAJAJ" />
                  <option value="VICTORY" />
                  <option value="TVS" />
                  <option value="HERO" />
                  <option value="KTM" />
                  <option value="KYMCO" />
                  <option value="CERONTE" />
                  <option value="ROYAL ENFIELD" />
                  <option value="BENELLI" />
                  <option value="FRATELLI" />
                  <option value="VAISAND" />
                  <option value="STARKER" />
                  <option value="DUCATI" />
                  <option value="PIAGGIO" />
                  <option value="AYCO" />
                  <option value="SYM" />
                  <option value="VENTO" />
                  <option value="CFMOTO" />
                </datalist>
              </div>

              {/* Modelo */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Modelo
                </label>
                <input
                  type="text"
                  value={formData.modelo}
                  onChange={(e) => handleInputChange('modelo', e.target.value.toUpperCase())}
                  className="input-pos uppercase"
                  placeholder="FZ16"
                />
              </div>

              {/* Año del Modelo */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Año del Modelo <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  value={formData.ano_modelo}
                  onChange={(e) => handleInputChange('ano_modelo', parseInt(e.target.value))}
                  required
                  className="input-pos"
                  min={1950}
                  max={anoActual}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Rango permitido: 1950 a {anoActual}.
                </p>
              </div>

              {/* Formato adicional recepción (opcional, colapsable) */}
              <div className="md:col-span-2 mt-1 rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setMostrarFormatoExtra((prev) => !prev)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div>
                    <p className="text-base font-semibold text-slate-900">Formato Prerevision (Opcional)</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${formatoExtraResumen.className}`}>
                      {formatoExtraResumen.estado}
                    </span>
                    {mostrarFormatoExtra ? <ChevronUp className="w-4 h-4 text-slate-600" /> : <ChevronDown className="w-4 h-4 text-slate-600" />}
                  </div>
                </button>
                {mostrarFormatoExtra && (
                  <div className="px-4 pb-4 border-t border-slate-200 space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-2 mt-3">Encabezado operativo</p>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs text-slate-600 mb-1 flex items-center justify-between">
                            <span>Fecha formato</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${formatoExtra.fecha_formato ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {formatoExtra.fecha_formato ? 'Manual' : 'Auto'}
                            </span>
                          </label>
                          <input
                            type="date"
                            className="input-pos"
                            value={formatoExtra.fecha_formato || formatTodayYmd()}
                            onChange={(e) => handleFormatoEncabezadoChange('fecha_formato', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1 flex items-center justify-between">
                            <span>No. inspección</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${formatoExtra.no_inspeccion ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {formatoExtra.no_inspeccion ? 'Manual' : 'Auto'}
                            </span>
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              className="input-pos uppercase"
                              value={formatoExtra.no_inspeccion || buildNoInspeccionProvisional(formData.placa)}
                              onChange={(e) => handleFormatoEncabezadoChange('no_inspeccion', e.target.value.toUpperCase())}
                            />
                            <button
                              type="button"
                              onClick={() => handleFormatoEncabezadoChange('no_inspeccion', '')}
                              className="px-2 py-2 rounded-md border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              title="Volver a valor autogenerado"
                            >
                              Auto
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1 flex items-center justify-between">
                            <span>Tipo vehículo (formato)</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${formatoExtra.tipo_vehiculo_formato ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {formatoExtra.tipo_vehiculo_formato ? 'Manual' : 'Auto'}
                            </span>
                          </label>
                          <input
                            type="text"
                            className="input-pos uppercase"
                            value={formatoExtra.tipo_vehiculo_formato || mapTipoVehiculoFormato(formData.tipo_vehiculo)}
                            onChange={(e) => handleFormatoEncabezadoChange('tipo_vehiculo_formato', e.target.value.toUpperCase())}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1 flex items-center justify-between">
                            <span>Versión</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Fija</span>
                          </label>
                          <div className="input-pos bg-slate-50 text-slate-700 flex items-center">{formatoExtra.version || DEFAULT_FORMAT_VERSION}</div>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        Los campos marcados como Auto se calculan por sistema y puedes ajustarlos cuando aplique.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-2">Datos técnicos del vehículo</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Clase de vehículo</label>
                          <input type="text" className="input-pos uppercase" value={formatoExtra.datos_tecnicos.clase_vehiculo} onChange={(e) => handleFormatoTecnicoChange('clase_vehiculo', e.target.value.toUpperCase())} placeholder="MOTOCICLETA" />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Marca</label>
                          <input type="text" className="input-pos uppercase" value={formatoExtra.datos_tecnicos.marca} onChange={(e) => handleFormatoTecnicoChange('marca', e.target.value.toUpperCase())} placeholder="BAJAJ" />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Línea</label>
                          <input type="text" className="input-pos uppercase" value={formatoExtra.datos_tecnicos.linea} onChange={(e) => handleFormatoTecnicoChange('linea', e.target.value.toUpperCase())} placeholder="PLATINO 125" />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Modelo</label>
                          <input type="text" className="input-pos uppercase" value={formatoExtra.datos_tecnicos.modelo} onChange={(e) => handleFormatoTecnicoChange('modelo', e.target.value.toUpperCase())} placeholder="2021" />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Color</label>
                          <input type="text" className="input-pos uppercase" value={formatoExtra.datos_tecnicos.color} onChange={(e) => handleFormatoTecnicoChange('color', e.target.value.toUpperCase())} placeholder="NEGRO" />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Servicio</label>
                          <select
                            className="input-pos uppercase"
                            value={formatoExtra.datos_tecnicos.servicio}
                            onChange={(e) => handleFormatoTecnicoChange('servicio', e.target.value)}
                          >
                            <option value="">Seleccione...</option>
                            {SERVICIO_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                            {formatoExtra.datos_tecnicos.servicio &&
                              !SERVICIO_OPTIONS.includes(formatoExtra.datos_tecnicos.servicio as (typeof SERVICIO_OPTIONS)[number]) && (
                                <option value={formatoExtra.datos_tecnicos.servicio}>
                                  {formatoExtra.datos_tecnicos.servicio}
                                </option>
                              )}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Tipo de combustible</label>
                          <select
                            className="input-pos uppercase"
                            value={formatoExtra.datos_tecnicos.tipo_combustible}
                            onChange={(e) => handleFormatoTecnicoChange('tipo_combustible', e.target.value)}
                          >
                            <option value="">Seleccione...</option>
                            <option value="GASOLINA">Gasolina</option>
                            <option value="DIESEL">Diésel</option>
                            <option value="GAS">Gas</option>
                            <option value="ELECTRICO">Electrico</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Carga/Pasajeros</label>
                          <input
                            type="text"
                            className="input-pos uppercase"
                            value={formatoExtra.datos_tecnicos.carga_pasajeros}
                            onChange={(e) => handleFormatoTecnicoChange('carga_pasajeros', e.target.value.toUpperCase())}
                            placeholder="TON / PAS"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Enseñanza</label>
                          <select
                            className="input-pos"
                            value={formatoExtra.datos_tecnicos.ensenanza}
                            onChange={(e) => handleFormatoTecnicoChange('ensenanza', e.target.value)}
                          >
                            <option value="">Seleccione...</option>
                            <option value="si">SI</option>
                            <option value="no">NO</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Blindado</label>
                          <select
                            className="input-pos"
                            value={formatoExtra.datos_tecnicos.blindado}
                            onChange={(e) => handleFormatoTecnicoChange('blindado', e.target.value)}
                          >
                            <option value="">Seleccione...</option>
                            <option value="si">SI</option>
                            <option value="no">NO</option>
                            <option value="na">N/A</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Polarizado</label>
                          <select
                            className="input-pos"
                            value={formatoExtra.datos_tecnicos.polarizado}
                            onChange={(e) => handleFormatoTecnicoChange('polarizado', e.target.value)}
                          >
                            <option value="">Seleccione...</option>
                            <option value="si">SI</option>
                            <option value="no">NO</option>
                            <option value="na">N/A</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Kilometraje</label>
                          <input
                            type="text"
                            className="input-pos uppercase"
                            value={formatoExtra.datos_tecnicos.kilometraje}
                            onChange={(e) => handleFormatoTecnicoChange('kilometraje', e.target.value.toUpperCase())}
                            placeholder="12345"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Cilindraje</label>
                          <input type="text" className="input-pos uppercase" value={formatoExtra.datos_tecnicos.cilindraje} onChange={(e) => handleFormatoTecnicoChange('cilindraje', e.target.value.toUpperCase())} placeholder="150" />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Presión de inflado</label>
                          <div className="input-pos bg-slate-50 text-slate-700 min-h-[44px] max-h-[148px] overflow-y-auto leading-6 whitespace-normal">
                            {(formatoExtra.datos_tecnicos.presion_inflado || '').trim() || 'Sin detalle aún'}
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">Se autogenera desde el detalle por llanta.</p>
                        </div>
                        <div className="md:col-span-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-semibold text-slate-700 mb-2">Detalle de presión por llanta (PSI)</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                            {layoutLlantas.map((slot) => {
                              const current = (formatoExtra.datos_tecnicos.presion_llantas || []).find(
                                (x) => x.posicion_id === slot.id
                              );
                              return (
                                <div key={slot.id} className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                                  <div className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                                    <CircleDot className="h-3.5 w-3.5 text-slate-500" />
                                    <span>{slot.label}</span>
                                    {slot.is_repuesto ? (
                                      <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                        Repuesto
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-1.5 flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      className="input-pos h-9"
                                      value={current?.psi || ''}
                                      onChange={(e) =>
                                        handlePresionLlantaChange(
                                          slot.id,
                                          slot.label,
                                          Boolean(slot.is_repuesto),
                                          e.target.value
                                        )
                                      }
                                      placeholder="PSI"
                                    />
                                    <span className="text-xs text-slate-500">PSI</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <p className="mt-2 text-[11px] text-slate-500">
                            Captura opcional por llanta. Si dejas campos vacíos, el registro continúa sin bloqueo.
                          </p>
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-xs text-slate-600 mb-1">Observaciones técnicas</label>
                          <div className="input-pos min-h-[80px] h-auto bg-slate-50 text-slate-700 whitespace-pre-wrap">
                            {(formData.observaciones || '').trim() || 'Se toma del campo Observaciones principal.'}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-2">Preparación del vehículo para inspección (SI / NO / N/A)</p>
                      <div className="space-y-2">
                        {preparacionItems.map((item) => (
                          <div key={item.key} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
                            <p className="text-sm text-slate-700">{item.label}</p>
                            <div className="flex items-center gap-2">
                              {(['si', 'no', 'na'] as const).map((value) => (
                                <button
                                  key={`${item.key}-${value}`}
                                  type="button"
                                  onClick={() => handleFormatoChecklistChange(item.key, value)}
                                  className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${
                                    formatoExtra.preparacion_checklist[item.key] === value
                                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  {value === 'si' ? 'SI' : value === 'no' ? 'NO' : 'N/A'}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => handleFormatoChecklistChange(item.key, '')}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold border border-slate-300 text-slate-500 hover:bg-slate-50"
                              >
                                Limpiar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-2">Datos del titular de datos personales</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Nombre y apellidos</label>
                          <div className="input-pos bg-slate-50 text-slate-700 flex items-center">{(formData.cliente_nombre || '').toUpperCase() || '-'}</div>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Número de cédula</label>
                          <div className="input-pos bg-slate-50 text-slate-700 flex items-center">{formData.cliente_documento || '-'}</div>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Celular / teléfono</label>
                          <div className="input-pos bg-slate-50 text-slate-700 flex items-center">{formData.cliente_telefono || '-'}</div>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Email</label>
                          <div className="input-pos bg-slate-50 text-slate-700 flex items-center">{formData.cliente_email || '-'}</div>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs text-slate-600 mb-1">Ciudad / dirección</label>
                          <div className="input-pos bg-slate-50 text-slate-700 flex items-center">{formData.cliente_direccion || '-'}</div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-2">Pre-revisión</p>
                    </div>
                    {requiereFirmaFormato && (
                      <div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                          <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3 shadow-sm">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-800">
                                Firma del titular (obligatoria)
                              </p>
                              <span
                                className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold ${
                                  firmaCapturada
                                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-100 text-amber-700 border border-amber-200'
                                }`}
                              >
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${firmaCapturada ? 'bg-emerald-600' : 'bg-amber-600'}`} />
                                {firmaCapturada ? 'Firma guardada' : 'Pendiente de firma'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mb-2">
                              Firma con dedo (móvil/tablet) o mouse (PC). Pulsa <span className="font-semibold">Guardar firma</span> para habilitar el registro.
                            </p>
                            <canvas
                              ref={firmaCanvasRef}
                              className="w-full rounded-lg border border-slate-300 bg-white"
                              style={{
                                backgroundImage:
                                  'linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px)',
                                backgroundSize: '24px 24px, 24px 24px',
                                touchAction: 'none',
                              }}
                              onMouseDown={iniciarTrazoFirma}
                              onMouseMove={moverTrazoFirma}
                              onMouseUp={terminarTrazoFirma}
                              onMouseLeave={terminarTrazoFirma}
                              onTouchStart={iniciarTrazoFirma}
                              onTouchMove={moverTrazoFirma}
                              onTouchEnd={terminarTrazoFirma}
                            />
                            <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
                              <button
                                type="button"
                                onClick={limpiarFirmaCanvas}
                                className="w-full sm:w-auto min-h-10 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Limpiar
                              </button>
                              <button
                                type="button"
                                onClick={guardarFirmaCanvas}
                                className="w-full sm:w-auto min-h-10 px-3 py-1.5 rounded-md border border-primary-500 bg-primary-600 text-xs font-semibold text-white hover:bg-primary-700"
                              >
                                Guardar firma
                              </button>
                              {firmaCapturada && (
                                <span className="text-xs text-slate-600">
                                  Firmante: <span className="font-semibold">{(formatoExtra.firma_titular?.signer_name || formData.cliente_nombre || 'Titular').toUpperCase()}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3 shadow-sm">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-800">
                                Firma de operario pre-revisión (obligatoria)
                              </p>
                              <span
                                className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold ${
                                  firmaOperarioCapturada
                                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-100 text-amber-700 border border-amber-200'
                                }`}
                              >
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${firmaOperarioCapturada ? 'bg-emerald-600' : 'bg-amber-600'}`} />
                                {firmaOperarioCapturada ? 'Firma guardada' : 'Pendiente de firma'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mb-2">
                              Firma del operario responsable de la pre-revisión. También debe guardarse antes de registrar.
                            </p>
                            <canvas
                              ref={firmaOperarioCanvasRef}
                              className="w-full rounded-lg border border-slate-300 bg-white"
                              style={{
                                backgroundImage:
                                  'linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px)',
                                backgroundSize: '24px 24px, 24px 24px',
                                touchAction: 'none',
                              }}
                              onMouseDown={iniciarTrazoFirmaOperario}
                              onMouseMove={moverTrazoFirmaOperario}
                              onMouseUp={terminarTrazoFirmaOperario}
                              onMouseLeave={terminarTrazoFirmaOperario}
                              onTouchStart={iniciarTrazoFirmaOperario}
                              onTouchMove={moverTrazoFirmaOperario}
                              onTouchEnd={terminarTrazoFirmaOperario}
                            />
                            <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
                              <button
                                type="button"
                                onClick={limpiarFirmaCanvasOperario}
                                className="w-full sm:w-auto min-h-10 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Limpiar
                              </button>
                              <button
                                type="button"
                                onClick={guardarFirmaCanvasOperario}
                                className="w-full sm:w-auto min-h-10 px-3 py-1.5 rounded-md border border-primary-500 bg-primary-600 text-xs font-semibold text-white hover:bg-primary-700"
                              >
                                Guardar firma
                              </button>
                              {firmaOperarioCapturada && (
                                <span className="text-xs text-slate-600">
                                  Firmante: <span className="font-semibold">{(formatoExtra.pre_revision.firma_operario?.signer_name || user?.nombre_completo || 'Operario pre-revision').toUpperCase()}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-2">Autorizaciones de protección de datos (SI / NO)</p>
                      <p className="text-xs text-slate-500 mb-2">Tomado del flujo de Habeas Data existente.</p>
                      <div className="space-y-2">
                        {AUTORIZACION_ITEMS.map((item) => (
                          <div key={item.key} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
                            <p className="text-sm text-slate-700">{item.label}</p>
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-1 rounded-md text-xs font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700">
                                SI
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* SOAT */}
              <div className="md:col-span-2 mt-1">
                <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer">
                  <div>
                    <p className="text-base font-semibold text-slate-900">¿Compra SOAT?</p>
                    <p className="text-xs text-slate-500">Si aplica, la comisión se suma al total a cobrar.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.tiene_soat}
                    onChange={(e) => handleInputChange('tiene_soat', e.target.checked)}
                    className="w-5 h-5 text-primary-600 border-slate-300 rounded focus:ring-primary-500"
                  />
                </label>
              </div>
            </div>

            <hr className="my-6" />

            <h4 className="text-lg font-bold text-slate-900 mb-4">Datos del Cliente</h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nombre del Cliente */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Nombre Completo <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={formData.cliente_nombre}
                  onChange={(e) => handleInputChange('cliente_nombre', e.target.value.toUpperCase())}
                  required
                  className="input-pos uppercase"
                  placeholder="JUAN PEREZ"
                />
              </div>

              {/* Documento */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Tipo de documento <span className="text-red-600">*</span>
                </label>
                <select
                  value={formData.cliente_tipo_documento}
                  onChange={(e) => {
                    const nextDocType = e.target.value as VehiculoRegistro['cliente_tipo_documento'];
                    setFormData((prev) => ({
                      ...prev,
                      cliente_tipo_documento: nextDocType,
                      cliente_documento: normalizarDocumentoCliente(prev.cliente_documento, nextDocType),
                    }));
                  }}
                  required
                  className="input-pos"
                >
                  <option value="CC">C.C.</option>
                  <option value="CE">C.E.</option>
                  <option value="PA">Pasaporte</option>
                  <option value="NIT">NIT</option>
                </select>
              </div>

              {/* Documento */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Documento <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={formData.cliente_documento}
                  onChange={(e) => {
                    handleInputChange(
                      'cliente_documento',
                      normalizarDocumentoCliente(e.target.value, formData.cliente_tipo_documento)
                    );
                  }}
                  maxLength={20}
                  required
                  className="input-pos"
                  placeholder={formData.cliente_tipo_documento === 'NIT' ? '900123456-8' : 'Número de documento'}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Puedes cambiar este documento si la factura debe salir a nombre de un tercero.
                </p>
              </div>

              {/* Celular (obligatorio — factura electrónica / notificaciones) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Celular <span className="text-red-600">*</span>
                </label>
                <input
                  type="tel"
                  value={formData.cliente_telefono}
                  onChange={(e) => handleInputChange('cliente_telefono', e.target.value)}
                  required
                  className="input-pos"
                  placeholder="3001234567"
                />
              </div>

              {/* Correo electrónico (obligatorio) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Correo electrónico <span className="text-red-600">*</span>
                </label>
                <input
                  type="email"
                  value={formData.cliente_email || ''}
                  onChange={(e) => handleInputChange('cliente_email', e.target.value.toLowerCase())}
                  required
                  className="input-pos"
                  placeholder="cliente@correo.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Dirección del cliente (opcional, factura electrónica)
                </label>
                <input
                  type="text"
                  value={formData.cliente_direccion || ''}
                  onChange={(e) => handleInputChange('cliente_direccion', e.target.value.toUpperCase())}
                  className="input-pos uppercase"
                  maxLength={300}
                  placeholder=""
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <FactusMunicipalitySearchField
                  value={clienteFactusMunicipalityId}
                  onChange={(idDigits) => {
                    setClienteFactusMunicipalityId(idDigits);
                    if (!idDigits) setClienteFactusMunicipalityLabel('');
                  }}
                  onSelectMunicipality={(item) =>
                    setClienteFactusMunicipalityLabel(
                      [item.name, item.department].filter(Boolean).join(' - ')
                    )
                  }
                  showIdInput={false}
                  showTechnicalMetadata={false}
                  searchLabel="Municipio del cliente para factura electrónica"
                  searchPlaceholder="Escriba municipio o ciudad..."
                  helperText="Escriba el municipio y selecciónelo de la lista. No necesita códigos."
                />
                {clienteFactusMunicipalityLabel ? (
                  <div className="mt-2 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                    Municipio seleccionado: {clienteFactusMunicipalityLabel}
                  </div>
                ) : clienteFactusMunicipalityId ? (
                  <div className="mt-2 inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
                    Municipio aplicado por defecto (sede/CDA)
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-slate-600">
                  Si no selecciona municipio, se usa automáticamente el configurado en la sede/CDA.
                </p>
              </div>
            </div>

            {/* Observaciones */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Observaciones
              </label>
              <textarea
                value={formData.observaciones}
                onChange={(e) => handleInputChange('observaciones', e.target.value)}
                className="input-pos"
                rows={3}
                placeholder="Observaciones adicionales..."
              />
            </div>

            <hr className="my-6" />

            {/* Captura de Fotos */}
            <CapturaFotos 
              fotos={fotosVehiculo}
              onFotosChange={setFotosVehiculo}
              maxFotos={5}
            />

            {/* Botones */}
            {bloqueoFirmaRegistro && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Debes capturar y guardar las firmas del titular y del operario para registrar cuando diligencias el Formato Prerevision.
              </div>
            )}
            <div className="flex gap-4 mt-6">
              <button
                type="submit"
                disabled={registrarMutation.isLoading || editarMutation.isLoading || bloqueoFirmaRegistro}
                className="flex-1 btn-pos btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {(registrarMutation.isLoading || editarMutation.isLoading) ? (
                  <span>{modoEdicion ? 'Actualizando...' : 'Registrando...'}</span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>{modoEdicion ? 'Actualizar Vehículo' : 'Registrar Vehículo'}</span>
                  </span>
                )}
              </button>
              {modoEdicion ? (
                <button
                  type="button"
                  onClick={cancelarEdicion}
                  className="btn-pos btn-secondary flex items-center gap-2"
                >
                  <X className="w-5 h-5" />
                  Cancelar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn-pos btn-secondary flex items-center gap-2"
                >
                  <RotateCcw className="w-5 h-5" />
                  Limpiar
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Resumen de Tarifa */}
        <div className="lg:col-span-1">
          <div className="section-card bg-primary-50/80 border-2 border-primary-200 p-5 sticky top-4">
            <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-primary-600" />
              Tarifa a Cobrar
            </h3>

            {formData.tipo_vehiculo === 'preventiva' ? (
              <div>
                <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6 text-center">
                  <DollarSign className="w-16 h-16 text-yellow-600 mx-auto mb-3" />
                  <p className="text-lg font-bold text-yellow-900 mb-2">
                    SERVICIO PREVENTIVA
                  </p>
                  <p className="text-sm text-yellow-700">
                    El valor se definirá manualmente en Caja
                  </p>
                </div>

                {formData.tiene_soat && comisionSOAT && (
                  <div className="mt-4 bg-green-50 border-2 border-green-200 rounded-lg p-3">
                    <p className="text-xs text-green-700">Comisión SOAT</p>
                    <p className="text-lg font-bold text-green-900">
                      {formatCOP(Number(comisionSOAT.valor_comision))}
                    </p>
                  </div>
                )}

                {/* Indicador de fotos */}
                {fotosVehiculo.length > 0 ? (
                  <div className="mt-4 p-3 rounded-lg bg-green-50 border-2 border-green-200">
                    <p className="text-xs font-medium mb-1 flex items-center gap-1">
                      <Camera className="w-4 h-4" />
                      <span>Fotos Capturadas</span>
                    </p>
                    <p className="text-sm font-bold text-green-900">
                      <span>{fotosVehiculo.length} {fotosVehiculo.length === 1 ? 'foto' : 'fotos'}</span>
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <p className="text-xs font-medium mb-1 flex items-center gap-1">
                      <Camera className="w-4 h-4" />
                      <span>Sin Fotos</span>
                    </p>
                    <p className="text-sm font-bold text-slate-500">
                      <span>0 fotos</span>
                    </p>
                  </div>
                )}
              </div>
            ) : tarifaCalculada ? (
              <div>
                <div className="space-y-3 mb-6">
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs text-slate-600">Año del Vehículo</p>
                    <p className="text-lg font-bold text-slate-900">{formData.ano_modelo}</p>
                    <p className="text-xs text-slate-500">{tarifaCalculada.descripcion_antiguedad}</p>
                  </div>

                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs text-slate-600">RTM</p>
                    <p className="text-lg font-bold text-slate-900">
                      {formatCOP(Number(tarifaCalculada.valor_rtm))}
                    </p>
                  </div>

                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs text-slate-600">Terceros</p>
                    <p className="text-lg font-bold text-slate-900">
                      {formatCOP(Number(tarifaCalculada.valor_terceros))}
                    </p>
                  </div>

                  {formData.tiene_soat && comisionSOAT && (
                    <div className="bg-green-50 border-2 border-green-200 rounded-lg p-3">
                      <p className="text-xs text-green-700">Comisión SOAT</p>
                      <p className="text-lg font-bold text-green-900">
                        {formatCOP(Number(comisionSOAT.valor_comision))}
                      </p>
                    </div>
                  )}
                </div>

                <div className="bg-primary-600 text-white rounded-lg p-4">
                  <p className="text-sm mb-1">TOTAL A COBRAR</p>
                  <p className="text-3xl font-bold">
                    {formatCOP(calcularTotalConSOAT())}
                  </p>
                </div>

                {/* Indicador de fotos */}
                {fotosVehiculo.length > 0 ? (
                  <div className="mt-4 p-3 rounded-lg bg-green-50 border-2 border-green-200">
                    <p className="text-xs font-medium mb-1 flex items-center gap-1">
                      <Camera className="w-4 h-4" />
                      <span>Fotos Capturadas</span>
                    </p>
                    <p className="text-sm font-bold text-green-900">
                      <span>{fotosVehiculo.length} {fotosVehiculo.length === 1 ? 'foto' : 'fotos'}</span>
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <p className="text-xs font-medium mb-1 flex items-center gap-1">
                      <Camera className="w-4 h-4" />
                      <span>Sin Fotos</span>
                    </p>
                    <p className="text-sm font-bold text-slate-500">
                      <span>0 fotos</span>
                    </p>
                  </div>
                )}
              </div>
            ) : tarifaError ? (
              <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900 mb-1">
                      Tarifa no disponible
                    </p>
                    <p className="text-sm text-amber-800">{tarifaError}</p>
                    {(user as { rol?: string } | null)?.rol === 'administrador' ? (
                      <button
                        type="button"
                        onClick={() => navigate('/tarifas')}
                        className="mt-3 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold transition"
                      >
                        Configurar tarifas ahora
                      </button>
                    ) : (
                      <p className="mt-2 text-xs text-amber-700">
                        Solicita a un administrador configurar las tarifas en el módulo Tarifas.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-500">
                  Ingrese el año del modelo para calcular la tarifa
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sección de Vehículos con Filtros y Paginación */}
      <div className="mt-8">
        {/* Header con título y estadísticas */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <h3 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Car className="w-7 h-7 text-primary-600" />
              Vehículos Registrados
            </h3>
            <p className="text-sm text-slate-600">
              {totalVehiculos} {totalVehiculos === 1 ? 'vehículo encontrado' : 'vehículos encontrados'}
            </p>
          </div>
        </div>

        {/* Barra de Búsqueda y Filtros */}
        <div className="section-card p-5 mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Barra de búsqueda */}
            <div className="lg:col-span-3 xl:col-span-4">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  value={buscar}
                  onChange={(e) => {
                    setBuscar(e.target.value);
                    setPaginaActual(1); // Reset a primera página al buscar
                  }}
                  placeholder="Buscar por placa, cédula o nombre..."
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
                />
                {buscar && (
                  <button
                    onClick={() => {
                      setBuscar('');
                      setPaginaActual(1);
                    }}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
                  </button>
                )}
              </div>
            </div>

            {/* Filtros rápidos de fecha */}
            <div className="lg:col-span-9 xl:col-span-8 flex flex-wrap lg:flex-nowrap gap-2">
              <button
                onClick={() => {
                  setFiltroFecha('hoy');
                  setPaginaActual(1);
                }}
                className={`px-3 xl:px-4 py-2 rounded-lg font-semibold transition whitespace-nowrap shrink-0 ${
                  filtroFecha === 'hoy'
                  ? 'bg-primary-600 text-white shadow-md'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              >
                <Calendar className="w-4 h-4 inline mr-2" />
                Hoy
              </button>
              <button
                onClick={() => {
                  setFiltroFecha('semana');
                  setPaginaActual(1);
                }}
                className={`px-3 xl:px-4 py-2 rounded-lg font-semibold transition whitespace-nowrap shrink-0 ${
                  filtroFecha === 'semana'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <CalendarDays className="w-4 h-4 inline mr-2" />
                Últimos 7 días
              </button>
              <button
                onClick={() => {
                  setFiltroFecha('mes');
                  setPaginaActual(1);
                }}
                className={`px-3 xl:px-4 py-2 rounded-lg font-semibold transition whitespace-nowrap shrink-0 ${
                  filtroFecha === 'mes'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <CalendarRange className="w-4 h-4 inline mr-2" />
                Últimos 30 días
              </button>
              <button
                onClick={() => setFiltroFecha('personalizado')}
                className={`px-3 xl:px-4 py-2 rounded-lg font-semibold transition whitespace-nowrap shrink-0 ${
                  filtroFecha === 'personalizado'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <BarChart3 className="w-4 h-4 inline mr-2" />
                Personalizado
              </button>
              <button
                onClick={exportarVehiculosFiltradosCsv}
                disabled={exportandoListado}
                className="px-3 xl:px-4 py-2 rounded-lg font-semibold transition bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-60 whitespace-nowrap shrink-0"
                title="Exportar listado filtrado a CSV"
              >
                <Download className="w-4 h-4 inline mr-2" />
                {exportandoListado ? 'Exportando...' : 'Exportar'}
              </button>
            </div>
          </div>

          {/* Filtro de fecha personalizado */}
          {filtroFecha === 'personalizado' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-200">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Fecha Desde
                </label>
                <input
                  type="date"
                  value={fechaDesde}
                  onChange={(e) => {
                    setFechaDesde(e.target.value);
                    setPaginaActual(1);
                  }}
                  className="input-pos"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Fecha Hasta
                </label>
                <input
                  type="date"
                  value={fechaHasta}
                  onChange={(e) => {
                    setFechaHasta(e.target.value);
                    setPaginaActual(1);
                  }}
                  className="input-pos"
                />
              </div>
            </div>
          )}
        </div>

        {/* Grid de Vehículos */}
        <ErrorBoundary>
        {loadingVehiculos ? (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner message="Cargando registro de vehículos..." />
          </div>
        ) : vehiculos && vehiculos.length > 0 ? (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {vehiculos.map((vehiculo) => {
              const fotos = extraerFotosDeObservaciones(vehiculo.observaciones);
              const primeraFoto = fotos[0];
              const tieneFormatoExtra =
                !!vehiculo.recepcion_formato_extra_json &&
                typeof vehiculo.recepcion_formato_extra_json === 'object' &&
                Object.keys(vehiculo.recepcion_formato_extra_json).length > 0;
              
              return (
                <div key={vehiculo.id} className="vehicle-card relative overflow-hidden">
                  {/* Foto del vehículo si existe */}
                  {primeraFoto ? (
                    <div className="relative mb-3 -mx-4 -mt-4">
                      <img 
                        src={primeraFoto} 
                        alt={`Vehículo ${vehiculo.placa}`}
                        className="w-full h-32 object-cover rounded-t-lg"
                      />
                      {fotos.length > 1 && (
                        <div className="absolute top-2 right-2 bg-slate-900/70 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                          <Camera className="w-3 h-3" /> {fotos.length}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="relative mb-3 -mx-4 -mt-4 bg-slate-100 h-32 flex items-center justify-center rounded-t-lg">
                      <div className="text-center">
                        <Car className="w-12 h-12 text-slate-400 mb-1" />
                        <p className="text-xs text-slate-500">Sin foto</p>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-2xl font-bold text-slate-900">{vehiculo.placa}</p>
                      <p className="text-sm text-slate-600 capitalize">{vehiculo.tipo_vehiculo}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      vehiculo.estado === 'registrado' ? 'bg-yellow-100 text-yellow-800' :
                      vehiculo.estado === 'pagado' ? 'bg-green-100 text-green-800' :
                      vehiculo.estado === 'en_pista' ? 'bg-blue-100 text-blue-800' :
                      vehiculo.estado === 'aprobado' ? 'bg-green-100 text-green-800' :
                      'bg-slate-100 text-slate-800'
                    }`}>
                      {vehiculo.estado.toUpperCase()}
                    </span>
                  </div>

                  <div className="space-y-1 text-sm">
                    <p className="text-slate-700">
                      <span className="font-semibold">Cliente:</span> {vehiculo.cliente_nombre}
                    </p>
                    <p className="text-slate-700">
                      <span className="font-semibold">Doc:</span> {vehiculo.cliente_documento}
                    </p>
                    <p className="text-slate-700">
                      <span className="font-semibold">Modelo:</span> {vehiculo.ano_modelo}
                    </p>
                    <p className="text-lg font-bold text-primary-600 mt-2">
                      {formatCOP(vehiculo.total_cobrado)}
                    </p>
                  </div>

                  {tieneFormatoExtra && (
                    <button
                      type="button"
                      onClick={() => generarFormatoRecepcionPdf(vehiculo.id, vehiculo.placa)}
                      disabled={descargandoFormatoVehiculoId === vehiculo.id}
                      className="w-full mt-3 px-3 py-2 rounded-lg border border-primary-300 text-primary-700 bg-primary-50 hover:bg-primary-100 disabled:opacity-60 disabled:cursor-not-allowed text-sm font-semibold flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      {descargandoFormatoVehiculoId === vehiculo.id ? 'Generando PDF...' : 'Generar formato'}
                    </button>
                  )}

                  {/* Botón editar (solo si estado = registrado) */}
                  {vehiculo.estado === 'registrado' && (
                    <button
                      onClick={() => iniciarEdicion(vehiculo)}
                      className="w-full mt-3 btn-pos btn-secondary flex items-center justify-center gap-2 py-2 text-sm"
                    >
                      <Edit className="w-4 h-4" />
                      Editar
                    </button>
                  )}
                </div>
              );
              })}
            </div>

            {/* Paginación */}
            {totalPaginas > 1 && (
              <div className="card-pos mt-6">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  {/* Info de página */}
                  <div className="text-sm text-slate-600">
                    Página <span className="font-bold text-slate-900">{paginaActual}</span> de{' '}
                    <span className="font-bold text-slate-900">{totalPaginas}</span>
                    <span className="mx-2">•</span>
                    Mostrando{' '}
                    <span className="font-bold text-slate-900">
                      {skip + 1}-{Math.min(skip + registrosPorPagina, totalVehiculos)}
                    </span>{' '}
                    de <span className="font-bold text-slate-900">{totalVehiculos}</span> registros
                  </div>

                  {/* Botones de paginación */}
                  <div className="flex items-center gap-2">
                    {/* Botón Primera página */}
                    <button
                      onClick={() => setPaginaActual(1)}
                      disabled={paginaActual === 1}
                      className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      title="Primera página"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                      </svg>
                    </button>

                    {/* Botón Anterior */}
                    <button
                      onClick={() => setPaginaActual(p => Math.max(1, p - 1))}
                      disabled={paginaActual === 1}
                      className="px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition"
                    >
                      ← Anterior
                    </button>

                    {/* Números de página */}
                    <div className="hidden sm:flex items-center gap-2">
                      {Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => {
                        let pageNum;
                        if (totalPaginas <= 5) {
                          pageNum = i + 1;
                        } else if (paginaActual <= 3) {
                          pageNum = i + 1;
                        } else if (paginaActual >= totalPaginas - 2) {
                          pageNum = totalPaginas - 4 + i;
                        } else {
                          pageNum = paginaActual - 2 + i;
                        }

                        return (
                          <button
                            key={pageNum}
                            onClick={() => setPaginaActual(pageNum)}
                            className={`w-10 h-10 rounded-lg font-bold transition ${
                              paginaActual === pageNum
                                ? 'bg-primary-600 text-white shadow-lg'
                                : 'border border-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>

                    {/* Botón Siguiente */}
                    <button
                      onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))}
                      disabled={paginaActual === totalPaginas}
                      className="px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition"
                    >
                      Siguiente →
                    </button>

                    {/* Botón Última página */}
                    <button
                      onClick={() => setPaginaActual(totalPaginas)}
                      disabled={paginaActual === totalPaginas}
                      className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      title="Última página"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="card-pos text-center py-12">
            <Search className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <p className="text-xl font-semibold text-slate-900 mb-2">No se encontraron vehículos</p>
            <p className="text-slate-500">
              {buscar
                ? 'Intenta con otros términos de búsqueda'
                : 'No hay vehículos registrados en el período seleccionado'}
            </p>
          </div>
        )}
        </ErrorBoundary>
      </div>

      {mostrarModalReinspeccion && reinspeccionInfo && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-base font-bold text-slate-900">Posible reingreso por rechazo inicial</h4>
                <p className="text-sm text-slate-700 mt-1">
                  La placa <span className="font-semibold">{reinspeccionInfo.placa}</span> ya tiene historial en este CDA.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="text-slate-500 text-xs">Primer intento</p>
                <p className="font-semibold text-slate-900">
                  {reinspeccionInfo.primer_intento_at
                    ? new Date(reinspeccionInfo.primer_intento_at).toLocaleString()
                    : '-'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="text-slate-500 text-xs">Intentos restantes</p>
                <p className="font-semibold text-slate-900">{reinspeccionInfo.intentos_restantes}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 sm:col-span-2">
                <p className="text-slate-500 text-xs">Vence reinspección</p>
                <p className="font-semibold text-slate-900">
                  {reinspeccionInfo.vence_at ? new Date(reinspeccionInfo.vence_at).toLocaleString() : '-'}
                </p>
                {reinspeccionInfo.motivo && (
                  <p className="text-xs text-amber-700 mt-1">{reinspeccionInfo.motivo}</p>
                )}
              </div>
            </div>
            {reinspeccionInfo.elegible_reingreso ? (
              <label className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <input
                  type="checkbox"
                  checked={esReingresoRechazoInicial}
                  onChange={(e) => setEsReingresoRechazoInicial(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Sí, este registro corresponde a reingreso por rechazo inicial (sin cobro).</span>
              </label>
            ) : (
              <p className="mt-4 text-sm text-slate-700 rounded-lg border border-slate-200 bg-slate-50 p-3">
                Este caso no es elegible para reinspección sin cobro. Puedes continuar con registro normal.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMostrarModalReinspeccion(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {pdfPreview && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pdf-preview-recepcion-titulo"
          onClick={cerrarPdfPreview}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[86vh] overflow-hidden border border-slate-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <h4
                id="pdf-preview-recepcion-titulo"
                className="font-bold text-slate-900 flex items-center gap-2 text-sm sm:text-base min-w-0 pr-2"
              >
                <FileText className="w-5 h-5 text-primary-600 shrink-0" />
                <span className="truncate">{pdfPreview.title}</span>
              </h4>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={pdfPreview.blobUrl}
                  download={pdfPreview.fileName}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                >
                  <Download className="w-4 h-4" />
                  Descargar
                </a>
                <button
                  type="button"
                  onClick={cerrarPdfPreview}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                  Cerrar
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100 flex flex-col">
              <iframe
                title={pdfPreview.title}
                src={pdfPreview.blobUrl}
                className="w-full flex-1 min-h-[70vh] border-0"
              />
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

