import { useAuth } from '../contexts/AuthContext';
import type { Usuario, SucursalBasica } from '../types';
import SedePickerModal from './SedePickerModal';

const PREF_KEY = 'preferred_sucursal_id';

/**
 * Modal bloqueante: más de una sede permitida y sin preferencia válida.
 */
export default function BranchGateModal() {
  const { user, loading, authScope, canSwitchSucursal, switchSucursal } = useAuth();

  const sedes: SucursalBasica[] =
    user && 'sucursales' in user ? ((user as Usuario).sucursales || []) as SucursalBasica[] : [];
  const pref = typeof window !== 'undefined' ? window.localStorage.getItem(PREF_KEY) : null;
  const prefOk = Boolean(pref && sedes.some((s) => s.id === pref));

  const gateOpen = Boolean(
    !loading &&
      authScope === 'tenant' &&
      canSwitchSucursal &&
      user &&
      sedes.length > 1 &&
      !prefOk,
  );

  return (
    <SedePickerModal
      open={gateOpen}
      onClose={() => {}}
      blocking
      sedes={sedes}
      initialSelectedId={null}
      title="Elige tu sede de trabajo"
      subtitle="Debes seleccionar en qué sede vas a operar antes de continuar."
      confirmLabel="Continuar"
      footerNote="Esta sede quedará guardada en este navegador para tus próximos accesos."
      onConfirm={async (id) => {
        await switchSucursal(id);
      }}
    />
  );
}
