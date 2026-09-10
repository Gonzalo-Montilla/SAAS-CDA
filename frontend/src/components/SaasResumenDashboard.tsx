import {
  AlertTriangle,
  Building2,
  LifeBuoy,
  Wallet,
  ArrowRight,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BackofficeSectionHeading } from './BackofficeSectionHeading';
import type {
  SaaSBillingOverviewItem,
  SaaSSupportSummary,
  SaaSSupportTicketItem,
  SaaSTenantSummary,
} from '../types';

const COBRO_CHART: Array<{ key: string; name: string; color: string }> = [
  { key: 'al_dia', name: 'Al día', color: '#059669' },
  { key: 'por_vencer', name: 'Por vencer', color: '#0284c7' },
  { key: 'vencido', name: 'Vencido', color: '#d97706' },
  { key: 'trial', name: 'Demo', color: '#6366f1' },
  { key: 'en_gracia', name: 'En gracia', color: '#f59e0b' },
  { key: 'bloqueado', name: 'Bloqueado', color: '#e11d48' },
  { key: 'sin_fecha', name: 'Sin fecha', color: '#64748b' },
];

function isSlaOverdue(ticket: Pick<SaaSSupportTicketItem, 'sla_due_at' | 'status'>): boolean {
  if (!ticket.sla_due_at) return false;
  if (ticket.status !== 'abierto' && ticket.status !== 'en_progreso') return false;
  return new Date(ticket.sla_due_at).getTime() < Date.now();
}

type SaasResumenDashboardProps = {
  tenants: SaaSTenantSummary[] | undefined;
  tenantsLoading: boolean;
  billing: SaaSBillingOverviewItem[] | undefined;
  billingLoading: boolean;
  billingError: boolean;
  canReadBilling: boolean;
  support: SaaSSupportSummary | undefined;
  supportLoading: boolean;
  canReadSupport: boolean;
  usersCount: number | null;
  formatCurrency: (value: number) => string;
  formatDate: (value?: string | null, empty?: string) => string;
  formatDateTime: (value?: string | null, empty?: string) => string;
  cobroStatusLabel: (status: string) => string;
  statusBadgeClass: (status: string) => string;
  supportStatusLabel: (status: string) => string;
  supportPriorityBadgeClass: (priority: string) => string;
  lastPaymentSourceLabel: (source?: string | null) => string;
  onOpenFacturacion: () => void;
  onOpenSoporte: () => void;
  onOpenTenants: () => void;
  onOpenTenant: (tenantId: string) => void;
};

