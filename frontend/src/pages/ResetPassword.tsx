import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
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
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="bg-blue-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
            <span className="text-4xl">🔧</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">CDASOFT</h1>
          <p className="text-sm text-gray-600">sistema integral para administracion de cda</p>
          <p className="text-sm text-gray-500 mt-2">Sistema de Punto de Venta · Revisión Técnico-Mecánica</p>
        </div>

        {/* Título */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Restablecer Contraseña</h2>
          <p className="text-sm text-gray-600 mt-2">Ingresa tu nueva contraseña</p>
        </div>

        {/* Mensajes */}
        {mensaje && (
          <div className="mb-4 p-4 bg-green-50 border-2 border-green-200 rounded-lg text-green-800 text-sm">
            {mensaje}
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 border-2 border-red-200 rounded-lg text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Formulario */}
        {token && !mensaje && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nueva Contraseña */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Nueva Contraseña *
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
              />
            </div>

            {/* Confirmar Contraseña */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Confirmar Contraseña *
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                placeholder="Repite la contraseña"
                required
                minLength={6}
              />
            </div>

            {/* Botones */}
            <button
              type="submit"
              disabled={resetPasswordMutation.isLoading}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white py-3 rounded-xl font-bold shadow-lg transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resetPasswordMutation.isLoading ? '⏳ Actualizando...' : '🔒 Actualizar Contraseña'}
            </button>

            <button
              type="button"
              onClick={() => navigate('/login')}
              className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 py-3 rounded-xl font-bold transition-all"
            >
              Volver al Login
            </button>
          </form>
        )}

        {/* Sin token válido */}
        {!token && (
          <div className="text-center">
            <button
              onClick={() => navigate('/login')}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white py-3 rounded-xl font-bold shadow-lg transition-all hover:scale-105"
            >
              Ir al Login
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-gray-500">
          <p>© 2026 CDASOFT</p>
          <p>Versión 1.0.0</p>
        </div>
      </div>
    </div>
  );
}

