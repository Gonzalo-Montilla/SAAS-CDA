import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBoundary from '../components/ErrorBoundary';
import { cajasApi } from '../api/cajas';
import { vehiculosApi } from '../api/vehiculos';
import type { CorregirFacturaEmitidaPayload } from '../api/vehiculos';
import { configApi } from '../api/config';
import { factusApi } from '../api/factus';
import { proveedoresCatalogoApi } from '../api/proveedoresCatalogo';
import ProveedorCatalogoPicker from '../components/ProveedorCatalogoPicker';
import { RetencionEstimadaMotorInline } from '../components/RetencionEstimadaMotorCallout';
import { useAuth } from '../contexts/AuthContext';
import { useBrand } from '../contexts/BrandContext';
import { useToast } from '../contexts/ToastContext';
import { formatCurrency } from '../utils/formatNumber';
import { formatDateTimeShort, formatTime24, formatDateWithWeekday } from '../utils/formatDate';
import { extractApiErrorMessage } from '../utils/apiError';
import type { CajaApertura, MovimientoCaja, PosReceiptSettings, Vehiculo } from '../types';
import { 
  AlertTriangle, 
  RefreshCw, 
  Unlock, 
  BarChart3, 
  Car, 
  DollarSign, 
  Scale, 
  Wallet,
  Banknote,
  CreditCard,
  Smartphone,
  Building2,
  Lock,
  ArrowRight,
  Folder,
  Search,
  XCircle,
  CheckCircle2,
  Landmark,
  FileText,
  Link2,
  CheckSquare,
  Clock,
  Sunrise,
  Sun,
  Moon,
  ChevronUp,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Shield,
  Info,
  Eye,
  CornerUpLeft,
  Receipt,
  Printer
} from 'lucide-react';

const formatLocalDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Mismos valores que tesorería / backend `BENEFICIARIO_TIPOS_IDENTIFICACION_TESORERIA`. */
/** NIT primero por uso frecuente en proveedores jurídicos. */
const TIPOS_IDENTIFICACION_BENEFICIARIO_CAJA = [
  'NIT',
  'C.C',
  'TARJETA DE IDENTIDAD',
  'C.E',
  'PASAPORTE',
  'P.E.P',
] as const;

const saveBlobAsFile = (blob: Blob, filename: string): void => {
  if (!blob || blob.size === 0) {
    throw new Error('El comprobante llegó vacío');
  }
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
};

