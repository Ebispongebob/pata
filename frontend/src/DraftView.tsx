import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { ExternalLink, FilePenLine, FolderOpen, PanelLeft, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import * as VaultService from '../bindings/pata/internal/app/vaultservice';
import * as WindowService from '../bindings/pata/internal/app/windowservice';
import type { Draft, VaultStatus } from '../bindings/pata/internal/app/models';
import { DraftEditor, type DraftEditorRef } from './DraftEditor';
import { DraftFindBar } from './DraftFindBar';
import { draftShortcut, findTextMatches, hasBlockingDraftDialog } from './draftEditing';

type LeaveGuard = React.MutableRefObject<(() => Promise<boolean>) | null>;

interface Props {
  vaultStatus: VaultStatus | null;
  onSelectVault: () => void;
  vaultBusy: boolean;
  newDraftRequest: number | null;
  onNewDraftRequestConsumed: () => void;
  initialDraftId: string | null;
  onInitialDraftConsumed: () => void;
  shortcutsEnabled: boolean;
  leaveGuardRef: LeaveGuard;
  standalone?: boolean;
}

type DraftChange = { vault_path: string; id: string; kind: 'saved' | 'deleted' };
type Guard = () => Promise<boolean>;
const draftTitle = (body: string) => {
  const text = Array.from(body.split('\n').find((line) => line.trim())?.trim() || '未命名草稿');
  return text.length > 60 ? text.slice(0, 60).join('') + '…' : text.join('');
};

export function DraftView(props: Props) {
  const { vaultStatus, onSelectVault, vaultBusy, shortcutsEnabled, leaveGuardRef, standalone = false } = props;
  const scope = vaultStatus?.path ?? '';
  const storageKey = `pata_draft_workspace:${standalone ? 'window' : 'main'}:${scope}`;
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [documents, setDocuments] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filesVisible, setFilesVisible] = useState(true);
  const guards = useRef(new Map<string, Guard>());
  const operating = useRef(false);
  const refreshSequence = useRef(0);
  const initialTask = useRef<Promise<{ list: Draft[]; documents: Draft[]; active: string; request: number | null; focus: string | null }> | null>(null);
  const initialList = useRef<Draft[]>([]);
  const consumedNew = useRef<number | null>(null);
  const consumedFocus = useRef<string | null>(null);
  const current = useRef({ props, documents, activeId });
  current.current = { props, documents, activeId };
  const registerGuard = useCallback((id: string, guard: Guard | null) => {
    if (guard) guards.current.set(id, guard); else guards.current.delete(id);
  }, []);
  const flush = useCallback(async () => {
    for (const guard of guards.current.values()) if (!(await guard())) return false;
    return true;
  }, []);
  useEffect(() => {
    leaveGuardRef.current = flush;
    return () => { if (leaveGuardRef.current === flush) leaveGuardRef.current = null; };
  }, [flush, leaveGuardRef]);

  const refresh = useCallback(async () => {
    if (!vaultStatus?.open) return;
    const sequence = ++refreshSequence.current;
    try {
      const list = ((await VaultService.ListDrafts(scope)) ?? []).filter((item): item is Draft => item !== null);
      initialList.current = list;
      if (sequence === refreshSequence.current) setDrafts(list);
    } catch (error) { if (sequence === refreshSequence.current) setError(String(error)); }
  }, [scope, vaultStatus?.open]);
  useEffect(() => {
    const stop = Events.On('draft:changed', (event) => {
      if ((event.data as DraftChange).vault_path === scope) void refresh();
    });
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { ++refreshSequence.current; stop(); window.removeEventListener('focus', focus); };
  }, [scope, refresh]);

  useEffect(() => {
    if (!vaultStatus?.open) return;
    let mounted = true;
    // 严格模式的重复挂载共用初始化请求，空 Vault 只创建一篇草稿。
    initialTask.current ??= (async () => {
      const list = ((await VaultService.ListDrafts(scope)) ?? []).filter((item): item is Draft => item !== null);
      initialList.current = list;
      const request = current.current.props.newDraftRequest;
      const focus = current.current.props.initialDraftId;
      let saved: { ids?: string[]; active?: string } = {};
      try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { /* 使用磁盘列表作为回退。 */ }
      const known = new Set(list.map((item) => item.id));
      const ids = Array.isArray(saved?.ids) ? [...new Set(saved.ids.filter((id) => typeof id === 'string' && known.has(id)))] : [];
      let active = focus || (saved?.active && known.has(saved.active) ? saved.active : list[0]?.id);
      let created: Draft | null = null;
      if (request || (!active && !list.length)) {
        created = await VaultService.CreateDraft(scope);
        if (!created) throw new Error('未收到草稿创建结果');
        active = created.id; list.unshift(created);
      }
      if (!active) throw new Error('无法打开草稿');
      if (!ids.includes(active)) ids.push(active);
      const opened = await Promise.all(ids.map(async (id) => {
        if (created?.id === id) return created;
        const draft = await VaultService.GetDraft(scope, id);
        if (!draft) throw new Error('无法读取草稿');
        return draft;
      }));
      return { list, documents: opened, active, request, focus };
    })();
    void initialTask.current.then((result) => {
      if (!mounted) return;
      consumedNew.current = result.request; consumedFocus.current = result.focus;
      setDrafts(result.list); setDocuments(result.documents); setActiveId(result.active); setReady(true);
      if (result.request && current.current.props.newDraftRequest === result.request) current.current.props.onNewDraftRequestConsumed();
      if (result.focus && current.current.props.initialDraftId === result.focus) current.current.props.onInitialDraftConsumed();
    }).catch((error) => { if (mounted) { setDrafts(initialList.current); setError(String(error)); setReady(true); } });
    return () => { mounted = false; };
  }, [scope, storageKey, vaultStatus?.open]);

  const tabIds = documents.map((item) => item.id).join(',');
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ ids: tabIds ? tabIds.split(',') : [], active: activeId })); }
    catch { /* 偏好不可用不影响 Markdown 保存。 */ }
  }, [ready, tabIds, activeId, storageKey]);

  const run = async (action: () => Promise<void>) => {
    if (operating.current || !ready || hasBlockingDraftDialog()) return;
    operating.current = true; setBusy(true);
    try { if (await flush()) { await action(); setError(''); } }
    catch (error) { setError(String(error)); }
    finally { operating.current = false; setBusy(false); }
  };
  const selectRef = useRef<(id: string) => Promise<void>>(async () => {});
  selectRef.current = async (id) => run(async () => {
    if (!current.current.documents.some((item) => item.id === id)) {
      const draft = await VaultService.GetDraft(scope, id);
      if (!draft) throw new Error('无法读取草稿');
      setDocuments((items) => [...items, draft]);
    }
    setActiveId(id);
  });
  const createRef = useRef<() => Promise<void>>(async () => {});
  createRef.current = () => run(async () => {
    const draft = await VaultService.CreateDraft(scope);
    if (!draft) throw new Error('未收到草稿创建结果');
    setDocuments((items) => [...items, draft]); setActiveId(draft.id);
    await refresh();
  });
  useEffect(() => {
    const request = props.newDraftRequest;
    if (!ready || busy || !request || consumedNew.current === request) return;
    consumedNew.current = request; props.onNewDraftRequestConsumed();
    void createRef.current();
  }, [props.newDraftRequest, props.onNewDraftRequestConsumed, ready, busy]);
  useEffect(() => {
    const id = props.initialDraftId;
    if (!id) { consumedFocus.current = null; return; }
    if (!ready || busy || consumedFocus.current === id) return;
    consumedFocus.current = id; props.onInitialDraftConsumed();
    void selectRef.current(id);
  }, [props.initialDraftId, props.onInitialDraftConsumed, ready, busy]);

  const metadata = useCallback((draft: Draft) => {
    setDocuments((items) => items.map((item) => item.id === draft.id ? draft : item));
  }, []);
  const deleted = useCallback((id: string) => {
    const remaining = current.current.documents.filter((item) => item.id !== id);
    setDocuments((items) => items.filter((item) => item.id !== id));
    setDrafts((items) => items.filter((item) => item.id !== id));
    setActiveId((active) => active === id ? remaining[0]?.id ?? null : active);
  }, []);
  const closeTab = (id: string) => void run(async () => {
    const remaining = current.current.documents.filter((item) => item.id !== id);
    setDocuments(remaining);
    if (activeId === id) setActiveId(remaining[0]?.id ?? null);
  });
  const active = documents.find((item) => item.id === activeId);
  const buttonClass = 'p-1.5 rounded-md text-stone-500 hover:bg-stone-200/70 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer';

  if (!vaultStatus?.open) return <div className="p-10 text-center space-y-4">
    <FolderOpen className="w-9 h-9 mx-auto text-emerald-600" />
    <p className="text-sm text-stone-600 dark:text-stone-300">请先打开 Vault，再创建草稿。</p>
    {!standalone && <button type="button" disabled={vaultBusy} onClick={onSelectVault} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-xs">选择 Vault 目录</button>}
  </div>;

  return <div className="h-full min-h-0 flex flex-col pt-4 drag-region">
    <div className="flex flex-1 min-h-0">
      {filesVisible && <aside aria-label="草稿文件栏" className="w-44 xl:w-52 shrink-0 flex flex-col min-h-0 border-r border-stone-200/70 dark:border-stone-800 bg-stone-100/40 dark:bg-stone-950/25 no-drag-region">
        <div className="h-10 px-3 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-medium text-stone-500">草稿 <span className="ml-1 opacity-60">{drafts.length}</span></span>
          <div className="flex"><button type="button" aria-label="刷新草稿" title="刷新草稿" className={buttonClass} onClick={() => void refresh()}><RefreshCw className="w-3.5 h-3.5" /></button><button type="button" disabled={busy || !ready} aria-label="新建草稿" title="新建草稿 (⌘N)" className={buttonClass} onClick={() => void createRef.current()}><Plus className="w-3.5 h-3.5" /></button></div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-3">
          {drafts.map((draft) => {
            const title = documents.find((item) => item.id === draft.id)?.title || draft.title;
            return <button type="button" key={draft.id} disabled={busy || !ready} onClick={() => void selectRef.current(draft.id)} title={title} aria-current={activeId === draft.id ? 'page' : undefined}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs text-left cursor-pointer disabled:opacity-50 ${activeId === draft.id ? 'bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200' : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'}`}><FilePenLine className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{title}</span></button>;
          })}
        </div>
      </aside>}
      <section aria-label="草稿工作区" className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="h-10 shrink-0 flex items-stretch border-b border-stone-200/70 dark:border-stone-800 no-drag-region">
          <button type="button" aria-label={filesVisible ? '收起草稿文件栏' : '展开草稿文件栏'} title={filesVisible ? '收起草稿文件栏' : '展开草稿文件栏'} className={`${buttonClass} m-1`} onClick={() => setFilesVisible((visible) => !visible)}><PanelLeft className="w-4 h-4" /></button>
          <div role="tablist" aria-label="已打开的草稿" className="flex flex-1 min-w-0 overflow-x-auto">
            {documents.map((draft) => <div key={draft.id} className={`shrink-0 max-w-52 flex items-center border-r border-stone-200/70 dark:border-stone-800 ${activeId === draft.id ? 'bg-white/70 dark:bg-stone-800/60 border-t-2 border-t-emerald-600' : 'border-t-2 border-t-transparent'}`}>
              <button type="button" role="tab" aria-selected={activeId === draft.id} aria-controls={`draft-panel-${draft.id}`} id={`draft-tab-${draft.id}`} disabled={busy} className="min-w-0 truncate px-3 h-full text-xs cursor-pointer" onClick={() => void selectRef.current(draft.id)}>{draft.title}</button>
              <button type="button" disabled={busy} aria-label={`关闭草稿标签：${draft.title}`} title="关闭标签，不删除草稿" className={`${buttonClass} mr-1 shrink-0`} onClick={() => closeTab(draft.id)}><X className="w-3 h-3" /></button>
            </div>)}
          </div>
          <button type="button" disabled={busy || !ready} aria-label="新建草稿标签" title="新建草稿 (⌘N)" className={`${buttonClass} m-1 shrink-0`} onClick={() => void createRef.current()}><Plus className="w-4 h-4" /></button>
          {!standalone && <button type="button" disabled={busy || !active} aria-label="在独立窗口打开当前草稿" title="在独立窗口打开当前草稿" className={`${buttonClass} m-1 shrink-0 flex items-center gap-1.5 text-xs`} onClick={() => void run(async () => { if (activeId) await WindowService.OpenDraftWindow(scope, activeId); })}><ExternalLink className="w-3.5 h-3.5" /><span className="hidden lg:inline">独立窗口</span></button>}
        </div>
        {error && <div role="alert" className="px-4 py-2 text-xs text-rose-600 no-drag-region">{error}</div>}
        {!ready && <div className="p-6 text-xs text-stone-400 no-drag-region">正在打开草稿…</div>}
        {ready && !active && <div className="flex-1 flex flex-col items-center justify-center gap-3 text-stone-400 no-drag-region"><span className="text-sm">选择左侧草稿，或直接新建</span><button type="button" disabled={busy} className="text-xs text-emerald-700 dark:text-emerald-400 cursor-pointer" onClick={() => void createRef.current()}>新建草稿 ⌘N</button></div>}
        {documents.map((draft) => <div key={draft.id} role="tabpanel" id={`draft-panel-${draft.id}`} aria-labelledby={`draft-tab-${draft.id}`} className={activeId === draft.id ? 'flex-1 min-h-0' : 'hidden'}>
          <DraftDocument draft={draft} scope={scope} active={activeId === draft.id} shortcutsEnabled={shortcutsEnabled && !busy && activeId === draft.id} registerGuard={registerGuard} onMetadata={metadata} onDeleted={deleted} />
        </div>)}
      </section>
    </div>
  </div>;
}

function DraftDocument({ draft, scope, active, shortcutsEnabled, registerGuard, onMetadata, onDeleted }: {
  draft: Draft; scope: string; active: boolean; shortcutsEnabled: boolean;
  registerGuard: (id: string, guard: Guard | null) => void;
  onMetadata: (draft: Draft) => void; onDeleted: (id: string) => void;
}) {
  const editorRef = useRef<DraftEditorRef>(null);
  const bodyRef = useRef(draft.body);
  const savedRef = useRef(draft);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const conflictRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const deletedRef = useRef(false);
  const deletingRef = useRef(false);
  const [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | 'failed' | 'conflict'>('saved');
  const [error, setError] = useState('');
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [findMode, setFindMode] = useState<'find' | 'replace' | null>(null);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [findBody, setFindBody] = useState(draft.body);
  const currentTitle = Array.from(findBody.split('\n').find((line) => line.trim())?.trim() || '未命名草稿').slice(0, 60).join('');
  const [index, setIndex] = useState(0);
  const matches = useMemo(() => findTextMatches(findBody, query), [findBody, query]);
  const currentIndex = Math.min(index, Math.max(0, matches.length - 1));

  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  flushRef.current = async () => {
    if (deletedRef.current) return true;
    if (editorRef.current?.composing()) { setError('请先完成当前输入，再切换或关闭窗口。'); return false; }
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    while (true) {
      if (savingRef.current) { if (!(await savingRef.current)) return false; continue; }
      if (conflictRef.current) return false;
      if (bodyRef.current === savedRef.current.body) {
        if (mountedRef.current) { setStatus('saved'); setError(''); }
        return true;
      }
      const body = bodyRef.current;
      if (mountedRef.current) setStatus('saving');
      const pending = VaultService.SaveDraft({ vault_path: scope, id: draft.id, version: savedRef.current.version, body })
        .then((saved) => {
          if (!saved) throw new Error('未收到草稿保存结果');
          savedRef.current = saved;
          onMetadata({ ...saved, body: bodyRef.current, title: draftTitle(bodyRef.current) });
          if (mountedRef.current) { setStatus(bodyRef.current === body ? 'saved' : 'unsaved'); setError(''); }
          return true;
        }).catch((error) => {
          const message = String(error);
          conflictRef.current = message.includes('冲突');
          if (mountedRef.current) { setError(message); setStatus(conflictRef.current ? 'conflict' : 'failed'); }
          return false;
        }).finally(() => { savingRef.current = null; });
      savingRef.current = pending;
      if (!(await pending)) return false;
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    const guard = () => deletedRef.current ? Promise.resolve(true) : deletingRef.current ? Promise.resolve(false) : flushRef.current();
    registerGuard(draft.id, guard);
    const beforeUnload = () => { void flushRef.current(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      registerGuard(draft.id, null);
      window.removeEventListener('beforeunload', beforeUnload);
      void flushRef.current();
    };
  }, [draft.id, registerGuard]);

  const refreshRef = useRef<() => Promise<void>>(async () => {});
  refreshRef.current = async () => {
    if (savingRef.current) await savingRef.current;
    if (deletedRef.current || deletingRef.current || conflictRef.current || bodyRef.current !== savedRef.current.body) return;
    const baseline = savedRef.current;
    try {
      const loaded = await VaultService.GetDraft(scope, draft.id);
      if (!loaded || !mountedRef.current || savingRef.current || savedRef.current.version !== baseline.version || bodyRef.current !== baseline.body) return;
      if (loaded.version !== baseline.version) {
        // 外部版本成为新的编辑基线，同时清除针对旧正文的撤销历史。
        savedRef.current = loaded; bodyRef.current = loaded.body;
        editorRef.current?.setValue(loaded.body, true);
        editorRef.current?.highlight(findMode ? query : '', 0);
        setFindBody(loaded.body); setIndex(0); setStatus('saved'); setError('');
        onMetadata(loaded);
      }
    } catch (error) { if (mountedRef.current) setError(String(error)); }
  };
  useEffect(() => {
    const stop = Events.On('draft:changed', (event) => {
      const change = event.data as DraftChange;
      if (change.vault_path !== scope || change.id !== draft.id || deletingRef.current) return;
      if (change.kind === 'deleted' && !savingRef.current && !conflictRef.current && bodyRef.current === savedRef.current.body) {
        deletedRef.current = true; onDeleted(draft.id);
      } else void refreshRef.current();
    });
    const focus = () => void refreshRef.current();
    window.addEventListener('focus', focus);
    return () => { stop(); window.removeEventListener('focus', focus); };
  }, [draft.id, scope, onDeleted]);
  useEffect(() => {
    if (active) { editorRef.current?.focus(); void refreshRef.current(); }
  }, [active]);

  const changeBody = (body: string) => {
    bodyRef.current = body;
    onMetadata({ ...savedRef.current, body, title: draftTitle(body) });
    setFindBody(body);
    setStatus(conflictRef.current ? 'conflict' : 'unsaved');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (!conflictRef.current) timerRef.current = window.setTimeout(() => { void flushRef.current(); }, 500);
  };
  const closeFind = () => { setFindMode(null); editorRef.current?.highlight(''); editorRef.current?.focus(); };
  const openFind = (mode: 'find' | 'replace') => {
    const selected = editorRef.current?.selectedText() ?? '';
    const text = selected && !selected.includes('\n') ? selected : query;
    setQuery(text); setIndex(0); setFindMode(mode);
    const first = findTextMatches(bodyRef.current, text)[0];
    if (first) editorRef.current?.select(first.from, first.to);
    requestAnimationFrame(() => { const input = document.querySelector<HTMLInputElement>('[aria-label="查找内容"]'); input?.focus(); input?.select(); });
  };
  useEffect(() => { editorRef.current?.highlight(findMode ? query : '', currentIndex); }, [findMode, query, currentIndex]);
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (event) => {
    if (!shortcutsEnabled || hasBlockingDraftDialog() || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && findMode) { event.preventDefault(); event.stopPropagation(); closeFind(); return; }
    const action = draftShortcut(event);
    if (!action || action === 'new-draft') return;
    if (action === 'line-ends' && !(event.target as HTMLElement)?.closest('.draft-editor')) return;
    event.preventDefault(); event.stopPropagation();
    if (action === 'line-ends') { editorRef.current?.lineEnds(); editorRef.current?.focus(); }
    else openFind(action);
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => shortcutRef.current(event);
    window.addEventListener('keydown', handle, true);
    return () => window.removeEventListener('keydown', handle, true);
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(bodyRef.current); }
    catch { setError('复制失败，请在编辑区全选并复制。'); }
  };
  const reload = async () => {
    try {
      if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      if (savingRef.current) await savingRef.current;
      const loaded = await VaultService.GetDraft(scope, draft.id);
      if (!loaded) return;
      savedRef.current = loaded; bodyRef.current = loaded.body; conflictRef.current = false;
      onMetadata(loaded);
      editorRef.current?.setValue(loaded.body, true);
      editorRef.current?.highlight(findMode ? query : '', 0);
      setFindBody(loaded.body); setIndex(0); setStatus('saved'); setError(''); setReloadConfirm(false);
      editorRef.current?.focus();
    } catch (error) { setError(String(error)); setReloadConfirm(false); }
  };
  const deleteDraft = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true); setDeleteError('');
    try {
      if (!(await flushRef.current())) {
        setDeleteError('草稿尚未保存，请取消删除并先处理保存错误。');
        return;
      }
      await VaultService.DeleteDraft(scope, draft.id, savedRef.current.version);
      deletedRef.current = true;
      onDeleted(draft.id);
    } catch (error) { setDeleteError(String(error)); }
    finally { deletingRef.current = false; setDeleting(false); }
  };
  const actionClass = 'px-2 py-1 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800 text-xs cursor-pointer disabled:opacity-40';
  return <div className="h-full drag-region"><div className="draft-document h-full flex flex-col px-4 py-2 gap-2">
    <div role="toolbar" aria-label="草稿编辑工具" className="flex items-center gap-1 text-stone-500 shrink-0">
      <button type="button" className={actionClass} onClick={() => openFind('find')}>查找 ⌘F</button>
      <button type="button" className={actionClass} onClick={() => openFind('replace')}>替换 ⌘⇧R</button>
      <span aria-live="polite" className="ml-auto text-[11px]">{status === 'saving' ? '保存中…' : status === 'unsaved' ? '待保存' : status === 'failed' ? '保存失败' : status === 'conflict' ? '保存冲突' : ''}</span>
      <button type="button" className={`${actionClass} flex items-center gap-1 hover:text-rose-600`} onClick={() => { setDeleteError(''); setDeleteConfirm(true); }}><Trash2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">删除草稿</span></button>
    </div>
    {error && <div role="alert" className="shrink-0 rounded-lg border border-amber-300 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-2">
      <p>{error}</p><div className="flex gap-2">
        <button type="button" className={actionClass} onClick={() => void copy()}>复制草稿</button>
        {!conflictRef.current && <button type="button" className={actionClass} onClick={() => void flushRef.current()}>重试保存</button>}
        <button type="button" className={actionClass} onClick={() => setReloadConfirm(true)}>重新加载</button>
      </div>
    </div>}
    {findMode && <DraftFindBar mode={findMode} query={query} replacement={replacement} index={currentIndex} count={matches.length}
      onQuery={(text) => { setQuery(text); setIndex(0); const first = findTextMatches(bodyRef.current, text)[0]; if (first) editorRef.current?.select(first.from, first.to); }}
      onReplacement={setReplacement} onNavigate={(direction) => { if (!matches.length) return; const next = (currentIndex + direction + matches.length) % matches.length; setIndex(next); editorRef.current?.select(matches[next].from, matches[next].to); }}
      onReplace={(all) => { if (!matches.length) return; const after = matches[currentIndex].from + replacement.length; editorRef.current?.replace(all ? matches : [matches[currentIndex]], replacement); const remaining = findTextMatches(bodyRef.current, query); const next = all ? 0 : Math.max(0, remaining.findIndex((match) => match.from >= after)); setIndex(next); if (remaining[next]) editorRef.current?.select(remaining[next].from, remaining[next].to); }} onClose={closeFind} />}
    <div className="flex-1 min-h-0 overflow-hidden"><DraftEditor ref={editorRef} initialValue={draft.body} onChange={changeBody} /></div>
    {deleteConfirm && <DeleteDraftDialog title={currentTitle} busy={deleting} error={deleteError} onCancel={() => setDeleteConfirm(false)} onConfirm={() => void deleteDraft()} />}
    {reloadConfirm && <div role="dialog" aria-modal="true" aria-label="重新加载草稿" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="max-w-sm rounded-xl p-5 bg-white dark:bg-stone-900 space-y-4 text-sm"><h3 className="font-semibold">重新加载草稿？</h3><p>当前未保存的改动会被文件中的内容替换。建议先复制草稿。</p><div className="flex justify-end gap-2"><button type="button" className={actionClass} onClick={() => setReloadConfirm(false)}>取消</button><button type="button" className={actionClass} onClick={() => void reload()}>确认重新加载</button></div></div>
    </div>}
  </div></div>;
}

function DeleteDraftDialog({ title, busy, error, onCancel, onConfirm }: {
  title: string; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void;
}) {
  return <div role="dialog" aria-modal="true" aria-label="删除草稿" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
    <div className="w-full max-w-sm rounded-xl p-5 bg-white dark:bg-stone-900 space-y-4 text-sm">
      <h3 className="font-semibold">删除草稿？</h3>
      <p className="break-words">将删除「{title}」及其草稿文件。此操作无法撤销。</p>
      {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className="px-3 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50">取消</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="px-3 py-1.5 rounded-md bg-rose-600 text-white cursor-pointer disabled:opacity-50">{busy ? '删除中…' : '确认删除'}</button>
      </div>
    </div>
  </div>;
}
