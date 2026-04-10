import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MovimientoTesoreria } from '../api/tesoreria';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ContadorEfectivo, { type DesgloseEfectivo } from '../components/ContadorEfectivo';
import NotificacionesCierreCaja from '../components/NotificacionesCierreCaja';
import { tesoreriaApi } from '../api/tesoreria';
import { formatCurrency } from '../utils/formatNumber';
import {
  Vault,
  BarChart3,
  Plus,
  FileText,
  AlertTriangle,
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowUpCircle,
  ArrowDownCircle,
  Building2,
  Package,
  Receipt,
  Banknote,
  Clock,
  Search,
  Download,
  Trash2
} from 'lucide-react';

export default function TesoreriaPage() {
  const [vistaActual, setVistaActual] = useState<'dashboard' | 'registrar' | 'historial'>('dashboard');

  return (
    <Layout title="Tesorería - Caja Fuerte">
      <section className="module-hero">
        <p className="module-hero-title flex items-center gap-3">
          <Vault className="w-7 h-7 text-primary-600" />
          Tesorería - Caja Fuerte
        </p>
        <p className="module-hero-subtitle">Gestión centralizada del dinero del CDA</p>
      </section>

      {/* Navegación de vistas */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setVistaActual('dashboard')}
          className={`btn-chip px-4 py-2 text-sm sm:text-base ${
            vistaActual === 'dashboard'
              ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
              : 'text-slate-700'
          }`}
        >
          <BarChart3 className="w-5 h-5" />
          Dashboard
        </button>
        <button
          onClick={() => setVistaActual('registrar')}
          className={`btn-chip px-4 py-2 text-sm sm:text-base ${
            vistaActual === 'registrar'
              ? 'bg-secondary-500 text-white border-secondary-500 shadow-sm'
              : 'text-slate-700'
          }`}
        >
          <Plus className="w-5 h-5" />
          Registrar Movimiento
        </button>
        <button
          onClick={() => setVistaActual('historial')}
          className={`btn-chip px-4 py-2 text-sm sm:text-base ${
            vistaActual === 'historial'
              ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
              : 'text-slate-700'
          }`}
        >
          <FileText className="w-5 h-5" />
          Historial
        </button>
      </div>

      {/* Contenido según vista */}
      {vistaActual === 'dashboard' && <Dashboard />}
      {vistaActual === 'registrar' && <RegistrarMovimiento />}
      {vistaActual === 'historial' && <Historial />}
    </Layout>
  );
}

