/**
 * 标题栏 Logo 的启动、保存成功与点击反馈共用一个播放状态。
 * 启动仅播放一次，连续触发重新播放；结束、隐藏或卸载时恢复静态。
 * 尊重系统减少动态效果设置。
 */

let logoElement: SVGSVGElement | null = null;
let safetyTimer: number | null = null;
let hasPlayedLaunch = false;
let cleanupHandler: (() => void) | null = null;

export function registerTitlebarLogo(el: SVGSVGElement | null): () => void {
  if (cleanupHandler) {
    cleanupHandler();
    cleanupHandler = null;
  }

  logoElement = el;

  if (!el) {
    return () => {};
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      stopLogoAnimation();
    }
  };

  const handleAnimationEnd = (e: AnimationEvent) => {
    const isLaunchEnd = e.animationName === 'pata-launch-sparkle' &&
      (e.target as Element)?.classList?.contains('pata-sparkle-3');
    const isSuccessEnd = e.animationName === 'pata-success-card-front';
    const isClickEnd = e.animationName === 'pata-click-sparkle-shoot' &&
      (e.target as Element)?.classList?.contains('pata-sparkle-3');
    if (isLaunchEnd || isSuccessEnd || isClickEnd) {
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
  logoElement.classList.remove('anim-launch', 'anim-success', 'anim-click');
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

/** 点击反馈与启动、保存反馈共用控制器，连续触发只重播当前一次。 */
export function playLogoClick(): void {
  if (!logoElement) return;
  stopLogoAnimation();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.visibilityState === 'hidden') return;

  void logoElement.getBoundingClientRect();
  logoElement.classList.add('anim-click');
  safetyTimer = window.setTimeout(stopLogoAnimation, 920);
}
