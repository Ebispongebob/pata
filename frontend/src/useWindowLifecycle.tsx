import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { flushSync } from 'react-dom';
import * as WindowService from '../bindings/pata/windowservice';
import { hasBlockingDraftDialog } from './draftEditing';

export function useWindowLifecycle(role: 'main' | 'draft', guard: React.MutableRefObject<(() => Promise<boolean>) | null>, onResume?: () => Promise<void>) {
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const resumeRef = useRef(onResume);
  resumeRef.current = onResume;
  useEffect(() => {
    let mounted = true;
    let preparing = false;
    let composing = false;
    const compositionStart = () => { composing = true; };
    const compositionEnd = () => { composing = false; };
    window.addEventListener('compositionstart', compositionStart, true);
    window.addEventListener('compositionend', compositionEnd, true);
    const stopPrepare = Events.On('window:prepare', (event) => {
      const request = event.data as { role: string; ticket: string; action: string };
      if (request.role !== role) return;
      void (async () => {
        if (preparing) { await WindowService.CompleteRequest(request.ticket, false); return; }
        if (composing) {
          setError('请完成当前输入，再切换或关闭窗口。');
          await WindowService.CompleteRequest(request.ticket, false);
          return;
        }
        preparing = true;
        // 后台或最小化窗口也必须完成保存，不依赖可被系统暂停的动画帧。
        flushSync(() => { setError(''); setBlocked(true); });
        let allowed = false;
        try {
          allowed = !hasBlockingDraftDialog() && (!guard.current || await guard.current());
          if (!allowed && mounted) setError('当前内容尚未保存或仍有未完成操作，窗口已保留。');
          await WindowService.CompleteRequest(request.ticket, allowed);
        } catch {
          allowed = false;
          if (mounted) setError('保存确认失败，窗口已保留，请重试。');
        } finally {
          preparing = false;
          if (!allowed && mounted) setBlocked(false);
        }
      })();
    });
    const stopResume = Events.On('window:resume', () => {
      void (async () => {
        try { await resumeRef.current?.(); }
        finally { if (mounted) { setBlocked(false); setError(''); } }
      })();
    });
    void WindowService.WindowReady().catch(() => { if (mounted) setError('窗口保存保护未就绪，请关闭后重新打开。'); });
    return () => { mounted = false; stopPrepare(); stopResume(); window.removeEventListener('compositionstart', compositionStart, true); window.removeEventListener('compositionend', compositionEnd, true); };
  }, [guard, role]);
  return { blocked, error };
}

export function WindowTransition({ blocked, error }: { blocked: boolean; error: string }) {
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!blocked) return;
    const previous = document.activeElement as HTMLElement | null;
    overlay.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [blocked]);
  return <>
    {error && <div role="alert" className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[70] max-w-lg rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-xs shadow-sm no-drag-region">{error}</div>}
    {blocked && <div ref={overlay} tabIndex={-1} role="status" aria-label="正在保存窗口内容" className="absolute inset-0 z-40 flex items-center justify-center bg-stone-100/30 dark:bg-stone-950/30 no-drag-region"><span className="rounded-lg bg-white dark:bg-stone-900 px-4 py-2 text-xs shadow-sm">正在保存…</span></div>}
  </>;
}
