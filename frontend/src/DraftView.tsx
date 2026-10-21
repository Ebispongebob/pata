import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FilePenLine, FolderOpen, Plus, Trash2 } from 'lucide-react';
import * as VaultService from '../bindings/pata/vaultservice';
import type { Draft, VaultStatus } from '../bindings/pata/models';
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
}

export function DraftView({ vaultStatus, onSelectVault, vaultBusy, newDraftRequest, onNewDraftRequestConsumed, initialDraftId, onInitialDraftConsumed, shortcutsEnabled, leaveGuardRef }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Draft | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const creatingRef = useRef(false);
  const selectionSequence = useRef(0);
  const scope = vaultStatus?.path ?? '';
  useEffect(() => () => { ++selectionSequence.current; }, []);

  const load = useCallback(async () => {
    if (!vaultStatus?.open) return;
    const sequence = selectionSequence.current;
    try {
      setDrafts(((await VaultService.ListDrafts(scope)) ?? []).filter((item): item is Draft => item !== null));
      if (sequence === selectionSequence.current) setError('');
    } catch (error) { if (sequence === selectionSequence.current) setError(String(error)); }
  }, [scope, vaultStatus?.open]);
  useEffect(() => { void load(); }, [load]);

  const createRef = useRef<(guard?: boolean) => Promise<void>>(async () => {});
  createRef.current = async (guard = true) => {
    if (creatingRef.current || !vaultStatus?.open) return;
    creatingRef.current = true;
    const sequence = ++selectionSequence.current;
    setBusy(true);
    try {
      if (guard && leaveGuardRef.current && !(await leaveGuardRef.current())) return;
      const draft = await VaultService.CreateDraft(scope);
      if (draft && sequence === selectionSequence.current) { setSelected(draft); setError(''); }
    } catch (error) { setError(String(error)); }
    finally { creatingRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!newDraftRequest || !vaultStatus?.open) return;
    onNewDraftRequestConsumed();
    void createRef.current(false);
  }, [newDraftRequest, vaultStatus?.open, onNewDraftRequestConsumed]);

  const openRef = useRef<(id: string, guard?: boolean) => Promise<void>>(async () => {});
  openRef.current = async (id, guard = true) => {
    if (creatingRef.current) return;
    const sequence = ++selectionSequence.current;
    try {
      if (guard && leaveGuardRef.current && !(await leaveGuardRef.current())) return;
      const draft = await VaultService.GetDraft(scope, id);
      if (draft && sequence === selectionSequence.current) { setSelected(draft); setError(''); }
    } catch (error) { if (sequence === selectionSequence.current) setError(String(error)); }
  };
  useEffect(() => {
    if (!initialDraftId || !vaultStatus?.open) return;
    onInitialDraftConsumed();
    void openRef.current(initialDraftId, false);
  }, [initialDraftId, vaultStatus?.open, onInitialDraftConsumed]);

  const deleteDraft = async () => {
    if (!deleteTarget || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true); setDeleteError('');
    try {
      await VaultService.DeleteDraft(scope, deleteTarget.id, deleteTarget.version);
      setDeleteTarget(null);
      await load();
    } catch (error) { setDeleteError(String(error)); }
    finally { deletingRef.current = false; setDeleting(false); }
  };

  if (!vaultStatus?.open) return <div className="p-10 text-center space-y-4">
    <FolderOpen className="w-9 h-9 mx-auto text-emerald-600" />
    <p className="text-sm text-stone-600 dark:text-stone-300">请先打开 Vault，再创建草稿。</p>
    <button type="button" disabled={vaultBusy} onClick={onSelectVault} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-xs">选择 Vault 目录</button>
  </div>;

  if (selected) return <DraftDocument key={`${selected.id}:${selected.version}`} draft={selected} scope={scope} shortcutsEnabled={shortcutsEnabled} leaveGuardRef={leaveGuardRef}
    onBack={() => { ++selectionSequence.current; setSelected(null); void load(); }} onNew={() => void createRef.current()} creating={busy} createError={error} />;

  return <div className="h-full overflow-y-auto p-6 drag-region"><div className="max-w-3xl mx-auto space-y-5 no-drag-region">
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold">Draft <span className="ml-2 text-xs text-stone-400">{drafts.length}</span></h2>
      <button type="button" onClick={() => void createRef.current()} disabled={busy} title="新建草稿 (⌘N)" className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 text-white rounded-md text-xs cursor-pointer disabled:opacity-50"><Plus className="w-3.5 h-3.5" />新建草稿 <span className="opacity-70">⌘N</span></button>
    </div>
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    {!drafts.length && !error && <div className="py-20 text-center text-sm text-stone-400">暂无草稿，按 ⌘N 新建。</div>}
    {drafts.map((draft) => <div key={draft.id} className="flex items-center rounded-xl border border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-900/60 hover:border-emerald-500">
      <button type="button" onClick={() => void openRef.current(draft.id)} className="flex-1 min-w-0 text-left p-4 rounded-xl cursor-pointer">
      <div className="flex items-center gap-2"><FilePenLine className="w-4 h-4 shrink-0 text-stone-400" /><h3 className="truncate text-sm font-medium">{draft.title}</h3></div>
      <div className="mt-2 text-[11px] text-stone-400">{new Date(draft.updated_at).toLocaleString()}</div>
      </button>
      <button type="button" aria-label={`删除草稿：${draft.title}`} title="删除草稿" className="p-2 mr-3 rounded-md text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950 cursor-pointer" onClick={() => { setDeleteError(''); setDeleteTarget(draft); }}><Trash2 className="w-4 h-4" /></button>
    </div>)}
    {deleteTarget && <DeleteDraftDialog title={deleteTarget.title} busy={deleting} error={deleteError} onCancel={() => { setDeleteTarget(null); void load(); }} onConfirm={() => void deleteDraft()} />}
  </div></div>;
}

