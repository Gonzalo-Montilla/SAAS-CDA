import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Usuario } from '../types';
import { Building2, ChevronRight } from 'lucide-react';
import SedePickerModal from './SedePickerModal';

function sedeChipClass(clickable: boolean): string {
  const base =
    'flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 shadow-sm text-left max-w-[min(100%,280px)]';
  if (!clickable) return base;
  return `${base} group hover:border-primary-300 hover:bg-white transition-colors`;
}

export default function BranchSelector() {
  const { user, canSwitchSucursal, switchSucursal } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  if (!user || !('tenant_id' in user)) {
    return null;
  }

  const u = user as Usuario;
  const sedes = u.sucursales || [];
  const activeId = u.active_sucursal_id || sedes[0]?.id || '';
  const activeSede = sedes.find((s) => s.id === activeId) || sedes[0];
  const label = (activeSede?.nombre || '').trim();
  if (!label) {
    return null;
  }

  const inner = (
    <>
      <Building2
        className={`w-4 h-4 text-slate-500 shrink-0 ${canSwitchSucursal ? 'group-hover:text-primary-600' : ''}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
          Sede activa
        </p>
        <p className="text-sm font-semibold text-slate-900 truncate">{label}</p>
      </div>
    </>
  );

  if (!canSwitchSucursal) {
    return (
      <div className={sedeChipClass(false)} title={`Trabajando en ${label}`}>
        {inner}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={sedeChipClass(true)}
        title="Cambiar sede de trabajo"
      >
        {inner}
        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 group-hover:text-primary-600" aria-hidden />
      </button>

      <SedePickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        blocking={false}
        sedes={sedes}
        initialSelectedId={activeId}
        title="Cambiar sede de trabajo"
        subtitle="Elige la sede en la que vas a operar. Varios usuarios pueden usar el mismo equipo; cada quien puede elegir su sede al iniciar."
        confirmLabel="Aplicar sede"
        footerNote="La preferencia se guarda en este navegador (este equipo)."
        onConfirm={async (id) => {
          await switchSucursal(id);
        }}
      />
    </>
  );
}
