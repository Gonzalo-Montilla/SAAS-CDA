import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, UserPlus, Search, Edit2, Key, Ban, Check, Trash2, User, Mail, Lock, UserCog, X, Save, CheckCircle2, XCircle, Building2 } from 'lucide-react';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { Usuario as TenantProfileUser } from '../types';

interface UsuarioListItem {
  id: string;
  email: string;
  nombre_completo: string;
  rol: string;
  activo: boolean;
  sucursal_id?: string | null;
  created_at: string;
  updated_at: string | null;
}

function defaultSedePref(u: TenantProfileUser | null): string {
  if (!u || !('sucursales' in u)) return '';
  const list = u.sucursales || [];
  if (list.length === 0) return '';
  const active = u.active_sucursal_id;
  if (active && list.some((s) => s.id === active)) return active;
  return list[0].id;
}

interface Estadisticas {
  total_usuarios: number;
  usuarios_activos: number;
  usuarios_inactivos: number;
  por_rol: Record<string, number>;
}

const ROLE_PERMISSION_MATRIX: Array<{
  rol: string;
  colorClass: string;
  cardClass: string;
  icon: string;
  permisos: string;
}> = [
  {
    rol: 'Administrador',
    colorClass: 'bg-red-100 text-red-800',
    cardClass: 'border-red-200 bg-gradient-to-br from-red-50 to-white',
    icon: '🛡️',
    permisos: 'Acceso total: recepción, caja, agendamiento, calidad, tarifas, tesorería, reportes y usuarios.',
  },
  {
    rol: 'Recepcionista',
    colorClass: 'bg-green-100 text-green-800',
    cardClass: 'border-green-200 bg-gradient-to-br from-green-50 to-white',
    icon: '📋',
    permisos: 'Recepción y agendamiento: registro de vehículos, check-in y gestión operativa de citas.',
  },
  {
    rol: 'Comercial',
    colorClass: 'bg-cyan-100 text-cyan-800',
    cardClass: 'border-cyan-200 bg-gradient-to-br from-cyan-50 to-white',
    icon: '📈',
    permisos: 'Agendamiento y calidad: gestión comercial de citas y seguimiento de experiencia del cliente.',
  },
  {
    rol: 'Cajero',
    colorClass: 'bg-blue-100 text-blue-800',
    cardClass: 'border-blue-200 bg-gradient-to-br from-blue-50 to-white',
    icon: '💳',
    permisos: 'Caja: cobros, apertura/cierre de caja y operaciones de punto de pago.',
  },
  {
    rol: 'Contador',
    colorClass: 'bg-purple-100 text-purple-800',
    cardClass: 'border-purple-200 bg-gradient-to-br from-purple-50 to-white',
    icon: '📊',
    permisos: 'Reportes: análisis financiero y seguimiento de información contable.',
  },
];

