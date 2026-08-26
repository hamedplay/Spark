import './auth-pointer-glow.css';

const ROOT_SELECTOR = '.spark-reference-login';
const GLOW_CLASS = 'spark-auth-pointer-glow';

let activeRoot: HTMLElement | null = null;
let cleanupActiveRoot: (() => void) | null = null;
let syncFrame: number | null = null;

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function detachPointerGlow(): void {
  cleanupActiveRoot?.();
  cleanupActiveRoot = null;
  activeRoot = null;
}

function attachPointerGlow(root: HTMLElement): void {
  if (!finePointer.matches || reducedMotion.matches) return;

  const glow = document.createElement('div');
  glow.className = GLOW_CLASS;
  glow.setAttribute('aria-hidden', 'true');
  root.appendChild(glow);

  let rafId: number | null = null;
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;

  const paint = () => {
    rafId = null;
    glow.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0) translate3d(-50%, -50%, 0)`;
  };

  const schedulePaint = () => {
    if (rafId === null) rafId = window.requestAnimationFrame(paint);
  };

  const handlePointerMove = (event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    glow.classList.add('is-visible');
    schedulePaint();
  };

  const handlePointerLeave = () => {
    glow.classList.remove('is-visible');
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') glow.classList.remove('is-visible');
  };

  root.addEventListener('pointermove', handlePointerMove, { passive: true });
  root.addEventListener('pointerleave', handlePointerLeave, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);

  cleanupActiveRoot = () => {
    root.removeEventListener('pointermove', handlePointerMove);
    root.removeEventListener('pointerleave', handlePointerLeave);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    glow.remove();
  };
}

function syncPointerGlow(): void {
  syncFrame = null;
  const nextRoot = document.querySelector<HTMLElement>(ROOT_SELECTOR);

  if (nextRoot === activeRoot) return;

  detachPointerGlow();
  if (!nextRoot) return;

  activeRoot = nextRoot;
  attachPointerGlow(nextRoot);
}

function scheduleSync(): void {
  if (syncFrame !== null) return;
  syncFrame = window.requestAnimationFrame(syncPointerGlow);
}

function handlePointerCapabilityChange(): void {
  const root = document.querySelector<HTMLElement>(ROOT_SELECTOR);
  detachPointerGlow();
  if (!root) return;
  activeRoot = root;
  attachPointerGlow(root);
}

if (typeof document !== 'undefined' && document.documentElement.dataset.sparkAuthPointerGlow !== '1') {
  document.documentElement.dataset.sparkAuthPointerGlow = '1';

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  finePointer.addEventListener('change', handlePointerCapabilityChange);
  reducedMotion.addEventListener('change', handlePointerCapabilityChange);

  scheduleSync();
}

export {};
