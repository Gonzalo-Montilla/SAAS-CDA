import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Home, LogOut, User } from 'lucide-react';
import logo from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';

interface LayoutProps {
  children: React.ReactNode;
  title: string;
}

export default function Layout({ children, title }: LayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-4 hover:opacity-80 transition-opacity"
            >
              <img 
                src={logo} 
                alt="CDASOFT" 
                className="h-20 rounded-2xl shadow-md"
              />
              <div>
                <p className="text-sm text-primary-600 font-medium">{title}</p>
              </div>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 text-sm bg-white text-gray-700 border-2 border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-all flex items-center gap-2"
            >
              <Home className="w-4 h-4" />
              Inicio
            </button>
            <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 rounded-xl border border-gray-200">
              <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center">
                <User className="w-4 h-4" />
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">{user?.nombre_completo}</p>
                <p className="text-xs text-gray-500 capitalize">{user?.rol}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Salir
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
