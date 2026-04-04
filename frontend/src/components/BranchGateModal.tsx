import { useAuth } from '../contexts/AuthContext';
import type { Usuario, SucursalBasica } from '../types';
import SedePickerModal from './SedePickerModal';

const PREF_KEY = 'preferred_sucursal_id';

/**
 * Modal bloqueante: solo si el usuario puede cambiar de sede (admin/contador)
 * y hay más de una sede, y aún no hay sede preferida persistida en este navegador.
 */
export default function BranchGateModal() {
  const { user, loading, authScope, canSwitchSucursal, switchSucursal } = useAuth();

  const gateOpen = Boolean(
    !loading &&
      authScope === 'tenant' &&
      canSwitchSucursal &&
      user &&
      'sucursales' in user &&
      Array.isArray((user as Usuario).sucursales) &&
      (user as Usuario).sucursales!.length > 1 &&
      !localStorage.getItem(PREF_KEY),
  );

  const sedes: SucursalBasica[] =
    user && 'sucursales' in user ? ((user as Usuario).sucursales || []) as SucursalBasica[] : [];

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
