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
      setError('El enlace de recuperación no es válido. Solicita uno nuevo.');
    }
  }, [token]);

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: { token: string; new_password: string }) => {
      const response = await apiClient.post('/auth/reset-password', data);
      return response.data;
    },
    onSuccess: () => {
      setMensaje('Contraseña actualizada exitosamente. Redirigiendo al inicio de sesión...');
      setError('');
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.detail || 'No fue posible actualizar la contraseña. Intenta nuevamente.';
      setError(errorMsg);
      setMensaje('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje('');

    if (!token) {
      setError('El token no es válido.');
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
    <div className="corporate-shell flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md glass-card px-7 py-8">
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
                  className="input-corporate"
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
                  className="input-corporate"
                  placeholder="Repite la contraseña"
                  required
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                disabled={resetPasswordMutation.isLoading}
                className="w-full btn-corporate-primary"
              >
                {resetPasswordMutation.isLoading ? 'Actualizando...' : 'Actualizar Contraseña'}
              </button>

              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full btn-corporate-muted"
              >
                Volver al inicio de sesión
              </button>
            </form>
          )}

          {!token && (
            <div className="text-center">
              <button
                onClick={() => navigate('/login')}
                className="w-full btn-corporate-primary"
              >
                Ir al inicio de sesión
              </button>
            </div>
          )}

          <div className="mt-7 border-t border-slate-200 pt-5 text-center text-[11px] text-slate-500">
            <p>{brand.nombreComercial} - Sistema integral para administración de CDA</p>
          </div>
        </div>
      </div>
      <div className="text-center text-[11px] text-slate-500 pb-4">
        <p>Copyright © 2026 Prometheus Tech. Todos los derechos reservados.</p>
      </div>
    </div>
  );
}

