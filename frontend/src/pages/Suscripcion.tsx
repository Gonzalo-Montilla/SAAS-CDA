import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { BadgeCheck, Building2, Calculator, ShieldCheck } from 'lucide-react';
import {
  listTenantPlans,
  quoteTenantPlan,
  initTenantPayment,
  completeTenantCheckoutMock,
  confirmTenantCheckoutReturn,
  fetchLatestSaasFe,
  retrySaasFactusEmission,
  type SaasFeLatest,
  type TenantPlanItem,
} from '../api/tenantBilling';
import { useAuth } from '../contexts/AuthContext';
import { useBrand } from '../contexts/BrandContext';
import type { Usuario } from '../types';

function fmtCop(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

/** Texto comercial fijo por código de plan (alineado a reglas: base + 1 anexa incluidas, 3.ª+ cobran). */
const PLAN_MARKETING: Record<string, { blurb: string; bullets: string[]; badge?: string }> = {
  basico: {
    badge: 'Entrada frecuente',
    blurb: 'Tres meses de licencia con todo el panel operativo: ideal al salir del periodo de prueba.',
    bullets: [
      'Recepción, cajas, tesorería, reportes, calidad, soporte, documentos y el resto de módulos del CDA',
      'Prepago del periodo; facturación electrónica de la licencia (emisor CDASOFT / trazabilidad DIAN)',
      'Misma lógica de sedes: 2 en el base; desde la 3.ª, tarifa de sucursal de este plan',
    ],
  },
  emprendedor: {
    badge: '6 meses de continuidad',
    blurb: 'Medio año con una sola renovación: menos carga administrativa que trimestre a trimestre.',
    bullets: [
      'Mismas capacidades técnicas que Básico, con periodo 6 meses',
      'Actualizaciones de la plataforma incluidas en la licencia',
      'Sedes: 2 incluidas en el precio base; 3.ª y siguientes con tarifa Emprendedor',
    ],
  },
  empresa: {
    badge: 'Ahorro anual',
    blurb: 'Un año de operación: planifica una sola vez y prioriza el trabajo en el piso.',
    bullets: [
      'Licencia anual con los mismos módulos; pensado para CDAs con varias sedes y largo plazo',
      'Factura de licencia y respaldo con nuestra facturación electrónica de suscripción',
      'Sedes: 2 en el base; 3.ª+ con la tarifa Empresa (la más conveniente anexo a anexo)',
    ],
  },
};

function planMarketing(code: string) {
  return PLAN_MARKETING[code] ?? {
    blurb: 'Licencia de uso del software CDASOFT según condiciones comerciales.',
    bullets: ['Cotización con sedes reales; pago con pasarela segura ePayco'],
  };
}

const PLAN_VISUAL: Record<
  string,
  {
    topBar: string;
    badgeClass: string;
    bulletDotClass: string;
    selectedRingClass: string;
    selectedGlowClass: string;
    ctaClass: string;
  }
> = {
  basico: {
    topBar: 'from-sky-400 via-blue-500 to-indigo-500',
    badgeClass: 'border border-sky-200 bg-sky-50 text-sky-800',
    bulletDotClass: 'text-sky-600',
    selectedRingClass: 'ring-sky-300',
    selectedGlowClass: 'shadow-sky-100/80',
    ctaClass: 'border-sky-200 bg-sky-50 text-sky-800',
  },
  emprendedor: {
    topBar: 'from-violet-400 via-indigo-500 to-blue-500',
    badgeClass: 'border border-violet-200 bg-violet-50 text-violet-800',
    bulletDotClass: 'text-violet-600',
    selectedRingClass: 'ring-violet-300',
    selectedGlowClass: 'shadow-violet-100/80',
    ctaClass: 'border-violet-200 bg-violet-50 text-violet-800',
  },
  empresa: {
    topBar: 'from-emerald-400 via-teal-500 to-cyan-500',
    badgeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
    bulletDotClass: 'text-emerald-600',
    selectedRingClass: 'ring-emerald-300',
    selectedGlowClass: 'shadow-emerald-100/80',
    ctaClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
};

function isPendingDianFactusError(msg: string | null | undefined): boolean {
  const s = (msg || '').toLowerCase();
  return s.includes('pendiente') && s.includes('dian');
}

function saasFeStatusLabel(
  status: string | null | undefined,
  err: string | null | undefined,
  category?: string | null
): string {
  if ((status || '') === 'error' && (category === 'pending_dian' || isPendingDianFactusError(err))) {
    return 'En proceso de validación DIAN';
  }
  const s = (status || '').trim().toLowerCase();
  if (!s) return '—';
  if (s === 'ok') return 'Emitida';
  if (s === 'error') return 'Error';
  if (s === 'skipped') return 'Omitida';
  return status || '—';
}

const EPAYCO_CHECKOUT_V2 = 'https://checkout.epayco.co/checkout-v2.js';

/** Evita doble post en StrictMode (módulo: se resetea al recargar la página). */
const epaycoReturnUrlHandled = new Set<string>();

function hasEpaycoReturnParams(sp: URLSearchParams): boolean {
  const k = [
    'x_signature',
    'x_transaction_id',
    'x_amount',
    'x_ref_payco',
    'ref_payco',
    'x_cod_response',
    'cod_respuesta',
    'x_response',
  ];
  return k.some((d) => {
    const v = sp.get(d);
    return v != null && String(v).trim() !== '';
  });
}

function buildConfirmBodyFromQuery(sessionId: string, sp: URLSearchParams) {
  const p = (a: string, b?: string) => sp.get(a) ?? (b ? sp.get(b) : null);
  const t = (v: string | null) => (v != null && v.trim() !== '' ? v.trim() : undefined);
  const amt = sp.get('x_amount') || sp.get('x_amount_approved');
  return {
    session_id: sessionId,
    ref_payco: t(p('x_ref_payco', 'ref_payco')),
    cod_response: t(p('x_cod_response', 'cod_respuesta')),
    x_response: t(p('x_response')),
    x_signature: t(p('x_signature')),
    x_transaction_id: t(p('x_transaction_id')),
    x_amount: t(amt),
    x_currency_code: t(p('x_currency_code')),
  };
}

type EpaycoCheckoutHandle = {
  open: () => void;
  onCreated?: (cb: () => void) => void;
  onErrors?: (cb: (errors: unknown) => void) => void;
  onClosed?: (cb: () => void) => void;
};

type EpaycoWindow = {
  ePayco?: {
    checkout: {
      configure: (opts: { sessionId: string; type: 'onpage' | 'standard'; test: boolean }) => EpaycoCheckoutHandle;
    };
  };
};

function loadEpaycoCheckoutV2Script(): Promise<void> {
  const w = window as unknown as EpaycoWindow;
  if (w.ePayco?.checkout?.configure) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const id = 'epayco-checkout-v2';
    if (document.getElementById(id)) {
      const t = setInterval(() => {
        if ((window as unknown as EpaycoWindow).ePayco?.checkout?.configure) {
          clearInterval(t);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(t);
        reject(new Error('Timeout cargando ePayco'));
      }, 20000);
      return;
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = EPAYCO_CHECKOUT_V2;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar el script de ePayco'));
    document.body.appendChild(s);
  });
}

function openEpaycoSmartCheckout(
  sessionId: string,
  test: boolean,
  onClosed?: () => void
): void {
  const w = window as unknown as EpaycoWindow;
  const ep = w.ePayco;
  if (!ep?.checkout?.configure) {
    throw new Error('ePayco no está disponible en la ventana');
  }
  const checkout = ep.checkout.configure({
    sessionId,
    type: 'onpage',
    test,
  });
  checkout.onErrors?.((errors) => {
    console.error('ePayco Smart Checkout', errors);
  });
  checkout.onClosed?.(() => {
    onClosed?.();
  });
  checkout.open();
}

export default function Suscripcion() {
  const { user, refreshTenantUser, authScope } = useAuth();
  const brand = useBrand();
  const u = user as Usuario | null;
  const [searchParams] = useSearchParams();
  const sessionFromUrl = searchParams.get('session');

  const [plans, setPlans] = useState<TenantPlanItem[]>([]);
  const [planCode, setPlanCode] = useState('basico');
  const [sedes, setSedes] = useState(u?.tenant_sedes_totales ?? 1);
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof quoteTenantPlan>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initResult, setInitResult] = useState<string | null>(null);
  const [saasFe, setSaasFe] = useState<SaasFeLatest | null>(null);
  const [saasFeLoadError, setSaasFeLoadError] = useState<string | null>(null);
  const [retryFeBusy, setRetryFeBusy] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [quotePulse, setQuotePulse] = useState(false);
  /** Retorno ePayco con parámetros en la URL: confirmación al API en curso. */
  const [epaycoReturnBusy, setEpaycoReturnBusy] = useState(false);

  const loadSaasFe = useCallback(() => {
    if (authScope !== 'tenant') return;
    setSaasFeLoadError(null);
    void fetchLatestSaasFe()
      .then(setSaasFe)
      .catch(() => {
        setSaasFe(null);
        setSaasFeLoadError('No se pudo cargar el estado de la factura de licencia. Intente actualizar.');
      });
  }, [authScope]);

  useEffect(() => {
    loadSaasFe();
  }, [loadSaasFe]);

  useEffect(() => {
    if (u?.tenant_sedes_totales) {
      setSedes(u.tenant_sedes_totales);
    }
  }, [u?.tenant_sedes_totales]);

  useEffect(() => {
    if (authScope !== 'tenant' || !sessionFromUrl) {
      return;
    }
    const withEpayco = hasEpaycoReturnParams(searchParams);
    const flowKey = withEpayco
      ? `c:${sessionFromUrl}?${searchParams.toString()}`
      : `r:${sessionFromUrl}`;
    if (epaycoReturnUrlHandled.has(flowKey)) {
      return;
    }
    epaycoReturnUrlHandled.add(flowKey);

    const go = async () => {
      if (withEpayco) {
        setEpaycoReturnBusy(true);
        try {
          const r = await confirmTenantCheckoutReturn(
            buildConfirmBodyFromQuery(sessionFromUrl, searchParams)
          );
          if (r?.ok) {
            await refreshTenantUser();
            loadSaasFe();
          } else if (r?.reason) {
            setErr(
              r.reason === 'not_approved'
                ? 'El pago no quedó aprobado. Si ya pagó, verifique con soporte o intente de nuevo.'
                : r.reason === 'amount_mismatch'
                  ? 'El monto no coincide con la cotización. Contacte a soporte con el comprobante de pago.'
                  : 'No se pudo completar el registro del pago en este momento.'
            );
            await refreshTenantUser();
            loadSaasFe();
          }
        } catch (e: unknown) {
          const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setErr(
            typeof d === 'string'
              ? d
              : 'No se pudo confirmar el pago. Si abonó, el aviso al servidor puede demorar; actualice o contacte a soporte.'
          );
          await refreshTenantUser();
          loadSaasFe();
        } finally {
          setEpaycoReturnBusy(false);
        }
        return;
      }
      await refreshTenantUser();
      loadSaasFe();
    };
    void go();
  }, [authScope, sessionFromUrl, searchParams, refreshTenantUser, loadSaasFe]);

  useEffect(() => {
    void listTenantPlans()
      .then((p) => {
        setPlans(p);
        if (p.length) {
          setPlanCode((prev) => (p.some((x) => x.code === prev) ? prev : p[0].code));
        }
      })
      .catch(() => setErr('No se pudo cargar los planes.'));
  }, []);

  useEffect(() => {
    if (!planCode) return;
    setLoading(true);
    void quoteTenantPlan(planCode, sedes)
      .then(setQuote)
      .catch((e) => setErr(e?.response?.data?.detail ?? 'Error al cotizar'))
      .finally(() => setLoading(false));
  }, [planCode, sedes]);

  useEffect(() => {
    if (!quote) return;
    setQuotePulse(true);
    const timer = window.setTimeout(() => setQuotePulse(false), 1200);
    return () => window.clearTimeout(timer);
  }, [quote?.total, quote?.subtotal, quote?.iva, quote?.sedes_totales, quote?.chargeable_additional_branches]);

  const isAdmin = u?.rol === 'administrador';
  const canRetrySaasFe = isAdmin && Boolean(saasFe?.session_id) && (saasFe?.saas_fe_status || '') !== 'ok';

  const retrySaasFe = async () => {
    if (!saasFe?.session_id || retryFeBusy) return;
    setRetryFeBusy(true);
    setErr(null);
    try {
      const out = await retrySaasFactusEmission(saasFe.session_id);
      setSaasFe(out);
      await refreshTenantUser();
      loadSaasFe();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(typeof detail === 'string' ? detail : 'No se pudo reintentar la emisión de la factura electrónica.');
    } finally {
      setRetryFeBusy(false);
    }
  };

  return (
    <div className="corporate-shell">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="section-card p-6 sm:p-7 mb-6 border-brand-200 bg-gradient-to-r from-white via-brand-50/50 to-indigo-50/50 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4 sm:gap-5">
              <img
                src={brand.logoSrc}
                alt={brand.nombreComercial}
                className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl border border-slate-200 bg-white object-contain p-2.5 shadow-sm"
              />
              <div>
                <h1 className="text-2xl sm:text-[2rem] font-bold text-slate-900 tracking-tight">
                  Planes y pago
                  <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-brand-500 align-middle" aria-hidden />
                </h1>
                <p className="mt-2 text-sm text-slate-700 max-w-2xl leading-relaxed">
                  Elija el periodo de su licencia, indique cuántas sedes tendrá (principal + anexas) y pague con la
                  pasarela. El precio base cubre <strong>2 sedes</strong> (matriz y 1 anexa); a partir de la{' '}
                  <strong>3.ª</strong> se aplica la tarifa de sucursal adicional de cada plan.
                </p>
              </div>
            </div>
            <Link
              to="/dashboard"
              className="btn-chip shrink-0 border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:text-slate-900"
            >
              Volver al panel
            </Link>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
              <ShieldCheck className="h-3.5 w-3.5" />
              Pago seguro con ePayco
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-medium text-indigo-800">
              <BadgeCheck className="h-3.5 w-3.5" />
              Factura electrónica de licencia
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-800">
              <Building2 className="h-3.5 w-3.5" />
              Cálculo por sedes con IVA incluido en total
            </span>
          </div>
        </div>

        {authScope !== 'tenant' && (
          <p className="text-sm text-amber-800">Inicia sesión en el módulo CDA para contratar un plan.</p>
        )}

        {err && <p className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{err}</p>}
        {saasFeLoadError && (
          <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">{saasFeLoadError}</p>
        )}

        {authScope === 'tenant' && saasFe?.session_id && (
          <div className="section-card p-4 sm:p-5 mb-6 text-sm text-slate-800">
            <h2 className="text-base font-semibold text-slate-900">
              Factura de licencia
              <span className="block text-sm font-medium text-slate-700">(emisor PROMETHEUS TECH SAS NIT 902.057.790-8)</span>
            </h2>
            {saasFe.plan_code && <p className="mt-2">Plan: {saasFe.plan_code}</p>}
            {typeof saasFe.total_cop === 'number' && <p>Total abonado: {fmtCop(saasFe.total_cop)}</p>}
            <p className="mt-2">
              <span className="font-medium">Estado DIAN (Factus licencia):</span>{' '}
              {saasFeStatusLabel(saasFe.saas_fe_status, saasFe.saas_fe_error, saasFe.saas_fe_error_category)}
            </p>
            {saasFe.saas_fe_reference_code && (
              <p className="mt-1 text-xs text-slate-600">
                Referencia de soporte Factus: <span className="font-mono">{saasFe.saas_fe_reference_code}</span>
              </p>
            )}
            {saasFe.numero_documento && (
              <p className="mt-1">
                No. {saasFe.numero_documento}
                {saasFe.cufe && <span className="ml-2 text-xs text-slate-600">CUFE: {saasFe.cufe}</span>}
              </p>
            )}
            {saasFe.public_url && (
              <a
                href={saasFe.public_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-brand-600 font-medium hover:underline"
              >
                Abrir comprobante (Factus)
              </a>
            )}
            {saasFe.saas_fe_error_category === 'pending_dian' || isPendingDianFactusError(saasFe.saas_fe_error) ? (
              <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
                Estamos validando tu factura electrónica. Este proceso puede tardar unos minutos. La factura electrónica
                llegará al correo de su CDA.
              </p>
            ) : (
              saasFe.saas_fe_error && (
                <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950 whitespace-pre-wrap">
                  {saasFe.saas_fe_error}
                </p>
              )
            )}
            {canRetrySaasFe && (
              <div className="mt-3">
                <button
                  type="button"
                  className="btn-chip"
                  disabled={retryFeBusy}
                  onClick={() => {
                    void retrySaasFe();
                  }}
                >
                  {retryFeBusy ? 'Reintentando…' : 'Reintentar emisión FE'}
                </button>
              </div>
            )}
          </div>
        )}

        {sessionFromUrl && (
          <div className="mb-3 text-sm text-slate-600">
            <p>Sesión de pago: {sessionFromUrl}</p>
            {epaycoReturnBusy && hasEpaycoReturnParams(searchParams) && (
              <p className="mt-1.5 flex items-center gap-2 text-slate-700">
                <span
                  className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
                  aria-hidden
                />
                <span>Sincronizando con el servidor…</span>
              </p>
            )}
          </div>
        )}

        {authScope === 'tenant' && plans.length > 0 && (
          <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50/80 p-4 text-sm text-slate-800 shadow-sm">
            <p className="font-medium text-sky-950">Cómo se calculan las sedes</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sky-900/90">
              <li>El <strong>precio base</strong> incluye <strong>2 sedes</strong>: la principal y <strong>1 anexa</strong>.</li>
              <li>Si el CDA opera con 3 o más sedes, cada una <strong>desde la 3.ª</strong> suma el valor de &quot;sucursal
                adicional&quot; del plan elegido (más IVA sobre el subtotal).</li>
            </ul>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((p) => {
            const m = planMarketing(p.code);
            const v = PLAN_VISUAL[p.code] ?? PLAN_VISUAL.basico;
            const isSelected = planCode === p.code;
            return (
              <button
                type="button"
                key={p.code}
                onClick={() => {
                  setPlanCode(p.code);
                  setErr(null);
                }}
                className={`section-card group relative flex h-full flex-col overflow-hidden p-4 sm:p-5 text-left transition-all duration-200 ${
                  isSelected
                    ? `border-white ring-2 ${v.selectedRingClass} ${v.selectedGlowClass} shadow-xl -translate-y-1 scale-[1.02] bg-white`
                    : 'hover:shadow-xl hover:-translate-y-1 hover:scale-[1.01] bg-white'
                }`}
              >
                <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${v.topBar}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{p.label}</div>
                  {m.badge && (
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${v.badgeClass}`}>
                      {m.badge}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-snug text-slate-700">{m.blurb}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-xs text-slate-600">
                  {m.bullets.map((b, i) => (
                    <li key={`${p.code}-${i}`} className="flex gap-1.5">
                      <span className={`mt-0.5 shrink-0 ${v.bulletDotClass}`} aria-hidden>
                        ·
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="text-lg font-semibold text-slate-900">
                    {fmtCop(p.base_price)} <span className="text-sm font-normal text-slate-500">+ IVA / {p.duration_days} d</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    3.ª sede en adelante: <span className="font-medium text-slate-800">{fmtCop(p.additional_branch_price)}</span> c/u
                    + IVA
                  </p>
                  {p.is_prepay && (
                    <p className="mt-1 text-[11px] font-semibold text-brand-800">Prepago del periodo completo</p>
                  )}
                  <div className="mt-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                        isSelected ? v.ctaClass : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {isSelected ? 'Plan seleccionado' : 'Elegir este plan'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[1.3fr,1fr] md:items-start">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
                <Calculator className="h-3.5 w-3.5" />
                Configuración del periodo
              </p>
              <label className="mt-3 block text-sm font-semibold text-slate-800">
                Sedes totales a contratar (incluye la sede principal)
              </label>
              <p className="mt-1 text-xs text-slate-500">
                El número registrado al crear el CDA se usa como referencia; cámbielo si va a operar con más o menos sedes en este
                periodo.
              </p>
              <input
                type="number"
                min={1}
                max={100}
                className="mt-3 w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-semibold text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                value={sedes}
                onChange={(e) => setSedes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-3">
              {quote && (
                <div
                  className={`rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50/60 to-indigo-50/40 p-4 transition-all duration-300 ${
                    quotePulse ? 'scale-[1.01] ring-2 ring-brand-200 shadow-md' : ''
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Resumen estimado</p>
                  <div className="mt-2 grid gap-2 text-sm">
                    <p className="flex items-baseline justify-between rounded-lg bg-white/80 px-3 py-2">
                      <span className="font-medium text-slate-600">Subtotal</span>
                      <span className="font-semibold text-slate-900">{fmtCop(quote.subtotal)}</span>
                    </p>
                    <p className="flex items-baseline justify-between rounded-lg bg-white/80 px-3 py-2">
                      <span className="font-medium text-slate-600">IVA</span>
                      <span className="font-semibold text-slate-900">{fmtCop(quote.iva)}</span>
                    </p>
                    <p className="flex items-baseline justify-between rounded-lg border border-brand-200 bg-white px-3 py-2.5">
                      <span className="font-semibold text-slate-700">Total aprox.</span>
                      <span
                        className={`text-lg font-bold text-brand-800 transition-all duration-300 ${quotePulse ? 'scale-105' : ''}`}
                      >
                        {fmtCop(quote.total)}
                      </span>
                    </p>
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <button
                    type="button"
                    disabled={loading || isPaying || !quote}
                    onClick={async () => {
                      setErr(null);
                      setInitResult(null);
                      setIsPaying(true);
                      try {
                        const r = await initTenantPayment(planCode, sedes);
                        if (r.mode === 'smart_checkout' && r.epayco_session_id) {
                          await loadEpaycoCheckoutV2Script();
                          openEpaycoSmartCheckout(r.epayco_session_id, r.epayco_checkout_test ?? true, () => {
                            void refreshTenantUser();
                            loadSaasFe();
                          });
                          return;
                        }
                        if (r.mode === 'redirect' && r.redirect_url) {
                          window.location.assign(r.redirect_url);
                          return;
                        }
                        if (r.mode === 'mock') {
                          setInitResult(r.message ?? 'Modo mock: complete el pago con el botón de abajo.');
                          return;
                        }
                        setInitResult(r.message ?? 'Configure EPAYCO_PUBLIC_KEY o use backoffice para registrar pago.');
                      } catch (e: unknown) {
                        const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                        setErr(typeof d === 'string' ? d : 'No se pudo iniciar el pago');
                      } finally {
                        setIsPaying(false);
                      }
                    }}
                    className={`btn-corporate-primary w-full px-8 py-3 shadow-md shadow-brand-900/10 transition-all duration-300 hover:shadow-lg ${
                      quote && quotePulse
                        ? 'animate-pulse ring-4 ring-brand-200/80 shadow-2xl shadow-brand-400/35 scale-[1.03] -translate-y-0.5'
                        : ''
                    } hover:-translate-y-0.5 hover:scale-[1.02] hover:brightness-110 hover:shadow-2xl hover:shadow-brand-500/30 active:translate-y-0 active:scale-[1.01]`}
                  >
                    {isPaying ? 'Abriendo pasarela…' : loading ? 'Calculando total…' : 'Continuar a pago seguro'}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-slate-500">Pago procesado por ePayco · Conexión segura.</p>
                  {initResult && <p className="mt-2 text-sm text-slate-600">{initResult}</p>}
                  {searchParams.get('session') && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={async () => {
                          setErr(null);
                          try {
                            await completeTenantCheckoutMock(searchParams.get('session')!);
                            await refreshTenantUser();
                            loadSaasFe();
                            setInitResult(
                              'Pago simulado correctamente. Puede ver el estado de la factura de licencia arriba. Redirigiendo al panel…'
                            );
                            setTimeout(() => {
                              window.location.href = '/dashboard';
                            }, 2000);
                          } catch (e: unknown) {
                            const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                            setErr(typeof d === 'string' ? d : 'Error al completar (mock)');
                          }
                        }}
                        className="btn-corporate-muted w-full border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100/80"
                      >
                        Completar pago (solo desarrollo)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {quote && (
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              El precio base cubre <strong>2 sedes</strong> (matriz + 1 anexa). Usted indica <strong>{quote.sedes_totales}</strong>{' '}
              sede(s) en total, así que <strong>{quote.chargeable_additional_branches}</strong> sede(s) se suman a la tarifa de
              sucursal adicional (la 3.ª, 4.ª, etc., según corresponda).
            </p>
          )}
        </div>

        {!isAdmin && (
          <p className="mt-4 text-sm text-slate-600">Solo el administrador del CDA puede iniciar el pago en línea.</p>
        )}
      </div>
    </div>
  );
}