// ==================== DASHBOARD ====================
function Dashboard() {
  const { user } = useAuth();
  const [consolidarTodas, setConsolidarTodas] = useState(false);
  const showConsolidar = user?.rol === 'administrador';
  const scopeParams = showConsolidar && consolidarTodas ? { consolidar_todas: true } : {};

  const { data: saldo, isLoading: loadingSaldo } = useQuery({
    queryKey: ['tesoreria-saldo', consolidarTodas],
    queryFn: () => tesoreriaApi.obtenerSaldoActual(scopeParams),
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const { data: resumen, isLoading: loadingResumen } = useQuery({
    queryKey: ['tesoreria-resumen', consolidarTodas],
    queryFn: () => tesoreriaApi.obtenerResumen(scopeParams),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: desglose, isLoading: loadingDesglose } = useQuery({
    queryKey: ['tesoreria-desglose', consolidarTodas],
    queryFn: () => tesoreriaApi.obtenerDesgloseSaldo(scopeParams),
    enabled: !!saldo,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: desgloseEfectivo } = useQuery({
    queryKey: ['tesoreria-desglose-efectivo', consolidarTodas],
    queryFn: () => tesoreriaApi.obtenerDesgloseEfectivo(scopeParams),
    enabled: !!saldo,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: movimientos, isLoading: loadingMovimientos } = useQuery({
    queryKey: ['tesoreria-movimientos-recientes', consolidarTodas],
    queryFn: () =>
      tesoreriaApi.listarMovimientos({ limit: 5, solo_activos: true, ...scopeParams }),
    enabled: !!saldo,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Mostrar loading solo para queries principales
  if (loadingSaldo || loadingResumen) {
    return <LoadingSpinner message="Cargando panel de tesorería..." />;
  }

  const saldoActual = saldo?.saldo_actual || 0;
  const alertaSaldoBajo = resumen?.saldo_bajo_umbral || false;

  return (
    <div className="space-y-6">
      {/* Notificaciones de cierre de caja */}
      <NotificacionesCierreCaja />

      {showConsolidar && (
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={consolidarTodas}
            onChange={(e) => setConsolidarTodas(e.target.checked)}
            className="rounded border-slate-300"
          />
          Ver tesorería consolidada (todas las sedes)
        </label>
      )}

      {/* Alerta de saldo bajo */}
      {alertaSaldoBajo && (
        <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-red-600" />
            <div>
              <h3 className="text-lg font-bold text-red-900">
                Saldo por debajo del umbral mínimo
              </h3>
              <p className="text-sm text-red-700">
                Saldo actual: ${formatCurrency(saldoActual)} | 
                Umbral mínimo: ${formatCurrency(resumen?.umbral_minimo || 0)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tarjeta principal: Saldo Actual */}
      <div className="card-pos bg-gradient-to-r from-primary-600 to-primary-700 text-white">
        <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
          <Wallet className="w-6 h-6" />
          Saldo Actual en Caja Fuerte
        </h3>
        <p className="text-5xl font-bold mb-4">
          ${formatCurrency(saldoActual)}
        </p>
        <p className="text-sm opacity-90">
          Actualizado: {new Date(saldo?.fecha_calculo || '').toLocaleString('es-CO')}
        </p>
      </div>

      {/* Grid de resumen */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Ingresos del mes */}
        <div className="card-pos bg-blue-50 border-2 border-blue-200">
          <p className="text-sm text-blue-700 mb-1 flex items-center gap-1">
            <TrendingUp className="w-4 h-4" />
            Ingresos del Mes
          </p>
          <p className="text-3xl font-bold text-blue-900">
            ${formatCurrency(resumen?.total_ingresos ?? 0)}
          </p>
        </div>

        {/* Egresos del mes */}
        <div className="card-pos bg-red-50 border-2 border-red-200">
          <p className="text-sm text-red-700 mb-1 flex items-center gap-1">
            <TrendingDown className="w-4 h-4" />
            Egresos del Mes
          </p>
          <p className="text-3xl font-bold text-red-900">
            ${formatCurrency(resumen?.total_egresos ?? 0)}
          </p>
        </div>

        {/* Movimientos */}
        <div className="card-pos bg-purple-50 border-2 border-purple-200">
          <p className="text-sm text-purple-700 mb-1 flex items-center gap-1">
            <FileText className="w-4 h-4" />
            Movimientos
          </p>
          <p className="text-3xl font-bold text-purple-900">
            {resumen?.cantidad_movimientos || 0}
          </p>
        </div>
      </div>

      {/* Tarjetas de Desglose */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tarjeta 1: Medios Electrónicos */}
        <div className="card-pos bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200">
          <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-600" />
            Medios Electrónicos
          </h3>
          <div className="space-y-3">
            {loadingDesglose ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-sm text-slate-500 mt-2">Cargando detalle...</p>
              </div>
            ) : desglose && (
              <>
                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <ArrowUpCircle className="w-4 h-4 text-blue-600" />
                    Transferencia
                  </span>
                  <span className="text-xl font-bold text-blue-600">
                    ${formatCurrency(desglose.desglose.transferencia || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Package className="w-4 h-4 text-orange-600" />
                    Consignación
                  </span>
                  <span className="text-xl font-bold text-orange-600">
                    ${formatCurrency(desglose.desglose.consignacion || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-purple-600" />
                    Cheque
                  </span>
                  <span className="text-xl font-bold text-purple-600">
                    ${formatCurrency(desglose.desglose.cheque || 0)}
                  </span>
                </div>
                <div className="border-t-2 border-blue-300 pt-3 mt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold text-slate-900">Total Electrónico:</span>
                    <span className="text-2xl font-bold text-blue-700">
                      ${formatCurrency(
                        (desglose.desglose.transferencia || 0) +
                        (desglose.desglose.consignacion || 0) +
                        (desglose.desglose.cheque || 0)
                      )}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tarjeta 2: Efectivo con Desglose */}
        <div className="card-pos bg-gradient-to-br from-green-50 to-yellow-50 border-2 border-green-200">
          <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Banknote className="w-6 h-6 text-green-600" />
            Efectivo en Caja
          </h3>
          <div className="mb-4 p-4 bg-secondary-100 border-2 border-secondary-400 rounded-lg">
            <p className="text-sm text-secondary-700 mb-1">Total en Efectivo (libros)</p>
            <p className="text-3xl font-bold text-secondary-900">
              ${formatCurrency(desglose?.desglose.efectivo ?? desgloseEfectivo?.total_efectivo ?? 0)}
            </p>
            <p className="text-xs text-secondary-600 mt-2">
              Coincide con el saldo por método «efectivo» en tesorería. El detalle por billetes y monedas solo
              incluye movimientos que registraron desglose.
            </p>
          </div>

          {desgloseEfectivo &&
            typeof desgloseEfectivo.total_desglosado === 'number' &&
            Math.abs((desgloseEfectivo.total_efectivo || 0) - desgloseEfectivo.total_desglosado) > 0.5 && (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                Parte del efectivo no tiene desglose por denominación (datos antiguos o migrados).{' '}
                <span className="font-semibold">
                  Suma del desglose mostrado: ${formatCurrency(desgloseEfectivo.total_desglosado)}
                </span>
                {' · '}
                <span className="font-semibold">
                  Total contable: ${formatCurrency(desgloseEfectivo.total_efectivo || 0)}
                </span>
              </div>
            )}

          {desgloseEfectivo && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1">
                <Banknote className="w-4 h-4" />
                Desglose por Denominación:
              </p>
              
              {/* Billetes */}
              <div className="space-y-1">
                {desgloseEfectivo.desglose.billetes_100000 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$100.000 x {desgloseEfectivo.desglose.billetes_100000}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.billetes_100000 * 100000)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.billetes_50000 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$50.000 x {desgloseEfectivo.desglose.billetes_50000}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.billetes_50000 * 50000)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.billetes_20000 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$20.000 x {desgloseEfectivo.desglose.billetes_20000}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.billetes_20000 * 20000)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.billetes_10000 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$10.000 x {desgloseEfectivo.desglose.billetes_10000}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.billetes_10000 * 10000)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.billetes_5000 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$5.000 x {desgloseEfectivo.desglose.billetes_5000}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.billetes_5000 * 5000)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.billetes_2000 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$2.000 x {desgloseEfectivo.desglose.billetes_2000}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.billetes_2000 * 2000)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.billetes_1000 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$1.000 x {desgloseEfectivo.desglose.billetes_1000}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.billetes_1000 * 1000)}</span>
                  </div>
                )}

                {/* Monedas */}
                {desgloseEfectivo.desglose.monedas_1000 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$1.000 x {desgloseEfectivo.desglose.monedas_1000}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.monedas_1000 * 1000)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.monedas_500 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$500 x {desgloseEfectivo.desglose.monedas_500}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.monedas_500 * 500)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.monedas_200 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$200 x {desgloseEfectivo.desglose.monedas_200}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.monedas_200 * 200)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.monedas_100 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$100 x {desgloseEfectivo.desglose.monedas_100}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.monedas_100 * 100)}</span>
                  </div>
                )}
                {desgloseEfectivo.desglose.monedas_50 > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>$50 x {desgloseEfectivo.desglose.monedas_50}</span>
                    <span className="font-semibold">${formatCurrency(desgloseEfectivo.desglose.monedas_50 * 50)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Últimos movimientos */}
      <div className="section-card p-5 sm:p-6">
        <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Clock className="w-6 h-6 text-primary-600" />
          Movimientos Recientes
        </h3>
        {loadingMovimientos ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-sm text-slate-500 mt-2">Cargando movimientos recientes...</p>
          </div>
        ) : movimientos && movimientos.length > 0 ? (
          <div className="space-y-3">
            {movimientos.map((mov) => (
              <div key={mov.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 ${
                      mov.tipo === 'ingreso' 
                        ? 'bg-blue-100 text-blue-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {mov.tipo === 'ingreso' ? (
                        <><ArrowDownCircle className="w-3 h-3" /> Ingreso</>
                      ) : (
                        <><ArrowUpCircle className="w-3 h-3" /> Egreso</>
                      )}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(mov.fecha_movimiento).toLocaleDateString('es-CO')}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-900">{mov.concepto}</p>
                </div>
                <p className={`text-xl font-bold ml-4 ${
                  mov.tipo === 'ingreso' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {mov.tipo === 'ingreso' ? '+' : '-'}${formatCurrency(Math.abs(mov.monto))}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-slate-500 py-8">No hay movimientos recientes</p>
        )}
      </div>
    </div>
  );
}

// ==================== REGISTRAR MOVIMIENTO ====================
function RegistrarMovimiento() {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [tipoMovimiento, setTipoMovimiento] = useState<'ingreso' | 'egreso'>('egreso');
  const [formData, setFormData] = useState({
    categoria: '',
    monto: '',
    concepto: '',
    beneficiario: '',  // Nuevo campo
    metodo_pago: 'efectivo',
    numero_comprobante: '',
  });
  const [desgloseEfectivo, setDesgloseEfectivo] = useState<DesgloseEfectivo | null>(null);

  const [modalConfirmar, setModalConfirmar] = useState<{
    payload: Record<string, unknown>;
    resumen: { label: string; value: string }[];
    monto: number;
  } | null>(null);

  // Obtener categorías
  const { data: categorias, isLoading: loadingCategorias, isError: errorCategorias } = useQuery({
    queryKey: ['tesoreria-categorias'],
    queryFn: tesoreriaApi.obtenerCategorias,
  });

  // Obtener inventario de denominaciones disponibles (solo para egresos en efectivo)
  const { data: inventarioDisponible } = useQuery({
    queryKey: ['tesoreria-inventario-disponible'],
    queryFn: () => tesoreriaApi.obtenerDesgloseEfectivo(),
    enabled: tipoMovimiento === 'egreso' && formData.metodo_pago === 'efectivo',
    refetchInterval: 30000,
  });

  // Hook de mutación (debe estar antes de cualquier return)
  const registrarMutation = useMutation({
    mutationFn: tesoreriaApi.crearMovimiento,
    onSuccess: async (movimientoCreado) => {
      // Invalidar TODAS las queries de tesorería (incluso las inactivas)
      queryClient.invalidateQueries({ queryKey: ['tesoreria-saldo'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-resumen'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-movimientos-recientes'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-desglose'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-movimientos'] });
      
      // Refetch inmediato de las queries importantes
      queryClient.refetchQueries({ queryKey: ['tesoreria-saldo'] });
      queryClient.refetchQueries({ queryKey: ['tesoreria-resumen'] });
      queryClient.refetchQueries({ queryKey: ['tesoreria-movimientos-recientes'] });
      queryClient.refetchQueries({ queryKey: ['tesoreria-desglose'] });
      queryClient.refetchQueries({ queryKey: ['tesoreria-desglose-efectivo'] });
      queryClient.refetchQueries({ queryKey: ['tesoreria-inventario-disponible'] });
      
      // Si es egreso, descargar comprobante automáticamente
      if (tipoMovimiento === 'egreso' && movimientoCreado?.id) {
        try {
          await tesoreriaApi.descargarComprobanteEgreso(movimientoCreado.id);
        } catch {
          setFeedback({
            type: 'error',
            message: 'El movimiento fue registrado, pero no fue posible descargar el comprobante.',
          });
        }
      }
      
      // Limpiar formulario
      setFormData({
        categoria: '',
        monto: '',
        concepto: '',
        beneficiario: '',
        metodo_pago: 'efectivo',
        numero_comprobante: '',
      });
      setDesgloseEfectivo(null); // Limpiar desglose también
      
      const mensaje = tipoMovimiento === 'egreso' 
        ? 'Egreso registrado exitosamente. El comprobante se está descargando.'
        : 'Ingreso registrado exitosamente.';
      setFeedback({ type: 'success', message: mensaje });
    },
    onError: (error: any) => {
      console.error('Error al registrar movimiento:', error);
      setFeedback({
        type: 'error',
        message: error.response?.data?.detail || 'No fue posible registrar el movimiento. Intenta nuevamente.',
      });
    },
  });

  useEffect(() => {
    if (!modalConfirmar) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !registrarMutation.isLoading) {
        setModalConfirmar(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalConfirmar, registrarMutation.isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const monto = parseFloat(formData.monto);
    
    // Validar desglose de efectivo si el método de pago es efectivo
    if (formData.metodo_pago === 'efectivo') {
      // El desglose es obligatorio
      if (!desgloseEfectivo) {
        setFeedback({
          type: 'error',
          message: 'El desglose de efectivo es obligatorio. Especifica las denominaciones de billetes y monedas.',
        });
        return;
      }
      
      const calcularTotal = (d: DesgloseEfectivo): number => {
        return (
          d.billetes_100000 * 100000 +
          d.billetes_50000 * 50000 +
          d.billetes_20000 * 20000 +
          d.billetes_10000 * 10000 +
          d.billetes_5000 * 5000 +
          d.billetes_2000 * 2000 +
          d.billetes_1000 * 1000 +
          d.monedas_1000 * 1000 +
          d.monedas_500 * 500 +
          d.monedas_200 * 200 +
          d.monedas_100 * 100 +
          d.monedas_50 * 50
        );
      };
      const totalDesglose = calcularTotal(desgloseEfectivo);
      
      // Validar que el total no sea cero
      if (totalDesglose === 0) {
        setFeedback({
          type: 'error',
          message: 'Debes especificar las denominaciones de billetes y monedas. El desglose no puede estar vacío.',
        });
        return;
      }
      
      // Validar que coincida con el monto
      if (totalDesglose !== monto) {
        setFeedback({
          type: 'error',
          message: `El desglose de efectivo ($${formatCurrency(totalDesglose)}) no coincide con el monto ($${formatCurrency(monto)}). Ajusta las denominaciones para que coincidan.`,
        });
        return;
      }
    }

    // Construir concepto completo con beneficiario si es egreso
    const conceptoCompleto = tipoMovimiento === 'egreso' && formData.beneficiario
      ? `${formData.beneficiario} - ${formData.concepto}`
      : formData.concepto;
    
    const data: Record<string, unknown> = {
      tipo: tipoMovimiento,
      [tipoMovimiento === 'ingreso' ? 'categoria_ingreso' : 'categoria_egreso']: formData.categoria,
      monto,
      concepto: conceptoCompleto,
      metodo_pago: formData.metodo_pago,
      numero_comprobante: formData.numero_comprobante || undefined,
    };
    
    // Incluir desglose si es efectivo
    if (formData.metodo_pago === 'efectivo' && desgloseEfectivo) {
      data.desglose_efectivo = desgloseEfectivo;
    }

    const categoriasLista =
      tipoMovimiento === 'ingreso'
        ? categorias?.ingresos ?? []
        : categorias?.egresos ?? [];
    const catLabel =
      categoriasLista.find((c) => c.value === formData.categoria)?.label ??
      formData.categoria;
    const metodoLabel =
      categorias?.metodos_pago?.find((m) => m.value === formData.metodo_pago)?.label ??
      formData.metodo_pago;

    const resumen: { label: string; value: string }[] = [
      {
        label: 'Operación',
        value:
          tipoMovimiento === 'ingreso'
            ? 'Ingreso: el dinero entra a la caja fuerte (tesorería).'
            : 'Egreso: el dinero sale de la caja fuerte (tesorería).',
      },
      { label: 'Categoría', value: catLabel || '—' },
      {
        label: 'Monto',
        value: `$${formatCurrency(monto)}`,
      },
    ];
    if (tipoMovimiento === 'egreso' && formData.beneficiario) {
      resumen.push({ label: 'Beneficiario', value: formData.beneficiario });
    }
    resumen.push({ label: 'Concepto', value: conceptoCompleto });
    resumen.push({ label: 'Método de pago', value: metodoLabel });
    if (formData.numero_comprobante.trim()) {
      resumen.push({ label: 'Número de comprobante', value: formData.numero_comprobante.trim() });
    }
    if (formData.metodo_pago === 'efectivo') {
      resumen.push({
        label: 'Efectivo',
        value: 'Se registrará el desglose por billetes y monedas indicado abajo en el formulario.',
      });
    }

    setModalConfirmar({ payload: data, resumen, monto });
  };

  const categoriasDisponibles = tipoMovimiento === 'ingreso' 
    ? categorias?.ingresos || []
    : categorias?.egresos || [];

  // Mostrar loading si aún no hay categorías
  if (loadingCategorias) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="card-pos">
          <LoadingSpinner message="Cargando formulario..." />
        </div>
      </div>
    );
  }

  // Mostrar error si no se pudieron cargar las categorías
  if (errorCategorias || !categorias) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="card-pos">
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              <p className="text-red-800 font-bold text-lg">
                No fue posible cargar el formulario
              </p>
            </div>
            <p className="text-red-600 text-sm">
              No fue posible cargar las categorías. Verifica la conexión con el backend.
            </p>
            <button 
              onClick={() => window.location.reload()} 
              className="mt-4 btn-pos btn-primary"
            >
              Recargar Página
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="section-card p-5 sm:p-6">
        <h3 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
          <Plus className="w-7 h-7 text-primary-600" />
          Registrar Movimiento
        </h3>

        {feedback && (
          <div
            className={`mb-6 rounded-lg border p-3 text-sm ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {registrarMutation.isError && (
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6 flex items-center justify-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <p className="text-red-800 font-semibold">
              No fue posible registrar el movimiento
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Tipo de movimiento */}
          <div className="mb-6">
            <label className="block text-lg font-bold text-slate-900 mb-3">
              Tipo de Movimiento
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setTipoMovimiento('ingreso')}
                className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                  tipoMovimiento === 'ingreso'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 scale-105'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-blue-400'
                }`}
              >
                <ArrowDownCircle className="w-10 h-10 mx-auto mb-2" />
                <div className="font-bold">INGRESO</div>
                <div className="text-xs opacity-75">Dinero que entra</div>
              </button>
              <button
                type="button"
                onClick={() => setTipoMovimiento('egreso')}
                className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                  tipoMovimiento === 'egreso'
                    ? 'border-red-600 bg-red-50 text-red-900 scale-105'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-red-400'
                }`}
              >
                <ArrowUpCircle className="w-10 h-10 mx-auto mb-2" />
                <div className="font-bold">EGRESO</div>
                <div className="text-xs opacity-75">Dinero que sale</div>
              </button>
            </div>
          </div>

          {/* Categoría */}
          <div className="mb-6">
            <label className="block text-lg font-bold text-slate-900 mb-3">
              Categoría
            </label>
            <select
              value={formData.categoria}
              onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
              required
              className="input-pos"
            >
              <option value="">Selecciona una categoría</option>
              {categoriasDisponibles.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* Monto */}
          <div className="mb-6">
            <label className="block text-lg font-bold text-slate-900 mb-3">
              Monto
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-400">$</span>
              <input
                type="text"
                inputMode="numeric"
                value={formData.monto}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9]/g, '');
                  setFormData({ ...formData, monto: value });
                }}
                onBlur={(e) => {
                  const num = parseInt(e.target.value) || 0;
                  if (num > 0) {
                    setFormData({ ...formData, monto: num.toString() });
                  }
                }}
                className="input-pos text-2xl text-left font-bold pl-12 pr-4"
                placeholder="Ejemplo: 2000000"
                required
                style={{ width: '100%' }}
              />
            </div>
            {formData.monto && parseFloat(formData.monto) > 0 && (
              <p className="mt-2 text-lg text-center text-slate-700 font-semibold">
                Valor: <span className="text-primary-600">${formatCurrency(parseFloat(formData.monto))}</span>
              </p>
            )}
          </div>

          {/* Beneficiario (solo para egresos) */}
          {tipoMovimiento === 'egreso' && (
            <div className="mb-6">
              <label className="block text-lg font-bold text-slate-900 mb-3">
                Beneficiario / Pagado a
              </label>
              <input
                type="text"
                value={formData.beneficiario}
                onChange={(e) => setFormData({ ...formData, beneficiario: e.target.value })}
                className="input-pos"
                placeholder="Nombre de la persona o entidad"
                minLength={3}
                required
              />
            </div>
          )}

          {/* Concepto */}
          <div className="mb-6">
            <label className="block text-lg font-bold text-slate-900 mb-3">
              Concepto / Detalle
            </label>
            <textarea
              value={formData.concepto}
              onChange={(e) => setFormData({ ...formData, concepto: e.target.value })}
              className="input-pos"
              rows={3}
              placeholder="Describe el movimiento..."
              minLength={5}
              required
            />
          </div>

          {/* Método de pago */}
          <div className="mb-6">
            <label className="block text-lg font-bold text-slate-900 mb-3">
              Método de Pago
            </label>
            <select
              value={formData.metodo_pago}
              onChange={(e) => setFormData({ ...formData, metodo_pago: e.target.value })}
              className="input-pos"
              required
            >
              {!categorias?.metodos_pago || categorias.metodos_pago.length === 0 ? (
                <option value="">Cargando métodos de pago...</option>
              ) : (
                categorias.metodos_pago.map((metodo) => (
                  <option key={metodo.value} value={metodo.value}>
                    {metodo.label}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Número de comprobante */}
          <div className="mb-6">
            <label className="block text-lg font-bold text-slate-900 mb-3">
              Número de Comprobante (Opcional)
            </label>
            <input
              type="text"
              value={formData.numero_comprobante}
              onChange={(e) => setFormData({ ...formData, numero_comprobante: e.target.value })}
              className="input-pos"
              placeholder="Ej: Factura 12345, Cheque 678"
            />
          </div>

          {/* Contador de Efectivo - Solo si el método de pago es efectivo */}
          {formData.metodo_pago === 'efectivo' && formData.monto && parseFloat(formData.monto) > 0 && (
            <div className="mb-6">
              {tipoMovimiento === 'egreso' && inventarioDisponible && (
                <div className="mb-4 bg-blue-50 border-2 border-blue-300 rounded-lg p-4">
                  <p className="text-sm font-bold text-blue-900 mb-2 flex items-center gap-2">
                    <Banknote className="w-5 h-5" />
                    Denominaciones Disponibles en Caja
                  </p>
                  <p className="text-xs text-blue-700">
                    Total efectivo: <span className="font-bold">${formatCurrency(inventarioDisponible.total_efectivo || 0)}</span>
                  </p>
                </div>
              )}
              
              <ContadorEfectivo 
                montoDeclarado={parseFloat(formData.monto)}
                onChange={setDesgloseEfectivo}
                esEgreso={tipoMovimiento === 'egreso'}
                desgloseDisponible={
                  tipoMovimiento === 'egreso' && inventarioDisponible?.desglose
                    ? (inventarioDisponible.desglose as unknown as DesgloseEfectivo)
                    : undefined
                }
              />
            </div>
          )}

          {/* Botones */}
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => setFormData({
                categoria: '',
                monto: '',
                concepto: '',
                beneficiario: '',
                metodo_pago: 'efectivo',
                numero_comprobante: '',
              })}
              className="flex-1 btn-pos btn-secondary"
              disabled={registrarMutation.isLoading}
            >
              Limpiar
            </button>
            <button
              type="submit"
              disabled={registrarMutation.isLoading || !!modalConfirmar}
              className="flex-1 btn-pos btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {registrarMutation.isLoading ? 'Registrando...' : (
                <>
                  <Plus className="w-5 h-5" />
                  Revisar y registrar
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {modalConfirmar && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !registrarMutation.isLoading) {
              setModalConfirmar(null);
            }
          }}
        >
          <div
            className="modal-panel max-w-lg w-full shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmar-tesoreria-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h3
                id="confirmar-tesoreria-titulo"
                className="text-xl font-bold text-slate-900 flex items-center gap-2 mb-1"
              >
                <Vault className="w-6 h-6 text-primary-600 shrink-0" />
                Confirmar movimiento en tesorería
              </h3>
              <p className="text-sm text-slate-600 mb-4">
                Revisa los datos. Al aceptar, el movimiento quedará registrado en la sede activa.
              </p>

              {modalConfirmar.monto > 1_000_000 && (
                <div className="mb-4 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950 flex gap-2 items-start">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>
                    <strong>Monto elevado:</strong> ${formatCurrency(modalConfirmar.monto)}. Verifica que sea
                    correcto antes de confirmar.
                  </span>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  Resumen
                </p>
                <dl className="space-y-2 text-sm">
                  {modalConfirmar.resumen.map((row) => (
                    <div key={row.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-3 gap-y-1">
                      <dt className="text-slate-500 font-medium">{row.label}</dt>
                      <dd className="text-slate-900 break-words">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3 mt-6 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  className="flex-1 btn-pos btn-secondary"
                  disabled={registrarMutation.isLoading}
                  onClick={() => setModalConfirmar(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="flex-1 btn-pos btn-primary flex items-center justify-center gap-2"
                  disabled={registrarMutation.isLoading}
                  onClick={() => {
                    const payload = modalConfirmar.payload;
                    setModalConfirmar(null);
                    registrarMutation.mutate(payload);
                  }}
                >
                  {registrarMutation.isLoading ? 'Registrando…' : 'Aceptar y registrar'}
                </button>
              </div>
              <p className="text-center text-xs text-slate-400 mt-3">
                Tecla <kbd className="px-1 rounded bg-slate-200">Esc</kbd> para cancelar
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== HISTORIAL ====================
function Historial() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [consolidarTodas, setConsolidarTodas] = useState(false);
  const showConsolidar = user?.rol === 'administrador';
  const scopeParams = showConsolidar && consolidarTodas ? { consolidar_todas: true } : {};

  const [filtros, setFiltros] = useState({
    tipo: '',
    fecha_desde: '',
    fecha_hasta: '',
  });
  const [busqueda, setBusqueda] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [movEliminar, setMovEliminar] = useState<MovimientoTesoreria | null>(null);

  const { data: movimientosRaw, isLoading } = useQuery({
    queryKey: ['tesoreria-movimientos', filtros, consolidarTodas],
    queryFn: () =>
      tesoreriaApi.listarMovimientos({
        tipo: filtros.tipo || undefined,
        fecha_desde: filtros.fecha_desde || undefined,
        fecha_hasta: filtros.fecha_hasta || undefined,
        limit: 100,
        solo_activos: false,
        ...scopeParams,
      }),
  });

  const anularMutation = useMutation({
    mutationFn: (id: string) => tesoreriaApi.anularMovimiento(id, scopeParams),
    onSuccess: () => {
      setMovEliminar(null);
      setFeedback({
        type: 'success',
        message:
          'Movimiento anulado. El saldo y el conteo de efectivo vuelven como antes de ese registro. Puedes cargar el movimiento de nuevo si lo necesitas.',
      });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-movimientos'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-saldo'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-resumen'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-desglose'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-desglose-efectivo'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-movimientos-recientes'] });
      queryClient.invalidateQueries({ queryKey: ['tesoreria-inventario-disponible'] });
    },
    onError: (error: unknown) => {
      const msg =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'No fue posible anular el movimiento.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  // Filtrar por búsqueda de texto (en frontend)
  const movimientos = movimientosRaw?.filter(mov => {
    if (!busqueda) return true;
    const searchLower = busqueda.toLowerCase();
    return (
      mov.concepto.toLowerCase().includes(searchLower) ||
      (mov.numero_comprobante && mov.numero_comprobante.toLowerCase().includes(searchLower))
    );
  });

  // Función para exportar a Excel
  const exportarExcel = async () => {
    if (!movimientos || movimientos.length === 0) {
      setFeedback({ type: 'error', message: 'No hay movimientos para exportar.' });
      return;
    }

    try {
      const XLSX = await import('xlsx');

      // Preparar datos para Excel
      const datosExcel = movimientos.map(mov => ({
        'Fecha y hora': new Date(mov.fecha_movimiento).toLocaleString('es-CO'),
        'ID (soporte)': mov.id,
        'Tipo': mov.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
        'Categoría': mov.categoria_ingreso || mov.categoria_egreso || 'N/A',
        'Concepto': mov.concepto,
        'Método de Pago': mov.metodo_pago,
        'Monto': mov.monto,
        'Estado': mov.anulado ? 'Anulado' : 'Vigente',
        'Número Comprobante': mov.numero_comprobante || '',
      }));

      // Crear libro y hoja
      const ws = XLSX.utils.json_to_sheet(datosExcel);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');

      // Generar nombre de archivo con fecha
      const fechaHoy = new Date().toISOString().split('T')[0];
      const nombreArchivo = `Tesoreria_Movimientos_${fechaHoy}.xlsx`;

      // Descargar
      XLSX.writeFile(wb, nombreArchivo);
      setFeedback({ type: 'success', message: 'Archivo Excel exportado correctamente.' });
    } catch (error) {
      console.error('Error exportando Excel:', error);
      setFeedback({ type: 'error', message: 'No fue posible exportar el archivo Excel.' });
    }
  };

  return (
    <div>
      <div className="section-card p-5 sm:p-6 mb-6">
        <h3 className="text-2xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Search className="w-6 h-6 text-primary-600" />
          Filtros
        </h3>

        {showConsolidar && (
          <label className="flex items-center gap-2 text-sm text-slate-700 mb-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={consolidarTodas}
              onChange={(e) => setConsolidarTodas(e.target.checked)}
              className="rounded border-slate-300"
            />
            Incluir todas las sedes
          </label>
        )}
        
        {/* Búsqueda de texto */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1">
            <Search className="w-4 h-4" />
            Buscar en Concepto o Número de Comprobante
          </label>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="input-pos"
            placeholder="Ej: nómina, factura 123, cheque 456..."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Tipo
            </label>
            <select
              value={filtros.tipo}
              onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}
              className="input-pos"
            >
              <option value="">Todos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Desde
            </label>
            <input
              type="date"
              value={filtros.fecha_desde}
              onChange={(e) => setFiltros({ ...filtros, fecha_desde: e.target.value })}
              className="input-pos"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Hasta
            </label>
            <input
              type="date"
              value={filtros.fecha_hasta}
              onChange={(e) => setFiltros({ ...filtros, fecha_hasta: e.target.value })}
              className="input-pos"
            />
          </div>
        </div>
      </div>

      <div className="section-card p-5 sm:p-6">
        {feedback && (
          <div
            className={`mb-4 rounded-lg border p-3 text-sm ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {feedback.message}
          </div>
        )}

        <div className="flex justify-between items-center mb-4">
          <h3 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-7 h-7 text-primary-600" />
            Historial de Movimientos
          </h3>
          <button
            onClick={exportarExcel}
            className="btn-corporate-primary px-4 flex items-center gap-2"
            disabled={!movimientos || movimientos.length === 0}
          >
            <Download className="w-5 h-5" />
            Exportar a Excel
          </button>
        </div>

        {isLoading ? (
          <LoadingSpinner message="Cargando historial de movimientos..." />
        ) : movimientos && movimientos.length > 0 ? (
          <div className="table-shell">
            <table className="table-enterprise table-fixed w-full">
              <colgroup>
                <col className="w-[9.5rem]" />
                <col className="w-[7.25rem]" />
                <col />
                <col className="w-[5.75rem]" />
                <col className="w-[9rem]" />
                <col className="w-[13.5rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Tipo</th>
                  <th>Concepto</th>
                  <th>Estado</th>
                  <th className="table-enterprise-col-monto">Monto</th>
                  <th className="table-enterprise-col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((mov) => (
                  <tr
                    key={mov.id}
                    className={mov.anulado ? 'opacity-60 bg-slate-50/80' : undefined}
                  >
                    <td className="text-sm text-slate-600 whitespace-nowrap align-top">
                      <div>{new Date(mov.fecha_movimiento).toLocaleDateString('es-CO')}</div>
                      <div className="text-xs text-slate-400 font-normal">
                        {new Date(mov.fecha_movimiento).toLocaleTimeString('es-CO', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>
                    <td className="align-middle">
                      <span className={`px-2 py-1 rounded text-xs font-semibold inline-flex items-center gap-1 ${
                        mov.tipo === 'ingreso'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {mov.tipo === 'ingreso' ? (
                          <><ArrowDownCircle className="w-3 h-3 shrink-0" /> Ingreso</>
                        ) : (
                          <><ArrowUpCircle className="w-3 h-3 shrink-0" /> Egreso</>
                        )}
                      </span>
                    </td>
                    <td className="text-sm text-slate-900 break-words min-w-0">
                      <span className={mov.anulado ? 'line-through text-slate-500' : ''}>
                        {mov.concepto}
                      </span>
                    </td>
                    <td className="text-sm align-middle">
                      {mov.anulado ? (
                        <span className="text-amber-800 font-semibold text-xs">Anulado</span>
                      ) : (
                        <span className="text-emerald-700 font-medium text-xs">Vigente</span>
                      )}
                    </td>
                    <td
                      className={`table-enterprise-col-monto text-lg font-bold align-middle ${
                        mov.anulado ? 'text-slate-500' : mov.tipo === 'ingreso' ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {mov.tipo === 'ingreso' ? '+' : '-'}${formatCurrency(Math.abs(mov.monto))}
                    </td>
                    <td className="table-enterprise-col-actions align-middle">
                      <div className="flex flex-col sm:flex-row flex-wrap gap-1 justify-end items-end sm:items-center">
                        {mov.tipo === 'egreso' && !mov.anulado && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await tesoreriaApi.descargarComprobanteEgreso(mov.id);
                              } catch (error) {
                                console.error('Error:', error);
                                setFeedback({
                                  type: 'error',
                                  message: 'No fue posible descargar el comprobante. Intenta nuevamente.',
                                });
                              }
                            }}
                            className="btn-chip border-red-300 bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 inline-flex items-center gap-1"
                            title="Descargar comprobante de egreso"
                          >
                            <Download className="w-3 h-3" />
                            Comprobante
                          </button>
                        )}
                        {!mov.anulado && (
                          <button
                            type="button"
                            onClick={() => setMovEliminar(mov)}
                            className="btn-chip border-slate-300 bg-white text-slate-800 hover:bg-red-50 hover:border-red-300 hover:text-red-800 px-3 py-1 inline-flex items-center gap-1"
                            title="Anular movimiento y revertir saldo"
                          >
                            <Trash2 className="w-3 h-3" />
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-center text-slate-500 py-8">No hay movimientos para mostrar</p>
        )}
      </div>

      {movEliminar && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !anularMutation.isLoading) setMovEliminar(null);
          }}
        >
          <div
            className="modal-panel max-w-md w-full shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="eliminar-tesoreria-titulo"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="p-6">
              <h3
                id="eliminar-tesoreria-titulo"
                className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-2"
              >
                <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
                ¿Eliminar este movimiento?
              </h3>
              <p className="text-sm text-slate-600 mb-3">
                Se <strong>anulará</strong> el registro (no se borra del historial). El{' '}
                <strong>saldo de tesorería</strong> y el <strong>conteo de efectivo por billetes</strong>{' '}
                volverán al estado de <strong>antes</strong> de este movimiento. Luego puedes registrarlo de
                nuevo con los datos correctos.
              </p>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm mb-4">
                <p className="font-semibold text-slate-800">
                  {movEliminar.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} · $
                  {formatCurrency(Math.abs(movEliminar.monto))}
                </p>
                <p className="text-slate-600 mt-1">{movEliminar.concepto}</p>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-3">
                <button
                  type="button"
                  className="flex-1 btn-pos btn-secondary"
                  disabled={anularMutation.isLoading}
                  onClick={() => setMovEliminar(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="flex-1 btn-pos btn-primary bg-red-600 border-red-600 hover:bg-red-700"
                  disabled={anularMutation.isLoading}
                  onClick={() => anularMutation.mutate(movEliminar.id)}
                >
                  {anularMutation.isLoading ? 'Procesando…' : 'Sí, anular movimiento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


