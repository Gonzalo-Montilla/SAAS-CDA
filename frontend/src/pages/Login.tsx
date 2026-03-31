import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useBrand } from '../contexts/BrandContext';
import { apiClient } from '../api/client';
import type { AuthScope, TenantSelfRegisterRequest } from '../types';

function extractApiErrorMessage(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail;

  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item.msg === 'string') {
          const loc = Array.isArray(item.loc)
            ? item.loc
                .filter((part: unknown) => typeof part === 'string')
                .join('.')
            : '';
          return loc ? `${loc}: ${item.msg}` : item.msg;
        }
        return '';
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join(' | ');
    }
  }

  if (typeof err?.message === 'string' && err.message.trim()) {
    return err.message;
  }

  return fallback;
}

function normalizeNitInput(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z-]/g, '');
}

function normalizePhoneInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

function isValidNit(value: string): boolean {
  return /^[0-9]{5,15}(-[0-9A-Z])?$/.test(value);
}

function isValidColombianCell(value: string): boolean {
  return /^3\d{9}$/.test(value);
}

export default function Login() {
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const location = useLocation();
  const turnstileEnabled = import.meta.env.VITE_TURNSTILE_ENABLED === 'true';
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<AuthScope>('tenant');
  const [mostrarForgotPassword, setMostrarForgotPassword] = useState(false);
  const [mostrarRegistroTenant, setMostrarRegistroTenant] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [mensajeForgot, setMensajeForgot] = useState('');
  const [registerNombreCda, setRegisterNombreCda] = useState('');
  const [registerNitCda, setRegisterNitCda] = useState('');
  const [registerCorreoElectronico, setRegisterCorreoElectronico] = useState('');
  const [registerRepresentanteNombre, setRegisterRepresentanteNombre] = useState('');
  const [registerCelular, setRegisterCelular] = useState('');
  const [registerSedesTotales, setRegisterSedesTotales] = useState(1);
  const [registerAdminPassword, setRegisterAdminPassword] = useState('');
  const [registerEmailCode, setRegisterEmailCode] = useState('');
  const [emailCodeTarget, setEmailCodeTarget] = useState('');
  const [registerLogoUrl, setRegisterLogoUrl] = useState('');
  const [registerLogoFile, setRegisterLogoFile] = useState<File | null>(null);
  const [logoInputMode, setLogoInputMode] = useState<'url' | 'file'>('url');
  const [registerCaptchaToken, setRegisterCaptchaToken] = useState('');
  const [registerCaptchaError, setRegisterCaptchaError] = useState('');
  const [registerValidationError, setRegisterValidationError] = useState('');
  const [mensajeRegistro, setMensajeRegistro] = useState('');
  const [tenantBrandingPreview, setTenantBrandingPreview] = useState<{
    nombre_comercial: string;
    logo_url?: string | null;
    color_primario: string;
    color_secundario: string;
    login_url?: string;
  } | null>(null);
  const [tenantBrandingError, setTenantBrandingError] = useState('');
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileScriptLoadedRef = useRef(false);
  const isMountedRef = useRef(true);
  const { login } = useAuth();
  const brand = useBrand();
  const navigate = useNavigate();
  const effectiveBrand = tenantBrandingPreview
    ? {
        nombreComercial: tenantBrandingPreview.nombre_comercial || brand.nombreComercial,
        logoSrc: tenantBrandingPreview.logo_url || brand.logoSrc,
        colorPrimario: tenantBrandingPreview.color_primario || brand.colorPrimario,
        colorSecundario: tenantBrandingPreview.color_secundario || brand.colorSecundario,
      }
    : brand;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (location.pathname === '/saas/login') {
      setLoginMode('saas');
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!tenantSlug) {
      setTenantBrandingPreview(null);
      setTenantBrandingError('');
      return;
    }

    setLoginMode('tenant');
    apiClient
      .get(`/config/public-tenant-branding/${tenantSlug}`)
      .then((response) => {
        if (!isMountedRef.current) {
          return;
        }
        setTenantBrandingPreview(response.data);
        setTenantBrandingError('');
      })
      .catch(() => {
        if (!isMountedRef.current) {
          return;
        }
        setTenantBrandingPreview(null);
        setTenantBrandingError('No encontramos un CDA activo para esta URL.');
      });
  }, [tenantSlug]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isMountedRef.current) {
      return;
    }
    setError('');
    setLoading(true);

    try {
      await login(
        {
          username: email,
          password,
          tenant_slug: loginMode === 'tenant' ? tenantSlug : undefined,
        },
        loginMode
      );
      navigate(loginMode === 'saas' ? '/saas/backoffice' : '/dashboard');
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(extractApiErrorMessage(err, 'No fue posible iniciar sesión. Verifica tus credenciales.'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const forgotPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await apiClient.post('/auth/forgot-password', { email });
      return response.data;
    },
    onSuccess: () => {
      if (!isMountedRef.current) {
        return;
      }
      setMensajeForgot('Si el correo existe, recibirás instrucciones para recuperar tu contraseña.');
    },
    onError: () => {
      if (!isMountedRef.current) {
        return;
      }
      setMensajeForgot('No fue posible enviar el correo de recuperación. Intenta nuevamente.');
    },
  });

  const handleForgotPassword = (e: FormEvent) => {
    e.preventDefault();
    setMensajeForgot('');
    forgotPasswordMutation.mutate(forgotEmail);
  };

  const registerTenantMutation = useMutation({
    mutationFn: async (payload: TenantSelfRegisterRequest) => {
      const formData = new FormData();
      formData.append('nombre_cda', payload.nombre_cda);
      formData.append('nit_cda', payload.nit_cda);
      formData.append('correo_electronico', payload.correo_electronico);
      formData.append('nombre_representante_legal_o_administrador', payload.nombre_representante_legal_o_administrador);
      formData.append('celular', payload.celular);
      formData.append('sedes_totales', String(payload.sedes_totales));
      formData.append('admin_password', payload.admin_password);
      if (payload.codigo_verificacion_email) {
        formData.append('codigo_verificacion_email', payload.codigo_verificacion_email);
      }
      if (payload.logo_url) {
        formData.append('logo_url', payload.logo_url);
      }
      if (payload.logo_file) {
        formData.append('logo_file', payload.logo_file);
      }
      if (payload.captcha_token) {
        formData.append('captcha_token', payload.captcha_token);
      }

      const response = await apiClient.post('/onboarding/register-tenant', formData);
      return response.data;
    },
    onSuccess: async (data: any) => {
      const loginUrl = data?.login_url ? ` URL personalizada: ${data.login_url}` : '';
      setMensajeRegistro(`CDA creado exitosamente.${loginUrl} Iniciando sesión...`);
      await login(
        {
          username: registerCorreoElectronico,
          password: registerAdminPassword,
        },
        'tenant'
      );
      navigate('/dashboard');
    },
    onError: (err: any) => {
      if (!isMountedRef.current) {
        return;
      }
      setMensajeRegistro(extractApiErrorMessage(err, 'No fue posible crear el CDA. Intenta nuevamente.'));
      setRegisterCaptchaToken('');
      if (window.turnstile && turnstileWidgetIdRef.current) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      }
    },
  });

  const sendEmailCodeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/onboarding/send-email-code', {
        correo_electronico: registerCorreoElectronico,
        nombre_cda: registerNombreCda,
      });
      return response.data;
    },
    onSuccess: () => {
      if (!isMountedRef.current) {
        return;
      }
      setEmailCodeTarget(registerCorreoElectronico.trim().toLowerCase());
      setMensajeRegistro('Código enviado. Revisa tu correo y continúa con el registro.');
    },
    onError: (err: any) => {
      if (!isMountedRef.current) {
        return;
      }
      setMensajeRegistro(extractApiErrorMessage(err, 'No fue posible enviar el código de verificación. Intenta nuevamente.'));
    },
  });

  const handleRegisterTenant = (e: FormEvent) => {
    e.preventDefault();
    setMensajeRegistro('');
    setRegisterCaptchaError('');
    setRegisterValidationError('');

    if (!isValidNit(registerNitCda)) {
      setRegisterValidationError('El NIT no tiene un formato válido (ej: 901234567-8).');
      return;
    }

    if (!isValidColombianCell(registerCelular)) {
      setRegisterValidationError('El celular debe ser colombiano y tener 10 dígitos (inicia en 3).');
      return;
    }
    if (registerSedesTotales < 1) {
      setRegisterValidationError('Total de sedes debe ser mayor o igual a 1.');
      return;
    }

    if (registerEmailCode.trim().length !== 6) {
      setRegisterValidationError('Debes ingresar el código de verificación de 6 dígitos.');
      return;
    }
    if (emailCodeTarget && emailCodeTarget !== registerCorreoElectronico.trim().toLowerCase()) {
      setRegisterValidationError('Si cambiaste el correo, debes enviar un nuevo código de verificación.');
      return;
    }

    if (turnstileEnabled && !registerCaptchaToken) {
      setRegisterCaptchaError('Debes completar la verificación captcha.');
      return;
    }

    registerTenantMutation.mutate({
      nombre_cda: registerNombreCda,
      nit_cda: registerNitCda,
      correo_electronico: registerCorreoElectronico,
      nombre_representante_legal_o_administrador: registerRepresentanteNombre,
      celular: registerCelular,
      sedes_totales: registerSedesTotales,
      admin_password: registerAdminPassword,
      codigo_verificacion_email: registerEmailCode.trim(),
      logo_url: logoInputMode === 'url' ? (registerLogoUrl || undefined) : undefined,
      logo_file: logoInputMode === 'file' ? (registerLogoFile || undefined) : undefined,
      captcha_token: registerCaptchaToken || undefined,
    });
  };

  useEffect(() => {
    if (!mostrarRegistroTenant || !turnstileEnabled || !turnstileSiteKey) {
      return;
    }

    const renderWidget = () => {
      if (!window.turnstile || turnstileWidgetIdRef.current) {
        return;
      }

      turnstileWidgetIdRef.current = window.turnstile.render('#turnstile-container', {
        sitekey: turnstileSiteKey,
        callback: (token: string) => {
          if (!isMountedRef.current) {
            return;
          }
          setRegisterCaptchaToken(token);
          setRegisterCaptchaError('');
        },
        'expired-callback': () => {
          if (!isMountedRef.current) {
            return;
          }
          setRegisterCaptchaToken('');
          setRegisterCaptchaError('El captcha expiró. Valídalo de nuevo.');
        },
        'error-callback': () => {
          if (!isMountedRef.current) {
            return;
          }
          setRegisterCaptchaToken('');
          setRegisterCaptchaError('No fue posible validar el captcha. Intenta nuevamente.');
        },
      });
    };

    window.onloadTurnstileCallback = renderWidget;

    if (window.turnstile) {
      renderWidget();
      return;
    }

    if (!turnstileScriptLoadedRef.current) {
      const script = document.createElement('script');
      script.id = 'turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback&render=explicit';
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
      turnstileScriptLoadedRef.current = true;
    }
  }, [mostrarRegistroTenant, turnstileEnabled, turnstileSiteKey]);

  useEffect(() => {
    if (mostrarRegistroTenant) {
      return;
    }

    setRegisterCaptchaToken('');
    setRegisterCaptchaError('');
    if (window.turnstile && turnstileWidgetIdRef.current) {
      window.turnstile.remove(turnstileWidgetIdRef.current);
    }
    turnstileWidgetIdRef.current = null;
  }, [mostrarRegistroTenant]);

  return (
    <div className="corporate-shell flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md glass-card px-7 py-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src={effectiveBrand.logoSrc}
              alt={effectiveBrand.nombreComercial}
              className="h-48 w-auto mb-5 object-contain"
            />
            <p className="text-[13px] text-slate-500">Sistema de Gestión</p>
          </div>

          {!tenantSlug && (
            <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-1 grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setLoginMode('tenant')}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
                  loginMode === 'tenant'
                    ? 'text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white'
                }`}
                style={loginMode === 'tenant' ? { backgroundColor: effectiveBrand.colorPrimario } : undefined}
              >
                Acceso Tenant CDA
              </button>
              <button
                type="button"
                onClick={() => setLoginMode('saas')}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
                  loginMode === 'saas'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white'
                }`}
              >
                SaaS Backoffice
              </button>
            </div>
          )}

          {tenantBrandingError && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {tenantBrandingError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-700 mb-2">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input-corporate"
                placeholder={loginMode === 'saas' ? 'owner@cdasoft.com' : 'usuario@cdasoft.com'}
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-slate-700 mb-2">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="input-corporate"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-corporate-primary"
              style={loginMode === 'tenant' ? { backgroundColor: effectiveBrand.colorPrimario } : undefined}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Iniciando sesión...
                </span>
              ) : (
                loginMode === 'saas' ? 'Ingresar a Backoffice' : 'Iniciar Sesión'
              )}
            </button>

            {loginMode === 'tenant' && (
              <div className="flex items-center justify-center gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => setMostrarForgotPassword(true)}
                  className="text-blue-600 hover:text-blue-800 transition"
                >
                  ¿Olvidaste tu contraseña?
                </button>
                {!tenantSlug && (
                  <>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setMostrarRegistroTenant(true)}
                      className="text-blue-600 hover:text-blue-800 transition"
                    >
                      Crear mi CDA
                    </button>
                  </>
                )}
              </div>
            )}
          </form>

          <div className="mt-7 border-t border-slate-200 pt-5 text-center text-[11px] text-slate-500">
            <p>{effectiveBrand.nombreComercial} - Sistema integral para administración de CDA</p>
          </div>
        </div>
      </div>

      {/* Modal: Olvidé mi contraseña */}
      {mostrarForgotPassword && (
        <div className="fixed inset-0 bg-slate-900/55 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="glass-card max-w-md w-full p-6 border border-slate-200/70">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-800">Recuperar contraseña</h3>
                <button
                  onClick={() => {
                    setMostrarForgotPassword(false);
                    setForgotEmail('');
                    setMensajeForgot('');
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                Ingresa tu email y te enviaremos instrucciones para restablecer tu contraseña.
              </p>

              {/* Formulario */}
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="input-corporate"
                    placeholder="tu@email.com"
                    required
                  />
                </div>

                {mensajeForgot && (
                  <div className={`p-3 rounded-lg text-sm ${
                    !mensajeForgot.startsWith('No fue posible')
                      ? 'bg-green-50 border-2 border-green-200 text-green-800'
                      : 'bg-red-50 border-2 border-red-200 text-red-800'
                  }`}>
                    {mensajeForgot}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMostrarForgotPassword(false);
                      setForgotEmail('');
                      setMensajeForgot('');
                    }}
                    className="flex-1 btn-corporate-muted"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={forgotPasswordMutation.isLoading}
                    className="flex-1 btn-corporate-primary disabled:opacity-50"
                  >
                    {forgotPasswordMutation.isLoading ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </form>
          </div>
        </div>
      )}

      {/* Modal: Registro de tenant CDA */}
      {mostrarRegistroTenant && (
        <div className="fixed inset-0 bg-slate-900/55 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="glass-card max-w-lg w-full p-6 border border-slate-200/70">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-800">Crear CDA</h3>
              <button
                onClick={() => {
                  setMostrarRegistroTenant(false);
                  setMensajeRegistro('');
                  setRegisterCaptchaToken('');
                  setRegisterCaptchaError('');
                  setRegisterValidationError('');
                  setEmailCodeTarget('');
                  setRegisterLogoFile(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Registra tu CDA y crea el usuario administrador inicial.
            </p>

            {(registerValidationError || mensajeRegistro) && (
              <div
                className={`mb-3 p-3 rounded-lg text-sm ${
                  registerValidationError || mensajeRegistro.startsWith('No fue posible')
                    ? 'bg-red-50 border border-red-200 text-red-800'
                    : 'bg-green-50 border border-green-200 text-green-800'
                }`}
              >
                {registerValidationError || mensajeRegistro}
              </div>
            )}

            <form onSubmit={handleRegisterTenant} className="space-y-3">
              <input
                type="text"
                value={registerNombreCda}
                onChange={(e) => setRegisterNombreCda(e.target.value.toUpperCase())}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                placeholder="Nombre de tu CDA / Marca"
                required
              />
              <input
                type="text"
                value={registerNitCda}
                onChange={(e) => setRegisterNitCda(normalizeNitInput(e.target.value))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                placeholder="NIT del CDA"
                required
              />
              <input
                type="text"
                value={registerRepresentanteNombre}
                onChange={(e) => setRegisterRepresentanteNombre(e.target.value.toUpperCase())}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                placeholder="Nombre representante legal o administrador"
                required
              />
              <input
                type="email"
                value={registerCorreoElectronico}
                onChange={(e) => setRegisterCorreoElectronico(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                placeholder="Correo electrónico"
                required
              />
              <input
                type="tel"
                value={registerCelular}
                onChange={(e) => setRegisterCelular(normalizePhoneInput(e.target.value))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                placeholder="Celular"
                required
              />
              <input
                type="number"
                min={1}
                max={100}
                value={registerSedesTotales}
                onChange={(e) => setRegisterSedesTotales(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                placeholder="Total sedes (principal + sucursales)"
                required
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={registerEmailCode}
                  onChange={(e) => setRegisterEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg"
                  placeholder="Código verificación (6 dígitos)"
                  required
                />
                <button
                  type="button"
                  onClick={() => {
                    setMensajeRegistro('');
                    setRegisterValidationError('');
                    if (!registerCorreoElectronico || !registerNombreCda) {
                      setRegisterValidationError('Primero ingresa nombre del CDA y correo electrónico.');
                      return;
                    }
                    setEmailCodeTarget(registerCorreoElectronico.trim().toLowerCase());
                    sendEmailCodeMutation.mutate();
                  }}
                  disabled={sendEmailCodeMutation.isLoading}
                  className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
                >
                  {sendEmailCodeMutation.isLoading ? 'Enviando...' : 'Enviar código'}
                </button>
              </div>
              <input
                type="password"
                value={registerAdminPassword}
                onChange={(e) => setRegisterAdminPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                placeholder="Contraseña inicial"
                required
                minLength={6}
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`px-3 py-2 rounded-lg text-xs font-semibold ${logoInputMode === 'url' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                  onClick={() => setLogoInputMode('url')}
                >
                  Logo por URL
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 rounded-lg text-xs font-semibold ${logoInputMode === 'file' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                  onClick={() => setLogoInputMode('file')}
                >
                  Subir logo
                </button>
              </div>

              {logoInputMode === 'url' ? (
                <input
                  key="logo-url"
                  type="url"
                  value={registerLogoUrl}
                  onChange={(e) => setRegisterLogoUrl(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                  placeholder="URL del logo"
                  required
                />
              ) : (
                <input
                  key="logo-file"
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  onChange={(e) => setRegisterLogoFile(e.target.files?.[0] || null)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                  required
                />
              )}

              {turnstileEnabled && (
                <div className="pt-1">
                  {!turnstileSiteKey ? (
                    <div className="p-3 rounded-lg text-sm bg-amber-50 border border-amber-200 text-amber-800">
                      Configura `VITE_TURNSTILE_SITE_KEY` para habilitar captcha.
                    </div>
                  ) : (
                    <div id="turnstile-container" className="min-h-[65px]" />
                  )}
                </div>
              )}

              {registerCaptchaError && (
                <div className="p-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-800">
                  {registerCaptchaError}
                </div>
              )}
              {mensajeRegistro && !(registerValidationError || mensajeRegistro.startsWith('No fue posible')) && (
                <div className={`p-3 rounded-lg text-sm ${
                  !mensajeRegistro.startsWith('No fue posible')
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-red-50 border border-red-200 text-red-800'
                }`}>
                  {mensajeRegistro}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setMostrarRegistroTenant(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={registerTenantMutation.isLoading}
                  className="flex-1 px-4 py-2 text-white rounded-lg font-semibold transition disabled:opacity-50"
                  style={{ backgroundColor: effectiveBrand.colorPrimario }}
                >
                  {registerTenantMutation.isLoading ? 'Creando...' : 'Crear CDA'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="text-center text-[11px] text-slate-500 pb-4">
        {tenantSlug && (
          <p className="mb-1 text-[10px]">
            ¿Eres administrador SaaS? <Link to="/saas/login" className="underline">Ingresa aquí</Link>
          </p>
        )}
        <p>Copyright © 2026 Prometheus Tech. Todos los derechos reservados.</p>
      </div>
    </div>
  );
}

