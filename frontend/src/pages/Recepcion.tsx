import { useState, useEffect, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, DollarSign, CheckCircle2, RotateCcw, Search, X, Calendar, CalendarDays, CalendarRange, BarChart3, Camera, Car, Edit } from 'lucide-react';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import CapturaFotos from '../components/CapturaFotos';
import ErrorBoundary from '../components/ErrorBoundary';
import { useToast } from '../contexts/ToastContext';
import { vehiculosApi, type TarifaCalculada } from '../api/vehiculos';
import { tarifasApi } from '../api/tarifas';
import type { VehiculoRegistro } from '../types';

export default function Recepcion() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [tarifaCalculada, setTarifaCalculada] = useState<TarifaCalculada | null>(null);
  const [fotosVehiculo, setFotosVehiculo] = useState<string[]>([]);

  // Estado para edición
  const [modoEdicion, setModoEdicion] = useState(false);
  const [vehiculoEditando, setVehiculoEditando] = useState<string | null>(null);

  // Estado del formulario
  const [formData, setFormData] = useState<VehiculoRegistro>({
    placa: '',
    tipo_vehiculo: 'liviano_particular',
    marca: '',
    modelo: '',
    ano_modelo: new Date().getFullYear(), // Año actual por defecto
    cliente_nombre: '',
    cliente_documento: '',
    cliente_telefono: '',
    tiene_soat: false,
    observaciones: '',
  });

  // Obtener comisiones SOAT
  const { data: comisionesSOAT } = useQuery({
    queryKey: ['comisiones-soat'],
    queryFn: tarifasApi.obtenerComisionesSOAT,
  });

  // Estado para filtros y paginación
  const [buscar, setBuscar] = useState('');
  const [filtroFecha, setFiltroFecha] = useState<'hoy' | 'semana' | 'mes' | 'personalizado'>('hoy');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
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

  // Calcular tarifa cuando cambia el año del modelo o el tipo de vehículo
  useEffect(() => {
    // Si es preventiva, no calcular tarifa
    if (formData.tipo_vehiculo === 'preventiva') {
      setTarifaCalculada(null);
      return;
    }
    
    if (formData.ano_modelo >= 1950 && formData.ano_modelo <= 2030 && formData.tipo_vehiculo) {
      vehiculosApi.calcularTarifa(formData.ano_modelo, formData.tipo_vehiculo)
        .then(setTarifaCalculada)
        .catch(() => {
          console.warn('No hay tarifas configuradas para el año', formData.ano_modelo, 'y tipo', formData.tipo_vehiculo);
          setTarifaCalculada(null);
        });
    }
  }, [formData.ano_modelo, formData.tipo_vehiculo]);

  const resetForm = () => {
    // Limpiar fotos
    setFotosVehiculo([]);
    
    // Limpiar formulario PERO mantener el año para que la tarifa siga visible
    const anoActual = new Date().getFullYear();
    setFormData({
      placa: '',
      tipo_vehiculo: 'liviano_particular',
      marca: '',
      modelo: '',
      ano_modelo: anoActual, // Mantener año actual para que la tarifa persista
      cliente_nombre: '',
      cliente_documento: '',
      cliente_telefono: '',
      tiene_soat: false,
      observaciones: '',
    });
    
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
    setFormData({
      placa: vehiculo.placa,
      tipo_vehiculo: vehiculo.tipo_vehiculo,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      ano_modelo: vehiculo.ano_modelo,
      cliente_nombre: vehiculo.cliente_nombre,
      cliente_documento: vehiculo.cliente_documento,
      cliente_telefono: vehiculo.cliente_telefono || '',
      tiene_soat: vehiculo.tiene_soat,
      observaciones: textoObservaciones,
    });
    
    // Scroll al formulario
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelarEdicion = () => {
    setModoEdicion(false);
    setVehiculoEditando(null);
    setFotosVehiculo([]);
    resetForm();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    
    // Preparar datos incluyendo fotos en observaciones
    const dataConFotos = {
      ...formData,
      observaciones: JSON.stringify({
        texto: formData.observaciones || '',
        fotos: fotosVehiculo
      })
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
              <h3 className="text-xl font-bold text-gray-900">
                {modoEdicion ? 'Editando Vehículo' : 'Datos del Vehículo y Cliente'}
              </h3>
              {modoEdicion && (
                <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-semibold">
                  MODO EDICIÓN
                </span>
              )}
            </div>

            {/* Los mensajes de éxito y error ahora se manejan con el componente Toast */}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Placa */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Placa <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={formData.placa}
                  onChange={(e) => handleInputChange('placa', e.target.value.toUpperCase())}
                  required
                  className="input-pos uppercase"
                  placeholder="ABC123"
                  maxLength={10}
                />
              </div>

              {/* Tipo de Vehículo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Año del Modelo <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  value={formData.ano_modelo}
                  onChange={(e) => handleInputChange('ano_modelo', parseInt(e.target.value))}
                  required
                  className="input-pos"
                  min={1950}
                  max={2030}
                />
              </div>

              {/* SOAT */}
              <div className="flex items-center pt-8">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.tiene_soat}
                    onChange={(e) => handleInputChange('tiene_soat', e.target.checked)}
                    className="w-6 h-6 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="ml-3 text-lg font-medium text-gray-900">
                    ¿Compra SOAT?
                  </span>
                </label>
              </div>
            </div>

            <hr className="my-6" />

            <h4 className="text-lg font-bold text-gray-900 mb-4">Datos del Cliente</h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nombre del Cliente */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Documento <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={formData.cliente_documento}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, ''); // Solo números
                    if (value.length <= 10) { // Máximo 10 dígitos
                      handleInputChange('cliente_documento', value);
                    }
                  }}
                  maxLength={10}
                  pattern="[0-9]{1,10}"
                  required
                  className="input-pos"
                  placeholder="1234567890 (máx. 10 dígitos)"
                />
              </div>

              {/* Teléfono */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teléfono
                </label>
                <input
                  type="tel"
                  value={formData.cliente_telefono}
                  onChange={(e) => handleInputChange('cliente_telefono', e.target.value)}
                  className="input-pos"
                  placeholder="3001234567"
                />
              </div>
            </div>

            {/* Observaciones */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
              maxFotos={4}
            />

            {/* Botones */}
            <div className="flex gap-4 mt-6">
              <button
                type="submit"
                disabled={registrarMutation.isLoading || editarMutation.isLoading}
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
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
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
                      ${Number(comisionSOAT.valor_comision).toLocaleString()}
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
                  <div className="mt-4 p-3 rounded-lg bg-gray-50 border-2 border-gray-200">
                    <p className="text-xs font-medium mb-1 flex items-center gap-1">
                      <Camera className="w-4 h-4" />
                      <span>Sin Fotos</span>
                    </p>
                    <p className="text-sm font-bold text-gray-500">
                      <span>0 fotos</span>
                    </p>
                  </div>
                )}
              </div>
            ) : tarifaCalculada ? (
              <div>
                <div className="space-y-3 mb-6">
                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs text-gray-600">Año del Vehículo</p>
                    <p className="text-lg font-bold text-gray-900">{formData.ano_modelo}</p>
                    <p className="text-xs text-gray-500">{tarifaCalculada.descripcion_antiguedad}</p>
                  </div>

                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs text-gray-600">RTM</p>
                    <p className="text-lg font-bold text-gray-900">
                      ${Number(tarifaCalculada.valor_rtm).toLocaleString()}
                    </p>
                  </div>

                  <div className="bg-white rounded-lg p-3">
                    <p className="text-xs text-gray-600">Terceros</p>
                    <p className="text-lg font-bold text-gray-900">
                      ${Number(tarifaCalculada.valor_terceros).toLocaleString()}
                    </p>
                  </div>

                  {formData.tiene_soat && comisionSOAT && (
                    <div className="bg-green-50 border-2 border-green-200 rounded-lg p-3">
                      <p className="text-xs text-green-700">Comisión SOAT</p>
                      <p className="text-lg font-bold text-green-900">
                        ${Number(comisionSOAT.valor_comision).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>

                <div className="bg-primary-600 text-white rounded-lg p-4">
                  <p className="text-sm mb-1">TOTAL A COBRAR</p>
                  <p className="text-3xl font-bold">
                    ${calcularTotalConSOAT().toLocaleString()}
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
                  <div className="mt-4 p-3 rounded-lg bg-gray-50 border-2 border-gray-200">
                    <p className="text-xs font-medium mb-1 flex items-center gap-1">
                      <Camera className="w-4 h-4" />
                      <span>Sin Fotos</span>
                    </p>
                    <p className="text-sm font-bold text-gray-500">
                      <span>0 fotos</span>
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500">
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
            <h3 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
              <Car className="w-7 h-7 text-primary-600" />
              Vehículos Registrados
            </h3>
            <p className="text-sm text-gray-600">
              {totalVehiculos} {totalVehiculos === 1 ? 'vehículo encontrado' : 'vehículos encontrados'}
            </p>
          </div>
        </div>

        {/* Barra de Búsqueda y Filtros */}
        <div className="section-card p-5 mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Barra de búsqueda */}
            <div className="lg:col-span-5">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={buscar}
                  onChange={(e) => {
                    setBuscar(e.target.value);
                    setPaginaActual(1); // Reset a primera página al buscar
                  }}
                  placeholder="Buscar por placa, cédula o nombre..."
                  className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
                />
                {buscar && (
                  <button
                    onClick={() => {
                      setBuscar('');
                      setPaginaActual(1);
                    }}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    <X className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>
            </div>

            {/* Filtros rápidos de fecha */}
            <div className="lg:col-span-7 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setFiltroFecha('hoy');
                  setPaginaActual(1);
                }}
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  filtroFecha === 'hoy'
                  ? 'bg-primary-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  filtroFecha === 'semana'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  filtroFecha === 'mes'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <CalendarRange className="w-4 h-4 inline mr-2" />
                Últimos 30 días
              </button>
              <button
                onClick={() => setFiltroFecha('personalizado')}
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  filtroFecha === 'personalizado'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <BarChart3 className="w-4 h-4 inline mr-2" />
                Personalizado
              </button>
            </div>
          </div>

          {/* Filtro de fecha personalizado */}
          {filtroFecha === 'personalizado' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t-2 border-gray-200">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                        <div className="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                          <Camera className="w-3 h-3" /> {fotos.length}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="relative mb-3 -mx-4 -mt-4 bg-gray-100 h-32 flex items-center justify-center rounded-t-lg">
                      <div className="text-center">
                        <Car className="w-12 h-12 text-gray-400 mb-1" />
                        <p className="text-xs text-gray-500">Sin foto</p>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{vehiculo.placa}</p>
                      <p className="text-sm text-gray-600 capitalize">{vehiculo.tipo_vehiculo}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      vehiculo.estado === 'registrado' ? 'bg-yellow-100 text-yellow-800' :
                      vehiculo.estado === 'pagado' ? 'bg-green-100 text-green-800' :
                      vehiculo.estado === 'en_pista' ? 'bg-blue-100 text-blue-800' :
                      vehiculo.estado === 'aprobado' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {vehiculo.estado.toUpperCase()}
                    </span>
                  </div>

                  <div className="space-y-1 text-sm">
                    <p className="text-gray-700">
                      <span className="font-semibold">Cliente:</span> {vehiculo.cliente_nombre}
                    </p>
                    <p className="text-gray-700">
                      <span className="font-semibold">Doc:</span> {vehiculo.cliente_documento}
                    </p>
                    <p className="text-gray-700">
                      <span className="font-semibold">Modelo:</span> {vehiculo.ano_modelo}
                    </p>
                    <p className="text-lg font-bold text-primary-600 mt-2">
                      ${vehiculo.total_cobrado.toLocaleString()}
                    </p>
                  </div>

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
                  <div className="text-sm text-gray-600">
                    Página <span className="font-bold text-gray-900">{paginaActual}</span> de{' '}
                    <span className="font-bold text-gray-900">{totalPaginas}</span>
                    <span className="mx-2">•</span>
                    Mostrando{' '}
                    <span className="font-bold text-gray-900">
                      {skip + 1}-{Math.min(skip + registrosPorPagina, totalVehiculos)}
                    </span>{' '}
                    de <span className="font-bold text-gray-900">{totalVehiculos}</span> registros
                  </div>

                  {/* Botones de paginación */}
                  <div className="flex items-center gap-2">
                    {/* Botón Primera página */}
                    <button
                      onClick={() => setPaginaActual(1)}
                      disabled={paginaActual === 1}
                      className="px-3 py-2 rounded-lg border-2 border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
                      className="px-4 py-2 rounded-lg border-2 border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition"
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
                                : 'border-2 border-gray-300 hover:bg-gray-100'
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
                      className="px-4 py-2 rounded-lg border-2 border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition"
                    >
                      Siguiente →
                    </button>

                    {/* Botón Última página */}
                    <button
                      onClick={() => setPaginaActual(totalPaginas)}
                      disabled={paginaActual === totalPaginas}
                      className="px-3 py-2 rounded-lg border-2 border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
            <Search className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-xl font-semibold text-gray-900 mb-2">No se encontraron vehículos</p>
            <p className="text-gray-500">
              {buscar
                ? 'Intenta con otros términos de búsqueda'
                : 'No hay vehículos registrados en el período seleccionado'}
            </p>
          </div>
        )}
        </ErrorBoundary>
      </div>
    </Layout>
  );
}

