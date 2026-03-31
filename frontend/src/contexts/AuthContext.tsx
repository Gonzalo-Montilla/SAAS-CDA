import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Usuario, SaaSUser, LoginCredentials, LoginResponse, AuthScope } from '../types';
import apiClient from '../api/client';

interface AuthContextType {
  user: Usuario | SaaSUser | null;
  authScope: AuthScope | null;
  loading: boolean;
  login: (credentials: LoginCredentials, scope?: AuthScope) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | SaaSUser | null>(null);
  const [authScope, setAuthScope] = useState<AuthScope | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Verificar si hay token al cargar
    const token = localStorage.getItem('access_token');
    const savedScope = (localStorage.getItem('auth_scope') as AuthScope | null) || 'tenant';
    if (token) {
      setAuthScope(savedScope);
      fetchCurrentUser(savedScope);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchCurrentUser = async (scope: AuthScope) => {
    const meEndpoint = scope === 'saas' ? '/saas/auth/me' : '/auth/me';

    try {
      const response = await apiClient.get<Usuario | SaaSUser>(meEndpoint);
      setUser(response.data);
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
    setAuthScope(scope);

    await fetchCurrentUser(scope);
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
