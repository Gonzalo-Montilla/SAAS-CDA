import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useBrand } from '../contexts/BrandContext';
import { useLocation, useNavigate } from 'react-router-dom';
import BranchSelector from '../components/BranchSelector';
import BranchGateModal from '../components/BranchGateModal';
import AccessRestrictedModal from '../components/AccessRestrictedModal';
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
  FileStack,
  BookUser,
  ReceiptText,
} from 'lucide-react';
const WIZARD_KEY = 'cdasoft_sedes_wizard_dismissed';

export default function Dashboard() {
  const { user, logout, getLogoutRedirectPath } = useAuth();
  const brand = useBrand();
  const navigate = useNavigate();
  const location = useLocation();
  const [wizardNombre, setWizardNombre] = useState('');
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [showNominaBlockedModal, setShowNominaBlockedModal] = useState(false);
  const [showSarlaftBlockedModal, setShowSarlaftBlockedModal] = useState(false);

  const tenantUser: Usuario | null =
    user && 'tenant_id' in user ? (user as Usuario) : null;
  const nominaEnabled = Boolean(tenantUser?.tenant_nomina_enabled);
  const sarlaftEnabled = Boolean(tenantUser?.tenant_sarlaft_enabled);

  useEffect(() => {
    const navState = location.state as { nominaLocked?: boolean; sarlaftLocked?: boolean } | null;
    if (navState?.nominaLocked) {
      setShowNominaBlockedModal(true);
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    if (navState?.sarlaftLocked) {
      setShowSarlaftBlockedModal(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

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

  const formatDate = (iso?: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-CO');
  };

  const planLabel = (code?: string | null): string => {
    const c = (code || '').trim().toLowerCase();
    if (c === 'demo') return 'Plan demo';
    if (c === 'basico') return 'Plan básico';
    if (c === 'emprendedor') return 'Plan emprendedor';
    if (c === 'empresa') return 'Plan Empresa';
    return c ? `Plan ${c}` : 'Plan activo';
  };

  const platformCardTitle = (): string => {
    const tb = tenantUser?.tenant_billing;
    if (!tb) return 'Operativo';
    const st = (tb.subscription_status || '').trim().toLowerCase();
    if (st === 'trial' || (tb.plan_actual || '').toLowerCase() === 'demo') {
      const end = formatDate(tb.demo_ends_at);
      return end ? `Plan demo · vence ${end}` : 'Plan demo activo';
    }
    if (st === 'soft_grace') {
      const end = formatDate(tb.soft_grace_ends_at);
      return end ? `En gracia · hasta ${end}` : 'En gracia temporal';
    }
    if (st === 'active') {
      const name = planLabel(tb.plan_actual);
      const end = formatDate(tb.plan_ends_at);
      return end ? `${name} · activo hasta ${end}` : `${name} activo`;
    }
    if (st === 'past_due') return 'Pago vencido';
    if (st === 'locked' || st === 'pending_plan') return 'Sin plan activo';
    return 'Operativo';
  };

  const platformCardSubtitle = (): string => {
    const tb = tenantUser?.tenant_billing;
    if (!tb) return 'Estado de la plataforma';
    const st = (tb.subscription_status || '').trim().toLowerCase();
    if (st === 'trial' || (tb.plan_actual || '').toLowerCase() === 'demo') return 'Estado del plan';
    if (st === 'active') return 'Licencia vigente';
    if (st === 'soft_grace') return 'Periodo de gracia';
    if (st === 'past_due' || st === 'locked' || st === 'pending_plan') return 'Acción requerida';
    return 'Estado del plan';
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
                onClick={() => navigate('/proveedores-catalogo')}
                className="card-pos text-left group animate-fade-in animate-delay-200"
              >
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-100 text-teal-700 mb-4 group-hover:bg-teal-600 group-hover:text-white transition-all duration-300">
                  <BookUser className="w-8 h-8 icon-hover" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Proveedores</h3>
                <p className="text-slate-600 text-sm">
                  Catálogo para egresos y documento soporte (RUT / Factus)
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
                onClick={() => {
                  if (!nominaEnabled) {
                    setShowNominaBlockedModal(true);
                    return;
                  }
                  navigate('/nomina');
                }}
                className="card-pos text-left group animate-fade-in animate-delay-300"
              >
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-fuchsia-100 text-fuchsia-700 mb-4 group-hover:bg-fuchsia-600 group-hover:text-white transition-all duration-300">
                  <ReceiptText className="w-8 h-8 icon-hover" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Nómina</h3>
                <p className="text-slate-600 text-sm">
                  Gestión de periodos, liquidaciones y desprendibles de pago
                </p>
              </button>

              <button
                onClick={() => {
                  if (!sarlaftEnabled) {
                    setShowSarlaftBlockedModal(true);
                    return;
                  }
                  navigate('/sarlaft');
                }}
                className="card-pos text-left group animate-fade-in animate-delay-300"
              >
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 text-amber-700 mb-4 group-hover:bg-amber-600 group-hover:text-white transition-all duration-300">
                  <Shield className="w-8 h-8 icon-hover" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">SARLAFT</h3>
                <p className="text-slate-600 text-sm">
                  Captura de casos de cumplimiento y trazabilidad de riesgo
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
                  Gestión de sedes y usuarios del CDA
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

          <button
            onClick={() => navigate('/documentos')}
            className="card-pos text-left group animate-fade-in animate-delay-200"
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-100 text-teal-700 mb-4 group-hover:bg-teal-700 group-hover:text-white transition-all duration-300">
              <FileStack className="w-8 h-8 icon-hover" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Documentos</h3>
            <p className="text-slate-600 text-sm">
              Biblioteca de archivos del CDA: carga, consulta y descarga segura
            </p>
          </button>
        </div>

        {/* Info rápida: mismo destino /suscripcion que los avisos al terminar el demo o la gracia */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 rounded-2xl p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-emerald-700 font-medium">{platformCardSubtitle()}</p>
              <p className="text-xl font-bold text-emerald-900">{platformCardTitle()}</p>
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
          <button
            type="button"
            onClick={() => navigate('/suscripcion')}
            className="text-left bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 rounded-2xl p-5 flex items-center gap-4 hover:from-violet-100 hover:to-violet-200 hover:border-violet-300 transition-colors shadow-sm"
          >
            <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
              <Wallet className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-violet-800 font-medium">Planes y licencia</p>
              <p className="text-lg font-bold text-violet-950 leading-snug">Gestionar plan</p>
              <p className="text-xs text-violet-700/90 mt-1">
                Revisa planes, calcula tu valor por sedes y paga en línea de forma segura.
              </p>
            </div>
          </button>
        </div>
      </main>

      <AccessRestrictedModal
        open={showSarlaftBlockedModal}
        title="Módulo no habilitado"
        message="No tienes habilitado el módulo SARLAFT. Si deseas habilitarlo, escribe a soporte."
        badgeText="Acceso restringido"
        closeLabel="Cerrar"
        primaryLabel="Ir a soporte"
        onClose={() => setShowSarlaftBlockedModal(false)}
        onPrimaryAction={() => {
          setShowSarlaftBlockedModal(false);
          navigate('/soporte');
        }}
      />

      <AccessRestrictedModal
        open={showNominaBlockedModal}
        title="Módulo no habilitado"
        message="No tienes habilitado el módulo de nómina. Si deseas habilitarlo, escribe a soporte."
        badgeText="Acceso restringido"
        closeLabel="Cerrar"
        primaryLabel="Ir a soporte"
        onClose={() => setShowNominaBlockedModal(false)}
        onPrimaryAction={() => {
          setShowNominaBlockedModal(false);
          navigate('/soporte');
        }}
      />
    </div>
  );
}
