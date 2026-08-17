import { useState, useCallback, useRef } from 'react';
import {
  listCurrentUserTotpFactors,
  performTotpStepUp,
  validateTotpCode,
  type StepUpPurpose,
  type TotpFactor,
} from '../../auth/services/mfaOperations';

export { type StepUpPurpose };

export interface SecurityStepUpState {
  open: boolean;
  busy: boolean;
  error: string | null;
  factors: TotpFactor[];
  selectedFactorId: string | null;
  code: string;
  loadingFactors: boolean;
}

export interface UseSecurityStepUpOptions {
  purpose: StepUpPurpose;
  title?: string;
  description?: string;
  confirmLabel?: string;
}

export interface SecurityStepUpController {
  state: SecurityStepUpState;
  setSelectedFactorId: (id: string | null) => void;
  setCode: (code: string) => void;
  close: () => void;
  verify: () => Promise<boolean>;
  requireStepUp: <T>(action: () => Promise<T>) => Promise<T>;
}

const DEFAULT_TITLE = 'تأیید امنیتی';
const DEFAULT_DESCRIPTION = 'برای این عملیات حساس، کد ۶ رقمی از برنامه احراز هویت خود را وارد کنید.';
const DEFAULT_CONFIRM_LABEL = 'تأیید و ادامه';

export function useSecurityStepUp(options: UseSecurityStepUpOptions): SecurityStepUpController {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loadingFactors, setLoadingFactors] = useState(false);

  const actionRef = useRef<(() => Promise<unknown>) | null>(null);
  const resolveRef = useRef<((value: unknown) => void) | null>(null);
  const rejectRef = useRef<((reason?: unknown) => void) | null>(null);

  const loadFactors = useCallback(async () => {
    setLoadingFactors(true);
    try {
      const allFactors = await listCurrentUserTotpFactors();
      const verified = allFactors.filter((f) => f.status === 'verified');
      setFactors(verified);
      if (verified.length === 1) {
        setSelectedFactorId(verified[0].id);
      } else {
        setSelectedFactorId(null);
      }
    } catch {
      setError('برنامه احراز هویت پیدا نشد.');
      setFactors([]);
    } finally {
      setLoadingFactors(false);
    }
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
    setCode('');
    setSelectedFactorId(null);
    setFactors([]);
    actionRef.current = null;
    resolveRef.current = null;
    rejectRef.current = null;
  }, [busy]);

  const verify = useCallback(async (): Promise<boolean> => {
    const validCode = validateTotpCode(code);
    if (!validCode) {
      setError('کد واردشده معتبر نیست.');
      return false;
    }
    if (!selectedFactorId) {
      setError('برنامه احراز هویت انتخاب نشده است.');
      return false;
    }

    setError(null);
    setBusy(true);
    try {
      const result = await performTotpStepUp({
        factorId: selectedFactorId,
        code: validCode,
        purpose: options.purpose,
      });

      if (!result.ok) {
        setError('احراز هویت دومرحله‌ای ناموفق بود. دوباره تلاش کنید.');
        return false;
      }

      setCode('');
      setOpen(false);
      setError(null);
      setSelectedFactorId(null);
      setFactors([]);

      const pendingAction = actionRef.current;
      const pendingResolve = resolveRef.current;
      const pendingReject = rejectRef.current;
      actionRef.current = null;
      resolveRef.current = null;
      rejectRef.current = null;

      if (pendingAction && pendingResolve && pendingReject) {
        try {
          const result = await pendingAction();
          pendingResolve(result);
        } catch (err) {
          pendingReject(err);
        }
      }

      return true;
    } catch {
      setError('خطا در احراز هویت.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [code, selectedFactorId, options.purpose]);

  const requireStepUp = useCallback(
    <T,>(action: () => Promise<T>): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        actionRef.current = action as () => Promise<unknown>;
        resolveRef.current = resolve as (value: unknown) => void;
        rejectRef.current = reject;
        setOpen(true);
        setError(null);
        setCode('');
        void loadFactors();
      });
    },
    [loadFactors],
  );

  return {
    state: {
      open,
      busy,
      error,
      factors,
      selectedFactorId,
      code,
      loadingFactors,
    },
    setSelectedFactorId,
    setCode,
    close,
    verify,
    requireStepUp,
  };
}

export const SECURITY_STEP_UP_DEFAULTS = {
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  confirmLabel: DEFAULT_CONFIRM_LABEL,
};
