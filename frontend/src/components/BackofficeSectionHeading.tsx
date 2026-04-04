import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type BackofficeSectionHeadingProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  right?: ReactNode;
  className?: string;
  /** Dentro de una tarjeta con borde: solo barra superior con gradiente y borde inferior */
  embedded?: boolean;
};

export function BackofficeSectionHeading({
  icon: Icon,
  title,
  description,
  right,
  className = '',
  embedded = false,
}: BackofficeSectionHeadingProps) {
  const shell = embedded
    ? 'rounded-t-xl border-0 border-b border-slate-100 bg-gradient-to-r from-slate-50/95 to-indigo-50/40 shadow-none'
    : 'rounded-xl border border-slate-200/80 bg-gradient-to-r from-slate-50/95 to-indigo-50/40';

  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3.5 ${shell} ${className}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
        </div>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-sm font-semibold text-slate-900 tracking-tight">{title}</h2>
          {description ? (
            <p className="text-xs text-slate-500 mt-0.5 leading-snug">{description}</p>
          ) : null}
        </div>
      </div>
      {right ? <div className="shrink-0 flex flex-wrap items-center justify-end gap-2">{right}</div> : null}
    </div>
  );
}
