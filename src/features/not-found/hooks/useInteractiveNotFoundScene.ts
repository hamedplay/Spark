import { useEffect, useRef } from 'react';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

interface SceneState {
  birdX: number;
  face: 1 | -1;
  lensX: number;
  lensY: number;
  targetLensX: number;
  targetLensY: number;
  phase: number;
  live: boolean;
}

export function useInteractiveNotFoundScene() {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const bird = scene.querySelector<HTMLElement>('[data-spark-404-bird]');
    const lens = scene.querySelector<HTMLElement>('[data-spark-404-lens]');
    const floor = scene.querySelector<HTMLElement>('[data-spark-404-floor]');
    if (!bird || !lens || !floor) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const state: SceneState = {
      birdX: 0,
      face: 1,
      lensX: 0,
      lensY: 0,
      targetLensX: 0,
      targetLensY: 0,
      phase: 0,
      live: false,
    };

    let frameId = 0;
    let lastTime = 0;
    let width = 0;
    let height = 0;
    let groundY = 0;
    let birdWidth = 150;
    let birdHeight = 170;
    let lensRadius = 62;

    const writeScene = (step = 0) => {
      const shoulderX = state.birdX + state.face * birdWidth * 0.2;
      const shoulderY = groundY - birdHeight * 0.56;
      const dx = state.lensX - shoulderX;
      const dy = state.lensY - shoulderY;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const armLength = Math.max(0, distance - lensRadius * 0.84);
      const armAngle = Math.atan2(dy, dx) * (180 / Math.PI);

      const eyeX = state.birdX + state.face * birdWidth * 0.14;
      const eyeY = groundY - birdHeight * 0.72;
      const eyeDx = state.lensX - eyeX;
      const eyeDy = state.lensY - eyeY;
      const eyeDistance = Math.max(1, Math.hypot(eyeDx, eyeDy));

      scene.style.setProperty('--spark-404-lens-x', state.lensX.toFixed(1));
      scene.style.setProperty('--spark-404-lens-y', state.lensY.toFixed(1));
      scene.style.setProperty('--spark-404-bird-x', state.birdX.toFixed(1));
      scene.style.setProperty('--spark-404-face', String(state.face));
      scene.style.setProperty('--spark-404-step', step.toFixed(3));
      scene.style.setProperty('--spark-404-arm-x', shoulderX.toFixed(1));
      scene.style.setProperty('--spark-404-arm-y', shoulderY.toFixed(1));
      scene.style.setProperty('--spark-404-arm-length', armLength.toFixed(1));
      scene.style.setProperty('--spark-404-arm-angle', armAngle.toFixed(1));
      scene.style.setProperty('--spark-404-pupil-x', ((eyeDx / eyeDistance) * 4.5).toFixed(2));
      scene.style.setProperty('--spark-404-pupil-y', ((eyeDy / eyeDistance) * 4.5).toFixed(2));
    };

    const measure = () => {
      const rect = scene.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      birdWidth = bird.getBoundingClientRect().width || birdWidth;
      birdHeight = bird.getBoundingClientRect().height || birdHeight;
      lensRadius = (lens.getBoundingClientRect().width || lensRadius * 2) / 2;
      groundY = height - floor.getBoundingClientRect().height + 4;

      if (!state.lensX) {
        state.birdX = width * 0.34;
        state.lensX = width * 0.6;
        state.lensY = height * 0.46;
        state.targetLensX = state.lensX;
        state.targetLensY = state.lensY;
      }

      state.birdX = clamp(state.birdX, birdWidth * 0.45, width - birdWidth * 0.45);
      state.lensX = clamp(state.lensX, lensRadius + 12, width - lensRadius - 12);
      state.lensY = clamp(state.lensY, lensRadius + 12, groundY - 26);
      writeScene();
    };

    const poseReducedMotion = () => {
      measure();
      state.live = false;
      state.face = 1;
      state.birdX = width * 0.34;
      state.lensX = width * 0.58;
      state.lensY = Math.min(height * 0.48, groundY - lensRadius - 20);
      state.targetLensX = state.lensX;
      state.targetLensY = state.lensY;
      writeScene(0);
    };

    const frame = (now: number) => {
      const dt = lastTime ? clamp((now - lastTime) / 1000, 0, 0.05) : 1 / 60;
      lastTime = now;

      if (!state.live) {
        const patrolTime = now / 1000;
        state.targetLensX = width * 0.55 + Math.sin(patrolTime * 0.58) * width * 0.2;
        state.targetLensY = height * 0.42 + Math.sin(patrolTime * 0.9) * 18;
      }

      const follow = 1 - Math.exp(-10 * dt);
      state.lensX = lerp(state.lensX, state.targetLensX, follow);
      state.lensY = lerp(state.lensY, state.targetLensY, follow);

      const standoff = birdWidth * 0.92;
      const desiredBirdX = clamp(
        state.lensX - (state.lensX >= state.birdX ? standoff : -standoff),
        birdWidth * 0.45,
        width - birdWidth * 0.45,
      );
      const gap = desiredBirdX - state.birdX;
      const maxStep = 210 * dt;
      const movement = Math.abs(gap) < 3 ? 0 : clamp(gap * (1 - Math.exp(-4.5 * dt)), -maxStep, maxStep);

      if (movement !== 0) {
        state.face = movement > 0 ? 1 : -1;
        state.birdX += movement;
        state.phase += Math.abs(movement) / Math.max(1, birdWidth) * Math.PI * 4.4;
      } else {
        state.face = state.lensX >= state.birdX ? 1 : -1;
      }

      writeScene(Math.sin(state.phase) * Math.min(1, Math.abs(movement) / Math.max(1, maxStep * 0.45)));
      frameId = window.requestAnimationFrame(frame);
    };

    const moveLensToPointer = (event: PointerEvent) => {
      if (reducedMotion.matches) return;
      const rect = scene.getBoundingClientRect();
      const offset = lensRadius * 0.72;
      state.live = true;
      state.targetLensX = clamp(event.clientX - rect.left - offset, lensRadius + 12, width - lensRadius - 12);
      state.targetLensY = clamp(event.clientY - rect.top - offset, lensRadius + 12, groundY - 26);
    };

    const handlePointerLeave = () => {
      state.live = false;
    };

    const start = () => {
      window.cancelAnimationFrame(frameId);
      lastTime = 0;
      measure();
      if (reducedMotion.matches) {
        poseReducedMotion();
        return;
      }
      frameId = window.requestAnimationFrame(frame);
    };

    scene.addEventListener('pointermove', moveLensToPointer);
    scene.addEventListener('pointerdown', moveLensToPointer);
    scene.addEventListener('pointerleave', handlePointerLeave);
    window.addEventListener('resize', measure);
    reducedMotion.addEventListener('change', start);
    start();

    return () => {
      window.cancelAnimationFrame(frameId);
      scene.removeEventListener('pointermove', moveLensToPointer);
      scene.removeEventListener('pointerdown', moveLensToPointer);
      scene.removeEventListener('pointerleave', handlePointerLeave);
      window.removeEventListener('resize', measure);
      reducedMotion.removeEventListener('change', start);
    };
  }, []);

  return sceneRef;
}
