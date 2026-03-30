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
  rol: 'administrador' | 'cajero' | 'recepcionista';
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

export type AuthScope = 'tenant' | 'saas';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface TenantSelfRegisterRequest {
  nombre_cda: string;
  admin_nombre_completo: string;
  admin_email: string;
  admin_password: string;
  logo_url?: string;
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
