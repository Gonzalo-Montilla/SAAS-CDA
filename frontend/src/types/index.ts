// Usuarios y Auth
export interface TenantBranding {
  nombre_comercial: string;
  logo_url?: string | null;
  color_primario: string;
  color_secundario: string;
}

export interface SucursalBasica {
  id: string;
  nombre: string;
  codigo?: string | null;
  activa: boolean;
  es_principal: boolean;
}

/** Respuesta API /sucursales (admin) — incluye datos opcionales para Factus. */
export interface SucursalAdminRow {
  id: string;
  tenant_id: string;
  nombre: string;
  codigo: string | null;
  activa: boolean;
  es_principal: boolean;
  factus_municipality_id?: number | null;
  /** Rango Factus para esta sede; null = usar predeterminado del tenant (backoffice). */
  factus_numbering_range_id?: number | null;
  direccion?: string | null;
  ciudad?: string | null;
}

export interface TenantFacturacionUbicacion {
  factus_municipality_id: number | null;
  direccion_facturacion: string | null;
}

export interface TenantBillingInfo {
  gate: 'ok' | 'trial' | 'soft' | 'hard';
  subscription_status: string;
  plan_actual?: string | null;
  plan_ends_at?: string | null;
  demo_ends_at?: string | null;
  soft_grace_ends_at?: string | null;
}

export interface Usuario {
  id: string;
  tenant_id: string;
  tenant_slug?: string;
  email: string;
  nombre_completo: string;
  rol: 'administrador' | 'cajero' | 'recepcionista' | 'contador' | 'comercial';
  rol_global?: 'owner' | 'finanzas' | 'comercial' | 'soporte';
  activo: boolean;
  created_at: string;
  tenant_branding?: TenantBranding;
  sucursal_id?: string | null;
  active_sucursal_id?: string | null;
  sucursales?: SucursalBasica[];
  /** Límite de sedes del plan (registro inicial del tenant). */
  tenant_sedes_totales?: number | null;
  /** Demo / gracia / bloqueo (modales de suscripción). */
  tenant_billing?: TenantBillingInfo | null;
}

