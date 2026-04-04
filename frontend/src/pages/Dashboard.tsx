import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useBrand } from '../contexts/BrandContext';
import { useNavigate } from 'react-router-dom';
import BranchSelector from '../components/BranchSelector';
import BranchGateModal from '../components/BranchGateModal';
import apiClient from '../api/client';
import type { Usuario } from '../types';
import {
  ClipboardList,
  Wallet,
  DollarSign,
  Vault,
  BarChart3,
  Users,
  LogOut,
  CheckCircle2,
  Shield,
  LifeBuoy,
  MessageSquareHeart,
  CalendarClock,
} from 'lucide-react';
const WIZARD_KEY = 'cdasoft_sedes_wizard_dismissed';

export default function Dashboard() {
  const { user, logout, getLogoutRedirectPath } = useAuth();
  const brand = useBrand();
  const navigate = useNavigate();
  const [wizardNombre, setWizardNombre] = useState('');
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  const tenantUser: Usuario | null =
    user && 'tenant_id' in user ? (user as Usuario) : null;

  const showSedesWizard =
    tenantUser?.rol === 'administrador' &&
    tenantUser.sucursales?.length === 1 &&
    tenantUser.sucursales[0].nombre === 'Sede principal' &&
    !localStorage.getItem(WIZARD_KEY);

  const handleLogout = () => {
    const redirectPath = getLogoutRedirectPath();
    logout();
    navigate(redirectPath);
  };

  return (
    <div className="app-shell">
      <BranchGateModal />
      {/* Header */}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="flex items-center gap-4">
            <img 
              src={brand.logoSrc}
              alt={brand.nombreComercial}
              className="h-16 sm:h-20 rounded-2xl shadow-soft"
            />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Panel de operación</p>
              <p className="text-2xl font-bold text-slate-900 leading-tight">{brand.nombreComercial}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap justify-end">
            <BranchSelector />
            <div className="app-user-chip">
              <div className="text-right">
                <p className="text-sm font-medium text-slate-900">{user?.nombre_completo}</p>
                <p className="text-xs text-slate-500 capitalize">{user?.rol}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 btn-corporate-danger flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Salir
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        {showSedesWizard && tenantUser?.sucursales?.[0] && (
          <div className="mb-6 rounded-2xl border border-primary-200 bg-primary-50/80 p-5 animate-fade-in">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Configura el nombre de tu sede</h3>
            <p className="text-sm text-slate-600 mb-3">
              Personaliza cómo aparecerá tu sede principal en reportes y operación (opcional).
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <input
                type="text"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Ej. Centro / Chía / Av. Caracas"
                value={wizardNombre}
                onChange={(e) => setWizardNombre(e.target.value)}
              />
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50"
                disabled={wizardBusy || wizardNombre.trim().length < 2}
                onClick={async () => {
                  setWizardError(null);
                  setWizardBusy(true);
                  try {
                    await apiClient.patch(`/sucursales/${tenantUser.sucursales![0].id}`, {
                      nombre: wizardNombre.trim(),
                    });
                    localStorage.setItem(WIZARD_KEY, '1');
                    window.location.reload();
                  } catch (e: any) {
                    setWizardError(e?.response?.data?.detail || 'No se pudo guardar');
                  } finally {
                    setWizardBusy(false);
                  }
                }}
              >
                Guardar
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm text-slate-600"
                onClick={() => {
                  localStorage.setItem(WIZARD_KEY, '1');
                  window.location.reload();
                }}
              >
                Omitir
              </button>
            </div>
            {wizardError && <p className="text-sm text-red-600 mt-2">{wizardError}</p>}
          </div>
        )}

        <div className="mb-8 animate-fade-in">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">
            Bienvenido, {user?.nombre_completo}
          </h2>
          <p className="text-slate-600">Selecciona un módulo para comenzar tu operación.</p>
        </div>

        {/* Módulos principales */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Módulo Recepción */}
          {(user?.rol === 'recepcionista' || user?.rol === 'administrador') && (
            <button
              onClick={() => navigate('/recepcion')}
              className="card-pos text-left group animate-fade-in"
            >
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 mb-4 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
                <ClipboardList className="w-8 h-8 icon-hover" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Recepción</h3>
              <p className="text-slate-600 text-sm">
                Registrar vehículos y clientes para inspección RTM
              </p>
            </button>
          )}

          {(user?.rol === 'recepcionista' || user?.rol === 'administrador' || user?.rol === 'comercial') && (
            <button
              onClick={() => navigate('/agendamiento')}
              className="card-pos text-left group animate-fade-in animate-delay-100"
            >
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-100 text-sky-600 mb-4 group-hover:bg-sky-600 group-hover:text-white transition-all duration-300">
                <CalendarClock className="w-8 h-8 icon-hover" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Agendamiento</h3>
              <p className="text-slate-600 text-sm">
                Gestionar citas por link público y control de check-in
              </p>
            </button>
          )}

          {/* Módulo Caja */}
          {(user?.rol === 'cajero' || user?.rol === 'administrador') && (
            <button
              onClick={() => navigate('/caja')}
              className="card-pos text-left group animate-fade-in animate-delay-100"
            >
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 mb-4 group-hover:bg-emerald-600 group-hover:text-white transition-all duration-300">
                <Wallet className="w-8 h-8 icon-hover" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Caja</h3>
              <p className="text-slate-600 text-sm">
                Cobrar servicios, apertura y cierre de caja
              </p>
            </button>
          )}

          {/* Módulo Administración */}
          {user?.rol === 'administrador' && (
            <>
              <button
                onClick={() => navigate('/tarifas')}
                className="card-pos text-left group animate-fade-in animate-delay-200"
              >
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 mb-4 group-hover:bg-amber-600 group-hover:text-white transition-all duration-300">
                  <DollarSign className="w-8 h-8 icon-hover" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Tarifas</h3>
                <p className="text-slate-600 text-sm">
                  Gestionar tarifas RTM y comisiones SOAT
                </p>
              </button>

              <button
                onClick={() => navigate('/tesoreria')}
                className="card-pos text-left group animate-fade-in animate-delay-300"
              >
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-purple-100 text-purple-600 mb-4 group-hover:bg-purple-600 group-hover:text-white transition-all duration-300">
                  <Vault className="w-8 h-8 icon-hover" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Tesorería</h3>
                <p className="text-slate-600 text-sm">
                  Caja Fuerte - Gestión centralizada del dinero
                </p>
              </button>

              <button
                onClick={() => navigate('/reportes')}
                className="card-pos text-left group animate-fade-in"
              >
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-100 text-indigo-600 mb-4 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
                  <BarChart3 className="w-8 h-8 icon-hover" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Reportes</h3>
                <p className="text-slate-600 text-sm">
                  Ver reportes de cajas, inspecciones y finanzas
                </p>
              </button>

              <button
                onClick={() => navigate('/organizacion')}
                className="card-pos text-left group animate-fade-in animate-delay-100"
              >
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 mb-4 group-hover:bg-rose-600 group-hover:text-white transition-all duration-300">
                  <Users className="w-8 h-8 icon-hover" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Sedes y usuarios</h3>
                <p className="text-slate-600 text-sm">
                  Crear sedes, sede principal y usuarios del CDA
                </p>
              </button>

            </>
          )}

          {(user?.rol === 'administrador' || user?.rol === 'comercial') && (
            <button
              onClick={() => navigate('/calidad')}
              className="card-pos text-left group animate-fade-in animate-delay-200"
            >
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-100 text-violet-600 mb-4 group-hover:bg-violet-600 group-hover:text-white transition-all duration-300">
                <MessageSquareHeart className="w-8 h-8 icon-hover" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Calidad</h3>
              <p className="text-slate-600 text-sm">
                Seguimiento de encuestas de satisfacción y comentarios de clientes
              </p>
            </button>
          )}

          <button
            onClick={() => navigate('/soporte')}
            className="card-pos text-left group animate-fade-in animate-delay-200"
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-cyan-100 text-cyan-600 mb-4 group-hover:bg-cyan-600 group-hover:text-white transition-all duration-300">
              <LifeBuoy className="w-8 h-8 icon-hover" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Soporte</h3>
            <p className="text-slate-600 text-sm">
              Reportar incidentes y hacer seguimiento a solicitudes del CDA
            </p>
          </button>
        </div>

        {/* Info rápida */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in">
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 rounded-2xl p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-emerald-700 font-medium">Estado de la plataforma</p>
              <p className="text-xl font-bold text-emerald-900">Operativo</p>
            </div>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-2xl p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary-600 flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-blue-700 font-medium">Rol actual</p>
              <p className="text-xl font-bold text-blue-900 capitalize">{user?.rol}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
