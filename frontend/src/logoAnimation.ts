/**
 * Pata Logo Animation Controller (Stage 6 / P6-003)
 * Minimal wiring for titlebar logo launch & success animations.
 *
 * Rules:
 * 1. Launch: Played once when main UI is first ready; no replay on nav / vault switch / list refresh.
 * 2. Success: Played on TodayView quick memo and TasksView comment save success.
 * 3. Concurrent triggers merge (restarts cleanly without stacking).
 * 4. Ended via animationend or safety timeout, returning to static baseline.
 * 5. Paused/cleared on window hide or component unmount.
 * 6. Immediate static fallback on prefers-reduced-motion.
 */

let logoElement: SVGSVGElement | null = null;
let safetyTimer: number | null = null;
let hasPlayedLaunch = false;
let cleanupHandler: (() => void) | null = null;

export function registerTitlebarLogo(el: SVGSVGElement | null): () => void {
  logoElement = el;

  // StrictMode 开发模式双挂载后允许重新播放一次；生产中 App 作为根组件仅挂载一次
  hasPlayedLaunch = false;

  if (cleanupHandler) {
    cleanupHandler();
    cleanupHandler = null;
  }

  if (!el) {
    return () => {};
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      stopLogoAnimation();
    }
  };

  const handleAnimationEnd = (e: AnimationEvent) => {
    // Both choreographies have distinct settling elements:
    // anim-success ends with pata-success-card-front (~750ms)
    // anim-launch ends with pata-launch-sparkle on pata-sparkle-3 (~660ms)
    const isLaunchEnd =
      e.animationName === 'pata-launch-sparkle' &&
      (e.target as Element)?.classList?.contains('pata-sparkle-3');
    const isSuccessEnd = e.animationName === 'pata-success-card-front';

    if (isLaunchEnd || isSuccessEnd) {
      stopLogoAnimation();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  el.addEventListener('animationend', handleAnimationEnd);

  cleanupHandler = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    el.removeEventListener('animationend', handleAnimationEnd);
    stopLogoAnimation();
    if (logoElement === el) {
      logoElement = null;
    }
  };

  return cleanupHandler;
}

export function stopLogoAnimation(): void {
  if (safetyTimer !== null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  if (!logoElement) return;
  logoElement.classList.remove('anim-launch', 'anim-success');
}

export function playLogoLaunch(): void {
  if (hasPlayedLaunch) return;
  hasPlayedLaunch = true;

  try {
    if (!logoElement) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    stopLogoAnimation();
    // Force layout reflow so CSS keyframe animations start cleanly
    void logoElement.getBoundingClientRect();
    logoElement.classList.add('anim-launch');

    safetyTimer = window.setTimeout(() => {
      stopLogoAnimation();
    }, 750);
  } catch (err) {
    console.error('Logo launch animation failed:', err);
  }
}

export function playLogoSuccess(): void {
  try {
    if (!logoElement) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    // Merging consecutive triggers: restart cleanly without queuing
    stopLogoAnimation();
    // Force layout reflow so CSS keyframe animations restart cleanly
    void logoElement.getBoundingClientRect();
    logoElement.classList.add('anim-success');

    safetyTimer = window.setTimeout(() => {
      stopLogoAnimation();
    }, 850);
  } catch (err) {
    console.error('Logo success animation failed:', err);
  }
}