function DraftDocument({ draft, scope, shortcutsEnabled, leaveGuardRef, onBack, onNew, creating, createError }: {
  draft: Draft; scope: string; shortcutsEnabled: boolean; leaveGuardRef: LeaveGuard;
  onBack: () => void; onNew: () => void; creating: boolean; createError: string;
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
    const guard = () => deletingRef.current ? Promise.resolve(false) : flushRef.current();
    leaveGuardRef.current = guard;
    const beforeUnload = () => { void flushRef.current(); };
    window.addEventListener('beforeunload', beforeUnload);
    requestAnimationFrame(() => editorRef.current?.focus());
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (leaveGuardRef.current === guard) leaveGuardRef.current = null;
      window.removeEventListener('beforeunload', beforeUnload);
      void flushRef.current();
    };
  }, [leaveGuardRef]);

  const changeBody = (body: string) => {
    bodyRef.current = body;
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
      onBack();
    } catch (error) { setDeleteError(String(error)); }
    finally { deletingRef.current = false; setDeleting(false); }
  };
  const actionClass = 'px-2 py-1 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800 text-xs cursor-pointer disabled:opacity-40';
  return <div className="h-full drag-region"><div className="draft-document h-full flex flex-col max-w-4xl mx-auto p-6 gap-3">
    <div className="flex items-center justify-between shrink-0">
      <button type="button" className={`${actionClass} flex items-center gap-1`} onClick={async () => { if (await flushRef.current()) onBack(); }}><ArrowLeft className="w-3.5 h-3.5" />草稿列表</button>
      <div className="flex items-center gap-2 text-[11px] text-stone-400"><span aria-live="polite">{status === 'saving' ? '保存中…' : status === 'unsaved' ? '待保存' : status === 'failed' ? '保存失败' : status === 'conflict' ? '保存冲突' : ''}</span>
        <button type="button" className={`${actionClass} flex items-center gap-1 hover:text-rose-600`} onClick={() => { setDeleteError(''); setDeleteConfirm(true); }}><Trash2 className="w-3.5 h-3.5" />删除草稿</button>
        <button type="button" className={actionClass} title="新建草稿 (⌘N)" disabled={creating} onClick={onNew}>新建草稿 ⌘N</button></div>
    </div>
    <div role="toolbar" aria-label="草稿编辑工具" className="flex items-center gap-1 text-stone-500 shrink-0">
      <button type="button" className={actionClass} onClick={() => openFind('find')}>查找 ⌘F</button>
      <button type="button" className={actionClass} onClick={() => openFind('replace')}>替换 ⌘⇧R</button>
      <span className="ml-auto text-[11px]">⌘⇧L 多行末尾编辑 · Esc 退出多光标</span>
    </div>
    {(error || createError) && <div role="alert" className="shrink-0 rounded-lg border border-amber-300 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-2">
      <p>{error || createError}</p><div className="flex gap-2">
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
