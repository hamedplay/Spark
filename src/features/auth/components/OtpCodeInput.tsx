import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react';
import {
  DEFAULT_OTP_LENGTH,
  applyOtpFragment,
  normalizeOtpDigits,
  removeOtpDigit,
} from './otpCode';
import './otpCodeInput.css';

export type OtpCodeInputStatus = 'idle' | 'checking' | 'error' | 'success';

interface OtpCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  label?: string;
  hint?: string;
  status?: OtpCodeInputStatus;
  errorMessage?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  autoFocusKey?: string | number;
}

export default function OtpCodeInput({
  value,
  onChange,
  length = DEFAULT_OTP_LENGTH,
  label = 'کد تأیید',
  hint = 'کد ارسال‌شده را وارد کنید',
  status = 'idle',
  errorMessage,
  disabled = false,
  autoFocus = true,
  autoFocusKey,
}: OtpCodeInputProps) {
  const fieldId = useId();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? '');
  const locked = disabled || status === 'checking' || status === 'success';
  const complete = value.length === length;

  const focusIndex = (index: number) => {
    const safeIndex = Math.max(0, Math.min(index, length - 1));
    const input = inputRefs.current[safeIndex];
    input?.focus();
    input?.select();
  };

  useEffect(() => {
    if (!autoFocus || locked) return;
    const target = Math.min(value.length, length - 1);
    const frame = window.requestAnimationFrame(() => focusIndex(target));
    return () => window.cancelAnimationFrame(frame);
    // autoFocusKey intentionally re-runs focus when a new OTP challenge starts.
  }, [autoFocus, autoFocusKey, length]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitFragment = (index: number, rawValue: string) => {
    const incoming = normalizeOtpDigits(rawValue);
    if (!incoming) {
      if (digits[index]) onChange(removeOtpDigit(value, index, length));
      return;
    }

    const isWholeCode = incoming.length >= length;
    const startIndex = isWholeCode ? 0 : Math.min(index, value.length);
    const next = applyOtpFragment(value, startIndex, incoming, length);
    onChange(next);

    if (next.length < length) {
      focusIndex(Math.min(startIndex + incoming.length, next.length));
    } else {
      focusIndex(length - 1);
    }
  };

  const handleChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    commitFragment(index, event.target.value);
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = normalizeOtpDigits(event.clipboardData.getData('text'));
    if (!pasted) return;
    event.preventDefault();
    commitFragment(pasted.length >= length ? 0 : index, pasted);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusIndex(index - 1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusIndex(index + 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusIndex(Math.max(0, Math.min(value.length, length) - 1));
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) {
        onChange(removeOtpDigit(value, index, length));
        focusIndex(index);
      } else if (index > 0) {
        onChange(removeOtpDigit(value, index - 1, length));
        focusIndex(index - 1);
      }
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      if (digits[index]) onChange(removeOtpDigit(value, index, length));
    }
  };

  const statusText = status === 'checking'
    ? 'در حال بررسی کد…'
    : status === 'success'
      ? 'کد با موفقیت تأیید شد'
      : status === 'error'
        ? errorMessage || 'کد واردشده معتبر نیست'
        : complete
          ? 'کد کامل است و آماده تأیید است'
          : `${value.length} رقم از ${length} رقم وارد شده است`;

  return (
    <div
      className="spark-otp-code"
      data-state={status}
      data-complete={complete ? 'true' : 'false'}
      dir="rtl"
    >
      <div className="spark-otp-code__heading">
        <span className="spark-otp-code__icon" aria-hidden="true"><ShieldCheck /></span>
        <span>
          <strong id={`${fieldId}-label`}>{label}</strong>
          <small id={`${fieldId}-hint`}>{hint}</small>
        </span>
      </div>

      <div
        className="spark-otp-code__slots"
        role="group"
        aria-labelledby={`${fieldId}-label`}
        aria-describedby={`${fieldId}-hint ${fieldId}-status`}
        dir="ltr"
      >
        {digits.map((digit, index) => (
          <label
            className={`spark-otp-code__slot${digit ? ' is-filled' : ''}`}
            key={index}
            data-index={index}
          >
            <span className="spark-otp-code__sr-only">رقم {index + 1} از {length}</span>
            <input
              ref={node => { inputRefs.current[index] = node; }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              enterKeyHint={index === length - 1 ? 'done' : 'next'}
              maxLength={length}
              value={digit}
              disabled={locked}
              aria-invalid={status === 'error' ? 'true' : undefined}
              onChange={event => handleChange(index, event)}
              onPaste={event => handlePaste(index, event)}
              onKeyDown={event => handleKeyDown(index, event)}
              onFocus={event => event.currentTarget.select()}
              data-lpignore="true"
            />
            <span className="spark-otp-code__digit" aria-hidden="true">{digit}</span>
            <span className="spark-otp-code__glow" aria-hidden="true" />
          </label>
        ))}

        <div className="spark-otp-code__verification" aria-hidden="true">
          <span className="spark-otp-code__verification-track" />
          {Array.from({ length }, (_, index) => <i key={index} style={{ '--spark-otp-i': index } as CSSProperties} />)}
          <span className="spark-otp-code__verification-seal">
            {status === 'checking' ? <LoaderCircle /> : <CheckCircle2 />}
          </span>
        </div>
      </div>

      <div
        id={`${fieldId}-status`}
        className="spark-otp-code__status"
        role={status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {status === 'checking' && <LoaderCircle className="spark-otp-code__status-icon spark-spin" aria-hidden="true" />}
        {status === 'success' && <CheckCircle2 className="spark-otp-code__status-icon" aria-hidden="true" />}
        <span>{statusText}</span>
      </div>
    </div>
  );
}
