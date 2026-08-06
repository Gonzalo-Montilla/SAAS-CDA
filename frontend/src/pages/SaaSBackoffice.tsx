import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  LogOut,
  Users,
  Activity,
  Coins,
  Copy,
  Check,
  Building2,
  Shield,
  FileClock,
  Wallet,
  LifeBuoy,
  Star,
  Pencil,
  Link2,
  CreditCard,
  KeyRound,
  UserPlus,
  Landmark,
  MapPin,
  FileText,
  Download,
} from 'lucide-react';
import { BackofficeSectionHeading } from '../components/BackofficeSectionHeading';
import FactusMunicipalitySearchField from '../components/FactusMunicipalitySearchField';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';
import { patchSaasSucursalUbicacion, patchSaasTenantCoreData, patchSaasTenantLogo } from '../api/saasTenant';
import { Fragment, useEffect, useRef, useState } from 'react';
import { formatCurrency } from '../utils/formatNumber';
import { runtMetricasApi, type RuntMetricasSummary } from '../api/runtMetricas';
import type {
  SaaSAuditLogListResponse,
  SaaSBillingPlanItem,
  SaaSBillingOverviewItem,
  SaaSOpenSanctionsUsageSummary,
  SaaSPaymentRegisteredResponse,
  SaaSPaymentHistoryItem,
  SaaSSecuritySummary,
  SaaSSupportSummary,
  SaaSSupportTicketItem,
  SaaSSupportTicketListResponse,
  SaaSTenantProfile,
  SaaSTenantBillingQuote,
  SaaSTenantSummary,
  SaaSUser,
  SaaSUserSecurityItem,
  SaaSCheckoutSessionItem,
  SaaSCheckoutSessionListResponse,
  SaaSFactusIssuerConfig,
  SaaSFactusIssuerTestResult,
} from '../types';
import logoCdaSoft from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';
import SaasTenantFactusPanel from '../components/SaasTenantFactusPanel';

