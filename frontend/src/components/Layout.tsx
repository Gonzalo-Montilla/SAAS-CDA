import { useAuth } from '../contexts/AuthContext';
import { useBrand } from '../contexts/BrandContext';
import { useNavigate } from 'react-router-dom';
import { Home, LogOut, User } from 'lucide-react';
import BranchSelector from './BranchSelector';
import BranchGateModal from './BranchGateModal';

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
      <BranchGateModal />
      {/* Header */}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-3 sm:gap-4 hover:opacity-80 transition-opacity min-w-0"
            >
              <img 
                src={brand.logoSrc}
                alt={brand.nombreComercial}
                className="h-12 sm:h-14 rounded-xl shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 truncate">{brand.nombreComercial}</p>
                <p className="text-sm text-slate-700 font-semibold truncate">{title}</p>
              </div>
            </button>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end min-w-0">
            <BranchSelector />
            <button
              onClick={() => navigate('/dashboard')}
              className="px-3 sm:px-4 btn-corporate-muted flex items-center gap-2"
            >
              <Home className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Inicio</span>
            </button>
            <div className="app-user-chip min-w-0">
              <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                <User className="w-4 h-4" />
              </div>
              <div className="text-right hidden sm:block min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate max-w-[10rem]">{user?.nombre_completo}</p>
                <p className="text-xs text-slate-500 capitalize truncate">{user?.rol}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 sm:px-4 btn-corporate-danger flex items-center gap-2"
            >
              <LogOut className="w-4 h-4 shrink-0" />
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
