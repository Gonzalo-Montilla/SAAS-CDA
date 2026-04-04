import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Usuario, SaaSUser, LoginCredentials, LoginResponse, AuthScope } from '../types';
import apiClient from '../api/client';
import { getStoredTenantLoginPath, getTenantLoginPath, persistTenantSlug } from '../utils/authRedirect';

interface AuthContextType {
  user: Usuario | SaaSUser | null;
  authScope: AuthScope | null;
  loading: boolean;
  login: (credentials: LoginCredentials, scope?: AuthScope) => Promise<void>;
  logout: () => void;
  getLogoutRedirectPath: () => string;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const MAX_FETCH_USER_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryFetchUser(error: any): boolean {
  const status = error?.response?.status;
  const code = error?.code;

  // Retry only for transient network/server failures.
  if (!status) {
    return true;
  }
  if (status >= 500) {
    return true;
  }
  return code === 'ECONNABORTED' || code === 'ERR_NETWORK';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | SaaSUser | null>(null);
  const [authScope, setAuthScope] = useState<AuthScope | null>(null);
  const [loading, setLoading] = useState(true);

  const getTenantSlugFromCurrentUser = (): string | undefined => {
    if (!user || authScope !== 'tenant') {
      return undefined;
    }
    if ('tenant_slug' in user) {
      return (user as Usuario).tenant_slug || undefined;
    }
    return undefined;
  };

  useEffect(() => {
    // Verificar si hay token al cargar
    const token = localStorage.getItem('access_token');
    const savedScope = localStorage.getItem('auth_scope') as AuthScope | null;
    if (token) {
      if (!savedScope) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setLoading(false);
        return;
      }
      setAuthScope(savedScope);
      fetchCurrentUser(savedScope);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchCurrentUser = async (scope: AuthScope) => {
    const meEndpoint = scope === 'saas' ? '/saas/auth/me' : '/auth/me';

    try {
      let lastError: any = null;

      for (let attempt = 0; attempt <= MAX_FETCH_USER_RETRIES; attempt += 1) {
        try {
          const response = await apiClient.get<Usuario | SaaSUser>(meEndpoint);
          setUser(response.data);
          if (scope === 'tenant' && 'tenant_slug' in response.data) {
            persistTenantSlug((response.data as Usuario).tenant_slug);
          }
          return;
        } catch (error: any) {
          lastError = error;
          if (attempt >= MAX_FETCH_USER_RETRIES || !shouldRetryFetchUser(error)) {
            break;
          }
          await sleep(400 * (attempt + 1));
        }
      }

      throw lastError;
    } catch (error) {
      console.error('Error fetching user:', error);
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('auth_scope');
      setAuthScope(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (credentials: LoginCredentials, scope: AuthScope = 'tenant') => {
    const formData = new URLSearchParams();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);
    if (scope === 'tenant' && credentials.tenant_slug) {
      formData.append('tenant_slug', credentials.tenant_slug);
    }

    const loginEndpoint = scope === 'saas' ? '/saas/auth/login' : '/auth/login';
    const response = await apiClient.post<LoginResponse>(loginEndpoint, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const { access_token, refresh_token } = response.data;
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('refresh_token', refresh_token);
    localStorage.setItem('auth_scope', scope);
    if (scope === 'tenant') {
      persistTenantSlug(credentials.tenant_slug);
    }
    setAuthScope(scope);

    await fetchCurrentUser(scope);
  };

  const getLogoutRedirectPath = (): string => {
    if (authScope === 'saas') {
      return '/saas/login';
    }
    const tenantSlug = getTenantSlugFromCurrentUser();
    return tenantSlug ? getTenantLoginPath(tenantSlug) : getStoredTenantLoginPath();
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('auth_scope');
    setUser(null);
    setAuthScope(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authScope,
        loading,
        login,
        logout,
        getLogoutRedirectPath,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
