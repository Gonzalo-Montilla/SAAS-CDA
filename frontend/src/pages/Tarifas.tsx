import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import { tarifasApi } from '../api/tarifas';
import type { Tarifa } from '../types';
import { 
  DollarSign,
  Shield,
  Plus,
  FileText,
  Calendar,
  Car,
  Landmark,
  Banknote,
  CheckCircle2,
  XCircle,
  Edit,
  Trash2,
  AlertTriangle,
  Save,
  Bike
} from 'lucide-react';

export default function TarifasPage() {
  const [vistaActual, setVistaActual] = useState<'tarifas' | 'comisiones'>('tarifas');
  const [anoSeleccionado, setAnoSeleccionado] = useState(new Date().getFullYear());
  const [mostrarModalCrear, setMostrarModalCrear] = useState(false);
  const [tarifaEditar, setTarifaEditar] = useState<Tarifa | null>(null);

  return (
    <Layout title="Gestión de Tarifas">
      {/* Navegación */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setVistaActual('tarifas')}
          className={`flex-1 py-4 rounded-lg font-semibold text-lg transition-all inline-flex items-center justify-center gap-2 ${
            vistaActual === 'tarifas'
              ? 'bg-primary-600 text-white shadow-lg'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          <DollarSign className="w-5 h-5" />
          Tarifas RTM
        </button>
        <button
          onClick={() => setVistaActual('comisiones')}
          className={`flex-1 py-4 rounded-lg font-semibold text-lg transition-all inline-flex items-center justify-center gap-2 ${
            vistaActual === 'comisiones'
              ? 'bg-primary-600 text-white shadow-lg'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Shield className="w-5 h-5" />
          Comisiones SOAT
        </button>
      </div>

      {/* Contenido */}
      {vistaActual === 'tarifas' ? (
        <TarifasRTM
          anoSeleccionado={anoSeleccionado}
          setAnoSeleccionado={setAnoSeleccionado}
          mostrarModalCrear={mostrarModalCrear}
          setMostrarModalCrear={setMostrarModalCrear}
          tarifaEditar={tarifaEditar}
          setTarifaEditar={setTarifaEditar}
        />
      ) : (
        <ComisionesSOAT />
      )}
    </Layout>
  );
}

// Componente de Tarifas RTM
function TarifasRTM({
  anoSeleccionado,
  setAnoSeleccionado,
  mostrarModalCrear,
  setMostrarModalCrear,
  tarifaEditar,
  setTarifaEditar,
}: {
  anoSeleccionado: number;
  setAnoSeleccionado: (ano: number) => void;
  mostrarModalCrear: boolean;
  setMostrarModalCrear: (show: boolean) => void;
  tarifaEditar: Tarifa | null;
  setTarifaEditar: (tarifa: Tarifa | null) => void;
}) {
  // Obtener todas las tarifas
  const { data: todasTarifas, isLoading } = useQuery({
    queryKey: ['tarifas-todas'],
    queryFn: tarifasApi.listar,
  });

  // Filtrar por año seleccionado
  const tarifasDelAno = todasTarifas?.filter(t => t.ano_vigencia === anoSeleccionado) || [];

  // Obtener años disponibles
  const anosDisponibles = Array.from(
    new Set(todasTarifas?.map(t => t.ano_vigencia) || [])
  ).sort((a, b) => b - a);

  if (isLoading) {
    return <LoadingSpinner message="Cargando tarifas RTM..." />;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DollarSign className="w-7 h-7" />
            Tarifas RTM
          </h2>
          
          {/* Selector de Año */}
          <select
            value={anoSeleccionado}
            onChange={(e) => setAnoSeleccionado(parseInt(e.target.value))}
            className="px-4 py-2 border-2 border-gray-300 rounded-lg font-semibold"
          >
            {anosDisponibles.map(ano => (
              <option key={ano} value={ano}>{ano}</option>
            ))}
            {/* Agregar años futuros (actual + 3 años) si no existen en la DB */}
            {[0, 1, 2, 3].map(offset => {
              const anoFuturo = new Date().getFullYear() + offset;
              if (!anosDisponibles.includes(anoFuturo)) {
                return <option key={anoFuturo} value={anoFuturo}>{anoFuturo}</option>;
              }
              return null;
            })}
          </select>
        </div>

        <button
          onClick={() => setMostrarModalCrear(true)}
          className="px-6 py-3 bg-secondary-500 text-white rounded-lg font-bold hover:bg-secondary-600 transition-colors inline-flex items-center gap-2 shadow-lg"
        >
          <Plus className="w-5 h-5" />
          Nueva Tarifa
        </button>
      </div>

      {/* Tabla de Tarifas */}
      {tarifasDelAno.length === 0 ? (
        <div className="card-pos text-center py-12">
          <div className="flex justify-center mb-4">
            <FileText className="w-16 h-16 text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            No hay tarifas para {anoSeleccionado}
          </h3>
          <p className="text-gray-600 mb-4">
            Crea la primera tarifa para este año
          </p>
          <button
            onClick={() => setMostrarModalCrear(true)}
            className="btn-pos btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Crear Tarifa
          </button>
        </div>
      ) : (
        <div className="card-pos overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-4 px-4 font-bold text-gray-900">Tipo</th>
                <th className="text-left py-4 px-4 font-bold text-gray-900">Antigüedad</th>
                <th className="text-right py-4 px-4 font-bold text-gray-900">RTM</th>
                <th className="text-right py-4 px-4 font-bold text-gray-900">Terceros</th>
                <th className="text-right py-4 px-4 font-bold text-gray-900">Total Cliente</th>
                <th className="text-center py-4 px-4 font-bold text-gray-900">Vigencia</th>
                <th className="text-center py-4 px-4 font-bold text-gray-900">Estado</th>
                <th className="text-center py-4 px-4 font-bold text-gray-900">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tarifasDelAno
                .sort((a, b) => {
                  // Ordenar por tipo de vehículo primero, luego por antigüedad
                  if (a.tipo_vehiculo !== b.tipo_vehiculo) {
                    return a.tipo_vehiculo.localeCompare(b.tipo_vehiculo);
                  }
                  return a.antiguedad_min - b.antiguedad_min;
                })
                .map((tarifa) => {
                  // Etiqueta legible para tipo de vehículo
                  const tipoLabel = {
                    moto: 'Moto',
                    liviano_particular: 'Liviano Particular',
                    liviano_publico: 'Liviano Público',
                    pesado_particular: 'Pesado Particular',
                    pesado_publico: 'Pesado Público'
                  }[tarifa.tipo_vehiculo] || tarifa.tipo_vehiculo;

                  return (
                  <tr key={tarifa.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-4 px-4">
                      <span className="text-xs font-semibold text-gray-600 px-2 py-1 bg-gray-100 rounded">
                        {tipoLabel}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="font-semibold">
                        {tarifa.antiguedad_min} - {tarifa.antiguedad_max || '∞'} años
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-primary-700">
                      ${tarifa.valor_rtm.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-gray-600">
                      ${tarifa.valor_terceros.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-right font-bold text-secondary-700 text-lg">
                      ${tarifa.valor_total.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-center text-sm text-gray-600">
                      {new Date(tarifa.vigencia_inicio).toLocaleDateString('es-CO')}
                      <br />
                      {new Date(tarifa.vigencia_fin).toLocaleDateString('es-CO')}
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1 ${
                          tarifa.activa
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {tarifa.activa ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Activa
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" />
                            Inactiva
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <button
                        onClick={() => setTarifaEditar(tarifa)}
                        className="px-3 py-1 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 inline-flex items-center gap-1"
                      >
                        <Edit className="w-4 h-4" />
                        Editar
                      </button>
                    </td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modales */}
      {mostrarModalCrear && (
        <ModalTarifa
          onClose={() => setMostrarModalCrear(false)}
          anoInicial={anoSeleccionado}
        />
      )}

      {tarifaEditar && (
        <ModalEditarTarifa
          tarifa={tarifaEditar}
          onClose={() => setTarifaEditar(null)}
        />
      )}
    </div>
  );
}

// Modal para crear tarifa
function ModalTarifa({ onClose, anoInicial }: { onClose: () => void; anoInicial: number }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState({
    ano_vigencia: anoInicial,
    vigencia_inicio: `${anoInicial}-01-01`,
    vigencia_fin: `${anoInicial}-12-31`,
    tipo_vehiculo: 'liviano_particular',
    antiguedad_min: 0,
    antiguedad_max: 5,
    valor_rtm: 70000,
    valor_terceros: 15000,
    valor_total: 85000,
  });

  const crearMutation = useMutation({
    mutationFn: tarifasApi.crear,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarifas-todas'] });
      onClose();
    },
  });

  const totalEsperado = formData.valor_rtm + formData.valor_terceros;
  const totalCoincide = formData.valor_total === totalEsperado;

  const parsePositiveInt = (value: string): number => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };

  const validateForm = (): string | null => {
    if (formData.antiguedad_max < formData.antiguedad_min) {
      return 'La antigüedad máxima no puede ser menor que la mínima.';
    }
    if (new Date(formData.vigencia_inicio) > new Date(formData.vigencia_fin)) {
      return 'La fecha de inicio de vigencia no puede ser mayor a la fecha fin.';
    }
    if (formData.valor_rtm <= 0 || formData.valor_terceros <= 0 || formData.valor_total <= 0) {
      return 'Los valores RTM, terceros y total deben ser mayores a cero.';
    }
    if (!totalCoincide) {
      return `El valor total debe ser exactamente ${totalEsperado.toLocaleString('es-CO')}.`;
    }
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    crearMutation.mutate(formData);
  };

  // Calcular total automáticamente
  const calcularTotal = () => {
    const total = formData.valor_rtm + formData.valor_terceros;
    setFormData({ ...formData, valor_total: total });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Plus className="w-7 h-7" />
                Nueva Tarifa RTM
              </h3>
              <p className="text-sm text-gray-600 mt-1">Configura la tarifa para un rango de antigüedad</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl">
              ×
            </button>
          </div>

          {crearMutation.isError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-800 font-semibold text-center flex items-center justify-center gap-2">
                <XCircle className="w-5 h-5" />
                {(crearMutation.error as any)?.response?.data?.detail || 'No fue posible crear la tarifa. Intenta nuevamente.'}
              </p>
            </div>
          )}
          {formError && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-amber-800 font-semibold text-center flex items-center justify-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                {formError}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Año de Vigencia */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Año de Vigencia
              </label>
              <input
                type="number"
                value={formData.ano_vigencia}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, ano_vigencia: parsePositiveInt(e.target.value) });
                  }}
                className="input-pos"
                required
                min={new Date().getFullYear()}
              />
            </div>

            {/* Tipo de Vehículo */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                <Car className="w-4 h-4" />
                Tipo de Vehículo
              </label>
              <select
                value={formData.tipo_vehiculo}
                onChange={(e) => setFormData({ ...formData, tipo_vehiculo: e.target.value })}
                className="input-pos"
                required
              >
                <option value="moto">Motocicleta</option>
                <option value="liviano_particular">Liviano Particular</option>
                <option value="liviano_publico">Liviano Público</option>
                <option value="pesado_particular">Pesado Particular</option>
                <option value="pesado_publico">Pesado Público</option>
              </select>
            </div>

            {/* Vigencias */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">
                  Inicio Vigencia
                </label>
                <input
                  type="date"
                  value={formData.vigencia_inicio}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, vigencia_inicio: e.target.value });
                  }}
                  className="input-pos"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">
                  Fin Vigencia
                </label>
                <input
                  type="date"
                  value={formData.vigencia_fin}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, vigencia_fin: e.target.value });
                  }}
                  className="input-pos"
                  required
                />
              </div>
            </div>

            {/* Antigüedad */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <Car className="w-4 h-4" />
                  Antigüedad Mínima (años)
                </label>
                <input
                  type="number"
                  value={formData.antiguedad_min}
                  onChange={(e) => {
                    setFormError('');
                    const nuevoMin = parsePositiveInt(e.target.value);
                    setFormData((prev) => ({
                      ...prev,
                      antiguedad_min: nuevoMin,
                      antiguedad_max: Math.max(prev.antiguedad_max, nuevoMin),
                    }));
                  }}
                  className="input-pos"
                  required
                  min={0}
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">
                  Antigüedad Máxima (años)
                </label>
                <input
                  type="number"
                  value={formData.antiguedad_max}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, antiguedad_max: parsePositiveInt(e.target.value) });
                  }}
                  className="input-pos"
                  required
                  min={formData.antiguedad_min}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Deja vacío o pon un número muy alto para "en adelante"
                </p>
              </div>
            </div>

            {/* Valores */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Valor RTM (CDA)
                </label>
                <input
                  type="number"
                  value={formData.valor_rtm}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, valor_rtm: parsePositiveInt(e.target.value) });
                  }}
                  onBlur={calcularTotal}
                  className="input-pos"
                  required
                  step="any"
                  min={0}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <Landmark className="w-4 h-4" />
                  Valor Terceros (Gobierno)
                </label>
                <input
                  type="number"
                  value={formData.valor_terceros}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, valor_terceros: parsePositiveInt(e.target.value) });
                  }}
                  onBlur={calcularTotal}
                  className="input-pos"
                  required
                  step="any"
                  min={0}
                />
              </div>

              <div className="pt-4 border-t-2 border-gray-300">
                <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <Banknote className="w-4 h-4" />
                  Valor Total (Cliente Paga)
                </label>
                <input
                  type="number"
                  value={formData.valor_total}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, valor_total: parsePositiveInt(e.target.value) });
                  }}
                  className="input-pos text-2xl font-bold"
                  required
                  step="any"
                  min={0}
                />
                {totalCoincide ? (
                  <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Total coherente. Este es el precio que verá el cliente.
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Total esperado: ${totalEsperado.toLocaleString('es-CO')}.
                  </p>
                )}
              </div>
            </div>

            {/* Botones */}
            <div className="flex gap-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-pos btn-secondary"
                disabled={crearMutation.isLoading}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={crearMutation.isLoading}
                className="flex-1 btn-pos btn-success disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {crearMutation.isLoading ? (
                  'Creando...'
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    Crear Tarifa
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

