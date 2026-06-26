import axios, { type InternalAxiosRequestConfig } from 'axios';
import { getStoredTenantLoginPath } from '../utils/authRedirect';

/**
 * URL base del API. En `npm run dev` usamos el proxy de Vite salvo URL local explícita.
 * Importante: si en PowerShell dejaste $env:VITE_API_URL="https://dominio.com/..." para un build,
 * esa variable sigue activa y rompería el local; en DEV ignoramos URLs https a dominios remotos.
 */
function resolveApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL?.trim() ?? '';
  if (import.meta.env.DEV) {
    if (!raw) return '/api/v1';
    if (raw.startsWith('/')) return raw;
    const lower = raw.toLowerCase();
    if (lower.startsWith('http://127.0.0.1') || lower.startsWith('http://localhost')) {
      return raw;
    }
    return '/api/v1';
  }
  return raw || 'http://127.0.0.1:8000/api/v1';
}

const API_URL = resolveApiBaseUrl();

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

/** Una sola renovación en vuelo: evita varios POST /refresh en paralelo (401 en cascada en el backoffice). */
let refreshInFlight: Promise<string | null> | null = null;

function clearSessionAndRedirect(scope: string) {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('auth_scope');
  window.location.href = scope === 'saas' ? '/saas/login' : getStoredTenantLoginPath();
}

function shouldSkipRefreshRetry(config: InternalAxiosRequestConfig | undefined): boolean {
  const u = config?.url ?? '';
  if (!u) return false;
  // No reintentar login ni el propio refresh (evita bucles y reintentos absurdos).
  if (u.includes('/auth/login') || u.includes('/saas/auth/login')) return true;
  if (u.includes('/auth/refresh') || u.includes('/saas/auth/refresh')) return true;
  return false;
}

function setAuthHeader(config: InternalAxiosRequestConfig, token: string) {
  if (typeof config.headers?.set === 'function') {
    config.headers.set('Authorization', `Bearer ${token}`);
  } else {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refresh_token');
  const currentScope = localStorage.getItem('auth_scope') || 'tenant';
  const refreshEndpoint =
    currentScope === 'saas' ? `${API_URL}/saas/auth/refresh` : `${API_URL}/auth/refresh`;

  if (!refreshToken) {
    return null;
  }

  const response = await axios.post(
    refreshEndpoint,
    { refresh_token: refreshToken },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  const { access_token, refresh_token } = response.data as {
    access_token: string;
    refresh_token?: string;
  };
  localStorage.setItem('access_token', access_token);
  if (refresh_token) {
    localStorage.setItem('refresh_token', refresh_token);
  }
  return access_token;
}

function getOrCreateRefreshPromise(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken()
      .catch((err) => {
        throw err;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// Interceptor para agregar el token JWT a todas las peticiones
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      setAuthHeader(config, token);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Interceptor para manejar errores de autenticación
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const currentScope = localStorage.getItem('auth_scope') || 'tenant';

    if (!originalRequest) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry && !shouldSkipRefreshRetry(originalRequest)) {
      originalRequest._retry = true;

      try {
        const newAccess = await getOrCreateRefreshPromise();
        if (!newAccess) {
          clearSessionAndRedirect(currentScope);
          return Promise.reject(error);
        }
        setAuthHeader(originalRequest, newAccess);
        return apiClient(originalRequest);
      } catch {
        clearSessionAndRedirect(currentScope);
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
