import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles/global.css';

// VITE_NO_SW=1 permite publicar la app en entornos donde no aplica un service worker (por ejemplo, un iframe hospedado).
if (!import.meta.env.VITE_NO_SW) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
