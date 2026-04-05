import axios from 'axios';
import { getStoredTenantLoginPath } from '../utils/authRedirect';

/** En desarrollo, por defecto mismo origen + proxy en vite.config (evita timeouts por CORS/red con localhost). */
const API_URL =
  import.meta.env.VITE_API_URL?.trim() ||
  (import.meta.env.DEV ? '/api/v1' : 'http://127.0.0.1:8000/api/v1');

/** En dev más margen por DB lenta; en prod configurable con VITE_API_TIMEOUT_MS. */
const REQUEST_TIMEOUT_MS =
  Number(import.meta.env.VITE_API_TIMEOUT_MS) ||
  (import.meta.env.DEV ? 120000 : 45000);

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT_MS,
});

/** Base URL del API (misma que usa apiClient); útil para fetch() que no pasa por axios. */
export { API_URL as apiBaseUrl };

// Interceptor para agregar el token JWT a todas las peticiones
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para manejar errores de autenticación
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const currentScope = localStorage.getItem('auth_scope') || 'tenant';

    // Si el token expiró (401) y no hemos reintentado ya
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token');
        const refreshEndpoint =
          currentScope === 'saas' ? `${API_URL}/saas/auth/refresh` : `${API_URL}/auth/refresh`;

        if (refreshToken) {
          const response = await axios.post(
            refreshEndpoint,
            { refresh_token: refreshToken },
            { timeout: REQUEST_TIMEOUT_MS }
          );

          const { access_token, refresh_token } = response.data;
          localStorage.setItem('access_token', access_token);
          if (refresh_token) {
            localStorage.setItem('refresh_token', refresh_token);
          }

          // Reintentar la petición original con el nuevo token
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        // Si falla el refresh, cerrar sesión
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('auth_scope');
        window.location.href = currentScope === 'saas' ? '/saas/login' : getStoredTenantLoginPath();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