type PosReceiptPrintPayload = {
  nombreCda: string;
  logoUrl?: string | null;
  nitCda?: string | null;
  direccionCda?: string | null;
  telefonoCda?: string | null;
  placa: string;
  tipoVehiculo: string;
  clienteNombre: string;
  clienteDocumento: string;
  valorRTM: number;
  comisionSOAT: number;
  totalCobrado: number;
  metodoPago: string;
  numeroFacturaDIAN: string;
  fechaCobroISO: string;
  cajeroNombre: string;
  ticketWidth: '58mm' | '80mm';
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const renderPosReceiptHtml = (payload: PosReceiptPrintPayload): string => {
  const widthPx = payload.ticketWidth === '58mm' ? 220 : 300;
  const is58 = payload.ticketWidth === '58mm';
  const pageMarginMm = is58 ? 1.2 : 1.6;
  const ticketPaddingTop = is58 ? 8 : 12;
  const ticketPaddingSide = is58 ? 4 : 6;
  const ticketPaddingBottom = is58 ? 4 : 6;
  const logoTopMargin = is58 ? 2 : 4;
  const logoBottomMargin = is58 ? 8 : 10;
  const subMarginTop = is58 ? 4 : 6;
  const hrMargin = is58 ? 7 : 9;
  const sectionTitleMarginTop = is58 ? 1 : 2;
  const sectionTitleMarginBottom = is58 ? 3 : 4;
  const rowMargin = is58 ? 2 : 3;
  const footMarginTop = is58 ? 8 : 10;
  const footLineHeight = is58 ? 1.35 : 1.45;
  const logoMaxHeight = is58 ? 56 : 70;
  const fecha = new Date(payload.fechaCobroISO);
  const clienteRows = [
    ['PLACA', payload.placa],
    ['TIPO', payload.tipoVehiculo.toUpperCase()],
    ['CLIENTE', payload.clienteNombre.toUpperCase()],
    ['DOC', payload.clienteDocumento],
  ];
  const costosRows = [
    ['RTM', `$${formatCurrency(payload.valorRTM)}`],
    ['SOAT', `$${formatCurrency(payload.comisionSOAT)}`],
    ['TOTAL', `$${formatCurrency(payload.totalCobrado)}`],
  ];
  const controlRows = [
    ['PAGO', payload.metodoPago.replaceAll('_', ' ').toUpperCase()],
    ['FACTURA', payload.numeroFacturaDIAN || 'PENDIENTE'],
    ['FECHA', `${formatDateWithWeekday(fecha)} ${formatTime24(fecha)}`],
    ['CAJERO', payload.cajeroNombre.toUpperCase()],
  ];
  const renderRows = (rows: string[][]): string =>
    rows
      .map(
        ([label, val]) => `
      <div class="row">
        <span class="k">${escapeHtml(label)}</span>
        <span class="v">${escapeHtml(val)}</span>
      </div>`,
      )
      .join('');

  const normalizeLogo = (raw: string | null | undefined): string | null => {
    const v = (raw || '').trim();
    if (!v) return null;
    if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) return v;
    if (v.startsWith('/')) return v;
    return `/${v.replace(/^\/+/, '')}`;
  };
  const logoSrc = normalizeLogo(payload.logoUrl);
  const logoBlock = logoSrc
    ? `<div class="logo-wrap"><img src="${escapeHtml(logoSrc)}" alt="Logo CDA" class="logo" /></div>`
    : '';
  const nitLine = (payload.nitCda || '').trim() ? `<div class="meta">NIT: ${escapeHtml((payload.nitCda || '').trim())}</div>` : '';
  const direccionLine = (payload.direccionCda || '').trim()
    ? `<div class="meta">${escapeHtml((payload.direccionCda || '').trim())}</div>`
    : '';
  const telefonoLine = (payload.telefonoCda || '').trim()
    ? `<div class="meta">Tel: ${escapeHtml((payload.telefonoCda || '').trim())}</div>`
    : '';

  const clienteBlock = renderRows(clienteRows);
  const costosBlock = renderRows(costosRows);
  const controlBlock = renderRows(controlRows);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Recibo POS ${escapeHtml(payload.placa)}</title>
  <style>
    @page { size: auto; margin: ${pageMarginMm}mm; }
    body {
      margin: 0;
      font-family: "Courier New", monospace;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ticket { width: ${widthPx}px; margin: 0 auto; padding: ${ticketPaddingTop}px ${ticketPaddingSide}px ${ticketPaddingBottom}px; }
    .logo-wrap { text-align: center; margin-top: ${logoTopMargin}px; margin-bottom: ${logoBottomMargin}px; }
    .logo {
      max-width: ${widthPx - 24}px;
      max-height: ${logoMaxHeight}px;
      object-fit: contain;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
    .title { text-align: center; font-weight: 800; font-size: 14px; text-transform: uppercase; }
    .sub { text-align: center; font-size: 11px; margin: ${subMarginTop}px 0 4px; font-weight: 800; }
    .meta { text-align: center; font-size: 10px; line-height: 1.35; margin: 1px 0; font-weight: 700; }
    .hr { border-top: 1.5px solid #000; margin: ${hrMargin}px 0; }
    .section-title {
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
      text-align: center;
      margin: ${sectionTitleMarginTop}px 0 ${sectionTitleMarginBottom}px;
      letter-spacing: 0.3px;
    }
    .row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; margin: ${rowMargin}px 0; color: #000; }
    .k { font-weight: 800; min-width: 64px; }
    .v { text-align: right; word-break: break-word; font-weight: 700; }
    .total { font-size: 13px; font-weight: 900; color: #000; }
    .foot { text-align: center; margin-top: ${footMarginTop}px; font-size: 10px; line-height: ${footLineHeight}; font-weight: 700; color: #000; }
    .foot-brand { font-weight: 800; }
  </style>
</head>
<body>
  <div class="ticket">
    ${logoBlock}
    <div class="title">${escapeHtml(payload.nombreCda)}</div>
    ${nitLine}
    ${direccionLine}
    ${telefonoLine}
    <div class="sub">RECIBO DE PAGO RTM</div>

    <div class="hr"></div>
    <div class="section-title">Datos del servicio</div>
    ${clienteBlock}

    <div class="hr"></div>
    <div class="section-title">Detalle de costos</div>
    ${costosBlock}

    <div class="hr"></div>
    <div class="section-title">Control de operación</div>
    ${controlBlock}

    <div class="hr"></div>
    <div class="row total"><span>TOTAL</span><span>$${escapeHtml(formatCurrency(payload.totalCobrado))}</span></div>
    <div class="hr"></div>

    <div class="foot">
      La factura electrónica llegará a su correo registrado.<br/>
      Impreso por ${escapeHtml(payload.nombreCda)}.<br/>
      <span class="foot-brand">CDASOFT.</span>
    </div>
  </div>
</body>
</html>`;
};

const imprimirReciboPos = (payload: PosReceiptPrintPayload): void => {
  const popup = window.open('', '_blank', 'width=420,height=640');
  if (!popup) {
    throw new Error('No fue posible abrir la ventana de impresión. Verifica bloqueador de ventanas.');
  }

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    window.setTimeout(() => {
      try {
        popup.focus();
        popup.print();
      } catch {
        // fallback silencioso: el flujo principal ya mostró la vista previa
      }
    }, 120);
  };

  popup.document.open();
  popup.document.write(renderPosReceiptHtml(payload));
  popup.document.close();

  const logo = popup.document.querySelector('img.logo') as HTMLImageElement | null;
  if (logo && !logo.complete) {
    logo.addEventListener('load', triggerPrint, { once: true });
    logo.addEventListener('error', triggerPrint, { once: true });
    window.setTimeout(triggerPrint, 1400);
    return;
  }

  if (popup.document.readyState === 'complete') {
    triggerPrint();
    return;
  }

  popup.addEventListener('load', triggerPrint, { once: true });
  window.setTimeout(triggerPrint, 900);
};

export default function CajaPage() {
  const COBROS_RECIENTES_DIAS = 30;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [vistaActual, setVistaActual] = useState<
    'apertura' | 'cobros' | 'cobrados-hoy' | 'cobrados-recientes' | 'movimientos' | 'cierre' | 'historial' | 'impresion-pos'
  >('cobros');
  const [mostrarModalGasto, setMostrarModalGasto] = useState(false);
  const [mostrarModalVentaSOAT, setMostrarModalVentaSOAT] = useState(false);
  const [mostrarCobrosHoySinCaja, setMostrarCobrosHoySinCaja] = useState(false);
  const [mostrarCobrosRecientesSinCaja, setMostrarCobrosRecientesSinCaja] = useState(false);
  const rolActual = user && 'rol' in user ? String((user as { rol?: string }).rol || '').toLowerCase() : '';
  const esAdmin = rolActual === 'administrador';

  // Obtener caja activa
  const { data: cajaActiva, isLoading: loadingCaja, error: errorCaja } = useQuery({
    queryKey: ['caja-activa'],
    queryFn: cajasApi.obtenerActiva,
    refetchInterval: 30000, // Refrescar cada 30 segundos
    retry: 1,
  });

  // Obtener vehículos pendientes
  const { data: vehiculosPendientes, isLoading: loadingVehiculos, error: errorVehiculos } = useQuery({
    queryKey: ['vehiculos-pendientes'],
    queryFn: vehiculosApi.obtenerPendientes,
    enabled: !!cajaActiva, // Solo si hay caja activa
    refetchInterval: 20000, // Antes 10s; payload ya es liviano, 20s basta para cola
    staleTime: 8000,
    retry: 1,
  });

  // Verificar si hay caja activa
  const hayCajaActiva = !!cajaActiva;

  // Obtener resumen en tiempo real si hay caja activa
  const { data: resumenTiempoReal } = useQuery({
    queryKey: ['caja-resumen-tiempo-real', cajaActiva?.id],
    queryFn: cajasApi.obtenerResumen,
    enabled: !!cajaActiva,
    refetchInterval: 15000, // Actualizar cada 15 segundos
    retry: 1,
  });

  // Obtener vehículos cobrados hoy
  const { data: vehiculosCobradosHoy, isLoading: loadingCobradosHoy } = useQuery({
    queryKey: ['vehiculos-cobrados-hoy'],
    queryFn: vehiculosApi.obtenerCobradosHoy,
    enabled: !!cajaActiva || (esAdmin && mostrarCobrosHoySinCaja),
    refetchInterval: 30000, // Refrescar cada 30 segundos
    staleTime: 10000,
    retry: 1,
  });
  const { data: vehiculosCobradosRecientes, isLoading: loadingCobradosRecientes } = useQuery({
    queryKey: ['vehiculos-cobrados-recientes', COBROS_RECIENTES_DIAS],
    queryFn: () => vehiculosApi.obtenerCobradosRecientes(COBROS_RECIENTES_DIAS),
    enabled: !!cajaActiva || (esAdmin && mostrarCobrosRecientesSinCaja),
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 1,
  });

  if (loadingCaja) {
    return (
      <Layout title="Módulo de Caja">
        <LoadingSpinner message="Verificando estado de caja..." />
      </Layout>
    );
  }

  // Si hay error obteniendo caja
  if (errorCaja) {
    return (
      <Layout title="Módulo de Caja">
        <div className="card-pos text-center">
          <div className="flex justify-center mb-4">
            <AlertTriangle className="w-20 h-20 text-red-500" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">
            No fue posible conectar con el servidor
          </h3>
          <p className="text-gray-600 mb-4">
            No fue posible verificar el estado de la caja
          </p>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['caja-activa'] })}
            className="btn-pos btn-primary inline-flex items-center gap-2"
          >
            <RefreshCw className="w-5 h-5" />
            Reintentar
          </button>
        </div>
      </Layout>
    );
  }

  // Si no hay caja activa:
  // - Admin: puede ver "Cobros hoy" aunque no sea su caja.
  // - Cajero: flujo normal de apertura.
  if (!hayCajaActiva) {
    if (esAdmin) {
      return (
        <Layout title="Módulo de Caja">
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No tienes una caja abierta con este usuario. Como administrador puedes revisar <strong>Cobros hoy</strong>{' '}
            de la sede activa y abrir caja si lo necesitas.
          </div>
          <AperturaCaja />
          <div className="mt-6 card-pos border border-slate-200/90">
            <button
              type="button"
              onClick={() => setMostrarCobrosHoySinCaja((prev) => !prev)}
              className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Cobros de hoy {Array.isArray(vehiculosCobradosHoy) ? `(${vehiculosCobradosHoy.length})` : ''}
                </p>
                <p className="text-xs text-slate-600">
                  Historial operativo de la sede activa (solo lectura).
                </p>
              </div>
              {mostrarCobrosHoySinCaja ? (
                <ChevronUp className="h-5 w-5 text-slate-500" />
              ) : (
                <ChevronDown className="h-5 w-5 text-slate-500" />
              )}
            </button>
            {mostrarCobrosHoySinCaja && (
              <div className="mt-4">
                <VehiculosCobradosHoy
                  vehiculos={vehiculosCobradosHoy || []}
                  loading={loadingCobradosHoy}
                  modo="hoy"
                  permitirCambioMetodo={false}
                />
              </div>
            )}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setMostrarCobrosRecientesSinCaja((prev) => !prev)}
                className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Cobros últimos {COBROS_RECIENTES_DIAS} días {Array.isArray(vehiculosCobradosRecientes) ? `(${vehiculosCobradosRecientes.length})` : ''}
                  </p>
                  <p className="text-xs text-slate-600">
                    Revisión y corrección de facturas en ventana operativa.
                  </p>
                </div>
                {mostrarCobrosRecientesSinCaja ? (
                  <ChevronUp className="h-5 w-5 text-slate-500" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-slate-500" />
                )}
              </button>
              {mostrarCobrosRecientesSinCaja && (
                <div className="mt-4">
                  <VehiculosCobradosHoy
                    vehiculos={vehiculosCobradosRecientes || []}
                    loading={loadingCobradosRecientes}
                    modo="recientes"
                    permitirCambioMetodo={false}
                  />
                </div>
              )}
            </div>
          </div>
        </Layout>
      );
    }
    return (
      <Layout title="Módulo de Caja">
        <AperturaCaja />
      </Layout>
    );
  }

  // Calcular horas desde apertura
  const horasDesdeApertura = cajaActiva 
    ? (Date.now() - new Date(cajaActiva.fecha_apertura).getTime()) / (1000 * 60 * 60)
    : 0;
  const cajaAbiertaMuchoTiempo = horasDesdeApertura > 10;

  // Si hay caja activa, mostrar módulo completo
  return (
    <Layout title="Módulo de Caja">
      {cajaAbiertaMuchoTiempo && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-900">
          <Clock className="h-5 w-5 shrink-0 text-red-600" aria-hidden />
          <p className="min-w-0 flex-1 leading-relaxed">
            <span className="font-semibold">Caja abierta {Math.floor(horasDesdeApertura)}h+.</span>{' '}
            Apertura {formatDateTimeShort(cajaActiva!.fecha_apertura)}. Cierra el turno al terminar para mantener
            reportes alineados.
          </p>
          <button
            type="button"
            onClick={() => setVistaActual('cierre')}
            className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-900 shadow-sm transition hover:bg-red-50"
          >
            Ir a cierre
          </button>
        </div>
      )}

      <div className="section-card mb-4 border border-slate-200/90 p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 sm:text-2xl">
              <Wallet className="h-6 w-6 shrink-0 text-primary-600" />
              Caja activa
            </h2>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
              <span>
                <span className="text-slate-500">Turno:</span>{' '}
                <span className="font-semibold capitalize text-slate-900">{cajaActiva.turno}</span>
              </span>
              <span>
                <span className="text-slate-500">Apertura:</span>{' '}
                <span className="font-semibold text-slate-900">{formatTime24(cajaActiva.fecha_apertura)}</span>
              </span>
              <span>
                <span className="text-slate-500">Monto inicial:</span>{' '}
                <span className="font-semibold text-slate-900">${formatCurrency(cajaActiva.monto_inicial)}</span>
              </span>
            </div>
          </div>

          {resumenTiempoReal && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Efectivo esperado</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 sm:text-3xl">
                ${formatCurrency(resumenTiempoReal.saldo_esperado)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {resumenTiempoReal.vehiculos_cobrados} vehículos cobrados en este turno
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button
              type="button"
              onClick={() => setMostrarModalVentaSOAT(true)}
              className="btn-corporate-muted inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-800"
            >
              <Shield className="h-4 w-4 text-secondary-600" />
              Venta SOAT
            </button>
            <button
              type="button"
              onClick={() => setMostrarModalGasto(true)}
              className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-800 shadow-sm transition hover:bg-red-50"
            >
              <span className="inline-flex items-center gap-2">
                <ArrowRight className="h-4 w-4" />
                Registrar gasto
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-10 mb-4 rounded-xl border border-slate-200/90 bg-white/95 shadow-sm backdrop-blur-sm supports-[backdrop-filter]:bg-white/90">
        <div
          className="flex gap-0 overflow-x-auto border-b border-slate-100 px-1 pt-1 sm:px-2"
          role="tablist"
          aria-label="Secciones de caja"
        >
          {(
            [
              { id: 'cobros' as const, label: 'Pendientes', icon: Banknote, badge: vehiculosPendientes?.length, badgeClass: 'bg-rose-100 text-rose-800' },
              { id: 'cobrados-hoy' as const, label: 'Cobros hoy', icon: CheckCircle2, badge: vehiculosCobradosHoy?.length, badgeClass: 'bg-emerald-100 text-emerald-800' },
              {
                id: 'cobrados-recientes' as const,
                label: `Cobros ${COBROS_RECIENTES_DIAS} días`,
                icon: Clock,
                badge: vehiculosCobradosRecientes?.length,
                badgeClass: 'bg-amber-100 text-amber-800',
              },
              { id: 'movimientos' as const, label: 'Movimientos', icon: Receipt, badge: undefined, badgeClass: '' },
              { id: 'historial' as const, label: 'Historial', icon: Folder, badge: undefined, badgeClass: '' },
              { id: 'impresion-pos' as const, label: 'Impresión POS', icon: Printer, badge: undefined, badgeClass: '' },
              { id: 'cierre' as const, label: 'Cierre', icon: Lock, badge: undefined, badgeClass: '' },
            ] as const
          ).map(({ id, label, icon: Icon, badge, badgeClass }) => {
            const active = vistaActual === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setVistaActual(id)}
                className={`flex min-w-[6.5rem] shrink-0 items-center justify-center gap-2 rounded-t-lg px-3 py-2.5 text-sm font-semibold transition-colors sm:min-w-0 sm:px-4 ${
                  active
                    ? 'border-b-2 border-primary-600 bg-primary-50/80 text-primary-900'
                    : 'border-b-2 border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
                {badge != null && badge > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badgeClass}`}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Contenido según vista */}
      {vistaActual === 'cobros' && (
        <VehiculosPendientes 
          vehiculos={vehiculosPendientes || []} 
          loading={loadingVehiculos}
          error={errorVehiculos}
        />
      )}

      {vistaActual === 'cobrados-hoy' && (
        <VehiculosCobradosHoy 
          vehiculos={vehiculosCobradosHoy || []} 
          loading={loadingCobradosHoy}
          modo="hoy"
        />
      )}

      {vistaActual === 'cobrados-recientes' && (
        <VehiculosCobradosHoy
          vehiculos={vehiculosCobradosRecientes || []}
          loading={loadingCobradosRecientes}
          modo="recientes"
        />
      )}

      {vistaActual === 'movimientos' && (
        <MovimientosCaja />
      )}

      {vistaActual === 'cierre' && (
        <ErrorBoundary>
          <CierreCaja cajaId={cajaActiva.id} onCerrado={() => {
            queryClient.invalidateQueries({ queryKey: ['caja-activa'] });
            setVistaActual('cobros');
          }} />
        </ErrorBoundary>
      )}

      {vistaActual === 'historial' && (
        <HistorialCajas />
      )}

      {vistaActual === 'impresion-pos' && <PosReceiptSettingsPanel />}

      {/* Modal de Registro de Gasto */}
      {mostrarModalGasto && (
        <ModalGasto
          onClose={() => setMostrarModalGasto(false)}
          onSuccess={() => {
            setMostrarModalGasto(false);
            queryClient.invalidateQueries({ queryKey: ['vehiculos-pendientes'] });
          }}
        />
      )}

      {/* Modal de Venta Solo SOAT */}
      {mostrarModalVentaSOAT && (
        <ModalVentaSOAT
          onClose={() => setMostrarModalVentaSOAT(false)}
          onSuccess={() => {
            setMostrarModalVentaSOAT(false);
            queryClient.invalidateQueries({ queryKey: ['caja-resumen-tiempo-real'] });
          }}
        />
      )}
    </Layout>
  );
}

// Componente de Apertura de Caja
function AperturaCaja() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [formData, setFormData] = useState<CajaApertura>({
    monto_inicial: 50000,
    turno: 'mañana',
  });

  // Obtener resumen de la última caja cerrada
  const { data: ultimaCaja } = useQuery({
    queryKey: ['ultima-caja-cerrada'],
    queryFn: cajasApi.obtenerUltimaCerrada,
    retry: 1,
  });

  const abrirMutation = useMutation({
    mutationFn: cajasApi.abrir,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caja-activa'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validar que el monto inicial no sea negativo
    if (formData.monto_inicial < 0) {
      showToast('warning', 'Monto inválido', 'El monto inicial no puede ser negativo.');
      return;
    }
    
    // Advertir si el monto es $0 o muy bajo
    if (formData.monto_inicial === 0) {
      const confirmar = window.confirm(
        `Vas a abrir la caja con $0.\n\n` +
        `Asegúrate de tener efectivo disponible para dar cambio a los clientes.\n\n` +
        `¿Deseas continuar?`
      );
      if (!confirmar) {
        return;
      }
    } else if (formData.monto_inicial < 20000) {
      const confirmar = window.confirm(
        `El monto inicial es muy bajo ($${formatCurrency(formData.monto_inicial)}).\n\n` +
        `Podrías no tener suficiente cambio para los clientes.\n\n` +
        `¿Deseas continuar de todas formas?`
      );
      if (!confirmar) {
        return;
      }
    }
    
    abrirMutation.mutate(formData);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card-pos text-center mb-8">
        <div className="flex justify-center mb-4">
          <Unlock className="w-20 h-20 text-primary-600" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">
          No hay caja activa
        </h2>
        <p className="text-gray-600">
          Debes abrir caja para comenzar a recibir pagos
        </p>
      </div>

      {/* Resumen de la Última Caja Cerrada */}
      {ultimaCaja && (
        <div className="card-pos mb-8 bg-gradient-to-r from-blue-50 to-cyan-50">
          <div className="flex items-center gap-3 mb-4">
            <BarChart3 className="w-8 h-8 text-primary-600" />
            <h3 className="text-xl font-bold text-gray-900">
              Última Caja Cerrada - Turno {ultimaCaja.turno.charAt(0).toUpperCase() + ultimaCaja.turno.slice(1)}
            </h3>
          </div>
          <p className="text-sm text-gray-600 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {new Date(ultimaCaja.fecha_cierre).toLocaleDateString('es-CO', {
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4 text-center">
              <p className="text-xs text-gray-600 mb-1 flex items-center justify-center gap-1">
                <Car className="w-4 h-4" /> Vehículos
              </p>
              <p className="text-2xl font-bold text-gray-900">{ultimaCaja.vehiculos_cobrados}</p>
            </div>
            <div className="bg-white rounded-lg p-4 text-center">
              <p className="text-xs text-gray-600 mb-1 flex items-center justify-center gap-1">
                <DollarSign className="w-4 h-4" /> Ingresos
              </p>
              <p className="text-2xl font-bold text-secondary-700">
                ${formatCurrency(ultimaCaja.total_ingresos)}
              </p>
            </div>
            <div className="bg-white rounded-lg p-4 text-center">
              <p className="text-xs text-gray-600 mb-1 flex items-center justify-center gap-1">
                <Scale className="w-4 h-4" /> Diferencia
              </p>
              <p className={`text-2xl font-bold flex items-center justify-center gap-1 ${
                ultimaCaja.diferencia === 0 
                  ? 'text-secondary-700'
                  : ultimaCaja.diferencia > 0
                  ? 'text-primary-700'
                  : 'text-red-700'
              }`}>
                {ultimaCaja.diferencia === 0 ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : (
                  (ultimaCaja.diferencia > 0 ? '+' : '') + '$' + formatCurrency(ultimaCaja.diferencia)
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="card-pos">
        <h3 className="text-2xl font-bold text-gray-900 mb-6">Abrir Caja</h3>

        {abrirMutation.isError && (
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800 font-semibold text-center flex items-center justify-center gap-2">
              <XCircle className="w-5 h-5" />
              {(abrirMutation.error as Error & { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'No fue posible abrir la caja.'}
            </p>
          </div>
        )}

        <div className="space-y-6">
          {/* Monto Inicial */}
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-2 flex items-center gap-2">
              <Banknote className="w-5 h-5" />
              Monto Inicial en Efectivo
            </label>
            <input
              type="number"
              value={formData.monto_inicial}
              onChange={(e) => setFormData({ ...formData, monto_inicial: parseFloat(e.target.value) })}
              required
              min="0"
              step="any"
              className="input-pos text-2xl text-center"
              placeholder="50000"
            />
            <p className="text-sm text-gray-500 mt-2 text-center">
              Base de efectivo para dar cambio. Puede ser $0 pero asegúrate de tener cambio disponible.
            </p>
          </div>

          {/* Turno */}
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-2 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Turno de Trabajo
            </label>
            <div className="grid grid-cols-3 gap-4">
              {(['mañana', 'tarde', 'noche'] as const).map((turno) => (
                <button
                  key={turno}
                  type="button"
                  onClick={() => setFormData({ ...formData, turno })}
                  className={`py-4 rounded-lg font-semibold text-lg transition-all ${
                    formData.turno === turno
                      ? 'bg-primary-600 text-white shadow-lg scale-105'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  <div className="flex justify-center mb-2">
                    {turno === 'mañana' ? (
                      <Sunrise className="w-8 h-8" />
                    ) : turno === 'tarde' ? (
                      <Sun className="w-8 h-8" />
                    ) : (
                      <Moon className="w-8 h-8" />
                    )}
                  </div>
                  <div className="capitalize">{turno}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Botón Submit */}
          <button
            type="submit"
            disabled={abrirMutation.isLoading}
            className="w-full btn-pos btn-success disabled:opacity-50 text-xl inline-flex items-center justify-center gap-2"
          >
            {abrirMutation.isLoading ? (
              'Abriendo caja...'
            ) : (
              <>
                <Unlock className="w-6 h-6" />
                Abrir Caja
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

// Componente de Vehículos Pendientes
function VehiculosPendientes({ 
  vehiculos, 
  loading, 
  error 
}: { 
  vehiculos: Vehiculo[], 
  loading: boolean,
  error: unknown
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [vehiculoSeleccionado, setVehiculoSeleccionado] = useState<Vehiculo | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [sarlaftEscalationNotice, setSarlaftEscalationNotice] = useState<string | null>(null);
  const [expandedExtras, setExpandedExtras] = useState<Record<string, boolean>>({});
  const [posReceiptPayload, setPosReceiptPayload] = useState<PosReceiptPrintPayload | null>(null);
  const { data: posReceiptSettings } = useQuery({
    queryKey: ['pos-receipt-settings'],
    queryFn: configApi.obtenerPosReceiptSettings,
    staleTime: 60_000,
    retry: 1,
  });

  const valueOrDash = (value?: string | number | null): string => {
    if (value === null || value === undefined) return '—';
    const txt = String(value).trim();
    return txt.length > 0 ? txt : '—';
  };

  const extractKilometraje = (vehiculo: Vehiculo): string => {
    if (vehiculo.kilometraje != null && String(vehiculo.kilometraje).trim()) {
      return valueOrDash(vehiculo.kilometraje);
    }
    const extra = vehiculo.recepcion_formato_extra_json as Record<string, unknown> | null | undefined;
    const datosTecnicos = extra && typeof extra === 'object'
      ? (extra.datos_tecnicos as Record<string, unknown> | undefined)
      : undefined;
    const rawKm = datosTecnicos?.kilometraje;
    return valueOrDash(rawKm as string | number | null | undefined);
  };

  const toggleExtras = (vehiculoId: string) => {
    setExpandedExtras((prev) => ({ ...prev, [vehiculoId]: !prev[vehiculoId] }));
  };

  const notificarPasoCaja = (vehiculo: Vehiculo) => {
    void vehiculosApi.notificarPasoCaja(vehiculo.id)
      .then((result) => {
        // Solo avisar cuando hay problema de envío o no existe email.
        if (!result.sent) {
          if (!result.has_email) {
            console.info(`Sin correo para notificación de caja: ${vehiculo.placa}`);
            return;
          }
          showToast(
            'warning',
            'Notificación no enviada',
            'El cobro puede continuar, pero no se envió aviso por correo al cliente.',
          );
        }
      })
      .catch(() => {
        // No bloquear apertura del flujo de cobro por fallo de notificación.
        showToast('warning', 'Correo no enviado', 'El cobro puede continuar; falló la notificación al cliente.');
      });
  };

  const abrirCobro = (vehiculo: Vehiculo) => {
    notificarPasoCaja(vehiculo);
    setVehiculoSeleccionado(vehiculo);
  };
  const sarlaftEscalationModal = sarlaftEscalationNotice ? (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm">
      <div
        className="modal-panel w-full max-w-lg border border-rose-200 bg-white p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Alerta SARLAFT para cajera"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-slate-900">Alerta SARLAFT detectada</h4>
            <p className="mt-1 text-sm text-slate-700">
              Remite al cliente al Oficial de Cumplimiento para validación del formulario DDI.
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {sarlaftEscalationNotice}
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="btn-corporate-primary px-4"
            onClick={() => setSarlaftEscalationNotice(null)}
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const posPromptModal = posReceiptPayload ? (
    <PosReceiptPromptModal
      payload={posReceiptPayload}
      onClose={() => setPosReceiptPayload(null)}
    />
  ) : null;

  if (loading) {
    return (
      <>
        <LoadingSpinner message="Cargando vehículos pendientes de cobro..." />
        {posPromptModal}
      </>
    );
  }

  if (error) {
    return (
      <div className="card-pos text-center py-12">
        <div className="flex justify-center mb-4">
          <XCircle className="w-20 h-20 text-red-500" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">
          No fue posible cargar los vehículos
        </h3>
        <p className="text-gray-600 mb-4">
          No se pudieron obtener los vehículos pendientes
        </p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['vehiculos-pendientes'] })}
          className="btn-pos btn-primary inline-flex items-center gap-2"
        >
          <RefreshCw className="w-5 h-5" />
          Reintentar
        </button>
        {posPromptModal}
        {sarlaftEscalationModal}
      </div>
    );
  }

  // Validación adicional de seguridad
  if (!Array.isArray(vehiculos)) {
    console.error('vehiculos no es un array:', vehiculos);
    return (
      <div className="card-pos text-center py-12">
        <div className="flex justify-center mb-4">
          <AlertTriangle className="w-20 h-20 text-yellow-500" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">
          Error en el formato de datos
        </h3>
        <p className="text-gray-600 mb-4">
          Los datos recibidos del servidor no tienen el formato esperado
        </p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['vehiculos-pendientes'] })}
          className="btn-pos btn-primary inline-flex items-center gap-2"
        >
          <RefreshCw className="w-5 h-5" />
          Reintentar
        </button>
        {posPromptModal}
        {sarlaftEscalationModal}
      </div>
    );
  }

  if (vehiculos.length === 0) {
    return (
      <div className="card-pos text-center py-12">
        <div className="flex justify-center mb-4">
          <CheckCircle2 className="w-20 h-20 text-green-500" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">
          No hay vehículos pendientes
        </h3>
        <p className="text-gray-600">
          Todos los vehículos registrados han sido cobrados
        </p>
        {posPromptModal}
        {sarlaftEscalationModal}
      </div>
    );
  }

  // Filtrar vehículos por búsqueda
  const vehiculosFiltrados = vehiculos.filter(vehiculo => {
    const termino = busqueda.toLowerCase();
    return (
      vehiculo.placa.toLowerCase().includes(termino) ||
      vehiculo.cliente_nombre.toLowerCase().includes(termino) ||
      vehiculo.cliente_documento.includes(termino)
    );
  });

  return (
    <div>
      {/* Buscador */}
      <div className="mb-6">
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2">
            <Search className="w-6 h-6 text-gray-400" />
          </div>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por placa, nombre o documento..."
            className="w-full pl-14 pr-4 py-4 text-lg border-2 border-gray-300 rounded-xl focus:border-primary-500 focus:ring-2 focus:ring-primary-200 transition-all"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
          )}
        </div>
        {busqueda && (
          <p className="text-sm text-gray-600 mt-2 flex items-center gap-1">
            <BarChart3 className="w-4 h-4" />
            Mostrando {vehiculosFiltrados.length} de {vehiculos.length} vehículos
          </p>
        )}
      </div>

      {vehiculosFiltrados.length === 0 ? (
        <div className="card-pos text-center py-12">
          <div className="flex justify-center mb-4">
            <Search className="w-16 h-16 text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            No se encontraron vehículos
          </h3>
          <p className="text-gray-600 mb-4">
            No hay resultados para "{busqueda}"
          </p>
          <button
            onClick={() => setBusqueda('')}
            className="btn-pos btn-secondary"
          >
            Limpiar búsqueda
          </button>
          {posPromptModal}
        </div>
      ) : (
        <ErrorBoundary>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {vehiculosFiltrados.map((vehiculo) => {
            const correoDisplay = valueOrDash(vehiculo.cliente_email);
            const correoLargo = correoDisplay !== '—' && correoDisplay.length > 28;
            return (
            <div key={vehiculo.id} className="vehicle-card flex flex-col text-left">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-2xl font-bold tracking-wide text-slate-900 sm:text-3xl">{vehiculo.placa}</p>
                  <p className="text-sm capitalize text-slate-600">{vehiculo.tipo_vehiculo}</p>
                  {vehiculo.reinspeccion_exenta && (
                    <p className="mt-1 text-xs font-semibold text-emerald-700">
                      Reintento por rechazo inicial · intento {vehiculo.reinspeccion_intento || 2}/3
                    </p>
                  )}
                  {vehiculo.tipo_vehiculo === 'pruebas_auditoria' && (
                    <p className="mt-1 text-xs font-semibold text-cyan-700">
                      Prueba de auditoría · sin cobro
                    </p>
                  )}
                </div>
                {vehiculo.reinspeccion_exenta ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
                    Reintento
                  </span>
                ) : vehiculo.tipo_vehiculo === 'pruebas_auditoria' ? (
                  <span className="shrink-0 rounded-full bg-cyan-100 px-2.5 py-0.5 text-xs font-semibold text-cyan-900">
                    Auditoría
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                    Pendiente
                  </span>
                )}
              </div>

              <div className="mb-4 space-y-1 text-sm text-slate-700">
                <p>
                  <span className="font-semibold text-slate-800">Cliente:</span> {vehiculo.cliente_nombre}
                </p>
                <p>
                  <span className="font-semibold text-slate-800">Documento:</span> {vehiculo.cliente_documento}
                </p>
                <p>
                  <span className="font-semibold text-slate-800">Modelo:</span> {vehiculo.ano_modelo}
                </p>
              </div>

              <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
                <button
                  type="button"
                  onClick={() => toggleExtras(vehiculo.id)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100/70"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Info className="h-4 w-4 text-slate-500" />
                    {expandedExtras[vehiculo.id] ? 'Ocultar datos adicionales' : 'Ver datos adicionales'}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5">
                    {expandedExtras[vehiculo.id] ? (
                      <ChevronUp className="h-4 w-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    )}
                  </span>
                </button>
                <div
                  className={`grid transition-all duration-200 ease-out ${
                    expandedExtras[vehiculo.id]
                      ? 'max-h-80 grid-rows-[1fr] border-t border-slate-200 opacity-100'
                      : 'max-h-0 grid-rows-[0fr] border-t border-transparent opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="grid grid-cols-1 gap-2 px-3 py-2.5 md:grid-cols-2">
                      <div className={`min-w-0 ${correoLargo ? 'md:col-span-2' : ''}`}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Correo</p>
                        <p className="mt-0.5 text-sm font-medium text-slate-800 break-all">
                          {correoDisplay}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Celular</p>
                        <p className="mt-0.5 text-sm font-medium text-slate-800 break-words">
                          {valueOrDash(vehiculo.cliente_telefono)}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Dirección</p>
                        <p className="mt-0.5 text-sm font-medium text-slate-800 break-words">
                          {valueOrDash(vehiculo.cliente_direccion)}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Kilometraje</p>
                        <p className="mt-0.5 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-sm font-semibold text-slate-800">
                          {extractKilometraje(vehiculo)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/90 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total a cobrar</p>
                <p className="text-2xl font-bold tabular-nums text-slate-900">
                  ${formatCurrency(
                    vehiculo.reinspeccion_exenta || vehiculo.tipo_vehiculo === 'pruebas_auditoria'
                      ? 0
                      : vehiculo.total_cobrado
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={() => abrirCobro(vehiculo)}
                className="btn-primary-solid mt-auto inline-flex w-full items-center justify-center gap-2 py-3 text-base font-semibold"
              >
                <CreditCard className="h-5 w-5 shrink-0" />
                {vehiculo.reinspeccion_exenta
                  ? 'Validar reintento'
                  : vehiculo.tipo_vehiculo === 'pruebas_auditoria'
                    ? 'Validar auditoría'
                    : 'Cobrar'}
              </button>
            </div>
            );
          })}
          </div>
        </ErrorBoundary>
      )}

      {/* Modal de Cobro */}
      {vehiculoSeleccionado && (
        <ErrorBoundary>
          <ModalCobro
            vehiculo={vehiculoSeleccionado}
            onClose={() => setVehiculoSeleccionado(null)}
            onSarlaftEscalation={(message) => setSarlaftEscalationNotice(message)}
            posReceiptSettings={posReceiptSettings}
            onCobroExitoso={(payload) => setPosReceiptPayload(payload)}
          />
        </ErrorBoundary>
      )}
      {posPromptModal}
      {sarlaftEscalationModal}
    </div>
  );
}

// Componente Modal de Cobro
function ModalCobro({
  vehiculo,
  onClose,
  onSarlaftEscalation,
  posReceiptSettings,
  onCobroExitoso,
}: {
  vehiculo: Vehiculo,
  onClose: () => void,
  onSarlaftEscalation: (message: string) => void,
  posReceiptSettings?: PosReceiptSettings | null,
  onCobroExitoso: (payload: PosReceiptPrintPayload | null) => void,
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { user } = useAuth();
  const tenantUser = user && 'tenant_branding' in user ? user : null;
  const brand = useBrand();
  const isMountedRef = useRef(true);
  const metodoPagoFocusRef = useRef<HTMLButtonElement>(null);
  const [metodoPago, setMetodoPago] = useState<string>('efectivo');
  const [registros, setRegistros] = useState({
    registrado_runt: false,
    registrado_sicov: false,
    registrado_indra: false,
  });
  const [numeroFactura, setNumeroFactura] = useState('');
  const [clientePagaSOAT, setClientePagaSOAT] = useState(vehiculo.tiene_soat);
  
  // Estado para valor manual de PREVENTIVA
  const [valorPreventiva, setValorPreventiva] = useState<string>('');
  const esPreventiva = vehiculo.tipo_vehiculo === 'preventiva';
  const esReintentoExento = Boolean(vehiculo.reinspeccion_exenta);
  const esPruebaAuditoria = vehiculo.tipo_vehiculo === 'pruebas_auditoria';
  const esCobroExento = esReintentoExento || esPruebaAuditoria;
  
  // Estado para desglose de pago mixto
  const [desgloseMixto, setDesgloseMixto] = useState({
    efectivo: 0,
    tarjeta_debito: 0,
    tarjeta_credito: 0,
    transferencia: 0,
    credismart: 0,
    sistecredito: 0,
  });

  const valorPreventivaNum = Number(valorPreventiva || 0);

  // Calcular total a cobrar ajustado
  const calcularTotalAjustado = () => {
    if (esCobroExento) return 0;
    if (esPreventiva) {
      const valorBase = valorPreventivaNum || 0;
      const comision = clientePagaSOAT ? vehiculo.comision_soat : 0;
      return valorBase + comision;
    }
    return clientePagaSOAT ? vehiculo.total_cobrado : (vehiculo.total_cobrado - vehiculo.comision_soat);
  };
  
  const totalAjustado = calcularTotalAjustado();

  // Obtener URLs de sistemas externos
  const { data: urls, isLoading: loadingUrls } = useQuery({
    queryKey: ['urls-externas'],
    queryFn: configApi.obtenerURLsExternas,
    staleTime: 1000 * 60 * 60, // Cache por 1 hora
    retry: 1,
  });

  const { data: factusSettings, isLoading: loadingFactusSettings } = useQuery({
    queryKey: ['factus-settings'],
    queryFn: factusApi.getSettings,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const modoFactus = factusSettings?.modo === 'factus';

  // Calcular suma del desglose mixto
  const sumaMixto = Object.values(desgloseMixto).reduce((acc, val) => acc + val, 0);
  // Tolerancia de 1 peso para errores de redondeo
  const desgloseMixtoValido = metodoPago === 'mixto' ? Math.abs(sumaMixto - totalAjustado) < 1 : true;
  
  // Validar registros externos; en modo Factus no se exige número DIAN manual (se emite al confirmar)
  const facturaOk =
    modoFactus || (!loadingFactusSettings && !!numeroFactura.trim());
  const todosRegistrados =
    esCobroExento ||
    (registros.registrado_runt && registros.registrado_sicov && registros.registrado_indra && facturaOk);
  
  // Validar que si es preventiva, tenga valor
  const preventivaTieneValor = esCobroExento ? true : (esPreventiva ? valorPreventivaNum > 0 : true);
  
  const puedeConfirmarCobro = todosRegistrados && preventivaTieneValor && desgloseMixtoValido;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const cobrarMutation = useMutation({
    mutationFn: vehiculosApi.cobrar,
    onSuccess: async (vehiculoCobrado) => {
      if (esCobroExento) {
        if (!isMountedRef.current) return;
        showToast(
          'success',
          esPruebaAuditoria ? 'Prueba de auditoría validada' : 'Reintento validado',
          esPruebaAuditoria
            ? `La placa ${vehiculoCobrado.placa} quedó habilitada para continuar a Calidad (sin cobro).`
            : `La placa ${vehiculoCobrado.placa} quedó habilitada para continuar a Calidad (sin cobro).`,
        );
        setTimeout(() => {
          if (!isMountedRef.current) return;
          queryClient.invalidateQueries({ queryKey: ['vehiculos-pendientes'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard-operativo'] });
        }, 300);
        onClose();
        return;
      }
      // Generar PDF del recibo de pago
      const comisionFinal = clientePagaSOAT ? vehiculo.comision_soat : 0;
      const { generarPDFReciboPagoParaEnvio } = await import('../utils/generarPDFReciboPago');
      const { nombreArchivo, blob } = await generarPDFReciboPagoParaEnvio({
        placa: vehiculoCobrado.placa,
        tipoVehiculo: vehiculoCobrado.tipo_vehiculo,
        marca: vehiculoCobrado.marca,
        modelo: vehiculoCobrado.modelo,
        anoModelo: vehiculoCobrado.ano_modelo,
        clienteNombre: vehiculoCobrado.cliente_nombre,
        clienteDocumento: vehiculoCobrado.cliente_documento,
        valorRTM: vehiculoCobrado.valor_rtm,
        comisionSOAT: comisionFinal,
        totalCobrado: totalAjustado,
        metodoPago: metodoPago,
        numeroFacturaDIAN: vehiculoCobrado.numero_factura_dian || numeroFactura,
        fecha: new Date(),
        nombreCajero: user?.nombre_completo || 'Cajero',
        logoUrl: brand.logoSrc,
      });

      // Descargar localmente el mismo PDF que se adjunta por correo.
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = nombreArchivo;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);

      // Enviar por correo el MISMO recibo generado en caja (no bloqueante).
      let emailStatusNote = '';
      try {
        const receiptFile = new File([blob], nombreArchivo, { type: 'application/pdf' });
        const emailResult = await vehiculosApi.enviarReciboPagoEmail(vehiculoCobrado.id, receiptFile);
        if (!emailResult.sent) {
          emailStatusNote = emailResult.has_email
            ? '\nAviso: no fue posible enviar el recibo por correo.'
            : '\nAviso: cliente sin correo registrado, no se envió email.';
        } else if (emailResult.factura_incluida) {
          emailStatusNote = emailResult.factura_adjunto_pdf
            ? '\nCorreo enviado con recibo y factura electrónica (PDF adjunto y enlace).'
            : '\nCorreo enviado con recibo y enlace a la factura electrónica (DIAN).';
        }
      } catch {
        emailStatusNote = '\nAviso: falló el envío del recibo por correo.';
      }

      if (!isMountedRef.current) {
        return;
      }

      showToast(
        'success',
        'Cobro registrado',
        `Recibo: ${nombreArchivo}${emailStatusNote.replace(/^\n+/, ' ').replace(/\n/g, ' ')}`,
      );
      if (posReceiptSettings?.tenant_enabled && posReceiptSettings.auto_prompt_after_payment) {
        onCobroExitoso({
          nombreCda: posReceiptSettings.tenant_name || tenantUser?.tenant_branding?.nombre_comercial || 'CDASOFT',
          logoUrl: posReceiptSettings.tenant_logo_url || tenantUser?.tenant_branding?.logo_url || null,
          nitCda: posReceiptSettings.tenant_nit || null,
          direccionCda: posReceiptSettings.tenant_direccion || null,
          telefonoCda: posReceiptSettings.tenant_telefono || null,
          placa: vehiculoCobrado.placa,
          tipoVehiculo: vehiculoCobrado.tipo_vehiculo,
          clienteNombre: vehiculoCobrado.cliente_nombre,
          clienteDocumento: vehiculoCobrado.cliente_documento,
          valorRTM: vehiculoCobrado.valor_rtm,
          comisionSOAT: comisionFinal,
          totalCobrado: totalAjustado,
          metodoPago,
          numeroFacturaDIAN: vehiculoCobrado.numero_factura_dian || numeroFactura || '',
          fechaCobroISO: vehiculoCobrado.fecha_pago || new Date().toISOString(),
          cajeroNombre: user?.nombre_completo || 'Cajero',
          ticketWidth: posReceiptSettings.ticket_width || '80mm',
        });
      } else {
        onCobroExitoso(null);
      }
      if (vehiculoCobrado.sarlaft_alert_generated) {
        onSarlaftEscalation(
          vehiculoCobrado.sarlaft_alert_message ||
            'Remite al cliente con el Oficial de Cumplimiento para DDI obligatoria.',
        );
      }
      
      // Defer query invalidation to prevent React DOM errors
      setTimeout(() => {
        if (!isMountedRef.current) {
          return;
        }
        queryClient.invalidateQueries({ queryKey: ['vehiculos-pendientes'] });
      }, 300);
      
      // Siempre cerrar modal de cobro tras confirmar.
      // Si hay alerta SARLAFT, queda visible el modal de remisión al oficial.
      onClose();
    },
  });

  const handleCobrar = () => {
    // Filtrar desglose mixto para solo enviar métodos con valor > 0
    const desgloseParaEnviar = metodoPago === 'mixto'
      ? Object.fromEntries(
          Object.entries(desgloseMixto).filter(([_, valor]) => valor > 0)
        )
      : undefined;
    
    cobrarMutation.mutate({
      vehiculo_id: vehiculo.id,
      metodo_pago: metodoPago,
      tiene_soat: clientePagaSOAT,
      numero_factura_dian: modoFactus ? undefined : numeroFactura || undefined,
      valor_preventiva: esPreventiva ? valorPreventivaNum : undefined,
      desglose_mixto: desgloseParaEnviar,
      ...registros,
    });
  };

  useEffect(() => {
    metodoPagoFocusRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (!cobrarMutation.isLoading && puedeConfirmarCobro) {
          event.preventDefault();
          handleCobrar();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, cobrarMutation.isLoading, puedeConfirmarCobro]);

  const getMetodoStyles = (metodoPago: string, selectedMetodo: string) => {
    const isSelected = metodoPago === selectedMetodo;

    const styles: Record<string, string> = {
      efectivo: isSelected
        ? 'border-green-600 bg-green-50 text-green-900 shadow-sm ring-2 ring-green-600/25'
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      tarjeta_debito: isSelected
        ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-sm ring-2 ring-blue-600/25'
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      tarjeta_credito: isSelected
        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm ring-2 ring-indigo-600/25'
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      transferencia: isSelected
        ? 'border-purple-600 bg-purple-50 text-purple-900 shadow-sm ring-2 ring-purple-600/25'
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      mixto: isSelected
        ? 'border-teal-600 bg-teal-50 text-teal-900 shadow-sm ring-2 ring-teal-600/25'
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      credismart: isSelected
        ? 'border-orange-600 bg-orange-50 text-orange-900 shadow-sm ring-2 ring-orange-600/25'
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      sistecredito: isSelected
        ? 'border-yellow-600 bg-yellow-50 text-yellow-900 shadow-sm ring-2 ring-yellow-600/25'
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
    };

    return styles[metodoPago] || '';
  };

  const metodosPago = [
    { id: 'efectivo', nombre: 'Efectivo', Icono: Banknote, canal: 'Caja', nota: 'Ingresa a caja' },
    { id: 'tarjeta_debito', nombre: 'Tarjeta Débito', Icono: CreditCard, canal: 'Electrónico', nota: 'No entra a caja' },
    { id: 'tarjeta_credito', nombre: 'Tarjeta Crédito', Icono: CreditCard, canal: 'Electrónico', nota: 'No entra a caja' },
    { id: 'transferencia', nombre: 'Transferencia', Icono: Smartphone, canal: 'Electrónico', nota: 'No entra a caja' },
    { id: 'credismart', nombre: 'CrediSmart', Icono: Building2, canal: 'Crédito CDA', nota: 'Cartera del CDA' },
    { id: 'sistecredito', nombre: 'SisteCredito', Icono: Landmark, canal: 'Crédito CDA', nota: 'Cartera del CDA' },
    { id: 'mixto', nombre: 'Pago Mixto', Icono: CreditCard, canal: 'Combinado', nota: 'Múltiples métodos' },
  ];

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="modal-panel max-w-4xl w-full">
        <div className="p-6">
          {/* Header */}
          <div className="modal-header-sticky -mx-6 px-6 pt-1 pb-4 flex justify-between items-start mb-6 border-b border-slate-200">
            <div>
              <h3 className="text-3xl font-bold text-slate-900">
                {esReintentoExento
                  ? 'Validar reintento'
                  : esPruebaAuditoria
                    ? 'Validar prueba de auditoría'
                    : 'Cobrar Vehículo'}
              </h3>
              <p className="text-xl font-bold text-primary-600 mt-1">{vehiculo.placa}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="modal-close-btn flex items-center justify-center text-2xl leading-none"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>

          {cobrarMutation.isError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-800 font-semibold text-left flex items-start gap-2 break-words whitespace-pre-wrap">
                <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                {extractApiErrorMessage(cobrarMutation.error, 'No fue posible registrar el cobro.')}
              </p>
            </div>
          )}

          {esReintentoExento && (
            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-4 mb-6">
              <p className="text-emerald-900 font-semibold text-left flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                Reintento por rechazo inicial (intento {vehiculo.reinspeccion_intento || 2}/3). Valor $0.
                Confirma para enviar nuevamente el vehículo a Calidad.
              </p>
            </div>
          )}
          {esPruebaAuditoria && (
            <div className="bg-cyan-50 border-2 border-cyan-200 rounded-lg p-4 mb-6">
              <p className="text-cyan-900 font-semibold text-left flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                Prueba de auditoría registrada con valor $0. Confirma para enviar el vehículo a Calidad sin generar cobro.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-6">
            {/* Resumen del Vehículo */}
            <div className="xl:col-span-2 bg-slate-50 rounded-lg p-4 border border-slate-200 h-full">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-600">Cliente</p>
                  <p className="font-semibold">{vehiculo.cliente_nombre}</p>
                </div>
                <div>
                  <p className="text-slate-600">Documento</p>
                  <p className="font-semibold">{vehiculo.cliente_documento}</p>
                </div>
                <div>
                  <p className="text-slate-600">Tipo</p>
                  <p className="font-semibold capitalize">{vehiculo.tipo_vehiculo}</p>
                </div>
                <div>
                  <p className="text-slate-600">Modelo</p>
                  <p className="font-semibold">{vehiculo.ano_modelo}</p>
                </div>
              </div>
            </div>

            {/* Total a Cobrar */}
            <div className="xl:col-span-3 bg-gradient-to-r from-secondary-600 to-secondary-700 text-white rounded-xl p-6 h-full">
              {esPreventiva ? (
                <div>
                  <p className="text-sm opacity-90 mb-3">SERVICIO PREVENTIVA - Ingrese el valor</p>
                  <div className="bg-white rounded-lg p-4 mb-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={valorPreventiva}
                      onChange={(e) => setValorPreventiva(e.target.value.replace(/\D/g, '').slice(0, 9))}
                      placeholder="Ej: 70000"
                      className="w-full text-4xl font-bold text-gray-900 border-none focus:ring-0 p-0 text-center"
                    />
                    <p className="text-xs text-slate-600 mt-2 text-center">
                      Ingrese solo números (sin puntos ni comas). Valor digitado: ${formatCurrency(valorPreventivaNum || 0)}
                    </p>
                  </div>
                  {vehiculo.tiene_soat && clientePagaSOAT && (
                    <p className="text-sm opacity-90 flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      + Comisión SOAT: ${formatCurrency(vehiculo.comision_soat)}
                    </p>
                  )}
                  {valorPreventivaNum > 0 && (
                    <div className="mt-3 pt-3 border-t border-white border-opacity-30">
                      <p className="text-sm opacity-90 mb-1">TOTAL A COBRAR</p>
                      <p className="text-3xl font-bold">${formatCurrency(totalAjustado)}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-sm opacity-90 mb-1">TOTAL A COBRAR</p>
                  <p className="text-4xl font-bold">${formatCurrency(totalAjustado)}</p>
                  {vehiculo.tiene_soat && (
                    <div className="mt-3">
                      {clientePagaSOAT ? (
                        <p className="text-sm opacity-90 flex items-center justify-center gap-1">
                          <CheckCircle2 className="w-4 h-4" />
                          Incluye comisión SOAT: ${formatCurrency(vehiculo.comision_soat)}
                        </p>
                      ) : (
                        <p className="text-sm opacity-90 flex items-center justify-center gap-1">
                          <XCircle className="w-4 h-4" />
                          SIN comisión SOAT (cliente se retractó)
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Control de Comisión SOAT (si aplica) */}
          {!esCobroExento && vehiculo.tiene_soat && vehiculo.comision_soat > 0 && (
            <div className="mb-6">
              <div className="bg-secondary-50 border-2 border-secondary-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-secondary-900 flex items-center gap-2">
                      <Shield className="w-5 h-5" />
                      Cliente registrado con SOAT
                    </p>
                    <p className="text-xs text-secondary-700">Comisión original: ${formatCurrency(vehiculo.comision_soat)}</p>
                  </div>
                </div>
                <label className="flex items-center p-3 bg-white border-2 border-secondary-600 rounded-lg cursor-pointer hover:bg-secondary-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={clientePagaSOAT}
                    onChange={(e) => setClientePagaSOAT(e.target.checked)}
                    className="w-5 h-5 text-secondary-600 rounded"
                  />
                  <span className="ml-3 flex-1">
                    <span className="font-semibold text-secondary-900 block">El cliente SÍ pagará la comisión SOAT</span>
                    <span className="text-xs text-secondary-700">Desmarca si el cliente se retracta del pago</span>
                  </span>
                </label>
                {!clientePagaSOAT && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-800 flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                      <span>El total se reducirá en <strong>${formatCurrency(vehiculo.comision_soat)}</strong>. El cliente NO pagará SOAT.</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Métodos de Pago */}
          {!esCobroExento && (
          <div className="mb-6">
            <label className="block text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              Método de Pago
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {metodosPago.map((metodo) => (
                <button
                  key={metodo.id}
                  type="button"
                  onClick={() => setMetodoPago(metodo.id)}
                  ref={metodo.id === 'efectivo' ? metodoPagoFocusRef : undefined}
                  className={`p-4 rounded-lg border-2 font-semibold transition-all ${getMetodoStyles(metodo.id, metodoPago)}`}
                >
                  <div className="flex justify-center mb-2">
                    <metodo.Icono className="w-8 h-8" />
                  </div>
                  <div className="mb-1 text-sm">{metodo.nombre}</div>
                  <div
                    className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      metodo.canal === 'Caja'
                        ? 'bg-emerald-100 text-emerald-800'
                        : metodo.canal === 'Electrónico'
                          ? 'bg-blue-100 text-blue-800'
                          : metodo.canal === 'Crédito CDA'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-teal-100 text-teal-800'
                    }`}
                  >
                    {metodo.canal}
                  </div>
                  <div className="text-[11px] mt-1 opacity-80">{metodo.nota}</div>
                </button>
              ))}
            </div>
            {metodoPago === 'efectivo' && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span><strong>Efectivo:</strong> El dinero ingresa físicamente a caja y debe contarse en el arqueo</span>
                </p>
              </div>
            )}
            {['tarjeta_debito', 'tarjeta_credito', 'transferencia'].includes(metodoPago) && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800 flex items-start gap-2">
                  <CreditCard className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span><strong>Pago Electrónico:</strong> El dinero va directo a cuenta bancaria, NO se cuenta en el arqueo de caja</span>
                </p>
              </div>
            )}
            {metodoPago === 'credismart' && (
              <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="text-sm text-orange-800 flex items-start gap-2">
                  <Building2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span><strong>Crédito CDA:</strong> Es una cuenta por cobrar, el dinero NO ingresa a caja</span>
                </p>
              </div>
            )}
            {metodoPago === 'mixto' && (
              <div className="mt-4 p-4 bg-teal-50 border-2 border-teal-200 rounded-lg">
                <h4 className="font-bold text-teal-900 mb-3 flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  Desglose de Pago Mixto
                </h4>
                <p className="text-sm text-teal-700 mb-4">
                  Ingresa el monto para cada método de pago. La suma debe ser <strong>${formatCurrency(totalAjustado)}</strong>
                </p>
                
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      <Banknote className="w-4 h-4 inline mr-1" />
                      Efectivo
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.efectivo || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, efectivo: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      <CreditCard className="w-4 h-4 inline mr-1" />
                      T. Débito
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.tarjeta_debito || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, tarjeta_debito: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      <CreditCard className="w-4 h-4 inline mr-1" />
                      T. Crédito
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.tarjeta_credito || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, tarjeta_credito: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      <Smartphone className="w-4 h-4 inline mr-1" />
                      Transferencia
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.transferencia || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, transferencia: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      <Building2 className="w-4 h-4 inline mr-1" />
                      CrediSmart
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.credismart || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, credismart: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      <Landmark className="w-4 h-4 inline mr-1" />
                      SisteCredito
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.sistecredito || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, sistecredito: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                </div>
                
                <div className={`p-3 rounded-lg border-2 ${
                  Math.abs(sumaMixto - totalAjustado) < 1
                    ? 'bg-green-50 border-green-300' 
                    : 'bg-yellow-50 border-yellow-300'
                }`}>
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-semibold">Total ingresado:</span>
                    <span className="text-lg font-bold">${formatCurrency(sumaMixto)}</span>
                  </div>
                  {Math.abs(sumaMixto - totalAjustado) >= 1 && (
                    <div className="mt-2 text-sm">
                      <span className="font-semibold">Falta: </span>
                      <span className="text-red-600 font-bold">${formatCurrency(totalAjustado - sumaMixto)}</span>
                    </div>
                  )}
                  {Math.abs(sumaMixto - totalAjustado) < 1 && (
                    <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      ¡Monto correcto!
                    </p>
                  )}
                </div>
                
                <div className="mt-3 p-2 bg-white border border-teal-200 rounded text-xs text-teal-800">
                  <p className="flex items-start gap-1">
                    <Banknote className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>Solo el <strong>efectivo</strong> se contará en el arqueo de caja</span>
                  </p>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Registros Externos */}
          {!esCobroExento && (
          <div className="mb-6">
            <label className="block text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Link2 className="w-5 h-5" />
              Registros Externos Obligatorios
            </label>
            <p className="text-sm text-gray-600 mb-4 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
              Debes abrir cada sistema, registrar el vehículo y marcar la confirmación
            </p>
            <div className="space-y-4">
              {/* RUNT */}
              <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-bold text-blue-900 flex items-center gap-2">
                      <Landmark className="w-5 h-5" />
                      RUNT - Ministerio de Transporte
                    </h4>
                    <p className="text-xs text-blue-700">Registro oficial de la revisión técnico-mecánica</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => urls && window.open(urls.runt_url, '_blank', 'width=1200,height=800')}
                    disabled={loadingUrls || !urls}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Link2 className="w-4 h-4" />
                    Abrir RUNT
                  </button>
                  <label className="flex items-center px-4 py-2 bg-white border-2 border-blue-600 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={registros.registrado_runt}
                      onChange={(e) => setRegistros({ ...registros, registrado_runt: e.target.checked })}
                      className="w-5 h-5 text-blue-600 rounded"
                    />
                    <span className="ml-2 font-semibold text-blue-900 flex items-center gap-1">
                      <CheckSquare className="w-4 h-4" />
                      Registrado
                    </span>
                  </label>
                </div>
              </div>

              {/* INDRA */}
              <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-bold text-purple-900 flex items-center gap-2">
                      <CreditCard className="w-5 h-5" />
                      INDRA Paynet - Sistema de Pagos
                    </h4>
                    <p className="text-xs text-purple-700">Plataforma de pagos y gestión financiera</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => urls && window.open(urls.indra_url, '_blank', 'width=1200,height=800')}
                    disabled={loadingUrls || !urls}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Link2 className="w-4 h-4" />
                    Abrir INDRA
                  </button>
                  <label className="flex items-center px-4 py-2 bg-white border-2 border-purple-600 rounded-lg cursor-pointer hover:bg-purple-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={registros.registrado_indra}
                      onChange={(e) => setRegistros({ ...registros, registrado_indra: e.target.checked })}
                      className="w-5 h-5 text-purple-600 rounded"
                    />
                    <span className="ml-2 font-semibold text-purple-900 flex items-center gap-1">
                      <CheckSquare className="w-4 h-4" />
                      Registrado
                    </span>
                  </label>
                </div>
              </div>

              {/* SICOV */}
              <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-bold text-green-900 flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      SICOV - Control de Vehículos
                    </h4>
                    <p className="text-xs text-green-700">Sistema de control y seguimiento de inspecciones</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => urls && window.open(urls.sicov_url, '_blank', 'width=1200,height=800')}
                    disabled={loadingUrls || !urls}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Link2 className="w-4 h-4" />
                    Abrir SICOV
                  </button>
                  <label className="flex items-center px-4 py-2 bg-white border-2 border-green-600 rounded-lg cursor-pointer hover:bg-green-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={registros.registrado_sicov}
                      onChange={(e) => setRegistros({ ...registros, registrado_sicov: e.target.checked })}
                      className="w-5 h-5 text-green-600 rounded"
                    />
                    <span className="ml-2 font-semibold text-green-900 flex items-center gap-1">
                      <CheckSquare className="w-4 h-4" />
                      Registrado
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Factura DIAN */}
          {!esCobroExento && (
          <div className="mb-6">
            <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-bold text-amber-900 flex items-center gap-2">
                    <Receipt className="w-5 h-5" />
                    {modoFactus ? (
                      <>Factura electrónica (Factus)</>
                    ) : (
                      <>
                        Número de Factura DIAN <span className="text-red-600">*</span>
                      </>
                    )}
                  </h4>
                  <p className="text-xs text-amber-700">
                    {modoFactus
                      ? 'Al confirmar el cobro se emitirá la factura en Factus y el número quedará en el recibo.'
                      : 'Registro obligatorio para facturación (número manual)'}
                  </p>
                </div>
              </div>
              {modoFactus ? (
                <div className="rounded-lg bg-white border border-amber-200 px-4 py-3 text-sm text-amber-900">
                  No debes ingresar número aquí: se generará al confirmar con las credenciales configuradas en
                  Ajustes.
                </div>
              ) : (
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={numeroFactura}
                    onChange={(e) => setNumeroFactura(e.target.value.toUpperCase())}
                    className="flex-1 input-pos uppercase"
                    placeholder="ABC-123"
                    required
                  />
                  <label className="flex items-center px-4 py-2 bg-white border-2 border-amber-600 rounded-lg cursor-pointer hover:bg-amber-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={!!numeroFactura}
                      onChange={() => {
                        // El checkbox es solo visual, el required del input maneja la validación
                      }}
                      className="w-5 h-5 text-amber-600 rounded"
                      disabled
                    />
                    <span className="ml-2 font-semibold text-amber-900 flex items-center gap-1">
                      <CheckSquare className="w-4 h-4" />
                      Registrado
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Alerta si faltan registros */}
            {!todosRegistrados && (
              <div className="mt-4 p-3 bg-yellow-50 border-2 border-yellow-200 rounded-lg">
                <p className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  {modoFactus
                    ? 'Debes marcar los registros en RUNT, SICOV e INDRA para confirmar el cobro'
                    : 'Debes marcar los 4 registros (incluido número DIAN) para confirmar el cobro'}
                </p>
              </div>
            )}
            {esPreventiva && !preventivaTieneValor && (
              <div className="mt-4 p-3 bg-red-50 border-2 border-red-200 rounded-lg">
                <p className="text-sm font-semibold text-red-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  Debes ingresar un valor mayor a $0 para servicio PREVENTIVA
                </p>
              </div>
            )}
          </div>
          )}

          <div className="modal-footer-sticky -mx-6 mt-6 border-t border-slate-200 px-6 pt-4">
            <p className="mb-3 text-center text-xs text-slate-500">
              Atajos: Esc cerrar · Ctrl+Enter {esReintentoExento ? 'validar reintento' : esPruebaAuditoria ? 'validar auditoría' : 'confirmar'}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="btn-corporate-muted flex-1 py-3 font-semibold"
                disabled={cobrarMutation.isLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCobrar}
                disabled={cobrarMutation.isLoading || !puedeConfirmarCobro}
                className="btn-success-solid flex-1 inline-flex items-center justify-center gap-2 py-3 font-semibold disabled:opacity-50"
              >
                {cobrarMutation.isLoading ? (
                  <span>Procesando...</span>
                ) : (
                  <span className="inline-flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    {esReintentoExento
                      ? 'Confirmar reintento'
                      : esPruebaAuditoria
                        ? 'Confirmar auditoría'
                        : 'Confirmar cobro'}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PosReceiptPromptModal({
  payload,
  onClose,
}: {
  payload: PosReceiptPrintPayload;
  onClose: () => void;
}) {
  const { showToast } = useToast();

  const handlePrint = () => {
    try {
      imprimirReciboPos(payload);
      showToast('success', 'Impresión enviada', 'Se abrió la ventana de impresión para la tirilla POS.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible abrir la impresión.';
      showToast('error', 'Impresión POS', message);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/65 backdrop-blur-sm p-4">
      <div className="modal-panel w-full max-w-lg border border-amber-200 bg-white p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Printer className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-slate-900">Imprimir tirilla POS</h4>
            <p className="mt-1 text-sm text-slate-700">
              Cobro registrado para la placa <strong>{payload.placa}</strong>. ¿Deseas imprimir la tirilla?
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Formato: <strong>{payload.ticketWidth}</strong> · Método: <strong>{payload.metodoPago.replaceAll('_', ' ')}</strong> ·
          Total: <strong>${formatCurrency(payload.totalCobrado)}</strong>
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-corporate-muted px-4 py-2 rounded-lg">
            Cerrar
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 inline-flex items-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Imprimir tirilla
          </button>
        </div>
      </div>
    </div>
  );
}

function PosReceiptSettingsPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['pos-receipt-settings'],
    queryFn: configApi.obtenerPosReceiptSettings,
    retry: 1,
  });

  const updateMutation = useMutation({
    mutationFn: configApi.actualizarPosReceiptSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pos-receipt-settings'] });
      showToast('success', 'Preferencias guardadas', 'La configuración de impresión POS quedó actualizada.');
    },
    onError: (error: unknown) => {
      showToast('error', 'Error', extractApiErrorMessage(error, 'No se pudieron guardar las preferencias POS.'));
    },
  });

  if (isLoading) {
    return <LoadingSpinner message="Cargando configuración POS..." />;
  }

  if (!data) {
    return (
      <div className="section-card border border-amber-200 bg-amber-50 text-amber-900 p-4">
        No fue posible cargar la configuración POS.
      </div>
    );
  }

  return (
    <div className="section-card border border-slate-200 p-5 space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 inline-flex items-center gap-2">
          <Printer className="w-5 h-5 text-amber-600" />
          Impresión POS
        </h3>
        <p className="text-sm text-slate-600 mt-1">
          Configura la tirilla POS sin afectar PDF ni facturación. La preferencia queda guardada.
        </p>
      </div>

      <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Habilitar recibo POS en este CDA</p>
          <p className="text-xs text-slate-600">Si se desactiva, no aparecerá el modal de impresión post-cobro.</p>
        </div>
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={data.tenant_enabled}
          disabled={updateMutation.isLoading}
          onChange={(e) => updateMutation.mutate({ tenant_enabled: e.target.checked })}
        />
      </label>

      <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Mostrar modal POS después de confirmar cobro</p>
          <p className="text-xs text-slate-600">Preferencia personal de tu usuario (se recuerda en próximas sesiones).</p>
        </div>
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={data.auto_prompt_after_payment}
          disabled={updateMutation.isLoading}
          onChange={(e) => updateMutation.mutate({ auto_prompt_after_payment: e.target.checked })}
        />
      </label>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-900 mb-2">Ancho de tirilla</p>
        <div className="flex gap-2">
          {(['58mm', '80mm'] as const).map((width) => (
            <button
              key={width}
              type="button"
              className={`px-3 py-2 rounded-md border text-sm font-semibold ${
                data.ticket_width === width
                  ? 'border-amber-600 bg-amber-50 text-amber-900'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
              disabled={updateMutation.isLoading}
              onClick={() => updateMutation.mutate({ ticket_width: width })}
            >
              {width}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Componente Modal de Gasto
function ModalGasto({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const montoInputRef = useRef<HTMLInputElement>(null);
  const { data: factusCfg } = useQuery({
    queryKey: ['factus-settings'],
    queryFn: () => factusApi.getSettings(),
    staleTime: 60_000,
  });
  const { data: proveedoresCatalogo = [] } = useQuery({
    queryKey: ['proveedores-catalogo'],
    queryFn: () => proveedoresCatalogoApi.listar(true),
    staleTime: 30_000,
  });
  const [formData, setFormData] = useState({
    tipo: 'gasto',
    monto: '',
    concepto: '',
    proveedor_catalogo_id: '',
    beneficiario: '',
    beneficiario_tipo_identificacion: '',
    beneficiario_numero_identificacion: '',
    beneficiario_direccion: '',
    beneficiario_email: '',
    beneficiario_telefono: '',
    beneficiario_factus_municipality_id: '',
  });
  const [mostrarExito, setMostrarExito] = useState(false);
  const [nombreArchivoPDF, setNombreArchivoPDF] = useState('');

  const usarCatalogoProveedor = formData.proveedor_catalogo_id.trim().length > 0;
  const midManualOk = (() => {
    const s = formData.beneficiario_factus_municipality_id.trim();
    const n = s ? parseInt(s, 10) : NaN;
    return Boolean(s) && Number.isFinite(n) && n >= 1;
  })();
  const proveedorDatosCompletos =
    usarCatalogoProveedor ||
    (formData.beneficiario.trim().length >= 2 &&
      Boolean(formData.beneficiario_tipo_identificacion.trim()) &&
      formData.beneficiario_numero_identificacion.trim().length >= 4 &&
      formData.beneficiario_direccion.trim().length >= 8 &&
      formData.beneficiario_email.trim().includes('@') &&
      formData.beneficiario_telefono.replace(/\D/g, '').length >= 7 &&
      midManualOk);

  const registrarGastoMutation = useMutation({
    mutationFn: cajasApi.crearMovimiento,
    onSuccess: async (movimientoCreado: MovimientoCaja) => {
      let nombrePDF: string;
      try {
        // Mismo PDF que Reportes → Detalle → Docs (servidor / ReportLab)
        nombrePDF = await cajasApi.descargarComprobanteEgresoCaja(movimientoCreado.id);
      } catch {
        showToast(
          'error',
          'Comprobante no descargado',
          'El movimiento quedó registrado. Puedes descargar el comprobante desde Reportes → Detalle → Docs.',
        );
        nombrePDF = '— (revisa la carpeta de descargas o usa Reportes → Detalle)';
      }

      setNombreArchivoPDF(nombrePDF);
      setMostrarExito(true);
      
      // Defer query invalidations to prevent React DOM errors
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['caja-activa'] });
        queryClient.invalidateQueries({ queryKey: ['movimientos-caja'] });
        queryClient.invalidateQueries({ queryKey: ['caja-resumen-tiempo-real'] });
        queryClient.invalidateQueries({ queryKey: ['caja-resumen'] }); // Para el modal de cierre
      }, 300);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const monto = parseFloat(formData.monto);
    const catalogId = formData.proveedor_catalogo_id.trim();

    if (!catalogId) {
      const ben = formData.beneficiario.trim();
      const tid = formData.beneficiario_tipo_identificacion.trim();
      if (ben.length < 2) {
        window.alert('Indica el beneficiario / pagado a (mínimo 2 caracteres).');
        return;
      }
      if (!tid) {
        window.alert('Selecciona el tipo de identificación del beneficiario.');
        return;
      }
      const numId = formData.beneficiario_numero_identificacion.trim();
      if (numId.length < 4) {
        window.alert('Indica el número de identificación del beneficiario (mínimo 4 caracteres).');
        return;
      }
      const dir = formData.beneficiario_direccion.trim();
      if (dir.length < 8) {
        window.alert('Indica la dirección del proveedor o beneficiario (mínimo 8 caracteres), requerida para documento soporte DIAN.');
        return;
      }
      const em = formData.beneficiario_email.trim().toLowerCase();
      const at = em.indexOf('@');
      if (at < 1) {
        window.alert('Indique un correo electrónico válido del proveedor.');
        return;
      }
      const dom = em.slice(at + 1);
      if (!dom.includes('.') || dom.length < 3) {
        window.alert('Indique un correo electrónico válido del proveedor.');
        return;
      }
      const tel = formData.beneficiario_telefono.replace(/\D/g, '');
      if (tel.length < 7) {
        window.alert('Indique celular o teléfono del proveedor (mínimo 7 dígitos).');
        return;
      }
      const midStr = formData.beneficiario_factus_municipality_id.trim();
      const midParsed = midStr ? parseInt(midStr, 10) : NaN;
      if (!midStr || Number.isNaN(midParsed) || midParsed < 1) {
        window.alert('Seleccione o indique el id de municipio Factus del proveedor (requerido para documento soporte DIAN).');
        return;
      }
    }

    // Confirmación para gastos grandes (>$50,000)
    if (monto > 50000) {
      const confirmar = window.confirm(
        `Monto alto detectado: $${formatCurrency(monto)}.\n\n` +
        `Concepto: ${formData.concepto}\n\n` +
        `¿Confirmas registrar este gasto?`
      );
      if (!confirmar) {
        return;
      }
    }
    
    // Convertir monto a negativo para egresos
    const montoNegativo = -Math.abs(monto);

    if (catalogId) {
      registrarGastoMutation.mutate({
        tipo: formData.tipo,
        monto: montoNegativo,
        concepto: formData.concepto,
        metodo_pago: 'efectivo',
        ingresa_efectivo: false,
        proveedor_catalogo_id: catalogId,
      });
      return;
    }

    const ben = formData.beneficiario.trim();
    const tid = formData.beneficiario_tipo_identificacion.trim();
    const numId = formData.beneficiario_numero_identificacion.trim();
    const dir = formData.beneficiario_direccion.trim();
    const em = formData.beneficiario_email.trim().toLowerCase();
    const midStr = formData.beneficiario_factus_municipality_id.trim();
    const midParsed = midStr ? parseInt(midStr, 10) : NaN;
    const payloadManual: Parameters<typeof cajasApi.crearMovimiento>[0] = {
      tipo: formData.tipo,
      monto: montoNegativo,
      concepto: formData.concepto,
      metodo_pago: 'efectivo',
      ingresa_efectivo: false,
      beneficiario: ben,
      beneficiario_tipo_identificacion: tid,
      beneficiario_numero_identificacion: numId,
      beneficiario_direccion: dir,
      beneficiario_email: em,
      beneficiario_telefono: formData.beneficiario_telefono.trim(),
      beneficiario_factus_municipality_id: midParsed,
    };

    registrarGastoMutation.mutate(payloadManual);
  };

  useEffect(() => {
    montoInputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (!registrarGastoMutation.isLoading) {
          event.preventDefault();
          formRef.current?.requestSubmit();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, registrarGastoMutation.isLoading]);

  const tiposGasto = [
    { id: 'gasto', nombre: 'Gasto', Icono: ArrowRight, descripcion: 'Compras, servicios, etc.' },
    { id: 'devolucion', nombre: 'Devolución', Icono: CornerUpLeft, descripcion: 'Devolución a cliente' },
    { id: 'ajuste', nombre: 'Ajuste', Icono: Scale, descripcion: 'Corrección de caja' },
  ];

  const getTipoGastoStyles = (tipoId: string) => {
    const isSelected = formData.tipo === tipoId;
    const styles: Record<string, string> = {
      gasto: isSelected
        ? 'border-red-500 bg-red-50/80 text-red-900 shadow-sm'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
      devolucion: isSelected
        ? 'border-amber-500 bg-amber-50/80 text-amber-900 shadow-sm'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
      ajuste: isSelected
        ? 'border-sky-500 bg-sky-50/80 text-sky-900 shadow-sm'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
    };
    return styles[tipoId] || '';
  };

  const montoNumerico = parseFloat(formData.monto) || 0;

  // Modal de éxito
  if (mostrarExito) {
    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="modal-panel max-w-4xl w-full">
          <div className="p-6 text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle2 className="w-16 h-16 text-green-500" />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 mb-3">
              Gasto Registrado
            </h3>
            <p className="text-slate-600 mb-2">
              Se registró un egreso de:
            </p>
            <p className="text-3xl font-bold text-red-600 mb-4">
              ${formatCurrency(montoNumerico)}
            </p>
            
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm font-semibold text-blue-900 mb-2 flex items-center justify-center gap-2">
                <FileText className="w-5 h-5" />
                Comprobante descargado (mismo que en Reportes → Detalle)
              </p>
              <p className="text-xs text-blue-700 break-all">
                {nombreArchivoPDF}
              </p>
            </div>
            
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-3 mb-6">
              <p className="text-sm font-semibold text-yellow-800 flex items-center justify-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                IMPORTANTE
              </p>
              <p className="text-xs text-yellow-700 mt-1">
                Imprime el comprobante y házlo firmar por el beneficiario
              </p>
            </div>
            
            <button
              onClick={() => {
                setMostrarExito(false);
                onSuccess();
                onClose();
              }}
              className="w-full btn-primary-solid inline-flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              Entendido
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="modal-panel max-w-3xl w-full max-h-[92vh] overflow-y-auto">
        <div className="p-5 sm:p-6">
          <div className="modal-header-sticky -mx-5 sm:-mx-6 px-5 sm:px-6 pt-0 pb-3 flex justify-between items-start gap-3 mb-4 border-b border-slate-200">
            <div>
              <h3 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
                <ArrowRight className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 text-slate-600" />
                Registrar gasto
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Salida de efectivo de la caja</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 text-xl leading-none shrink-0"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>

          {registrarGastoMutation.isError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4">
              <p className="text-sm text-red-800 flex items-start gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {(registrarGastoMutation.error as Error & { response?: { data?: { detail?: string } } })?.response
                    ?.data?.detail || 'No fue posible registrar el gasto.'}
                </span>
              </p>
            </div>
          )}

          <form ref={formRef} onSubmit={handleSubmit}>
            <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Proveedor del catálogo</label>
              <ProveedorCatalogoPicker
                proveedores={proveedoresCatalogo}
                selectedId={formData.proveedor_catalogo_id}
                onSelect={(p) =>
                  setFormData((f) => ({
                    ...f,
                    proveedor_catalogo_id: p.id,
                    beneficiario: p.razon_social_rut,
                    beneficiario_tipo_identificacion: p.tipo_identificacion,
                    beneficiario_numero_identificacion: p.numero_identificacion,
                    beneficiario_direccion: p.direccion,
                    beneficiario_email: p.email,
                    beneficiario_telefono: p.telefono,
                    beneficiario_factus_municipality_id: String(p.factus_municipality_id),
                  }))
                }
                onClear={() =>
                  setFormData((f) => ({
                    ...f,
                    proveedor_catalogo_id: '',
                  }))
                }
                inputClassName="input-pos"
              />
              <p className="text-[11px] text-slate-500 mt-1.5">Opcional: autocompleta datos si ya está en catálogo.</p>
            </div>

            <div className="mb-4">
              <span className="text-xs font-semibold text-slate-700">Tipo</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {tiposGasto.map((tipo) => (
                  <button
                    key={tipo.id}
                    type="button"
                    title={tipo.descripcion}
                    onClick={() => setFormData({ ...formData, tipo: tipo.id })}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${getTipoGastoStyles(
                      tipo.id,
                    )}`}
                  >
                    <tipo.Icono className="w-4 h-4 shrink-0 opacity-80" />
                    {tipo.nombre}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Beneficiario / pagado a</label>
                <input
                  type="text"
                  value={formData.beneficiario}
                  onChange={(e) => setFormData({ ...formData, beneficiario: e.target.value })}
                  className="input-pos"
                  placeholder="Nombre o razón social"
                  minLength={2}
                  required={!usarCatalogoProveedor}
                  readOnly={usarCatalogoProveedor}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo ID</label>
                <select
                  value={formData.beneficiario_tipo_identificacion}
                  onChange={(e) =>
                    setFormData({ ...formData, beneficiario_tipo_identificacion: e.target.value })
                  }
                  className="input-pos"
                  required={!usarCatalogoProveedor}
                  disabled={usarCatalogoProveedor}
                >
                  <option value="">Elegir…</option>
                  {TIPOS_IDENTIFICACION_BENEFICIARIO_CAJA.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Número</label>
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  title="Como en el RUT; si el sistema pide DV con guion, ej. 1113695964-1"
                  value={formData.beneficiario_numero_identificacion}
                  onChange={(e) =>
                    setFormData({ ...formData, beneficiario_numero_identificacion: e.target.value })
                  }
                  className="input-pos"
                  placeholder="Documento"
                  minLength={4}
                  maxLength={80}
                  required={!usarCatalogoProveedor}
                  readOnly={usarCatalogoProveedor}
                />
              </div>
            </div>

            <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-3">
              <p className="text-xs font-semibold text-slate-600">Contacto del beneficiario</p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Dirección</label>
                <textarea
                  value={formData.beneficiario_direccion}
                  onChange={(e) => setFormData({ ...formData, beneficiario_direccion: e.target.value })}
                  className="input-pos min-h-[64px] text-sm"
                  placeholder="Dirección completa"
                  minLength={8}
                  required={!usarCatalogoProveedor}
                  readOnly={usarCatalogoProveedor}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Correo</label>
                  <input
                    type="email"
                    autoComplete="off"
                    value={formData.beneficiario_email}
                    onChange={(e) => setFormData({ ...formData, beneficiario_email: e.target.value })}
                    className="input-pos text-sm"
                    placeholder="correo@ejemplo.com"
                    required={!usarCatalogoProveedor}
                    readOnly={usarCatalogoProveedor}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={formData.beneficiario_telefono}
                    onChange={(e) => setFormData({ ...formData, beneficiario_telefono: e.target.value })}
                    className="input-pos text-sm"
                    placeholder="Mín. 7 dígitos"
                    required={!usarCatalogoProveedor}
                    readOnly={usarCatalogoProveedor}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Municipio Factus (id){' '}
                  <span className="font-normal text-slate-400">— opcional manual</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  title="Necesario solo si luego emite documento soporte; mismo id que en Organización."
                  className="input-pos text-sm"
                  placeholder="Ej. 1097"
                  value={formData.beneficiario_factus_municipality_id}
                  onChange={(e) => {
                    const idDigits = e.target.value.replace(/\D/g, '').slice(0, 8);
                    setFormData((f) => ({ ...f, beneficiario_factus_municipality_id: idDigits }));
                  }}
                  disabled={factusCfg?.modo !== 'factus' || usarCatalogoProveedor}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" />
                  Monto
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">$</span>
                  <input
                    type="number"
                    value={formData.monto}
                    onChange={(e) => setFormData({ ...formData, monto: e.target.value })}
                    ref={montoInputRef}
                    className="input-pos text-2xl text-center font-bold pl-10 py-2.5"
                    placeholder="0"
                    step="any"
                    min="1"
                    required
                  />
                </div>
                {montoNumerico > 0 && (
                  <p className="text-[11px] text-amber-800 mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Sale del efectivo en caja
                  </p>
                )}
              </div>

              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" />
                  Concepto
                </label>
                <textarea
                  value={formData.concepto}
                  onChange={(e) => setFormData({ ...formData, concepto: e.target.value })}
                  className="input-pos text-sm min-h-[100px]"
                  rows={4}
                  placeholder="Qué se pagó (mín. 5 caracteres)"
                  minLength={5}
                  required
                />
              </div>
            </div>

            {usarCatalogoProveedor && montoNumerico > 0 && (
              <RetencionEstimadaMotorInline
                enabled
                montoPositivo={montoNumerico}
                conceptoRetencionDse={
                  proveedoresCatalogo.find((p) => p.id === formData.proveedor_catalogo_id)
                    ?.concepto_retencion_dse
                }
              />
            )}

            {montoNumerico > 0 && formData.concepto.length >= 5 && proveedorDatosCompletos && (
              <div className="mb-4 py-3 px-3 rounded-lg border border-slate-100 bg-white text-sm text-slate-700 flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Eye className="w-4 h-4" />
                  <span>
                    <span className="font-medium text-slate-800">{formData.beneficiario.trim()}</span>
                    {formData.beneficiario_numero_identificacion.trim()
                      ? ` · ${formData.beneficiario_tipo_identificacion} ${formData.beneficiario_numero_identificacion.trim()}`
                      : ''}
                  </span>
                </span>
                <span className="font-bold text-red-600">-${formatCurrency(montoNumerico)}</span>
              </div>
            )}

            <div className="modal-footer-sticky -mx-5 sm:-mx-6 px-5 sm:px-6 pt-3 flex gap-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-pos btn-secondary py-2.5 text-sm"
                disabled={registrarGastoMutation.isLoading}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  registrarGastoMutation.isLoading ||
                  !formData.monto ||
                  formData.concepto.length < 5 ||
                  !proveedorDatosCompletos
                }
                className="flex-1 btn-pos btn-danger disabled:opacity-50 inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold"
              >
                {registrarGastoMutation.isLoading ? (
                  'Registrando…'
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Registrar gasto
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Componente de Cierre de Caja
function CierreCaja({ cajaId, onCerrado }: { cajaId: string, onCerrado: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [montoFisico, setMontoFisico] = useState<number | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [mostrarDetalleMetodos, setMostrarDetalleMetodos] = useState(false);
  const [mostrarDetalleEgresos, setMostrarDetalleEgresos] = useState(false);
  
  // Estado del contador de denominaciones
  const [desglose, setDesglose] = useState({
    billetes_100000: 0,
    billetes_50000: 0,
    billetes_20000: 0,
    billetes_10000: 0,
    billetes_5000: 0,
    billetes_2000: 0,
    billetes_1000: 0,
    monedas_1000: 0,
    monedas_500: 0,
    monedas_200: 0,
    monedas_100: 0,
    monedas_50: 0,
  });
  
  // Calcular total del desglose automáticamente
  const calcularTotalDesglose = () => {
    return (
      desglose.billetes_100000 * 100000 +
      desglose.billetes_50000 * 50000 +
      desglose.billetes_20000 * 20000 +
      desglose.billetes_10000 * 10000 +
      desglose.billetes_5000 * 5000 +
      desglose.billetes_2000 * 2000 +
      desglose.billetes_1000 * 1000 +
      desglose.monedas_1000 * 1000 +
      desglose.monedas_500 * 500 +
      desglose.monedas_200 * 200 +
      desglose.monedas_100 * 100 +
      desglose.monedas_50 * 50
    );
  };
  
  // Actualizar monto físico cuando cambia el desglose
  const totalDesglose = calcularTotalDesglose();
  
  // Sincronizar montoFisico con el desglose
  useEffect(() => {
    setMontoFisico(totalDesglose);
  }, [totalDesglose]);

  // Obtener resumen de caja
  const { data: resumen, isLoading } = useQuery({
    queryKey: ['caja-resumen', cajaId],
    queryFn: cajasApi.obtenerResumen,
    refetchInterval: 10000, // Actualizar cada 10 segundos
  });

  // Obtener movimientos (gastos) de la caja
  const { data: movimientos } = useQuery({
    queryKey: ['movimientos-caja', cajaId],
    queryFn: cajasApi.listarMovimientos,
    refetchInterval: 10000, // Actualizar cada 10 segundos
  });

  // Obtener vehículos agrupados por método de pago
  const { data: vehiculosPorMetodo } = useQuery({
    queryKey: ['vehiculos-por-metodo', cajaId],
    queryFn: cajasApi.obtenerVehiculosPorMetodo,
  });

  // Obtener vehículos pendientes para validar antes de cerrar
  const { data: vehiculosPendientesData } = useQuery({
    queryKey: ['vehiculos-pendientes'],
    queryFn: vehiculosApi.obtenerPendientes,
    retry: 1,
  });

  const vehiculosPendientes = vehiculosPendientesData || [];

  // Filtrar solo egresos (montos negativos)
  const egresos = movimientos?.filter(mov => mov.monto < 0) || [];
  const egresosVigentes = egresos.filter((mov) => !mov.anulado);
  const egresosAnulados = egresos.length - egresosVigentes.length;

  const cerrarMutation = useMutation({
    mutationFn: cajasApi.cerrar,
    onSuccess: async (cajaCerrada) => {
      // Descargar PDF generado por el backend
      try {
        const blob = await cajasApi.descargarComprobanteCierre(cajaCerrada.id);
        saveBlobAsFile(blob, `comprobante_cierre_caja_${formatLocalDate(new Date())}.pdf`);
        showToast('success', 'Caja cerrada', 'El comprobante se descargó correctamente.');
      } catch (error: any) {
        try {
          // Fallback operativo: intentar con la última caja cerrada del usuario.
          const ultimaCerrada = await cajasApi.obtenerUltimaCerrada();
          if (ultimaCerrada?.caja_id) {
            const blob = await cajasApi.descargarComprobanteCierre(ultimaCerrada.caja_id);
            saveBlobAsFile(blob, `comprobante_cierre_caja_${formatLocalDate(new Date())}.pdf`);
            showToast('success', 'Caja cerrada', 'Comprobante descargado en segundo intento.');
            return;
          }
        } catch (fallbackError) {
          console.error('Error en fallback de comprobante:', fallbackError);
        }
        console.error('Error al descargar comprobante:', error?.response?.status, error?.response?.data || error);
        showToast(
          'warning',
          'Caja cerrada',
          'No fue posible descargar el comprobante automáticamente. Revisa el historial o reportes.',
        );
      }
      
      // Defer query invalidation and callback to prevent React DOM errors
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['caja-activa'] });
        onCerrado();
      }, 300);
    },
  });

  const handleCerrar = () => {
    // Validar si hay vehículos pendientes
    if (vehiculosPendientes.length > 0) {
      const placas = vehiculosPendientes
        .slice(0, 5)
        .map((v: Vehiculo) => v.placa)
        .join(', ');
      showToast(
        'warning',
        'Hay cobros pendientes',
        `No puedes cerrar con ${vehiculosPendientes.length} vehículo(s) pendiente(s). Placas: ${placas}${
          vehiculosPendientes.length > 5 ? '…' : ''
        }. Finaliza los cobros primero.`,
      );
      return;
    }

    // Validar diferencias grandes (faltantes o sobrantes mayores a $20,000)
    const diferenciaAbsoluta = Math.abs(diferencia);
    if (diferenciaAbsoluta > 20000) {
      // Si no hay observaciones, exigirlas
      if (!observaciones || observaciones.trim().length < 10) {
        showToast(
          'warning',
          'Observaciones requeridas',
          `Diferencia alta ($${formatCurrency(diferencia)}). Agrega observaciones de al menos 10 caracteres.`,
        );
        return;
      }
      
      // Confirmación adicional
      const confirmarDiferencia = window.confirm(
        `${diferencia < 0 ? 'Faltante' : 'Sobrante'} de $${formatCurrency(diferenciaAbsoluta)}.\n\n` +
        `Saldo esperado: $${formatCurrency(resumen?.saldo_esperado ?? 0)}\n` +
        `Efectivo contado: $${formatCurrency(montoFisico ?? 0)}\n\n` +
        `Observaciones: ${observaciones}\n\n` +
        `¿Confirmas cerrar con esta diferencia?`
      );
      if (!confirmarDiferencia) {
        return;
      }
    }

    if (!window.confirm('¿Estás seguro de cerrar la caja? Esta acción no se puede deshacer.')) {
      return;
    }

    cerrarMutation.mutate({
      monto_final_fisico: montoFisico ?? 0,
      desglose_efectivo: desglose,
      observaciones_cierre: observaciones || undefined,
    });
  };

  if (isLoading || !resumen) {
    return (
      <div className="card-pos">
        <LoadingSpinner message="Cargando resumen operativo de caja..." />
      </div>
    );
  }

  const diferencia = (montoFisico ?? 0) - resumen.saldo_esperado;
  const haIngresadoArqueo = montoFisico !== null;

  const pasosCierre = [
    { n: 1, t: 'Resumen del turno' },
    { n: 2, t: 'Conceptos' },
    { n: 3, t: 'Arqueo' },
    { n: 4, t: 'Confirmar' },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="card-pos">
        <h3 className="mb-4 flex items-center gap-2 text-2xl font-bold text-slate-900 sm:text-3xl">
          <Lock className="h-7 w-7 shrink-0 text-primary-600 sm:h-8 sm:w-8" />
          Cerrar caja
        </h3>

        <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-600 sm:gap-x-3 sm:px-4">
          {pasosCierre.map((step, i) => (
            <div key={step.n} className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-800">
                {step.n}
              </span>
              <span className="font-medium text-slate-700">{step.t}</span>
              {i < pasosCierre.length - 1 && <span className="hidden text-slate-300 sm:inline" aria-hidden>→</span>}
            </div>
          ))}
        </div>

        {cerrarMutation.isError && (
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800 font-semibold text-center flex items-center justify-center gap-2">
              <XCircle className="w-5 h-5" />
              {(cerrarMutation.error as Error & { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'No fue posible cerrar la caja.'}
            </p>
          </div>
        )}

        <div className="section-card mb-6 border border-slate-200 p-5 sm:p-6">
          <h4 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900">
            <BarChart3 className="h-5 w-5 text-primary-600" />
            Resumen del turno
          </h4>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-slate-100 bg-slate-50/90 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Monto inicial</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">
                ${formatCurrency(resumen.monto_inicial)}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/80 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Total ingresos</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900 sm:text-2xl">
                +${formatCurrency(resumen.total_ingresos)}
              </p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50/80 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-red-800">Total egresos</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-red-900 sm:text-2xl">
                −${formatCurrency(resumen.total_egresos)}
              </p>
            </div>
            <div className="rounded-lg border border-primary-100 bg-primary-50/60 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-primary-800">Saldo esperado</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-primary-950 sm:text-2xl">
                ${formatCurrency(resumen.saldo_esperado)}
              </p>
            </div>
          </div>
        </div>

        {/* Desglose por Concepto (RTM vs SOAT) */}
        <div className="mb-6">
          <h4 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Desglose por Concepto
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-cyan-50 border-2 border-cyan-200 rounded-lg p-5">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-cyan-700 mb-1 flex items-center gap-1">
                    <Car className="w-4 h-4" />
                    Revisión Técnico-Mecánica
                  </p>
                  <p className="text-sm font-semibold text-cyan-800">Total RTM</p>
                </div>
                <p className="text-3xl font-bold text-cyan-900">
                  ${formatCurrency(resumen.total_rtm)}
                </p>
              </div>
            </div>
            <div className="bg-secondary-50 border-2 border-secondary-200 rounded-lg p-5">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-secondary-700 mb-1 flex items-center gap-1">
                    <Shield className="w-4 h-4" />
                    Seguro Obligatorio
                  </p>
                  <p className="text-sm font-semibold text-secondary-800">Total Comisión SOAT</p>
                </div>
                <p className="text-3xl font-bold text-secondary-900">
                  ${formatCurrency(resumen.total_comision_soat)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* EFECTIVO EN CAJA (Para arqueo) */}
        <div className="mb-6">
          <h4 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Banknote className="w-5 h-5" />
            Efectivo en Caja (Debe estar físicamente)
          </h4>
          <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-green-700 mb-1">Efectivo cobrado en este turno</p>
                <p className="text-xs text-green-600">Este es el único dinero que debe estar en la caja</p>
              </div>
              <p className="text-4xl font-bold text-green-900">
                ${formatCurrency(resumen.efectivo)}
              </p>
            </div>
          </div>
        </div>

        {/* PAGOS ELECTRÓNICOS (No están en caja) */}
        <div className="mb-6">
          <h4 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Pagos Electrónicos (NO están en caja)
          </h4>
          <p className="text-sm text-gray-600 mb-3">
            Estos pagos fueron a cuentas bancarias/billeteras, no se cuentan en el arqueo
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
              <p className="text-xs text-blue-700 mb-1 flex items-center gap-1">
                <CreditCard className="w-4 h-4" />
                Tarjeta Débito
              </p>
              <p className="text-2xl font-bold text-blue-900">
                ${formatCurrency(resumen.tarjeta_debito)}
              </p>
            </div>
            <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-4">
              <p className="text-xs text-indigo-700 mb-1 flex items-center gap-1">
                <CreditCard className="w-4 h-4" />
                Tarjeta Crédito
              </p>
              <p className="text-2xl font-bold text-indigo-900">
                ${formatCurrency(resumen.tarjeta_credito)}
              </p>
            </div>
            <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
              <p className="text-xs text-purple-700 mb-1 flex items-center gap-1">
                <Smartphone className="w-4 h-4" />
                Transferencia
              </p>
              <p className="text-2xl font-bold text-purple-900">
                ${formatCurrency(resumen.transferencia)}
              </p>
            </div>
          </div>
        </div>

        {/* CRÉDITOS (Cuentas por cobrar) */}
        <div className="mb-6">
          <h4 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Créditos CDA (Cuentas por cobrar)
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-orange-50 border-2 border-orange-200 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-orange-700 mb-1 flex items-center gap-1">
                    <Building2 className="w-4 h-4" />
                    CrediSmart
                  </p>
                  <p className="text-xs text-orange-600">Por recaudar</p>
                </div>
                <p className="text-2xl font-bold text-orange-900">
                  ${formatCurrency(resumen.credismart)}
                </p>
              </div>
            </div>
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-yellow-700 mb-1 flex items-center gap-1">
                    <Landmark className="w-4 h-4" />
                    SisteCredito
                  </p>
                  <p className="text-xs text-yellow-600">Por recaudar</p>
                </div>
                <p className="text-2xl font-bold text-yellow-900">
                  ${formatCurrency(resumen.sistecredito)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Detalle de Vehículos por Método de Pago (Expandible) */}
        {vehiculosPorMetodo && resumen.vehiculos_cobrados > 0 && (
          <div className="mb-6">
            <button
              onClick={() => setMostrarDetalleMetodos(!mostrarDetalleMetodos)}
              className="w-full flex justify-between items-center p-4 bg-gray-50 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-primary-600" />
                <div className="text-left">
                  <h4 className="text-lg font-bold text-gray-900">
                    Detalle de Vehículos por Método de Pago
                  </h4>
                  <p className="text-sm text-gray-600">
                    Ver placas cobradas en cada método (para conciliación)
                  </p>
                </div>
              </div>
              <div className="text-gray-500">
                {mostrarDetalleMetodos ? (
                  <ChevronUp className="w-8 h-8" />
                ) : (
                  <ChevronDown className="w-8 h-8" />
                )}
              </div>
            </button>

            {mostrarDetalleMetodos && (
              <div className="mt-4 border-2 border-gray-300 rounded-lg p-4">
                <div className="space-y-4">
                  {/* Efectivo */}
                  {vehiculosPorMetodo.efectivo && vehiculosPorMetodo.efectivo.length > 0 && (
                    <div>
                      <h5 className="font-bold text-green-900 mb-2 flex items-center gap-2">
                        <Banknote className="w-5 h-5" />
                        Efectivo ({vehiculosPorMetodo.efectivo.length})
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {vehiculosPorMetodo.efectivo.map((v, idx) => (
                          <div key={idx} className="bg-green-50 border border-green-200 rounded p-2">
                            <p className="font-bold text-sm">{v.placa}</p>
                            <p className="text-xs text-gray-600">${formatCurrency(v.total_cobrado)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tarjeta Débito */}
                  {vehiculosPorMetodo.tarjeta_debito && vehiculosPorMetodo.tarjeta_debito.length > 0 && (
                    <div>
                      <h5 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
                        <CreditCard className="w-5 h-5" />
                        Tarjeta Débito ({vehiculosPorMetodo.tarjeta_debito.length})
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {vehiculosPorMetodo.tarjeta_debito.map((v, idx) => (
                          <div key={idx} className="bg-blue-50 border border-blue-200 rounded p-2">
                            <p className="font-bold text-sm">{v.placa}</p>
                            <p className="text-xs text-gray-600">${formatCurrency(v.total_cobrado)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tarjeta Crédito */}
                  {vehiculosPorMetodo.tarjeta_credito && vehiculosPorMetodo.tarjeta_credito.length > 0 && (
                    <div>
                      <h5 className="font-bold text-indigo-900 mb-2 flex items-center gap-2">
                        <CreditCard className="w-5 h-5" />
                        Tarjeta Crédito ({vehiculosPorMetodo.tarjeta_credito.length})
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {vehiculosPorMetodo.tarjeta_credito.map((v, idx) => (
                          <div key={idx} className="bg-indigo-50 border border-indigo-200 rounded p-2">
                            <p className="font-bold text-sm">{v.placa}</p>
                            <p className="text-xs text-gray-600">${formatCurrency(v.total_cobrado)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transferencia */}
                  {vehiculosPorMetodo.transferencia && vehiculosPorMetodo.transferencia.length > 0 && (
                    <div>
                      <h5 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
                        <Smartphone className="w-5 h-5" />
                        Transferencia ({vehiculosPorMetodo.transferencia.length})
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {vehiculosPorMetodo.transferencia.map((v, idx) => (
                          <div key={idx} className="bg-purple-50 border border-purple-200 rounded p-2">
                            <p className="font-bold text-sm">{v.placa}</p>
                            <p className="text-xs text-gray-600">${formatCurrency(v.total_cobrado)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pago Mixto */}
                  {vehiculosPorMetodo.mixto && vehiculosPorMetodo.mixto.length > 0 && (
                    <div>
                      <h5 className="font-bold text-teal-900 mb-2 flex items-center gap-2">
                        <CreditCard className="w-5 h-5" />
                        Pago Mixto ({vehiculosPorMetodo.mixto.length})
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {vehiculosPorMetodo.mixto.map((v, idx) => (
                          <div key={idx} className="bg-teal-50 border border-teal-200 rounded p-2">
                            <p className="font-bold text-sm">{v.placa}</p>
                            <p className="text-xs text-gray-600">${formatCurrency(v.total_cobrado)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CrediSmart */}
                  {vehiculosPorMetodo.credismart && vehiculosPorMetodo.credismart.length > 0 && (
                    <div>
                      <h5 className="font-bold text-orange-900 mb-2 flex items-center gap-2">
                        <Building2 className="w-5 h-5" />
                        CrediSmart ({vehiculosPorMetodo.credismart.length})
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {vehiculosPorMetodo.credismart.map((v, idx) => (
                          <div key={idx} className="bg-orange-50 border border-orange-200 rounded p-2">
                            <p className="font-bold text-sm">{v.placa}</p>
                            <p className="text-xs text-gray-600">${formatCurrency(v.total_cobrado)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SisteCredito */}
                  {vehiculosPorMetodo.sistecredito && vehiculosPorMetodo.sistecredito.length > 0 && (
                    <div>
                      <h5 className="font-bold text-yellow-900 mb-2 flex items-center gap-2">
                        <Landmark className="w-5 h-5" />
                        SisteCredito ({vehiculosPorMetodo.sistecredito.length})
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {vehiculosPorMetodo.sistecredito.map((v, idx) => (
                          <div key={idx} className="bg-yellow-50 border border-yellow-200 rounded p-2">
                            <p className="font-bold text-sm">{v.placa}</p>
                            <p className="text-xs text-gray-600">${formatCurrency(v.total_cobrado)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vehículos Cobrados */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-600">Vehículos Cobrados en este Turno</p>
          <p className="text-3xl font-bold text-gray-900">{resumen.vehiculos_cobrados}</p>
        </div>

        {/* Advertencia de Vehículos Pendientes */}
        {vehiculosPendientes.length > 0 && (
          <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-8 h-8 text-yellow-600 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="text-lg font-bold text-yellow-900 mb-2">
                  Atención: Hay {vehiculosPendientes.length} vehículo(s) pendiente(s) de cobro
                </h4>
                <p className="text-sm text-yellow-800 mb-2">
                  Si cierras ahora, estos vehículos quedarán sin cobrar:
                </p>
                <div className="flex flex-wrap gap-2">
                  {vehiculosPendientes.slice(0, 10).map((vehiculo: Vehiculo) => (
                    <span key={vehiculo.id} className="px-3 py-1 bg-yellow-200 text-yellow-900 rounded-lg font-bold text-sm">
                      {vehiculo.placa}
                    </span>
                  ))}
                  {vehiculosPendientes.length > 10 && (
                    <span className="px-3 py-1 bg-yellow-300 text-yellow-900 rounded-lg font-bold text-sm">
                      +{vehiculosPendientes.length - 10} más
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Detalle de Egresos (expandible, mismo patrón que vehículos por método) */}
        {egresos.length > 0 && (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setMostrarDetalleEgresos(!mostrarDetalleEgresos)}
              className="w-full flex justify-between items-center p-4 bg-gray-50 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <ArrowRight className="w-6 h-6 text-red-600 shrink-0" />
                <div className="min-w-0">
                  <h4 className="text-lg font-bold text-gray-900">Detalle de Egresos</h4>
                  <p className="text-sm text-gray-600">
                    {egresosVigentes.length} {egresosVigentes.length === 1 ? 'gasto vigente' : 'gastos vigentes'} en el turno · Total: −$
                    {formatCurrency(resumen.total_egresos)}
                  </p>
                  {egresosAnulados > 0 && (
                    <p className="text-xs text-amber-700 mt-0.5">
                      {egresosAnulados} {egresosAnulados === 1 ? 'movimiento anulado' : 'movimientos anulados'} no impactan el total.
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">Desglose por movimiento (conciliación)</p>
                </div>
              </div>
              <div className="text-gray-500 shrink-0">
                {mostrarDetalleEgresos ? (
                  <ChevronUp className="w-8 h-8" />
                ) : (
                  <ChevronDown className="w-8 h-8" />
                )}
              </div>
            </button>

            {mostrarDetalleEgresos && (
              <div className="mt-4 border-2 border-gray-300 rounded-lg p-4 bg-red-50/40">
                <div className="space-y-3">
                  {egresos.map((egreso) => {
                    const TipoIcono =
                      egreso.tipo === 'gasto'
                        ? ArrowRight
                        : egreso.tipo === 'devolucion'
                          ? CornerUpLeft
                          : Scale;
                    const hora = formatTime24(egreso.created_at);
                    const egresoAnulado = Boolean(egreso.anulado);

                    return (
                      <div
                        key={egreso.id}
                        className={`flex justify-between items-center p-3 bg-white rounded-lg border ${
                          egresoAnulado ? 'border-amber-300 bg-amber-50/40' : 'border-red-200'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <TipoIcono className="w-5 h-5 text-gray-600 shrink-0" />
                            <span className="text-xs text-gray-500">{hora}</span>
                            <span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs font-semibold rounded capitalize">
                              {egreso.tipo}
                            </span>
                            {egresoAnulado && (
                              <span className="px-2 py-0.5 bg-amber-200 text-amber-900 text-xs font-semibold rounded">
                                ANULADO
                              </span>
                            )}
                          </div>
                          {egreso.beneficiario ? (
                            <>
                              <p className="text-sm font-semibold text-gray-900">{egreso.beneficiario}</p>
                              {egreso.beneficiario_tipo_identificacion ? (
                                <p className="text-xs text-gray-500">
                                  {egreso.beneficiario_tipo_identificacion}
                                  {egreso.beneficiario_numero_identificacion
                                    ? ` · ${egreso.beneficiario_numero_identificacion}`
                                    : ''}
                                </p>
                              ) : egreso.beneficiario_numero_identificacion ? (
                                <p className="text-xs text-gray-500">{egreso.beneficiario_numero_identificacion}</p>
                              ) : null}
                              <p className="text-sm font-medium text-gray-800 mt-0.5">{egreso.concepto}</p>
                            </>
                          ) : (
                            <p className="text-sm font-medium text-gray-900">{egreso.concepto}</p>
                          )}
                          {egresoAnulado && (
                            <p className="mt-1 text-xs text-amber-900 break-words">
                              Motivo anulación: {egreso.motivo_anulacion || 'No informado'}
                            </p>
                          )}
                        </div>
                        <p className="text-xl font-bold text-red-600 ml-4 shrink-0">
                          -${formatCurrency(Math.abs(egreso.monto))}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t-2 border-red-300 flex justify-between items-center">
                  <span className="font-bold text-gray-900">Total egresos</span>
                  <span className="text-2xl font-bold text-red-600">
                    -${formatCurrency(resumen.total_egresos)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Arqueo de Efectivo */}
        <div className="mb-6">
          <label className="block text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Arqueo de Efectivo Físico - Contador de Denominaciones
          </label>
          <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-3 mb-3">
            <p className="text-sm font-semibold text-yellow-800">
              👉 Cuenta los billetes y monedas. Saldo esperado: <span className="text-xl">${formatCurrency(resumen.saldo_esperado)}</span>
            </p>
            <p className="text-xs text-yellow-700 mt-1">
              (Monto inicial: ${formatCurrency(resumen.monto_inicial)} + Efectivo cobrado:{' '}
              ${formatCurrency(resumen.total_ingresos_efectivo ?? resumen.efectivo)}
              {resumen.total_egresos > 0 && ` - Egresos: $${formatCurrency(resumen.total_egresos)}`})
            </p>
          </div>
          
          {/* Contador de Billetes */}
          <div className="bg-white border-2 border-gray-300 rounded-lg p-4 mb-4">
            <h5 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Banknote className="w-5 h-5" />
              Billetes
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { key: 'billetes_100000', label: '$100.000', valor: 100000 },
                { key: 'billetes_50000', label: '$50.000', valor: 50000 },
                { key: 'billetes_20000', label: '$20.000', valor: 20000 },
                { key: 'billetes_10000', label: '$10.000', valor: 10000 },
                { key: 'billetes_5000', label: '$5.000', valor: 5000 },
                { key: 'billetes_2000', label: '$2.000', valor: 2000 },
                { key: 'billetes_1000', label: '$1.000', valor: 1000 },
              ].map(({ key, label, valor }) => (
                <div key={key} className="bg-green-50 border border-green-300 rounded-lg p-3">
                  <label className="block text-xs font-semibold text-green-900 mb-1">{label}</label>
                  <input
                    type="number"
                    min="0"
                    value={desglose[key as keyof typeof desglose]}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setDesglose({ ...desglose, [key]: val });
                    }}
                    className="w-full px-2 py-1 text-center border border-green-400 rounded font-bold text-lg"
                    placeholder="0"
                  />
                  <p className="text-xs text-green-700 mt-1 text-center">
                    ${formatCurrency((desglose[key as keyof typeof desglose] as number) * valor)}
                  </p>
                </div>
              ))}
            </div>
          </div>
          
          {/* Contador de Monedas */}
          <div className="bg-white border-2 border-gray-300 rounded-lg p-4 mb-4">
            <h5 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Monedas
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { key: 'monedas_1000', label: '$1.000', valor: 1000 },
                { key: 'monedas_500', label: '$500', valor: 500 },
                { key: 'monedas_200', label: '$200', valor: 200 },
                { key: 'monedas_100', label: '$100', valor: 100 },
                { key: 'monedas_50', label: '$50', valor: 50 },
              ].map(({ key, label, valor }) => (
                <div key={key} className="bg-blue-50 border border-blue-300 rounded-lg p-3">
                  <label className="block text-xs font-semibold text-blue-900 mb-1">{label}</label>
                  <input
                    type="number"
                    min="0"
                    value={desglose[key as keyof typeof desglose]}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setDesglose({ ...desglose, [key]: val });
                    }}
                    className="w-full px-2 py-1 text-center border border-blue-400 rounded font-bold text-lg"
                    placeholder="0"
                  />
                  <p className="text-xs text-blue-700 mt-1 text-center">
                    ${formatCurrency((desglose[key as keyof typeof desglose] as number) * valor)}
                  </p>
                </div>
              ))}
            </div>
          </div>
          
          {/* Total Contado */}
          <div className="bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-lg p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm opacity-90">Total Contado:</p>
                <p className="text-xs opacity-75">Suma de todas las denominaciones</p>
              </div>
              <p className="text-4xl font-bold">
                ${formatCurrency(totalDesglose)}
              </p>
            </div>
          </div>

          {/* Diferencia */}
          {haIngresadoArqueo && (
            <div className={`mt-4 p-4 rounded-lg border-2 ${
              diferencia === 0
                ? 'bg-green-50 border-green-200'
                : diferencia > 0
                ? 'bg-blue-50 border-blue-200'
                : 'bg-red-50 border-red-200'
            }`}>
              <div className="flex justify-between items-center">
                <div>
                  {diferencia === 0 && (
                    <p className="text-sm font-medium flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      Caja Cuadrada
                    </p>
                  )}
                  {diferencia > 0 && (
                    <p className="text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      Sobrante en Caja
                    </p>
                  )}
                  {diferencia < 0 && (
                    <p className="text-sm font-medium flex items-center gap-2">
                      <TrendingDown className="w-5 h-5" />
                      Faltante en Caja
                    </p>
                  )}
                  <p className="text-xs text-gray-600 mt-1">
                    Saldo Esperado: ${formatCurrency(resumen.saldo_esperado)}
                  </p>
                </div>
                <p className={`text-3xl font-bold ${
                  diferencia === 0
                    ? 'text-green-900'
                    : diferencia > 0
                    ? 'text-blue-900'
                    : 'text-red-900'
                }`}>
                  {diferencia === 0 ? '✓' : (diferencia > 0 ? '+' : '') + '$' + formatCurrency(diferencia)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Observaciones */}
        <div className="mb-6">
          <label className="block text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Observaciones
          </label>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            className="input-pos"
            rows={3}
            placeholder="Notas sobre el turno (opcional)"
          />
        </div>

        {/* Botones */}
        <div className="flex gap-4">
          <button
            onClick={onCerrado}
            className="flex-1 btn-pos btn-secondary"
            disabled={cerrarMutation.isLoading}
          >
            Cancelar
          </button>
          <button
            onClick={handleCerrar}
            disabled={cerrarMutation.isLoading || !haIngresadoArqueo}
            className="flex-1 btn-pos btn-danger disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {cerrarMutation.isLoading ? (
              <span>Cerrando...</span>
            ) : (
              <span className="inline-flex items-center justify-center gap-2">
                <Lock className="w-5 h-5" />
                Cerrar Caja
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Componente de Historial de Cajas
function HistorialCajas() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [draftDesde, setDraftDesde] = useState('');
  const [draftHasta, setDraftHasta] = useState('');
  const [rangoAplicado, setRangoAplicado] = useState<{ desde: string; hasta: string } | null>(null);
  const [errorFiltro, setErrorFiltro] = useState<string | null>(null);

  const { data: cajas, isLoading: cajasHistorialLoading, isFetching } = useQuery({
    queryKey: rangoAplicado
      ? ['historial-cajas', 'por-cierre', rangoAplicado.desde, rangoAplicado.hasta]
      : ['historial-cajas', 'recientes'],
    queryFn: () =>
      rangoAplicado
        ? cajasApi.obtenerHistorialPorFechaCierre(rangoAplicado.desde, rangoAplicado.hasta, 200)
        : cajasApi.obtenerHistorial(10),
    refetchInterval: rangoAplicado ? false : 30000,
    keepPreviousData: true,
  });

  const aplicarBusqueda = () => {
    setErrorFiltro(null);
    const d = draftDesde.trim();
    const h = draftHasta.trim();
    if (!d || !h) {
      setErrorFiltro('Selecciona fecha desde y hasta (día de cierre).');
      return;
    }
    if (d > h) {
      setErrorFiltro('La fecha inicial no puede ser posterior a la final.');
      return;
    }
    setRangoAplicado({ desde: d, hasta: h });
  };

  const volverRecientes = () => {
    setErrorFiltro(null);
    setRangoAplicado(null);
    queryClient.invalidateQueries({ queryKey: ['historial-cajas', 'recientes'] });
  };

  const cajasArray = cajas || [];
  const cargaInicial = cajasHistorialLoading && cajasArray.length === 0;

  if (cargaInicial) {
    return <LoadingSpinner message="Cargando historial de caja..." />;
  }

  const etiquetaResumen = rangoAplicado
    ? `Cierres entre ${new Date(rangoAplicado.desde + 'T12:00:00').toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })} y ${new Date(rangoAplicado.hasta + 'T12:00:00').toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })} · hasta 200 registros`
    : `Últimas ${cajasArray.length} cajas (por apertura)`;

  if (cajasArray.length === 0) {
    return (
      <div>
        <div className="card-pos mb-4 p-4 border border-gray-200 rounded-xl bg-gray-50/80">
          <p className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
            <Search className="w-4 h-4" />
            Buscar por fecha de cierre
          </p>
          <p className="text-xs text-gray-600 mb-3">
            El listado habitual sigue siendo las últimas 10 cajas. Usa el rango para ver cierres anteriores (día
            calendario Colombia).
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cierre desde</label>
              <input
                type="date"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={draftDesde}
                onChange={(e) => setDraftDesde(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cierre hasta</label>
              <input
                type="date"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={draftHasta}
                onChange={(e) => setDraftHasta(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={aplicarBusqueda}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg"
            >
              Buscar
            </button>
          </div>
          {errorFiltro && <p className="text-sm text-red-600 mt-2">{errorFiltro}</p>}
        </div>
        <div className="card-pos text-center py-12">
          <div className="flex justify-center mb-4">
            <Folder className="w-20 h-20 text-gray-400" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">Sin resultados</h3>
          <p className="text-gray-600">
            {rangoAplicado
              ? 'No hay cajas cerradas en ese rango de fechas.'
              : 'Aún no hay cajas en el historial reciente.'}
          </p>
          {rangoAplicado && (
            <button
              type="button"
              onClick={volverRecientes}
              className="mt-4 text-sm font-semibold text-primary-600 hover:underline"
            >
              Volver a últimas 10
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card-pos mb-4 p-4 border border-gray-200 rounded-xl bg-gray-50/80">
        <p className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
          <Search className="w-4 h-4" />
          Buscar por fecha de cierre
        </p>
        <p className="text-xs text-gray-600 mb-3">
          Por defecto ves las últimas 10 cajas. El buscador lista cierres cuya <strong>fecha de cierre</strong> cae en
          el rango (hasta 200 registros).
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Cierre desde</label>
            <input
              type="date"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={draftDesde}
              onChange={(e) => setDraftDesde(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Cierre hasta</label>
            <input
              type="date"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={draftHasta}
              onChange={(e) => setDraftHasta(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={aplicarBusqueda}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg"
          >
            Buscar
          </button>
          {rangoAplicado && (
            <button
              type="button"
              onClick={volverRecientes}
              className="px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 text-sm font-semibold rounded-lg"
            >
              Ver últimas 10
            </button>
          )}
        </div>
        {errorFiltro && <p className="text-sm text-red-600 mt-2">{errorFiltro}</p>}
        {isFetching && !cargaInicial && (
          <p className="text-xs text-gray-500 mt-2">Actualizando resultados…</p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-6">
        <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Folder className="w-7 h-7" />
          Historial de Cajas Cerradas
        </h3>
        <p className="text-sm text-gray-600 flex items-center gap-1">
          <BarChart3 className="w-4 h-4 shrink-0" />
          <span>{etiquetaResumen}</span>
        </p>
      </div>

      <div className="grid gap-4">
        {cajasArray.map((caja) => {
          const fechaCierre = caja.fecha_cierre ? new Date(caja.fecha_cierre) : null;
          const diferencia = caja.diferencia || 0;
          const esCerrada = caja.estado === 'cerrada';

          return (
            <div key={caja.id} className="card-pos hover:shadow-xl transition-shadow">
              <div className="flex justify-between items-start">
                {/* Info principal */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-shrink-0">
                      {caja.turno === 'mañana' ? (
                        <Sunrise className="w-8 h-8 text-primary-600" />
                      ) : caja.turno === 'tarde' ? (
                        <Sun className="w-8 h-8 text-orange-500" />
                      ) : (
                        <Moon className="w-8 h-8 text-indigo-600" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-gray-900 capitalize">
                        Turno {caja.turno}
                      </h4>
                      <p className="text-sm text-gray-600">
                        {formatDateWithWeekday(caja.fecha_apertura)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                    <div>
                      <p className="text-xs text-gray-600">Apertura</p>
                      <p className="font-semibold text-gray-900">
                        {formatTime24(caja.fecha_apertura)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Cierre</p>
                      <p className="font-semibold text-gray-900">
                        {fechaCierre ? formatTime24(caja.fecha_cierre!) : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Monto Inicial</p>
                      <p className="font-semibold text-gray-900">
                        ${formatCurrency(caja.monto_inicial)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Saldo Esperado</p>
                      <p className="font-semibold text-gray-900">
                        ${(caja as any).saldo_esperado != null ? formatCurrency((caja as any).saldo_esperado) : '-'}
                      </p>
                    </div>
                  </div>

                  {/* Diferencia */}
                  {esCerrada && diferencia === 0 && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-semibold bg-green-100 text-green-800">
                      <CheckCircle2 className="w-4 h-4" />
                      Cuadrada
                    </div>
                  )}
                  {esCerrada && diferencia > 0 && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-semibold bg-blue-100 text-blue-800">
                      <TrendingUp className="w-4 h-4" />
                      Sobrante: +${formatCurrency(diferencia)}
                    </div>
                  )}
                  {esCerrada && diferencia < 0 && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-semibold bg-red-100 text-red-800">
                      <TrendingDown className="w-4 h-4" />
                      Faltante: ${formatCurrency(diferencia)}
                    </div>
                  )}
                </div>

                {/* Estado y acciones */}
                <div className="text-right flex flex-col gap-2">
                  {esCerrada ? (
                    <div className="flex flex-col gap-2">
                      <span className="px-4 py-2 rounded-lg font-bold text-sm inline-flex items-center gap-2 bg-gray-200 text-gray-800">
                        <Lock className="w-4 h-4" />
                        CERRADA
                      </span>
                      <button
                        onClick={async () => {
                          try {
                            const blob = await cajasApi.descargarComprobanteCierre(caja.id);
                            saveBlobAsFile(
                              blob,
                              `comprobante_cierre_${caja.turno}_${formatLocalDate(new Date(caja.fecha_cierre!))}.pdf`,
                            );
                          } catch (error) {
                            console.error('Error al descargar PDF:', error);
                            showToast('error', 'Descarga fallida', 'No fue posible cargar el comprobante.');
                          }
                        }}
                        className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1 transition-colors"
                        title="Re-imprimir comprobante de cierre"
                      >
                        <Printer className="w-3 h-3" />
                        PDF
                      </button>
                    </div>
                  ) : (
                    <span className="px-4 py-2 rounded-lg font-bold text-sm inline-flex items-center gap-2 bg-green-100 text-green-800">
                      <Unlock className="w-4 h-4" />
                      ABIERTA
                    </span>
                  )}
                </div>
              </div>

              {/* Observaciones si existen */}
              {caja.observaciones_cierre && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-xs text-gray-600 mb-1">Observaciones:</p>
                  <p className="text-sm text-gray-700 italic">{caja.observaciones_cierre}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MovimientosCaja() {
  const { showToast } = useToast();
  const [filtroTexto, setFiltroTexto] = useState('');
  const [movimientoParaAnular, setMovimientoParaAnular] = useState<MovimientoCaja | null>(null);
  const queryClient = useQueryClient();

  const { data: movimientos = [], isLoading } = useQuery({
    queryKey: ['movimientos-caja-tab'],
    queryFn: cajasApi.listarMovimientos,
    refetchInterval: 10000,
    retry: 1,
  });

  const movimientosFiltrados = movimientos.filter((mov) => {
    const term = filtroTexto.trim().toLowerCase();
    if (!term) return true;
    const searchable = [
      mov.tipo,
      mov.metodo_pago,
      mov.concepto,
      mov.beneficiario,
      mov.beneficiario_numero_identificacion,
      mov.id,
      mov.motivo_anulacion,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return searchable.includes(term);
  });

  // Prioridad operativa: primero egresos, luego ingresos.
  // Dentro de cada grupo, mostrar del más reciente al más antiguo.
  const movimientosOrdenados = [...movimientosFiltrados].sort((a, b) => {
    const aEsEgreso = a.monto < 0;
    const bEsEgreso = b.monto < 0;
    if (aEsEgreso !== bEsEgreso) return aEsEgreso ? -1 : 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const totalEgresos = movimientosFiltrados
    .filter((mov) => mov.monto < 0)
    .reduce((acc, mov) => acc + Math.abs(mov.monto), 0);

  if (isLoading) {
    return <LoadingSpinner message="Cargando movimientos de caja..." />;
  }

  if (movimientos.length === 0) {
    return (
      <div className="card-pos text-center py-12">
        <div className="flex justify-center mb-4">
          <Receipt className="w-20 h-20 text-gray-400" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Sin movimientos de caja</h3>
        <p className="text-gray-600">Aun no hay gastos, devoluciones o ajustes en esta caja activa.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card-pos mb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Movimientos del turno</h3>
            <p className="text-sm text-slate-600">
              Total movimientos: {movimientosFiltrados.length} · Egresos filtrados: -$
              {formatCurrency(totalEgresos)}
            </p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              placeholder="Buscar por concepto, beneficiario o ID..."
              className="input-pos pl-9"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {movimientosOrdenados.map((mov) => {
          const esEgreso = mov.monto < 0;
          const tipoLabel =
            mov.tipo === 'gasto'
              ? 'Gasto'
              : mov.tipo === 'devolucion'
                ? 'Devolución'
                : mov.tipo === 'ajuste'
                  ? 'Ajuste'
                  : mov.tipo;

          return (
            <div key={mov.id} className="card-pos border border-slate-200">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        esEgreso ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {esEgreso ? 'Egreso' : 'Ingreso'}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                      {tipoLabel}
                    </span>
                    {mov.anulado && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-700 text-white">
                        ANULADO
                      </span>
                    )}
                    <span className="text-xs text-slate-500">{formatDateTimeShort(mov.created_at)}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 break-words">{mov.concepto}</p>
                  {mov.anulado && (
                    <p className="mt-1 text-xs text-slate-600 break-words">
                      Motivo anulación: {mov.motivo_anulacion || 'No informado'}
                    </p>
                  )}
                  <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      ID: <span className="font-mono">{mov.id.slice(0, 8).toUpperCase()}</span>
                    </span>
                    {mov.metodo_pago && <span>Método: {mov.metodo_pago}</span>}
                    {mov.beneficiario && <span>Beneficiario: {mov.beneficiario}</span>}
                    {mov.beneficiario_numero_identificacion && (
                      <span>ID beneficiario: {mov.beneficiario_numero_identificacion}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-start lg:items-end gap-2">
                  <p className={`text-2xl font-bold tabular-nums ${esEgreso ? 'text-red-600' : 'text-emerald-700'}`}>
                    {esEgreso ? '-' : '+'}${formatCurrency(Math.abs(mov.monto))}
                  </p>
                  {esEgreso && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold inline-flex items-center gap-1"
                        disabled={!!mov.anulado}
                        onClick={async () => {
                          try {
                            await cajasApi.descargarComprobanteEgresoCaja(mov.id);
                          } catch (error: any) {
                            showToast(
                              'error',
                              'No se pudo abrir comprobante',
                              error?.message || 'Intenta nuevamente.',
                            );
                          }
                        }}
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Comprobante
                      </button>
                      <button
                        type="button"
                        disabled={!!mov.anulado}
                        title={mov.anulado ? 'Este movimiento ya está anulado' : 'Anular movimiento'}
                        onClick={() => setMovimientoParaAnular(mov)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${
                          mov.anulado
                            ? 'border border-slate-300 bg-slate-100 text-slate-500 cursor-not-allowed'
                            : 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                        }`}
                      >
                        <Lock className="w-3.5 h-3.5" />
                        Anular
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {movimientoParaAnular && (
        <ModalAnularMovimientoCaja
          movimiento={movimientoParaAnular}
          onClose={() => setMovimientoParaAnular(null)}
          onSuccess={() => {
            setMovimientoParaAnular(null);
            queryClient.invalidateQueries({ queryKey: ['movimientos-caja-tab'] });
            queryClient.invalidateQueries({ queryKey: ['movimientos-caja'] });
            queryClient.invalidateQueries({ queryKey: ['caja-resumen-tiempo-real'] });
            queryClient.invalidateQueries({ queryKey: ['caja-resumen'] });
          }}
        />
      )}
    </div>
  );
}

function ModalAnularMovimientoCaja({
  movimiento,
  onClose,
  onSuccess,
}: {
  movimiento: MovimientoCaja;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showToast } = useToast();
  const [motivo, setMotivo] = useState('');

  const anularMutation = useMutation({
    mutationFn: () => cajasApi.anularMovimiento(movimiento.id, motivo.trim()),
    onSuccess: () => {
      showToast('success', 'Movimiento anulado', 'El movimiento fue anulado y no afectará los saldos.');
      onSuccess();
    },
    onError: (error: any) => {
      showToast(
        'error',
        'No se pudo anular',
        error?.response?.data?.detail || 'Intenta nuevamente.',
      );
    },
  });

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="modal-panel max-w-2xl w-full">
        <div className="p-6">
          <div className="modal-header-sticky -mx-6 px-6 pt-1 pb-4 flex justify-between items-start mb-6 border-b border-slate-200">
            <div>
              <h3 className="text-2xl font-bold text-slate-900 mb-1">Anular movimiento de caja</h3>
              <p className="text-sm text-slate-600">
                ID <span className="font-mono">{movimiento.id.slice(0, 8).toUpperCase()}</span> ·{' '}
                {formatDateTimeShort(movimiento.created_at)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="h-10 w-10 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition flex items-center justify-center text-2xl"
              disabled={anularMutation.isLoading}
            >
              ×
            </button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-4 text-sm text-amber-900">
            <p className="font-semibold">Esta acción no borra el registro.</p>
            <p>El movimiento quedará marcado como anulado y dejará de afectar los saldos de caja.</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 mb-4 text-sm text-slate-700">
            <p>
              <span className="font-semibold">Concepto:</span> {movimiento.concepto}
            </p>
            <p>
              <span className="font-semibold">Monto:</span> -${formatCurrency(Math.abs(movimiento.monto))}
            </p>
          </div>

          <label className="block text-sm font-semibold text-slate-900 mb-2">
            Motivo de anulación <span className="text-red-600">*</span>
          </label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            className="input-pos"
            placeholder="Describe por qué se anula este movimiento (mínimo 10 caracteres)."
            minLength={10}
            maxLength={2000}
          />
          <p className="text-xs text-slate-500 mt-1">{motivo.trim().length}/2000</p>

          <div className="modal-footer-sticky -mx-6 px-6 flex gap-4 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-pos btn-secondary"
              disabled={anularMutation.isLoading}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={anularMutation.isLoading || motivo.trim().length < 10}
              onClick={() => anularMutation.mutate()}
              className="flex-1 btn-pos btn-danger disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {anularMutation.isLoading ? 'Anulando...' : 'Confirmar anulación'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Componente de Vehículos Cobrados Hoy
function VehiculosCobradosHoy({
  vehiculos,
  loading,
  modo = 'hoy',
  permitirCambioMetodo,
}: {
  vehiculos: Vehiculo[],
  loading: boolean,
  modo?: 'hoy' | 'recientes',
  permitirCambioMetodo?: boolean,
}) {
  const { user } = useAuth();
  const [vehiculoSeleccionado, setVehiculoSeleccionado] = useState<Vehiculo | null>(null);
  const [vehiculoCorreccion, setVehiculoCorreccion] = useState<Vehiculo | null>(null);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroEstadoFactura, setFiltroEstadoFactura] = useState<
    'todos' | 'con_factura' | 'sin_factura' | 'corregida' | 'correccion_fallida'
  >('todos');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  const rolActual = user && 'rol' in user ? String((user as { rol?: string }).rol || '').toLowerCase() : '';
  const puedeCorregirFactura = rolActual === 'administrador';
  const permiteCambioMetodo = permitirCambioMetodo ?? (modo === 'hoy');
  const PAGE_SIZE = 24;

  const toInputDate = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const vehiculosFiltrados = useMemo(() => {
    const texto = filtroTexto.trim().toLowerCase();
    return vehiculos.filter((v) => {
      if (texto) {
        const candidato = [
          v.placa || '',
          v.cliente_nombre || '',
          v.cliente_documento || '',
          v.numero_factura_dian || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!candidato.includes(texto)) return false;
      }

      if (filtroEstadoFactura === 'con_factura' && !String(v.numero_factura_dian || '').trim()) return false;
      if (filtroEstadoFactura === 'sin_factura' && String(v.numero_factura_dian || '').trim()) return false;
      if (filtroEstadoFactura === 'corregida' && !Boolean(v.factura_corregida)) return false;
      if (filtroEstadoFactura === 'correccion_fallida' && v.factura_correccion_estado !== 'failed') return false;

      if (fechaDesde || fechaHasta) {
        const fechaPago = toInputDate(v.fecha_pago);
        if (!fechaPago) return false;
        if (fechaDesde && fechaPago < fechaDesde) return false;
        if (fechaHasta && fechaPago > fechaHasta) return false;
      }
      return true;
    });
  }, [vehiculos, filtroTexto, filtroEstadoFactura, fechaDesde, fechaHasta]);

  const totalPaginas = Math.max(1, Math.ceil(vehiculosFiltrados.length / PAGE_SIZE));
  const paginaActual = Math.min(pagina, totalPaginas);
  const vehiculosPagina = useMemo(() => {
    const inicio = (paginaActual - 1) * PAGE_SIZE;
    return vehiculosFiltrados.slice(inicio, inicio + PAGE_SIZE);
  }, [vehiculosFiltrados, paginaActual]);

  useEffect(() => {
    setPagina(1);
  }, [filtroTexto, filtroEstadoFactura, fechaDesde, fechaHasta, modo]);

  const limpiarFiltros = () => {
    setFiltroTexto('');
    setFiltroEstadoFactura('todos');
    setFechaDesde('');
    setFechaHasta('');
    setPagina(1);
  };

  if (loading) {
    return <LoadingSpinner message={modo === 'hoy' ? 'Cargando vehículos cobrados del día...' : 'Cargando cobros recientes...'} />;
  }

  if (vehiculos.length === 0) {
    return (
      <div className="card-pos text-center py-12">
        <div className="flex justify-center mb-4">
          <CheckCircle2 className="w-20 h-20 text-gray-400" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">
          {modo === 'hoy' ? 'No hay cobros hoy' : 'No hay cobros en los últimos 30 días'}
        </h3>
        <p className="text-gray-600">
          {modo === 'hoy' ? 'Aún no se han registrado cobros en esta caja' : 'No se encontraron cobros recientes en la sede activa'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <p className="text-sm text-gray-600">
          {modo === 'hoy'
            ? 'Vehículos cobrados hoy. Puedes cambiar el método de pago solo el mismo día del cobro.'
            : 'Cobros de los últimos 30 días. Usa esta vista para corrección de factura dentro de la ventana permitida.'}
        </p>
        {puedeCorregirFactura && (
          <p className="mt-1 text-xs text-slate-500">
            Como administrador también puedes corregir factura emitida (nota crédito + reemisión) para errores de placa, cliente o valor (preventiva).
          </p>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Buscar (placa, documento, factura)
            </label>
            <input
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              className="input-pos"
              placeholder="Ej: SQC095, 10548228, CDAF12345"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Estado factura
            </label>
            <select
              value={filtroEstadoFactura}
              onChange={(e) => setFiltroEstadoFactura(e.target.value as typeof filtroEstadoFactura)}
              className="input-pos"
            >
              <option value="todos">Todos</option>
              <option value="con_factura">Con factura</option>
              <option value="sin_factura">Sin factura</option>
              <option value="corregida">Corregida</option>
              <option value="correccion_fallida">Corrección fallida</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Fecha desde</label>
            <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="input-pos" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Fecha hasta</label>
            <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="input-pos" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <p>
            Mostrando {vehiculosPagina.length} de {vehiculosFiltrados.length} registros filtrados ({vehiculos.length} totales).
          </p>
          <button
            type="button"
            onClick={limpiarFiltros}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {vehiculosFiltrados.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-600">
          No hay resultados con los filtros aplicados.
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {vehiculosPagina.map((vehiculo) => (
          <div key={vehiculo.id} className="card-pos hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="text-2xl font-bold text-gray-900">{vehiculo.placa}</p>
                <p className="text-sm text-gray-600 capitalize">{vehiculo.tipo_vehiculo}</p>
                {vehiculo.factura_corregida && (
                  <p className="text-xs text-amber-700 mt-1 font-medium">
                    Factura corregida {vehiculo.factura_correccion_factura_original ? `(${vehiculo.factura_correccion_factura_original}` : ''}
                    {vehiculo.factura_correccion_factura_nueva ? ` → ${vehiculo.factura_correccion_factura_nueva}` : ''}
                    {vehiculo.factura_correccion_factura_original ? ')' : ''}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                  COBRADO
                </span>
                {vehiculo.factura_corregida && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      vehiculo.factura_correccion_estado === 'failed'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {vehiculo.factura_correccion_estado === 'failed' ? 'Corrección fallida' : 'Factura corregida'}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1 text-sm mb-4">
              <p className="text-gray-700">
                <span className="font-semibold">Cliente:</span> {vehiculo.cliente_nombre}
              </p>
              <p className="text-gray-700">
                <span className="font-semibold">Método:</span> 
                <span className="ml-2 px-2 py-1 bg-gray-100 rounded text-xs font-medium capitalize">
                  {vehiculo.metodo_pago?.replace('_', ' ')}
                </span>
              </p>
              <p className="text-gray-700">
                <span className="font-semibold">Total:</span> ${formatCurrency(vehiculo.total_cobrado)}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {permiteCambioMetodo && (
                <button
                  onClick={() => setVehiculoSeleccionado(vehiculo)}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Cambiar Método de Pago
                </button>
              )}
              {puedeCorregirFactura && (
                <button
                  onClick={() => setVehiculoCorreccion(vehiculo)}
                  disabled={Boolean(vehiculo.factura_corregida)}
                  title={vehiculo.factura_corregida ? 'Este cobro ya fue corregido y no permite segunda corrección.' : undefined}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2"
                >
                  <CornerUpLeft className="w-4 h-4" />
                  {vehiculo.factura_corregida ? 'Factura ya corregida' : 'Corregir factura emitida'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      )}

      {vehiculosFiltrados.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={paginaActual <= 1}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm text-slate-600">
            Página {paginaActual} de {totalPaginas}
          </span>
          <button
            type="button"
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={paginaActual >= totalPaginas}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      )}

      {/* Modal de cambio de método */}
      {vehiculoSeleccionado && (
        <ErrorBoundary>
          <ModalCambiarMetodoPago
            vehiculo={vehiculoSeleccionado}
            onClose={() => setVehiculoSeleccionado(null)}
          />
        </ErrorBoundary>
      )}
      {vehiculoCorreccion && (
        <ErrorBoundary>
          <ModalCorregirFacturaEmitida
            vehiculo={vehiculoCorreccion}
            onClose={() => setVehiculoCorreccion(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

function ModalCorregirFacturaEmitida({ vehiculo, onClose }: { vehiculo: Vehiculo; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const esPreventivaVehiculo = (vehiculo.tipo_vehiculo || '').toLowerCase() === 'preventiva';
  const [motivo, setMotivo] = useState<CorregirFacturaEmitidaPayload['motivo']>('placa');
  const [nuevaPlaca, setNuevaPlaca] = useState('');
  const [clienteNombre, setClienteNombre] = useState(vehiculo.cliente_nombre || '');
  const [clienteDocumento, setClienteDocumento] = useState(vehiculo.cliente_documento || '');
  const [clienteEmail, setClienteEmail] = useState(vehiculo.cliente_email || '');
  const [clienteTelefono, setClienteTelefono] = useState(vehiculo.cliente_telefono || '');
  const [clienteDireccion, setClienteDireccion] = useState(vehiculo.cliente_direccion || '');
  const [valorPreventivaNuevo, setValorPreventivaNuevo] = useState(
    String(Math.round(Number(vehiculo.valor_rtm || 0))),
  );
  const [observacion, setObservacion] = useState('');
  const { data: historialCorrecciones, isFetching: cargandoHistorial } = useQuery({
    queryKey: ['vehiculo-factura-correcciones', vehiculo.id],
    queryFn: () => vehiculosApi.listarCorreccionesFacturaEmitida(vehiculo.id),
    enabled: !!vehiculo.id,
    retry: 1,
  });

  const corregirMutation = useMutation({
    mutationFn: () => {
      const payload: CorregirFacturaEmitidaPayload = {
        motivo,
        observacion: observacion.trim() || undefined,
      };
      const placaNorm = nuevaPlaca.trim().toUpperCase();
      if (placaNorm) payload.nueva_placa = placaNorm;
      if (clienteNombre.trim() && clienteNombre.trim() !== vehiculo.cliente_nombre) {
        payload.cliente_nombre = clienteNombre.trim();
      }
      if (clienteDocumento.trim() && clienteDocumento.trim() !== vehiculo.cliente_documento) {
        payload.cliente_documento = clienteDocumento.trim();
      }
      if ((clienteEmail || '').trim() !== (vehiculo.cliente_email || '').trim()) {
        payload.cliente_email = clienteEmail.trim() || '';
      }
      if ((clienteTelefono || '').trim() !== (vehiculo.cliente_telefono || '').trim()) {
        payload.cliente_telefono = clienteTelefono.trim() || '';
      }
      if ((clienteDireccion || '').trim() !== (vehiculo.cliente_direccion || '').trim()) {
        payload.cliente_direccion = clienteDireccion.trim() || '';
      }
      if (motivo === 'valor' && esPreventivaVehiculo) {
        const valorNuevo = Number(valorPreventivaNuevo || 0);
        if (valorNuevo > 0) {
          payload.valor_preventiva_nuevo = valorNuevo;
        }
      }
      return vehiculosApi.corregirFacturaEmitida(vehiculo.id, payload);
    },
    onSuccess: (data) => {
      showToast(
        'success',
        'Factura corregida',
        `${data.message}${data.factura_nueva ? ` Nueva factura: ${data.factura_nueva}` : ''}`,
      );
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['vehiculos-cobrados-hoy'] });
        queryClient.invalidateQueries({ queryKey: ['vehiculos-cobrados-recientes', 30] });
        queryClient.invalidateQueries({ queryKey: ['caja-resumen-tiempo-real'] });
        queryClient.invalidateQueries({ queryKey: ['vehiculo-factura-correcciones', vehiculo.id] });
      }, 300);
      onClose();
    },
    onError: (error: unknown) => {
      showToast(
        'error',
        'No se pudo corregir la factura',
        extractApiErrorMessage(error, 'No fue posible ejecutar la nota crédito y reemisión.'),
      );
    },
  });

  const hayCambioCliente =
    clienteNombre.trim() !== (vehiculo.cliente_nombre || '').trim() ||
    clienteDocumento.trim() !== (vehiculo.cliente_documento || '').trim() ||
    (clienteEmail || '').trim() !== (vehiculo.cliente_email || '').trim() ||
    (clienteTelefono || '').trim() !== (vehiculo.cliente_telefono || '').trim() ||
    (clienteDireccion || '').trim() !== (vehiculo.cliente_direccion || '').trim();
  const hayCambioPlaca = nuevaPlaca.trim().toUpperCase() !== '' && nuevaPlaca.trim().toUpperCase() !== vehiculo.placa;
  const valorPreventivaNuevoNum = Number(valorPreventivaNuevo || 0);
  const hayCambioValor =
    motivo === 'valor' &&
    esPreventivaVehiculo &&
    valorPreventivaNuevoNum > 0 &&
    valorPreventivaNuevoNum !== Number(vehiculo.valor_rtm || 0);
  const puedeEnviar = (hayCambioCliente || hayCambioPlaca || hayCambioValor) && observacion.trim().length >= 8;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="modal-panel max-w-3xl w-full max-h-[92vh] overflow-y-auto">
        <div className="p-6">
          <div className="modal-header-sticky -mx-6 px-6 pt-1 pb-4 flex justify-between items-start mb-6 border-b border-slate-200">
            <div>
              <h3 className="text-2xl font-bold text-slate-900">Corregir factura emitida</h3>
              <p className="text-sm text-slate-600 mt-1">
                Placa <span className="font-semibold text-slate-900">{vehiculo.placa}</span> · factura actual{' '}
                <span className="font-semibold text-slate-900">{vehiculo.numero_factura_dian || 'N/D'}</span>
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Esta acción crea nota crédito en Factus y reemite factura con datos corregidos.
                En preventiva también puede registrar ajuste automático por diferencia.
              </p>
            </div>
            <button
              onClick={onClose}
              className="h-10 w-10 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition flex items-center justify-center text-2xl"
            >
              ×
            </button>
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">Motivo de corrección</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['placa', 'documento', 'nombre', 'identificacion', 'valor'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={m === 'valor' && !esPreventivaVehiculo}
                    onClick={() => setMotivo(m)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      motivo === m
                        ? 'border-amber-600 bg-amber-50 text-amber-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {!esPreventivaVehiculo && (
                <p className="text-xs text-slate-500 mt-2">
                  El motivo <span className="font-semibold">valor</span> solo está disponible para servicio preventiva.
                </p>
              )}
              {esPreventivaVehiculo && motivo === 'valor' && (
                <p className="text-xs text-slate-500 mt-2">
                  Para cambios de <span className="font-semibold">valor</span>, la venta debe estar en el mismo mes calendario.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Nueva placa</label>
                <input
                  value={nuevaPlaca}
                  onChange={(e) => setNuevaPlaca(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                  className="input-pos"
                  placeholder="Ej: VPN05G"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Cliente nombre</label>
                <input
                  value={clienteNombre}
                  onChange={(e) => setClienteNombre(e.target.value)}
                  className="input-pos"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Cliente documento</label>
                <input
                  value={clienteDocumento}
                  onChange={(e) => setClienteDocumento(e.target.value)}
                  className="input-pos"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Cliente email</label>
                <input
                  value={clienteEmail}
                  onChange={(e) => setClienteEmail(e.target.value)}
                  className="input-pos"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Cliente teléfono</label>
                <input
                  value={clienteTelefono}
                  onChange={(e) => setClienteTelefono(e.target.value)}
                  className="input-pos"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Cliente dirección</label>
                <input
                  value={clienteDireccion}
                  onChange={(e) => setClienteDireccion(e.target.value)}
                  className="input-pos"
                />
              </div>
              {esPreventivaVehiculo && (
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">Valor correcto preventiva</label>
                  <input
                    value={valorPreventivaNuevo}
                    onChange={(e) => setValorPreventivaNuevo(e.target.value.replace(/\D/g, '').slice(0, 9))}
                    className="input-pos"
                    inputMode="numeric"
                    placeholder="Ej: 70000"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Valor actual: ${formatCurrency(Number(vehiculo.valor_rtm || 0))} · Nuevo: ${formatCurrency(valorPreventivaNuevoNum || 0)}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">Observación (mín. 8 caracteres)</label>
              <textarea
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                className="input-pos"
                rows={3}
                placeholder="Ej: Error de digitación en recepción, se corrige placa y documento."
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-sm font-semibold text-slate-800 mb-2">Historial de correcciones</p>
              {cargandoHistorial ? (
                <p className="text-xs text-slate-500">Cargando historial...</p>
              ) : (historialCorrecciones || []).length === 0 ? (
                <p className="text-xs text-slate-500">Este vehículo no tiene correcciones previas.</p>
              ) : (
                <div className="space-y-2">
                  {(historialCorrecciones || []).slice(0, 5).map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            item.estado === 'failed' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {item.estado === 'failed' ? 'Fallida' : 'Completada'}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {new Date(item.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-700">
                        Motivo: <span className="font-medium">{item.motivo}</span>
                        {item.factura_original ? ` · Orig: ${item.factura_original}` : ''}
                        {item.nota_credito ? ` · NC: ${item.nota_credito}` : ''}
                        {item.factura_nueva ? ` · Nueva: ${item.factura_nueva}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer-sticky -mx-6 px-6 flex gap-4 mt-6 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-pos btn-secondary"
              disabled={corregirMutation.isLoading}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => corregirMutation.mutate()}
              disabled={!puedeEnviar || corregirMutation.isLoading}
              className="flex-1 btn-pos bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {corregirMutation.isLoading ? (
                'Corrigiendo...'
              ) : (
                <>
                  <CornerUpLeft className="w-5 h-5" />
                  Ejecutar NC + Reemisión
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal para cambiar método de pago (incluye corrección a/desde mixto; no altera Factus)
function ModalCambiarMetodoPago({ vehiculo, onClose }: { vehiculo: Vehiculo, onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const motivoInputRef = useRef<HTMLTextAreaElement>(null);
  const totalCobrado = Number(vehiculo.total_cobrado || 0);
  const metodoActual = (vehiculo.metodo_pago || 'efectivo').toLowerCase();

  const emptyDesglose = () => ({
    efectivo: 0,
    tarjeta_debito: 0,
    tarjeta_credito: 0,
    transferencia: 0,
    credismart: 0,
    sistecredito: 0,
  });

  const buildDesgloseInicial = (metodo: string) => {
    const base = emptyDesglose();
    if (metodo && metodo !== 'mixto' && metodo in base) {
      return { ...base, [metodo]: totalCobrado };
    }
    return base;
  };

  const [nuevoMetodo, setNuevoMetodo] = useState(metodoActual);
  const [motivo, setMotivo] = useState('');
  const [desgloseMixto, setDesgloseMixto] = useState<Record<string, number>>(() =>
    buildDesgloseInicial(metodoActual === 'mixto' ? '' : metodoActual)
  );

  const sumaMixto = Object.values(desgloseMixto).reduce((a, b) => a + (Number(b) || 0), 0);
  const desgloseMixtoValido =
    nuevoMetodo === 'mixto'
      ? Math.abs(sumaMixto - totalCobrado) < 1 &&
        Object.values(desgloseMixto).filter((v) => Number(v) > 0).length >= 2
      : true;

  const seleccionarMetodo = (metodoId: string) => {
    setNuevoMetodo(metodoId);
    if (metodoId === 'mixto') {
      setDesgloseMixto(buildDesgloseInicial(metodoActual === 'mixto' ? '' : metodoActual));
    }
  };

  const cambiarMetodoMutation = useMutation({
    mutationFn: () => {
      const desgloseParaEnviar =
        nuevoMetodo === 'mixto'
          ? Object.fromEntries(
              Object.entries(desgloseMixto).filter(([, valor]) => Number(valor) > 0)
            )
          : undefined;
      return vehiculosApi.cambiarMetodoPago(vehiculo.id, nuevoMetodo, motivo, desgloseParaEnviar);
    },
    onSuccess: (data) => {
      showToast(
        'success',
        data.message || 'Método actualizado',
        `Anterior: ${data.metodo_anterior} → Nuevo: ${data.metodo_nuevo}`,
      );

      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['vehiculos-cobrados-hoy'] });
        queryClient.invalidateQueries({ queryKey: ['vehiculos-cobrados-recientes', 30] });
        queryClient.invalidateQueries({ queryKey: ['caja-resumen-tiempo-real'] });
        queryClient.invalidateQueries({ queryKey: ['caja-resumen'] });
        queryClient.invalidateQueries({ queryKey: ['movimientos-caja'] });
        queryClient.invalidateQueries({ queryKey: ['vehiculos-por-metodo'] });
      }, 300);

      onClose();
    },
    onError: (error: any) => {
      showToast(
        'error',
        'No se pudo cambiar el método',
        error.response?.data?.detail || 'Intenta de nuevo o revisa la conexión.',
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nuevoMetodo === metodoActual && nuevoMetodo !== 'mixto') {
      showToast('warning', 'Sin cambios', 'El método seleccionado es el mismo que el actual.');
      return;
    }
    if (nuevoMetodo === 'mixto' && !desgloseMixtoValido) {
      showToast(
        'warning',
        'Desglose incompleto',
        'En pago mixto usa al menos 2 métodos y la suma debe coincidir con el total cobrado.',
      );
      return;
    }
    cambiarMetodoMutation.mutate();
  };

  useEffect(() => {
    motivoInputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (!cambiarMetodoMutation.isLoading) {
          event.preventDefault();
          formRef.current?.requestSubmit();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, cambiarMetodoMutation.isLoading]);

  const metodosPago = [
    { id: 'efectivo', nombre: 'Efectivo', Icono: Banknote, canal: 'Caja', nota: 'Ingresa a caja' },
    { id: 'tarjeta_debito', nombre: 'Tarjeta Débito', Icono: CreditCard, canal: 'Electrónico', nota: 'No entra a caja' },
    { id: 'tarjeta_credito', nombre: 'Tarjeta Crédito', Icono: CreditCard, canal: 'Electrónico', nota: 'No entra a caja' },
    { id: 'transferencia', nombre: 'Transferencia', Icono: Smartphone, canal: 'Electrónico', nota: 'No entra a caja' },
    { id: 'credismart', nombre: 'CrediSmart', Icono: Building2, canal: 'Crédito CDA', nota: 'Cartera del CDA' },
    { id: 'sistecredito', nombre: 'SisteCredito', Icono: Landmark, canal: 'Crédito CDA', nota: 'Cartera del CDA' },
    { id: 'mixto', nombre: 'Pago Mixto', Icono: CreditCard, canal: 'Combinado', nota: 'Múltiples métodos' },
  ];

  const canalSeleccionado = metodosPago.find((m) => m.id === nuevoMetodo)?.canal;
  const puedeConfirmar =
    motivo.length >= 10 &&
    desgloseMixtoValido &&
    (nuevoMetodo !== metodoActual || nuevoMetodo === 'mixto');

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="modal-panel max-w-4xl w-full max-h-[92vh] overflow-y-auto">
        <div className="p-6">
          <div className="modal-header-sticky -mx-6 px-6 pt-1 pb-4 flex justify-between items-start mb-6 border-b border-slate-200">
            <div>
              <h3 className="text-2xl font-bold text-slate-900 mb-1">
                Cambiar Método de Pago
              </h3>
              <p className="text-sm text-slate-600">
                Vehículo: <span className="font-bold text-slate-900">{vehiculo.placa}</span> - {vehiculo.cliente_nombre}
              </p>
            </div>
            <button
              onClick={onClose}
              className="h-10 w-10 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition flex items-center justify-center text-2xl"
            >
              ×
            </button>
          </div>

          <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-yellow-800 font-semibold">
              Método actual: <span className="uppercase">{metodoActual.replace('_', ' ')}</span>
              {' · '}Total cobrado: ${formatCurrency(totalCobrado)}
            </p>
            <p className="text-xs text-yellow-700 mt-1">
              Ajusta solo caja/arqueo/reportes. La factura electrónica Factus ya emitida no se modifica.
            </p>
          </div>

          <form ref={formRef} onSubmit={handleSubmit}>
            <div className="space-y-6">
              <div>
                <label className="block text-lg font-bold text-slate-900 mb-3">
                  Nuevo Método de Pago <span className="text-red-600">*</span>
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {metodosPago.map((metodo) => (
                    <button
                      key={metodo.id}
                      type="button"
                      onClick={() => seleccionarMetodo(metodo.id)}
                      className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                        nuevoMetodo === metodo.id
                          ? metodo.id === 'mixto'
                            ? 'border-teal-600 bg-teal-50 text-teal-900 scale-105'
                            : 'border-blue-600 bg-blue-50 text-blue-900 scale-105'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      <div className="flex justify-center mb-2">
                        <metodo.Icono className="w-6 h-6" />
                      </div>
                      <div className="text-sm mb-1">{metodo.nombre}</div>
                      <div
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          metodo.canal === 'Caja'
                            ? 'bg-emerald-100 text-emerald-800'
                            : metodo.canal === 'Electrónico'
                              ? 'bg-blue-100 text-blue-800'
                              : metodo.canal === 'Combinado'
                                ? 'bg-teal-100 text-teal-800'
                                : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {metodo.canal}
                      </div>
                      <div className="text-[11px] mt-1 opacity-80">{metodo.nota}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {canalSeleccionado === 'Caja'
                    ? 'El ajuste impacta arqueo de caja.'
                    : canalSeleccionado === 'Electrónico'
                      ? 'El ajuste impacta conciliación bancaria.'
                      : canalSeleccionado === 'Combinado'
                        ? 'Solo la parte en efectivo impacta el arqueo; el resto va por su canal.'
                        : 'El ajuste impacta cartera del CDA.'}
                </div>
              </div>

              {nuevoMetodo === 'mixto' && (
                <div className="p-4 bg-teal-50 border-2 border-teal-200 rounded-lg">
                  <h4 className="font-bold text-teal-900 mb-3 flex items-center gap-2">
                    <CreditCard className="w-5 h-5" />
                    Desglose de Pago Mixto
                  </h4>
                  <p className="text-sm text-teal-700 mb-4">
                    Ingresa el monto para cada método. La suma debe ser{' '}
                    <strong>${formatCurrency(totalCobrado)}</strong> (mínimo 2 métodos).
                  </p>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    {(
                      [
                        ['efectivo', 'Efectivo', Banknote],
                        ['tarjeta_debito', 'T. Débito', CreditCard],
                        ['tarjeta_credito', 'T. Crédito', CreditCard],
                        ['transferencia', 'Transferencia', Smartphone],
                        ['credismart', 'CrediSmart', Building2],
                        ['sistecredito', 'SisteCredito', Landmark],
                      ] as const
                    ).map(([key, label, Icono]) => (
                      <div key={key}>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">
                          <Icono className="w-4 h-4 inline mr-1" />
                          {label}
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                          <input
                            type="number"
                            value={desgloseMixto[key] || ''}
                            onChange={(e) =>
                              setDesgloseMixto({
                                ...desgloseMixto,
                                [key]: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            placeholder="0"
                            min="0"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div
                    className={`p-3 rounded-lg border-2 ${
                      desgloseMixtoValido
                        ? 'bg-green-50 border-green-300'
                        : 'bg-yellow-50 border-yellow-300'
                    }`}
                  >
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-semibold">Total ingresado:</span>
                      <span className="text-lg font-bold">${formatCurrency(sumaMixto)}</span>
                    </div>
                    {!desgloseMixtoValido && (
                      <div className="mt-2 text-sm">
                        <span className="font-semibold">Falta: </span>
                        <span className="text-red-600 font-bold">
                          ${formatCurrency(Math.max(0, totalCobrado - sumaMixto))}
                        </span>
                      </div>
                    )}
                    {desgloseMixtoValido && (
                      <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" />
                        Monto correcto
                      </p>
                    )}
                  </div>
                  <div className="mt-3 p-2 bg-white border border-teal-200 rounded text-xs text-teal-800">
                    Solo el <strong>efectivo</strong> se contará en el arqueo de caja.
                  </div>
                </div>
              )}

              <div>
                <label className="block text-lg font-bold text-slate-900 mb-3">
                  Motivo del Cambio <span className="text-red-600">*</span>
                </label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  ref={motivoInputRef}
                  className="input-pos"
                  rows={3}
                  placeholder="Ej: Cliente pagó parte en transferencia, error al registrar, etc."
                  minLength={10}
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Mínimo 10 caracteres</p>
              </div>
            </div>

            <div className="modal-footer-sticky -mx-6 px-6 flex gap-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-pos btn-secondary"
                disabled={cambiarMetodoMutation.isLoading}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={cambiarMetodoMutation.isLoading || !puedeConfirmar}
                className="flex-1 btn-pos btn-primary disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {cambiarMetodoMutation.isLoading ? (
                  <span>Cambiando...</span>
                ) : (
                  <span className="inline-flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-5 h-5" />
                    Confirmar Cambio
                  </span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Componente Modal de Venta Solo SOAT
function ModalVentaSOAT({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const { user } = useAuth();
  const brand = useBrand();
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const placaInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    placa: '',
    tipo_vehiculo: 'moto' as 'moto' | 'carro',
    valor_soat_comercial: '',
    cliente_nombre: '',
    cliente_documento: '',
    metodo_pago: 'efectivo',
  });

  // Calcular comisión automáticamente
  const comisionSOAT = formData.tipo_vehiculo === 'moto' ? 30000 : 50000;

  const ventaSOATMutation = useMutation({
    mutationFn: vehiculosApi.ventaSoat,
    onSuccess: async (vehiculoCreado) => {
      // Generar PDF del recibo
      const { generarPDFVentaSOAT } = await import('../utils/generarPDFVentaSOAT');
      const nombrePDF = await generarPDFVentaSOAT({
        placa: vehiculoCreado.placa,
        tipoVehiculo: formData.tipo_vehiculo,
        valorSoatComercial: parseFloat(formData.valor_soat_comercial),
        comisionCobrada: comisionSOAT,
        clienteNombre: vehiculoCreado.cliente_nombre,
        clienteDocumento: vehiculoCreado.cliente_documento,
        fecha: new Date(),
        nombreCajero: user?.nombre_completo || 'Cajero',
        metodoPago: formData.metodo_pago,
        logoUrl: brand.logoSrc,
      });
      
      showToast('success', 'Venta SOAT registrada', `Recibo generado: ${nombrePDF}`);
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const valorComercial = parseFloat(formData.valor_soat_comercial);
    
    if (isNaN(valorComercial) || valorComercial <= 0) {
      showToast('warning', 'Valor inválido', 'El valor comercial del SOAT debe ser mayor a $0.');
      return;
    }

    ventaSOATMutation.mutate({
      placa: formData.placa.toUpperCase(),
      tipo_vehiculo: formData.tipo_vehiculo,
      valor_soat_comercial: valorComercial,
      cliente_nombre: formData.cliente_nombre.toUpperCase(),
      cliente_documento: formData.cliente_documento,
      metodo_pago: formData.metodo_pago,
    });
  };

  useEffect(() => {
    placaInputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (!ventaSOATMutation.isLoading) {
          event.preventDefault();
          formRef.current?.requestSubmit();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, ventaSOATMutation.isLoading]);

  const metodosPago = [
    { id: 'efectivo', nombre: 'Efectivo', Icono: Banknote, canal: 'Caja', nota: 'Ingresa a caja' },
    { id: 'tarjeta_debito', nombre: 'Tarjeta Débito', Icono: CreditCard, canal: 'Electrónico', nota: 'No entra a caja' },
    { id: 'tarjeta_credito', nombre: 'Tarjeta Crédito', Icono: CreditCard, canal: 'Electrónico', nota: 'No entra a caja' },
    { id: 'transferencia', nombre: 'Transferencia', Icono: Smartphone, canal: 'Electrónico', nota: 'No entra a caja' },
    { id: 'credismart', nombre: 'CrediSmart', Icono: Building2, canal: 'Crédito CDA', nota: 'Cartera del CDA' },
  ];

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="modal-panel max-w-4xl w-full">
        <div className="p-6">
          {/* Header */}
          <div className="modal-header-sticky -mx-6 px-6 pt-1 pb-4 flex justify-between items-start mb-6 border-b border-slate-200">
            <div>
              <h3 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
                <Shield className="w-8 h-8 text-teal-600" />
                Venta Solo SOAT
              </h3>
              <p className="text-sm text-slate-600 mt-1">Cliente compra SOAT sin revisión técnica</p>
            </div>
            <button
              onClick={onClose}
              className="h-10 w-10 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition flex items-center justify-center text-2xl"
            >
              ×
            </button>
          </div>

          {ventaSOATMutation.isError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-800 font-semibold text-center flex items-center justify-center gap-2">
                <XCircle className="w-5 h-5" />
                {(ventaSOATMutation.error as any)?.response?.data?.detail || 'No fue posible registrar la venta SOAT.'}
              </p>
            </div>
          )}

          <form ref={formRef} onSubmit={handleSubmit}>
            <div className="space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {/* Placa */}
                <div>
                  <label className="block text-lg font-bold text-slate-900 mb-3">
                    Placa del Vehículo <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.placa}
                    onChange={(e) => setFormData({ ...formData, placa: e.target.value.toUpperCase() })}
                    ref={placaInputRef}
                    className="input-pos uppercase text-center text-2xl font-bold"
                    placeholder="ABC123"
                    maxLength={6}
                    required
                  />
                </div>

                {/* Tipo de Vehículo */}
                <div>
                  <label className="block text-lg font-bold text-slate-900 mb-3">
                    Tipo de Vehículo <span className="text-red-600">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, tipo_vehiculo: 'moto' })}
                      className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                        formData.tipo_vehiculo === 'moto'
                          ? 'border-primary-600 bg-primary-50 text-primary-900 scale-105'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      🏍️ Moto
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, tipo_vehiculo: 'carro' })}
                      className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                        formData.tipo_vehiculo === 'carro'
                          ? 'border-primary-600 bg-primary-50 text-primary-900 scale-105'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      🚗 Carro
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                {/* Valor Comercial del SOAT */}
                <div className="xl:col-span-3">
                  <label className="block text-lg font-bold text-slate-900 mb-3">
                    Valor Comercial del SOAT <span className="text-red-600">*</span>
                  </label>
                  <p className="text-sm text-slate-600 mb-2">
                    Valor que el cliente pagó por el SOAT (informativo, no ingresa a caja)
                  </p>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-slate-400">$</span>
                    <input
                      type="number"
                      value={formData.valor_soat_comercial}
                      onChange={(e) => setFormData({ ...formData, valor_soat_comercial: e.target.value })}
                      className="input-pos text-2xl text-center font-bold pl-12"
                      placeholder="500000"
                      step="any"
                      min="1"
                      required
                    />
                  </div>
                </div>

                {/* Comisión a Cobrar */}
                <div className="xl:col-span-2 bg-gradient-to-r from-secondary-600 to-secondary-700 text-white rounded-xl p-6">
                  <p className="text-sm opacity-90 mb-1">COMISIÓN A COBRAR</p>
                  <p className="text-4xl font-bold">${comisionSOAT.toLocaleString()}</p>
                  <p className="text-sm mt-2 opacity-90">
                    {formData.tipo_vehiculo === 'moto' ? '🏍️ Moto' : '🚗 Carro'} - Este es el ÚNICO monto que ingresa a caja
                  </p>
                </div>
              </div>

              {/* Datos del Cliente */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-lg font-bold text-slate-900 mb-3">
                    Nombre del Cliente <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.cliente_nombre}
                    onChange={(e) => setFormData({ ...formData, cliente_nombre: e.target.value.toUpperCase() })}
                    className="input-pos uppercase"
                    placeholder="JUAN PEREZ"
                    required
                  />
                </div>
                <div>
                  <label className="block text-lg font-bold text-slate-900 mb-3">
                    Documento <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.cliente_documento}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '');
                      if (value.length <= 10) {
                        setFormData({ ...formData, cliente_documento: value });
                      }
                    }}
                    className="input-pos"
                    placeholder="1234567890"
                    maxLength={10}
                    required
                  />
                </div>
              </div>

              {/* Método de Pago */}
              <div>
                <label className="block text-lg font-bold text-slate-900 mb-3">
                  Método de Pago <span className="text-red-600">*</span>
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {metodosPago.map((metodo) => (
                    <button
                      key={metodo.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, metodo_pago: metodo.id })}
                      className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                        formData.metodo_pago === metodo.id
                          ? 'border-primary-600 bg-primary-50 text-primary-900 scale-105'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      <div className="flex justify-center mb-2">
                        <metodo.Icono className="w-6 h-6" />
                      </div>
                      <div className="text-sm mb-1">{metodo.nombre}</div>
                      <div
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          metodo.canal === 'Caja'
                            ? 'bg-emerald-100 text-emerald-800'
                            : metodo.canal === 'Electrónico'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {metodo.canal}
                      </div>
                      <div className="text-[11px] mt-1 opacity-80">{metodo.nota}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {metodosPago.find((m) => m.id === formData.metodo_pago)?.canal === 'Caja'
                    ? 'Este método se refleja en arqueo de caja.'
                    : metodosPago.find((m) => m.id === formData.metodo_pago)?.canal === 'Electrónico'
                      ? 'Este método se concilia por extracto bancario, no por arqueo físico.'
                      : 'Este método genera cartera (cuenta por cobrar) para seguimiento comercial.'}
                </div>
              </div>
            </div>

            {/* Botones */}
            <div className="modal-footer-sticky -mx-6 px-6 flex gap-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-pos btn-secondary"
                disabled={ventaSOATMutation.isLoading}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={ventaSOATMutation.isLoading}
                className="flex-1 btn-pos btn-success disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {ventaSOATMutation.isLoading ? (
                  'Registrando...'
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    Confirmar Venta
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