export interface SaaSUser {
  id: string;
  email: string;
  nombre_completo: string;
  rol?: 'administrador' | 'cajero' | 'recepcionista' | 'contador' | 'comercial';
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

export interface SaaSSucursalResumen {
  id: string;
  nombre: string;
  codigo?: string | null;
  ciudad?: string | null;
  /** Dirección en factura propia de la sede; vacío en API = hereda matriz al emitir. */
  direccion?: string | null;
  factus_municipality_id?: number | null;
  activa: boolean;
  es_principal: boolean;
}

/** Respaldo DIAN/Factus configurado en Organización (matriz). */
export interface SaaSTenantFacturacionMatriz {
  direccion_facturacion: string | null;
  factus_municipality_id: number | null;
}

export interface SaaSTenantProfile extends SaaSTenantSummary {
  total_usuarios: number;
  usuarios_recientes: SaaSTenantUserSummary[];
  /** Presente desde API SaaS con perfil extendido; fallback en UI si falta (despliegue mixto). */
  facturacion_matriz?: SaaSTenantFacturacionMatriz;
  sucursales_activas: SaaSSucursalResumen[];
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

/** Checkouts PSP (suscripción) y emisión FE licencia (PROMETHEUS), backoffice SaaS. */
export interface SaaSCheckoutSessionItem {
  session_id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_nombre: string;
  plan_code: string;
  sedes_totales: number;
  total_cop: number;
  status: string;
  created_at: string;
  completed_at?: string | null;
  payment_provider?: string | null;
  payment_ref?: string | null;
  epayco_ref?: string | null;
  saas_fe_status?: string | null;
  saas_fe_error?: string | null;
  saas_fe_error_category?: string | null;
  saas_fe_reference_code?: string | null;
  numero_documento?: string | null;
  cufe?: string | null;
  public_url?: string | null;
}

export interface SaaSCheckoutSessionCounts {
  all: number;
  pending: number;
  paid: number;
  fe_issue: number;
}

export interface SaaSCheckoutSessionListResponse {
  items: SaaSCheckoutSessionItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  counts: SaaSCheckoutSessionCounts;
}

export interface SaaSFactusIssuerConfig {
  enabled: boolean;
  use_sandbox: boolean;
  environment: 'sandbox' | 'production' | string;
  base_url: string;
  configured: boolean;
  missing_fields: string[];
  numbering_range_id?: number | null;
  client_id_hint?: string | null;
  api_username_hint?: string | null;
  issuer_name: string;
  issuer_email: string;
}

export interface SaaSFactusIssuerTestResult {
  ok: boolean;
  environment: 'sandbox' | 'production' | string;
  message: string;
  numbering_ranges_found?: number | null;
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

export interface SaaSAuditLogListResponse {
  items: SaaSAuditLogItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
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

export interface QualitySummary {
  total_invitaciones: number;
  total_respondidas: number;
  total_pendientes: number;
  promedio_general: number;
  tasa_respuesta: number;
}

export interface QualityInviteItem {
  id: string;
  cliente_nombre: string;
  cliente_email?: string | null;
  cliente_celular?: string | null;
  sucursal_id?: string | null;
  sucursal_nombre?: string | null;
  placa: string;
  tipo_vehiculo: string;
  status: 'pending' | 'sent' | 'responded' | 'expired' | 'failed' | 'no_email';
  scheduled_send_at: string;
  sent_at?: string | null;
  responded_at?: string | null;
  expires_at: string;
  experiencia_global?: number | null;
  comentario?: string | null;
  created_at: string;
}

export interface QualityInviteListResponse {
  items: QualityInviteItem[];
  total: number;
}

export interface QualityInviteDetail extends QualityInviteItem {
  facilidad_agendar_cita?: number | null;
  tiempo_espera_revision?: number | null;
  amabilidad_recepcion_caja?: number | null;
  limpieza_instalaciones?: number | null;
  amenidades_cda?: number | null;
  claridad_resultados_revision?: number | null;
  confianza_diagnostico_tecnico?: number | null;
  recomendar_cda?: number | null;
  cajero_nombre?: string | null;
  recepcionista_nombre?: string | null;
}

export interface QualityPublicSurveyInfo {
  token_valid: boolean;
  already_answered: boolean;
  expired: boolean;
  invite_id: string;
  nombre_cda: string;
  logo_url?: string | null;
  color_primario: string;
  color_secundario: string;
  cliente_nombre: string;
  placa: string;
  tipo_vehiculo: string;
}

export interface RTMReminderItem {
  id: string;
  vehiculo_id: string;
  cliente_nombre: string;
  cliente_email?: string | null;
  cliente_celular?: string | null;
  placa: string;
  tipo_vehiculo: string;
  next_due_at: string;
  days_until_due: number;
  urgency_window_days: 8 | 15 | 30;
  agendamiento_url?: string | null;
  nombre_cda?: string | null;
  status: 'pending' | 'sent' | 'failed';
  commercial_status: 'pendiente' | 'contactado' | 'interesado' | 'agendado' | 'no responde' | 'descartado' | string;
  commercial_notes?: string | null;
  assigned_to_name?: string | null;
  last_management_at?: string | null;
  last_management_channel?: string | null;
  management_count: number;
  next_contact_at?: string | null;
  sent_at?: string | null;
  last_manual_sent_at?: string | null;
  created_at: string;
}

export interface RTMReminderSummary {
  total_upcoming: number;
  due_30d: number;
  due_15d: number;
  due_8d: number;
  no_management: number;
  managed_count: number;
  agendados: number;
  conversion_agendado_pct: number;
}

export interface AppointmentSlot {
  hora: string;
  disponible: boolean;
  cupos_disponibles: number;
  ocupados: number;
}

export interface AppointmentItem {
  id: string;
  cliente_nombre: string;
  cliente_email?: string | null;
  cliente_celular?: string | null;
  placa: string;
  tipo_vehiculo: string;
  scheduled_at: string;
  status: 'scheduled' | 'confirmed' | 'checked_in' | 'cancelled' | 'no_show';
  source: string;
  notes?: string | null;
  created_at: string;
  reminder_status?: string;
  reminder_sent_at?: string | null;
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

export interface SaaSSupportTicketListResponse {
  items: SaaSSupportTicketItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
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
  /** Dirección de la matriz para factura electrónica (opcional; se replica en la sede principal). */
  direccion_facturacion?: string;
  /** Ciudad mostrada en datos de sede (opcional; se guarda en la sede principal). */
  ciudad?: string;
  /** Reservado; en el registro web no se envía — el admin lo define en Organización. */
  factus_municipality_id?: string;
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
  cliente_tipo_documento: 'CC' | 'CE' | 'PA' | 'NIT';
  cliente_documento: string;
  cliente_telefono?: string;
  cliente_email?: string;
  /** Dirección del cliente en factura Factus (opcional). */
  cliente_direccion?: string | null;
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
  /** Nombre del usuario que cobró (solo en detalle GET). */
  cajero_nombre?: string | null;
}

export interface VehiculoRegistro {
  placa: string;
  tipo_vehiculo: string;
  marca?: string;
  modelo?: string;
  ano_modelo: number;
  cliente_nombre: string;
  cliente_tipo_documento: 'CC' | 'CE' | 'PA' | 'NIT';
  cliente_documento: string;
  cliente_telefono: string;
  cliente_email: string;
  cliente_direccion?: string | null;
  tiene_soat: boolean;
  observaciones?: string;
}

export interface VehiculoConsultaRunt {
  placa_consultada: string;
  document_type?: string | null;
  document_number?: string | null;
  titular_nombre?: string | null;
  encontrado: boolean;
  marca?: string | null;
  linea?: string | null;
  modelo?: string | null;
  ano_modelo?: number | null;
  color?: string | null;
  clase_vehiculo?: string | null;
  tipo_servicio?: string | null;
  cilindraje?: string | null;
  tipo_vehiculo_sugerido?: string | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  fuente: string;
  proveedor?: string | null;
  request_id?: string | null;
  cached: boolean;
  observaciones: string[];
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
  beneficiario?: string | null;
  beneficiario_tipo_identificacion?: string | null;
  beneficiario_numero_identificacion?: string | null;
  beneficiario_direccion?: string | null;
  beneficiario_email?: string | null;
  beneficiario_telefono?: string | null;
  beneficiario_factus_municipality_id?: number | null;
  proveedor_catalogo_id?: string | null;
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
  valor_terceros_runt: number;
  valor_terceros_sicov: number;
  valor_terceros_bancarizacion: number;
  valor_terceros_ansv: number;
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
