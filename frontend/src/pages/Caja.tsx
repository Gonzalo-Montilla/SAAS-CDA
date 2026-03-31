import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorBoundary from '../components/ErrorBoundary';
import { cajasApi } from '../api/cajas';
import { vehiculosApi } from '../api/vehiculos';
import { configApi } from '../api/config';
import { useAuth } from '../contexts/AuthContext';
import { useBrand } from '../contexts/BrandContext';
import { formatCurrency } from '../utils/formatCurrency';
import { formatDateTimeShort, formatTime24, formatDateWithWeekday } from '../utils/formatDate';
import type { CajaApertura, Vehiculo } from '../types';
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
  Eye,
  CornerUpLeft,
  Receipt,
  Printer
} from 'lucide-react';

export default function CajaPage() {
  const queryClient = useQueryClient();
  const [vistaActual, setVistaActual] = useState<'apertura' | 'cobros' | 'cobrados-hoy' | 'cierre' | 'historial'>('cobros');
  const [mostrarModalGasto, setMostrarModalGasto] = useState(false);
  const [mostrarModalVentaSOAT, setMostrarModalVentaSOAT] = useState(false);

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
    queryFn: async () => {
      console.log('🔍 Obteniendo vehículos pendientes...');
      const data = await vehiculosApi.obtenerPendientes();
      console.log('📦 Respuesta completa del servidor:', data);
      console.log('📦 Tipo:', typeof data);
      console.log('🔢 Es array:', Array.isArray(data));
      
      // Si es un objeto, intentar extraer el array
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        console.log('⚠️ Es un objeto, buscando array dentro...');
        console.log('🔑 Keys del objeto:', Object.keys(data));
        
        // Intentar diferentes estructuras comunes
        if ('vehiculos' in data) {
          console.log('✅ Encontrado en data.vehiculos');
          return Array.isArray((data as any).vehiculos) ? (data as any).vehiculos : [];
        }
        if ('data' in data) {
          console.log('✅ Encontrado en data.data');
          return Array.isArray((data as any).data) ? (data as any).data : [];
        }
        if ('items' in data) {
          console.log('✅ Encontrado en data.items');
          return Array.isArray((data as any).items) ? (data as any).items : [];
        }
        
        console.error('❌ No se encontró array en el objeto');
        return [];
      }
      
      console.log('🔢 Cantidad:', Array.isArray(data) ? data.length : 'N/A');
      return Array.isArray(data) ? data : [];
    },
    enabled: !!cajaActiva, // Solo si hay caja activa
    refetchInterval: 10000, // Refrescar cada 10 segundos
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
    enabled: !!cajaActiva,
    refetchInterval: 10000, // Refrescar cada 10 segundos
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

  // Si no hay caja activa, mostrar solo apertura
  if (!hayCajaActiva) {
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
      {/* Alerta: Caja abierta por mucho tiempo */}
      {cajaAbiertaMuchoTiempo && (
        <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <Clock className="w-8 h-8 text-red-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-red-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Caja abierta por más de {Math.floor(horasDesdeApertura)} horas
              </h3>
              <p className="text-sm text-red-700">
                Apertura: {formatDateTimeShort(cajaActiva!.fecha_apertura)} -
                Considera cerrar la caja al finalizar el turno para evitar errores en los reportes.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header con info de caja */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-2xl shadow-lg p-4 sm:p-6 mb-6">
        <div className="flex flex-col xl:flex-row gap-4 xl:gap-6 xl:items-center xl:justify-between">
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
              <Wallet className="w-7 h-7" />
              Caja Activa
            </h2>
            <div className="flex flex-wrap gap-4 sm:gap-6 text-sm">
              <div>
                <span className="opacity-80">Turno:</span>{' '}
                <span className="font-semibold capitalize">{cajaActiva.turno}</span>
              </div>
              <div>
                <span className="opacity-80">Apertura:</span>{' '}
                <span className="font-semibold">{formatTime24(cajaActiva.fecha_apertura)}</span>
              </div>
              <div>
                <span className="opacity-80">Monto Inicial:</span>{' '}
                <span className="font-semibold">
                  ${cajaActiva.monto_inicial.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
          
          {/* Contador de Efectivo en Tiempo Real */}
          {resumenTiempoReal && (
            <div className="bg-white/20 rounded-lg px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm">
              <p className="text-xs opacity-90 mb-1 flex items-center gap-1">
                <Banknote className="w-4 h-4" />
                Efectivo en Caja
              </p>
              <p className="text-3xl font-bold">
                ${resumenTiempoReal.saldo_esperado.toLocaleString()}
              </p>
              <p className="text-xs opacity-75 mt-1">
                {resumenTiempoReal.vehiculos_cobrados} vehículos cobrados
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setMostrarModalVentaSOAT(true)}
              className="px-6 py-3 bg-secondary-500 text-white rounded-lg font-bold hover:bg-secondary-600 transition-colors inline-flex items-center gap-2 shadow-lg"
            >
              <Shield className="w-5 h-5" />
              Venta SOAT
            </button>
            <button
              onClick={() => setMostrarModalGasto(true)}
              className="px-6 py-3 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors inline-flex items-center gap-2"
            >
              <ArrowRight className="w-5 h-5" />
              Registrar Gasto
            </button>
            <button
              onClick={() => setVistaActual('cierre')}
              className="px-6 py-3 bg-white text-primary-700 rounded-lg font-bold hover:bg-primary-50 transition-colors inline-flex items-center gap-2"
            >
              <Lock className="w-5 h-5" />
              Cerrar Caja
            </button>
          </div>
        </div>
      </div>

      {/* Navegación de vistas */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setVistaActual('cobros')}
          className={`flex-1 py-4 rounded-lg font-semibold text-lg transition-all inline-flex items-center justify-center gap-2 ${ 
            vistaActual === 'cobros'
              ? 'bg-primary-600 text-white shadow-lg'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Banknote className="w-5 h-5" />
          Pendientes
          {vehiculosPendientes && vehiculosPendientes.length > 0 && (
            <span className="ml-2 px-3 py-1 bg-red-500 text-white rounded-full text-sm">
              {vehiculosPendientes.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setVistaActual('cobrados-hoy')}
          className={`flex-1 py-4 rounded-lg font-semibold text-lg transition-all inline-flex items-center justify-center gap-2 ${ 
            vistaActual === 'cobrados-hoy'
              ? 'bg-primary-600 text-white shadow-lg'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          <CheckCircle2 className="w-5 h-5" />
          Cobros de Hoy
          {vehiculosCobradosHoy && vehiculosCobradosHoy.length > 0 && (
            <span className="ml-2 px-3 py-1 bg-green-500 text-white rounded-full text-sm">
              {vehiculosCobradosHoy.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setVistaActual('historial')}
          className={`flex-1 py-4 rounded-lg font-semibold text-lg transition-all inline-flex items-center justify-center gap-2 ${ 
            vistaActual === 'historial'
              ? 'bg-primary-600 text-white shadow-lg'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Folder className="w-5 h-5" />
          Historial
        </button>
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
        />
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
      alert('El monto inicial no puede ser negativo.');
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
        `El monto inicial es muy bajo ($${formData.monto_inicial.toLocaleString()}).\n\n` +
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
                ${ultimaCaja.total_ingresos.toLocaleString()}
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
                  (ultimaCaja.diferencia > 0 ? '+' : '') + '$' + ultimaCaja.diferencia.toLocaleString()
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
  const [vehiculoSeleccionado, setVehiculoSeleccionado] = useState<Vehiculo | null>(null);
  const [busqueda, setBusqueda] = useState('');

  if (loading) {
    return <LoadingSpinner message="Cargando vehículos pendientes de cobro..." />;
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
        </div>
      ) : (
        <ErrorBoundary>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vehiculosFiltrados.map((vehiculo) => (
            <button
              key={vehiculo.id}
              onClick={() => setVehiculoSeleccionado(vehiculo)}
              className="vehicle-card text-left hover:scale-105 transition-transform"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-3xl font-bold text-gray-900">{vehiculo.placa}</p>
                  <p className="text-sm text-gray-600 capitalize">{vehiculo.tipo_vehiculo}</p>
                </div>
                <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">
                  PENDIENTE
                </span>
              </div>

              <div className="space-y-1 text-sm mb-4">
                <p className="text-gray-700">
                  <span className="font-semibold">Cliente:</span> {vehiculo.cliente_nombre}
                </p>
                <p className="text-gray-700">
                  <span className="font-semibold">Documento:</span> {vehiculo.cliente_documento}
                </p>
                <p className="text-gray-700">
                  <span className="font-semibold">Modelo:</span> {vehiculo.ano_modelo}
                </p>
              </div>

              <div className="bg-secondary-50 border-2 border-secondary-200 rounded-lg p-3">
                <p className="text-xs text-secondary-700 mb-1">Total a Cobrar</p>
                <p className="text-2xl font-bold text-secondary-900">
                  ${vehiculo.total_cobrado.toLocaleString()}
                </p>
              </div>

              <div className="mt-4 py-3 bg-primary-600 text-white rounded-lg font-bold text-center flex items-center justify-center gap-2">
                <CreditCard className="w-5 h-5" />
                COBRAR
              </div>
            </button>
          ))}
          </div>
        </ErrorBoundary>
      )}

      {/* Modal de Cobro */}
      {vehiculoSeleccionado && (
        <ErrorBoundary>
          <ModalCobro
            vehiculo={vehiculoSeleccionado}
            onClose={() => setVehiculoSeleccionado(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

// Componente Modal de Cobro
function ModalCobro({ vehiculo, onClose }: { vehiculo: Vehiculo, onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const brand = useBrand();
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
  
  // Estado para desglose de pago mixto
  const [desgloseMixto, setDesgloseMixto] = useState({
    efectivo: 0,
    tarjeta_debito: 0,
    tarjeta_credito: 0,
    transferencia: 0,
    credismart: 0,
    sistecredito: 0,
  });

  // Calcular total a cobrar ajustado
  const calcularTotalAjustado = () => {
    if (esPreventiva) {
      const valorBase = parseFloat(valorPreventiva) || 0;
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

  // Calcular suma del desglose mixto
  const sumaMixto = Object.values(desgloseMixto).reduce((acc, val) => acc + val, 0);
  // Tolerancia de 1 peso para errores de redondeo
  const desgloseMixtoValido = metodoPago === 'mixto' ? Math.abs(sumaMixto - totalAjustado) < 1 : true;
  
  // Validar que los 3 registros externos + factura DIAN estén completos
  const todosRegistrados = registros.registrado_runt && registros.registrado_sicov && registros.registrado_indra && !!numeroFactura;
  
  // Validar que si es preventiva, tenga valor
  const preventivaTieneValor = esPreventiva ? parseFloat(valorPreventiva) > 0 : true;
  
  const puedeConfirmarCobro = todosRegistrados && preventivaTieneValor && desgloseMixtoValido;

  const cobrarMutation = useMutation({
    mutationFn: vehiculosApi.cobrar,
    onSuccess: async (vehiculoCobrado) => {
      // Generar PDF del recibo de pago
      const comisionFinal = clientePagaSOAT ? vehiculo.comision_soat : 0;
      const { generarPDFReciboPago } = await import('../utils/generarPDFReciboPago');
      const nombrePDF = await generarPDFReciboPago({
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
        numeroFacturaDIAN: numeroFactura,
        fecha: new Date(),
        nombreCajero: user?.nombre_completo || 'Cajero',
        logoUrl: brand.logoSrc,
      });
      
      alert(`Cobro registrado exitosamente.\n\nRecibo generado: ${nombrePDF}`);
      
      // Defer query invalidation to prevent React DOM errors
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['vehiculos-pendientes'] });
      }, 300);
      
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
      numero_factura_dian: numeroFactura || undefined,
      valor_preventiva: esPreventiva ? parseFloat(valorPreventiva) : undefined,
      desglose_mixto: desgloseParaEnviar,
      ...registros,
    });
  };

  const getMetodoStyles = (metodoPago: string, selectedMetodo: string) => {
    const isSelected = metodoPago === selectedMetodo;
    
    const styles: Record<string, string> = {
      efectivo: isSelected 
        ? 'border-green-600 bg-green-50 text-green-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      tarjeta_debito: isSelected 
        ? 'border-blue-600 bg-blue-50 text-blue-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      tarjeta_credito: isSelected 
        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      transferencia: isSelected 
        ? 'border-purple-600 bg-purple-50 text-purple-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      mixto: isSelected 
        ? 'border-teal-600 bg-teal-50 text-teal-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      credismart: isSelected 
        ? 'border-orange-600 bg-orange-50 text-orange-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      sistecredito: isSelected 
        ? 'border-yellow-600 bg-yellow-50 text-yellow-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
    };
    
    return styles[metodoPago] || '';
  };

  const metodosPago = [
    { id: 'efectivo', nombre: 'Efectivo', Icono: Banknote, descripcion: 'Entra a caja' },
    { id: 'tarjeta_debito', nombre: 'Tarjeta Débito', Icono: CreditCard, descripcion: 'No entra a caja' },
    { id: 'tarjeta_credito', nombre: 'Tarjeta Crédito', Icono: CreditCard, descripcion: 'No entra a caja' },
    { id: 'transferencia', nombre: 'Transferencia', Icono: Smartphone, descripcion: 'No entra a caja' },
    { id: 'credismart', nombre: 'CrediSmart', Icono: Building2, descripcion: 'Crédito CDA' },
    { id: 'sistecredito', nombre: 'SisteCredito', Icono: Landmark, descripcion: 'Crédito CDA' },
    { id: 'mixto', nombre: 'Pago Mixto', Icono: CreditCard, descripcion: 'Múltiples métodos' },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-3xl font-bold text-gray-900">Cobrar Vehículo</h3>
              <p className="text-xl font-bold text-primary-600 mt-1">{vehiculo.placa}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-3xl"
            >
              ×
            </button>
          </div>

          {cobrarMutation.isError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-800 font-semibold text-center flex items-center justify-center gap-2">
                <XCircle className="w-5 h-5" />
                {(cobrarMutation.error as Error & { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'No fue posible registrar el cobro.'}
              </p>
            </div>
          )}

          {/* Resumen del Vehículo */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-600">Cliente</p>
                <p className="font-semibold">{vehiculo.cliente_nombre}</p>
              </div>
              <div>
                <p className="text-gray-600">Documento</p>
                <p className="font-semibold">{vehiculo.cliente_documento}</p>
              </div>
              <div>
                <p className="text-gray-600">Tipo</p>
                <p className="font-semibold capitalize">{vehiculo.tipo_vehiculo}</p>
              </div>
              <div>
                <p className="text-gray-600">Modelo</p>
                <p className="font-semibold">{vehiculo.ano_modelo}</p>
              </div>
            </div>
          </div>

          {/* Total a Cobrar */}
          <div className="bg-gradient-to-r from-secondary-600 to-secondary-700 text-white rounded-xl p-6 mb-6">
            {esPreventiva ? (
              <div>
                <p className="text-sm opacity-90 mb-3">SERVICIO PREVENTIVA - Ingrese el valor</p>
                <div className="bg-white rounded-lg p-4 mb-3">
                  <input
                    type="number"
                    value={valorPreventiva}
                    onChange={(e) => setValorPreventiva(e.target.value)}
                    placeholder="Ej: 50000"
                    min="0"
                    step="1000"
                    className="w-full text-4xl font-bold text-gray-900 border-none focus:ring-0 p-0 text-center"
                  />
                </div>
                {vehiculo.tiene_soat && clientePagaSOAT && (
                  <p className="text-sm opacity-90 flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-4 h-4" />
                    + Comisión SOAT: ${vehiculo.comision_soat.toLocaleString()}
                  </p>
                )}
                {parseFloat(valorPreventiva) > 0 && (
                  <div className="mt-3 pt-3 border-t border-white border-opacity-30">
                    <p className="text-sm opacity-90 mb-1">TOTAL A COBRAR</p>
                    <p className="text-3xl font-bold">${totalAjustado.toLocaleString()}</p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <p className="text-sm opacity-90 mb-1">TOTAL A COBRAR</p>
                <p className="text-4xl font-bold">${totalAjustado.toLocaleString()}</p>
                {vehiculo.tiene_soat && (
                  <div className="mt-3">
                    {clientePagaSOAT ? (
                      <p className="text-sm opacity-90 flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-4 h-4" />
                        Incluye comisión SOAT: ${vehiculo.comision_soat.toLocaleString()}
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

          {/* Control de Comisión SOAT (si aplica) */}
          {vehiculo.tiene_soat && vehiculo.comision_soat > 0 && (
            <div className="mb-6">
              <div className="bg-secondary-50 border-2 border-secondary-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-secondary-900 flex items-center gap-2">
                      <Shield className="w-5 h-5" />
                      Cliente registrado con SOAT
                    </p>
                    <p className="text-xs text-secondary-700">Comisión original: ${vehiculo.comision_soat.toLocaleString()}</p>
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
                      <span>El total se reducirá en <strong>${vehiculo.comision_soat.toLocaleString()}</strong>. El cliente NO pagará SOAT.</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Métodos de Pago */}
          <div className="mb-6">
            <label className="block text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              Método de Pago
            </label>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {metodosPago.map((metodo) => (
                <button
                  key={metodo.id}
                  type="button"
                  onClick={() => setMetodoPago(metodo.id)}
                  className={`p-4 rounded-lg border-2 font-semibold transition-all ${getMetodoStyles(metodo.id, metodoPago)}`}
                >
                  <div className="flex justify-center mb-2">
                    <metodo.Icono className="w-8 h-8" />
                  </div>
                  <div className="mb-1">{metodo.nombre}</div>
                  <div className="text-xs opacity-75">{metodo.descripcion}</div>
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
                  Ingresa el monto para cada método de pago. La suma debe ser <strong>${totalAjustado.toLocaleString()}</strong>
                </p>
                
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      <Banknote className="w-4 h-4 inline mr-1" />
                      Efectivo
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.efectivo || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, efectivo: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      <CreditCard className="w-4 h-4 inline mr-1" />
                      T. Débito
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.tarjeta_debito || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, tarjeta_debito: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      <CreditCard className="w-4 h-4 inline mr-1" />
                      T. Crédito
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.tarjeta_credito || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, tarjeta_credito: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      <Smartphone className="w-4 h-4 inline mr-1" />
                      Transferencia
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.transferencia || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, transferencia: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      <Building2 className="w-4 h-4 inline mr-1" />
                      CrediSmart
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.credismart || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, credismart: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      <Landmark className="w-4 h-4 inline mr-1" />
                      SisteCredito
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        value={desgloseMixto.sistecredito || ''}
                        onChange={(e) => setDesgloseMixto({ ...desgloseMixto, sistecredito: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
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
                    <span className="text-lg font-bold">${sumaMixto.toLocaleString()}</span>
                  </div>
                  {Math.abs(sumaMixto - totalAjustado) >= 1 && (
                    <div className="mt-2 text-sm">
                      <span className="font-semibold">Falta: </span>
                      <span className="text-red-600 font-bold">${(totalAjustado - sumaMixto).toLocaleString()}</span>
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

          {/* Registros Externos */}
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

          {/* Factura DIAN */}
          <div className="mb-6">
            <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-bold text-amber-900 flex items-center gap-2">
                    <Receipt className="w-5 h-5" />
                    Número de Factura DIAN <span className="text-red-600">*</span>
                  </h4>
                  <p className="text-xs text-amber-700">Registro obligatorio para facturación electrónica</p>
                </div>
              </div>
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
            </div>

            {/* Alerta si faltan registros */}
            {!todosRegistrados && (
              <div className="mt-4 p-3 bg-yellow-50 border-2 border-yellow-200 rounded-lg">
                <p className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  Debes marcar los 4 registros para confirmar el cobro
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

          {/* Botones */}
          <div className="flex gap-4">
            <button
              onClick={onClose}
              className="flex-1 btn-pos btn-secondary"
              disabled={cobrarMutation.isLoading}
            >
              Cancelar
            </button>
            <button
              onClick={handleCobrar}
              disabled={cobrarMutation.isLoading || !puedeConfirmarCobro}
              className="flex-1 btn-pos btn-success disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {cobrarMutation.isLoading ? (
                <span>Procesando...</span>
              ) : (
                <span className="inline-flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  Confirmar Cobro
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Componente Modal de Gasto
function ModalGasto({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const brand = useBrand();
  const [formData, setFormData] = useState({
    tipo: 'gasto',
    monto: '',
    concepto: '',
  });
  const [mostrarExito, setMostrarExito] = useState(false);
  const [nombreArchivoPDF, setNombreArchivoPDF] = useState('');

  // Obtener caja activa para datos del comprobante
  const { data: cajaActiva } = useQuery({
    queryKey: ['caja-activa'],
    queryFn: cajasApi.obtenerActiva,
  });

  const registrarGastoMutation = useMutation({
    mutationFn: cajasApi.crearMovimiento,
    onSuccess: async () => {
      // Generar número de comprobante (usar ID del movimiento)
      const numeroComprobante = `EG-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      
      // Generar PDF del comprobante
      const { generarPDFComprobanteEgreso } = await import('../utils/generarPDFComprobanteEgreso');
      const nombrePDF = await generarPDFComprobanteEgreso({
        numeroComprobante,
        tipo: formData.tipo,
        monto: Math.abs(parseFloat(formData.monto)),
        concepto: formData.concepto,
        fecha: new Date(),
        nombreCajero: user?.nombre_completo || 'Cajero',
        turno: cajaActiva?.turno || 'N/A',
        logoUrl: brand.logoSrc,
      });
      
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
    
    // Confirmación para gastos grandes (>$50,000)
    if (monto > 50000) {
      const confirmar = window.confirm(
        `Monto alto detectado: $${monto.toLocaleString()}.\n\n` +
        `Concepto: ${formData.concepto}\n\n` +
        `¿Confirmas registrar este gasto?`
      );
      if (!confirmar) {
        return;
      }
    }
    
    // Convertir monto a negativo para egresos
    const montoNegativo = -Math.abs(monto);
    
    registrarGastoMutation.mutate({
      tipo: formData.tipo,
      monto: montoNegativo,
      concepto: formData.concepto,
      metodo_pago: 'efectivo',
      ingresa_efectivo: false, // Sale de efectivo (NO ingresa)
    });
  };

  const tiposGasto = [
    { id: 'gasto', nombre: 'Gasto', Icono: ArrowRight, descripcion: 'Compras, servicios, etc.' },
    { id: 'devolucion', nombre: 'Devolución', Icono: CornerUpLeft, descripcion: 'Devolución a cliente' },
    { id: 'ajuste', nombre: 'Ajuste', Icono: Scale, descripcion: 'Corrección de caja' },
  ];

  const getTipoGastoStyles = (tipoId: string) => {
    const isSelected = formData.tipo === tipoId;
    
    const styles: Record<string, string> = {
      gasto: isSelected 
        ? 'border-red-600 bg-red-50 text-red-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      devolucion: isSelected 
        ? 'border-orange-600 bg-orange-50 text-orange-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      ajuste: isSelected 
        ? 'border-blue-600 bg-blue-50 text-blue-900 scale-105' 
        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
    };
    
    return styles[tipoId] || '';
  };

  const montoNumerico = parseFloat(formData.monto) || 0;

  // Modal de éxito
  if (mostrarExito) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
          <div className="p-6 text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle2 className="w-16 h-16 text-green-500" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">
              Gasto Registrado
            </h3>
            <p className="text-gray-600 mb-2">
              Se registró un egreso de:
            </p>
            <p className="text-3xl font-bold text-red-600 mb-4">
              ${montoNumerico.toLocaleString()}
            </p>
            
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm font-semibold text-blue-900 mb-2 flex items-center justify-center gap-2">
                <FileText className="w-5 h-5" />
                Comprobante Generado
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
              className="w-full btn-pos btn-primary inline-flex items-center justify-center gap-2"
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                <ArrowRight className="w-8 h-8" />
                Registrar Gasto
              </h3>
              <p className="text-sm text-gray-600 mt-1">Registra salidas de efectivo de la caja</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-3xl"
            >
              ×
            </button>
          </div>

          {registrarGastoMutation.isError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-800 font-semibold text-center flex items-center justify-center gap-2">
                <XCircle className="w-5 h-5" />
                {(registrarGastoMutation.error as Error & { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'No fue posible registrar el gasto.'}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Tipo de Movimiento */}
            <div className="mb-6">
              <label className="block text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Tipo de Movimiento
              </label>
              <div className="grid grid-cols-3 gap-3">
                {tiposGasto.map((tipo) => (
                  <button
                    key={tipo.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, tipo: tipo.id })}
                    className={`p-4 rounded-lg border-2 font-semibold transition-all ${getTipoGastoStyles(tipo.id)}`}
                  >
                    <div className="flex justify-center mb-2">
                      <tipo.Icono className="w-8 h-8" />
                    </div>
                    <div className="font-bold mb-1">{tipo.nombre}</div>
                    <div className="text-xs opacity-75">{tipo.descripcion}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Monto */}
            <div className="mb-6">
              <label className="block text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Monto del Gasto
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-3xl font-bold text-gray-400">$</span>
                <input
                  type="number"
                  value={formData.monto}
                  onChange={(e) => setFormData({ ...formData, monto: e.target.value })}
                  className="input-pos text-3xl text-center font-bold pl-12"
                  placeholder="0"
                  step="any"
                  min="1"
                  required
                />
              </div>
              {montoNumerico > 0 && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800 text-center flex items-center justify-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    Este monto <strong>saldrá</strong> del efectivo en caja
                  </p>
                </div>
              )}
            </div>

            {/* Concepto */}
            <div className="mb-6">
              <label className="block text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Concepto (Detalle del gasto)
              </label>
              <textarea
                value={formData.concepto}
                onChange={(e) => setFormData({ ...formData, concepto: e.target.value })}
                className="input-pos"
                rows={3}
                placeholder="Ej: Compra de papel higiénico, pago de agua, devolución a cliente Juan Pérez..."
                minLength={5}
                required
              />
              <p className="text-xs text-gray-500 mt-2">
                Mínimo 5 caracteres - Sé específico para la auditoría
              </p>
            </div>

            {/* Vista Previa */}
            {montoNumerico > 0 && formData.concepto.length >= 5 && (
              <div className="mb-6 p-4 bg-gray-50 border-2 border-gray-200 rounded-lg">
                <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                  <Eye className="w-5 h-5" />
                  Vista Previa:
                </p>
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-gray-600">Se registrará:</p>
                    <p className="font-bold text-gray-900">{formData.concepto}</p>
                  </div>
                  <p className="text-2xl font-bold text-red-600">
                    -${montoNumerico.toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            {/* Botones */}
            <div className="flex gap-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-pos btn-secondary"
                disabled={registrarGastoMutation.isLoading}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={registrarGastoMutation.isLoading || !formData.monto || formData.concepto.length < 5}
                className="flex-1 btn-pos btn-danger disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {registrarGastoMutation.isLoading ? (
                  'Registrando...'
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    Registrar Gasto
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
  const [montoFisico, setMontoFisico] = useState<number | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [mostrarDetalleMetodos, setMostrarDetalleMetodos] = useState(false);
  
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
    queryFn: async () => {
      const data = await vehiculosApi.obtenerPendientes();
      if (data && typeof data === 'object' && !Array.isArray(data) && 'vehiculos' in data) {
        return Array.isArray((data as any).vehiculos) ? (data as any).vehiculos : [];
      }
      return Array.isArray(data) ? data : [];
    },
    retry: 1,
  });

  const vehiculosPendientes = vehiculosPendientesData || [];

  // Filtrar solo egresos (montos negativos)
  const egresos = movimientos?.filter(mov => mov.monto < 0) || [];

  const cerrarMutation = useMutation({
    mutationFn: cajasApi.cerrar,
    onSuccess: async (cajaCerrada) => {
      // Descargar PDF generado por el backend
      try {
        const token = localStorage.getItem('access_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/cajas/${cajaCerrada.id}/comprobante-cierre`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `comprobante_cierre_caja_${new Date().toISOString().slice(0,10)}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          
          alert('Caja cerrada exitosamente. El comprobante se descargó correctamente.');
        }
      } catch (error) {
        console.error('Error al descargar comprobante:', error);
        alert('La caja se cerró, pero no fue posible descargar el comprobante automáticamente.');
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
      const confirmacion = window.confirm(
        `Hay ${vehiculosPendientes.length} vehículo(s) pendiente(s) de cobro.\n\n` +
        `Placas pendientes: ${vehiculosPendientes.slice(0, 5).map((v: Vehiculo) => v.placa).join(', ')}` +
        `${vehiculosPendientes.length > 5 ? '...' : ''}\n\n` +
        `¿Confirmas cerrar la caja sin cobrarlos?`
      );
      if (!confirmacion) {
        return;
      }
    }

    // Validar diferencias grandes (faltantes o sobrantes mayores a $20,000)
    const diferenciaAbsoluta = Math.abs(diferencia);
    if (diferenciaAbsoluta > 20000) {
      // Si no hay observaciones, exigirlas
      if (!observaciones || observaciones.trim().length < 10) {
        alert(
          `Se detectó una diferencia alta: $${diferencia.toLocaleString()}.\n\n` +
          `Debes agregar observaciones (mínimo 10 caracteres) explicando la diferencia.`
        );
        return;
      }
      
      // Confirmación adicional
      const confirmarDiferencia = window.confirm(
        `${diferencia < 0 ? 'Faltante' : 'Sobrante'} de $${diferenciaAbsoluta.toLocaleString()}.\n\n` +
        `Saldo esperado: $${resumen?.saldo_esperado.toLocaleString()}\n` +
        `Efectivo contado: $${montoFisico?.toLocaleString()}\n\n` +
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

  return (
    <div className="max-w-4xl mx-auto">
      <div className="card-pos">
        <h3 className="text-3xl font-bold text-gray-900 mb-6 flex items-center gap-2">
          <Lock className="w-8 h-8" />
          Cerrar Caja
        </h3>

        {cerrarMutation.isError && (
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800 font-semibold text-center flex items-center justify-center gap-2">
              <XCircle className="w-5 h-5" />
              {(cerrarMutation.error as Error & { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'No fue posible cerrar la caja.'}
            </p>
          </div>
        )}

        {/* Resumen de Movimientos */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl p-6 mb-6">
          <h4 className="text-xl font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="w-6 h-6" />
            Resumen del Turno
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm opacity-90">Monto Inicial</p>
              <p className="text-2xl font-bold">${formatCurrency(resumen.monto_inicial)}</p>
            </div>
            <div>
              <p className="text-sm opacity-90">Total Ingresos</p>
              <p className="text-2xl font-bold text-green-300">
                +${formatCurrency(resumen.total_ingresos)}
              </p>
            </div>
            <div>
              <p className="text-sm opacity-90">Total Egresos</p>
              <p className="text-2xl font-bold text-red-300">
                -${formatCurrency(resumen.total_egresos)}
              </p>
            </div>
            <div>
              <p className="text-sm opacity-90">Saldo Esperado</p>
              <p className="text-2xl font-bold">${formatCurrency(resumen.saldo_esperado)}</p>
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
                            <p className="text-xs text-gray-600">${v.total_cobrado.toLocaleString()}</p>
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
                            <p className="text-xs text-gray-600">${v.total_cobrado.toLocaleString()}</p>
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
                            <p className="text-xs text-gray-600">${v.total_cobrado.toLocaleString()}</p>
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
                            <p className="text-xs text-gray-600">${v.total_cobrado.toLocaleString()}</p>
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
                            <p className="text-xs text-gray-600">${v.total_cobrado.toLocaleString()}</p>
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
                            <p className="text-xs text-gray-600">${v.total_cobrado.toLocaleString()}</p>
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
                            <p className="text-xs text-gray-600">${v.total_cobrado.toLocaleString()}</p>
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

        {/* Detalle de Egresos (Gastos) */}
        {egresos.length > 0 && (
          <div className="mb-6">
            <h4 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <ArrowRight className="w-5 h-5" />
              Detalle de Egresos ({egresos.length} {egresos.length === 1 ? 'gasto' : 'gastos'})
            </h4>
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
              <div className="space-y-3">
                {egresos.map((egreso) => {
                  const TipoIcono = egreso.tipo === 'gasto' ? ArrowRight : egreso.tipo === 'devolucion' ? CornerUpLeft : Scale;
                  const hora = formatTime24(egreso.created_at);
                  
                  return (
                    <div key={egreso.id} className="flex justify-between items-center p-3 bg-white rounded-lg border border-red-200">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <TipoIcono className="w-5 h-5 text-gray-600" />
                          <span className="text-xs text-gray-500">{hora}</span>
                          <span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs font-semibold rounded capitalize">
                            {egreso.tipo}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900">{egreso.concepto}</p>
                      </div>
                      <p className="text-xl font-bold text-red-600 ml-4">
                        -${formatCurrency(Math.abs(egreso.monto))}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-3 border-t-2 border-red-300 flex justify-between items-center">
                <span className="font-bold text-gray-900">Total Egresos:</span>
                <span className="text-2xl font-bold text-red-600">
                  -${formatCurrency(resumen.total_egresos)}
                </span>
              </div>
            </div>
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
              (Monto inicial: ${formatCurrency(resumen.monto_inicial)} + Efectivo cobrado: ${formatCurrency(resumen.efectivo)}
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
                    ${((desglose[key as keyof typeof desglose] as number) * valor).toLocaleString()}
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
                    ${((desglose[key as keyof typeof desglose] as number) * valor).toLocaleString()}
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
                ${totalDesglose.toLocaleString()}
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
  const { data: cajas, isLoading } = useQuery({
    queryKey: ['historial-cajas'],
    queryFn: () => cajasApi.obtenerHistorial(),
    refetchInterval: 30000, // Refrescar cada 30 segundos
  });

  if (isLoading) {
    return <LoadingSpinner message="Cargando historial de caja..." />;
  }

  const cajasArray = cajas || [];

  if (cajasArray.length === 0) {
    return (
      <div className="card-pos text-center py-12">
        <div className="flex justify-center mb-4">
          <Folder className="w-20 h-20 text-gray-400" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">
          Sin historial
        </h3>
        <p className="text-gray-600">
          Aún no hay cajas cerradas en el sistema
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Folder className="w-7 h-7" />
          Historial de Cajas Cerradas
        </h3>
        <p className="text-sm text-gray-600 flex items-center gap-1">
          <BarChart3 className="w-4 h-4" />
          Mostrando las últimas {cajasArray.length} cajas
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
                        ${caja.monto_inicial.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Saldo Esperado</p>
                      <p className="font-semibold text-gray-900">
                        ${(caja as any).saldo_esperado?.toLocaleString() || '-'}
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
                      Sobrante: +${diferencia.toLocaleString()}
                    </div>
                  )}
                  {esCerrada && diferencia < 0 && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-semibold bg-red-100 text-red-800">
                      <TrendingDown className="w-4 h-4" />
                      Faltante: ${diferencia.toLocaleString()}
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
                            const token = localStorage.getItem('access_token');
                            const response = await fetch(`${import.meta.env.VITE_API_URL}/cajas/${caja.id}/comprobante-cierre`, {
                              headers: {
                                'Authorization': `Bearer ${token}`
                              }
                            });
                            
                            if (response.ok) {
                              const blob = await response.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `comprobante_cierre_${caja.turno}_${new Date(caja.fecha_cierre!).toISOString().slice(0,10)}.pdf`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              window.URL.revokeObjectURL(url);
                            } else {
                              alert('No fue posible cargar el comprobante.');
                            }
                          } catch (error) {
                            console.error('Error al descargar PDF:', error);
                            alert('No fue posible cargar el comprobante.');
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

// Componente de Vehículos Cobrados Hoy
function VehiculosCobradosHoy({ vehiculos, loading }: { vehiculos: Vehiculo[], loading: boolean }) {
  const [vehiculoSeleccionado, setVehiculoSeleccionado] = useState<Vehiculo | null>(null);

  if (loading) {
    return <LoadingSpinner message="Cargando vehículos cobrados del día..." />;
  }

  if (vehiculos.length === 0) {
    return (
      <div className="card-pos text-center py-12">
        <div className="flex justify-center mb-4">
          <CheckCircle2 className="w-20 h-20 text-gray-400" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">
          No hay cobros hoy
        </h3>
        <p className="text-gray-600">
          Aún no se han registrado cobros en esta caja
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <p className="text-sm text-gray-600">
          Vehículos cobrados hoy. Puedes cambiar el método de pago solo el mismo día del cobro.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {vehiculos.map((vehiculo) => (
          <div key={vehiculo.id} className="card-pos hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="text-2xl font-bold text-gray-900">{vehiculo.placa}</p>
                <p className="text-sm text-gray-600 capitalize">{vehiculo.tipo_vehiculo}</p>
              </div>
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                COBRADO
              </span>
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
                <span className="font-semibold">Total:</span> ${vehiculo.total_cobrado.toLocaleString()}
              </p>
            </div>

            <button
              onClick={() => setVehiculoSeleccionado(vehiculo)}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Cambiar Método de Pago
            </button>
          </div>
        ))}
      </div>

      {/* Modal de cambio de método */}
      {vehiculoSeleccionado && (
        <ErrorBoundary>
          <ModalCambiarMetodoPago
            vehiculo={vehiculoSeleccionado}
            onClose={() => setVehiculoSeleccionado(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

// Modal para cambiar método de pago
function ModalCambiarMetodoPago({ vehiculo, onClose }: { vehiculo: Vehiculo, onClose: () => void }) {
  const queryClient = useQueryClient();
  const [nuevoMetodo, setNuevoMetodo] = useState(vehiculo.metodo_pago || 'efectivo');
  const [motivo, setMotivo] = useState('');

  const cambiarMetodoMutation = useMutation({
    mutationFn: () => vehiculosApi.cambiarMetodoPago(vehiculo.id, nuevoMetodo, motivo),
    onSuccess: (data) => {
      alert(`${data.message}\n\nMétodo anterior: ${data.metodo_anterior}\nMétodo nuevo: ${data.metodo_nuevo}`);
      
      // Defer query invalidations
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['vehiculos-cobrados-hoy'] });
        queryClient.invalidateQueries({ queryKey: ['caja-resumen-tiempo-real'] });
      }, 300);
      
      onClose();
    },
    onError: (error: any) => {
      alert(error.response?.data?.detail || 'No fue posible cambiar el método de pago.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nuevoMetodo === vehiculo.metodo_pago) {
      alert('El método de pago seleccionado es el mismo que el actual.');
      return;
    }
    cambiarMetodoMutation.mutate();
  };

  const metodosPago = [
    { id: 'efectivo', nombre: 'Efectivo', Icono: Banknote },
    { id: 'tarjeta_debito', nombre: 'Tarjeta Débito', Icono: CreditCard },
    { id: 'tarjeta_credito', nombre: 'Tarjeta Crédito', Icono: CreditCard },
    { id: 'transferencia', nombre: 'Transferencia', Icono: Smartphone },
    { id: 'credismart', nombre: 'CrediSmart', Icono: Building2 },
    { id: 'sistecredito', nombre: 'SisteCredito', Icono: Landmark },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-1">
                Cambiar Método de Pago
              </h3>
              <p className="text-sm text-gray-600">
                Vehículo: <span className="font-bold text-gray-900">{vehiculo.placa}</span> - {vehiculo.cliente_nombre}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-3xl"
            >
              ×
            </button>
          </div>

          <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-yellow-800 font-semibold">
              📝 Método actual: <span className="uppercase">{vehiculo.metodo_pago?.replace('_', ' ')}</span>
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="space-y-6">
              {/* Nuevo Método de Pago */}
              <div>
                <label className="block text-lg font-bold text-gray-900 mb-3">
                  Nuevo Método de Pago <span className="text-red-600">*</span>
                </label>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {metodosPago.map((metodo) => (
                    <button
                      key={metodo.id}
                      type="button"
                      onClick={() => setNuevoMetodo(metodo.id)}
                      className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                        nuevoMetodo === metodo.id
                          ? 'border-blue-600 bg-blue-50 text-blue-900 scale-105'
                          : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      <div className="flex justify-center mb-2">
                        <metodo.Icono className="w-6 h-6" />
                      </div>
                      <div className="text-sm">{metodo.nombre}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Motivo */}
              <div>
                <label className="block text-lg font-bold text-gray-900 mb-3">
                  Motivo del Cambio <span className="text-red-600">*</span>
                </label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  className="input-pos"
                  rows={3}
                  placeholder="Ej: Cliente cambió de opinión, error al registrar, etc."
                  minLength={10}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Mínimo 10 caracteres
                </p>
              </div>
            </div>

            {/* Botones */}
            <div className="flex gap-4 mt-6">
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
                disabled={cambiarMetodoMutation.isLoading || motivo.length < 10}
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
      
      alert(`Venta de SOAT registrada exitosamente.\n\nRecibo generado: ${nombrePDF}`);
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const valorComercial = parseFloat(formData.valor_soat_comercial);
    
    if (isNaN(valorComercial) || valorComercial <= 0) {
      alert('El valor comercial del SOAT debe ser mayor a $0.');
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

  const metodosPago = [
    { id: 'efectivo', nombre: 'Efectivo', Icono: Banknote },
    { id: 'tarjeta_debito', nombre: 'Tarjeta Débito', Icono: CreditCard },
    { id: 'tarjeta_credito', nombre: 'Tarjeta Crédito', Icono: CreditCard },
    { id: 'transferencia', nombre: 'Transferencia', Icono: Smartphone },
    { id: 'credismart', nombre: 'CrediSmart', Icono: Building2 },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                <Shield className="w-8 h-8 text-teal-600" />
                Venta Solo SOAT
              </h3>
              <p className="text-sm text-gray-600 mt-1">Cliente compra SOAT sin revisión técnica</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-3xl"
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

          <form onSubmit={handleSubmit}>
            <div className="space-y-6">
              {/* Placa */}
              <div>
                <label className="block text-lg font-bold text-gray-900 mb-3">
                  Placa del Vehículo <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={formData.placa}
                  onChange={(e) => setFormData({ ...formData, placa: e.target.value.toUpperCase() })}
                  className="input-pos uppercase text-center text-2xl font-bold"
                  placeholder="ABC123"
                  maxLength={6}
                  required
                />
              </div>

              {/* Tipo de Vehículo */}
              <div>
                <label className="block text-lg font-bold text-gray-900 mb-3">
                  Tipo de Vehículo <span className="text-red-600">*</span>
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, tipo_vehiculo: 'moto' })}
                    className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                      formData.tipo_vehiculo === 'moto'
                        ? 'border-primary-600 bg-primary-50 text-primary-900 scale-105'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
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
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    🚗 Carro
                  </button>
                </div>
              </div>

              {/* Valor Comercial del SOAT */}
              <div>
                <label className="block text-lg font-bold text-gray-900 mb-3">
                  Valor Comercial del SOAT <span className="text-red-600">*</span>
                </label>
                <p className="text-sm text-gray-600 mb-2">
                  Valor que el cliente pagó por el SOAT (informativo, no ingresa a caja)
                </p>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-400">$</span>
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

              {/* Datos del Cliente */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-lg font-bold text-gray-900 mb-3">
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
                  <label className="block text-lg font-bold text-gray-900 mb-3">
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

              {/* Comisión a Cobrar */}
              <div className="bg-gradient-to-r from-secondary-600 to-secondary-700 text-white rounded-xl p-6">
                <p className="text-sm opacity-90 mb-1">COMISIÓN A COBRAR</p>
                <p className="text-4xl font-bold">${comisionSOAT.toLocaleString()}</p>
                <p className="text-sm mt-2 opacity-90">
                  {formData.tipo_vehiculo === 'moto' ? '🏍️ Moto' : '🚗 Carro'} - Este es el ÚNICO monto que ingresa a caja
                </p>
              </div>

              {/* Método de Pago */}
              <div>
                <label className="block text-lg font-bold text-gray-900 mb-3">
                  Método de Pago <span className="text-red-600">*</span>
                </label>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {metodosPago.map((metodo) => (
                    <button
                      key={metodo.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, metodo_pago: metodo.id })}
                      className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                        formData.metodo_pago === metodo.id
                          ? 'border-primary-600 bg-primary-50 text-primary-900 scale-105'
                          : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      <div className="flex justify-center mb-2">
                        <metodo.Icono className="w-6 h-6" />
                      </div>
                      <div className="text-sm">{metodo.nombre}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Botones */}
            <div className="flex gap-4 mt-6">
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

