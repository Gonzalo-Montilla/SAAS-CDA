import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Ignorar errores de removeChild específicamente (bug conocido de React 18)
    if (error.message.includes('removeChild')) {
      // Silenciar completamente - es un bug de React 18, no un error real
      setTimeout(() => {
        this.setState({ hasError: false });
      }, 100);
      return;
    }
    // Solo loggear errores reales
    console.error('Error capturado:', error);
  }

  render() {
    if (this.state.hasError) {
      return null; // No mostrar nada mientras se resetea
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
