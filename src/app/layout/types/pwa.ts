export interface PwaInstallChoice {
  outcome:
    | 'accepted'
    | 'dismissed';

  platform: string;
}

export interface BeforeInstallPromptEvent
  extends Event {
  prompt(): Promise<void>;

  userChoice:
    Promise<PwaInstallChoice>;
}

export interface WindowWithDeferredInstallPrompt
  extends Window {
  deferredInstallPrompt?:
    | BeforeInstallPromptEvent
    | null;
}

export interface NavigatorWithStandalone
  extends Navigator {
  standalone?: boolean;
}