export function SaasResumenDashboard({
  tenants,
  tenantsLoading,
  billing,
  billingLoading,
  billingError,
  canReadBilling,
  support,
  supportLoading,
  canReadSupport,
  usersCount,
  formatCurrency,
  formatDate,
  formatDateTime,
  cobroStatusLabel,
  statusBadgeClass,
  supportStatusLabel,
  supportPriorityBadgeClass,
  lastPaymentSourceLabel,
  onOpenFacturacion,
  onOpenSoporte,
  onOpenTenants,
  onOpenTenant,
}: SaasResumenDashboardProps) {
  const tenantsTotal = tenants?.length ?? (billing?.length ?? 0);
  const tenantsActive = tenants?.filter((t) => t.activo).length;
  const cobroByStatus = COBRO_CHART.map((item) => ({
    ...item,
    value: (billing || []).filter((row) => row.cobro_status === item.key).length,
  }));
  const cobroCounts = cobroByStatus.filter((item) => item.value > 0);
  const alDia = cobroByStatus.find((item) => item.key === 'al_dia')?.value ?? 0;
  const vencidos = (billing || []).filter((row) => row.cobro_status === 'vencido' || row.cobro_status === 'bloqueado');
  const porVencer = (billing || []).filter((row) => row.cobro_status === 'por_vencer');
  const recentPayments = [...(billing || [])]
    .filter((row) => row.last_payment_at)
    .sort((a, b) => new Date(b.last_payment_at || 0).getTime() - new Date(a.last_payment_at || 0).getTime())
    .slice(0, 6);
  const attentionTickets = support?.attention_tickets || [];
  const slaVencidos = support?.sla_vencidos ?? 0;
  const sinAsignar = support?.sin_asignar ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <button type="button" className="kpi-card text-left" onClick={onOpenTenants}>
          <p className="kpi-label">CDAs</p>
          <p className="kpi-value">{tenantsLoading && !billing ? '…' : tenantsTotal}</p>
          <p className="mt-1 text-xs text-slate-500">
            {tenantsActive == null ? 'CDAs en plataforma' : `${tenantsActive} con acceso activo`}
          </p>
        </button>
        <button type="button" className="kpi-card text-left" onClick={canReadBilling ? onOpenFacturacion : undefined}>
          <p className="kpi-label">Cobro al día</p>
          <p className="kpi-value text-emerald-700">
            {canReadBilling ? (billingLoading ? '…' : alDia) : '—'}
          </p>
        </button>
        <button type="button" className="kpi-card text-left" onClick={canReadBilling ? onOpenFacturacion : undefined}>
          <p className="kpi-label">Por vencer / vencido</p>
          <p className="kpi-value text-amber-700">
            {canReadBilling ? (billingLoading ? '…' : porVencer.length + vencidos.length) : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {porVencer.length} por vencer · {vencidos.length} vencido{vencidos.length === 1 ? '' : 's'}
          </p>
        </button>
        <button type="button" className="kpi-card text-left" onClick={canReadSupport ? onOpenSoporte : undefined}>
          <p className="kpi-label">Tickets abiertos</p>
          <p className="kpi-value text-cyan-800">
            {canReadSupport ? (supportLoading ? '…' : support?.sin_resolver ?? 0) : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">{support?.criticos_abiertos ?? 0} críticos</p>
        </button>
        <div className="kpi-card">
          <p className="kpi-label">SLA vencido</p>
          <p className={`kpi-value ${slaVencidos > 0 ? 'text-red-700' : 'text-slate-900'}`}>
            {canReadSupport ? (supportLoading ? '…' : slaVencidos) : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">{sinAsignar} sin asignar</p>
        </div>
        <div className="kpi-card">
          <p className="kpi-label">Usuarios SaaS</p>
          <p className="kpi-value">{usersCount == null ? '—' : usersCount}</p>
          <p className="mt-1 text-xs text-slate-500">Equipo interno</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="section-card p-5 xl:col-span-2">
          <BackofficeSectionHeading
            className="mb-3"
            icon={Wallet}
            title="Estado de cobro"
            description="Cuántos CDAs están al día, por vencer o vencidos"
            right={
              canReadBilling ? (
                <button type="button" className="btn-chip py-1 text-[11px]" onClick={onOpenFacturacion}>
                  Ir a Facturación
                  <ArrowRight className="ml-1 h-3 w-3" />
                </button>
              ) : null
            }
          />
          {!canReadBilling && !billingLoading && (
            <p className="text-sm text-slate-500">Tu rol no incluye el resumen de cobro.</p>
          )}
          {canReadBilling && billingLoading && <p className="text-sm text-slate-500">Cargando cobro…</p>}
          {canReadBilling && billingError && (
            <p className="text-sm text-red-600">No fue posible cargar el estado de cobro.</p>
          )}
          {canReadBilling && !billingLoading && cobroCounts.length === 0 && (
            <p className="text-sm text-slate-500">Aún no hay tenants para graficar.</p>
          )}
          {canReadBilling && cobroCounts.length > 0 && (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cobroCounts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip formatter={(value) => [`${Number(value ?? 0)} CDA(s)`, 'Cantidad']} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {cobroCounts.map((item) => (
                      <Cell key={item.key} fill={item.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="section-card p-5 xl:col-span-3">
          <BackofficeSectionHeading
            className="mb-3"
            icon={AlertTriangle}
            title="Atención de cobro"
            description="CDAs vencidos o por vencer en los próximos 5 días"
            right={
              canReadBilling ? (
                <button type="button" className="btn-chip py-1 text-[11px]" onClick={onOpenFacturacion}>
                  Ver todos
                </button>
              ) : null
            }
          />
          {canReadBilling && (vencidos.length > 0 || porVencer.length > 0) ? (
            <div className="table-shell">
              <table className="table-enterprise">
                <thead>
                  <tr>
                    <th>CDA</th>
                    <th>Estado</th>
                    <th>Próx. cobro</th>
                    <th>Último pago</th>
                  </tr>
                </thead>
                <tbody>
                  {[...vencidos, ...porVencer].slice(0, 8).map((item) => (
                    <tr key={item.tenant_id}>
                      <td>
                        <button
                          type="button"
                          className="font-semibold text-slate-900 hover:underline"
                          onClick={() => onOpenTenant(item.tenant_id)}
                        >
                          {item.tenant_nombre}
                        </button>
                        <p className="text-[11px] text-slate-500">/{item.tenant_slug}</p>
                      </td>
                      <td>
                        <span className={statusBadgeClass(item.cobro_status)}>{cobroStatusLabel(item.cobro_status)}</span>
                      </td>
                      <td>{formatDate(item.next_billing_at)}</td>
                      <td>
                        {item.last_payment_amount != null
                          ? `${formatCurrency(item.last_payment_amount)} · ${formatDate(item.last_payment_at)}`
                          : formatDate(item.last_payment_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {canReadBilling ? 'Ningún CDA está vencido ni por vencer.' : 'Sin datos de cobro para este rol.'}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="section-card p-5">
          <BackofficeSectionHeading
            className="mb-3"
            icon={LifeBuoy}
            title="Cola de soporte"
            description="Críticos, SLA vencido y sin asignar primero"
            right={
              canReadSupport ? (
                <button type="button" className="btn-chip py-1 text-[11px]" onClick={onOpenSoporte}>
                  Ir a Soporte
                </button>
              ) : null
            }
          />
          {!canReadSupport && !supportLoading && <p className="text-sm text-slate-500">Tu rol no incluye tickets.</p>}
          {canReadSupport && supportLoading && <p className="text-sm text-slate-500">Cargando tickets…</p>}
          {canReadSupport && !supportLoading && attentionTickets.length === 0 && (
            <p className="text-sm text-slate-500">No hay tickets abiertos.</p>
          )}
          {canReadSupport && attentionTickets.length > 0 && (
            <ul className="space-y-2">
              {attentionTickets.map((ticket) => (
                <li key={ticket.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={supportPriorityBadgeClass(ticket.priority)}>{ticket.priority}</span>
                    <span className={statusBadgeClass(ticket.status)}>{supportStatusLabel(ticket.status)}</span>
                    {isSlaOverdue(ticket) && (
                      <span className="badge badge-danger">SLA vencido</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{ticket.title}</p>
                  <p className="text-xs text-slate-500">
                    {ticket.tenant_nombre} · {formatDateTime(ticket.created_at)}
                    {ticket.assigned_to_user_email ? ` · ${ticket.assigned_to_user_email}` : ' · sin asignar'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="section-card p-5">
          <BackofficeSectionHeading
            className="mb-3"
            icon={Building2}
            title="Últimos pagos"
            description="Monto y canal del movimiento más reciente por CDA"
          />
          {canReadBilling && recentPayments.length > 0 ? (
            <div className="table-shell">
              <table className="table-enterprise">
                <thead>
                  <tr>
                    <th>CDA</th>
                    <th>Monto</th>
                    <th>Fecha</th>
                    <th>Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((item) => (
                    <tr key={item.tenant_id}>
                      <td className="font-semibold text-slate-900">{item.tenant_nombre}</td>
                      <td>
                        {item.last_payment_amount != null ? formatCurrency(item.last_payment_amount) : '—'}
                      </td>
                      <td>{formatDate(item.last_payment_at)}</td>
                      <td className="text-xs text-slate-600">
                        {lastPaymentSourceLabel(item.last_payment_source) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {canReadBilling ? 'Todavía no hay pagos para mostrar.' : 'Sin datos de pagos para este rol.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export { isSlaOverdue };
