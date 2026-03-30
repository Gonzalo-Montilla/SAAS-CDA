import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useBrand } from '../contexts/BrandContext';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const brand = useBrand();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('Token no válido. Por favor solicita un nuevo enlace de recuperación.');
    }
  }, [token]);

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: { token: string; new_password: string }) => {
      const response = await apiClient.post('/auth/reset-password', data);
      return response.data;
    },
    onSuccess: () => {
      setMensaje('✅ Contraseña actualizada exitosamente. Redirigiendo al login...');
      setError('');
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.detail || 'Error al actualizar la contraseña';
      setError(`❌ ${errorMsg}`);
      setMensaje('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje('');

    if (!token) {
      setError('Token no válido');
      return;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    resetPasswordMutation.mutate({ token, new_password: password });
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-sm px-7 py-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src={brand.logoSrc}
              alt={brand.nombreComercial}
              className="h-44 w-auto mb-5 object-contain"
            />
            <p className="text-[13px] text-slate-500">Sistema de Gestión</p>
          </div>

          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-slate-800">Restablecer Contraseña</h2>
            <p className="text-sm text-slate-600 mt-2">Ingresa tu nueva contraseña</p>
          </div>

          {mensaje && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
              {mensaje}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
              {error}
            </div>
          )}

          {token && !mensaje && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Nueva Contraseña
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Mínimo 6 caracteres"
                  required
                  minLength={6}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Confirmar Contraseña
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Repite la contraseña"
                  required
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                disabled={resetPasswordMutation.isLoading}
                className="w-full rounded-md text-white text-sm font-semibold py-2.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: brand.colorPrimario }}
              >
                {resetPasswordMutation.isLoading ? 'Actualizando...' : 'Actualizar Contraseña'}
              </button>

              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm font-semibold py-2.5 transition"
              >
                Volver al Login
              </button>
            </form>
          )}

          {!token && (
            <div className="text-center">
              <button
                onClick={() => navigate('/login')}
                className="w-full rounded-md text-white text-sm font-semibold py-2.5 transition"
                style={{ backgroundColor: brand.colorPrimario }}
              >
                Ir al Login
              </button>
            </div>
          )}

          <div className="mt-7 border-t border-slate-200 pt-5 text-center text-[11px] text-slate-500">
            <p>{brand.nombreComercial} - sistema integral para administracion de cda</p>
          </div>
        </div>
      </div>
      <div className="text-center text-[11px] text-slate-500 pb-4">
        <p>Copyright © 2026 Prometheus Tech. Todos los derechos reservados.</p>
      </div>
    </div>
  );
}

