// Usuarios y Auth
export interface TenantBranding {
  nombre_comercial: string;
  logo_url?: string | null;
  color_primario: string;
  color_secundario: string;
}

export interface Usuario {
  id: string;
  tenant_id: string;
  email: string;
  nombre_completo: string;
  rol: 'administrador' | 'cajero' | 'recepcionista' | 'contador';
  rol_global?: 'owner' | 'finanzas' | 'comercial' | 'soporte';
  activo: boolean;
  created_at: string;
  tenant_branding?: TenantBranding;
}

export interface SaaSUser {
  id: string;
  email: string;
  nombre_completo: string;
  rol?: 'administrador' | 'cajero' | 'recepcionista';
  rol_global: 'owner' | 'finanzas' | 'comercial' | 'soporte';
  activo: boolean;
  mfa_enabled: boolean;
  session_version: number;
  created_at: string;
}

export interface SaaSTenantSummary {
  id: string;
  slug: string;
  nombre: string;
  nombre_comercial: string;
  logo_url?: string | null;
  nit_cda?: string | null;
  correo_electronico?: string | null;
  nombre_representante?: string | null;
  celular?: string | null;
  plan_actual: string;
  subscription_status: string;
  sedes_totales: number;
  sucursales_facturables: number;
  sucursales_incluidas: number;
  plan_ends_at?: string | null;
  demo_ends_at?: string | null;
  billing_cycle_days: number;
  next_billing_at?: string | null;
  last_payment_at?: string | null;
  activo: boolean;
  login_url: string;
}

export interface SaaSTenantUserSummary {
  id: string;
  email: string;
  nombre_completo: string;
  rol: string;
  activo: boolean;
  created_at: string;
}

export interface SaaSTenantProfile extends SaaSTenantSummary {
  total_usuarios: number;
  usuarios_recientes: SaaSTenantUserSummary[];
}

export interface SaaSBillingPlanItem {
  code: string;
  label: string;
  duration_days: number;
  base_price: number;
  additional_branch_price: number;
  included_branches: number;
  iva_rate: number;
  is_prepay: boolean;
}

export interface SaaSTenantBillingQuote {
  tenant_id: string;
  tenant_slug: string;
  plan_code: string;
  plan_label: string;
  sedes_totales: number;
  included_branches: number;
  chargeable_additional_branches: number;
  subtotal: number;
  iva: number;
  total: number;
  period_days: number;
}

export interface SaaSPaymentRegisteredResponse {
  tenant_id: string;
  tenant_slug: string;
  plan_code: string;
  plan_label: string;
  amount: number;
  paid_at: string;
  sedes_totales: number;
  sucursales_incluidas: number;
  sucursales_facturables: number;
  period_days: number;
  comprobante_referencia: string;
  payment_log_id: string;
  receipt_download_url: string;
  receipt_email_sent: boolean;
  next_billing_at?: string | null;
  subscription_status: string;
}

export interface SaaSBillingOverviewItem {
  tenant_id: string;
  tenant_slug: string;
  tenant_nombre: string;
  plan_code: string;
  plan_label: string;
  subscription_status: string;
  cobro_status: 'al_dia' | 'por_vencer' | 'vencido' | 'bloqueado' | 'trial' | 'sin_fecha';
  sedes_totales: number;
  sucursales_facturables: number;
  next_billing_at?: string | null;
  last_payment_at?: string | null;
  last_payment_amount?: number | null;
  last_receipt_reference?: string | null;
  last_payment_log_id?: string | null;
}

export interface SaaSPaymentHistoryItem {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  amount: number;
  paid_at: string;
  next_billing_at?: string | null;
  plan_code?: string | null;
  plan_label?: string | null;
  sedes_totales?: number | null;
  sucursales_facturables?: number | null;
  comprobante_referencia?: string | null;
  payment_log_id: string;
  receipt_download_url: string;
  actor_email?: string | null;
  notes?: string | null;
}

export interface SaaSAuditLogItem {
  id: string;
  action: string;
  description: string;
  usuario_email?: string | null;
  usuario_nombre?: string | null;
  success: string;
  ip_address?: string | null;
  tenant_slug?: string | null;
  created_at: string;
}

export interface SaaSSecuritySummary {
  current_user_email: string;
  current_user_role: string;
  current_session_version: number;
  mfa_enabled: boolean;
  total_saas_users: number;
  active_saas_users: number;
  locked_saas_users: number;
  mfa_enabled_users: number;
}

export interface SaaSUserSecurityItem {
  id: string;
  email: string;
  nombre_completo: string;
  rol_global: string;
  activo: boolean;
  mfa_enabled: boolean;
  intentos_fallidos: number;
  bloqueado_hasta?: string | null;
  session_version: number;
}

export interface TenantSupportTicketItem {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: 'baja' | 'media' | 'alta' | 'critica';
  status: 'abierto' | 'en_progreso' | 'resuelto' | 'cerrado';
  assigned_to_user_email?: string | null;
  tenant_response_message?: string | null;
  tenant_responded_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  resolved_at?: string | null;
}

