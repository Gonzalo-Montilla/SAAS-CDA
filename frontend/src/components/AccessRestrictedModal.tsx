interface AccessRestrictedModalProps {
  open: boolean;
  title: string;
  message: string;
  badgeText?: string;
  closeLabel?: string;
  primaryLabel?: string;
  onClose: () => void;
  onPrimaryAction?: () => void;
}

export default function AccessRestrictedModal({
  open,
  title,
  message,
  badgeText = 'Acceso restringido',
  closeLabel = 'Cerrar',
  primaryLabel = 'Ir a soporte',
  onClose,
  onPrimaryAction,
}: AccessRestrictedModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="modal-panel max-w-md w-full glass-card border border-amber-200/80 p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <span aria-hidden="true" className="text-lg leading-none">
              !
            </span>
          </div>
          <div className="min-w-0">
            <p className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
              {badgeText}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">{title}</h3>
          </div>
        </div>

        <p className="mt-3 text-sm text-slate-600">{message}</p>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" className="btn-corporate-muted px-4" onClick={onClose}>
            {closeLabel}
          </button>
          {onPrimaryAction && (
            <button
              type="button"
              className="btn-corporate-primary px-4"
              onClick={onPrimaryAction}
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
