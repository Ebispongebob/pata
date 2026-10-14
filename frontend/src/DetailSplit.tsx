import { useRef } from 'react';
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

/**
 * 三栏中的「中间 + 右」两栏（左导航在 App）：各自独立滚动。
 * 详情并排显示在最右侧，宽度固定，绝不覆盖中间列表，点击聚焦不改变大小。
 */
export function DetailSplit({ panel, children }: { panel: ReactNode | null; children: ReactNode }) {
  return (
    <div className="relative h-full flex min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">{children}</div>
      </div>
      {panel && (
        <aside
          style={{ width: PANEL_WIDTH }}
          className="shrink-0 h-full border-l border-stone-200 dark:border-stone-800 overflow-hidden flex flex-col"
        >
          {panel}
        </aside>
      )}
    </div>
  );
}