const validatePasswordPolicy = (password: string): string | null => {
  if (password.length < 10) return 'La contraseña debe tener mínimo 10 caracteres.';
  if (!/[A-Z]/.test(password)) return 'La contraseña debe incluir al menos una mayúscula.';
  if (!/[a-z]/.test(password)) return 'La contraseña debe incluir al menos una minúscula.';
  if (!/[0-9]/.test(password)) return 'La contraseña debe incluir al menos un número.';
  if (!/[!@#$%^&*()\-_=+\[\]{};:,.?/|]/.test(password)) return 'La contraseña debe incluir al menos un carácter especial.';
  return null;
};

export default function UsuariosPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { user: authProfile } = useAuth();
  const tenantAuth = authProfile && 'tenant_slug' in authProfile ? (authProfile as TenantProfileUser) : null;
  const sedesFormOptions = tenantAuth?.sucursales ?? [];

  const [buscarInput, setBuscarInput] = useState('');
  const [buscar, setBuscar] = useState('');
  const [filtroRol, setFiltroRol] = useState<string>('');
  const [filtroActivo, setFiltroActivo] = useState<string>('');
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<UsuarioListItem | null>(null);
  const [mostrarCambiarPassword, setMostrarCambiarPassword] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    nombre_completo: '',
    rol: 'cajero',
    sucursal_id: '',
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

  // Query: Listar usuarios (keepPreviousData evita desmontar la UI/modal al cambiar filtros o al revalidar)
  const {
    data: usuarios,
    isLoading,
    isError,
    error,
    isFetching,
  } = useQuery<UsuarioListItem[]>({
    queryKey: ['usuarios', buscar, filtroRol, filtroActivo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (buscar) params.append('buscar', buscar);
      if (filtroRol) params.append('rol', filtroRol);
      if (filtroActivo) params.append('activo', filtroActivo);

      // Barra final obligatoria: /usuarios?… provoca 307→/usuarios/ y el redirect puede perder Authorization (401 en bucle).
      const q = params.toString();
      const response = await apiClient.get(q ? `/usuarios/?${q}` : '/usuarios/');
      return response.data;
    },
    keepPreviousData: true,
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
      const payload: Record<string, string> = {
        email: data.email,
        password: data.password,
        nombre_completo: data.nombre_completo,
        rol: data.rol,
      };
      if (data.sucursal_id) payload.sucursal_id = data.sucursal_id;
      const response = await apiClient.post('/usuarios/', payload);
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
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { email: string; nombre_completo: string; rol: string; sucursal_id?: string };
    }) => {
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
      rol: 'cajero',
      sucursal_id: defaultSedePref(tenantAuth),
    });
  };

  const handleCrear = () => {
    setUsuarioEditando(null);
    resetForm();
    setMostrarFormulario(true);
  };

  const handleEditar = (usuario: UsuarioListItem) => {
    setUsuarioEditando(usuario);
    const sid =
      usuario.sucursal_id && sedesFormOptions.some((s) => s.id === usuario.sucursal_id)
        ? usuario.sucursal_id
        : defaultSedePref(tenantAuth);
    setFormData({
      email: usuario.email,
      password: '',
      nombre_completo: usuario.nombre_completo,
      rol: usuario.rol,
      sucursal_id: sid,
    });
    setMostrarFormulario(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (usuarioEditando) {
      const { password: _p, ...rest } = formData;
      void _p;
      actualizarMutation.mutate({
        id: usuarioEditando.id,
        data: {
          email: rest.email,
          nombre_completo: rest.nombre_completo,
          rol: rest.rol,
          ...(rest.sucursal_id ? { sucursal_id: rest.sucursal_id } : {}),
        },
      });
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

  const handleToggleEstado = (usuario: UsuarioListItem) => {
    if (confirm(`¿Confirmas ${usuario.activo ? 'desactivar' : 'activar'} al usuario ${usuario.nombre_completo}?`)) {
      toggleEstadoMutation.mutate(usuario.id);
    }
  };

  const handleEliminar = (usuario: UsuarioListItem) => {
    if (confirm(`¿Confirmas eliminar permanentemente a ${usuario.nombre_completo}?\nEsta acción no se puede deshacer.`)) {
      eliminarMutation.mutate(usuario.id);
    }
  };

  const getRolLabel = (rol: string) => {
    const labels: Record<string, string> = {
      'administrador': 'Administrador',
      'cajero': 'Cajero',
      'recepcionista': 'Recepcionista',
      'contador': 'Contador',
      'comercial': 'Comercial',
    };
    return labels[rol] || rol;
  };

  const getRolColor = (rol: string) => {
    const colors: Record<string, string> = {
      'administrador': 'bg-red-100 text-red-800',
      'cajero': 'bg-blue-100 text-blue-800',
      'recepcionista': 'bg-green-100 text-green-800',
      'contador': 'bg-purple-100 text-purple-800',
      'comercial': 'bg-cyan-100 text-cyan-800',
    };
    return colors[rol] || 'bg-slate-100 text-slate-800';
  };

  const labelSedeUsuario = (sucursalId?: string | null) => {
    if (!sucursalId) return '—';
    const s = sedesFormOptions.find((x) => x.id === sucursalId);
    return s?.nombre ?? `Sede (${sucursalId.slice(0, 8)}…)`;
  };

  // Solo pantalla completa de carga en la primera carga sin datos; refetch no quita el modal
  const showFullPageLoading = isLoading && usuarios === undefined;
  if (showFullPageLoading) {
    if (embedded) {
      return (
        <div className="flex justify-center py-16">
          <LoadingSpinner message="Cargando usuarios..." />
        </div>
      );
    }
    return (
      <Layout title="Usuarios">
        <LoadingSpinner message="Cargando usuarios..." />
      </Layout>
    );
  }

  const body = (
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

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            No se pudo cargar la lista de usuarios.{' '}
            {(error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
              (error as Error)?.message ||
              'Revisa la conexión o vuelve a intentar.'}
          </div>
        )}

        {/* Header */}
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h2 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
              <Users className="w-8 h-8 text-primary-600" />
              Gestión de Usuarios
            </h2>
            <p className="text-slate-600">
              Administra los usuarios del sistema CDA
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isFetching && usuarios !== undefined && (
              <span className="text-xs text-slate-500">Actualizando…</span>
            )}
            <button
              type="button"
              onClick={handleCrear}
              className="flex items-center gap-2 btn-primary-solid"
            >
              <UserPlus className="w-5 h-5" />
              Crear Usuario
            </button>
          </div>
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

        {/* Matriz visual de permisos */}
        <div className="card-pos border border-slate-200 shadow-sm">
          <div className="mb-5 rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <UserCog className="w-5 h-5 text-primary-600" />
                Matriz de permisos por rol
              </h3>
              <p className="text-xs text-slate-500">Guía rápida para creación de usuarios</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ROLE_PERMISSION_MATRIX.map((item) => (
              <div
                key={item.rol}
                className={`rounded-xl border p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${item.cardClass}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${item.colorClass}`}>
                    {item.rol}
                  </span>
                  <span className="text-lg leading-none" aria-hidden="true">
                    {item.icon}
                  </span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">{item.permisos}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Filtros */}
        <div className="card-pos">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
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
              <label className="block text-sm font-semibold text-slate-700 mb-2">
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
                <option value="comercial">Comercial</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
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
            <p className="text-sm text-slate-600">
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
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50"
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
                <tr className="text-left text-slate-600 border-b border-slate-200">
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Sede</th>
                  <th className="px-4 py-3">Rol</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Fecha Creación</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {usuarios && usuarios.length > 0 ? (
                  usuarios.map((usuario) => (
                    <tr key={usuario.id} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-semibold text-slate-900">{usuario.nombre_completo}</p>
                          <p className="text-sm text-slate-600">{usuario.email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 text-sm max-w-[10rem] truncate" title={labelSedeUsuario(usuario.sucursal_id)}>
                        {labelSedeUsuario(usuario.sucursal_id)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getRolColor(usuario.rol)}`}>
                          {getRolLabel(usuario.rol)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 ${
                          usuario.activo ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {usuario.activo ? <><CheckCircle2 className="w-3 h-3" /> Activo</> : <><XCircle className="w-3 h-3" /> Inactivo</>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {new Date(usuario.created_at).toLocaleDateString('es-CO')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditar(usuario)}
                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded transition text-sm font-semibold flex items-center gap-1"
                            title="Editar"
                          >
                            <Edit2 className="w-3 h-3" /> Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setMostrarCambiarPassword(usuario.id)}
                            className="px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded transition text-sm font-semibold"
                            title="Cambiar contraseña"
                          >
                            <Key className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
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
                            type="button"
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
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
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
          <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="modal-panel glass-card max-w-lg w-full border border-slate-200/70 animate-fade-in">
              {/* Header del Modal */}
              <div className={`modal-header-sticky -mx-6 px-6 pt-4 pb-4 border-b-2 ${
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
                    type="button"
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
              <div className="p-6 modal-body-scroll">
                <form id="form-usuario-crear-editar" onSubmit={handleSubmit} className="space-y-5">
                  {/* Nombre Completo */}
                  <div className="group">
                    <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                      <User className="w-4 h-4 text-blue-500" />
                      Nombre Completo *
                    </label>
                    <input
                      type="text"
                      value={formData.nombre_completo}
                      onChange={(e) => setFormData({ ...formData, nombre_completo: e.target.value })}
                      className="input-corporate w-full px-4 py-3"
                      placeholder="Ej: Juan Pérez García"
                      required
                    />
                  </div>

                  {/* Email */}
                  <div className="group">
                    <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                      <Mail className="w-4 h-4 text-purple-500" />
                      Email *
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="input-corporate w-full px-4 py-3"
                      placeholder="usuario@ejemplo.com"
                      required
                    />
                  </div>

                  {/* Contraseña (solo al crear) */}
                  {!usuarioEditando && (
                    <div className="group">
                      <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                        <Lock className="w-4 h-4 text-yellow-500" />
                        Contraseña *
                      </label>
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="input-corporate w-full px-4 py-3"
                        placeholder="Mínimo 10, con mayúscula, minúscula, número y símbolo"
                        required
                      />
                    </div>
                  )}

                  {/* Rol */}
                  <div className="group">
                    <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                      <UserCog className="w-4 h-4 text-green-500" />
                      Rol *
                    </label>
                    <select
                      value={formData.rol}
                      onChange={(e) => setFormData({ ...formData, rol: e.target.value })}
                      className="input-corporate w-full px-4 py-3 cursor-pointer"
                      required
                    >
                      <option value="cajero">Cajero</option>
                      <option value="recepcionista">Recepcionista</option>
                      <option value="contador">Contador</option>
                      <option value="comercial">Comercial</option>
                      <option value="administrador">Administrador</option>
                    </select>
                    <p className="text-xs text-slate-500 mt-2">
                      {formData.rol === 'administrador' && 'Acceso total al sistema'}
                      {formData.rol === 'cajero' && 'Acceso a caja y cobros'}
                      {formData.rol === 'recepcionista' && 'Acceso a recepción y registro'}
                      {formData.rol === 'contador' && 'Acceso a reportes y finanzas'}
                      {formData.rol === 'comercial' && 'Acceso a agendamiento y calidad'}
                    </p>
                  </div>

                  {/* Sede por defecto (BD + JWT de respaldo) */}
                  <div className="group">
                    <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-slate-500" />
                      Sede asignada
                    </label>
                    {sedesFormOptions.length > 0 ? (
                      <select
                        value={formData.sucursal_id}
                        onChange={(e) => setFormData({ ...formData, sucursal_id: e.target.value })}
                        className="input-corporate w-full px-4 py-3 cursor-pointer"
                      >
                        {sedesFormOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nombre}
                            {s.es_principal ? ' (principal)' : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-sm text-slate-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        Se usará la sede de tu usuario o la sede principal del centro.
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-2">
                      Queda guardada en el perfil del usuario; al operar, puede elegir otra sede si el centro tiene varias.
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

                  <div className="modal-footer-sticky -mx-6 px-0 pt-2 bg-slate-50 flex gap-3 rounded-b-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setMostrarFormulario(false);
                        setUsuarioEditando(null);
                        resetForm();
                      }}
                      className="flex-1 btn-corporate-muted px-6 flex items-center justify-center gap-2"
                    >
                      <X className="w-5 h-5" />
                      Cancelar
                    </button>
                    <button
                      type="submit"
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
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Cambiar Contraseña */}
        {mostrarCambiarPassword && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="modal-panel glass-card max-w-md w-full border border-slate-200/70">
              <div className="p-6">
                <div className="modal-header-sticky -mx-6 px-6 pt-1 pb-4 mb-4 border-b border-slate-200">
                  <h3 className="text-2xl font-bold flex items-center gap-2 text-slate-900">
                    <Key className="w-7 h-7 text-yellow-600" />
                    Cambiar Contraseña
                  </h3>
                </div>
                <form onSubmit={handleCambiarPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
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

                  <div className="modal-footer-sticky -mx-6 px-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setMostrarCambiarPassword(null);
                        setPasswordData({ password: '' });
                      }}
                      className="flex-1 btn-corporate-muted px-4"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex-1 btn-primary-solid px-4"
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
  );

  if (embedded) {
    return body;
  }

  return (
    <Layout title="Gestión de Usuarios">
      {body}
    </Layout>
  );
}
