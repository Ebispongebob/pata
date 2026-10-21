import { useCallback, useEffect, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import * as WindowService from '../bindings/pata/internal/app/windowservice';
import * as VaultService from '../bindings/pata/internal/app/vaultservice';
import type { DraftWindowState } from '../bindings/pata/internal/app/models';
import { DraftView } from './DraftView';
import { draftShortcut, hasBlockingDraftDialog } from './draftEditing';
import { useAccentColor } from './useAccentColor';
import { useWindowLifecycle, WindowTransition } from './useWindowLifecycle';

export default function DraftWindow() {
  const [state, setState] = useState<DraftWindowState | null>(null);
  const [error, setError] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState<number | null>(null);
  const [theme, setTheme] = useState('system');
  const sequence = useRef(0);
  const scope = useRef<string | null>(null);
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  useAccentColor();
  const refresh = useCallback(async () => {
    try {
      const next = await WindowService.GetDraftWindowState();
      if (scope.current !== next.vault.path) { scope.current = next.vault.path; setFocusId(next.initial_draft_id || null); }
      setState(next); setError('');
    } catch { setError('无法打开草稿工作区，请关闭窗口后重试。'); }
  }, []);
  const lifecycle = useWindowLifecycle('draft', guard, refresh);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => Events.On('draft:open-window', (event) => setFocusId(String(event.data))), []);
  useEffect(() => {
    const load = () => { void VaultService.GetThemePreference().then(setTheme); };
    load();
    return Events.On('appearance:changed', load);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media.matches));
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (lifecycle.blocked || hasBlockingDraftDialog() || event.repeat) return;
      if (draftShortcut(event) === 'new-draft') { event.preventDefault(); setNewRequest(++sequence.current); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [lifecycle.blocked]);
  return <div className="relative h-screen w-screen flex flex-col overflow-hidden bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 font-sans">
    <div className="absolute top-0 inset-x-0 h-1 no-drag-region z-30" />
    <header className="h-[52px] shrink-0 flex items-center justify-between pl-[96px] pr-4 text-xs text-stone-500 border-b border-stone-200/70 dark:border-stone-800 drag-region app-chrome"><span>Draft</span><button type="button" className="px-2 py-1 rounded-md hover:bg-stone-200/60 dark:hover:bg-stone-800 cursor-pointer" onClick={() => void WindowService.ShowMainWindow()}>打开主窗口</button></header>
    <main className="flex-1 min-h-0">
      {error && <div role="alert" className="p-6 text-xs text-rose-600">{error}</div>}
      {state && <DraftView key={state.vault.path || 'closed'} standalone vaultStatus={state.vault} vaultBusy={false} onSelectVault={() => {}}
        newDraftRequest={newRequest} onNewDraftRequestConsumed={() => setNewRequest(null)} initialDraftId={focusId} onInitialDraftConsumed={() => setFocusId(null)}
        leaveGuardRef={guard} shortcutsEnabled={!lifecycle.blocked} />}
    </main>
    <WindowTransition {...lifecycle} />
  </div>;
}
