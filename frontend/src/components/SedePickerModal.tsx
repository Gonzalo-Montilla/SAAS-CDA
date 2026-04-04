import { useState, useEffect } from 'react';
import { Building2, ArrowRight, X } from 'lucide-react';
import type { SucursalBasica } from '../types';

export interface SedePickerModalProps {
  open: boolean;
  onClose: () => void;
  /** Si true: sin cerrar por fuera ni botón cancelar (solo confirmar). */
  blocking?: boolean;
  sedes: SucursalBasica[];
  /** Vacío o null: primer ingreso (placeholder si blocking). Si viene la sede activa, se preselecciona. */
  initialSelectedId?: string | null;
  title: string;
  subtitle: string;
  confirmLabel?: string;
  footerNote?: string | null;
  onConfirm: (sucursalId: string) => Promise<void>;
}

export default function SedePickerModal({
  open,
  onClose,
  blocking = false,
  sedes,
  initialSelectedId = '',
  title,
  subtitle,
  confirmLabel = 'Continuar',
  footerNote,
  onConfirm,
}: SedePickerModalProps) {
  const [selectedId, setSelectedId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedId('');
      setError(null);
      return;
    }
    setSelectedId(initialSelectedId ? String(initialSelectedId) : '');
    setError(null);
  }, [open, initialSelectedId]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const needsPlaceholder = blocking && (initialSelectedId == null || initialSelectedId === '');

  const handleConfirm = async () => {
    if (!selectedId) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(selectedId);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'No se pudo aplicar la sede. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdropClick = () => {
    if (!blocking) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 sm:p-8 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {!blocking && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        <div className="flex items-center gap-3 mb-2 pr-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-primary-700 shrink-0">
            <Building2 className="w-6 h-6" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            <p className="text-sm text-slate-600">{subtitle}</p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <label htmlFor="sede-picker-select" className="block text-sm font-semibold text-slate-700">
            Sede activa
          </label>
          <select
            id="sede-picker-select"
            className="input w-full text-base py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-primary-500"
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setError(null);
            }}
            autoFocus
          >
            {needsPlaceholder && (
              <option value="" disabled>
                Seleccione una sede…
              </option>
            )}
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
                {s.es_principal ? ' (principal)' : ''}
              </option>
            ))}
          </select>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className={`flex gap-2 ${!blocking ? 'mt-2' : 'mt-2'}`}>
            {!blocking && (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border-2 border-slate-200 bg-white py-3 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
            )}
            <button
              type="button"
              disabled={!selectedId || submitting}
              onClick={() => void handleConfirm()}
              className={`flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-white font-semibold py-3.5 px-4 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors ${
                blocking ? 'w-full' : 'flex-1'
              }`}
            >
              {submitting ? 'Aplicando…' : confirmLabel}
              {!submitting && <ArrowRight className="w-5 h-5 shrink-0" aria-hidden />}
            </button>
          </div>
        </div>

        {footerNote ? (
          <p className="mt-4 text-xs text-slate-500 text-center">{footerNote}</p>
        ) : null}
      </div>
    </div>
  );
}
