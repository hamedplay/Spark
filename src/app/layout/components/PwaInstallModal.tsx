import {
  X,
  Check,
  Download,
  Smartphone,
  Monitor,
  ExternalLink,
} from 'lucide-react';

import type {
  BeforeInstallPromptEvent,
  PwaInstallChoice,
  NavigatorWithStandalone,
} from '../types/pwa';

export interface PwaInstallModalProps {
  installPrompt:
    | BeforeInstallPromptEvent
    | null;

  onPromptInstall: () => Promise<
    PwaInstallChoice['outcome'] | null
  >;

  onClose: () => void;
}

export function PwaInstallModal({
  installPrompt,
  onPromptInstall,
  onClose,
}: PwaInstallModalProps) {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)')
      .matches ||
    (window.navigator as NavigatorWithStandalone)
      .standalone;
  const isIOS = /iphone|ipad|ipod/i.test(
    navigator.userAgent
  );
  const isAndroid = /android/i.test(
    navigator.userAgent
  );
  const appUrl = window.location.origin;

  const handleInstallClick = async () => {
    const outcome =
      await onPromptInstall();
    if (outcome === 'accepted') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden"
        style={{
          paddingBottom:
            'env(safe-area-inset-bottom, 0px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <img
              src="/icons/icon-192x192.png"
              alt="Spark"
              className="w-10 h-10 rounded-xl shadow"
            />
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                نصب اسپارک
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                دریافت نسخه تحت وب (PWA)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-3" dir="rtl">
          {isStandalone ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <Check className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
              <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                اسپارک قبلاً روی این دستگاه نصب شده است
              </p>
            </div>
          ) : (
            <>
              {/* iOS button */}
              {(isIOS ||
                (!isAndroid && !installPrompt)) && (
                <a
                  href={appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 w-full p-4 rounded-xl bg-gray-900 hover:bg-black text-white transition-colors"
                  onClick={onClose}
                >
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                    <Smartphone className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-right">
                    <p className="text-sm font-bold">
                      iPhone / iPad
                    </p>
                    <p className="text-xs text-white/70">
                      در Safari باز کنید ← Share ← Add to Home Screen
                    </p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-white/60 flex-shrink-0" />
                </a>
              )}

              {/* Android / Desktop install button */}
              {installPrompt ? (
                <button
                  onClick={handleInstallClick}
                  className="flex items-center gap-3 w-full p-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                    <Download className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-right">
                    <p className="text-sm font-bold">
                      {isAndroid ? 'اندروید' : 'دسکتاپ'}
                    </p>
                    <p className="text-xs text-white/80">
                      برای نصب اینجا ضربه بزنید
                    </p>
                  </div>
                  <Download className="w-4 h-4 text-white/60 flex-shrink-0" />
                </button>
              ) : (
                !isIOS && (
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                    <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                      <Monitor className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 text-right">
                      <p className="text-sm font-semibold text-gray-800 dark:text-white">
                        دسکتاپ / اندروید
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        آیکن ⊕ در نوار آدرس مرورگر را بزنید
                      </p>
                    </div>
                  </div>
                )
              )}

              {/* Web link */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <ExternalLink className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-400">
                  لینک وب:
                </span>
                <a
                  href={appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate font-medium"
                >
                  {appUrl}
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
