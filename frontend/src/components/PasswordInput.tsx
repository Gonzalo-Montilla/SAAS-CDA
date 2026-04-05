import { useState, useRef, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Campo de contraseña con botón para mostrar u ocultar (accesible).
 */
export function PasswordInput({ className = '', id, autoComplete, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const fallbackIdRef = useRef<string | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = `pwd-${Math.random().toString(36).slice(2, 11)}`;
  }
  const inputId = id ?? fallbackIdRef.current;

  return (
    <div className="relative w-full">
      <input
        id={inputId}
        type={visible ? 'text' : 'password'}
        className={[className, 'pr-10'].filter(Boolean).join(' ')}
        autoComplete={autoComplete ?? 'current-password'}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400/50"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-controls={inputId}
      >
        {visible ? <EyeOff className="h-4 w-4 shrink-0" aria-hidden /> : <Eye className="h-4 w-4 shrink-0" aria-hidden />}
      </button>
    </div>
  );
}
