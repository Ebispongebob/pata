import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** 记录详情打开前的焦点元素，关闭后恢复（滚动位置随列表保持挂载而自然保留）。 */
export function useDetailOrigin() {
  const origin = useRef<HTMLElement | null>(null);
  return {
    capture() {
      if (!origin.current) origin.current = document.activeElement as HTMLElement | null; // 切换任务时保留最初来源
    },
    restore() {
      const el = origin.current;
      origin.current = null;
      requestAnimationFrame(() => el?.isConnected && el.focus());
    },
  };
}

const PANEL_WIDTH = 400;
const MIN_MIDDLE = 460;
const DURATION = 280;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * 三栏中的「中间 + 右」两栏（左导航在 App）：各自独立滚动。
 * 容器够宽时详情并排并以宽度动画展开/收起；不够宽时详情滑入覆盖主区域，列表保持挂载以保留筛选与滚动。
 */
export function DetailSplit({ panel, children }: { panel: ReactNode | null; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  const [present, setPresent] = useState(false); // 右栏在 DOM 中（含收起动画期间）
  const [open, setOpen] = useState(false); // 展开状态，驱动 CSS 过渡
  const last = useRef<ReactNode>(null);
  if (panel) last.current = panel; // 收起动画期间继续渲染最后一次内容

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= PANEL_WIDTH + MIN_MIDDLE));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasPanel = !!panel;
  useEffect(() => {
    if (hasPanel) {
      setPresent(true);
      // 等一帧让初始（收起）样式先落地，过渡才会触发
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
      return () => cancelAnimationFrame(id);
    }
    setOpen(false);
    const t = setTimeout(() => {
      setPresent(false);
      last.current = null;
    }, DURATION);
    return () => clearTimeout(t);
  }, [hasPanel]);

  const transition = `${DURATION}ms ${EASE}`;
  return (
    <div ref={rootRef} className="relative h-full flex min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">{children}</div>
      </div>
      {present &&
        (wide ? (
          <aside
            style={{ width: open ? PANEL_WIDTH : 0, transition: `width ${transition}` }}
            className="shrink-0 overflow-hidden motion-reduce:!transition-none"
          >
            <div
              style={{ width: PANEL_WIDTH, opacity: open ? 1 : 0, transition: `opacity ${DURATION}ms ease` }}
              className="h-full border-l border-stone-200 dark:border-stone-800 overflow-y-auto p-5 motion-reduce:!transition-none"
            >
              {last.current}
            </div>
          </aside>
        ) : (
          <aside
            style={{
              opacity: open ? 1 : 0,
              transform: open ? 'none' : 'translateX(24px)',
              transition: `opacity ${DURATION}ms ease, transform ${transition}`,
            }}
            className="absolute inset-0 z-10 bg-stone-50 dark:bg-stone-900 overflow-y-auto p-5 motion-reduce:!transition-none"
          >
            {last.current}
          </aside>
        ))}
    </div>
  );
}
