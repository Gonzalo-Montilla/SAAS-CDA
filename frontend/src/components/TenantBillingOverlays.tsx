import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { Usuario } from '../types';

const SOFT_KEY = 'cdasoft_billing_soft_dismissed_session';

/**
 * Modales de demo / gracia (cerrable) y bloqueo duro (no cerrable) según /auth/me → tenant_billing.
 */
export default function TenantBillingOverlays() {
  const { user, authScope, refreshTenantUser } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [dismissedSoft, setDismissedSoft] = useState(false);

  const billing = (user && 'tenant_billing' in user ? (user as Usuario).tenant_billing : null) ?? null;
  const gate = billing?.gate;

  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return;
    if (gate === 'soft' && (billing?.soft_grace_ends_at || '')) {
      const k = `${SOFT_KEY}_${billing?.soft_grace_ends_at}`;
      setDismissedSoft(sessionStorage.getItem(k) === '1');
    } else {
      setDismissedSoft(false);
    }
  }, [gate, billing?.soft_grace_ends_at]);

  if (authScope !== 'tenant' || !user || !billing) {
    return null;
  }
  if (loc.pathname === '/suscripcion' || loc.pathname === '/login') {
    return null;
  }
  if (gate === 'trial' || gate === 'ok') {
    return null;
  }

  if (gate === 'soft' && !dismissedSoft) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
        <div className="max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="text-lg font-semibold text-slate-900">Período de prueba finalizado</h2>
          <p className="mt-2 text-sm text-slate-600">
            El demo de 15 días ha terminado. Tienes unos días de gracia para elegir un plan y pagar;
            luego el acceso de edición se bloqueará.
          </p>
          {billing.soft_grace_ends_at && (
            <p className="mt-2 text-xs text-slate-500">
              Fin de gracia suave: {new Date(billing.soft_grace_ends_at).toLocaleString('es-CO')}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate('/suscripcion')}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Elegir plan y pagar
            </button>
            <button
              type="button"
              onClick={() => {
                if (billing.soft_grace_ends_at) {
                  sessionStorage.setItem(`${SOFT_KEY}_${billing.soft_grace_ends_at}`, '1');
                }
                setDismissedSoft(true);
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gate === 'hard') {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 p-4">
        <div className="max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="text-lg font-semibold text-slate-900">Acceso restringido</h2>
          <p className="mt-2 text-sm text-slate-600">
            La gracia de prueba finalizó. Debes contratar un plan y completar el pago para continuar
            operando. Si ya pagó, reintente iniciar sesión o contacte a soporte.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate('/suscripcion')}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Elegir plan
            </button>
            <button
              type="button"
              onClick={() => {
                void refreshTenantUser();
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800"
            >
              Comprobé mi pago
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
