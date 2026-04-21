import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
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
  const [feBusy, setFeBusy] = useState(false);
  /** Retorno ePayco con parámetros en la URL: confirmación al API en curso. */
  const [epaycoReturnBusy, setEpaycoReturnBusy] = useState(false);

  const loadSaasFe = useCallback(() => {
    if (authScope !== 'tenant') return;
    void fetchLatestSaasFe()
      .then(setSaasFe)
      .catch(() => setSaasFe(null));
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

  const isAdmin = u?.rol === 'administrador';

  return (
    <div className="corporate-shell">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="section-card p-5 sm:p-6 mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Planes y pago</h1>
            <p className="mt-2 text-sm text-slate-600 max-w-2xl leading-relaxed">
              Elija el periodo de su licencia, indique cuántas sedes tendrá (principal + anexas) y pague con la pasarela. El
              precio base cubre <strong>2 sedes</strong> (matriz y 1 anexa); a partir de la <strong>3.ª</strong> se aplica
              la tarifa de sucursal adicional de cada plan.
            </p>
          </div>
          <Link
            to="/dashboard"
            className="text-sm font-medium text-brand-600 hover:text-brand-800 hover:underline shrink-0"
          >
            Volver al panel
          </Link>
        </div>

        {authScope !== 'tenant' && (
          <p className="text-sm text-amber-800">Inicia sesión en el módulo CDA para contratar un plan.</p>
        )}

        {err && <p className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{err}</p>}

        {authScope === 'tenant' && saasFe?.session_id && (
          <div className="section-card p-4 sm:p-5 mb-6 text-sm text-slate-800">
            <h2 className="text-base font-semibold text-slate-900">Factura de licencia (emisor PROMETHEUS)</h2>
            <p className="mt-1 text-xs text-slate-500">
              Distinta a la conexión Factus que configura su CDA para facturar a terceros.
            </p>
            {saasFe.plan_code && <p className="mt-2">Plan: {saasFe.plan_code}</p>}
            {typeof saasFe.total_cop === 'number' && <p>Total abonado: {fmtCop(saasFe.total_cop)}</p>}
            <p className="mt-2">
              <span className="font-medium">Estado DIAN (Factus licencia):</span>{' '}
              {saasFe.saas_fe_status ?? '—'}
            </p>
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
            {saasFe.saas_fe_error && (
              <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950 whitespace-pre-wrap">
                {saasFe.saas_fe_error}
              </p>
            )}
            {isAdmin &&
              (saasFe.saas_fe_status === 'error' || saasFe.saas_fe_status === 'skipped') &&
              saasFe.session_id && (
                <button
                  type="button"
                  disabled={feBusy}
                  onClick={async () => {
                    setFeBusy(true);
                    setErr(null);
                    try {
                      const o = await retrySaasFactusEmission(saasFe.session_id!);
                      setSaasFe(o);
                    } catch (e: unknown) {
                      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                      setErr(typeof d === 'string' ? d : 'No se pudo reintentar la emisión');
                    } finally {
                      setFeBusy(false);
                    }
                  }}
                  className="mt-3 btn-corporate-muted text-xs"
                >
                  {feBusy ? 'Reintentando…' : 'Reintentar factura electrónica'}
                </button>
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
          <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50/80 p-4 text-sm text-slate-800">
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
            return (
              <button
                type="button"
                key={p.code}
                onClick={() => {
                  setPlanCode(p.code);
                  setErr(null);
                }}
                className={`section-card flex h-full flex-col p-4 sm:p-5 text-left transition ${
                  planCode === p.code
                    ? 'ring-2 ring-brand-500 border-brand-200 shadow-panel'
                    : 'hover:shadow-md'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{p.label}</div>
                  {m.badge && (
                    <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800">
                      {m.badge}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-snug text-slate-700">{m.blurb}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-xs text-slate-600">
                  {m.bullets.map((b, i) => (
                    <li key={`${p.code}-${i}`} className="flex gap-1.5">
                      <span className="mt-0.5 shrink-0 text-brand-500" aria-hidden>
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
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <label className="text-sm font-medium text-slate-800">Sedes totales a contratar (incluye la sede principal)</label>
          <p className="mt-0.5 text-xs text-slate-500">
            El número que registró al dar de alta el CDA se sugiere solo; cámbielo si va a operar con más o menos sedes en este
            periodo.
          </p>
          <input
            type="number"
            min={1}
            max={100}
            className="mt-2 w-32 rounded border border-slate-300 px-2 py-1"
            value={sedes}
            onChange={(e) => setSedes(Math.max(1, parseInt(e.target.value, 10) || 1))}
            disabled={!isAdmin}
          />
          {quote && (
            <div className="mt-4 space-y-2 text-sm text-slate-800">
              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                El precio base cubre <strong>2 sedes</strong> (matriz + 1 anexa). Usted indica <strong>{quote.sedes_totales}</strong>{' '}
                sede(s) en total, así que <strong>{quote.chargeable_additional_branches}</strong> sede(s) se suman a la tarifa
                de sucursal adicional (la 3.ª, 4.ª, etc., según corresponda).
              </p>
              <p>
                <strong>Subtotal:</strong> {fmtCop(quote.subtotal)} &nbsp; <strong>IVA:</strong> {fmtCop(quote.iva)} &nbsp;{' '}
                <strong>Total aprox.:</strong> {fmtCop(quote.total)}
              </p>
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="mt-8">
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setErr(null);
                setInitResult(null);
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
                }
              }}
              className="px-8 btn-corporate-primary"
            >
              {loading ? 'Cargando…' : 'Ir a pasarela de pago'}
            </button>
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
                      setInitResult('Pago simulado correctamente. Puede ver el estado de la factura de licencia arriba. Redirigiendo al panel…');
                      setTimeout(() => {
                        window.location.href = '/dashboard';
                      }, 2000);
                    } catch (e: unknown) {
                      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                      setErr(typeof d === 'string' ? d : 'Error al completar (mock)');
                    }
                  }}
                  className="btn-corporate-muted border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100/80"
                >
                  Completar pago (solo desarrollo)
                </button>
              </div>
            )}
          </div>
        )}

        {!isAdmin && (
          <p className="mt-4 text-sm text-slate-600">Solo el administrador del CDA puede iniciar el pago en línea.</p>
        )}
      </div>
    </div>
  );
}
