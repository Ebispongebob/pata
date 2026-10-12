import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Events } from '@wailsio/runtime';
import {
  Hash,
  CheckSquare,
  FileText,
  MessageSquare,
  ChevronRight,
  AlertCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import * as VaultService from '../bindings/pata/vaultservice';
import { EntityRef, Memo } from '../bindings/pata/internal/storage/markdown/models';

interface TagViewProps {
  selectedTag: string | null;
  onOpenTask: (taskId: string) => void;
  onOpenNote: (noteId: string) => void;
}

function formatMemoTime(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

export function TagView({ selectedTag, onOpenTask, onOpenNote }: TagViewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<EntityRef[]>([]);
  const [memos, setMemos] = useState<Record<string, Memo>>({});
  const seqRef = useRef(0);

  const loadTagData = useCallback(async (tag: string | null) => {
    const seq = ++seqRef.current;

    if (!tag || !tag.trim()) {
      setItems([]);
      setMemos({});
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const rawRefs = await VaultService.ListByTag(tag.trim());
      if (seq !== seqRef.current) return;

      const refs = (rawRefs || []).filter((r): r is EntityRef => r !== null);
      setItems(refs);

      // Fetch memo content in parallel for all memo entities
      const memoRefs = refs.filter((r) => r.type === 'memo');
      if (memoRefs.length > 0) {
        const fetchedMemos: Record<string, Memo> = {};
        await Promise.all(
          memoRefs.map(async (mr) => {
            try {
              const memo = await VaultService.GetMemo(mr.id);
              if (memo) {
                fetchedMemos[mr.id] = memo;
              }
            } catch (err) {
              console.warn(`Failed to fetch memo details for ${mr.id}:`, err);
            }
          })
        );
        if (seq !== seqRef.current) return;
        setMemos(fetchedMemos);
      } else {
        setMemos({});
      }
    } catch (err: any) {
      if (seq !== seqRef.current) return;
      console.error('Failed to load entities for tag:', err);
      setError(`加载标签内容失败: ${err?.message || err}`);
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Reload when selectedTag changes
  useEffect(() => {
    loadTagData(selectedTag);
  }, [selectedTag, loadTagData]);

  // Subscribe to vault:changed events
  useEffect(() => {
    const unsubscribe = Events.On('vault:changed', () => {
      if (selectedTag) {
        loadTagData(selectedTag);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [selectedTag, loadTagData]);

  // Group items by type: Task -> Note -> Memo (ui.md §05 order)
  const taskItems = useMemo(() => items.filter((it) => it.type === 'task'), [items]);
  const noteItems = useMemo(() => items.filter((it) => it.type === 'note'), [items]);
  const memoItems = useMemo(() => items.filter((it) => it.type === 'memo'), [items]);

  if (!selectedTag) {
    return (
      <div className="max-w-[900px] mx-auto py-16 flex flex-col items-center justify-center text-stone-400 text-xs">
        <Hash className="w-8 h-8 mb-2 opacity-30" />
        <p>请在侧边栏选择一个全局标签查看</p>
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="max-w-[900px] mx-auto py-16 flex items-center justify-center text-stone-400 text-xs">
        <Loader2 className="w-5 h-5 animate-spin mr-2 text-emerald-600" />
        <span>正在加载 #{selectedTag} 关联内容...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[900px] mx-auto p-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center space-x-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto space-y-6 pb-16">
      {/* View Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-stone-200/80 dark:border-stone-800 pb-3">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/60 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 font-medium text-sm">
            <Hash className="w-4 h-4" />
            <span>{selectedTag}</span>
          </div>
          <span className="text-xs text-stone-400">
            共 {items.length} 项（任务 {taskItems.length} · 笔记 {noteItems.length} · 记录 {memoItems.length}）
          </span>
        </div>
      </div>

      {/* Global empty state when tag has 0 items */}
      {items.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-stone-400 text-xs bg-white dark:bg-stone-900/60 rounded-xl border border-stone-200/80 dark:border-stone-800">
          <Hash className="w-8 h-8 mb-2 opacity-30 text-stone-400" />
          <p>未找到包含标签 #{selectedTag} 的任务、笔记或记录</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section 1: Tasks */}
          <section className="space-y-2">
            <div className="flex items-center space-x-2 text-xs font-semibold text-stone-500 uppercase tracking-wider px-1">
              <CheckSquare className="w-3.5 h-3.5" />
              <span>任务 · {taskItems.length}</span>
            </div>
            {taskItems.length === 0 ? (
              <div className="text-xs text-stone-400 py-3 px-4 rounded-lg border border-dashed border-stone-200 dark:border-stone-800 text-center">
                无相关任务
              </div>
            ) : (
              <div className="space-y-1.5">
                {taskItems.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => onOpenTask(task.id)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900/90 hover:border-emerald-500/50 hover:bg-stone-50/80 dark:hover:bg-stone-800/50 transition cursor-pointer min-h-[36px] group text-left"
                    title={`打开任务: ${task.title || task.id}`}
                  >
                    <div className="flex items-center space-x-2.5 truncate mr-3">
                      <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-500 shrink-0" />
                      <span className="text-xs font-medium text-stone-800 dark:text-stone-200 truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
                        {task.title || task.id}
                      </span>
                    </div>
                    <span className="text-[11px] text-stone-400 font-mono flex items-center space-x-1 shrink-0">
                      <span>查看任务</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Section 2: Notes */}
          <section className="space-y-2">
            <div className="flex items-center space-x-2 text-xs font-semibold text-stone-500 uppercase tracking-wider px-1">
              <FileText className="w-3.5 h-3.5" />
              <span>笔记 · {noteItems.length}</span>
            </div>
            {noteItems.length === 0 ? (
              <div className="text-xs text-stone-400 py-3 px-4 rounded-lg border border-dashed border-stone-200 dark:border-stone-800 text-center">
                无相关笔记
              </div>
            ) : (
              <div className="space-y-1.5">
                {noteItems.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => onOpenNote(note.id)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900/90 hover:border-blue-500/50 hover:bg-stone-50/80 dark:hover:bg-stone-800/50 transition cursor-pointer min-h-[36px] group text-left"
                    title={`打开笔记: ${note.title || note.id}`}
                  >
                    <div className="flex items-center space-x-2.5 truncate mr-3">
                      <FileText className="w-4 h-4 text-blue-600 dark:text-blue-500 shrink-0" />
                      <span className="text-xs font-medium text-stone-800 dark:text-stone-200 truncate group-hover:text-blue-700 dark:group-hover:text-blue-400">
                        {note.title || note.id}
                      </span>
                    </div>
                    <span className="text-[11px] text-stone-400 font-mono flex items-center space-x-1 shrink-0">
                      <span>查看笔记</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Section 3: Memos */}
          <section className="space-y-2">
            <div className="flex items-center space-x-2 text-xs font-semibold text-stone-500 uppercase tracking-wider px-1">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>记录 · {memoItems.length}</span>
            </div>
            {memoItems.length === 0 ? (
              <div className="text-xs text-stone-400 py-3 px-4 rounded-lg border border-dashed border-stone-200 dark:border-stone-800 text-center">
                无相关记录
              </div>
            ) : (
              <div className="space-y-2">
                {memoItems.map((memoRef) => {
                  const memoData = memos[memoRef.id];
                  const memoText = memoData?.body?.trim() || '（无正文内容）';

                  return (
                    <div
                      key={memoRef.id}
                      className="p-3.5 rounded-lg border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900/90 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2">
                          <MessageSquare className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                          <span className="text-[11px] text-stone-400 font-mono">
                            {formatMemoTime(memoData?.created_at)}
                          </span>
                          {memoRef.inherited && (
                            <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60 font-medium">
                              经父任务
                            </span>
                          )}
                        </div>

                        {memoData?.task_id && (
                          <button
                            onClick={() => onOpenTask(memoData.task_id!)}
                            className="text-[11px] text-stone-500 hover:text-emerald-700 dark:hover:text-emerald-400 flex items-center space-x-1 transition min-h-[32px] px-1 cursor-pointer"
                            title="前往对应任务"
                          >
                            <span>前往任务</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-stone-700 dark:text-stone-300 leading-relaxed whitespace-pre-wrap line-clamp-3">
                        {memoText}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
