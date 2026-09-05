import { useEffect } from 'react';

let subscribers = 0;
let teardownGlobalTooltip: (() => void) | null = null;

function installConferenceTooltipLayer() {
  const tooltip = document.createElement('div');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('dir', 'rtl');
  tooltip.className = 'pointer-events-none fixed z-[250] hidden max-w-[280px] rounded-xl border border-white/10 bg-slate-900/95 px-3 py-2 text-center text-[11px] font-semibold leading-5 text-white shadow-2xl backdrop-blur';
  document.body.appendChild(tooltip);

  let showTimer: number | null = null;
  let activeControl: HTMLElement | null = null;

  const clearTimer = () => {
    if (showTimer !== null) window.clearTimeout(showTimer);
    showTimer = null;
  };

  const hide = () => {
    clearTimer();
    activeControl = null;
    tooltip.classList.add('hidden');
    tooltip.textContent = '';
  };

  const resolveControl = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const control = target.closest<HTMLElement>('button, [role="button"]');
    if (!control) return null;

    const hasIcon = Boolean(control.querySelector('svg'));
    const explicitTooltip = control.getAttribute('data-tooltip')?.trim();
    if (!hasIcon && !explicitTooltip) return null;

    const label = explicitTooltip
      || control.getAttribute('aria-label')?.trim()
      || control.getAttribute('title')?.trim();
    return label ? control : null;
  };

  const show = (control: HTMLElement) => {
    const label = control.getAttribute('data-tooltip')?.trim()
      || control.getAttribute('aria-label')?.trim()
      || control.getAttribute('title')?.trim();
    if (!label || !document.body.contains(control)) return;

    const rect = control.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    tooltip.textContent = label;
    tooltip.classList.remove('hidden');
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    tooltip.style.transform = 'none';

    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportPadding = 10;
    const gap = 10;
    const centeredLeft = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    const left = Math.min(
      window.innerWidth - tooltipRect.width - viewportPadding,
      Math.max(viewportPadding, centeredLeft),
    );
    const canPlaceAbove = rect.top >= tooltipRect.height + gap + viewportPadding;
    const top = canPlaceAbove
      ? rect.top - tooltipRect.height - gap
      : Math.min(window.innerHeight - tooltipRect.height - viewportPadding, rect.bottom + gap);

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(Math.max(viewportPadding, top))}px`;
    activeControl = control;
  };

  const schedule = (control: HTMLElement, immediate = false) => {
    clearTimer();
    activeControl = control;
    if (immediate) {
      show(control);
      return;
    }
    showTimer = window.setTimeout(() => show(control), 320);
  };

  const onPointerOver = (event: PointerEvent) => {
    const control = resolveControl(event.target);
    if (!control || control === activeControl) return;
    schedule(control);
  };

  const onPointerOut = (event: PointerEvent) => {
    const control = resolveControl(event.target);
    if (!control || control !== activeControl) return;
    if (event.relatedTarget instanceof Node && control.contains(event.relatedTarget)) return;
    hide();
  };

  const onFocusIn = (event: FocusEvent) => {
    const control = resolveControl(event.target);
    if (control) schedule(control, true);
  };

  const onFocusOut = () => hide();

  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerout', onPointerOut, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  return () => {
    clearTimer();
    document.removeEventListener('pointerover', onPointerOver, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('resize', hide);
    tooltip.remove();
  };
}

export function useConferenceTooltips() {
  useEffect(() => {
    subscribers += 1;
    if (subscribers === 1) teardownGlobalTooltip = installConferenceTooltipLayer();

    return () => {
      subscribers = Math.max(0, subscribers - 1);
      if (subscribers === 0) {
        teardownGlobalTooltip?.();
        teardownGlobalTooltip = null;
      }
    };
  }, []);
}