export interface SaaSSupportTicketItem {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_nombre: string;
  title: string;
  description: string;
  category: string;
  priority: 'baja' | 'media' | 'alta' | 'critica';
  status: 'abierto' | 'en_progreso' | 'resuelto' | 'cerrado';
  assigned_to_user_id?: string | null;
  assigned_to_user_email?: string | null;
  created_by_user_id?: string | null;
  created_by_user_email?: string | null;
  internal_notes?: string | null;
  tenant_response_message?: string | null;
  tenant_responded_at?: string | null;
  sla_due_at?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface SaaSSupportSummary {
  total_tickets: number;
  abiertos: number;
  en_progreso: number;
  sin_resolver: number;
  criticos_abiertos: number;
  notificaciones_pendientes: number;
}

export type AuthScope = 'tenant' | 'saas';

export interface LoginCredentials {
  username: string;
  password: string;
  tenant_slug?: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface TenantSelfRegisterRequest {
  nombre_cda: string;
  nit_cda: string;
  correo_electronico: string;
  nombre_representante_legal_o_administrador: string;
  celular: string;
  sedes_totales: number;
  admin_password: string;
  codigo_verificacion_email?: string;
  logo_url?: string;
  logo_file?: File;
  captcha_token?: string;
}

// Vehículos
export interface Vehiculo {
  id: string;
  placa: string;
  tipo_vehiculo: string;
  marca?: string;
  modelo?: string;
  ano_modelo: number;
  cliente_nombre: string;
  cliente_documento: string;
  cliente_telefono?: string;
  valor_rtm: number;
  tiene_soat: boolean;
  comision_soat: number;
  total_cobrado: number;
  metodo_pago?: string;
  numero_factura_dian?: string;
  registrado_runt: boolean;
  registrado_sicov: boolean;
  registrado_indra: boolean;
  fecha_pago?: string;
  estado: 'registrado' | 'pagado' | 'en_pista' | 'aprobado' | 'rechazado' | 'completado';
  observaciones?: string;
  fecha_registro: string;
}

export interface VehiculoRegistro {
  placa: string;
  tipo_vehiculo: string;
  marca?: string;
  modelo?: string;
  ano_modelo: number;
  cliente_nombre: string;
  cliente_documento: string;
  cliente_telefono?: string;
  tiene_soat: boolean;
  observaciones?: string;
}

export interface VehiculoCobro {
  vehiculo_id: string;
  metodo_pago: string;
  tiene_soat: boolean;
  numero_factura_dian?: string;
  registrado_runt: boolean;
  registrado_sicov: boolean;
  registrado_indra: boolean;
  valor_preventiva?: number;
  desglose_mixto?: Record<string, number>;
}

// Cajas
export interface Caja {
  id: string;
  usuario_id: string;
  fecha_apertura: string;
  monto_inicial: number;
  turno: 'mañana' | 'tarde' | 'noche';
  fecha_cierre?: string;
  monto_final_sistema?: number;
  monto_final_fisico?: number;
  diferencia?: number;
  observaciones_cierre?: string;
  estado: 'abierta' | 'cerrada';
}

export interface CajaApertura {
  monto_inicial: number;
  turno: 'mañana' | 'tarde' | 'noche';
}

export interface DesgloseEfectivo {
  billetes_100000: number;
  billetes_50000: number;
  billetes_20000: number;
  billetes_10000: number;
  billetes_5000: number;
  billetes_2000: number;
  billetes_1000: number;
  monedas_1000: number;
  monedas_500: number;
  monedas_200: number;
  monedas_100: number;
  monedas_50: number;
}

export interface CajaCierre {
  monto_final_fisico: number;
  desglose_efectivo: DesgloseEfectivo;
  observaciones_cierre?: string;
}

export interface CajaResumen {
  caja_id: string;
  monto_inicial: number;
  total_ingresos: number;
  total_ingresos_efectivo: number;
  total_egresos: number;
  saldo_esperado: number;
  efectivo: number;
  tarjeta_debito: number;
  tarjeta_credito: number;
  transferencia: number;
  credismart: number;
  sistecredito: number;
  total_rtm: number;
  total_comision_soat: number;
  vehiculos_cobrados: number;
}

export interface MovimientoCaja {
  id: string;
  tipo: string;
  monto: number;
  metodo_pago?: string;
  concepto: string;
  ingresa_efectivo: boolean;
  created_at: string;
}

// Tarifas
export interface Tarifa {
  id: string;
  ano_vigencia: number;
  vigencia_inicio: string;
  vigencia_fin: string;
  tipo_vehiculo: string;
  antiguedad_min: number;
  antiguedad_max?: number;
  valor_rtm: number;
  valor_terceros: number;
  valor_total: number;
  activa: boolean;
  descripcion_antiguedad: string;
}

export interface ComisionSOAT {
  id: string;
  tipo_vehiculo: string;
  valor_comision: number;
  vigencia_inicio: string;
  vigencia_fin?: string;
  activa: boolean;
}

// URLs Externas
export interface URLsExternas {
  runt_url: string;
  sicov_url: string;
  indra_url: string;
}
