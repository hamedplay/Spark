import { useEffect, useState } from 'react';

import type {
  BeforeInstallPromptEvent,
  PwaInstallChoice,
  WindowWithDeferredInstallPrompt,
} from '../types/pwa';

export interface UsePwaInstallPromptResult {
  installPrompt:
    BeforeInstallPromptEvent | null;

  showInstallBanner: boolean;

  promptInstall:
    () => Promise<
      PwaInstallChoice['outcome'] | null
    >;

  dismissInstallBanner:
    () => void;
}

export function usePwaInstallPrompt():
  UsePwaInstallPromptResult {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(
      null
    );
  const [showInstallBanner, setShowInstallBanner] =
    useState(false);

  useEffect(() => {
    localStorage.removeItem(
      'pwa_install_dismissed'
    );

    const pwaWindow =
      window as WindowWithDeferredInstallPrompt;
    if (pwaWindow.deferredInstallPrompt) {
      setInstallPrompt(
        pwaWindow.deferredInstallPrompt
      );
    }

    const onInstallable = () => {
      setInstallPrompt(
        pwaWindow.deferredInstallPrompt
      );
    };

    const onBeforeInstallPrompt = (
      e: Event
    ) => {
      e.preventDefault();
      const typedEvent =
        e as BeforeInstallPromptEvent;
      setInstallPrompt(typedEvent);
      pwaWindow.deferredInstallPrompt =
        typedEvent;
      setShowInstallBanner(true);
    };

    window.addEventListener(
      'pwa-installable',
      onInstallable
    );
    window.addEventListener(
      'beforeinstallprompt',
      onBeforeInstallPrompt
    );

    return () => {
      window.removeEventListener(
        'pwa-installable',
        onInstallable
      );
      window.removeEventListener(
        'beforeinstallprompt',
        onBeforeInstallPrompt
      );
    };
  }, []);

  const promptInstall = async (): Promise<
    PwaInstallChoice['outcome'] | null
  > => {
    if (!installPrompt) return null;
    installPrompt.prompt();
    const { outcome } =
      await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
      (
        window as WindowWithDeferredInstallPrompt
      ).deferredInstallPrompt = null;
    }
    return outcome;
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
  };

  return {
    installPrompt,
    showInstallBanner,
    promptInstall,
    dismissInstallBanner,
  };
}
