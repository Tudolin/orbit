import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { LockGate } from './views/LockScreen';
import './styles.css';

registerSW({ immediate: true });
// Pede ao navegador para não apagar o IndexedDB sob pressão de espaço.
navigator.storage?.persist?.();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LockGate>
      <App />
    </LockGate>
  </StrictMode>,
);
