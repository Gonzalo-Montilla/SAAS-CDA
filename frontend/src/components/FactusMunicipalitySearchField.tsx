import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { factusApi, type FactusMunicipalityItem } from '../api/factus';
import { saasFactusApi } from '../api/saasFactus';

type Props = {
  /** Id numérico Factus guardado (string de dígitos). */
  value: string;
  onChange: (idDigits: string) => void;
  disabled?: boolean;
  /** Backoffice SaaS: tenant objetivo; si no, usa sesión admin del CDA. */
  saasTenantId?: string;
  idInputClassName?: string;
  /** Textos del bloque (p. ej. municipio del proveedor vs sede). */
  searchLabel?: string;
  idInputLabel?: string;
  helperText?: string;
};

export default function FactusMunicipalitySearchField({
  value,
  onChange,
  disabled = false,
  saasTenantId,
  idInputClassName = 'input w-full text-sm',
  searchLabel = '¿En qué ciudad factura esta sede?',
  idInputLabel = 'Id municipio (por si lo pega a mano)',
  helperText = 'Pulse un resultado y listo. (El número que guardamos es el id de Factus, no el código DIAN.)',
}: Props) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 400);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data, isFetching, isError, error } = useQuery<FactusMunicipalityItem[]>({
    queryKey: ['factus-municipalities', saasTenantId ?? 'cda', debounced],
    queryFn: () =>
      saasTenantId
        ? saasFactusApi.searchMunicipalities(saasTenantId, debounced)
        : factusApi.searchMunicipalities(debounced),
    enabled: !disabled && debounced.length >= 2,
    staleTime: 120_000,
  });

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">{searchLabel}</label>
        <input
          type="search"
          className="input w-full text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Escriba la ciudad (2 letras o más)…"
          disabled={disabled}
          autoComplete="off"
        />
        <p className="text-xs text-slate-500 mt-1">{helperText}</p>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">{idInputLabel}</label>
        <input
          type="text"
          inputMode="numeric"
          className={idInputClassName}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          placeholder="Vacío si aún no aplica"
          disabled={disabled}
        />
      </div>
      {isFetching && debounced.length >= 2 && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          Consultando Factus…
        </div>
      )}
      {isError && debounced.length >= 2 && (
        <p className="text-xs text-red-700">
          {(error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
            'No se pudo consultar municipios. Verifica credenciales Factus.'}
        </p>
      )}
      {data && data.length > 0 && debounced.length >= 2 && (
        <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white text-xs divide-y divide-slate-100">
          {data.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="w-full text-left px-2 py-1.5 hover:bg-slate-50 text-slate-800"
                onClick={() => {
                  onChange(String(m.id));
                  setQ('');
                  setDebounced('');
                }}
              >
                <span className="font-medium">{m.name ?? '—'}</span>
                <span className="text-slate-500"> — {m.department ?? '—'}</span>
                <span className="text-slate-400 font-mono ml-1">id {m.id}</span>
                {m.code != null && m.code !== '' && (
                  <span className="text-slate-400 font-mono ml-1">cód. DIAN {m.code}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.length === 0 && debounced.length >= 2 && !isFetching && (
        <p className="text-xs text-slate-500">Sin resultados. Pruebe otra palabra.</p>
      )}
    </div>
  );
}
