import { useSyncExternalStore } from 'react';
import { canPromptInstall, isAndroid, isInstalled, isSamsungBrowser, promptInstall, subscribeInstall } from '../install';
import { Section } from '../components/ui';

export function useCanInstall() {
  return useSyncExternalStore(subscribeInstall, canPromptInstall);
}

export function InstallPanel() {
  const canInstall = useCanInstall();
  if (isInstalled()) return null;
  return (
    <Section title="📲 Instalar como app" dot="blue">
      <div className="stack">
        <div className="hint">
          Instalado, o NEXUS abre em tela cheia pelo ícone, sem barra do navegador, aparece na gaveta de apps e no menu Compartilhar do Android.
        </div>
        {canInstall ? (
          <button className="btn primary block" onClick={promptInstall}>Instalar NEXUS</button>
        ) : (
          <div className="notice">
            {isSamsungBrowser()
              ? 'No Samsung Internet: toque em ☰ (menu) → "Adicionar página a" → "Tela inicial" / "Apps".'
              : isAndroid()
                ? 'No Chrome: toque em ⋮ (menu) → "Instalar app" (ou "Adicionar à tela inicial" → Instalar).'
                : 'No Chrome/Edge do computador: clique no ícone de instalar na barra de endereço, ou menu → "Instalar NEXUS".'}
          </div>
        )}
      </div>
    </Section>
  );
}
