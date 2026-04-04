import { useAuth } from '../contexts/AuthContext';
import { useBrand } from '../contexts/BrandContext';
import { useNavigate } from 'react-router-dom';
import { Home, LogOut, User } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  title: string;
}

export default function Layout({ children, title }: LayoutProps) {
  const { user, logout, getLogoutRedirectPath } = useAuth();
  const brand = useBrand();
  const navigate = useNavigate();

  const handleLogout = () => {
    const redirectPath = getLogoutRedirectPath();
    logout();
    navigate(redirectPath);
  };

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-4 hover:opacity-80 transition-opacity"
            >
              <img 
                src={brand.logoSrc}
                alt={brand.nombreComercial}
                className="h-16 sm:h-20 rounded-2xl shadow-soft"
              />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{brand.nombreComercial}</p>
                <p className="text-sm text-primary-600 font-semibold">{title}</p>
              </div>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-4 btn-corporate-muted flex items-center gap-2"
            >
              <Home className="w-4 h-4" />
              Inicio
            </button>
            <div className="app-user-chip">
              <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center">
                <User className="w-4 h-4" />
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900">{user?.nombre_completo}</p>
                <p className="text-xs text-slate-500 capitalize">{user?.rol}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 btn-corporate-danger flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Salir
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        {children}
      </main>
    </div>
  );
}
