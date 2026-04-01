import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, UserPlus, Search, Edit2, Key, Ban, Check, Trash2, User, Mail, Lock, UserCog, X, Save, CheckCircle2, XCircle } from 'lucide-react';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient from '../api/client';

interface Usuario {
  id: string;
  email: string;
  nombre_completo: string;
  rol: string;
  activo: boolean;
  created_at: string;
  updated_at: string | null;
}

interface Estadisticas {
  total_usuarios: number;
  usuarios_activos: number;
  usuarios_inactivos: number;
  por_rol: Record<string, number>;
}

const validatePasswordPolicy = (password: string): string | null => {
  if (password.length < 10) return 'La contraseña debe tener mínimo 10 caracteres.';
  if (!/[A-Z]/.test(password)) return 'La contraseña debe incluir al menos una mayúscula.';
  if (!/[a-z]/.test(password)) return 'La contraseña debe incluir al menos una minúscula.';
  if (!/[0-9]/.test(password)) return 'La contraseña debe incluir al menos un número.';
  if (!/[!@#$%^&*()\-_=+\[\]{};:,.?/|]/.test(password)) return 'La contraseña debe incluir al menos un carácter especial.';
  return null;
};

export default function UsuariosPage() {
  const queryClient = useQueryClient();
  const [buscarInput, setBuscarInput] = useState('');
  const [buscar, setBuscar] = useState('');
  const [filtroRol, setFiltroRol] = useState<string>('');
  const [filtroActivo, setFiltroActivo] = useState<string>('');
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<Usuario | null>(null);
  const [mostrarCambiarPassword, setMostrarCambiarPassword] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    nombre_completo: '',
    rol: 'cajero'
  });

  const [passwordData, setPasswordData] = useState({
    password: ''
  });

  useEffect(() => {
    const timeout = setTimeout(() => {
      setBuscar(buscarInput.trim());
    }, 300);
    return () => clearTimeout(timeout);
  }, [buscarInput]);

  // Query: Listar usuarios
  const { data: usuarios, isLoading } = useQuery<Usuario[]>({
    queryKey: ['usuarios', buscar, filtroRol, filtroActivo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (buscar) params.append('buscar', buscar);
      if (filtroRol) params.append('rol', filtroRol);
      if (filtroActivo) params.append('activo', filtroActivo);
      
      const response = await apiClient.get(`/usuarios?${params.toString()}`);
      return response.data;
    },
  });

  // Query: Estadísticas
  const { data: estadisticas } = useQuery<Estadisticas>({
    queryKey: ['usuarios-estadisticas'],
    queryFn: async () => {
      const response = await apiClient.get('/usuarios/estadisticas');
      return response.data;
    },
  });

  // Mutation: Crear usuario
  const crearMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiClient.post('/usuarios/', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      queryClient.invalidateQueries({ queryKey: ['usuarios-estadisticas'] });
      setMostrarFormulario(false);
      resetForm();
      setFeedback({ type: 'success', message: 'Usuario creado exitosamente.' });
    },
    onError: (error: any) => {
      setFeedback({
        type: 'error',
        message: error.response?.data?.detail || 'No fue posible crear el usuario. Intenta nuevamente.',
      });
    },
  });

  // Mutation: Actualizar usuario
  const actualizarMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const response = await apiClient.put(`/usuarios/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      setMostrarFormulario(false);
      setUsuarioEditando(null);
      resetForm();
      setFeedback({ type: 'success', message: 'Usuario actualizado exitosamente.' });
    },
    onError: (error: any) => {
      setFeedback({
        type: 'error',
        message: error.response?.data?.detail || 'No fue posible actualizar el usuario. Intenta nuevamente.',
      });
    },
  });

  // Mutation: Cambiar contraseña
  const cambiarPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => {
      const response = await apiClient.patch(`/usuarios/${id}/cambiar-password`, { password });
      return response.data;
    },
    onSuccess: () => {
      setMostrarCambiarPassword(null);
      setPasswordData({ password: '' });
      setFeedback({ type: 'success', message: 'Contraseña actualizada exitosamente.' });
    },
    onError: (error: any) => {
      setFeedback({
        type: 'error',
        message: error.response?.data?.detail || 'No fue posible cambiar la contraseña. Intenta nuevamente.',
      });
    },
  });

  // Mutation: Toggle estado
  const toggleEstadoMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.patch(`/usuarios/${id}/toggle-estado`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      queryClient.invalidateQueries({ queryKey: ['usuarios-estadisticas'] });
    },
    onError: (error: any) => {
      setFeedback({
        type: 'error',
        message: error.response?.data?.detail || 'No fue posible actualizar el estado del usuario.',
      });
    },
  });

  // Mutation: Eliminar usuario
  const eliminarMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.delete(`/usuarios/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      queryClient.invalidateQueries({ queryKey: ['usuarios-estadisticas'] });
      setFeedback({ type: 'success', message: 'Usuario eliminado exitosamente.' });
    },
    onError: (error: any) => {
      setFeedback({
        type: 'error',
        message: error.response?.data?.detail || 'No fue posible eliminar el usuario. Intenta nuevamente.',
      });
    },
  });

  const resetForm = () => {
    setFormData({
      email: '',
      password: '',
      nombre_completo: '',
      rol: 'cajero'
    });
  };

  const handleCrear = () => {
    setUsuarioEditando(null);
    resetForm();
    setMostrarFormulario(true);
  };

  const handleEditar = (usuario: Usuario) => {
    setUsuarioEditando(usuario);
    setFormData({
      email: usuario.email,
      password: '',
      nombre_completo: usuario.nombre_completo,
      rol: usuario.rol
    });
    setMostrarFormulario(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (usuarioEditando) {
      // Editar (sin password)
      const { password, ...dataToUpdate } = formData;
      actualizarMutation.mutate({ id: usuarioEditando.id, data: dataToUpdate });
    } else {
      // Crear (con password)
      if (!formData.password) {
        setFeedback({ type: 'error', message: 'La contraseña es obligatoria para crear el usuario.' });
        return;
      }
      const passwordError = validatePasswordPolicy(formData.password);
      if (passwordError) {
        setFeedback({ type: 'error', message: passwordError });
        return;
      }
      crearMutation.mutate(formData);
    }
  };

  const handleCambiarPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mostrarCambiarPassword) return;
    
    if (!passwordData.password) {
      setFeedback({ type: 'error', message: 'La nueva contraseña no puede estar vacía.' });
      return;
    }
    const passwordError = validatePasswordPolicy(passwordData.password);
    if (passwordError) {
      setFeedback({ type: 'error', message: passwordError });
      return;
    }
    
    cambiarPasswordMutation.mutate({ id: mostrarCambiarPassword, password: passwordData.password });
  };

  const handleToggleEstado = (usuario: Usuario) => {
    if (confirm(`¿Confirmas ${usuario.activo ? 'desactivar' : 'activar'} al usuario ${usuario.nombre_completo}?`)) {
      toggleEstadoMutation.mutate(usuario.id);
    }
  };

  const handleEliminar = (usuario: Usuario) => {
    if (confirm(`¿Confirmas eliminar permanentemente a ${usuario.nombre_completo}?\nEsta acción no se puede deshacer.`)) {
      eliminarMutation.mutate(usuario.id);
    }
  };

  const getRolLabel = (rol: string) => {
    const labels: Record<string, string> = {
      'administrador': 'Administrador',
      'cajero': 'Cajero',
      'recepcionista': 'Recepcionista',
      'contador': 'Contador'
    };
    return labels[rol] || rol;
  };

  const getRolColor = (rol: string) => {
    const colors: Record<string, string> = {
      'administrador': 'bg-red-100 text-red-800',
      'cajero': 'bg-blue-100 text-blue-800',
      'recepcionista': 'bg-green-100 text-green-800',
      'contador': 'bg-purple-100 text-purple-800'
    };
    return colors[rol] || 'bg-gray-100 text-gray-800';
  };

  if (isLoading) {
    return (
      <Layout title="Usuarios">
        <LoadingSpinner message="Cargando usuarios..." />
      </Layout>
    );
  }

  return (
    <Layout title="Gestión de Usuarios">
      <div className="space-y-6">
        {feedback && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3">
              <Users className="w-8 h-8 text-primary-600" />
              Gestión de Usuarios
            </h2>
            <p className="text-gray-600">
              Administra los usuarios del sistema CDA
            </p>
          </div>
          <button
            onClick={handleCrear}
            className="flex items-center gap-2 px-5 py-2.5 bg-secondary-500 hover:bg-secondary-600 text-white font-bold rounded-lg shadow-lg transition-all duration-200 hover:shadow-xl hover:scale-105"
          >
            <UserPlus className="w-5 h-5" />
            Crear Usuario
          </button>
        </div>

        {/* Estadísticas */}
        {estadisticas && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="card-pos bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-300">
              <p className="text-sm text-blue-700 mb-1">Total Usuarios</p>
              <p className="text-3xl font-bold text-blue-900">{estadisticas.total_usuarios}</p>
            </div>
            <div className="card-pos bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-300">
              <p className="text-sm text-green-700 mb-1">Activos</p>
              <p className="text-3xl font-bold text-green-900">{estadisticas.usuarios_activos}</p>
            </div>
            <div className="card-pos bg-gradient-to-br from-red-50 to-red-100 border-2 border-red-300">
              <p className="text-sm text-red-700 mb-1">Inactivos</p>
              <p className="text-3xl font-bold text-red-900">{estadisticas.usuarios_inactivos}</p>
            </div>
            <div className="card-pos bg-gradient-to-br from-purple-50 to-purple-100 border-2 border-purple-300">
              <p className="text-sm text-purple-700 mb-1">Administradores</p>
              <p className="text-3xl font-bold text-purple-900">{estadisticas.por_rol.administrador || 0}</p>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="card-pos">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <Search className="w-4 h-4 text-primary-600" />
                Buscar
              </label>
              <input
                type="text"
                value={buscarInput}
                onChange={(e) => setBuscarInput(e.target.value)}
                placeholder="Nombre o email..."
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Filtrar por Rol
              </label>
              <select
                value={filtroRol}
                onChange={(e) => setFiltroRol(e.target.value)}
                className="input"
              >
                <option value="">Todos</option>
                <option value="administrador">Administrador</option>
                <option value="cajero">Cajero</option>
                <option value="recepcionista">Recepcionista</option>
                <option value="contador">Contador</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Filtrar por Estado
              </label>
              <select
                value={filtroActivo}
                onChange={(e) => setFiltroActivo(e.target.value)}
                className="input"
              >
                <option value="">Todos</option>
                <option value="true">Activos</option>
                <option value="false">Inactivos</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              Mostrando {usuarios?.length || 0} usuario(s) con los filtros actuales.
            </p>
            <button
              type="button"
              onClick={() => {
                setBuscarInput('');
                setBuscar('');
                setFiltroRol('');
                setFiltroActivo('');
              }}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50"
            >
              Limpiar filtros
            </button>
          </div>
        </div>

        {/* Tabla de Usuarios */}
        <div className="card-pos">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-gray-600 border-b-2">
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Rol</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Fecha Creación</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {usuarios && usuarios.length > 0 ? (
                  usuarios.map((usuario) => (
                    <tr key={usuario.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-semibold text-gray-900">{usuario.nombre_completo}</p>
                          <p className="text-sm text-gray-600">{usuario.email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getRolColor(usuario.rol)}`}>
                          {getRolLabel(usuario.rol)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 ${
                          usuario.activo ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {usuario.activo ? <><CheckCircle2 className="w-3 h-3" /> Activo</> : <><XCircle className="w-3 h-3" /> Inactivo</>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {new Date(usuario.created_at).toLocaleDateString('es-CO')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEditar(usuario)}
                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded transition text-sm font-semibold flex items-center gap-1"
                            title="Editar"
                          >
                            <Edit2 className="w-3 h-3" /> Editar
                          </button>
                          <button
                            onClick={() => setMostrarCambiarPassword(usuario.id)}
                            className="px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded transition text-sm font-semibold"
                            title="Cambiar contraseña"
                          >
                            <Key className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleEstado(usuario)}
                            className={`px-2 py-1 rounded transition text-sm font-semibold ${
                              usuario.activo
                                ? 'bg-orange-100 hover:bg-orange-200 text-orange-800'
                                : 'bg-green-100 hover:bg-green-200 text-green-800'
                            }`}
                            title={usuario.activo ? 'Desactivar' : 'Activar'}
                          >
                            {usuario.activo ? <Ban className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleEliminar(usuario)}
                            className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded transition text-sm font-semibold"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      No se encontraron usuarios
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal: Crear/Editar Usuario */}
        {mostrarFormulario && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden border-2 border-gray-100 animate-fade-in">
              {/* Header del Modal */}
              <div className={`p-6 border-b-2 ${
                usuarioEditando 
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600' 
                  : 'bg-gradient-to-r from-green-500 to-green-600'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-white rounded-full p-2">
                      {usuarioEditando ? <Edit2 className="w-6 h-6 text-blue-600" /> : <UserPlus className="w-6 h-6 text-green-600" />}
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-white">
                        {usuarioEditando ? 'Editar Usuario' : 'Crear Nuevo Usuario'}
                      </h3>
                      <p className="text-sm text-white/80">
                        {usuarioEditando ? 'Actualiza la información del usuario' : 'Completa el formulario para crear un usuario'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setMostrarFormulario(false);
                      setUsuarioEditando(null);
                      resetForm();
                    }}
                    className="text-white hover:bg-white/20 rounded-lg p-2 transition"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Contenido del Modal */}
              <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 180px)' }}>
                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Nombre Completo */}
                  <div className="group">
                    <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                      <User className="w-4 h-4 text-blue-500" />
                      Nombre Completo *
                    </label>
                    <input
                      type="text"
                      value={formData.nombre_completo}
                      onChange={(e) => setFormData({ ...formData, nombre_completo: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder-gray-400"
                      placeholder="Ej: Juan Pérez García"
                      required
                    />
                  </div>

                  {/* Email */}
                  <div className="group">
                    <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                      <Mail className="w-4 h-4 text-purple-500" />
                      Email *
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all placeholder-gray-400"
                      placeholder="usuario@ejemplo.com"
                      required
                    />
                  </div>

                  {/* Contraseña (solo al crear) */}
                  {!usuarioEditando && (
                    <div className="group">
                      <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                        <Lock className="w-4 h-4 text-yellow-500" />
                        Contraseña *
                      </label>
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 transition-all placeholder-gray-400"
                        placeholder="Mínimo 10, con mayúscula, minúscula, número y símbolo"
                        required
                      />
                    </div>
                  )}

                  {/* Rol */}
                  <div className="group">
                    <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                      <UserCog className="w-4 h-4 text-green-500" />
                      Rol *
                    </label>
                    <select
                      value={formData.rol}
                      onChange={(e) => setFormData({ ...formData, rol: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all bg-white cursor-pointer"
                      required
                    >
                      <option value="cajero">Cajero</option>
                      <option value="recepcionista">Recepcionista</option>
                      <option value="contador">Contador</option>
                      <option value="administrador">Administrador</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-2">
                      {formData.rol === 'administrador' && 'Acceso total al sistema'}
                      {formData.rol === 'cajero' && 'Acceso a caja y cobros'}
                      {formData.rol === 'recepcionista' && 'Acceso a recepción y registro'}
                      {formData.rol === 'contador' && 'Acceso a reportes y finanzas'}
                    </p>
                  </div>

                  {/* Alerta de edición */}
                  {usuarioEditando && (
                    <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-xl p-4 flex items-start gap-3">
                      <Key className="w-6 h-6 text-yellow-600 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-yellow-900 mb-1">
                          Cambio de Contraseña
                        </p>
                        <p className="text-sm text-yellow-800">
                          Para cambiar la contraseña, usa el botón de llave en la tabla de usuarios
                        </p>
                      </div>
                    </div>
                  )}
                </form>
              </div>

              {/* Footer con botones */}
              <div className="p-6 bg-gray-50 border-t-2 border-gray-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMostrarFormulario(false);
                    setUsuarioEditando(null);
                    resetForm();
                  }}
                  className="flex-1 px-6 py-3 bg-white border-2 border-gray-300 hover:bg-gray-100 text-gray-700 rounded-xl font-bold transition-all hover:scale-105 flex items-center justify-center gap-2"
                >
                  <X className="w-5 h-5" />
                  Cancelar
                </button>
                <button
                  type="submit"
                  onClick={handleSubmit}
                  className={`flex-1 px-6 py-3 text-white rounded-xl font-bold transition-all hover:scale-105 shadow-lg flex items-center justify-center gap-2 ${
                    usuarioEditando
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
                      : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
                  }`}
                >
                  <Save className="w-5 h-5" />
                  {usuarioEditando ? 'Actualizar Usuario' : 'Crear Usuario'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Cambiar Contraseña */}
        {mostrarCambiarPassword && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-2xl max-w-md w-full">
              <div className="p-6">
                <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
                  <Key className="w-7 h-7 text-yellow-600" />
                  Cambiar Contraseña
                </h3>
                <form onSubmit={handleCambiarPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Nueva Contraseña *
                    </label>
                    <input
                      type="password"
                      value={passwordData.password}
                      onChange={(e) => setPasswordData({ password: e.target.value })}
                      className="input"
                      required
                      placeholder="Mínimo 10, con mayúscula, minúscula, número y símbolo"
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setMostrarCambiarPassword(null);
                        setPasswordData({ password: '' });
                      }}
                      className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-semibold"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold"
                    >
                      Cambiar Contraseña
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
