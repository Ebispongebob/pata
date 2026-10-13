import React, { useState, useEffect, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Events } from '@wailsio/runtime';
import {
  Clock,
  Trash2,
  Save,
  ArrowLeft,
  Plus,
  AlertCircle,
  RefreshCw,
  X,
  Search,
  MessageSquare,
  Send,
  FileText,
  Link,
  Unlink,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import * as VaultService from '../bindings/pata/vaultservice';
import { Task, TaskStatus, Memo, Note } from '../bindings/pata/internal/storage/markdown/models';
import { UpdateTaskInput, CreateMemoInput } from '../bindings/pata/models';
import { playLogoSuccess } from './logoAnimation';
import { dedupeTags } from './quickCreate';

function formatMemoTimestamp(isoString: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    const pad = (n: number) => n.toString().padStart(2, '0');
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());

    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    if (isToday) {
      return `${hours}:${minutes}`;
    }

    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    if (year === now.getFullYear()) {
      return `${month}-${day} ${hours}:${minutes}`;
    }
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffSec < 60) return '刚刚';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} 小时前`;

    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
    if (isYesterday) return '昨天';

    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay} 天前`;

    const pad = (n: number) => n.toString().padStart(2, '0');
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    if (y === now.getFullYear()) {
      return `${m}-${day}`;
    }
    return `${y}-${m}-${day}`;
  } catch {
    return isoString;
  }
}

export interface TaskDetailHandle {
  /** 有未保存草稿时弹出 保存/放弃/取消；返回 true 表示可以继续离开。 */
  confirmLeave: () => Promise<boolean>;
  /** 丢弃表单并从磁盘重读（行内修改后同步）。 */
  reload: () => Promise<void>;
}

interface TaskDetailPanelProps {
  taskId: string;
  closeLabel: string;
  onClose: () => void;
  /** 任何成功写入后调用，用于刷新父级列表、全局标签与搜索。 */
  onChanged: () => void;
  onDeleted: () => void;
  onOpenNote?: (noteId: string) => void;
}

const isConflictErr = (err: any) =>
  typeof err?.message === 'string' &&
  (err.message.includes('write conflict') || err.message.includes('conflict at'));

