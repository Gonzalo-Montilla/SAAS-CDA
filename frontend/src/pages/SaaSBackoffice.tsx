import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, LogOut, Users, Copy, Check, Building2, Shield, FileClock, Wallet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';
import { useState } from 'react';
import type {
  SaaSAuditLogItem,
  SaaSBillingPlanItem,
  SaaSBillingOverviewItem,
  SaaSPaymentRegisteredResponse,
  SaaSPaymentHistoryItem,
  SaaSSecuritySummary,
  SaaSTenantProfile,
  SaaSTenantBillingQuote,
  SaaSTenantSummary,
  SaaSUser,
  SaaSUserSecurityItem,
} from '../types';
import logoCdaSoft from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';

interface SaaSPermissionsResponse {
  role: 'owner' | 'finanzas' | 'comercial' | 'soporte';
  permissions: string[];
}

type BackofficeModule = 'resumen' | 'tenants' | 'facturacion' | 'usuarios' | 'auditoria' | 'seguridad';

export default function SaaSBackoffice() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copiedTenantId, setCopiedTenantId] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<BackofficeModule>('resumen');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [createUserError, setCreateUserError] = useState('');
  const [createUserSuccess, setCreateUserSuccess] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'owner' | 'finanzas' | 'comercial' | 'soporte'>('soporte');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditActorFilter, setAuditActorFilter] = useState('');
  const [auditTenantFilter, setAuditTenantFilter] = useState('');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');
  const [securityActionError, setSecurityActionError] = useState('');
  const [securityActionSuccess, setSecurityActionSuccess] = useState('');
  const [billingTenantId, setBillingTenantId] = useState('');
  const [billingPlanCode, setBillingPlanCode] = useState('basico');
  const [billingSedesTotales, setBillingSedesTotales] = useState(1);
  const [billingActionError, setBillingActionError] = useState('');
  const [billingActionSuccess, setBillingActionSuccess] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [lastPaymentReceipt, setLastPaymentReceipt] = useState<SaaSPaymentRegisteredResponse | null>(null);
  const [resentPaymentLogId, setResentPaymentLogId] = useState<string | null>(null);

  const formatAmountForInput = (amount: number): string => {
    if (!Number.isFinite(amount)) {
      return '';
    }
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  };

  const subscriptionStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      active: 'Activa',
      trial: 'Demo',
      past_due: 'Vencida',
      pending_plan: 'Pendiente de plan',
      canceled: 'Cancelada',
    };
    return labels[status] || status;
  };

  const cobroStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      al_dia: 'Al día',
      por_vencer: 'Por vencer',
      trial: 'Demo',
      vencido: 'Vencido',
    };
    return labels[status] || status;
  };

  const statusBadgeClass = (status: string): string => {
    if (status === 'active' || status === 'al_dia' || status === 'success') {
      return 'badge badge-success';
    }
    if (status === 'trial' || status === 'demo' || status === 'por_vencer') {
      return 'badge badge-info';
    }
    if (status === 'past_due' || status === 'pending_plan' || status === 'vencido') {
      return 'badge badge-warning';
    }
    if (status === 'failed' || status === 'canceled' || status === 'cancelada') {
      return 'badge badge-danger';
    }
    return 'badge bg-slate-100 text-slate-700';
  };

  const LoadingBlock = ({ lines = 3 }: { lines?: number }) => (
    <div className="space-y-2 py-2">
      {Array.from({ length: lines }).map((_, idx) => (
        <div
          key={`loading-line-${idx}`}
          className={`skeleton h-3 ${idx === lines - 1 ? 'w-1/2' : 'w-full'}`}
        />
      ))}
    </div>
  );

  const EmptyState = ({ message }: { message: string }) => (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-6 text-center text-sm text-slate-600">
      {message}
    </div>
  );

  const permissionsQuery = useQuery({
    queryKey: ['saas-permissions-me'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSPermissionsResponse>('/saas/auth/permissions/me');
      return response.data;
    },
  });

  const tenantsQuery = useQuery({
    queryKey: ['saas-tenants-list'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSTenantSummary[]>('/saas/auth/tenants');
      return response.data;
    },
  });

  const usersQuery = useQuery({
    queryKey: ['saas-users-list'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSUser[]>('/saas/auth/users');
      return response.data;
    },
    enabled: activeModule === 'usuarios',
  });

  const tenantProfileQuery = useQuery({
    queryKey: ['saas-tenant-profile', selectedTenantId],
    queryFn: async () => {
      const response = await apiClient.get<SaaSTenantProfile>(`/saas/auth/tenants/${selectedTenantId}`);
      return response.data;
    },
    enabled: !!selectedTenantId,
  });

  const billingOverviewQuery = useQuery({
    queryKey: ['saas-billing-overview'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSBillingOverviewItem[]>('/saas/auth/billing/overview');
      return response.data;
    },
    enabled: activeModule === 'facturacion',
  });

  const tenantPaymentsQuery = useQuery({
    queryKey: ['saas-tenant-payments', selectedTenantId],
    queryFn: async () => {
      const response = await apiClient.get<SaaSPaymentHistoryItem[]>(`/saas/auth/billing/tenant/${selectedTenantId}/payments?limit=10`);
      return response.data;
    },
    enabled: !!selectedTenantId,
  });

  const createSaaSUserMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/saas/auth/users', {
        email: newUserEmail.trim().toLowerCase(),
        nombre_completo: newUserName.trim(),
        rol_global: newUserRole,
        password: newUserPassword,
      });
      return response.data;
    },
    onSuccess: () => {
      setCreateUserError('');
      setCreateUserSuccess('Usuario SaaS creado exitosamente.');
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPassword('');
      queryClient.invalidateQueries({ queryKey: ['saas-users-list'] });
    },
    onError: (err: any) => {
      setCreateUserSuccess('');
      setCreateUserError(err?.response?.data?.detail || 'No fue posible crear el usuario SaaS. Intenta nuevamente.');
    },
  });

  const auditLogsQuery = useQuery({
    queryKey: ['saas-audit-logs', auditActionFilter, auditActorFilter, auditTenantFilter, auditDateFrom, auditDateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('limit', '100');
      if (auditActionFilter) {
        params.append('action', auditActionFilter);
      }
      if (auditActorFilter) {
        params.append('actor_email', auditActorFilter);
      }
      if (auditTenantFilter) {
        params.append('tenant_slug', auditTenantFilter);
      }
      if (auditDateFrom) {
        params.append('date_from', auditDateFrom);
      }
      if (auditDateTo) {
        params.append('date_to', auditDateTo);
      }
      const response = await apiClient.get<SaaSAuditLogItem[]>(`/saas/auth/audit-logs?${params.toString()}`);
      return response.data;
    },
    enabled: activeModule === 'auditoria',
  });

  const securitySummaryQuery = useQuery({
    queryKey: ['saas-security-summary'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSSecuritySummary>('/saas/auth/security/summary');
      return response.data;
    },
    enabled: activeModule === 'seguridad',
  });

  const securityUsersQuery = useQuery({
    queryKey: ['saas-security-users'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSUserSecurityItem[]>('/saas/auth/security/users');
      return response.data;
    },
    enabled: activeModule === 'seguridad',
  });

  const billingPlansQuery = useQuery({
    queryKey: ['saas-billing-plans'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSBillingPlanItem[]>('/saas/auth/billing/plans');
      return response.data;
    },
    enabled: activeModule === 'facturacion' || !!selectedTenantId,
  });

  const billingQuoteQuery = useQuery({
    queryKey: ['saas-billing-quote', billingTenantId, billingPlanCode, billingSedesTotales],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('plan_code', billingPlanCode);
      params.append('sedes_totales', String(billingSedesTotales));
      const response = await apiClient.get<SaaSTenantBillingQuote>(
        `/saas/auth/billing/quote/${billingTenantId}?${params.toString()}`,
      );
      return response.data;
    },
    enabled: !!billingTenantId && !!billingPlanCode && billingSedesTotales >= 1,
  });

  const toggleMfaMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiClient.post(`/saas/auth/security/users/${userId}/toggle-mfa`);
    },
    onSuccess: () => {
      setSecurityActionError('');
      setSecurityActionSuccess('Configuración MFA actualizada correctamente.');
      queryClient.invalidateQueries({ queryKey: ['saas-security-users'] });
      queryClient.invalidateQueries({ queryKey: ['saas-security-summary'] });
      queryClient.invalidateQueries({ queryKey: ['saas-users-list'] });
    },
    onError: (err: any) => {
      setSecurityActionSuccess('');
      setSecurityActionError(err?.response?.data?.detail || 'No fue posible actualizar MFA. Intenta nuevamente.');
    },
  });

  const unlockUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiClient.post(`/saas/auth/security/users/${userId}/unlock`);
    },
    onSuccess: () => {
      setSecurityActionError('');
      setSecurityActionSuccess('Usuario desbloqueado correctamente.');
      queryClient.invalidateQueries({ queryKey: ['saas-security-users'] });
      queryClient.invalidateQueries({ queryKey: ['saas-security-summary'] });
    },
    onError: (err: any) => {
      setSecurityActionSuccess('');
      setSecurityActionError(err?.response?.data?.detail || 'No fue posible desbloquear el usuario. Intenta nuevamente.');
    },
  });

  const assignPlanMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<SaaSTenantBillingQuote>(
        `/saas/auth/billing/assign-plan/${billingTenantId}`,
        {
          plan_code: billingPlanCode,
          sedes_totales: billingSedesTotales,
        },
      );
      return response.data;
    },
    onSuccess: (data) => {
      setBillingActionError('');
      setBillingActionSuccess(
        `Plan ${data.plan_label} asignado a /${data.tenant_slug}. Total periodo: ${data.total.toLocaleString('es-CO')}`,
      );
      setLastPaymentReceipt(null);
      setPaymentAmount(formatAmountForInput(data.total));
      if (!paymentNotes.trim()) {
        setPaymentNotes(`Pago periodo ${data.plan_label}`);
      }
      queryClient.invalidateQueries({ queryKey: ['saas-tenants-list'] });
      queryClient.invalidateQueries({ queryKey: ['saas-tenant-profile'] });
      queryClient.invalidateQueries({ queryKey: ['saas-billing-quote'] });
      queryClient.invalidateQueries({ queryKey: ['saas-billing-overview'] });
      queryClient.invalidateQueries({ queryKey: ['saas-tenant-payments'] });
    },
    onError: (err: any) => {
      setBillingActionSuccess('');
      setBillingActionError(err?.response?.data?.detail || 'No fue posible asignar el plan al tenant. Intenta nuevamente.');
    },
  });

  const registerPaymentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<SaaSPaymentRegisteredResponse>(
        `/saas/auth/billing/register-payment/${billingTenantId}`,
        {
          amount: Number(paymentAmount),
          notes: paymentNotes.trim() || null,
        },
      );
      return response.data;
    },
    onSuccess: (data) => {
      setBillingActionError('');
      setBillingActionSuccess(
        `Pago registrado para /${data.tenant_slug}. Próximo cobro: ${data.next_billing_at ? new Date(data.next_billing_at).toLocaleDateString() : 'N/A'}`,
      );
      setLastPaymentReceipt(data);
      setPaymentAmount('');
      setPaymentNotes('');
      queryClient.invalidateQueries({ queryKey: ['saas-tenants-list'] });
      queryClient.invalidateQueries({ queryKey: ['saas-tenant-profile'] });
      queryClient.invalidateQueries({ queryKey: ['saas-billing-quote'] });
      queryClient.invalidateQueries({ queryKey: ['saas-billing-overview'] });
      queryClient.invalidateQueries({ queryKey: ['saas-tenant-payments'] });
    },
    onError: (err: any) => {
      setBillingActionSuccess('');
      setBillingActionError(err?.response?.data?.detail || 'No fue posible registrar el pago. Intenta nuevamente.');
    },
  });

  const resendReceiptMutation = useMutation({
    mutationFn: async (paymentLogId: string) => {
      const response = await apiClient.post(`/saas/auth/billing/payments/${paymentLogId}/resend-receipt`);
      return response.data;
    },
    onSuccess: () => {
      setBillingActionError('');
      setBillingActionSuccess('Recibo reenviado correctamente al correo del CDA.');
      setResentPaymentLogId(resendReceiptMutation.variables || null);
      setTimeout(() => {
        setResentPaymentLogId((current) => (current === resendReceiptMutation.variables ? null : current));
      }, 2500);
    },
    onError: (err: any) => {
      setBillingActionSuccess('');
      setBillingActionError(err?.response?.data?.detail || 'No fue posible reenviar el recibo. Intenta nuevamente.');
    },
  });

  const handleLogout = () => {
    logout();
    navigate('/saas/login');
  };

  const handleCopyLoginUrl = async (tenantId: string, loginUrl: string) => {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopiedTenantId(tenantId);
      setTimeout(() => setCopiedTenantId(null), 2000);
    } catch (_error) {
      // Silencioso para no bloquear UX.
    }
  };

  const openTenantSheet = (tenant: SaaSTenantSummary) => {
    setSelectedTenantId(tenant.id);
    setBillingTenantId(tenant.id);
    setBillingSedesTotales(tenant.sedes_totales || 1);
    setBillingPlanCode((tenant.plan_actual || 'basico').toLowerCase());
    setLastPaymentReceipt(null);
    setBillingActionError('');
    setBillingActionSuccess('');
  };

  const handleDownloadReceipt = async (downloadUrl: string, reference?: string | null) => {
    const parsed = new URL(downloadUrl);
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    const apiPath = pathAndQuery.includes('/api/v1/')
      ? pathAndQuery.split('/api/v1/')[1]
      : pathAndQuery.replace(/^\//, '');
    const response = await apiClient.get(`/${apiPath}`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `recibo_${reference || Date.now()}.pdf`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleExportAuditCsv = async () => {
    const params = new URLSearchParams();
    params.append('limit', '200');
    if (auditActionFilter) {
      params.append('action', auditActionFilter);
    }
    if (auditActorFilter) {
      params.append('actor_email', auditActorFilter);
    }
    if (auditTenantFilter) {
      params.append('tenant_slug', auditTenantFilter);
    }
    if (auditDateFrom) {
      params.append('date_from', auditDateFrom);
    }
    if (auditDateTo) {
      params.append('date_to', auditDateTo);
    }

    const response = await apiClient.get(`/saas/auth/audit-logs/export?${params.toString()}`, {
      responseType: 'blob',
    });

    const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `saas_audit_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const renderModuleContent = () => {
    if (activeModule === 'resumen') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="kpi-card">
              <p className="kpi-label">Tenants registrados</p>
              <p className="kpi-value">{tenantsQuery.data?.length || 0}</p>
            </div>
            <div className="kpi-card">
              <p className="kpi-label">Tenants activos</p>
              <p className="kpi-value text-emerald-700">
                {tenantsQuery.data?.filter((t) => t.activo).length || 0}
              </p>
            </div>
            <div className="kpi-card">
              <p className="kpi-label">Usuarios SaaS</p>
              <p className="kpi-value">{usersQuery.data?.length || '-'}</p>
            </div>
          </div>
          <div className="section-card p-6">
            <p className="text-sm font-semibold text-slate-800 mb-3">Permisos efectivos</p>
            {permissionsQuery.isLoading && <LoadingBlock lines={2} />}
            {permissionsQuery.isError && (
              <p className="text-sm text-red-600">No se pudieron cargar permisos globales.</p>
            )}
            {permissionsQuery.data && (
              <div className="flex flex-wrap gap-2">
                {permissionsQuery.data.permissions.map((permission) => (
                  <span
                    key={permission}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700"
                  >
                    {permission}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeModule === 'tenants') {
      return (
        <div className="space-y-6">
          <div className="section-card p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-slate-800">Tenants CDA</p>
              <span className="text-xs rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                Total: {tenantsQuery.data?.length || 0}
              </span>
            </div>
            {tenantsQuery.isLoading && <LoadingBlock lines={4} />}
            {tenantsQuery.isError && <p className="text-sm text-red-600">No fue posible cargar la lista de tenants.</p>}
            {tenantsQuery.data && (
              tenantsQuery.data.length === 0 ? (
                <EmptyState message="Aún no hay tenants registrados en la plataforma." />
              ) : (
              <div className="table-shell">
                <table className="table-enterprise">
                  <thead>
                    <tr className="text-left border-b border-slate-200">
                      <th>CDA</th>
                      <th>Slug</th>
                      <th>Contacto</th>
                      <th>Plan</th>
                      <th>Sucursales</th>
                      <th>Estado</th>
                      <th>Próx. cobro</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenantsQuery.data.map((tenant) => (
                      <tr key={tenant.id}>
                        <td className="font-medium text-slate-900">{tenant.nombre_comercial}</td>
                        <td>/{tenant.slug}</td>
                        <td>{tenant.correo_electronico || '-'}</td>
                        <td className="uppercase">{tenant.plan_actual}</td>
                        <td>
                          {tenant.sedes_totales} total / {tenant.sucursales_facturables} fact.
                        </td>
                        <td>
                          <span className={statusBadgeClass(tenant.subscription_status)}>
                            {subscriptionStatusLabel(tenant.subscription_status)}
                          </span>
                        </td>
                        <td>
                          {tenant.next_billing_at ? new Date(tenant.next_billing_at).toLocaleDateString() : '-'}
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openTenantSheet(tenant)}
                              className="btn-chip"
                            >
                              Abrir perfil
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyLoginUrl(tenant.id, tenant.login_url)}
                              className="btn-chip"
                            >
                              {copiedTenantId === tenant.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  Copiado
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  Copiar URL
                                </>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )
            )}
          </div>

        </div>
      );
    }

    if (activeModule === 'usuarios') {
      const isOwner = permissionsQuery.data?.role === 'owner';
      return (
        <div className="space-y-6">
          <div className="section-card p-6">
            <p className="text-sm font-semibold text-slate-800 mb-3">Usuarios SaaS internos</p>
            {usersQuery.isLoading && <LoadingBlock lines={3} />}
            {usersQuery.isError && <p className="text-sm text-red-600">No fue posible cargar los usuarios SaaS.</p>}
            {usersQuery.data && (
              usersQuery.data.length === 0 ? (
                <EmptyState message="No hay usuarios SaaS creados todavía." />
              ) : (
              <div className="table-shell">
                <table className="table-enterprise">
                  <thead>
                    <tr className="text-left border-b border-slate-200">
                      <th>Nombre</th>
                      <th>Email</th>
                      <th>Rol global</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersQuery.data.map((u) => (
                      <tr key={u.id}>
                        <td>{u.nombre_completo}</td>
                        <td>{u.email}</td>
                        <td className="capitalize">{u.rol_global}</td>
                        <td>
                          <span className={u.activo ? 'badge badge-success' : 'badge badge-danger'}>
                            {u.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )
            )}
          </div>

          <div className="section-card p-6">
            <p className="text-sm font-semibold text-slate-800 mb-3">Crear usuario SaaS</p>
            {!isOwner && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                Solo el rol owner puede crear usuarios SaaS.
              </p>
            )}
            {createUserError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">{createUserError}</p>
            )}
            {createUserSuccess && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">{createUserSuccess}</p>
            )}
            <form
              className="grid grid-cols-1 md:grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setCreateUserError('');
                setCreateUserSuccess('');
                createSaaSUserMutation.mutate();
              }}
            >
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Nombre completo"
                className="input-corporate"
                required
                disabled={!isOwner}
              />
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="correo@empresa.com"
                className="input-corporate"
                required
                disabled={!isOwner}
              />
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as 'owner' | 'finanzas' | 'comercial' | 'soporte')}
                className="input-corporate"
                disabled={!isOwner}
              >
                <option value="soporte">soporte</option>
                <option value="comercial">comercial</option>
                <option value="finanzas">finanzas</option>
                <option value="owner">owner</option>
              </select>
              <input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder="Contraseña inicial"
                className="input-corporate"
                minLength={6}
                required
                disabled={!isOwner}
              />
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={!isOwner || createSaaSUserMutation.isLoading}
                  className="px-4 btn-corporate-primary disabled:opacity-50"
                >
                  {createSaaSUserMutation.isLoading ? 'Creando...' : 'Crear usuario SaaS'}
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    if (activeModule === 'facturacion') {
      return (
        <div className="space-y-6">
          <div className="section-card p-6">
            <p className="text-sm font-semibold text-slate-800 mb-3">Resumen global de facturación por tenant</p>
            {billingOverviewQuery.isLoading && <LoadingBlock lines={4} />}
            {billingOverviewQuery.isError && <p className="text-sm text-red-600">No fue posible cargar el resumen de facturación.</p>}
            {billingOverviewQuery.data && (
              billingOverviewQuery.data.length === 0 ? (
                <EmptyState message="No hay registros de facturación para mostrar todavía." />
              ) : (
              <div className="table-shell">
                <table className="table-enterprise">
                  <thead>
                    <tr className="text-left border-b border-slate-200">
                      <th>Tenant</th>
                      <th>Plan</th>
                      <th>Sucursales</th>
                      <th>Estado cobro</th>
                      <th>Próx. cobro</th>
                      <th>Último pago</th>
                      <th>Recibo</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingOverviewQuery.data.map((item) => {
                      const tenant = (tenantsQuery.data || []).find((t) => t.id === item.tenant_id);
                      return (
                      <tr key={item.tenant_id}>
                        <td className="font-medium">{item.tenant_nombre}</td>
                        <td>{item.plan_label}</td>
                        <td>{item.sedes_totales} / {item.sucursales_facturables} fact.</td>
                        <td>
                          <span className={statusBadgeClass(item.cobro_status)}>
                            {cobroStatusLabel(item.cobro_status)}
                          </span>
                        </td>
                        <td>{item.next_billing_at ? new Date(item.next_billing_at).toLocaleDateString() : '-'}</td>
                        <td>
                          {item.last_payment_amount != null ? `${item.last_payment_amount.toLocaleString('es-CO')} (${item.last_payment_at ? new Date(item.last_payment_at).toLocaleDateString() : '-'})` : '-'}
                        </td>
                        <td>{item.last_receipt_reference || '-'}</td>
                        <td>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => tenant && openTenantSheet(tenant)}
                              className="btn-chip"
                            >
                              Abrir gestión
                            </button>
                            <button
                              type="button"
                              disabled={!item.last_payment_log_id || resendReceiptMutation.isLoading}
                              onClick={() => item.last_payment_log_id && resendReceiptMutation.mutate(item.last_payment_log_id)}
                              className="btn-chip"
                            >
                              {item.last_payment_log_id && item.last_payment_log_id === resentPaymentLogId
                                ? 'Enviado'
                                : 'Reenviar recibo'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              )
            )}
          </div>
        </div>
      );
    }

    if (activeModule === 'auditoria') {
      return (
        <div className="section-card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-800">Auditoría global</p>
            <button
              type="button"
              onClick={handleExportAuditCsv}
              className="btn-chip shadow-sm"
            >
              Exportar CSV
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              type="text"
              value={auditActionFilter}
              onChange={(e) => setAuditActionFilter(e.target.value)}
              placeholder="Filtrar por acción (ej: login)"
              className="input-corporate"
            />
            <input
              type="text"
              value={auditActorFilter}
              onChange={(e) => setAuditActorFilter(e.target.value)}
              placeholder="Filtrar por correo actor"
              className="input-corporate"
            />
            <select
              value={auditTenantFilter}
              onChange={(e) => setAuditTenantFilter(e.target.value)}
              className="input-corporate"
            >
              <option value="">Todos los tenants</option>
              {(tenantsQuery.data || []).map((tenant) => (
                <option key={tenant.id} value={tenant.slug}>
                  /{tenant.slug}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={auditDateFrom}
              onChange={(e) => setAuditDateFrom(e.target.value)}
              className="input-corporate"
            />
            <input
              type="date"
              value={auditDateTo}
              onChange={(e) => setAuditDateTo(e.target.value)}
              className="input-corporate"
            />
          </div>
          {auditLogsQuery.isLoading && <LoadingBlock lines={5} />}
          {auditLogsQuery.isError && <p className="text-sm text-red-600">No fue posible cargar la auditoría.</p>}
          {auditLogsQuery.data && (
            auditLogsQuery.data.length === 0 ? (
              <EmptyState message="No se encontraron eventos con los filtros aplicados." />
            ) : (
            <div className="table-shell">
              <table className="table-enterprise">
                <thead>
                  <tr className="text-left border-b border-slate-200">
                    <th>Fecha</th>
                    <th>Acción</th>
                    <th>Descripción</th>
                    <th>Actor</th>
                    <th>Tenant</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogsQuery.data.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.created_at).toLocaleString()}</td>
                      <td>{log.action}</td>
                      <td>{log.description}</td>
                      <td>{log.usuario_email || 'Sistema'}</td>
                      <td>{log.tenant_slug ? `/${log.tenant_slug}` : '-'}</td>
                      <td>
                        <span className={statusBadgeClass(log.success)}>
                          {log.success === 'success' ? 'Exitoso' : 'Con error'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="section-card p-6">
          <p className="text-sm font-semibold text-slate-800 mb-3">Seguridad SaaS</p>
          {securitySummaryQuery.isLoading && <LoadingBlock lines={2} />}
          {securitySummaryQuery.isError && <p className="text-sm text-red-600">No fue posible cargar el resumen de seguridad.</p>}
          {securitySummaryQuery.data && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
              <div className="kpi-card !p-3"><span className="kpi-label">Usuarios SaaS</span><p className="text-2xl font-bold text-slate-900 mt-1">{securitySummaryQuery.data.total_saas_users}</p></div>
              <div className="kpi-card !p-3"><span className="kpi-label">Activos</span><p className="text-2xl font-bold text-emerald-700 mt-1">{securitySummaryQuery.data.active_saas_users}</p></div>
              <div className="kpi-card !p-3"><span className="kpi-label">Bloqueados</span><p className="text-2xl font-bold text-amber-700 mt-1">{securitySummaryQuery.data.locked_saas_users}</p></div>
              <div className="kpi-card !p-3"><span className="kpi-label">MFA activo</span><p className="text-2xl font-bold text-blue-700 mt-1">{securitySummaryQuery.data.mfa_enabled_users}</p></div>
            </div>
          )}
        </div>

        <div className="section-card p-6">
          <p className="text-sm font-semibold text-slate-800 mb-3">Usuarios y controles de seguridad</p>
          {securityActionError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">{securityActionError}</p>
          )}
          {securityActionSuccess && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">{securityActionSuccess}</p>
          )}
          {securityUsersQuery.isLoading && <LoadingBlock lines={4} />}
          {securityUsersQuery.isError && <p className="text-sm text-red-600">No fue posible cargar usuarios de seguridad.</p>}
          {securityUsersQuery.data && (
            securityUsersQuery.data.length === 0 ? (
              <EmptyState message="No hay usuarios de seguridad para listar." />
            ) : (
            <div className="table-shell">
              <table className="table-enterprise">
                <thead>
                  <tr className="text-left border-b border-slate-200">
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>MFA</th>
                    <th>Bloqueo</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {securityUsersQuery.data.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <p className="font-medium">{u.nombre_completo}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="capitalize">{u.rol_global}</td>
                      <td>
                        <span className={u.mfa_enabled ? 'badge badge-success' : 'badge badge-warning'}>
                          {u.mfa_enabled ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td>{u.bloqueado_hasta ? `Hasta ${new Date(u.bloqueado_hasta).toLocaleString()}` : 'No'}</td>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleMfaMutation.mutate(u.id)}
                            disabled={(u.rol_global === 'owner' || u.rol_global === 'finanzas') && u.mfa_enabled}
                            className="btn-chip"
                          >
                            {(u.rol_global === 'owner' || u.rol_global === 'finanzas') && u.mfa_enabled
                              ? 'MFA obligatorio'
                              : u.mfa_enabled
                                ? 'Desactivar MFA'
                                : 'Activar MFA'}
                          </button>
                          <button
                            type="button"
                            onClick={() => unlockUserMutation.mutate(u.id)}
                            className="btn-chip"
                          >
                            Desbloquear
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="corporate-shell">
      <header className="bg-white/85 backdrop-blur-md border-b border-slate-200/70 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={logoCdaSoft} alt="CDASOFT" className="h-14 sm:h-20 lg:h-24 w-auto object-contain" />
            <div>
              <p className="text-sm font-semibold text-slate-900">CDASOFT SaaS Backoffice</p>
              <p className="text-xs text-slate-500">Gestión global de plataforma</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm rounded-lg text-white transition shadow-sm hover:shadow-md flex items-center gap-2 bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-700 hover:to-red-800"
          >
            <LogOut className="w-4 h-4" />
            Salir
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-8 relative">
        <div className="section-card p-4 sm:p-6 mb-6">
          <p className="text-sm text-slate-500 mb-1">Sesión global activa</p>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mb-2">
            Bienvenido, {user?.nombre_completo}
          </h1>
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Rol global: <span className="font-semibold capitalize">{permissionsQuery.data?.role || '-'}</span>
          </div>
        </div>

        <div className="mb-6 overflow-x-auto">
          <div className="grid grid-cols-6 gap-3 min-w-[780px] md:min-w-0">
            {[
              { id: 'resumen' as BackofficeModule, title: 'Resumen', icon: Building2, color: 'text-blue-600' },
              { id: 'tenants' as BackofficeModule, title: 'Tenants', icon: Users, color: 'text-indigo-600' },
              { id: 'facturacion' as BackofficeModule, title: 'Facturación', icon: Wallet, color: 'text-violet-600' },
              { id: 'usuarios' as BackofficeModule, title: 'Usuarios SaaS', icon: ShieldCheck, color: 'text-emerald-600' },
              { id: 'auditoria' as BackofficeModule, title: 'Auditoría', icon: FileClock, color: 'text-amber-600' },
              { id: 'seguridad' as BackofficeModule, title: 'Seguridad', icon: Shield, color: 'text-rose-600' },
            ].map((module) => (
              <button
                key={module.id}
                type="button"
                onClick={() => setActiveModule(module.id)}
                className={`rounded-xl border bg-white/85 backdrop-blur-sm p-4 text-left transition ${
                  activeModule === module.id
                    ? 'border-slate-800 shadow-md ring-1 ring-slate-200'
                    : 'border-slate-200/80 hover:border-slate-300 hover:shadow-sm'
                }`}
              >
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 mb-2">
                  <module.icon className={`w-4 h-4 ${module.color}`} />
                </div>
                <p className="text-xs text-slate-500">Módulo</p>
                <p className="font-semibold text-slate-900 text-sm">{module.title}</p>
              </button>
            ))}
          </div>
        </div>

        {renderModuleContent()}
      </main>

      {selectedTenantId && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-start sm:items-center justify-center p-2 sm:p-4"
          onClick={() => setSelectedTenantId(null)}
        >
          <div
            className="w-full max-w-5xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto glass-card border border-slate-200/70 p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-slate-800">Hoja de vida del CDA</p>
              <button
                type="button"
                onClick={() => setSelectedTenantId(null)}
                className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
              >
                Cerrar perfil
              </button>
            </div>

            {tenantProfileQuery.isLoading && <LoadingBlock lines={6} />}
            {tenantProfileQuery.isError && <p className="text-sm text-red-600">No fue posible cargar el perfil del tenant.</p>}
            {tenantProfileQuery.data && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="md:col-span-1 rounded-xl border border-slate-200 p-4 flex flex-col items-center justify-center">
                    {tenantProfileQuery.data.logo_url ? (
                      <img
                        src={tenantProfileQuery.data.logo_url}
                        alt={tenantProfileQuery.data.nombre_comercial}
                        className="max-h-28 object-contain mb-2"
                      />
                    ) : (
                      <div className="h-28 w-full rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 text-xs mb-2">
                        Sin logo
                      </div>
                    )}
                    <p className="text-xs text-slate-500">Marca del CDA</p>
                  </div>
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><span className="text-slate-500">Nombre comercial:</span> <span className="font-medium">{tenantProfileQuery.data.nombre_comercial}</span></div>
                    <div><span className="text-slate-500">Slug:</span> /{tenantProfileQuery.data.slug}</div>
                    <div><span className="text-slate-500">NIT:</span> {tenantProfileQuery.data.nit_cda || '-'}</div>
                    <div><span className="text-slate-500">Correo:</span> {tenantProfileQuery.data.correo_electronico || '-'}</div>
                    <div><span className="text-slate-500">Representante:</span> {tenantProfileQuery.data.nombre_representante || '-'}</div>
                    <div><span className="text-slate-500">Celular:</span> {tenantProfileQuery.data.celular || '-'}</div>
                    <div><span className="text-slate-500">Plan actual:</span> <span className="font-medium uppercase">{tenantProfileQuery.data.plan_actual}</span></div>
                    <div><span className="text-slate-500">Estado suscripción:</span> <span className={statusBadgeClass(tenantProfileQuery.data.subscription_status)}>{subscriptionStatusLabel(tenantProfileQuery.data.subscription_status)}</span></div>
                    <div><span className="text-slate-500">Sucursales totales:</span> <span className="font-medium">{tenantProfileQuery.data.sedes_totales}</span></div>
                    <div><span className="text-slate-500">Sucursales facturables:</span> <span className="font-medium">{tenantProfileQuery.data.sucursales_facturables}</span></div>
                    <div><span className="text-slate-500">Próximo cobro:</span> {tenantProfileQuery.data.next_billing_at ? new Date(tenantProfileQuery.data.next_billing_at).toLocaleDateString() : '-'}</div>
                    <div><span className="text-slate-500">Último pago:</span> {tenantProfileQuery.data.last_payment_at ? new Date(tenantProfileQuery.data.last_payment_at).toLocaleDateString() : '-'}</div>
                    <div className="md:col-span-2">
                      <span className="text-slate-500">URL personalizada:</span>{' '}
                      <span className="font-medium break-all">{tenantProfileQuery.data.login_url}</span>
                    </div>
                  </div>
                </div>

                <div className="section-card p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-3">Gestión de plan y pago</p>
                  {billingActionError && (
                    <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">{billingActionError}</p>
                  )}
                  {billingActionSuccess && (
                    <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">{billingActionSuccess}</p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <select
                      value={billingPlanCode}
                      onChange={(e) => setBillingPlanCode(e.target.value)}
                      className="input-corporate"
                    >
                      {(billingPlansQuery.data || []).map((plan) => (
                        <option key={plan.code} value={plan.code}>
                          {plan.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={billingSedesTotales}
                      onChange={(e) => setBillingSedesTotales(Math.max(1, Number(e.target.value) || 1))}
                      className="input-corporate"
                      placeholder="Sedes totales"
                    />
                    <button
                      type="button"
                      disabled={!billingQuoteQuery.data || assignPlanMutation.isLoading}
                      onClick={() => {
                        setBillingActionError('');
                        setBillingActionSuccess('');
                        assignPlanMutation.mutate();
                      }}
                      className="px-4 btn-corporate-primary disabled:opacity-50"
                    >
                      {assignPlanMutation.isLoading ? 'Aplicando plan...' : 'Asignar plan y activar periodo'}
                    </button>
                  </div>

                  <div className="mt-3">
                    {billingQuoteQuery.isLoading && <LoadingBlock lines={1} />}
                    {billingQuoteQuery.isError && <p className="text-sm text-red-600">No fue posible calcular la cotización.</p>}
                    {billingQuoteQuery.data && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900 shadow-sm">
                        Resumen: {billingQuoteQuery.data.sedes_totales} sedes totales | {billingQuoteQuery.data.included_branches} incluidas | {billingQuoteQuery.data.chargeable_additional_branches} facturables | Total: {billingQuoteQuery.data.total.toLocaleString('es-CO')}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input
                      type="number"
                      min={1}
                      step="1000"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="Monto pago"
                      className="input-corporate w-40"
                    />
                    <input
                      type="text"
                      value={paymentNotes}
                      onChange={(e) => setPaymentNotes(e.target.value)}
                      placeholder="Notas pago (opcional)"
                      className="input-corporate min-w-[220px]"
                    />
                    <button
                      type="button"
                      disabled={!billingTenantId || Number(paymentAmount) <= 0 || registerPaymentMutation.isLoading}
                      onClick={() => {
                        setBillingActionError('');
                        setBillingActionSuccess('');
                        registerPaymentMutation.mutate();
                      }}
                      className="px-4 btn-corporate-primary disabled:opacity-50"
                    >
                      {registerPaymentMutation.isLoading ? 'Registrando pago...' : 'Registrar pago'}
                    </button>
                  </div>

                  {lastPaymentReceipt && (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm space-y-1">
                      <p className="font-semibold text-emerald-800">Recibo de pago registrado</p>
                      <p><span className="text-emerald-700">Referencia:</span> {lastPaymentReceipt.comprobante_referencia}</p>
                      <p><span className="text-emerald-700">Plan:</span> {lastPaymentReceipt.plan_label}</p>
                      <p><span className="text-emerald-700">Monto:</span> {lastPaymentReceipt.amount.toLocaleString('es-CO')}</p>
                      <p><span className="text-emerald-700">Fecha pago:</span> {new Date(lastPaymentReceipt.paid_at).toLocaleString()}</p>
                      <p><span className="text-emerald-700">Sucursales:</span> {lastPaymentReceipt.sedes_totales} total / {lastPaymentReceipt.sucursales_facturables} facturables</p>
                      <p><span className="text-emerald-700">Próximo cobro:</span> {lastPaymentReceipt.next_billing_at ? new Date(lastPaymentReceipt.next_billing_at).toLocaleDateString() : 'N/A'}</p>
                      <p><span className="text-emerald-700">Correo enviado:</span> {lastPaymentReceipt.receipt_email_sent ? 'Si' : 'No (revisar SMTP/correo tenant)'}</p>
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => handleDownloadReceipt(lastPaymentReceipt.receipt_download_url, lastPaymentReceipt.comprobante_referencia)}
                          className="btn-chip bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-600 hover:border-emerald-600"
                        >
                          Descargar recibo PDF
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-800 mb-2">Historial de pagos (últimos 10)</p>
                  {tenantPaymentsQuery.isLoading && <LoadingBlock lines={3} />}
                  {tenantPaymentsQuery.isError && <p className="text-sm text-red-600">No fue posible cargar el historial de pagos.</p>}
                  {tenantPaymentsQuery.data && (
                    tenantPaymentsQuery.data.length === 0 ? (
                      <EmptyState message="Este tenant aún no tiene pagos registrados." />
                    ) : (
                    <div className="table-shell">
                      <table className="table-enterprise">
                        <thead>
                          <tr className="text-left border-b border-slate-200">
                            <th>Fecha</th>
                            <th>Monto</th>
                            <th>Plan</th>
                            <th>Recibo</th>
                            <th>Próx. cobro</th>
                            <th>Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tenantPaymentsQuery.data.map((p) => (
                            <tr key={p.id}>
                              <td>{new Date(p.paid_at).toLocaleString()}</td>
                              <td>{p.amount.toLocaleString('es-CO')}</td>
                              <td>{p.plan_label || p.plan_code || '-'}</td>
                              <td>{p.comprobante_referencia || '-'}</td>
                              <td>{p.next_billing_at ? new Date(p.next_billing_at).toLocaleDateString() : '-'}</td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadReceipt(p.receipt_download_url, p.comprobante_referencia)}
                                  className="btn-chip"
                                >
                                  Descargar PDF
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    )
                  )}
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-800 mb-2">
                    Usuarios recientes ({tenantProfileQuery.data.total_usuarios} total)
                  </p>
                  {tenantProfileQuery.data.usuarios_recientes.length === 0 ? (
                    <EmptyState message="No hay usuarios recientes para este tenant." />
                  ) : (
                    <div className="table-shell">
                      <table className="table-enterprise">
                        <thead>
                          <tr className="text-left border-b border-slate-200">
                            <th>Nombre</th>
                            <th>Email</th>
                            <th>Rol</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tenantProfileQuery.data.usuarios_recientes.map((u) => (
                            <tr key={u.id}>
                              <td>{u.nombre_completo}</td>
                              <td>{u.email}</td>
                              <td className="capitalize">{u.rol}</td>
                              <td>
                                <span className={u.activo ? 'badge badge-success' : 'badge badge-danger'}>
                                  {u.activo ? 'Activo' : 'Inactivo'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
