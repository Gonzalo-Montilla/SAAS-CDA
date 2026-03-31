import { createContext, useContext, useState, type ReactNode } from 'react';
import Toast, { type ToastType } from '../components/Toast';

interface ToastContextType {
  showToast: (type: ToastType, title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    show: boolean;
    type: ToastType;
    title: string;
    message?: string;
  }>({ show: false, type: 'success', title: '' });

  const showToast = (type: ToastType, title: string, message?: string) => {
    setToast({ show: true, type, title, message });
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast GLOBAL - NO afectado por ErrorBoundary de componentes hijos */}
      {toast.show && (
        <Toast
          type={toast.type}
          title={toast.title}
          message={toast.message}
          duration={5000}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast debe usarse dentro de ToastProvider');
  }
  return context;
}