// Modal para editar tarifa
function ModalEditarTarifa({ tarifa, onClose }: { tarifa: Tarifa; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState({
    valor_rtm: tarifa.valor_rtm,
    valor_terceros: tarifa.valor_terceros,
    valor_total: tarifa.valor_total,
    activa: tarifa.activa,
  });

  const editarMutation = useMutation({
    mutationFn: (data: typeof formData) => tarifasApi.actualizar(tarifa.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarifas-todas'] });
      onClose();
    },
  });

  const totalEsperado = formData.valor_rtm + formData.valor_terceros;
  const totalCoincide = formData.valor_total === totalEsperado;

  const parsePositiveInt = (value: string): number => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };

  const validateForm = (): string | null => {
    if (formData.valor_rtm <= 0 || formData.valor_terceros <= 0 || formData.valor_total <= 0) {
      return 'Los valores RTM, terceros y total deben ser mayores a cero.';
    }
    if (!totalCoincide) {
      return `El valor total debe ser exactamente ${totalEsperado.toLocaleString('es-CO')}.`;
    }
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    editarMutation.mutate(formData);
  };

  const calcularTotal = () => {
    const total = formData.valor_rtm + formData.valor_terceros;
    setFormData({ ...formData, valor_total: total });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full">
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Edit className="w-7 h-7" />
                Editar Tarifa
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {tarifa.antiguedad_min} - {tarifa.antiguedad_max || '∞'} años ({tarifa.ano_vigencia})
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl">
              ×
            </button>
          </div>

          {editarMutation.isError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-800 font-semibold text-center flex items-center justify-center gap-2">
                <XCircle className="w-5 h-5" />
                {(editarMutation.error as any)?.response?.data?.detail || 'No fue posible actualizar la tarifa. Intenta nuevamente.'}
              </p>
            </div>
          )}
          {formError && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-amber-800 font-semibold text-center flex items-center justify-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                {formError}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Valor RTM
              </label>
              <input
                type="number"
                value={formData.valor_rtm}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, valor_rtm: parsePositiveInt(e.target.value) });
                  }}
                onBlur={calcularTotal}
                className="input-pos"
                step="any"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                <Landmark className="w-4 h-4" />
                Valor Terceros
              </label>
              <input
                type="number"
                value={formData.valor_terceros}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, valor_terceros: parsePositiveInt(e.target.value) });
                  }}
                onBlur={calcularTotal}
                className="input-pos"
                step="any"
                required
              />
            </div>

            <div className="pt-4 border-t-2 border-gray-300">
              <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                <Banknote className="w-4 h-4" />
                Valor Total
              </label>
              <input
                type="number"
                value={formData.valor_total}
                  onChange={(e) => {
                    setFormError('');
                    setFormData({ ...formData, valor_total: parsePositiveInt(e.target.value) });
                  }}
                className="input-pos text-xl font-bold"
                step="any"
                required
              />
                {totalCoincide ? (
                  <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Total coherente.
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Total esperado: ${totalEsperado.toLocaleString('es-CO')}.
                  </p>
                )}
            </div>

            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.activa}
                  onChange={(e) => setFormData({ ...formData, activa: e.target.checked })}
                  className="w-5 h-5"
                />
                <span className="font-semibold text-gray-900 flex items-center gap-2">
                  {formData.activa ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Tarifa Activa
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4" />
                      Tarifa Inactiva
                    </>
                  )}
                </span>
              </label>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-pos btn-secondary"
                disabled={editarMutation.isLoading}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={editarMutation.isLoading}
                className="flex-1 btn-pos btn-success disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {editarMutation.isLoading ? (
                  'Guardando...'
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Guardar
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