export const TaskDetailPanel = forwardRef<TaskDetailHandle, TaskDetailPanelProps>(function TaskDetailPanel(
  { taskId, closeLabel, onClose, onChanged, onDeleted, onOpenNote },
  ref
) {
  const [task, setTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [detailTitle, setDetailTitle] = useState('');
  const [detailStatus, setDetailStatus] = useState<TaskStatus>(TaskStatus.TaskStatusTodo);
  const [detailDue, setDetailDue] = useState<string>('');
  const [detailTags, setDetailTags] = useState<string>('');
  const [detailBody, setDetailBody] = useState<string>('');
  const [detailNoteIds, setDetailNoteIds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [externalModified, setExternalModified] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState<((r: boolean) => void) | null>(null);

  const [taskMemos, setTaskMemos] = useState<Memo[]>([]);
  const [loadingMemos, setLoadingMemos] = useState(false);
  const [memoListError, setMemoListError] = useState<string | null>(null);
  const [newMemoBody, setNewMemoBody] = useState('');
  const [submittingMemo, setSubmittingMemo] = useState(false);
  const [submitMemoError, setSubmitMemoError] = useState<string | null>(null);

  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [noteSearchQuery, setNoteSearchQuery] = useState('');
  const [unlinkTarget, setUnlinkTarget] = useState<{ id: string; title: string } | null>(null);

  const parseTags = (s: string) =>
    dedupeTags(
      s
        .split(/[,，]/)
        .map((t) => t.trim().replace(/^#+/, ''))
        .filter((t) => t.length > 0)
    );

  const applyTask = useCallback((t: Task) => {
    setTask(t);
    setDetailTitle(t.title);
    setDetailStatus(t.status);
    setDetailDue(t.due ?? '');
    setDetailTags((t.tags ?? []).join(', '));
    setDetailBody(t.body ?? '');
    setDetailNoteIds(t.note_ids ?? []);
  }, []);

  const loadMemos = useCallback(async () => {
    setLoadingMemos(true);
    setMemoListError(null);
    try {
      const result = await VaultService.ListMemosByTask(taskId);
      setTaskMemos((result ?? []).filter((m): m is Memo => m !== null));
    } catch (err: any) {
      console.error('Failed to list memos for task:', err);
      setMemoListError(err?.message || String(err));
    } finally {
      setLoadingMemos(false);
    }
  }, [taskId]);

  const loadAllNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const result = await VaultService.ListNotes();
      setAllNotes((result ?? []).filter((n): n is Note => n !== null));
    } catch (err: any) {
      console.error('Failed to list notes for task association:', err);
    } finally {
      setLoadingNotes(false);
    }
  }, []);

  const reload = useCallback(async () => {
    setDetailError(null);
    setConflictError(null);
    setExternalModified(false);
    try {
      const t = await VaultService.GetTask(taskId);
      if (!t) throw new Error('任务不存在');
      applyTask(t);
      setLoadError(null);
      await Promise.all([loadMemos(), loadAllNotes()]);
    } catch (err: any) {
      setDetailError(`重新加载失败: ${err?.message || err}`);
      setLoadError((prev) => prev ?? (err?.message || String(err)));
    }
  }, [taskId, applyTask, loadMemos, loadAllNotes]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 外部文件变化：不覆盖编辑中的表单，只提示。
  useEffect(() => {
    const unsubscribe = Events.On('vault:changed', (ev) => {
      const data = ev.data as { entity_id?: string } | undefined;
      if (data?.entity_id === taskId) setExternalModified(true);
      void loadMemos();
      void loadAllNotes();
    });
    return () => {
      unsubscribe();
    };
  }, [taskId, loadMemos, loadAllNotes]);

  useEffect(() => {
    if (!saveSuccessMsg) return;
    const timer = setTimeout(() => setSaveSuccessMsg(null), 3000);
    return () => clearTimeout(timer);
  }, [saveSuccessMsg]);

  const buildInput = (noteIds: string[]): UpdateTaskInput => ({
    id: taskId,
    title: detailTitle.trim(),
    status: detailStatus,
    due: detailDue ? detailDue : null,
    tags: parseTags(detailTags),
    body: detailBody,
    note_ids: noteIds,
  });

  const dirty = useMemo(() => {
    if (!task) return false;
    const sig = (title: string, status: string, due: string, tags: string[], body: string) =>
      JSON.stringify([title, status, due, tags, body]);
    return (
      sig(detailTitle.trim(), detailStatus, detailDue, parseTags(detailTags), detailBody) !==
      sig(task.title, task.status, task.due ?? '', dedupeTags(task.tags ?? []), task.body ?? '')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, detailTitle, detailStatus, detailDue, detailTags, detailBody]);

  // 保存；成功返回 true。noteIds 变更与属性共用同一次写入。
  const save = useCallback(
    async (noteIds: string[], okMsg: string): Promise<boolean> => {
      setSaving(true);
      setDetailError(null);
      setConflictError(null);
      setSaveSuccessMsg(null);
      try {
        const updated = await VaultService.UpdateTask(buildInput(noteIds));
        if (updated) {
          applyTask(updated);
          setSaveSuccessMsg(okMsg);
          setExternalModified(false);
        }
        onChanged();
        return true;
      } catch (err: any) {
        if (isConflictErr(err)) {
          setConflictError(err?.message || '文件已被外部修改（写入冲突）');
          setExternalModified(true);
        } else {
          setDetailError(err?.message || String(err));
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskId, detailTitle, detailStatus, detailDue, detailTags, detailBody, applyTask, onChanged]
  );

  const handleSave = useCallback(() => save(detailNoteIds, '已安全保存到 Markdown 文件'), [save, detailNoteIds]);

  const confirmLeave = useCallback(
    () => (dirty ? new Promise<boolean>((resolve) => setLeavePrompt(() => resolve)) : Promise.resolve(true)),
    [dirty]
  );

  useImperativeHandle(ref, () => ({ confirmLeave, reload }), [confirmLeave, reload]);

  const finishLeavePrompt = async (choice: 'save' | 'discard' | 'cancel') => {
    const resolve = leavePrompt;
    if (!resolve) return;
    if (choice === 'save') {
      const ok = await handleSave();
      setLeavePrompt(null);
      resolve(ok);
      return;
    }
    setLeavePrompt(null);
    resolve(choice === 'discard');
  };

  const handleCloseClick = async () => {
    if (await confirmLeave()) onClose();
  };

  const handleAddMemo = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const body = newMemoBody.trim();
    if (!body) return;
    setSubmittingMemo(true);
    setSubmitMemoError(null);
    try {
      const input: CreateMemoInput = { body, task_id: taskId };
      await VaultService.CreateMemo(input);
      playLogoSuccess();
      setNewMemoBody('');
      await loadMemos();
      onChanged();
    } catch (err: any) {
      console.error('Failed to create memo:', err);
      setSubmitMemoError(err?.message || String(err));
    } finally {
      setSubmittingMemo(false);
    }
  };

  const handleAddNoteLink = async (noteId: string) => {
    if (detailNoteIds.includes(noteId)) return;
    setShowAddNoteModal(false);
    await save([...detailNoteIds, noteId], '已更新关联笔记');
  };

  const handleConfirmUnlinkNote = async () => {
    if (!unlinkTarget) return;
    const next = detailNoteIds.filter((id) => id !== unlinkTarget.id);
    setUnlinkTarget(null);
    await save(next, '已更新关联笔记');
  };

  const handleDeleteTask = async () => {
    setDeleting(true);
    try {
      await VaultService.DeleteTask(taskId);
      setDeleteModalOpen(false);
      onChanged();
      onDeleted();
    } catch (err: any) {
      setDetailError(`删除失败: ${err?.message || err}`);
      setDeleteModalOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  // ⌘S / Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  if (!task) {
    return (
      <div className="space-y-3 text-xs text-stone-500">
        <button
          onClick={onClose}
          className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{closeLabel}</span>
        </button>
        {loadError ? (
          <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200">
            加载任务失败: {loadError}
          </div>
        ) : (
          <div>加载中...</div>
        )}
      </div>
    );
  }

  return (
      <div className="space-y-5">
        {/* Navigation & Actions Top Bar */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-stone-200 dark:border-stone-800">
          <button
            onClick={handleCloseClick}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{closeLabel}</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setDeleteModalOpen(true)}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 transition"
              title="删除任务"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>删除</span>
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition shadow-xs disabled:opacity-50"
            >
              <Save className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
              <span>{saving ? '保存中...' : '保存'}</span>
            </button>
          </div>
        </div>

        {/* External Modification / Conflict Warning Banner */}
        {(externalModified || conflictError) && (
          <div className="p-3.5 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center space-x-2.5 min-w-0">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="font-medium">
                {conflictError
                  ? '文件已被外部修改（保存冲突），点击重新加载以丢弃本地编辑并重读'
                  : '文件已被外部修改，点击重新加载'}
              </span>
            </div>
            <button
              type="button"
              onClick={reload}
              className="flex items-center space-x-1 px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition shrink-0 shadow-2xs"
            >
              <RefreshCw className="w-3 h-3" />
              <span>重新加载</span>
            </button>
          </div>
        )}

        {/* Generic Error / Success Feedback Banners */}
        {detailError && !conflictError && (
          <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-semibold">保存失败（Go Core 拒绝）</div>
              <div className="font-mono text-[11px] break-all">{detailError}</div>
            </div>
          </div>
        )}

        {saveSuccessMsg && (
          <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-xs flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}

        {/* Task Title Input */}
        <div>
          <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
            任务标题
          </label>
          <input
            type="text"
            value={detailTitle}
            onChange={(e) => setDetailTitle(e.target.value)}
            placeholder="输入任务标题..."
            className="w-full px-3 py-2 text-base font-semibold rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        {/* Metadata Controls Grid */}
        <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white/60 dark:bg-stone-950/40">
          {/* Status */}
          <div>
            <label className="block text-[11px] font-medium text-stone-500 mb-1">状态</label>
            <select
              value={detailStatus}
              onChange={(e) => setDetailStatus(e.target.value as TaskStatus)}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
            >
              <option value={TaskStatus.TaskStatusTodo}>todo · 待办</option>
              <option value={TaskStatus.TaskStatusDoing}>doing · 进行中</option>
              <option value={TaskStatus.TaskStatusDone}>done · 已完成</option>
            </select>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-[11px] font-medium text-stone-500 mb-1">截止日期 (Due)</label>
            <div className="relative flex items-center">
              <input
                type="date"
                value={detailDue}
                onChange={(e) => setDetailDue(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
              {detailDue && (
                <button
                  type="button"
                  onClick={() => setDetailDue('')}
                  className="absolute right-2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
                  title="清除截止时间"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[11px] font-medium text-stone-500 mb-1">标签 (逗号分隔)</label>
            <input
              type="text"
              value={detailTags}
              onChange={(e) => setDetailTags(e.target.value)}
              placeholder="架构设计, 性能优化"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
            />
          </div>
        </div>

        {/* Task Description */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
            <label htmlFor="task-description" className="font-semibold text-[11px] uppercase tracking-wider">任务描述</label>
            <span className="text-[11px] text-stone-400">纯文本，支持换行</span>
          </div>
          <textarea
            id="task-description"
            value={detailBody}
            onChange={(e) => setDetailBody(e.target.value)}
            placeholder="输入任务描述、目标与验收条件..."
            rows={12}
            className="w-full p-3.5 text-sm rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 resize-y leading-relaxed"
          />
        </div>

        {/* Linked Notes Section */}
        <div className="space-y-3 pt-3 border-t border-stone-200 dark:border-stone-800">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span className="flex items-center space-x-1.5 font-semibold text-[11px] uppercase tracking-wider text-stone-500">
              <Link className="w-3.5 h-3.5" />
              <span>关联笔记 ({detailNoteIds.length})</span>
            </span>
            <div className="flex items-center space-x-2">
              {loadingNotes && <span className="text-[11px] text-stone-400">加载中...</span>}
              <button
                type="button"
                onClick={() => {
                  setNoteSearchQuery('');
                  setShowAddNoteModal(true);
                }}
                className="flex items-center space-x-1 text-xs text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition"
              >
                <Plus className="w-3 h-3" />
                <span>添加关联</span>
              </button>
            </div>
          </div>

          {/* Linked Notes List */}
          {detailNoteIds.length === 0 ? (
            <div className="p-3 rounded-lg border border-dashed border-stone-200 dark:border-stone-800 text-stone-400 text-xs text-center">
              暂无关联笔记（仅显式关联，相同标签不会自动建立关联）
            </div>
          ) : (
            <div className="space-y-1.5">
              {detailNoteIds.map((nid) => {
                const note = allNotes.find((n) => n.id === nid);
                const title = note ? note.title : nid;
                const timeStr = note?.updated_at ? formatRelativeTime(note.updated_at) : '';
                return (
                  <div
                    key={nid}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300 dark:hover:border-stone-700 transition group"
                  >
                    <div
                      onClick={() => onOpenNote?.(nid)}
                      className={`flex items-center space-x-2 min-w-0 flex-1 ${
                        onOpenNote ? 'cursor-pointer' : ''
                      }`}
                      title={onOpenNote ? '点击在编辑器中打开笔记' : undefined}
                    >
                      <FileText className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                      <span className="text-xs font-medium text-stone-800 dark:text-stone-200 truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition">
                        {title}
                      </span>
                      {timeStr && (
                        <span className="text-[10px] text-stone-400 shrink-0">
                          {timeStr}
                        </span>
                      )}
                      {onOpenNote && (
                        <ExternalLink className="w-3 h-3 text-stone-300 dark:text-stone-600 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 shrink-0 transition" />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setUnlinkTarget({ id: nid, title })}
                      className="p-1 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition shrink-0 ml-2"
                      title="解除关联"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Comments / Memos Section */}
        <div className="space-y-3 pt-3 border-t border-stone-200 dark:border-stone-800">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span className="flex items-center space-x-1.5 font-semibold text-[11px] uppercase tracking-wider text-stone-500">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>记录 / 评论 ({taskMemos.length})</span>
            </span>
            {loadingMemos && <span className="text-[11px] text-stone-400">加载中...</span>}
          </div>

          {/* Memo List Error Banner */}
          {memoListError && (
            <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>加载记录列表失败: {memoListError}</span>
            </div>
          )}

          {/* Memo Items List */}
          {taskMemos.length === 0 ? (
            <div className="py-3 text-center text-xs text-stone-400 dark:text-stone-500">
              暂无记录或评论，可在下方快速记录进展
            </div>
          ) : (
            <div className="space-y-2">
              {taskMemos.map((memo) => (
                <div
                  key={memo.id}
                  className="p-3 rounded-xl border border-stone-200/90 dark:border-stone-800 bg-white dark:bg-stone-900/50 space-y-1.5 shadow-2xs"
                >
                  <div className="flex items-center justify-between text-[11px] text-stone-400">
                    <span className="font-mono text-[10px] text-stone-400">{memo.id}</span>
                    <span
                      title={memo.created_at ? memo.created_at.replace('T', ' ').slice(0, 19) : ''}
                      className="font-mono text-[11px] text-stone-500 dark:text-stone-400"
                    >
                      {formatMemoTimestamp(memo.created_at)}
                    </span>
                  </div>
                  <div className="text-xs text-stone-800 dark:text-stone-200 whitespace-pre-wrap leading-relaxed break-words font-sans">
                    {memo.body}
                  </div>
                  {memo.tags && memo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {memo.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center text-[10px] px-1.5 py-0.2 rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 font-mono"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Submit New Memo Form */}
          <form onSubmit={handleAddMemo} className="space-y-2 pt-1">
            <textarea
              value={newMemoBody}
              onChange={(e) => setNewMemoBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !submittingMemo && newMemoBody.trim()) {
                  e.preventDefault();
                  handleAddMemo();
                }
              }}
              placeholder="输入任务记录或评论...（支持 ⌘+Enter 提交）"
              rows={3}
              disabled={submittingMemo}
              className="w-full p-3 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 resize-y leading-relaxed shadow-2xs"
            />

            {/* Submit Error Banner */}
            {submitMemoError && (
              <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-semibold">添加记录失败</div>
                  <div className="font-mono text-[11px] break-all">{submitMemoError}</div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-stone-400">支持 ⌘+Enter 快捷提交</span>
              <button
                type="submit"
                disabled={submittingMemo || !newMemoBody.trim()}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition disabled:opacity-40 shadow-2xs shrink-0"
              >
                <Send className={`w-3 h-3 ${submittingMemo ? 'animate-spin' : ''}`} />
                <span>{submittingMemo ? '提交中...' : '添加记录'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Status Events History & Meta info */}
        <div className="pt-2 border-t border-stone-200 dark:border-stone-800 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-stone-400 font-mono">
            <span>ID: {task.id}</span>
            <span>创建时间: {task.created_at?.slice(0, 19).replace('T', ' ')}</span>
            <span>更新时间: {task.updated_at?.slice(0, 19).replace('T', ' ')}</span>
          </div>

          {task.status_events && task.status_events.length > 0 && (
            <div className="rounded-lg bg-stone-100/70 dark:bg-stone-900/60 p-3 space-y-1.5">
              <div className="text-[11px] font-semibold text-stone-500">状态流转历史事件 (status_events):</div>
              <div className="space-y-1">
                {task.status_events.map((ev, idx) => (
                  <div key={idx} className="flex items-center space-x-2 text-xs">
                    {ev.action === 'completed' ? (
                      <span className="inline-flex items-center space-x-1 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />
                        <span className="font-medium">已完成 (completed)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-blue-700 dark:text-blue-400">
                        <Clock className="w-3 h-3" />
                        <span className="font-medium">重新打开 (reopened)</span>
                      </span>
                    )}
                    <span className="text-[11px] text-stone-400 font-mono">
                      {ev.at?.slice(0, 19).replace('T', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Delete Confirmation Modal */}
        {deleteModalOpen && (
          <div className="pata-fade fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
              <div className="flex items-start space-x-3">
                <div className="p-2 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">确认删除任务？</h3>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    任务「{task.title}」的文件将从 Vault 中永久删除。关联的 Memo 将被保留，此操作不可撤销。
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-stone-100 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(false)}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleDeleteTask}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition disabled:opacity-50"
                >
                  {deleting ? '删除中...' : '确认删除'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Note Selector Modal */}
        {showAddNoteModal && (
          <div className="pata-fade fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-stone-100 dark:border-stone-800">
                <div className="flex items-center space-x-2">
                  <Link className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    关联已有笔记
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddNoteModal(false)}
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-stone-500">
                选择要关联的笔记。相同标签不会自动关联，必须在此显式建立关联。
              </p>

              {/* Search input */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={noteSearchQuery}
                  onChange={(e) => setNoteSearchQuery(e.target.value)}
                  placeholder="搜索笔记标题或标签..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                  autoFocus
                />
              </div>

              {/* Note options list */}
              <div className="max-h-60 overflow-y-auto space-y-1 divide-y divide-stone-100 dark:divide-stone-800/50">
                {allNotes
                  .filter((n) => {
                    if (!noteSearchQuery.trim()) return true;
                    const q = noteSearchQuery.trim().toLowerCase();
                    const matchTitle = n.title.toLowerCase().includes(q);
                    const matchTags = (n.tags ?? []).some((t) => t.toLowerCase().includes(q));
                    return matchTitle || matchTags;
                  })
                  .map((n) => {
                    const alreadyLinked = detailNoteIds.includes(n.id);
                    return (
                      <div
                        key={n.id}
                        className={`flex items-center justify-between p-2 rounded-lg transition ${
                          alreadyLinked
                            ? 'opacity-50 cursor-not-allowed bg-stone-50 dark:bg-stone-950/40'
                            : 'hover:bg-stone-100 dark:hover:bg-stone-800/60 cursor-pointer'
                        }`}
                        onClick={() => {
                          if (!alreadyLinked) {
                            handleAddNoteLink(n.id);
                          }
                        }}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="flex items-center space-x-1.5">
                            <FileText className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                            <span className="text-xs font-medium text-stone-800 dark:text-stone-200 truncate">
                              {n.title}
                            </span>
                          </div>
                          {(n.tags ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1 pl-5">
                              {(n.tags ?? []).map((t) => (
                                <span
                                  key={t}
                                  className="text-[10px] px-1 py-0.2 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 font-mono"
                                >
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {alreadyLinked ? (
                            <span className="text-[10px] text-stone-400 bg-stone-200/60 dark:bg-stone-800 px-1.5 py-0.5 rounded">
                              已关联
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium hover:underline">
                              关联
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                {allNotes.length === 0 && (
                  <div className="text-center py-6 text-xs text-stone-400">
                    Vault 中暂无笔记
                  </div>
                )}
                {allNotes.length > 0 &&
                  allNotes.filter((n) => {
                    if (!noteSearchQuery.trim()) return true;
                    const q = noteSearchQuery.trim().toLowerCase();
                    return (
                      n.title.toLowerCase().includes(q) ||
                      (n.tags ?? []).some((t) => t.toLowerCase().includes(q))
                    );
                  }).length === 0 && (
                    <div className="text-center py-6 text-xs text-stone-400">
                      无匹配的笔记
                    </div>
                  )}
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-stone-100 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => setShowAddNoteModal(false)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Unlink Note Confirmation Modal */}
        {unlinkTarget && (
          <div className="pata-fade fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
              <div className="flex items-start space-x-3">
                <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 shrink-0">
                  <Unlink className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    解除笔记关联
                  </h3>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    确定解除与笔记「<span className="font-medium text-stone-800 dark:text-stone-200">{unlinkTarget.title}</span>」的关联吗？
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    仅解除关联，不删除笔记。
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-stone-100 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => setUnlinkTarget(null)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUnlinkNote}
                  className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition shadow-xs"
                >
                  确认解除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Unsaved Draft Prompt */}
        {leavePrompt && (
          <div className="pata-fade fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">有未保存的修改</h3>
                <p className="text-xs text-stone-500 leading-relaxed">任务「{task.title}」的编辑尚未保存，是否保存后继续？</p>
              </div>
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-stone-100 dark:border-stone-800">
                <button
                  type="button"
                  autoFocus
                  onClick={() => void finishLeavePrompt('cancel')}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void finishLeavePrompt('discard')}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                >
                  放弃
                </button>
                <button
                  type="button"
                  onClick={() => void finishLeavePrompt('save')}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
});