function escapeCsvField(value: string): string {
  const s = value.replace(/\r?\n/g, ' ').replace(/"/g, '""');
  if (/[",;\n]/.test(s)) {
    return `"${s}"`;
  }
  return s;
}

interface SaaSPermissionsResponse {
  role: 'owner' | 'finanzas' | 'comercial' | 'soporte';
  permissions: string[];
}

type BackofficeModule =
  | 'resumen'
  | 'tenants'
  | 'runt_metricas'
  | 'opensanctions_metricas'
  | 'facturacion'
  | 'soporte'
  | 'usuarios'
  | 'auditoria'
  | 'seguridad';
const TABLE_DENSITY_STORAGE_KEY = 'saas_backoffice_table_density';
type TenantProfileSection = 'brandAccess' | 'documentos' | 'sedes' | 'factus' | 'billing' | 'payments' | 'users';
type CheckoutSessionsViewTab = 'all' | 'pending' | 'paid' | 'fe_issue';
const OPENSANCTIONS_CUSTOM_WINDOW = -1;
const RUNT_CUSTOM_WINDOW = -1;
const BOGOTA_TIME_ZONE = 'America/Bogota';
const BOGOTA_UTC_OFFSET_HOURS = -5;

const DEFAULT_TENANT_PROFILE_SECTIONS_OPEN: Record<TenantProfileSection, boolean> = {
  brandAccess: true,
  documentos: false,
  sedes: false,
  factus: false,
  billing: false,
  payments: false,
  users: false,
};

const toBogotaYmd = (date: Date): string => {
  const shifted = new Date(date.getTime() + BOGOTA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const shiftYmd = (ymd: string, deltaDays: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

const bogotaDayStartUtcIso = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 5, 0, 0, 0)).toISOString();
};

const bogotaDayEndUtcIso = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  const nextDayStartUtc = Date.UTC(y, (m || 1) - 1, (d || 1) + 1, 5, 0, 0, 0);
  return new Date(nextDayStartUtc - 1).toISOString();
};

export default function SaaSBackoffice() {
  const { user, logout, getLogoutRedirectPath } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copiedTenantId, setCopiedTenantId] = useState<string | null>(null);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resendResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeModule, setActiveModule] = useState<BackofficeModule>('resumen');
  const [runtMetricasDays, setRuntMetricasDays] = useState<number>(30);
  const [runtMetricasTenantId, setRuntMetricasTenantId] = useState<string>('');
  const [runtDateFrom, setRuntDateFrom] = useState<string>(() => {
    const today = toBogotaYmd(new Date());
    return shiftYmd(today, -29);
  });
  const [runtDateTo, setRuntDateTo] = useState<string>(() => toBogotaYmd(new Date()));
  const [opensanctionsDays, setOpensanctionsDays] = useState<number>(30);
  const [opensanctionsDateFrom, setOpensanctionsDateFrom] = useState<string>(() => {
    const today = toBogotaYmd(new Date());
    return shiftYmd(today, -29);
  });
  const [opensanctionsDateTo, setOpensanctionsDateTo] = useState<string>(() => toBogotaYmd(new Date()));
  const [opensanctionsTenantId, setOpensanctionsTenantId] = useState<string>('');
  const [opensanctionsTrm, setOpensanctionsTrm] = useState<number>(4379);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact'>(() => {
    if (typeof window === 'undefined') {
      return 'comfortable';
    }
    return window.localStorage.getItem(TABLE_DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable';
  });
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
  const [supportTenantFilter, setSupportTenantFilter] = useState('');
  const [supportStatusFilter, setSupportStatusFilter] = useState('');
  const [supportPriorityFilter, setSupportPriorityFilter] = useState('');
  const [supportSortBy, setSupportSortBy] = useState<'created_at' | 'priority' | 'status' | 'tenant'>('created_at');
  const [supportSortDir, setSupportSortDir] = useState<'asc' | 'desc'>('desc');
  const [supportQuickSearch, setSupportQuickSearch] = useState('');
  const [supportPage, setSupportPage] = useState(1);
  const [expandedSupportTicketId, setExpandedSupportTicketId] = useState<string | null>(null);
  const [supportActionError, setSupportActionError] = useState('');
  const [supportActionSuccess, setSupportActionSuccess] = useState('');
  const [supportReplyTicketId, setSupportReplyTicketId] = useState<string | null>(null);
  const [supportReplyMessage, setSupportReplyMessage] = useState('');
  const [checkoutSessionStatusFilter, setCheckoutSessionStatusFilter] = useState('');
  const [checkoutSessionTenantId, setCheckoutSessionTenantId] = useState('');
  const [checkoutSessionFeFilter, setCheckoutSessionFeFilter] = useState('');
  const [checkoutSessionQuickSearch, setCheckoutSessionQuickSearch] = useState('');
  const [checkoutSessionsViewTab, setCheckoutSessionsViewTab] = useState<CheckoutSessionsViewTab>('all');
  const [checkoutSessionsPage, setCheckoutSessionsPage] = useState(1);
  const [checkoutSessionsSortBy, setCheckoutSessionsSortBy] = useState<'created_at' | 'total_cop' | 'status' | 'tenant'>('created_at');
  const [checkoutSessionsSortDir, setCheckoutSessionsSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedCheckoutSessionId, setExpandedCheckoutSessionId] = useState<string | null>(null);
  const [sedeUbicacionEdit, setSedeUbicacionEdit] = useState<{
    id: string;
    nombre: string;
    esPrincipal: boolean;
    direccion: string;
    ciudad: string;
    factus_municipality_id: string;
  } | null>(null);
  const [sedeUbicacionError, setSedeUbicacionError] = useState('');
  const [tenantLogoMode, setTenantLogoMode] = useState<'url' | 'file'>('url');
  const [tenantLogoUrl, setTenantLogoUrl] = useState('');
  const [tenantLogoFile, setTenantLogoFile] = useState<File | null>(null);
  const [tenantLogoError, setTenantLogoError] = useState('');
  const [tenantCoreNombre, setTenantCoreNombre] = useState('');
  const [tenantCoreNombreComercial, setTenantCoreNombreComercial] = useState('');
  const [tenantCoreNit, setTenantCoreNit] = useState('');
  const [tenantCoreCorreo, setTenantCoreCorreo] = useState('');
  const [tenantCoreRepresentante, setTenantCoreRepresentante] = useState('');
  const [tenantCoreCelular, setTenantCoreCelular] = useState('');
  const [tenantCoreNominaEnabled, setTenantCoreNominaEnabled] = useState(false);
  const [tenantCoreExogenaEnabled, setTenantCoreExogenaEnabled] = useState(false);
  const [tenantCoreSarlaftEnabled, setTenantCoreSarlaftEnabled] = useState(false);
  const [tenantCoreSarlaftMode, setTenantCoreSarlaftMode] = useState<'manual' | 'api'>('manual');
  /** Vacío = default global; "0" = ilimitado; número = MB custom */
  const [tenantCoreDocumentosQuotaMb, setTenantCoreDocumentosQuotaMb] = useState('');
  const [tenantDocumentosQuotaError, setTenantDocumentosQuotaError] = useState('');
  const [tenantCoreError, setTenantCoreError] = useState('');
  const [tenantCoreEditMode, setTenantCoreEditMode] = useState(false);
  const [auditSortBy, setAuditSortBy] = useState<'created_at' | 'action' | 'success' | 'tenant' | 'actor'>('created_at');
  const [auditSortDir, setAuditSortDir] = useState<'asc' | 'desc'>('desc');
  const [auditQuickSearch, setAuditQuickSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [expandedAuditLogId, setExpandedAuditLogId] = useState<string | null>(null);
  const [tenantProfileSectionsOpen, setTenantProfileSectionsOpen] = useState<Record<TenantProfileSection, boolean>>(
    DEFAULT_TENANT_PROFILE_SECTIONS_OPEN,
  );
  const formatUsd = (value: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(
      Number(value || 0),
    );
  const formatEur = (value: number): string =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(
      Number(value || 0),
    );

  const getTenantProviderEfficiency = (
    row: RuntMetricasSummary['by_tenant'][number],
  ): { placaapi: boolean; coresoft: boolean; verifik: boolean } => {
    const placaapiResueltas = Number(row.placaapi_resueltas || 0);
    const coresoftResueltas = Number(row.coresoft_resueltas || 0);
    const verifikResueltas = Number(row.verifik_resueltas || 0);
    const candidates: Array<{ key: 'placaapi' | 'coresoft' | 'verifik'; promedio: number }> = [];
    if (placaapiResueltas > 0) {
      candidates.push({
        key: 'placaapi',
        promedio: Number(row.placaapi_costo_resuelto_cop || 0) / placaapiResueltas,
      });
    }
    if (coresoftResueltas > 0) {
      candidates.push({
        key: 'coresoft',
        promedio: Number(row.coresoft_costo_resuelto_cop || 0) / coresoftResueltas,
      });
    }
    if (verifikResueltas > 0) {
      candidates.push({
        key: 'verifik',
        promedio: Number(row.verifik_costo_resuelto_cop || 0) / verifikResueltas,
      });
    }
    if (candidates.length === 0) {
      return { placaapi: false, coresoft: false, verifik: false };
    }
    const minPromedio = Math.min(...candidates.map((c) => c.promedio));
    const delta = 0.01;
    return {
      placaapi: candidates.some((c) => c.key === 'placaapi' && Math.abs(c.promedio - minPromedio) <= delta),
      coresoft: candidates.some((c) => c.key === 'coresoft' && Math.abs(c.promedio - minPromedio) <= delta),
      verifik: candidates.some((c) => c.key === 'verifik' && Math.abs(c.promedio - minPromedio) <= delta),
    };
  };

  const formatAmountForInput = (amount: number): string => {
    if (!Number.isFinite(amount)) {
      return '';
    }
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  };

  const branchChargeSummary = (sedesTotalesRaw: number, facturablesRaw: number): string => {
    const sedesTotales = Math.max(1, Number(sedesTotalesRaw) || 1);
    const facturables = Math.max(0, Number(facturablesRaw) || 0);
    return `${sedesTotales} total | ${facturables} adicional${facturables === 1 ? '' : 'es'} cobrada${
      facturables === 1 ? '' : 's'
    } (desde la 3.ª)`;
  };

  const subscriptionStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      active: 'Activa',
      trial: 'Demo',
      past_due: 'Vencida',
      soft_grace: 'Gracia (post-demo)',
      locked: 'Bloqueado (sin plan)',
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

  const isPendingDianFactusError = (msg: string | null | undefined): boolean => {
    const s = (msg || '').toLowerCase();
    return s.includes('pendiente') && s.includes('dian');
  };

  const effectiveFeStatus = (
    status: string | null | undefined,
    err: string | null | undefined,
    category?: string | null
  ): string => {
    if ((status || '') === 'error' && (category === 'pending_dian' || isPendingDianFactusError(err))) {
      return 'pending_dian';
    }
    if ((status || '') === 'error' && category) {
      return category;
    }
    return status || '';
  };

  const feLicenciaStatusLabel = (s: string | null | undefined): string => {
    if (s == null || s === '') {
      return 'Pendiente';
    }
    const labels: Record<string, string> = {
      ok: 'Emitida',
      error: 'Error',
      skipped: 'Omitida',
      pending_dian: 'Pendiente DIAN (Factus)',
      nit_dv: 'NIT / DV inválido',
      rut_name: 'Nombre no coincide RUT',
      config: 'Configuración emisor',
      validation: 'Error validación Factus',
    };
    return labels[s] || s;
  };

  const statusBadgeClass = (status: string): string => {
    if (status === 'active' || status === 'al_dia' || status === 'success') {
      return 'badge badge-success';
    }
    if (status === 'trial' || status === 'demo' || status === 'por_vencer') {
      return 'badge badge-info';
    }
    if (status === 'past_due' || status === 'pending_plan' || status === 'soft_grace' || status === 'vencido') {
      return 'badge badge-warning';
    }
    if (status === 'locked') {
      return 'badge badge-danger';
    }
    if (status === 'failed' || status === 'canceled' || status === 'cancelada') {
      return 'badge badge-danger';
    }
    if (status === 'pending' || status === 'abierto' || status === 'en_progreso') {
      return 'badge badge-info';
    }
    if (status === 'paid') {
      return 'badge badge-success';
    }
    if (status === 'ok') {
      return 'badge badge-success';
    }
    if (
      status === 'error' ||
      status === 'skipped' ||
      status === 'pending_dian' ||
      status === 'nit_dv' ||
      status === 'rut_name' ||
      status === 'config' ||
      status === 'validation'
    ) {
      return 'badge badge-warning';
    }
    if (status === 'resuelto' || status === 'cerrado') {
      return 'badge badge-success';
    }
    return 'badge bg-slate-100 text-slate-700';
  };

  const supportStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      abierto: 'Abierto',
      en_progreso: 'En progreso',
      resuelto: 'Resuelto',
      cerrado: 'Cerrado',
    };
    return labels[status] || status;
  };

  const supportPriorityBadgeClass = (priority: string): string => {
    if (priority === 'critica') return 'badge badge-danger';
    if (priority === 'alta') return 'badge badge-warning';
    if (priority === 'media') return 'badge badge-info';
    return 'badge bg-slate-100 text-slate-700';
  };

  const toggleTenantProfileSection = (section: TenantProfileSection) => {
    setTenantProfileSectionsOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const openAllTenantProfileSections = () => {
    setTenantProfileSectionsOpen({
      brandAccess: true,
      documentos: true,
      sedes: true,
      factus: true,
      billing: true,
      payments: true,
      users: true,
    });
  };

  const collapseAllTenantProfileSections = () => {
    setTenantProfileSectionsOpen({
      brandAccess: true,
      documentos: false,
      sedes: false,
      factus: false,
      billing: false,
      payments: false,
      users: false,
    });
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(TABLE_DENSITY_STORAGE_KEY, tableDensity);
  }, [tableDensity]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
      if (resendResetTimeoutRef.current) {
        clearTimeout(resendResetTimeoutRef.current);
      }
    };
  }, []);

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

  const currentSaaSRole = permissionsQuery.data?.role;
  const canReadSupport = currentSaaSRole === 'owner' || currentSaaSRole === 'soporte' || currentSaaSRole === 'comercial';
  const canManageSupport = currentSaaSRole === 'owner' || currentSaaSRole === 'soporte';
  const canRetrySaaSFe = currentSaaSRole === 'owner' || currentSaaSRole === 'finanzas';

  const tenantsQuery = useQuery({
    queryKey: ['saas-tenants-list'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSTenantSummary[]>('/saas/auth/tenants');
      return response.data;
    },
  });

  const runtCustomRangeInvalid =
    runtMetricasDays === RUNT_CUSTOM_WINDOW && (!runtDateFrom || !runtDateTo || runtDateFrom > runtDateTo);

  const runtMetricasQuery = useQuery({
    queryKey: ['saas-runt-metricas-summary', runtMetricasDays, runtMetricasTenantId, runtDateFrom, runtDateTo],
    queryFn: async () => {
      if (runtMetricasDays === RUNT_CUSTOM_WINDOW) {
        return runtMetricasApi.getSummary(
          30,
          runtMetricasTenantId || undefined,
          {
            fromDateIso: bogotaDayStartUtcIso(runtDateFrom),
            toDateIso: bogotaDayEndUtcIso(runtDateTo),
          }
        );
      }
      return runtMetricasApi.getSummary(runtMetricasDays, runtMetricasTenantId || undefined);
    },
    enabled: activeModule === 'runt_metricas' && !runtCustomRangeInvalid,
    refetchInterval: activeModule === 'runt_metricas' ? 30000 : false,
  });

  const usersQuery = useQuery({
    queryKey: ['saas-users-list'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSUser[]>('/saas/auth/users');
      return response.data;
    },
    enabled: activeModule === 'usuarios',
  });

  const supportTicketsQuery = useQuery({
    queryKey: [
      'saas-support-tickets',
      supportTenantFilter,
      supportStatusFilter,
      supportPriorityFilter,
      supportQuickSearch,
      supportPage,
      supportSortBy,
      supportSortDir,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', String(supportPage));
      params.append('page_size', '15');
      params.append('sort_by', supportSortBy);
      params.append('sort_dir', supportSortDir);
      if (supportTenantFilter) {
        params.append('tenant_slug', supportTenantFilter);
      }
      if (supportStatusFilter) {
        params.append('status_filter', supportStatusFilter);
      }
      if (supportPriorityFilter) {
        params.append('priority', supportPriorityFilter);
      }
      if (supportQuickSearch.trim()) {
        params.append('q', supportQuickSearch.trim());
      }
      const response = await apiClient.get<SaaSSupportTicketListResponse>(`/saas/auth/support/tickets?${params.toString()}`);
      return response.data;
    },
    enabled: activeModule === 'soporte' && canReadSupport,
  });

  const supportSummaryQuery = useQuery({
    queryKey: ['saas-support-summary'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSSupportSummary>('/saas/auth/support/summary');
      return response.data;
    },
    enabled: canReadSupport,
    refetchInterval: canReadSupport ? 15000 : false,
    refetchOnWindowFocus: true,
  });

  const tenantProfileQuery = useQuery({
    queryKey: ['saas-tenant-profile', selectedTenantId],
    queryFn: async () => {
      const response = await apiClient.get<SaaSTenantProfile>(`/saas/auth/tenants/${selectedTenantId}`);
      return response.data;
    },
    enabled: !!selectedTenantId,
  });

  useEffect(() => {
    if (selectedTenantId) {
      setTenantLogoMode('url');
      setTenantLogoUrl('');
      setTenantLogoFile(null);
      setTenantLogoError('');
      setTenantCoreError('');
      setTenantDocumentosQuotaError('');
      setTenantProfileSectionsOpen(DEFAULT_TENANT_PROFILE_SECTIONS_OPEN);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    const profile = tenantProfileQuery.data;
    if (!profile) {
      return;
    }
    setTenantCoreNombre(profile.nombre || '');
    setTenantCoreNombreComercial(profile.nombre_comercial || '');
    setTenantCoreNit(profile.nit_cda || '');
    setTenantCoreCorreo(profile.correo_electronico || '');
    setTenantCoreRepresentante(profile.nombre_representante || '');
    setTenantCoreCelular(profile.celular || '');
    setTenantCoreNominaEnabled(Boolean(profile.nomina_enabled));
    setTenantCoreExogenaEnabled(Boolean(profile.exogena_enabled));
    setTenantCoreSarlaftEnabled(Boolean(profile.sarlaft_enabled));
    setTenantCoreSarlaftMode((profile.sarlaft_mode === 'api' ? 'api' : 'manual') as 'manual' | 'api');
    setTenantCoreDocumentosQuotaMb(
      profile.documentos_quota_mb === null || profile.documentos_quota_mb === undefined
        ? ''
        : String(profile.documentos_quota_mb),
    );
    setTenantCoreError('');
    setTenantCoreEditMode(false);
  }, [tenantProfileQuery.data]);

  useEffect(() => {
    setCheckoutSessionsPage(1);
  }, [
    checkoutSessionStatusFilter,
    checkoutSessionTenantId,
    checkoutSessionFeFilter,
    checkoutSessionQuickSearch,
    checkoutSessionsViewTab,
    checkoutSessionsSortBy,
    checkoutSessionsSortDir,
  ]);

  useEffect(() => {
    setSupportPage(1);
    setExpandedSupportTicketId(null);
  }, [supportTenantFilter, supportStatusFilter, supportPriorityFilter, supportQuickSearch, supportSortBy, supportSortDir]);

  useEffect(() => {
    setAuditPage(1);
    setExpandedAuditLogId(null);
  }, [auditActionFilter, auditActorFilter, auditTenantFilter, auditDateFrom, auditDateTo, auditQuickSearch, auditSortBy, auditSortDir]);

  const tenantLogoMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTenantId) {
        throw new Error('Sin tenant seleccionado');
      }
      if (tenantLogoMode === 'file') {
        if (!tenantLogoFile) {
          throw new Error('Selecciona un archivo de imagen');
        }
        return patchSaasTenantLogo(selectedTenantId, { logoFile: tenantLogoFile });
      }
      const u = tenantLogoUrl.trim();
      if (!u) {
        throw new Error('Ingresa la URL del logo');
      }
      return patchSaasTenantLogo(selectedTenantId, { logoUrl: u });
    },
    onSuccess: () => {
      setTenantLogoError('');
      setTenantLogoUrl('');
      setTenantLogoFile(null);
      queryClient.invalidateQueries({ queryKey: ['saas-tenant-profile', selectedTenantId] });
      queryClient.invalidateQueries({ queryKey: ['saas-tenants-list'] });
    },
    onError: (err: unknown) => {
      const detail =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      if (err instanceof Error && err.message && !detail) {
        setTenantLogoError(err.message);
        return;
      }
      setTenantLogoError(typeof detail === 'string' ? detail : 'No se pudo actualizar el logo.');
    },
  });

  const patchSedeUbicacionMutation = useMutation({
    mutationFn: async (args: {
      tenantId: string;
      sucursalId: string;
      direccion: string | null;
      ciudad: string | null;
      factus_municipality_id: number | null;
    }) =>
      patchSaasSucursalUbicacion(args.tenantId, args.sucursalId, {
        direccion: args.direccion,
        ciudad: args.ciudad,
        factus_municipality_id: args.factus_municipality_id,
      }),
    onSuccess: () => {
      setSedeUbicacionEdit(null);
      setSedeUbicacionError('');
      queryClient.invalidateQueries({ queryKey: ['saas-tenant-profile', selectedTenantId] });
    },
    onError: (err: unknown) => {
      const detail =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setSedeUbicacionError(typeof detail === 'string' ? detail : 'No se pudo guardar.');
    },
  });

  const tenantCoreMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTenantId) {
        throw new Error('Sin tenant seleccionado');
      }
      return patchSaasTenantCoreData(selectedTenantId, {
        nombre: tenantCoreNombre.trim() || null,
        nombre_comercial: tenantCoreNombreComercial.trim() || null,
        nit_cda: tenantCoreNit.trim() || null,
        correo_electronico: tenantCoreCorreo.trim() || null,
        nombre_representante: tenantCoreRepresentante.trim() || null,
        celular: tenantCoreCelular.trim() || null,
        nomina_enabled: tenantCoreNominaEnabled,
        exogena_enabled: tenantCoreExogenaEnabled,
        sarlaft_enabled: tenantCoreSarlaftEnabled,
        sarlaft_mode: tenantCoreSarlaftMode,
      });
    },
    onSuccess: () => {
      setTenantCoreError('');
      setTenantCoreEditMode(false);
      queryClient.invalidateQueries({ queryKey: ['saas-tenant-profile', selectedTenantId] });
      queryClient.invalidateQueries({ queryKey: ['saas-tenants-list'] });
    },
    onError: (err: unknown) => {
      const detail =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      if (err instanceof Error && err.message && !detail) {
        setTenantCoreError(err.message);
        return;
      }
      setTenantCoreError(typeof detail === 'string' ? detail : 'No se pudo actualizar los datos del tenant.');
    },
  });

  const tenantDocumentosQuotaMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTenantId) {
        throw new Error('Sin tenant seleccionado');
      }
      const raw = tenantCoreDocumentosQuotaMb.trim();
      let documentos_quota_mb: number | null = null;
      if (raw) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          throw new Error('Use un entero ≥ 0, o vacío para el default del servidor.');
        }
        documentos_quota_mb = n;
      }
      return patchSaasTenantCoreData(selectedTenantId, { documentos_quota_mb });
    },
    onSuccess: () => {
      setTenantDocumentosQuotaError('');
      queryClient.invalidateQueries({ queryKey: ['saas-tenant-profile', selectedTenantId] });
      queryClient.invalidateQueries({ queryKey: ['saas-tenants-list'] });
    },
    onError: (err: unknown) => {
      const detail =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      if (err instanceof Error && err.message && !detail) {
        setTenantDocumentosQuotaError(err.message);
        return;
      }
      setTenantDocumentosQuotaError(typeof detail === 'string' ? detail : 'No se pudo guardar la cuota.');
    },
  });

  const opensanctionsCustomRangeInvalid =
    opensanctionsDays === OPENSANCTIONS_CUSTOM_WINDOW &&
    (!opensanctionsDateFrom || !opensanctionsDateTo || opensanctionsDateFrom > opensanctionsDateTo);

  const billingOverviewQuery = useQuery({
    queryKey: ['saas-billing-overview'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSBillingOverviewItem[]>('/saas/auth/billing/overview');
      return response.data;
    },
    enabled: activeModule === 'facturacion',
  });
  const opensanctionsUsageQuery = useQuery({
    queryKey: [
      'saas-opensanctions-usage-summary',
      opensanctionsDays,
      opensanctionsDateFrom,
      opensanctionsDateTo,
      opensanctionsTenantId,
      opensanctionsTrm,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      const now = new Date();

      let fromIso = '';
      let toIso = '';
      if (opensanctionsDays === OPENSANCTIONS_CUSTOM_WINDOW) {
        fromIso = bogotaDayStartUtcIso(opensanctionsDateFrom);
        toIso = bogotaDayEndUtcIso(opensanctionsDateTo);
      } else if (opensanctionsDays === 0) {
        const todayBogota = toBogotaYmd(now);
        fromIso = bogotaDayStartUtcIso(todayBogota);
        toIso = now.toISOString();
      } else if (opensanctionsDays === 1) {
        fromIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        toIso = now.toISOString();
      } else {
        const todayBogota = toBogotaYmd(now);
        const startBogota = shiftYmd(todayBogota, -(opensanctionsDays - 1));
        fromIso = bogotaDayStartUtcIso(startBogota);
        toIso = now.toISOString();
      }

      params.set('from_date', fromIso);
      params.set('to_date', toIso);
      params.set('trm_cop', String(opensanctionsTrm));
      if (opensanctionsTenantId) {
        params.set('tenant_id', opensanctionsTenantId);
      }
      const response = await apiClient.get<SaaSOpenSanctionsUsageSummary>(
        `/saas/auth/billing/opensanctions/usage?${params.toString()}`,
      );
      return response.data;
    },
    enabled: (activeModule === 'facturacion' || activeModule === 'opensanctions_metricas') && !opensanctionsCustomRangeInvalid,
  });

  const checkoutSessionsQuery = useQuery({
    queryKey: [
      'saas-billing-checkout-sessions',
      checkoutSessionsPage,
      checkoutSessionsSortBy,
      checkoutSessionsSortDir,
      checkoutSessionsViewTab,
      checkoutSessionQuickSearch,
      checkoutSessionStatusFilter,
      checkoutSessionTenantId,
      checkoutSessionFeFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(checkoutSessionsPage));
      params.set('page_size', '20');
      params.set('view_tab', checkoutSessionsViewTab);
      params.set('sort_by', checkoutSessionsSortBy);
      params.set('sort_dir', checkoutSessionsSortDir);
      if (checkoutSessionStatusFilter) {
        params.set('status', checkoutSessionStatusFilter);
      }
      if (checkoutSessionTenantId) {
        params.set('tenant_id', checkoutSessionTenantId);
      }
      if (checkoutSessionFeFilter) {
        params.set('fe_status', checkoutSessionFeFilter);
      }
      if (checkoutSessionQuickSearch.trim()) {
        params.set('q', checkoutSessionQuickSearch.trim());
      }
      const response = await apiClient.get<SaaSCheckoutSessionListResponse>(
        `/saas/auth/billing/checkout-sessions?${params.toString()}`,
      );
      return response.data;
    },
    enabled: activeModule === 'facturacion',
  });

  const saasFactusIssuerConfigQuery = useQuery({
    queryKey: ['saas-factus-issuer-config'],
    queryFn: async () => {
      const response = await apiClient.get<SaaSFactusIssuerConfig>('/saas/auth/billing/saas-factus/config');
      return response.data;
    },
    enabled: activeModule === 'facturacion',
  });

  const saasFactusIssuerTestMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<SaaSFactusIssuerTestResult>('/saas/auth/billing/saas-factus/test-connection');
      return response.data;
    },
    onSuccess: (data) => {
      if (data.ok) {
        setBillingActionError('');
        setBillingActionSuccess(
          `${data.message} (${data.environment}${typeof data.numbering_ranges_found === 'number' ? `, rangos: ${data.numbering_ranges_found}` : ''})`,
        );
      } else {
        setBillingActionSuccess('');
        setBillingActionError(data.message);
      }
    },
    onError: (err: any) => {
      setBillingActionSuccess('');
      setBillingActionError(err?.response?.data?.detail || 'No fue posible probar la conexión Factus SaaS.');
    },
  });

  const downloadCheckoutSessionsCsv = (rowsOverride?: SaaSCheckoutSessionItem[]) => {
    const rows = rowsOverride ?? checkoutSessionsQuery.data?.items;
    if (!rows?.length) {
      return;
    }
    const header = [
      'created_at',
      'tenant_slug',
      'tenant_nombre',
      'plan_code',
      'total_cop',
      'session_id',
      'status_pago',
      'saas_fe_status',
      'saas_fe_error_category',
      'saas_fe_reference_code',
      'saas_fe_error',
      'numero_documento',
      'cufe',
      'public_url',
      'payment_provider',
      'payment_ref',
      'epayco_ref',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          escapeCsvField(new Date(r.created_at).toISOString()),
          escapeCsvField(r.tenant_slug),
          escapeCsvField(r.tenant_nombre),
          escapeCsvField(r.plan_code),
          escapeCsvField(String(r.total_cop)),
          escapeCsvField(r.session_id),
          escapeCsvField(r.status),
          escapeCsvField(r.saas_fe_status ?? ''),
          escapeCsvField(r.saas_fe_error_category ?? ''),
          escapeCsvField(r.saas_fe_reference_code ?? ''),
          escapeCsvField(r.saas_fe_error ?? ''),
          escapeCsvField(r.numero_documento ?? ''),
          escapeCsvField(r.cufe ?? ''),
          escapeCsvField(r.public_url ?? ''),
          escapeCsvField(r.payment_provider ?? ''),
          escapeCsvField(r.payment_ref ?? ''),
          escapeCsvField(r.epayco_ref ?? ''),
        ].join(','),
      );
    }
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `checkout_sesiones_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const downloadCheckoutSessionsCsvServer = async () => {
    const params = new URLSearchParams();
    params.set('view_tab', checkoutSessionsViewTab);
    params.set('sort_by', checkoutSessionsSortBy);
    params.set('sort_dir', checkoutSessionsSortDir);
    params.set('max_rows', '5000');
    if (checkoutSessionTenantId) params.set('tenant_id', checkoutSessionTenantId);
    if (checkoutSessionStatusFilter) params.set('status', checkoutSessionStatusFilter);
    if (checkoutSessionFeFilter) params.set('fe_status', checkoutSessionFeFilter);
    if (checkoutSessionQuickSearch.trim()) params.set('q', checkoutSessionQuickSearch.trim());

    const response = await apiClient.get(`/saas/auth/billing/checkout-sessions/export?${params.toString()}`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `checkout_sesiones_filtradas_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

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

  const updateSupportTicketMutation = useMutation({
    mutationFn: async ({
      ticketId,
      status,
      tenantResponseMessage,
    }: {
      ticketId: string;
      status: string;
      tenantResponseMessage?: string;
    }) => {
      const response = await apiClient.patch<SaaSSupportTicketItem>(`/saas/auth/support/tickets/${ticketId}`, {
        status,
        tenant_response_message: tenantResponseMessage,
      });
      return response.data;
    },
    onSuccess: () => {
      setSupportActionError('');
      setSupportActionSuccess('Ticket actualizado correctamente.');
      queryClient.invalidateQueries({ queryKey: ['saas-support-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['saas-support-summary'] });
      setSupportReplyTicketId(null);
      setSupportReplyMessage('');
    },
    onError: (err: any) => {
      setSupportActionSuccess('');
      setSupportActionError(err?.response?.data?.detail || 'No fue posible actualizar el ticket.');
    },
  });

  const auditLogsQuery = useQuery({
    queryKey: [
      'saas-audit-logs',
      auditActionFilter,
      auditActorFilter,
      auditTenantFilter,
      auditDateFrom,
      auditDateTo,
      auditQuickSearch,
      auditPage,
      auditSortBy,
      auditSortDir,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', String(auditPage));
      params.append('page_size', '20');
      params.append('sort_by', auditSortBy);
      params.append('sort_dir', auditSortDir);
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
      if (auditQuickSearch.trim()) {
        params.append('q', auditQuickSearch.trim());
      }
      const response = await apiClient.get<SaaSAuditLogListResponse>(`/saas/auth/audit-logs?${params.toString()}`);
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
        `Plan ${data.plan_label} asignado a /${data.tenant_slug}. Total periodo: ${formatCurrency(data.total)}`,
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
      queryClient.invalidateQueries({ queryKey: ['saas-billing-checkout-sessions'] });
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
      queryClient.invalidateQueries({ queryKey: ['saas-billing-checkout-sessions'] });
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
      if (resendResetTimeoutRef.current) {
        clearTimeout(resendResetTimeoutRef.current);
      }
      resendResetTimeoutRef.current = setTimeout(() => {
        setResentPaymentLogId((current) => (current === resendReceiptMutation.variables ? null : current));
      }, 2500);
    },
    onError: (err: any) => {
      setBillingActionSuccess('');
      setBillingActionError(err?.response?.data?.detail || 'No fue posible reenviar el recibo. Intenta nuevamente.');
    },
  });

  const retrySaaSCheckoutFeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await apiClient.post<{
        saas_fe_status?: string | null;
        saas_fe_error?: string | null;
      }>(
        `/saas/auth/billing/checkout-sessions/${encodeURIComponent(sessionId)}/retry-saas-factus`,
      );
      return response.data;
    },
    onSuccess: (data) => {
      setBillingActionError('');
      if ((data?.saas_fe_status || '') === 'ok') {
        setBillingActionSuccess('Factura electrónica (licencia) emitida correctamente.');
      } else {
        setBillingActionSuccess('Reintento ejecutado. Revise el detalle FE para validar el resultado.');
      }
      queryClient.invalidateQueries({ queryKey: ['saas-billing-checkout-sessions'] });
    },
    onError: (err: any) => {
      setBillingActionSuccess('');
      setBillingActionError(err?.response?.data?.detail || 'No se pudo reintentar la emisión DIAN (licencia).');
    },
  });

  const handleLogout = () => {
    const redirectPath = getLogoutRedirectPath();
    logout();
    navigate(redirectPath);
  };

  const handleCopyLoginUrl = async (tenantId: string, loginUrl: string) => {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopiedTenantId(tenantId);
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = setTimeout(() => setCopiedTenantId(null), 2000);
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
    params.append('max_rows', '5000');
    params.append('sort_by', auditSortBy);
    params.append('sort_dir', auditSortDir);
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
    if (auditQuickSearch.trim()) {
      params.append('q', auditQuickSearch.trim());
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
            <BackofficeSectionHeading
              className="mb-4"
              icon={KeyRound}
              title="Permisos efectivos"
              description="Permisos globales de tu rol en la plataforma"
            />
            {permissionsQuery.isLoading && <LoadingBlock lines={2} />}
            {permissionsQuery.isError && (
              <p className="text-sm text-red-600">No se pudieron cargar permisos globales.</p>
            )}
            {permissionsQuery.data && (
              <div className="flex flex-wrap gap-2">
                {permissionsQuery.data.permissions.map((permission, idx) => (
                  <span
                    key={`${permission}-${idx}`}
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

    if (activeModule === 'runt_metricas') {
      return (
        <div className="space-y-6">
          <div className="section-card p-6">
            <BackofficeSectionHeading
              className="mb-4"
              icon={Activity}
              title="Métricas RUNT por proveedor"
              description="Consumo, éxito y fallback de consultas para control de costos SaaS."
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <label className="text-sm text-slate-700">
                Ventana
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={runtMetricasDays}
                  onChange={(e) => setRuntMetricasDays(Number(e.target.value))}
                >
                  <option value={0}>Hoy (desde 00:00)</option>
                  <option value={1}>1 día (últimas 24h)</option>
                  <option value={7}>7 días</option>
                  <option value={30}>30 días</option>
                  <option value={90}>90 días</option>
                  <option value={RUNT_CUSTOM_WINDOW}>Rango personalizado</option>
                </select>
              </label>
              <label className="text-sm text-slate-700 md:col-span-2">
                Tenant (opcional)
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={runtMetricasTenantId}
                  onChange={(e) => setRuntMetricasTenantId(e.target.value)}
                >
                  <option value="">Todos los tenants</option>
                  {(tenantsQuery.data || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre_comercial} (/{t.slug})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {runtMetricasDays === RUNT_CUSTOM_WINDOW && (
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="text-sm text-slate-700">
                  Desde (fecha local Colombia)
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={runtDateFrom}
                    onChange={(e) => setRuntDateFrom(e.target.value)}
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Hasta (fecha local Colombia)
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={runtDateTo}
                    onChange={(e) => setRuntDateTo(e.target.value)}
                  />
                </label>
              </div>
            )}
            {runtCustomRangeInvalid && (
              <p className="mb-3 text-sm text-amber-700">
                Define un rango válido: la fecha inicial debe ser menor o igual a la final.
              </p>
            )}

            {runtMetricasQuery.isLoading && <LoadingBlock lines={4} />}
            {runtMetricasQuery.isError && (
              <p className="text-sm text-red-600">No fue posible cargar métricas RUNT del backoffice.</p>
            )}
            {runtMetricasQuery.data && (
              <div className="space-y-4">
                {(() => {
                  const data = runtMetricasQuery.data;
                  const verifikRow = data.by_provider.find((x) => String(x.provider || '').toLowerCase() === 'verifik');
                  const verifikConsultas = Number(verifikRow?.consultas || 0);
                  return (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <div className={`rounded-lg border px-3 py-2 text-xs ${
                        data.success_rate_pct < 85 ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      }`}>
                        <p className="font-semibold">Salud de resolución</p>
                        <p>{data.success_rate_pct < 85 ? 'Alerta: éxito bajo (meta >= 85%)' : 'OK: tasa de éxito saludable'}</p>
                      </div>
                      <div className={`rounded-lg border px-3 py-2 text-xs ${
                        data.fallback_rate_pct > 40 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-sky-200 bg-sky-50 text-sky-800'
                      }`}>
                        <p className="font-semibold">Uso de fallback</p>
                        <p>{data.fallback_rate_pct > 40 ? 'Alerta: fallback alto (revisar proveedor principal)' : 'OK: fallback controlado'}</p>
                      </div>
                      <div className={`rounded-lg border px-3 py-2 text-xs ${
                        verifikConsultas > 0 ? 'border-violet-200 bg-violet-50 text-violet-800' : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}>
                        <p className="font-semibold">Respaldo del respaldo</p>
                        <p>{verifikConsultas > 0 ? `Verifik activo (${verifikConsultas} consultas en periodo)` : 'Sin uso de Verifik en el periodo'}</p>
                      </div>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div className="kpi-card">
                    <p className="kpi-label">Consultas</p>
                    <p className="kpi-value">{runtMetricasQuery.data.total_consultas}</p>
                  </div>
                  <div className="kpi-card">
                    <p className="kpi-label">Éxito</p>
                    <p className="kpi-value text-emerald-700">{runtMetricasQuery.data.success_rate_pct}%</p>
                  </div>
                  <div className="kpi-card">
                    <p className="kpi-label">Fallback</p>
                    <p className="kpi-value text-amber-700">{runtMetricasQuery.data.fallback_rate_pct}%</p>
                  </div>
                  <div className="kpi-card">
                    <p className="kpi-label">Costo total</p>
                    <p className="kpi-value">{formatCurrency(runtMetricasQuery.data.costo_estimado_total_cop)}</p>
                    <p className="text-xs text-slate-500">{formatUsd(runtMetricasQuery.data.costo_estimado_total_usd)}</p>
                  </div>
                  <div className="kpi-card">
                    <p className="kpi-label">TRM promedio</p>
                    <p className="kpi-value">{formatCurrency(runtMetricasQuery.data.fx_rate_avg_usd_cop)}</p>
                    <p className="text-xs text-slate-500">USD/COP</p>
                  </div>
                  <div className="kpi-card">
                    <p className="kpi-label">Costo promedio</p>
                    <p className="kpi-value">{formatCurrency(runtMetricasQuery.data.costo_promedio_cop)}</p>
                    <p className="text-xs text-slate-500">{formatUsd(runtMetricasQuery.data.costo_promedio_usd)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Costo proveedor resuelto (sin extra fallback)</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {formatCurrency(runtMetricasQuery.data.costo_resuelto_total_cop)} · {formatUsd(runtMetricasQuery.data.costo_resuelto_total_usd)}
                    </p>
                  </div>
                </div>
                {runtMetricasQuery.data.from_date && runtMetricasQuery.data.to_date && (
                  <p className="text-xs text-slate-500">
                    Periodo: {new Date(runtMetricasQuery.data.from_date).toLocaleDateString('es-CO', { timeZone: BOGOTA_TIME_ZONE })} -{' '}
                    {new Date(runtMetricasQuery.data.to_date).toLocaleDateString('es-CO', { timeZone: BOGOTA_TIME_ZONE })}
                  </p>
                )}

                <div className="section-card p-4 border border-slate-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Coins className="w-4 h-4 text-slate-500" />
                    <p className="text-sm font-semibold text-slate-800">Por proveedor</p>
                  </div>
                  <div className="table-shell">
                    <table className="table-enterprise">
                      <thead>
                        <tr>
                          <th>Proveedor</th>
                          <th>Consultas</th>
                          <th>Costo total (COP / USD)</th>
                          <th>Resuelto (COP / USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runtMetricasQuery.data.by_provider.map((row) => (
                          <tr key={row.provider}>
                            <td className="font-semibold text-slate-900">{row.provider}</td>
                            <td>{row.consultas}</td>
                            <td>
                              {formatCurrency(row.costo_estimado_cop)}
                              <span className="block text-xs text-slate-500">{formatUsd(row.costo_estimado_usd)}</span>
                            </td>
                            <td>
                              {formatCurrency(row.costo_resuelto_cop)}
                              <span className="block text-xs text-slate-500">{formatUsd(row.costo_resuelto_usd)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="section-card p-4 border border-slate-200">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-800">Top tenants por consultas</p>
                    <span className="text-xs text-slate-500">Etiqueta verde: menor costo promedio resuelto</span>
                  </div>
                  <div className="table-shell">
                    <table className="table-enterprise">
                      <thead>
                        <tr>
                          <th>Tenant</th>
                          <th>Consultas totales</th>
                          <th>Resueltas</th>
                          <th>No resueltas</th>
                          <th>PlacaAPI resueltas</th>
                          <th>Costo PlacaAPI (COP / USD)</th>
                          <th>CoreSoft resueltas</th>
                          <th>Costo CoreSoft (COP / USD)</th>
                          <th>Verifik resueltas</th>
                          <th>Costo Verifik (COP / USD)</th>
                          <th>Costo total (COP / USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runtMetricasQuery.data.by_tenant.length === 0 ? (
                          <tr>
                            <td colSpan={11} className="text-slate-500">
                              Sin datos en el período seleccionado.
                            </td>
                          </tr>
                        ) : (
                          runtMetricasQuery.data.by_tenant.map((row) => {
                            const efficiency = getTenantProviderEfficiency(row);
                            return (
                            <tr key={row.tenant_slug}>
                              <td className="font-semibold text-slate-900">
                                {row.tenant_nombre} <span className="text-xs text-slate-500">/{row.tenant_slug}</span>
                              </td>
                              <td>{row.consultas}</td>
                              <td>{row.resueltas}</td>
                              <td>
                                <span className={row.no_resueltas > 0 ? 'font-semibold text-amber-700' : 'text-slate-500'}>
                                  {row.no_resueltas}
                                </span>
                              </td>
                              <td>
                                {row.placaapi_resueltas}
                              </td>
                              <td>
                                <span className={efficiency.placaapi ? 'font-semibold text-emerald-700' : undefined}>
                                  {formatCurrency(row.placaapi_costo_resuelto_cop)}
                                </span>
                                <span className="block text-xs text-slate-500">{formatUsd(row.placaapi_costo_resuelto_usd)}</span>
                                {efficiency.placaapi && (
                                  <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200/70">
                                    Más eficiente
                                  </span>
                                )}
                              </td>
                              <td>
                                {row.coresoft_resueltas}
                              </td>
                              <td>
                                <span className={efficiency.coresoft ? 'font-semibold text-emerald-700' : undefined}>
                                  {formatCurrency(row.coresoft_costo_resuelto_cop)}
                                </span>
                                <span className="block text-xs text-slate-500">{formatUsd(row.coresoft_costo_resuelto_usd)}</span>
                                {efficiency.coresoft && (
                                  <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200/70">
                                    Más eficiente
                                  </span>
                                )}
                              </td>
                              <td>
                                {row.verifik_resueltas}
                              </td>
                              <td>
                                <span className={efficiency.verifik ? 'font-semibold text-emerald-700' : undefined}>
                                  {formatCurrency(row.verifik_costo_resuelto_cop)}
                                </span>
                                <span className="block text-xs text-slate-500">{formatUsd(row.verifik_costo_resuelto_usd)}</span>
                                {efficiency.verifik && (
                                  <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200/70">
                                    Más eficiente
                                  </span>
                                )}
                              </td>
                              <td>
                                {formatCurrency(row.costo_resuelto_cop)}
                                <span className="block text-xs text-slate-500">{formatUsd(row.costo_resuelto_usd)}</span>
                              </td>
                            </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeModule === 'opensanctions_metricas') {
      return (
        <div className="space-y-6">
          <div className="section-card p-6">
            <BackofficeSectionHeading
              className="mb-4"
              icon={Coins}
              title="Consumo OpenSanctions (API real)"
              description="Medición global CDASoft y por CDA (incluye todas sus sucursales)"
            />
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="text-sm text-slate-700">
                Ventana
                <select
                  className="input mt-1 w-full"
                  value={opensanctionsDays}
                  onChange={(e) => setOpensanctionsDays(Number(e.target.value))}
                >
                  <option value={0}>Hoy (desde 00:00)</option>
                  <option value={1}>1 día (últimas 24h)</option>
                  <option value={30}>30 días</option>
                  <option value={90}>90 días</option>
                  <option value={365}>365 días</option>
                  <option value={OPENSANCTIONS_CUSTOM_WINDOW}>Rango personalizado</option>
                </select>
              </label>
              <label className="text-sm text-slate-700">
                Tenant (opcional)
                <select
                  className="input mt-1 w-full"
                  value={opensanctionsTenantId}
                  onChange={(e) => setOpensanctionsTenantId(e.target.value)}
                >
                  <option value="">Todos</option>
                  {(tenantsQuery.data || []).map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.nombre_comercial || tenant.nombre} / {tenant.slug}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-700">
                TRM (EUR/COP)
                <input
                  type="number"
                  min={1}
                  step={0.01}
                  className="input mt-1 w-full"
                  value={Number.isFinite(opensanctionsTrm) ? opensanctionsTrm : 4379}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setOpensanctionsTrm(Number.isFinite(n) && n > 0 ? n : 4379);
                  }}
                />
              </label>
            </div>
            {opensanctionsDays === OPENSANCTIONS_CUSTOM_WINDOW && (
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="text-sm text-slate-700">
                  Desde (fecha local Colombia)
                  <input
                    type="date"
                    className="input mt-1 w-full"
                    value={opensanctionsDateFrom}
                    onChange={(e) => setOpensanctionsDateFrom(e.target.value)}
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Hasta (fecha local Colombia)
                  <input
                    type="date"
                    className="input mt-1 w-full"
                    value={opensanctionsDateTo}
                    onChange={(e) => setOpensanctionsDateTo(e.target.value)}
                  />
                </label>
              </div>
            )}
            {opensanctionsCustomRangeInvalid && (
              <p className="mb-3 text-sm text-amber-700">
                Define un rango válido: la fecha inicial debe ser menor o igual a la final.
              </p>
            )}
            {opensanctionsUsageQuery.isLoading && <LoadingBlock lines={3} />}
            {opensanctionsUsageQuery.isError && (
              <p className="text-sm text-red-600">No fue posible cargar el consumo de OpenSanctions.</p>
            )}
            {opensanctionsUsageQuery.data && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2 text-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-9">
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                    <p className="text-slate-500">Total llamadas</p>
                    <p className="font-semibold text-slate-900">{opensanctionsUsageQuery.data.total_calls.toLocaleString('es-CO')}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                    <p className="text-slate-500">Recepción</p>
                    <p className="font-semibold text-indigo-700">{opensanctionsUsageQuery.data.recepcion_calls.toLocaleString('es-CO')}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                    <p className="text-slate-500">Manual</p>
                    <p className="font-semibold text-emerald-700">{opensanctionsUsageQuery.data.manual_calls.toLocaleString('es-CO')}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                    <p className="text-slate-500">Lote</p>
                    <p className="font-semibold text-violet-700">{opensanctionsUsageQuery.data.lote_calls.toLocaleString('es-CO')}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                    <p className="text-slate-500">Costo estimado EUR</p>
                    <p className="font-semibold text-slate-900">{formatEur(opensanctionsUsageQuery.data.estimated_cost_eur)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                    <p className="text-slate-500">Costo estimado COP</p>
                    <p className="font-semibold text-slate-900">{formatCurrency(opensanctionsUsageQuery.data.estimated_cost_cop)}</p>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-2 py-1.5 shadow-sm">
                    <p className="text-slate-500">Neto facturable COP</p>
                    <p className="font-semibold text-indigo-700">{formatCurrency(opensanctionsUsageQuery.data.billed_subtotal_cop)}</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-2 py-1.5 shadow-sm">
                    <p className="text-slate-500">IVA facturable COP</p>
                    <p className="font-semibold text-amber-700">{formatCurrency(opensanctionsUsageQuery.data.billed_iva_cop)}</p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-2 py-1.5 shadow-sm">
                    <p className="text-slate-500">Total facturable COP</p>
                    <p className="font-semibold text-emerald-700">{formatCurrency(opensanctionsUsageQuery.data.billed_total_cop)}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Periodo: {new Date(opensanctionsUsageQuery.data.from_date).toLocaleDateString('es-CO', { timeZone: BOGOTA_TIME_ZONE })} -{' '}
                  {new Date(opensanctionsUsageQuery.data.to_date).toLocaleDateString('es-CO', { timeZone: BOGOTA_TIME_ZONE })} · TRM usada:{' '}
                  {opensanctionsUsageQuery.data.trm_cop.toLocaleString('es-CO')} · Costo proveedor por llamada:{' '}
                  {formatEur(opensanctionsUsageQuery.data.cost_per_call_eur)}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-800">
                    Modelo: {opensanctionsUsageQuery.data.pricing_model}
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
                    Precio prepago por consulta: {formatCurrency(opensanctionsUsageQuery.data.prepaid_unit_price_cop)}
                  </span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
                    Vigencia paquete: {opensanctionsUsageQuery.data.prepaid_package_expires_days} días
                  </span>
                  <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 font-medium text-fuchsia-800">
                    Precio venta CDA por consulta: {formatCurrency(opensanctionsUsageQuery.data.billed_unit_price_cop)}
                    {' '}+ IVA {opensanctionsUsageQuery.data.billed_iva_pct.toLocaleString('es-CO')}%
                  </span>
                </div>
                {opensanctionsUsageQuery.data.tenants.length > 0 ? (
                  <div className="table-shell">
                    <table className="table-enterprise">
                      <thead>
                        <tr>
                          <th className="whitespace-nowrap">CDA</th>
                          <th className="whitespace-nowrap text-right">Recepción</th>
                          <th className="whitespace-nowrap text-right">Manual</th>
                          <th className="whitespace-nowrap text-right">Lote</th>
                          <th className="whitespace-nowrap text-right">Total</th>
                          <th className="whitespace-nowrap text-right">Costo EUR</th>
                          <th className="whitespace-nowrap text-right">Costo COP</th>
                          <th className="whitespace-nowrap text-right">Neto facturable COP</th>
                          <th className="whitespace-nowrap text-right">IVA COP</th>
                          <th className="whitespace-nowrap text-right">Total facturable COP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opensanctionsUsageQuery.data.tenants.map((item) => (
                          <tr key={item.tenant_id}>
                            <td className="font-semibold text-slate-900">
                              {item.tenant_nombre}
                              <span className="ml-1 text-[11px] font-normal text-slate-500">/{item.tenant_slug}</span>
                            </td>
                            <td className="text-right tabular-nums">{item.recepcion_calls.toLocaleString('es-CO')}</td>
                            <td className="text-right tabular-nums">{item.manual_calls.toLocaleString('es-CO')}</td>
                            <td className="text-right tabular-nums">{item.lote_calls.toLocaleString('es-CO')}</td>
                            <td className="text-right tabular-nums font-semibold text-slate-900">{item.total_calls.toLocaleString('es-CO')}</td>
                            <td className="text-right tabular-nums">{formatEur(item.estimated_cost_eur)}</td>
                            <td className="text-right tabular-nums">{formatCurrency(item.estimated_cost_cop)}</td>
                            <td className="text-right tabular-nums">{formatCurrency(item.billed_subtotal_cop)}</td>
                            <td className="text-right tabular-nums">{formatCurrency(item.billed_iva_cop)}</td>
                            <td className="text-right tabular-nums font-semibold text-emerald-700">{formatCurrency(item.billed_total_cop)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState message="No hay consumo OpenSanctions en el periodo seleccionado." />
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeModule === 'tenants') {
      return (
        <div className="space-y-6">
          <div className="section-card p-6 ring-1 ring-indigo-100/70">
            <BackofficeSectionHeading
              className="mb-4"
              icon={Building2}
              title="Tenants CDA"
              description="Centros de diagnóstico registrados y su estado comercial"
              right={
                <span className="text-xs font-medium rounded-full bg-white/90 px-2.5 py-1 text-slate-700 ring-1 ring-slate-200/80 shadow-sm">
                  Total: {tenantsQuery.data?.length || 0}
                </span>
              }
            />
            {tenantsQuery.isLoading && <LoadingBlock lines={4} />}
            {tenantsQuery.isError && <p className="text-sm text-red-600">No fue posible cargar la lista de tenants.</p>}
            {tenantsQuery.data && (
              tenantsQuery.data.length === 0 ? (
                <EmptyState message="Aún no hay tenants registrados en la plataforma." />
              ) : (
              <div className="table-shell">
                <table className="table-enterprise">
                  <thead>
                    <tr>
                      <th>CDA</th>
                      <th>Contacto</th>
                      <th>Plan</th>
                      <th>Sucursales</th>
                      <th>Estado</th>
                      <th>Próx. cobro</th>
                      <th className="table-enterprise-col-actions">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenantsQuery.data.map((tenant) => (
                      <tr key={tenant.id}>
                        <td>
                          <p className="font-semibold uppercase tracking-tight text-slate-900">{tenant.nombre_comercial}</p>
                          <p className="mt-0.5 text-xs text-slate-500">/{tenant.slug}</p>
                        </td>
                        <td className="text-slate-700">{tenant.correo_electronico || '-'}</td>
                        <td>
                          <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold uppercase text-indigo-800">
                            {tenant.plan_actual}
                          </span>
                        </td>
                        <td>{branchChargeSummary(tenant.sedes_totales, tenant.sucursales_facturables)}</td>
                        <td>
                          <span className={statusBadgeClass(tenant.subscription_status)}>
                            {subscriptionStatusLabel(tenant.subscription_status)}
                          </span>
                        </td>
                        <td>
                          {tenant.next_billing_at ? new Date(tenant.next_billing_at).toLocaleDateString() : '-'}
                        </td>
                        <td className="table-enterprise-col-actions">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openTenantSheet(tenant)}
                              className="btn-chip border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100"
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
            <BackofficeSectionHeading
              className="mb-4"
              icon={Users}
              title="Usuarios SaaS internos"
              description="Equipo interno con acceso al backoffice"
            />
            {usersQuery.isLoading && <LoadingBlock lines={3} />}
            {usersQuery.isError && <p className="text-sm text-red-600">No fue posible cargar los usuarios SaaS.</p>}
            {usersQuery.data && (
              usersQuery.data.length === 0 ? (
                <EmptyState message="No hay usuarios SaaS creados todavía." />
              ) : (
              <div className="table-shell">
                <table className="table-enterprise">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Email</th>
                      <th>Rol global</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersQuery.data.map((u) => (
                      <tr key={u.id}>
                        <td className="font-semibold text-slate-900">{u.nombre_completo}</td>
                        <td className="text-slate-600">{u.email}</td>
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
            <BackofficeSectionHeading
              className="mb-4"
              icon={UserPlus}
              title="Crear usuario SaaS"
              description="Alta de cuentas para el equipo CDA Soft"
            />
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
      const checkoutList = checkoutSessionsQuery.data;
      const checkoutRowsPage = checkoutList?.items ?? [];
      const checkoutTabCounts = checkoutList?.counts ?? { all: 0, pending: 0, paid: 0, fe_issue: 0 };
      const checkoutTotalPages = checkoutList?.total_pages ?? 1;
      const safeCheckoutPage = checkoutList?.page ?? checkoutSessionsPage;
      const checkoutFilteredTotal = checkoutList?.total ?? 0;

      return (
        <div className="space-y-6">
          {billingActionError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{billingActionError}</p>
          )}
          {billingActionSuccess && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              {billingActionSuccess}
            </p>
          )}

          <div className="section-card p-6 ring-1 ring-violet-200/80 bg-violet-50/30">
            <BackofficeSectionHeading
              className="mb-4"
              icon={FileText}
              title="Pagos en línea (suscripción) y factura de licencia"
              description="Sesiones de pago del CDA; emisión DIAN vía el emisor SaaS (PROMETHEUS). Distinto al Factus que el CDA usa en operación."
            />
            <p className="text-xs text-slate-500 mb-3">
              Filtre por tenant, estado del pago (PSP) o estado de la factura de licencia (DIAN / Factus SaaS). El CSV
              refleja la página visible con los filtros activos.
            </p>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">Configuración Factus emisor SaaS (PROMETHEUS)</p>
              <p className="mt-1 text-xs text-slate-600">
                Este bloque corresponde a la factura de licencia de CDASOFT (emisor SaaS). Es independiente del Factus
                que cada tenant configura para su operación diaria.
              </p>
              {saasFactusIssuerConfigQuery.isLoading && (
                <p className="mt-3 text-xs text-slate-500">Cargando estado de configuración…</p>
              )}
              {saasFactusIssuerConfigQuery.isError && (
                <p className="mt-3 text-xs text-red-600">No fue posible consultar la configuración Factus SaaS.</p>
              )}
              {saasFactusIssuerConfigQuery.data && (
                <div className="mt-3 space-y-2 text-xs text-slate-700">
                  <p>
                    Estado:{' '}
                    <span
                      className={
                        saasFactusIssuerConfigQuery.data.configured
                          ? 'font-semibold text-emerald-700'
                          : 'font-semibold text-amber-700'
                      }
                    >
                      {saasFactusIssuerConfigQuery.data.configured ? 'Configurado' : 'Incompleto'}
                    </span>
                    {' · '}Ambiente activo:{' '}
                    <span className="font-semibold">{saasFactusIssuerConfigQuery.data.environment}</span>
                    {' · '}Rango:{' '}
                    <span className="font-semibold">
                      {saasFactusIssuerConfigQuery.data.numbering_range_id ?? 'sin definir'}
                    </span>
                  </p>
                  <p>
                    Emisor: <strong>{saasFactusIssuerConfigQuery.data.issuer_name}</strong>{' '}
                    {saasFactusIssuerConfigQuery.data.issuer_email ? `(${saasFactusIssuerConfigQuery.data.issuer_email})` : ''}
                  </p>
                  <p className="break-all">
                    Base URL Factus: <code className="bg-slate-100 px-1 rounded">{saasFactusIssuerConfigQuery.data.base_url}</code>
                  </p>
                  <p>
                    Client ID: <code>{saasFactusIssuerConfigQuery.data.client_id_hint ?? '—'}</code>
                    {' · '}API user: <code>{saasFactusIssuerConfigQuery.data.api_username_hint ?? '—'}</code>
                  </p>
                  {!saasFactusIssuerConfigQuery.data.configured && (
                    <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                      Faltan variables en `.env`: {saasFactusIssuerConfigQuery.data.missing_fields.join(', ')}
                    </p>
                  )}
                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!canRetrySaaSFe || saasFactusIssuerTestMutation.isLoading}
                      onClick={() => {
                        setBillingActionError('');
                        setBillingActionSuccess('');
                        saasFactusIssuerTestMutation.mutate();
                      }}
                      className="btn-chip"
                    >
                      {saasFactusIssuerTestMutation.isLoading ? 'Probando…' : 'Probar conexión Factus SaaS'}
                    </button>
                    {!canRetrySaaSFe && (
                      <span className="text-slate-500">
                        Solo owner/finanzas pueden ejecutar la prueba de conexión.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="sticky top-[88px] z-10 mb-4 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtros de sesiones</p>
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutSessionTenantId('');
                    setCheckoutSessionStatusFilter('');
                    setCheckoutSessionFeFilter('');
                    setCheckoutSessionQuickSearch('');
                    setCheckoutSessionsViewTab('all');
                    setCheckoutSessionsSortBy('created_at');
                    setCheckoutSessionsSortDir('desc');
                    setCheckoutSessionsPage(1);
                    setExpandedCheckoutSessionId(null);
                  }}
                  className="btn-chip py-1 text-[11px]"
                >
                  Limpiar filtros
                </button>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {[
                  { id: 'all' as CheckoutSessionsViewTab, label: 'Todas', count: checkoutTabCounts.all },
                  { id: 'pending' as CheckoutSessionsViewTab, label: 'Pendientes', count: checkoutTabCounts.pending },
                  { id: 'paid' as CheckoutSessionsViewTab, label: 'Pagadas', count: checkoutTabCounts.paid },
                  { id: 'fe_issue' as CheckoutSessionsViewTab, label: 'FE con novedad', count: checkoutTabCounts.fe_issue },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setCheckoutSessionsViewTab(tab.id);
                      setCheckoutSessionsPage(1);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      checkoutSessionsViewTab === tab.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`${checkoutSessionsViewTab === tab.id ? 'text-white/90' : 'text-slate-500'}`}>{tab.count}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 flex-1">
                <select
                  className="input-corporate"
                  value={checkoutSessionTenantId}
                  onChange={(e) => setCheckoutSessionTenantId(e.target.value)}
                >
                  <option value="">Todos los tenants</option>
                  {(tenantsQuery.data || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre_comercial} (/{t.slug})
                    </option>
                  ))}
                </select>
                <select
                  className="input-corporate"
                  value={checkoutSessionStatusFilter}
                  onChange={(e) => setCheckoutSessionStatusFilter(e.target.value)}
                >
                  <option value="">Cualquier estado de pago</option>
                  <option value="pending">pending (sin pagar)</option>
                  <option value="paid">paid (pagada)</option>
                </select>
                <select
                  className="input-corporate"
                  value={checkoutSessionFeFilter}
                  onChange={(e) => setCheckoutSessionFeFilter(e.target.value)}
                >
                  <option value="">Cualquier estado FE licencia</option>
                  <option value="pending">Pendiente (sin estado o aún no emitida)</option>
                  <option value="ok">Emitida (ok)</option>
                  <option value="error">Error de emisión</option>
                  <option value="skipped">Omitida (sin Factus, etc.)</option>
                </select>
                <input
                  type="text"
                  value={checkoutSessionQuickSearch}
                  onChange={(e) => setCheckoutSessionQuickSearch(e.target.value)}
                  placeholder="Buscar tenant, sesión, referencia PSP o documento"
                  className="input-corporate"
                />
                <select
                  className="input-corporate"
                  value={checkoutSessionsSortBy}
                  onChange={(e) =>
                    setCheckoutSessionsSortBy(
                      e.target.value as 'created_at' | 'total_cop' | 'status' | 'tenant'
                    )
                  }
                >
                  <option value="created_at">Ordenar por fecha</option>
                  <option value="total_cop">Ordenar por total</option>
                  <option value="status">Ordenar por estado</option>
                  <option value="tenant">Ordenar por tenant</option>
                </select>
                <select
                  className="input-corporate"
                  value={checkoutSessionsSortDir}
                  onChange={(e) => setCheckoutSessionsSortDir(e.target.value as 'asc' | 'desc')}
                >
                  <option value="desc">Descendente</option>
                  <option value="asc">Ascendente</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => downloadCheckoutSessionsCsv(checkoutRowsPage)}
                disabled={!checkoutRowsPage.length}
                className="btn-chip flex items-center justify-center gap-2 self-start lg:self-auto whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                CSV página
              </button>
              <button
                type="button"
                onClick={() => {
                  void downloadCheckoutSessionsCsvServer().catch(() => {
                    setBillingActionError('No fue posible descargar el CSV completo.');
                  });
                }}
                className="btn-chip flex items-center justify-center gap-2 self-start lg:self-auto whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                CSV completo (filtros)
              </button>
              </div>
            </div>
            {checkoutSessionsQuery.isLoading && <LoadingBlock lines={4} />}
            {checkoutSessionsQuery.isError && (
              <p className="text-sm text-red-600">No fue posible cargar las sesiones de checkout.</p>
            )}
            {checkoutSessionsQuery.data &&
              (checkoutFilteredTotal === 0 ? (
                <EmptyState message="No hay sesiones para los filtros, pestaña y búsqueda seleccionados." />
              ) : (
                <>
                  <div className="table-shell">
                    <table className="table-enterprise text-sm">
                      <thead>
                        <tr>
                          <th className="w-[86px]">Detalle</th>
                          <th>Fecha</th>
                          <th>Tenant</th>
                          <th>Plan</th>
                          <th>Total</th>
                          <th>Sesión</th>
                          <th>Estado pago</th>
                          <th>FE licencia</th>
                          <th>Comprobante</th>
                          <th className="table-enterprise-col-actions">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checkoutRowsPage.map((row) => {
                          const feSt = effectiveFeStatus(
                            row.saas_fe_status,
                            row.saas_fe_error,
                            row.saas_fe_error_category,
                          );
                          const feComplete = row.saas_fe_status === 'ok' && Boolean(row.numero_documento);
                          const showRetry = canRetrySaaSFe && row.status === 'paid' && !feComplete;
                          const isExpanded = expandedCheckoutSessionId === row.session_id;
                          return (
                            <Fragment key={row.session_id}>
                              <tr>
                                <td>
                                  <button
                                    type="button"
                                    className="btn-chip py-1 text-[11px]"
                                    onClick={() =>
                                      setExpandedCheckoutSessionId((prev) => (prev === row.session_id ? null : row.session_id))
                                    }
                                  >
                                    {isExpanded ? 'Ocultar' : 'Ver'}
                                  </button>
                                </td>
                                <td>{new Date(row.created_at).toLocaleString()}</td>
                                <td className="font-medium text-slate-900">{row.tenant_nombre}</td>
                                <td>{row.plan_code}</td>
                                <td>{formatCurrency(row.total_cop)}</td>
                                <td
                                  className="text-xs text-slate-500 font-mono max-w-[128px] truncate"
                                  title={row.session_id}
                                >
                                  {row.session_id}
                                </td>
                                <td>
                                  <span className={statusBadgeClass(row.status)}>{row.status === 'paid' ? 'Pagada' : 'Pendiente'}</span>
                                </td>
                                <td>
                                  <span
                                    className={statusBadgeClass(feSt || 'pending')}
                                    title={row.saas_fe_error || undefined}
                                  >
                                    {feLicenciaStatusLabel(feSt)}
                                  </span>
                                </td>
                                <td>
                                  {row.public_url ? (
                                    <a
                                      href={row.public_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-600 hover:underline text-xs"
                                    >
                                      Abrir
                                    </a>
                                  ) : (
                                    <span className="text-xs text-slate-600">{row.numero_documento || '—'}</span>
                                  )}
                                </td>
                                <td className="table-enterprise-col-actions">
                                  {showRetry && (
                                    <button
                                      type="button"
                                      className="btn-chip"
                                      disabled={retrySaaSCheckoutFeMutation.isLoading}
                                      onClick={() => {
                                        setBillingActionError('');
                                        setBillingActionSuccess('');
                                        retrySaaSCheckoutFeMutation.mutate(row.session_id);
                                      }}
                                    >
                                      {retrySaaSCheckoutFeMutation.isLoading &&
                                      retrySaaSCheckoutFeMutation.variables === row.session_id
                                        ? 'Reintentando…'
                                        : 'Reintentar FE'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={10} className="bg-slate-50/70">
                                    <div className="grid grid-cols-1 gap-2 p-3 text-xs text-slate-700 md:grid-cols-3">
                                      <p>
                                        <span className="font-semibold text-slate-900">Tenant slug:</span> /{row.tenant_slug}
                                      </p>
                                      <p>
                                        <span className="font-semibold text-slate-900">Proveedor pago:</span>{' '}
                                        {row.payment_provider || (row.epayco_ref ? 'epayco' : '—')}
                                      </p>
                                      <p>
                                        <span className="font-semibold text-slate-900">Referencia PSP:</span>{' '}
                                        {row.payment_ref || row.epayco_ref || '—'}
                                      </p>
                                      <p>
                                        <span className="font-semibold text-slate-900">Documento FE:</span> {row.numero_documento || '—'}
                                      </p>
                                      <p>
                                        <span className="font-semibold text-slate-900">Categoría FE:</span>{' '}
                                        {row.saas_fe_error_category || '—'}
                                      </p>
                                      <p>
                                        <span className="font-semibold text-slate-900">Referencia FE:</span>{' '}
                                        <span className="font-mono">{row.saas_fe_reference_code || '—'}</span>
                                      </p>
                                      <p className="md:col-span-3 break-words">
                                        <span className="font-semibold text-slate-900">Detalle FE:</span>{' '}
                                        {row.saas_fe_error || 'Sin novedad reportada'}
                                      </p>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      Mostrando {checkoutRowsPage.length} de {checkoutFilteredTotal} registro(s)
                    </p>
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-chip py-1 text-[11px]"
                        disabled={safeCheckoutPage <= 1}
                        onClick={() => setCheckoutSessionsPage((p) => Math.max(1, p - 1))}
                      >
                        Anterior
                      </button>
                      <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">
                        Página {safeCheckoutPage} / {checkoutTotalPages}
                      </span>
                      <button
                        type="button"
                        className="btn-chip py-1 text-[11px]"
                        disabled={safeCheckoutPage >= checkoutTotalPages}
                        onClick={() => setCheckoutSessionsPage((p) => Math.min(checkoutTotalPages, p + 1))}
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                </>
              ))}
            {!canRetrySaaSFe && (
              <p className="text-xs text-slate-500 mt-3">
                Solo roles owner y finanzas pueden reintentar la emisión de la factura de licencia.
              </p>
            )}
          </div>

          <div className="section-card p-6">
            <BackofficeSectionHeading
              className="mb-4"
              icon={Wallet}
              title="Resumen global de facturación por tenant"
              description="Cobros, planes y últimos pagos por tenant"
            />
            {billingOverviewQuery.isLoading && <LoadingBlock lines={4} />}
            {billingOverviewQuery.isError && <p className="text-sm text-red-600">No fue posible cargar el resumen de facturación.</p>}
            {billingOverviewQuery.data && (
              billingOverviewQuery.data.length === 0 ? (
                <EmptyState message="No hay registros de facturación para mostrar todavía." />
              ) : (
                <div className="table-shell">
                  <table className="table-enterprise">
                    <thead>
                      <tr>
                        <th>Tenant</th>
                        <th>Plan</th>
                        <th>Sucursales</th>
                        <th>Estado cobro</th>
                        <th>Próx. cobro</th>
                        <th>Último pago</th>
                        <th>Recibo</th>
                        <th className="table-enterprise-col-actions">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingOverviewQuery.data.map((item) => {
                        const tenant = (tenantsQuery.data || []).find((t) => t.id === item.tenant_id);
                        return (
                          <tr key={item.tenant_id}>
                            <td className="font-semibold text-slate-900">{item.tenant_nombre}</td>
                            <td>{item.plan_label}</td>
                            <td>{branchChargeSummary(item.sedes_totales, item.sucursales_facturables)}</td>
                            <td>
                              <span className={statusBadgeClass(item.cobro_status)}>{cobroStatusLabel(item.cobro_status)}</span>
                            </td>
                            <td>{item.next_billing_at ? new Date(item.next_billing_at).toLocaleDateString() : '-'}</td>
                            <td>
                              {item.last_payment_amount != null
                                ? `${formatCurrency(item.last_payment_amount)} (${
                                    item.last_payment_at ? new Date(item.last_payment_at).toLocaleDateString() : '-'
                                  })`
                                : '-'}
                            </td>
                            <td>{item.last_receipt_reference || '-'}</td>
                            <td className="table-enterprise-col-actions">
                              <div className="flex flex-wrap items-center justify-end gap-2">
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
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      );
    }

    if (activeModule === 'soporte') {
      const supportList = supportTicketsQuery.data;
      const supportRowsPage = supportList?.items ?? [];
      const supportFilteredTotal = supportList?.total ?? 0;
      const supportTotalPages = supportList?.total_pages ?? 1;
      const supportSafePage = supportList?.page ?? supportPage;

      return (
        <div className="space-y-6">
          <div className="section-card p-6 space-y-4 ring-1 ring-cyan-100/70">
            <BackofficeSectionHeading
              icon={LifeBuoy}
              title="Tickets de soporte"
              description="Seguimiento de solicitudes de los CDAs"
            />
            {supportActionError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{supportActionError}</p>
            )}
            {supportActionSuccess && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                {supportActionSuccess}
              </p>
            )}
            {!canManageSupport && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Tu rol tiene acceso de lectura a soporte. Solo owner y soporte pueden actualizar tickets.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2 text-xs md:grid-cols-5">
              <div className="rounded-lg bg-white px-2 py-1.5">
                <p className="text-slate-500">Total</p>
                <p className="font-semibold text-slate-900">{supportSummaryQuery.data?.total_tickets ?? '-'}</p>
              </div>
              <div className="rounded-lg bg-white px-2 py-1.5">
                <p className="text-slate-500">Abiertos</p>
                <p className="font-semibold text-amber-700">{supportSummaryQuery.data?.abiertos ?? '-'}</p>
              </div>
              <div className="rounded-lg bg-white px-2 py-1.5">
                <p className="text-slate-500">En progreso</p>
                <p className="font-semibold text-cyan-700">{supportSummaryQuery.data?.en_progreso ?? '-'}</p>
              </div>
              <div className="rounded-lg bg-white px-2 py-1.5">
                <p className="text-slate-500">Sin resolver</p>
                <p className="font-semibold text-rose-700">{supportSummaryQuery.data?.sin_resolver ?? '-'}</p>
              </div>
              <div className="rounded-lg bg-white px-2 py-1.5">
                <p className="text-slate-500">Críticos</p>
                <p className="font-semibold text-red-700">{supportSummaryQuery.data?.criticos_abiertos ?? '-'}</p>
              </div>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  setSupportTenantFilter('');
                  setSupportStatusFilter('');
                  setSupportPriorityFilter('');
                  setSupportQuickSearch('');
                  setSupportSortBy('created_at');
                  setSupportSortDir('desc');
                  setSupportPage(1);
                  setExpandedSupportTicketId(null);
                }}
                className="btn-chip py-1 text-[11px]"
              >
                Limpiar filtros
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <select
                value={supportTenantFilter}
                onChange={(e) => setSupportTenantFilter(e.target.value)}
                className="input-corporate"
              >
                <option value="">Todos los tenants</option>
                {(tenantsQuery.data || []).map((tenant) => (
                  <option key={tenant.id} value={tenant.slug}>
                    {tenant.nombre_comercial} (/{tenant.slug})
                  </option>
                ))}
              </select>
              <select
                value={supportStatusFilter}
                onChange={(e) => setSupportStatusFilter(e.target.value)}
                className="input-corporate"
              >
                <option value="">Todos los estados</option>
                <option value="abierto">Abierto</option>
                <option value="en_progreso">En progreso</option>
                <option value="resuelto">Resuelto</option>
                <option value="cerrado">Cerrado</option>
              </select>
              <select
                value={supportPriorityFilter}
                onChange={(e) => setSupportPriorityFilter(e.target.value)}
                className="input-corporate"
              >
                <option value="">Todas las prioridades</option>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
              <select
                className="input-corporate"
                value={supportSortBy}
                onChange={(e) => setSupportSortBy(e.target.value as 'created_at' | 'priority' | 'status' | 'tenant')}
              >
                <option value="created_at">Ordenar por fecha</option>
                <option value="priority">Ordenar por prioridad</option>
                <option value="status">Ordenar por estado</option>
                <option value="tenant">Ordenar por tenant</option>
              </select>
              <select
                className="input-corporate"
                value={supportSortDir}
                onChange={(e) => setSupportSortDir(e.target.value as 'asc' | 'desc')}
              >
                <option value="desc">Descendente</option>
                <option value="asc">Ascendente</option>
              </select>
              <input
                type="text"
                value={supportQuickSearch}
                onChange={(e) => setSupportQuickSearch(e.target.value)}
                placeholder="Buscar por tenant, asunto, estado, prioridad o asignado"
                className="input-corporate"
              />
            </div>

            {supportTicketsQuery.isLoading && <LoadingBlock lines={4} />}
            {supportTicketsQuery.isError && <p className="text-sm text-red-600">No fue posible cargar los tickets de soporte.</p>}
            {supportTicketsQuery.data && (
              supportFilteredTotal === 0 ? (
                <EmptyState message="No hay tickets para los filtros seleccionados." />
              ) : (
                <div className="table-shell">
                  <table className="table-enterprise">
                    <thead>
                      <tr>
                        <th className="w-[86px]">Detalle</th>
                        <th>Fecha</th>
                        <th>Tenant</th>
                        <th>Asunto</th>
                        <th>Prioridad</th>
                        <th>Estado</th>
                        <th>Asignado</th>
                        <th>Respuesta al CDA</th>
                        <th className="table-enterprise-col-actions">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supportRowsPage.map((ticket) => {
                        const isExpanded = expandedSupportTicketId === ticket.id;
                        return (
                          <Fragment key={ticket.id}>
                            <tr>
                              <td>
                                <button
                                  type="button"
                                  className="btn-chip py-1 text-[11px]"
                                  onClick={() => setExpandedSupportTicketId((prev) => (prev === ticket.id ? null : ticket.id))}
                                >
                                  {isExpanded ? 'Ocultar' : 'Ver'}
                                </button>
                              </td>
                              <td>{new Date(ticket.created_at).toLocaleString()}</td>
                              <td>{ticket.tenant_nombre}</td>
                              <td>
                                <p className="font-semibold text-slate-900">{ticket.title}</p>
                                <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{ticket.description}</p>
                              </td>
                              <td>
                                <span className={supportPriorityBadgeClass(ticket.priority)}>{ticket.priority}</span>
                              </td>
                              <td>
                                <span className={statusBadgeClass(ticket.status)}>{supportStatusLabel(ticket.status)}</span>
                              </td>
                              <td>{ticket.assigned_to_user_email || '-'}</td>
                              <td>
                                {ticket.tenant_response_message ? (
                                  <p className="line-clamp-2 text-xs text-slate-700">{ticket.tenant_response_message}</p>
                                ) : (
                                  <span className="text-xs text-slate-400">Pendiente de respuesta</span>
                                )}
                              </td>
                              <td className="table-enterprise-col-actions">
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => updateSupportTicketMutation.mutate({ ticketId: ticket.id, status: 'en_progreso' })}
                                    disabled={!canManageSupport || updateSupportTicketMutation.isLoading || ticket.status === 'en_progreso'}
                                    className="btn-chip"
                                  >
                                    En progreso
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSupportReplyTicketId(ticket.id);
                                      setSupportReplyMessage(ticket.tenant_response_message || '');
                                      setSupportActionError('');
                                    }}
                                    disabled={!canManageSupport || updateSupportTicketMutation.isLoading}
                                    className="btn-chip"
                                  >
                                    Responder y resolver
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={9} className="bg-slate-50/70">
                                  <div className="grid grid-cols-1 gap-2 p-3 text-xs text-slate-700 md:grid-cols-3">
                                    <p className="md:col-span-3 break-words">
                                      <span className="font-semibold text-slate-900">Descripción completa:</span>{' '}
                                      {ticket.description || '—'}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-slate-900">Creado por:</span>{' '}
                                      {ticket.created_by_user_email || 'Sistema'}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-slate-900">Asignado:</span>{' '}
                                      {ticket.assigned_to_user_email || 'Sin asignar'}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-slate-900">SLA:</span>{' '}
                                      {ticket.sla_due_at ? new Date(ticket.sla_due_at).toLocaleString() : '—'}
                                    </p>
                                    <p className="md:col-span-3 break-words">
                                      <span className="font-semibold text-slate-900">Respuesta al CDA:</span>{' '}
                                      {ticket.tenant_response_message || 'Pendiente'}
                                    </p>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {supportTicketsQuery.data && supportFilteredTotal > 0 && (
              <div className="mt-3 flex flex-col gap-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Mostrando {supportRowsPage.length} de {supportFilteredTotal} ticket(s)
                </p>
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-chip py-1 text-[11px]"
                    disabled={supportSafePage <= 1}
                    onClick={() => setSupportPage((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </button>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">
                    Página {supportSafePage} / {supportTotalPages}
                  </span>
                  <button
                    type="button"
                    className="btn-chip py-1 text-[11px]"
                    disabled={supportSafePage >= supportTotalPages}
                    onClick={() => setSupportPage((p) => Math.min(supportTotalPages, p + 1))}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>

          {supportReplyTicketId && (
            <div
              className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => {
                setSupportReplyTicketId(null);
                setSupportReplyMessage('');
              }}
            >
              <div
                className="w-full max-w-2xl modal-panel glass-card border border-slate-200/70 p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header-sticky -mx-5 px-5 pt-1 pb-3 mb-3 border-b border-slate-200">
                  <p className="text-sm font-semibold text-slate-800 mb-2">Respuesta al CDA</p>
                  <p className="text-xs text-slate-500 mb-1">
                    Este mensaje será visible para el CDA en su módulo de soporte.
                  </p>
                </div>
                <textarea
                  value={supportReplyMessage}
                  onChange={(e) => setSupportReplyMessage(e.target.value)}
                  className="input-corporate min-h-[120px] mb-3"
                  placeholder="Ej: Se realizó la anulación del pago 14698115 y la caja quedó actualizada."
                  required
                />
                <div className="modal-footer-sticky -mx-5 px-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="btn-corporate-muted px-4"
                    onClick={() => {
                      setSupportReplyTicketId(null);
                      setSupportReplyMessage('');
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn-corporate-primary px-4 disabled:opacity-60"
                    disabled={updateSupportTicketMutation.isLoading || !supportReplyMessage.trim()}
                    onClick={() =>
                      updateSupportTicketMutation.mutate({
                        ticketId: supportReplyTicketId,
                        status: 'resuelto',
                        tenantResponseMessage: supportReplyMessage.trim(),
                      })
                    }
                  >
                    {updateSupportTicketMutation.isLoading ? 'Guardando...' : 'Enviar y resolver'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (activeModule === 'auditoria') {
      const auditList = auditLogsQuery.data;
      const auditRowsPage = auditList?.items ?? [];
      const auditFilteredTotal = auditList?.total ?? 0;
      const auditTotalPages = auditList?.total_pages ?? 1;
      const auditSafePage = auditList?.page ?? auditPage;

      return (
        <div className="section-card p-6 space-y-4 ring-1 ring-amber-100/80">
          <BackofficeSectionHeading
            icon={FileClock}
            title="Auditoría global"
            description="Registro de acciones y eventos del sistema"
            right={
              <button type="button" onClick={handleExportAuditCsv} className="btn-chip shadow-sm">
                Exportar CSV
              </button>
            }
          />
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtros de auditoría</p>
              <button
                type="button"
                onClick={() => {
                  setAuditActionFilter('');
                  setAuditActorFilter('');
                  setAuditTenantFilter('');
                  setAuditDateFrom('');
                  setAuditDateTo('');
                  setAuditQuickSearch('');
                  setAuditSortBy('created_at');
                  setAuditSortDir('desc');
                  setAuditPage(1);
                  setExpandedAuditLogId(null);
                }}
                className="btn-chip py-1 text-[11px]"
              >
                Limpiar filtros
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-8">
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
            <input
              type="text"
              value={auditQuickSearch}
              onChange={(e) => setAuditQuickSearch(e.target.value)}
              placeholder="Buscar acción, descripción, actor o tenant"
              className="input-corporate"
            />
            <select
              className="input-corporate"
              value={auditSortBy}
              onChange={(e) => setAuditSortBy(e.target.value as 'created_at' | 'action' | 'success' | 'tenant' | 'actor')}
            >
              <option value="created_at">Ordenar por fecha</option>
              <option value="action">Ordenar por acción</option>
              <option value="success">Ordenar por estado</option>
              <option value="tenant">Ordenar por tenant</option>
              <option value="actor">Ordenar por actor</option>
            </select>
            <select
              className="input-corporate"
              value={auditSortDir}
              onChange={(e) => setAuditSortDir(e.target.value as 'asc' | 'desc')}
            >
              <option value="desc">Descendente</option>
              <option value="asc">Ascendente</option>
            </select>
            </div>
          </div>
          {auditLogsQuery.isLoading && <LoadingBlock lines={5} />}
          {auditLogsQuery.isError && <p className="text-sm text-red-600">No fue posible cargar la auditoría.</p>}
          {auditLogsQuery.data && (
            auditFilteredTotal === 0 ? (
              <EmptyState message="No se encontraron eventos con los filtros aplicados." />
            ) : (
            <div className="table-shell">
              <table className="table-enterprise">
                <thead>
                  <tr>
                    <th className="w-[86px]">Detalle</th>
                    <th>Fecha</th>
                    <th>Acción</th>
                    <th>Descripción</th>
                    <th>Actor</th>
                    <th>Tenant</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRowsPage.map((log) => {
                    const isExpanded = expandedAuditLogId === log.id;
                    return (
                      <Fragment key={log.id}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="btn-chip py-1 text-[11px]"
                              onClick={() => setExpandedAuditLogId((prev) => (prev === log.id ? null : log.id))}
                            >
                              {isExpanded ? 'Ocultar' : 'Ver'}
                            </button>
                          </td>
                          <td>{new Date(log.created_at).toLocaleString()}</td>
                          <td>
                            <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                              {log.action}
                            </span>
                          </td>
                          <td className="max-w-[26rem]">
                            <p className="line-clamp-2">{log.description}</p>
                          </td>
                          <td>{log.usuario_email || 'Sistema'}</td>
                          <td>{log.tenant_slug ? `/${log.tenant_slug}` : '-'}</td>
                          <td>
                            <span className={statusBadgeClass(log.success)}>
                              {log.success === 'success' ? 'Exitoso' : 'Con error'}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} className="bg-slate-50/70">
                              <div className="grid grid-cols-1 gap-2 p-3 text-xs text-slate-700 md:grid-cols-2">
                                <p className="break-words md:col-span-2">
                                  <span className="font-semibold text-slate-900">Descripción completa:</span> {log.description}
                                </p>
                                <p>
                                  <span className="font-semibold text-slate-900">Usuario:</span> {log.usuario_nombre || '—'}
                                </p>
                                <p>
                                  <span className="font-semibold text-slate-900">IP:</span> {log.ip_address || '—'}
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )
          )}
          {auditLogsQuery.data && auditFilteredTotal > 0 && (
            <div className="mt-3 flex flex-col gap-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Mostrando {auditRowsPage.length} de {auditFilteredTotal} evento(s)
              </p>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  className="btn-chip py-1 text-[11px]"
                  disabled={auditSafePage <= 1}
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </button>
                <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">
                  Página {auditSafePage} / {auditTotalPages}
                </span>
                <button
                  type="button"
                  className="btn-chip py-1 text-[11px]"
                  disabled={auditSafePage >= auditTotalPages}
                  onClick={() => setAuditPage((p) => Math.min(auditTotalPages, p + 1))}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="section-card p-6">
          <BackofficeSectionHeading
            className="mb-4"
            icon={Shield}
            title="Seguridad SaaS"
            description="Métricas de cuentas y protección de acceso"
          />
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
          <BackofficeSectionHeading
            className="mb-4"
            icon={ShieldCheck}
            title="Usuarios y controles de seguridad"
            description="MFA, bloqueos y acciones sobre cuentas internas"
          />
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
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>MFA</th>
                    <th>Bloqueo</th>
                    <th className="table-enterprise-col-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {securityUsersQuery.data.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <p className="font-semibold text-slate-900">{u.nombre_completo}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{u.email}</p>
                      </td>
                      <td className="capitalize">{u.rol_global}</td>
                      <td>
                        <span className={u.mfa_enabled ? 'badge badge-success' : 'badge badge-warning'}>
                          {u.mfa_enabled ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td>{u.bloqueado_hasta ? `Hasta ${new Date(u.bloqueado_hasta).toLocaleString()}` : 'No'}</td>
                      <td className="table-enterprise-col-actions">
                        <div className="flex flex-wrap items-center justify-end gap-2">
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

  const moduleCards: Array<{
    id: BackofficeModule;
    title: string;
    subtitle: string;
    icon: typeof Building2;
    color: string;
    count?: number;
  }> = [
    { id: 'resumen', title: 'Resumen', subtitle: 'KPIs y permisos globales', icon: Building2, color: 'text-blue-600' },
    {
      id: 'tenants',
      title: 'Tenants',
      subtitle: 'Gestión de CDAs y estado comercial',
      icon: Users,
      color: 'text-indigo-600',
      count: tenantsQuery.data?.length,
    },
    {
      id: 'runt_metricas',
      title: 'Métricas RUNT',
      subtitle: 'Consumo y costo por proveedor',
      icon: Activity,
      color: 'text-fuchsia-600',
      count: runtMetricasQuery.data?.total_consultas,
    },
    {
      id: 'opensanctions_metricas',
      title: 'Métricas OpenSanctions',
      subtitle: 'Consumo API global y por CDA',
      icon: Coins,
      color: 'text-sky-600',
      count: opensanctionsUsageQuery.data?.total_calls,
    },
    {
      id: 'facturacion',
      title: 'Facturación',
      subtitle: 'Cobros, checkout y FE de licencia',
      icon: Wallet,
      color: 'text-violet-600',
    },
    {
      id: 'soporte',
      title: 'Soporte',
      subtitle: 'Tickets y SLA de atención',
      icon: LifeBuoy,
      color: 'text-cyan-600',
      count: supportSummaryQuery.data?.notificaciones_pendientes,
    },
    {
      id: 'usuarios',
      title: 'Usuarios SaaS',
      subtitle: 'Accesos y roles internos',
      icon: ShieldCheck,
      color: 'text-emerald-600',
      count: usersQuery.data?.length,
    },
    {
      id: 'auditoria',
      title: 'Auditoría',
      subtitle: 'Trazabilidad de acciones',
      icon: FileClock,
      color: 'text-amber-600',
    },
    {
      id: 'seguridad',
      title: 'Seguridad',
      subtitle: 'Incidentes y controles',
      icon: Shield,
      color: 'text-rose-600',
    },
  ];

  const activeModuleMeta = moduleCards.find((m) => m.id === activeModule) ?? moduleCards[0];
  const tenantsTotal = tenantsQuery.data?.length ?? 0;
  const tenantsActive = tenantsQuery.data?.filter((t) => t.activo).length ?? 0;
  const supportPending = supportSummaryQuery.data?.notificaciones_pendientes ?? 0;

  return (
    <div className="corporate-shell">
      <header className="app-header !z-30">
        <div className="app-header-inner">
          <div className="flex items-center gap-3">
            <img src={logoCdaSoft} alt="CDASOFT" className="h-14 sm:h-18 lg:h-20 w-auto object-contain" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Panel ejecutivo</p>
              <p className="text-sm font-semibold text-slate-900">CDASOFT SaaS Backoffice</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 btn-corporate-danger flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Salir
          </button>
        </div>
      </header>

      <main className="app-main relative" data-table-density={tableDensity}>
        <div className="section-card mb-6 border-brand-200 bg-gradient-to-r from-white via-brand-50/40 to-indigo-50/40 p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="mb-1 text-sm text-slate-500">Sesión global activa</p>
              <h1 className="mb-2 text-xl font-bold text-slate-900 sm:text-2xl">Bienvenido, {user?.nombre_completo}</h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Rol: <span className="font-semibold capitalize">{permissionsQuery.data?.role || '-'}</span>
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                  Módulo activo: {activeModuleMeta.title}
                </span>
                <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800">
                  {activeModuleMeta.subtitle}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-white/80 p-2 text-center shadow-sm">
              <div className="rounded-lg bg-slate-50 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Tenants</p>
                <p className="text-sm font-bold text-slate-900">{tenantsTotal}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wide text-emerald-700">Activos</p>
                <p className="text-sm font-bold text-emerald-800">{tenantsActive}</p>
              </div>
              <div className="rounded-lg bg-cyan-50 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wide text-cyan-700">Tickets</p>
                <p className="text-sm font-bold text-cyan-800">{supportPending}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 overflow-x-auto pt-1">
          <div className="grid grid-cols-7 gap-3 min-w-[860px] md:min-w-0">
            {moduleCards.map((module) => (
              <button
                key={module.id}
                type="button"
                onClick={() => setActiveModule(module.id)}
                className={`relative rounded-xl border bg-white/90 p-4 text-left transition-all duration-200 ${
                  activeModule === module.id
                    ? 'border-slate-800 shadow-lg ring-2 ring-brand-100'
                    : 'border-slate-200/80 hover:border-slate-300 hover:shadow-md'
                }`}
              >
                {activeModule === module.id && (
                  <span className="absolute right-2 top-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                    Activo
                  </span>
                )}
                <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                  <module.icon className={`w-4 h-4 ${module.color}`} />
                </div>
                {typeof module.count === 'number' && module.count > 0 && (
                  <span className="mb-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                    {module.count}
                  </span>
                )}
                <p className="text-xs text-slate-500">Módulo</p>
                <p className="font-semibold text-slate-900 text-sm">{module.title}</p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{module.subtitle}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 flex items-center justify-end">
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vista tabla</span>
            <button
              type="button"
              onClick={() => setTableDensity('comfortable')}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                tableDensity === 'comfortable' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Normal
            </button>
            <button
              type="button"
              onClick={() => setTableDensity('compact')}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                tableDensity === 'compact' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Compacta
            </button>
          </div>
        </div>

        {renderModuleContent()}
      </main>

      {selectedTenantId && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-2 sm:p-4"
          onClick={() => setSelectedTenantId(null)}
        >
          <div
            className="w-full max-w-5xl modal-panel max-h-[95vh] sm:max-h-[90vh] glass-card border border-slate-200/70 p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header-sticky -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-3 flex items-center justify-between mb-4 border-b border-slate-200">
              <p className="text-sm font-semibold text-slate-800">Hoja de vida del CDA</p>
              <button
                type="button"
                onClick={() => setSelectedTenantId(null)}
                className="btn-corporate-muted text-xs px-3 py-1"
              >
                Cerrar perfil
              </button>
            </div>

            {tenantProfileQuery.isLoading && <LoadingBlock lines={6} />}
            {tenantProfileQuery.isError && <p className="text-sm text-red-600">No fue posible cargar el perfil del tenant.</p>}
            {tenantProfileQuery.data && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-white to-slate-50/90 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Resumen rápido</p>
                      <p className="text-base font-semibold text-slate-900">{tenantProfileQuery.data.nombre_comercial}</p>
                      <p className="text-xs text-slate-500">/{tenantProfileQuery.data.slug}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold uppercase text-indigo-800">
                        {tenantProfileQuery.data.plan_actual}
                      </span>
                      <span className={statusBadgeClass(tenantProfileQuery.data.subscription_status)}>
                        {subscriptionStatusLabel(tenantProfileQuery.data.subscription_status)}
                      </span>
                      <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                        Próx. cobro:{' '}
                        {tenantProfileQuery.data.next_billing_at
                          ? new Date(tenantProfileQuery.data.next_billing_at).toLocaleDateString()
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" onClick={openAllTenantProfileSections} className="btn-chip py-1 text-[11px]">
                    Expandir todo
                  </button>
                  <button type="button" onClick={collapseAllTenantProfileSections} className="btn-chip py-1 text-[11px]">
                    Contraer todo
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleTenantProfileSection('brandAccess')}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Marca y datos de acceso</p>
                      <p className="text-xs text-slate-500">Logo del tenant, datos comerciales y URL de login</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {tenantProfileSectionsOpen.brandAccess ? 'Ocultar' : 'Mostrar'}
                    </span>
                  </button>
                  {tenantProfileSectionsOpen.brandAccess && (
                    <div className="border-t border-slate-200 p-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div className="md:col-span-1 rounded-xl border border-slate-200 p-4 flex flex-col items-stretch gap-3">
                          {tenantProfileQuery.data.logo_url ? (
                            <img
                              src={tenantProfileQuery.data.logo_url}
                              alt={tenantProfileQuery.data.nombre_comercial}
                              className="max-h-28 w-full object-contain mb-1"
                            />
                          ) : (
                            <div className="h-28 w-full rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 text-xs">
                              Sin logo
                            </div>
                          )}
                          <p className="text-xs font-medium text-slate-600 text-center">Marca del CDA</p>
                          <p className="text-[11px] text-slate-500 text-center leading-snug">
                            Si el CDA no cargó logo en el registro, puedes asignarlo aquí (misma opción que en el alta).
                          </p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold ${
                                tenantLogoMode === 'url' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                              }`}
                              onClick={() => {
                                setTenantLogoMode('url');
                                setTenantLogoFile(null);
                                setTenantLogoError('');
                              }}
                            >
                              Logo por URL
                            </button>
                            <button
                              type="button"
                              className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold ${
                                tenantLogoMode === 'file' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                              }`}
                              onClick={() => {
                                setTenantLogoMode('file');
                                setTenantLogoUrl('');
                                setTenantLogoError('');
                              }}
                            >
                              Subir archivo
                            </button>
                          </div>
                          {tenantLogoMode === 'url' ? (
                            <input
                              type="url"
                              value={tenantLogoUrl}
                              onChange={(e) => setTenantLogoUrl(e.target.value)}
                              placeholder="https://…"
                              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                            />
                          ) : (
                            <input
                              type="file"
                              accept=".png,.jpg,.jpeg,.webp"
                              onChange={(e) => setTenantLogoFile(e.target.files?.[0] ?? null)}
                              className="w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
                            />
                          )}
                          {tenantLogoError && (
                            <p className="text-[11px] text-red-600">{tenantLogoError}</p>
                          )}
                          <button
                            type="button"
                            disabled={tenantLogoMutation.isLoading}
                            onClick={() => tenantLogoMutation.mutate()}
                            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {tenantLogoMutation.isLoading ? 'Guardando…' : 'Guardar logo'}
                          </button>
                        </div>
                        <div className="md:col-span-2 space-y-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                              Información del CDA
                            </p>
                            <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                                Editar datos para FE SaaS
                              </p>
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <input
                                  type="text"
                                  value={tenantCoreNombre}
                                  onChange={(e) => setTenantCoreNombre(e.target.value)}
                                  placeholder="Razón social (RUT)"
                                  className="input-corporate"
                                  disabled={!tenantCoreEditMode}
                                />
                                <input
                                  type="text"
                                  value={tenantCoreNombreComercial}
                                  onChange={(e) => setTenantCoreNombreComercial(e.target.value)}
                                  placeholder="Nombre comercial"
                                  className="input-corporate"
                                  disabled={!tenantCoreEditMode}
                                />
                                <input
                                  type="text"
                                  value={tenantCoreNit}
                                  onChange={(e) => setTenantCoreNit(e.target.value)}
                                  placeholder="NIT con DV (ej: 900123456-8)"
                                  className="input-corporate"
                                  disabled={!tenantCoreEditMode}
                                />
                                <input
                                  type="email"
                                  value={tenantCoreCorreo}
                                  onChange={(e) => setTenantCoreCorreo(e.target.value)}
                                  placeholder="Correo de notificación"
                                  className="input-corporate"
                                  disabled={!tenantCoreEditMode}
                                />
                                <input
                                  type="text"
                                  value={tenantCoreRepresentante}
                                  onChange={(e) => setTenantCoreRepresentante(e.target.value)}
                                  placeholder="Representante legal"
                                  className="input-corporate"
                                  disabled={!tenantCoreEditMode}
                                />
                                <input
                                  type="text"
                                  value={tenantCoreCelular}
                                  onChange={(e) => setTenantCoreCelular(e.target.value)}
                                  placeholder="Celular de contacto"
                                  className="input-corporate"
                                  disabled={!tenantCoreEditMode}
                                />
                                <label className="md:col-span-2 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">Módulo de Nómina</p>
                                    <p className="text-xs text-slate-500">
                                      Controla si el CDA puede acceder al módulo de nómina.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={tenantCoreNominaEnabled}
                                    onClick={() => tenantCoreEditMode && setTenantCoreNominaEnabled((prev) => !prev)}
                                    disabled={!tenantCoreEditMode}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                      tenantCoreNominaEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                                    } ${tenantCoreEditMode ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                                  >
                                    <span
                                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                                        tenantCoreNominaEnabled ? 'translate-x-5' : 'translate-x-1'
                                      }`}
                                    />
                                  </button>
                                </label>
                                <label className="md:col-span-2 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">Módulo Exógena</p>
                                    <p className="text-xs text-slate-500">
                                      Controla acceso al módulo de exógena para el CDA.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={tenantCoreExogenaEnabled}
                                    onClick={() => tenantCoreEditMode && setTenantCoreExogenaEnabled((prev) => !prev)}
                                    disabled={!tenantCoreEditMode}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                      tenantCoreExogenaEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                                    } ${tenantCoreEditMode ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                                  >
                                    <span
                                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                                        tenantCoreExogenaEnabled ? 'translate-x-5' : 'translate-x-1'
                                      }`}
                                    />
                                  </button>
                                </label>
                                <label className="md:col-span-2 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">Módulo SARLAFT</p>
                                    <p className="text-xs text-slate-500">
                                      Controla acceso al módulo SARLAFT para el CDA.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={tenantCoreSarlaftEnabled}
                                    onClick={() => tenantCoreEditMode && setTenantCoreSarlaftEnabled((prev) => !prev)}
                                    disabled={!tenantCoreEditMode}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                      tenantCoreSarlaftEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                                    } ${tenantCoreEditMode ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                                  >
                                    <span
                                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                                        tenantCoreSarlaftEnabled ? 'translate-x-5' : 'translate-x-1'
                                      }`}
                                    />
                                  </button>
                                </label>
                                <label className="md:col-span-2 flex flex-col gap-1">
                                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Modo SARLAFT</span>
                                  <select
                                    value={tenantCoreSarlaftMode}
                                    onChange={(e) => setTenantCoreSarlaftMode(e.target.value as 'manual' | 'api')}
                                    className="input-corporate"
                                    disabled={!tenantCoreEditMode || !tenantCoreSarlaftEnabled}
                                  >
                                    <option value="manual">Manual</option>
                                    <option value="api">API</option>
                                  </select>
                                  <span className="text-[11px] text-slate-500">
                                    Manual: reglas internas. API: screening externo por tenant.
                                  </span>
                                </label>
                              </div>
                              {tenantCoreError && <p className="mt-2 text-xs text-red-600">{tenantCoreError}</p>}
                              <div className="mt-2 flex items-center justify-end gap-2">
                                {!tenantCoreEditMode ? (
                                  <button
                                    type="button"
                                    className="btn-chip"
                                    onClick={() => {
                                      setTenantCoreError('');
                                      setTenantCoreEditMode(true);
                                    }}
                                  >
                                    Habilitar edición
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="btn-corporate-muted px-4"
                                      onClick={() => {
                                        const profile = tenantProfileQuery.data;
                                        if (profile) {
                                          setTenantCoreNombre(profile.nombre || '');
                                          setTenantCoreNombreComercial(profile.nombre_comercial || '');
                                          setTenantCoreNit(profile.nit_cda || '');
                                          setTenantCoreCorreo(profile.correo_electronico || '');
                                          setTenantCoreRepresentante(profile.nombre_representante || '');
                                          setTenantCoreCelular(profile.celular || '');
                                          setTenantCoreNominaEnabled(Boolean(profile.nomina_enabled));
                                          setTenantCoreExogenaEnabled(Boolean(profile.exogena_enabled));
                                          setTenantCoreSarlaftEnabled(Boolean(profile.sarlaft_enabled));
                                          setTenantCoreSarlaftMode((profile.sarlaft_mode === 'api' ? 'api' : 'manual') as 'manual' | 'api');
                                        }
                                        setTenantCoreError('');
                                        setTenantCoreEditMode(false);
                                      }}
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-corporate-primary px-4 disabled:opacity-60"
                                      disabled={tenantCoreMutation.isLoading}
                                      onClick={() => tenantCoreMutation.mutate()}
                                    >
                                      {tenantCoreMutation.isLoading ? 'Guardando...' : 'Guardar datos del CDA'}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/90 p-4 shadow-sm ring-1 ring-slate-900/5">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Nombre comercial</p>
                                  <p className="text-sm font-semibold text-slate-900">{tenantProfileQuery.data.nombre_comercial}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Slug</p>
                                  <p className="text-sm font-mono font-semibold text-slate-900">/{tenantProfileQuery.data.slug}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">NIT</p>
                                  <p className="text-sm font-semibold text-slate-900">{tenantProfileQuery.data.nit_cda || '—'}</p>
                                </div>
                                <div className="space-y-1 min-w-0">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Correo</p>
                                  <p className="text-sm font-semibold text-slate-900 break-all">{tenantProfileQuery.data.correo_electronico || '—'}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Representante</p>
                                  <p className="text-sm font-semibold text-slate-900">{tenantProfileQuery.data.nombre_representante || '—'}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Celular</p>
                                  <p className="text-sm font-semibold text-slate-900">{tenantProfileQuery.data.celular || '—'}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Plan actual</p>
                                  <p className="text-sm font-semibold uppercase text-slate-900">{tenantProfileQuery.data.plan_actual}</p>
                                </div>
                                <div className="space-y-1.5">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Estado suscripción</p>
                                  <span className={statusBadgeClass(tenantProfileQuery.data.subscription_status)}>
                                    {subscriptionStatusLabel(tenantProfileQuery.data.subscription_status)}
                                  </span>
                                </div>
                                <div className="space-y-1.5">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Nómina</p>
                                  <span
                                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                      tenantProfileQuery.data.nomina_enabled
                                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                                        : 'border border-amber-200 bg-amber-50 text-amber-800'
                                    }`}
                                  >
                                    {tenantProfileQuery.data.nomina_enabled ? 'Habilitada' : 'Deshabilitada'}
                                  </span>
                                </div>
                                <div className="space-y-1.5">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">SARLAFT</p>
                                  <span
                                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                      tenantProfileQuery.data.sarlaft_enabled
                                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                                        : 'border border-amber-200 bg-amber-50 text-amber-800'
                                    }`}
                                  >
                                    {tenantProfileQuery.data.sarlaft_enabled ? 'Habilitado' : 'Deshabilitado'}
                                  </span>
                                  <p className="text-[11px] text-slate-500">
                                    Modo: {(tenantProfileQuery.data.sarlaft_mode || 'manual').toUpperCase()}
                                  </p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Sucursales totales</p>
                                  <p className="text-sm font-semibold text-slate-900">{tenantProfileQuery.data.sedes_totales}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">
                                    Sucursales adicionales cobradas
                                  </p>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {tenantProfileQuery.data.sucursales_facturables} (desde la 3.ª)
                                  </p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Próximo cobro</p>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {tenantProfileQuery.data.next_billing_at
                                      ? new Date(tenantProfileQuery.data.next_billing_at).toLocaleDateString()
                                      : '—'}
                                  </p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">Último pago</p>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {tenantProfileQuery.data.last_payment_at
                                      ? new Date(tenantProfileQuery.data.last_payment_at).toLocaleDateString()
                                      : '—'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                              URL de acceso (login del CDA)
                            </p>
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
                              <div className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/90 px-3 py-2.5 shadow-sm ring-1 ring-slate-900/5">
                                <Link2
                                  className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600"
                                  aria-hidden
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-600">
                                    URL personalizada
                                  </p>
                                  <p className="mt-0.5 text-sm font-mono text-slate-900 leading-snug break-all">
                                    {tenantProfileQuery.data.login_url}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyLoginUrl(tenantProfileQuery.data.id, tenantProfileQuery.data.login_url)
                                }
                                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-colors sm:self-stretch"
                              >
                                {copiedTenantId === tenantProfileQuery.data.id ? (
                                  <>
                                    <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                                    Copiado
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-4 w-4 text-slate-500" aria-hidden />
                                    Copiar enlace
                                  </>
                                )}
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                              Comparte este enlace con el CDA para que sus usuarios inicien sesión en su espacio.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleTenantProfileSection('documentos')}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Almacenamiento Documentos</p>
                      <p className="text-xs text-slate-500">
                        Cuota de espacio por CDA
                        {tenantProfileQuery.data
                          ? ` · ${
                              tenantProfileQuery.data.documentos_quota_mb === null ||
                              tenantProfileQuery.data.documentos_quota_mb === undefined
                                ? 'default del servidor'
                                : tenantProfileQuery.data.documentos_quota_mb === 0
                                  ? 'ilimitado'
                                  : `${tenantProfileQuery.data.documentos_quota_mb} MB`
                            }`
                          : ''}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {tenantProfileSectionsOpen.documentos ? 'Ocultar' : 'Mostrar'}
                    </span>
                  </button>
                  {tenantProfileSectionsOpen.documentos && (
                    <div className="border-t border-slate-100 px-4 py-4 space-y-3">
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Vacío = default del servidor · 0 = sin límite · número = tope solo de este CDA (ej. 5120 = 5&nbsp;GB).
                        No afecta a los demás CDA.
                      </p>
                      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <label className="flex-1 min-w-0 space-y-1">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                            Cuota (MB)
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={tenantCoreDocumentosQuotaMb}
                            onChange={(e) => {
                              setTenantDocumentosQuotaError('');
                              setTenantCoreDocumentosQuotaMb(e.target.value);
                            }}
                            placeholder="Default global"
                            className="input-corporate"
                          />
                        </label>
                        <button
                          type="button"
                          className="btn-corporate-primary px-4 shrink-0 disabled:opacity-60"
                          disabled={tenantDocumentosQuotaMutation.isLoading}
                          onClick={() => tenantDocumentosQuotaMutation.mutate()}
                        >
                          {tenantDocumentosQuotaMutation.isLoading ? 'Guardando...' : 'Guardar cuota'}
                        </button>
                      </div>
                      {tenantDocumentosQuotaError && (
                        <p className="text-xs text-red-600">{tenantDocumentosQuotaError}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleTenantProfileSection('sedes')}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Red de sedes y respaldo DIAN</p>
                      <p className="text-xs text-slate-500">Matriz, sucursales y configuración de facturación por sede</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {tenantProfileSectionsOpen.sedes ? 'Ocultar' : 'Mostrar'}
                    </span>
                  </button>
                  {tenantProfileSectionsOpen.sedes && (() => {
                  const profile = tenantProfileQuery.data;
                  if (!profile) return null;
                  const matriz = profile.facturacion_matriz ?? {
                    direccion_facturacion: null,
                    factus_municipality_id: null,
                  };
                  const sedes = profile.sucursales_activas || [];
                  const n = sedes.length;
                  const totalesPlan = profile.sedes_totales;

                  return (
                    <div className="section-card p-4 space-y-4">
                      <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm overflow-hidden ring-1 ring-slate-900/5">
                        <BackofficeSectionHeading
                          embedded
                          icon={MapPin}
                          title="Matriz — respaldo DIAN / Factus"
                          description="Configurado por el CDA en Organización (Guardar datos matriz). Es el origen por defecto en factura para la sede principal y el respaldo del resto si no tienen dato propio."
                        />
                        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm border-t border-slate-100 bg-slate-50/50">
                          <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                              Dirección (matriz)
                            </p>
                            <p className="text-slate-900 whitespace-pre-wrap break-words">
                              {matriz.direccion_facturacion?.trim() ? matriz.direccion_facturacion : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                              Id municipio Factus
                            </p>
                            <p className="font-mono text-slate-900 tabular-nums">
                              {matriz.factus_municipality_id != null ? matriz.factus_municipality_id : '—'}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm overflow-hidden ring-1 ring-slate-900/5">
                        <BackofficeSectionHeading
                          embedded
                          icon={Building2}
                          title="Red de sedes"
                          description={
                            n === 0
                              ? 'Sin sedes activas registradas'
                              : `${n} sede${n === 1 ? '' : 's'} operativa${n === 1 ? '' : 's'} · ${totalesPlan} contratada${totalesPlan === 1 ? '' : 's'} en plan. «Hereda matriz» = al facturar se usan dirección y/o municipio del bloque matriz. La sede principal suele ir así; las demás solo rellenan si el establecimiento DIAN es otro.`
                          }
                          right={
                            n > 0 ? (
                              <span className="rounded-md bg-white/80 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200/80">
                                {n}/{totalesPlan} activas
                              </span>
                            ) : undefined
                          }
                        />
                        {n === 0 ? (
                          <div className="px-4 py-8 text-center">
                            <p className="text-sm text-slate-500">El tenant aún no tiene sedes activas en el sistema.</p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="table-enterprise min-w-full">
                              <thead>
                                <tr>
                                  <th>Sede</th>
                                  <th>Cód. sede</th>
                                  <th>Ciudad</th>
                                  <th>Dirección (factura)</th>
                                  <th>Id mpio. Factus</th>
                                  <th>Estado</th>
                                  <th className="text-right">Desde CDASOFT</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sedes.map((s) => (
                                  <tr key={s.id}>
                                    <td className="font-semibold text-slate-900">{s.nombre}</td>
                                    <td className="font-mono text-xs text-slate-600">{s.codigo || '—'}</td>
                                    <td className="text-sm text-slate-700 max-w-[8rem] truncate" title={s.ciudad || undefined}>
                                      {s.ciudad?.trim() ? s.ciudad : '—'}
                                    </td>
                                    <td className="text-sm text-slate-700 max-w-[12rem]">
                                      {s.direccion?.trim() ? (
                                        <span className="line-clamp-2" title={s.direccion}>
                                          {s.direccion}
                                        </span>
                                      ) : (
                                        <span
                                          className="italic text-slate-500 text-xs whitespace-nowrap"
                                          title="Al emitir factura se usa la dirección de matriz"
                                        >
                                          Hereda matriz
                                        </span>
                                      )}
                                    </td>
                                    <td className="font-mono text-xs text-slate-600 tabular-nums">
                                      {s.factus_municipality_id != null ? (
                                        s.factus_municipality_id
                                      ) : (
                                        <span
                                          className="italic text-slate-500 text-xs font-sans whitespace-nowrap"
                                          title="Al emitir se usa el id Factus de municipio de matriz"
                                        >
                                          Hereda matriz
                                        </span>
                                      )}
                                    </td>
                                    <td>
                                      {s.es_principal ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 pl-2 pr-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200/90">
                                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-600" aria-hidden />
                                          Principal
                                        </span>
                                      ) : (
                                        <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200/70">
                                          Activa
                                        </span>
                                      )}
                                    </td>
                                    <td className="text-right">
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
                                        onClick={() => {
                                          setSedeUbicacionError('');
                                        setSedeUbicacionEdit({
                                          id: s.id,
                                          nombre: s.nombre,
                                          esPrincipal: s.es_principal,
                                          direccion: s.direccion?.trim() ? s.direccion : '',
                                          ciudad: s.ciudad?.trim() ? s.ciudad : '',
                                          factus_municipality_id:
                                            s.factus_municipality_id != null ? String(s.factus_municipality_id) : '',
                                        });
                                        }}
                                      >
                                        <Pencil className="w-3.5 h-3.5" aria-hidden />
                                        Editar
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {sedeUbicacionEdit && selectedTenantId && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
                          <div
                            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4 ring-1 ring-slate-200 max-h-[90vh] overflow-y-auto"
                            role="dialog"
                            aria-labelledby="sede-ubicacion-dialog-title"
                          >
                            <h3 id="sede-ubicacion-dialog-title" className="text-lg font-bold text-slate-900">
                              Facturación de la sede (DIAN)
                            </h3>
                            <p className="text-sm text-slate-600">
                              <span className="font-semibold text-slate-800">{sedeUbicacionEdit.nombre}</span>. Deja vacíos
                              dirección o municipio para que esta sede <strong>herede la matriz</strong> al emitir. El
                              código interno de sede no se cambia aquí.
                            </p>
                            {sedeUbicacionEdit.esPrincipal ? (
                              <p className="text-xs text-slate-600 bg-amber-50/90 border border-amber-100 rounded-lg px-3 py-2">
                                <strong>Sede principal:</strong> lo coherente con la app del CDA es dejar vacíos
                                dirección y municipio para no duplicar «datos de la matriz». Solo rellena si este
                                punto es otro establecimiento DIAN.
                              </p>
                            ) : null}
                            {sedeUbicacionError ? (
                              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                                {sedeUbicacionError}
                              </p>
                            ) : null}
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-1">
                                Dirección en factura
                              </label>
                              <textarea
                                className="input-corporate w-full min-h-[72px] text-sm resize-y"
                                value={sedeUbicacionEdit.direccion}
                                onChange={(e) =>
                                  setSedeUbicacionEdit((prev) =>
                                    prev ? { ...prev, direccion: e.target.value } : prev,
                                  )
                                }
                                placeholder="Vacío = hereda matriz"
                                maxLength={500}
                              />
                            </div>
                            <FactusMunicipalitySearchField
                              value={sedeUbicacionEdit.factus_municipality_id}
                              onChange={(idDigits) =>
                                setSedeUbicacionEdit((prev) =>
                                  prev ? { ...prev, factus_municipality_id: idDigits } : prev,
                                )
                              }
                              saasTenantId={selectedTenantId}
                              idInputClassName="input-corporate w-full font-mono text-sm"
                            />
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-1">
                                Ciudad (opcional)
                              </label>
                              <input
                                className="input-corporate w-full"
                                value={sedeUbicacionEdit.ciudad}
                                onChange={(e) =>
                                  setSedeUbicacionEdit((prev) =>
                                    prev ? { ...prev, ciudad: e.target.value } : prev,
                                  )
                                }
                                placeholder="Etiqueta interna; no reemplaza municipio DIAN"
                                maxLength={200}
                              />
                            </div>
                            <div className="flex gap-2 justify-end pt-2">
                              <button
                                type="button"
                                className="btn-corporate-muted px-4"
                                onClick={() => {
                                  setSedeUbicacionEdit(null);
                                  setSedeUbicacionError('');
                                }}
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                className="btn-primary-solid px-4 disabled:opacity-50"
                                disabled={patchSedeUbicacionMutation.isLoading}
                                onClick={() => {
                                  if (!sedeUbicacionEdit || !selectedTenantId) return;
                                  const midStr = sedeUbicacionEdit.factus_municipality_id.trim();
                                  if (midStr) {
                                    const n = parseInt(midStr, 10);
                                    if (Number.isNaN(n) || n < 1) {
                                      setSedeUbicacionError('El id de municipio Factus debe ser un número mayor a 0.');
                                      return;
                                    }
                                  }
                                  patchSedeUbicacionMutation.mutate({
                                    tenantId: selectedTenantId,
                                    sucursalId: sedeUbicacionEdit.id,
                                    direccion: sedeUbicacionEdit.direccion.trim() || null,
                                    ciudad: sedeUbicacionEdit.ciudad.trim() || null,
                                    factus_municipality_id: midStr ? parseInt(midStr, 10) : null,
                                  });
                                }}
                              >
                                Guardar
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                  })()}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleTenantProfileSection('factus')}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Facturación electrónica (Factus)</p>
                      <p className="text-xs text-slate-500">Credenciales, ambiente y validación de integración</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {tenantProfileSectionsOpen.factus ? 'Ocultar' : 'Mostrar'}
                    </span>
                  </button>
                  {tenantProfileSectionsOpen.factus && (
                    <div className="border-t border-slate-200 p-4">
                      <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm overflow-hidden ring-1 ring-slate-900/5">
                        <BackofficeSectionHeading
                          embedded
                          icon={Landmark}
                          title="Facturación electrónica (Factus)"
                          description="Credenciales, ambiente y rango fallback; el CDA define municipio y rango por sede"
                        />
                        <div className="p-4 border-t border-slate-100">
                          <SaasTenantFactusPanel tenantId={tenantProfileQuery.data.id} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleTenantProfileSection('billing')}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Gestión de plan y pago</p>
                      <p className="text-xs text-slate-500">Asignación de plan, cotización y registro manual</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {tenantProfileSectionsOpen.billing ? 'Ocultar' : 'Mostrar'}
                    </span>
                  </button>
                  {tenantProfileSectionsOpen.billing && (
                    <div className="border-t border-slate-200 p-4">
                      <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm overflow-hidden ring-1 ring-slate-900/5">
                        <BackofficeSectionHeading
                          embedded
                          icon={CreditCard}
                          title="Gestión de plan y pago"
                          description="Asignar plan, cotización y registro de pagos"
                        />
                        <div className="p-4 space-y-3">
                          {billingActionError && (
                            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{billingActionError}</p>
                          )}
                          {billingActionSuccess && (
                            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">{billingActionSuccess}</p>
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

                          <div>
                            {billingQuoteQuery.isLoading && <LoadingBlock lines={1} />}
                            {billingQuoteQuery.isError && (
                              <p className="text-sm text-red-600">No fue posible calcular la cotización.</p>
                            )}
                            {billingQuoteQuery.data && (
                              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900 shadow-sm">
                                {(() => {
                                  const q = billingQuoteQuery.data;
                                  const includedTotal = 1 + q.included_branches;
                                  return (
                                    <>
                                      <p>
                                        Resumen: {q.sedes_totales} sedes totales | {includedTotal} incluidas en base (principal +{' '}
                                        {q.included_branches} anexa{q.included_branches === 1 ? '' : 's'}) |{' '}
                                        {q.chargeable_additional_branches} facturable
                                        {q.chargeable_additional_branches === 1 ? '' : 's'} (desde la {includedTotal + 1}.a)
                                      </p>
                                      <p className="mt-1">
                                        Subtotal: {formatCurrency(q.subtotal)} + IVA: {formatCurrency(q.iva)} ={' '}
                                        <strong>Total: {formatCurrency(q.total)}</strong>
                                      </p>
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
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
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm space-y-1">
                              <p className="font-semibold text-emerald-800">Recibo de pago registrado</p>
                              <p>
                                <span className="text-emerald-700">Referencia:</span> {lastPaymentReceipt.comprobante_referencia}
                              </p>
                              <p>
                                <span className="text-emerald-700">Plan:</span> {lastPaymentReceipt.plan_label}
                              </p>
                              <p>
                                <span className="text-emerald-700">Monto:</span> {formatCurrency(lastPaymentReceipt.amount)}
                              </p>
                              <p>
                                <span className="text-emerald-700">Fecha pago:</span>{' '}
                                {new Date(lastPaymentReceipt.paid_at).toLocaleString()}
                              </p>
                              <p>
                                <span className="text-emerald-700">Sucursales:</span>{' '}
                                {branchChargeSummary(lastPaymentReceipt.sedes_totales, lastPaymentReceipt.sucursales_facturables)}
                              </p>
                              <p>
                                <span className="text-emerald-700">Próximo cobro:</span>{' '}
                                {lastPaymentReceipt.next_billing_at
                                  ? new Date(lastPaymentReceipt.next_billing_at).toLocaleDateString()
                                  : 'N/A'}
                              </p>
                              <p>
                                <span className="text-emerald-700">Correo enviado:</span>{' '}
                                {lastPaymentReceipt.receipt_email_sent ? 'Si' : 'No (revisar SMTP/correo tenant)'}
                              </p>
                              <div className="pt-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDownloadReceipt(
                                      lastPaymentReceipt.receipt_download_url,
                                      lastPaymentReceipt.comprobante_referencia
                                    )
                                  }
                                  className="btn-chip bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-600 hover:border-emerald-600"
                                >
                                  Descargar recibo PDF
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleTenantProfileSection('payments')}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Historial de pagos</p>
                      <p className="text-xs text-slate-500">Últimos movimientos y comprobantes</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {tenantProfileSectionsOpen.payments ? 'Ocultar' : 'Mostrar'}
                    </span>
                  </button>
                  {tenantProfileSectionsOpen.payments && (
                    <div className="border-t border-slate-200 p-4">
                      {tenantPaymentsQuery.isLoading && <LoadingBlock lines={3} />}
                      {tenantPaymentsQuery.isError && (
                        <p className="text-sm text-red-600">No fue posible cargar el historial de pagos.</p>
                      )}
                      {tenantPaymentsQuery.data && (
                        <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm overflow-hidden ring-1 ring-slate-900/5">
                          <BackofficeSectionHeading
                            embedded
                            icon={Wallet}
                            title="Historial de pagos"
                            description="Últimos 10 movimientos registrados"
                          />
                          {tenantPaymentsQuery.data.length === 0 ? (
                            <div className="px-4 py-8 text-center">
                              <p className="text-sm text-slate-500">Este tenant aún no tiene pagos registrados.</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="table-enterprise min-w-full">
                                <thead>
                                  <tr>
                                    <th>Fecha</th>
                                    <th>Monto</th>
                                    <th>Plan</th>
                                    <th>Recibo</th>
                                    <th>Próx. cobro</th>
                                    <th className="table-enterprise-col-actions">Acción</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tenantPaymentsQuery.data.map((p) => (
                                    <tr key={p.id}>
                                      <td className="whitespace-nowrap text-slate-600">
                                        {new Date(p.paid_at).toLocaleString()}
                                      </td>
                                      <td className="font-semibold text-slate-900">
                                        {formatCurrency(p.amount)}
                                      </td>
                                      <td>{p.plan_label || p.plan_code || '—'}</td>
                                      <td className="font-mono text-xs">{p.comprobante_referencia || '—'}</td>
                                      <td>
                                        {p.next_billing_at ? new Date(p.next_billing_at).toLocaleDateString() : '—'}
                                      </td>
                                      <td className="table-enterprise-col-actions">
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
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleTenantProfileSection('users')}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Usuarios recientes</p>
                      <p className="text-xs text-slate-500">Resumen de usuarios internos del tenant</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {tenantProfileSectionsOpen.users ? 'Ocultar' : 'Mostrar'}
                    </span>
                  </button>
                  {tenantProfileSectionsOpen.users && (
                    <div className="border-t border-slate-200 p-4">
                      <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm overflow-hidden ring-1 ring-slate-900/5">
                        <BackofficeSectionHeading
                          embedded
                          icon={Users}
                          title="Usuarios recientes"
                          description={`${tenantProfileQuery.data.total_usuarios} usuario${
                            tenantProfileQuery.data.total_usuarios === 1 ? '' : 's'
                          } en el tenant`}
                        />
                        {tenantProfileQuery.data.usuarios_recientes.length === 0 ? (
                          <div className="px-4 py-8 text-center">
                            <p className="text-sm text-slate-500">No hay usuarios recientes para este tenant.</p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="table-enterprise min-w-full">
                              <thead>
                                <tr>
                                  <th>Nombre</th>
                                  <th>Email</th>
                                  <th>Rol</th>
                                  <th>Estado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tenantProfileQuery.data.usuarios_recientes.map((u) => (
                                  <tr key={u.id}>
                                    <td className="font-semibold text-slate-900">{u.nombre_completo}</td>
                                    <td className="text-slate-600 break-all">{u.email}</td>
                                    <td>
                                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium capitalize text-slate-700">
                                        {u.rol}
                                      </span>
                                    </td>
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
        </div>
      )}
    </div>
  );
}