// Componente de Comisiones SOAT
function ComisionesSOAT() {
  const queryClient = useQueryClient();
  const [comisionEditar, setComisionEditar] = useState<any>(null);
  
  const { data: comisiones, isLoading } = useQuery({
    queryKey: ['comisiones-soat'],
    queryFn: tarifasApi.obtenerComisionesSOAT,
  });

  const eliminarMutation = useMutation({
    mutationFn: tarifasApi.eliminarComisionSOAT,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comisiones-soat'] });
    },
  });

  const handleEliminar = (comision: any) => {
    if (window.confirm(`¿Confirmas eliminar la comisión de ${comision.tipo_vehiculo}?\n\nValor: $${comision.valor_comision.toLocaleString()}`)) {
      eliminarMutation.mutate(comision.id);
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Cargando comisiones SOAT..." />;
  }

  return (
    <div>
       <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
              <Shield className="w-7 h-7" />
              Comisiones SOAT
            </h2>
            <p className="text-gray-600">
              Configura cuánto recibes por cada SOAT vendido según el tipo de vehículo
            </p>
          </div>
          <button
            onClick={() => setComisionEditar({ id: null })}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 transition-colors inline-flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Nueva Comisión
          </button>
        </div>

      {!comisiones || comisiones.length === 0 ? (
        <div className="card-pos text-center py-12">
          <div className="flex justify-center mb-4">
            <AlertTriangle className="w-16 h-16 text-yellow-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">No hay comisiones configuradas</h3>
          <p className="text-gray-600 mb-4">
            Configura una comisión para iniciar el registro de ventas SOAT.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {comisiones.map((comision) => {
            // Corregir el formato de fecha para que muestre el año correcto
            const fechaInicio = new Date(comision.vigencia_inicio + 'T00:00:00');
            const fechaFin = comision.vigencia_fin ? new Date(comision.vigencia_fin + 'T00:00:00') : null;
            const IconoVehiculo = comision.tipo_vehiculo === 'moto' ? Bike : Car;
            
            return (
              <div key={comision.id} className="card-pos">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <IconoVehiculo className="w-16 h-16 text-primary-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-2xl font-bold text-gray-900 capitalize mb-2">
                      {comision.tipo_vehiculo}
                    </h4>
                    <p className="text-sm text-gray-600 mb-3">
                      Vigencia: {fechaInicio.toLocaleDateString('es-CO')}
                      {fechaFin && ` - ${fechaFin.toLocaleDateString('es-CO')}`}
                    </p>
                    
                    <div className="mb-4">
                      <p className="text-xs text-gray-600 mb-1">Comisión por SOAT vendido</p>
                      <p className="text-3xl font-bold text-secondary-700">
                        ${comision.valor_comision.toLocaleString()}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setComisionEditar(comision)}
                        className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 transition-colors inline-flex items-center justify-center gap-2"
                      >
                        <Edit className="w-4 h-4" />
                        Editar
                      </button>
                      <button
                        onClick={() => handleEliminar(comision)}
                        disabled={eliminarMutation.isLoading}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 inline-flex items-center justify-center"
                        title="Eliminar"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                      <span
                        className={`px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 ${
                          comision.activa 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {comision.activa ? (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            Activa
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4" />
                            Inactiva
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal editar comisión */}
      {comisionEditar && (
        <ModalEditarComisionSOAT 
          comision={comisionEditar} 
          onClose={() => setComisionEditar(null)} 
        />
      )}
    </div>
  );
}

// Modal para crear/editar comisión SOAT
function ModalEditarComisionSOAT({ comision, onClose }: { comision: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const esNuevo = !comision.id;
  
  const [formData, setFormData] = useState({
    tipo_vehiculo: comision.tipo_vehiculo || 'moto',
    valor_comision: comision.valor_comision || 0,
    vigencia_inicio: comision.vigencia_inicio || new Date().toISOString().split('T')[0],
    vigencia_fin: comision.vigencia_fin || '',
    activa: comision.activa ?? true,
  });

  const mutation = useMutation({
    mutationFn: (data: any) => {
      if (esNuevo) {
        return tarifasApi.crearComisionSOAT(data);
      }
      return tarifasApi.actualizarComisionSOAT(comision.id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comisiones-soat'] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  const IconoVehiculo = formData.tipo_vehiculo === 'moto' ? Bike : Car;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <IconoVehiculo className="w-10 h-10 text-primary-600" />
              <div>
                <h3 className="text-2xl font-bold text-gray-900 capitalize">
                  {esNuevo ? 'Nueva' : 'Editar'} Comisión SOAT
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {esNuevo ? 'Configura una nueva comisión' : 'Ajusta el valor de la comisión'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl">
              ×
            </button>
          </div>

          {mutation.isError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-800 font-semibold text-center flex items-center justify-center gap-2">
                <XCircle className="w-5 h-5" />
                No fue posible {esNuevo ? 'crear' : 'actualizar'} la comisión. Intenta nuevamente.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Tipo de Vehículo - solo en crear */}
            {esNuevo && (
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">
                  Tipo de Vehículo
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, tipo_vehiculo: 'moto' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      formData.tipo_vehiculo === 'moto'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <Bike className="w-8 h-8 mx-auto mb-2" />
                    <p className="font-semibold">Moto</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, tipo_vehiculo: 'carro' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      formData.tipo_vehiculo === 'carro'
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <Car className="w-8 h-8 mx-auto mb-2" />
                    <p className="font-semibold">Carro</p>
                  </button>
                </div>
              </div>
            )}

            {/* Valor de la Comisión */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Valor de la Comisión
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-400">$</span>
                <input
                  type="number"
                  value={formData.valor_comision}
                  onChange={(e) => {
                    const valor = parseInt(e.target.value);
                    setFormData({ ...formData, valor_comision: isNaN(valor) ? 0 : valor });
                  }}
                  className="input-pos text-2xl text-center font-bold pl-12"
                  required
                  step="any"
                  min={0}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">
                Comisión que recibe el CDA por cada SOAT vendido
              </p>
            </div>

            {/* Vigencia - solo en crear */}
            {esNuevo && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">
                    Vigencia Inicio
                  </label>
                  <input
                    type="date"
                    value={formData.vigencia_inicio}
                    onChange={(e) => setFormData({ ...formData, vigencia_inicio: e.target.value })}
                    className="input-pos"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">
                    Vigencia Fin (opcional)
                  </label>
                  <input
                    type="date"
                    value={formData.vigencia_fin}
                    onChange={(e) => setFormData({ ...formData, vigencia_fin: e.target.value })}
                    className="input-pos"
                  />
                </div>
              </div>
            )}

            {/* Estado Activo/Inactivo */}
            <div>
              <label className="flex items-center gap-3 cursor-pointer p-4 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={formData.activa}
                  onChange={(e) => setFormData({ ...formData, activa: e.target.checked })}
                  className="w-5 h-5"
                />
                <div>
                  <span className="font-semibold text-gray-900 block flex items-center gap-2">
                    {formData.activa ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Comisión Activa
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4" />
                        Comisión Inactiva
                      </>
                    )}
                  </span>
                  <span className="text-sm text-gray-600">
                    {formData.activa ? 'Se aplicará en las ventas de SOAT' : 'No se aplicará automáticamente'}
                  </span>
                </div>
              </label>
            </div>

            {/* Botones */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={mutation.isLoading}
                className="flex-1 px-6 py-3 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {mutation.isLoading ? 'Guardando...' : esNuevo ? 'Crear Comisión' : 'Guardar Cambios'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

