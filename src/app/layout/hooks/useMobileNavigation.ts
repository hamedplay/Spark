import { useEffect, useState } from 'react';

export function detectMobileNavigation() {
  if (typeof window === 'undefined') return false;
  const shortSide = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  return window.innerWidth < 1024 || ((window.matchMedia?.('(pointer: coarse)').matches ?? false) && shortSide <= 900);
}
export function useMobileNavigation() {
  const [mobile, setMobile] = useState(detectMobileNavigation);
  useEffect(() => {
    const sync = () => setMobile(detectMobileNavigation());
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => { window.removeEventListener('resize', sync); window.removeEventListener('orientationchange', sync); };
  }, []);
  return mobile;
}
