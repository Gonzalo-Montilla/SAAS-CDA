import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { Usuario } from '../types';
import AccessRestrictedModal from './AccessRestrictedModal';

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
    const softGraceEndLabel = billing.soft_grace_ends_at
      ? ` Fin de gracia: ${new Date(billing.soft_grace_ends_at).toLocaleString('es-CO')}.`
      : '';
    return (
      <AccessRestrictedModal
        open
        badgeText="Período de gracia"
        title="Tu plan demo finalizó"
        message={`El demo de 15 días ha terminado. Tienes unos días de gracia para elegir un plan y pagar antes del bloqueo de edición.${softGraceEndLabel}`}
        closeLabel="Cerrar"
        primaryLabel="Elegir plan y pagar"
        onClose={() => {
          if (billing.soft_grace_ends_at) {
            sessionStorage.setItem(`${SOFT_KEY}_${billing.soft_grace_ends_at}`, '1');
          }
          setDismissedSoft(true);
        }}
        onPrimaryAction={() => navigate('/suscripcion')}
      />
    );
  }

  if (gate === 'hard') {
    return (
      <AccessRestrictedModal
        open
        badgeText="Acceso restringido"
        title="Operación bloqueada por suscripción"
        message="La gracia de prueba finalizó. Debes contratar un plan y completar el pago para continuar operando. Si ya pagaste, usa “Comprobé mi pago”."
        closeLabel="Comprobé mi pago"
        primaryLabel="Ir a suscripción"
        onClose={() => {
          void refreshTenantUser();
        }}
        onPrimaryAction={() => navigate('/suscripcion')}
      />
    );
  }

  return null;
}
