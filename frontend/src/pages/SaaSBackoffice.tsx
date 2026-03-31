import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, LogOut, Users, HandCoins, Headset, Copy, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';
import { useState } from 'react';
import type { SaaSTenantSummary } from '../types';
import logoCdaSoft from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';

interface SaaSPermissionsResponse {
  role: 'owner' | 'finanzas' | 'comercial' | 'soporte';
  permissions: string[];
}

export default function SaaSBackoffice() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [copiedTenantId, setCopiedTenantId] = useState<string | null>(null);

  const permissionsQuery = useQuery({
    queryKey: ['saas-permissions-me'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSPermissionsResponse>('/saas/auth/permissions/me');
      return response.data;
    },
  });

  const tenantsQuery = useQuery({
    queryKey: ['saas-tenants-list'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSTenantSummary[]>('/saas/auth/tenants');
      return response.data;
    },
  });

  const handleLogout = () => {
    logout();
    navigate('/saas/login');
  };

  const handleCopyLoginUrl = async (tenantId: string, loginUrl: string) => {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopiedTenantId(tenantId);
      setTimeout(() => setCopiedTenantId(null), 2000);
    } catch (_error) {
      // Silencioso para no bloquear UX.
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoCdaSoft} alt="CDASOFT" className="h-24 w-auto object-contain" />
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

        <div className="bg-white rounded-2xl border border-slate-200 p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-slate-800">Tenants CDA</p>
            <span className="text-xs rounded-full bg-slate-100 px-2 py-1 text-slate-600">
              Total: {tenantsQuery.data?.length || 0}
            </span>
          </div>

          {tenantsQuery.isLoading && <p className="text-sm text-slate-500">Cargando tenants...</p>}
          {tenantsQuery.isError && (
            <p className="text-sm text-red-600">No se pudo cargar la lista de tenants.</p>
          )}

          {tenantsQuery.data && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-200">
                    <th className="py-2 pr-4 text-slate-500 font-medium">CDA</th>
                    <th className="py-2 pr-4 text-slate-500 font-medium">Slug</th>
                    <th className="py-2 pr-4 text-slate-500 font-medium">Contacto</th>
                    <th className="py-2 pr-4 text-slate-500 font-medium">Estado</th>
                    <th className="py-2 pr-4 text-slate-500 font-medium">URL personalizada</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantsQuery.data.map((tenant) => (
                    <tr key={tenant.id} className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-medium text-slate-900">{tenant.nombre_comercial}</td>
                      <td className="py-3 pr-4 text-slate-700">/{tenant.slug}</td>
                      <td className="py-3 pr-4 text-slate-700">{tenant.correo_electronico || '-'}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                            tenant.activo
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {tenant.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600 break-all">{tenant.login_url}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyLoginUrl(tenant.id, tenant.login_url)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                          >
                            {copiedTenantId === tenant.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                Copiado
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                Copiar
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
