import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, ShieldCheck, LogOut, Users, HandCoins, Headset } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';

interface SaaSPermissionsResponse {
  role: 'owner' | 'finanzas' | 'comercial' | 'soporte';
  permissions: string[];
}

export default function SaaSBackoffice() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const permissionsQuery = useQuery({
    queryKey: ['saas-permissions-me'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSPermissionsResponse>('/saas/auth/permissions/me');
      return response.data;
    },
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">CDASOFT SaaS Backoffice</p>
              <p className="text-xs text-slate-500">Gestión global de plataforma</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Salir
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <p className="text-sm text-slate-500 mb-1">Sesión global activa</p>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Bienvenido, {user?.nombre_completo}
          </h1>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Rol global: <span className="font-semibold capitalize">{permissionsQuery.data?.role || '-'}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <Users className="w-6 h-6 text-blue-600 mb-2" />
            <p className="text-sm text-slate-500">Módulo</p>
            <p className="font-semibold text-slate-900">Tenants</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <HandCoins className="w-6 h-6 text-amber-600 mb-2" />
            <p className="text-sm text-slate-500">Módulo</p>
            <p className="font-semibold text-slate-900">Facturación SaaS</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <Headset className="w-6 h-6 text-violet-600 mb-2" />
            <p className="text-sm text-slate-500">Módulo</p>
            <p className="font-semibold text-slate-900">Soporte interno</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-800 mb-3">Permisos efectivos</p>
          {permissionsQuery.isLoading && <p className="text-sm text-slate-500">Cargando permisos...</p>}
          {permissionsQuery.isError && (
            <p className="text-sm text-red-600">
              No se pudieron cargar permisos globales. Verifica sesión o endpoint.
            </p>
          )}
          {permissionsQuery.data && (
            <div className="flex flex-wrap gap-2">
              {permissionsQuery.data.permissions.map((permission) => (
                <span
                  key={permission}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700"
                >
                  {permission}
                </span>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
