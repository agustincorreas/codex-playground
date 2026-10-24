import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Si un panel falla, muestra el error en ese panel y el resto de la app sigue funcionando. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty t-down">
          Error en {this.props.label}: {this.state.error.message}{' '}
          <button className="btn-small" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
