import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BrandProvider } from './contexts/BrandContext';
import { ToastProvider } from './contexts/ToastContext';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Recepcion from './pages/Recepcion';
import Caja from './pages/Caja';
import Tarifas from './pages/Tarifas';
import Tesoreria from './pages/Tesoreria';
import Reportes from './pages/Reportes';
import Usuarios from './pages/Usuarios';
import ResetPassword from './pages/ResetPassword';
import SaaSBackoffice from './pages/SaaSBackoffice';
import type { AuthScope } from './types';

const queryClient = new QueryClient();

function ProtectedRoute({
  children,
  requiredScope,
}: {
  children: ReactNode;
  requiredScope?: AuthScope;
}) {
  const { isAuthenticated, loading, authScope } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🚗</div>
          <p className="text-gray-600">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (requiredScope && authScope !== requiredScope) {
    return <Navigate to={authScope === 'saas' ? '/saas/backoffice' : '/dashboard'} replace />;
  }

  return <>{children}</>;
}

function HomeRedirect() {
  const { isAuthenticated, authScope } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={authScope === 'saas' ? '/saas/backoffice' : '/dashboard'} replace />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <BrandProvider>
              <ErrorBoundary>
                <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/saas/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute requiredScope="tenant">
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/recepcion"
              element={
                <ProtectedRoute requiredScope="tenant">
                  <Recepcion />
                </ProtectedRoute>
              }
            />
            <Route
              path="/caja"
              element={
                <ProtectedRoute requiredScope="tenant">
                  <Caja />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tarifas"
              element={
                <ProtectedRoute requiredScope="tenant">
                  <Tarifas />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tesoreria"
              element={
                <ProtectedRoute requiredScope="tenant">
                  <Tesoreria />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reportes"
              element={
                <ProtectedRoute requiredScope="tenant">
                  <Reportes />
                </ProtectedRoute>
              }
            />
            <Route
              path="/usuarios"
              element={
                <ProtectedRoute requiredScope="tenant">
                  <Usuarios />
                </ProtectedRoute>
              }
            />
            <Route
              path="/saas/backoffice"
              element={
                <ProtectedRoute requiredScope="saas">
                  <SaaSBackoffice />
                </ProtectedRoute>
              }
            />
                <Route path="/:tenantSlug" element={<Login />} />
                <Route path="/" element={<HomeRedirect />} />
                </Routes>
              </ErrorBoundary>
            </BrandProvider>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
