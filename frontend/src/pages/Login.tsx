import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';
import type { AuthScope } from '../types';
import logo from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<AuthScope>('tenant');
  const [mostrarForgotPassword, setMostrarForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [mensajeForgot, setMensajeForgot] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login({ username: email, password }, loginMode);
      navigate(loginMode === 'saas' ? '/saas/backoffice' : '/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const forgotPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await apiClient.post('/auth/forgot-password', { email });
      return response.data;
    },
    onSuccess: () => {
      setMensajeForgot('✅ Si el email existe, recibirás instrucciones para recuperar tu contraseña.');
    },
    onError: () => {
      setMensajeForgot('❌ Error al enviar el email. Intenta nuevamente.');
    },
  });

  const handleForgotPassword = (e: FormEvent) => {
    e.preventDefault();
    setMensajeForgot('');
    forgotPasswordMutation.mutate(forgotEmail);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-sm px-7 py-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src={logo}
              alt="CDASOFT"
              className="h-48 w-auto mb-5 object-contain"
            />
            <p className="text-[13px] text-slate-500">Sistema de Gestión</p>
          </div>

          <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setLoginMode('tenant')}
              className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
                loginMode === 'tenant'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white'
              }`}
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
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              className="w-full rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setMostrarForgotPassword(true)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            )}
          </form>

          <div className="mt-7 border-t border-slate-200 pt-5 text-center text-[11px] text-slate-500">
            <p>CDASOFT - sistema integral para administracion de cda</p>
          </div>
        </div>
      </div>

      {/* Modal: Olvidé mi contraseña */}
      {mostrarForgotPassword && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border-2 border-gray-100">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-800">🔑 Recuperar Contraseña</h3>
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
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                    placeholder="tu@email.com"
                    required
                  />
                </div>

                {mensajeForgot && (
                  <div className={`p-3 rounded-lg text-sm ${
                    mensajeForgot.includes('✅') 
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
                    className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-semibold transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={forgotPasswordMutation.isLoading}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {forgotPasswordMutation.isLoading ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </form>
          </div>
        </div>
      )}

      <div className="text-center text-[11px] text-slate-500 pb-4">
        <p>Copyright © 2026 Prometheus Tech. Todos los derechos reservados.</p>
      </div>
    </div>
  );
}

