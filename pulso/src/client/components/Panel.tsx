import type { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { IconInfo } from './Icons';

interface PanelProps {
  title: string;
  /** Explicación del criterio (tooltip del ícono de información). */
  help?: string;
  count?: number;
  actions?: ReactNode;
  tabs?: Array<{ id: string; label: string; count?: number }>;
  activeTab?: string;
  onTab?: (id: string) => void;
  className?: string;
  area?: string;
  /** Pestaña del celular en la que aparece el panel. */
  mtab?: string;
  children: ReactNode;
}

export function Panel({ title, help, count, actions, tabs, activeTab, onTab, className, area, mtab, children }: PanelProps) {
  return (
    <section className={`panel ${className ?? ''}`} style={area ? { gridArea: area } : undefined} data-tab={mtab}>
      <header className="panel-head">
        {tabs && tabs.length > 1 ? (
          <div className="panel-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.id === activeTab}
                className={`panel-tab ${t.id === activeTab ? 'is-active' : ''}`}
                onClick={() => onTab?.(t.id)}
              >
                {t.label}
                {t.count !== undefined && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="panel-title">
            {title}
            {count !== undefined && <span className="count">{count}</span>}
          </h2>
        )}
        {help && (
          <span className="help" title={help} aria-label={help} tabIndex={0}>
            <IconInfo />
          </span>
        )}
        <div className="panel-actions">{actions}</div>
      </header>
      <div className="panel-body">
        <ErrorBoundary label={title}>{children}</ErrorBoundary>
      </div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
