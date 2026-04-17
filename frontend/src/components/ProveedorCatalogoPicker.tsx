import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProveedorCatalogo } from '../api/proveedoresCatalogo';
import { Search, X } from 'lucide-react';

const MAX_MOSTRAR = 50;

function textoBusquedaProveedor(p: ProveedorCatalogo): string {
  const partes = [
    p.alias,
    p.razon_social_rut,
    p.tipo_identificacion,
    p.numero_identificacion,
    p.numero_identificacion.replace(/\D/g, ''),
  ];
  return partes.filter(Boolean).join(' ').toLowerCase();
}

export type ProveedorCatalogoPickerProps = {
  proveedores: ProveedorCatalogo[];
  selectedId: string;
  onSelect: (p: ProveedorCatalogo) => void;
  onClear: () => void;
  disabled?: boolean;
  /** Clases del input (p. ej. input-pos). */
  inputClassName?: string;
};

/**
 * Búsqueda + lista desplegable para elegir proveedor del catálogo (mejor que un select largo).
 */
export default function ProveedorCatalogoPicker({
  proveedores,
  selectedId,
  onSelect,
  onClear,
  disabled = false,
  inputClassName = 'input-pos w-full',
}: ProveedorCatalogoPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');

  const seleccionado = useMemo(
    () => proveedores.find((p) => p.id === selectedId),
    [proveedores, selectedId],
  );

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const base = !qn
      ? [...proveedores].sort((a, b) =>
          a.razon_social_rut.localeCompare(b.razon_social_rut, 'es', { sensitivity: 'base' }),
        )
      : proveedores.filter((p) => textoBusquedaProveedor(p).includes(qn));
    return base.slice(0, MAX_MOSTRAR);
  }, [proveedores, q]);

  const totalCoinciden = useMemo(() => {
    const qn = q.trim().toLowerCase();
    if (!qn) return proveedores.length;
    return proveedores.filter((p) => textoBusquedaProveedor(p).includes(qn)).length;
  }, [proveedores, q]);

  useEffect(() => {
    if (!abierto) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [abierto]);

  const etiquetaSeleccion = (p: ProveedorCatalogo) =>
    `${p.alias ? `${p.alias} · ` : ''}${p.razon_social_rut} — ${p.tipo_identificacion} ${p.numero_identificacion}`;

  if (disabled) {
    return null;
  }

  if (seleccionado) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm">
          <span className="font-medium text-slate-900 flex-1 min-w-0">{etiquetaSeleccion(seleccionado)}</span>
          <button
            type="button"
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => {
              onClear();
              setQ('');
              setAbierto(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Cambiar
          </button>
          <button
            type="button"
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
            onClick={() => {
              onClear();
              setQ('');
            }}
          >
            <X className="w-3.5 h-3.5" />
            Quitar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative space-y-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          className={`${inputClassName} pl-9`}
          placeholder="Buscar por nombre, alias o NIT/documento…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
        />
      </div>

      {abierto && (
        <div className="absolute z-[60] mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {proveedores.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-600 text-center">No hay proveedores en el catálogo.</p>
          ) : filtrados.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-600 text-center">Sin coincidencias. Pruebe otras palabras.</p>
          ) : (
            <ul className="py-1 divide-y divide-slate-100">
              {filtrados.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50"
                    onClick={() => {
                      onSelect(p);
                      setQ('');
                      setAbierto(false);
                    }}
                  >
                    <span className="font-medium text-slate-900 block truncate">{etiquetaSeleccion(p)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {proveedores.length > 0 && (
        <p className="text-xs text-slate-500">
          {!q.trim() && totalCoinciden > MAX_MOSTRAR
            ? `Mostrando ${MAX_MOSTRAR} de ${totalCoinciden} proveedores. Escriba para acotar la lista.`
            : totalCoinciden > filtrados.length
              ? `Mostrando ${filtrados.length} de ${totalCoinciden} coincidencias.`
              : totalCoinciden > 0
                ? `${totalCoinciden} proveedor${totalCoinciden === 1 ? '' : 'es'}.`
                : null}
        </p>
      )}
    </div>
  );
}
