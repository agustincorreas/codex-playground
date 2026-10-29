import { useId, type ReactNode } from 'react';
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
  // Cada ventana se anuncia por su título; con pestañas, el cuerpo es el panel de la pestaña activa.
  const id = useId();
  const tabbed = !!tabs && tabs.length > 1;
  const tabId = (t: string) => `${id}-tab-${t}`;
  return (
    <section className={`panel ${className ?? ''}`} style={area ? { gridArea: area } : undefined} data-tab={mtab} aria-labelledby={tabbed ? undefined : `${id}-title`} aria-label={tabbed ? title : undefined}>
      <header className="panel-head">
        {tabbed ? (
          <div className="panel-tabs" role="tablist" aria-label={title}>
            {tabs.map((t) => (
              <button
                key={t.id}
                id={tabId(t.id)}
                role="tab"
                aria-selected={t.id === activeTab}
                aria-controls={`${id}-body`}
                tabIndex={t.id === activeTab ? 0 : -1}
                className={`panel-tab ${t.id === activeTab ? 'is-active' : ''}`}
                onClick={() => onTab?.(t.id)}
                onKeyDown={(e) => {
                  // Flechas: pasan de pestaña sin salir del grupo (Tab sigue al contenido).
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  const i = tabs.findIndex((x) => x.id === t.id);
                  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                  e.preventDefault();
                  onTab?.(next.id);
                  document.getElementById(tabId(next.id))?.focus();
                }}
              >
                {t.label}
                {t.count !== undefined && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="panel-title" id={`${id}-title`}>
            {title}
            {count !== undefined && <span className="count">{count}</span>}
          </h2>
        )}
        {help && (
          <button type="button" className="help" title={help} aria-label={`Ayuda: ${help}`}>
            <IconInfo />
          </button>
        )}
        <div className="panel-actions">{actions}</div>
      </header>
      <div className="panel-body" id={tabbed ? `${id}-body` : undefined} role={tabbed ? 'tabpanel' : undefined} aria-labelledby={tabbed && activeTab ? tabId(activeTab) : undefined}>
        <ErrorBoundary label={title}>{children}</ErrorBoundary>
      </div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
