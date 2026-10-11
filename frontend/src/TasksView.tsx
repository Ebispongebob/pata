import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Circle,
  CheckCircle2,
  Clock,
  Trash2,
  Save,
  ArrowLeft,
  Plus,
  AlertCircle,
  Calendar,
  RefreshCw,
  X,
  Search,
  FolderOpen,
} from 'lucide-react';
import * as VaultService from '../bindings/pata/vaultservice';
import { Task, TaskStatus, TaskPriority } from '../bindings/pata/internal/storage/markdown/models';
import { VaultStatus, CreateTaskInput, UpdateTaskInput } from '../bindings/pata/models';

interface TasksViewProps {
  vaultStatus: VaultStatus | null;
  onSelectVault: () => void;
  onRescanVault: () => void;
  vaultBusy?: boolean;
}

export function TasksView({
  vaultStatus,
  onSelectVault,
  onRescanVault,
  vaultBusy = false,
}: TasksViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Quick create state
  const [quickTitle, setQuickTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Filtering & Search
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'done'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Detail / Editing state
  const [detailTitle, setDetailTitle] = useState('');
  const [detailStatus, setDetailStatus] = useState<TaskStatus>(TaskStatus.TaskStatusTodo);
  const [detailPriority, setDetailPriority] = useState<TaskPriority>(TaskPriority.TaskPriorityP2);
  const [detailDue, setDetailDue] = useState<string>('');
  const [detailTags, setDetailTags] = useState<string>('');
  const [detailBody, setDetailBody] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rescanLoading, setRescanLoading] = useState(false);

  // Fetch tasks
  const loadTasks = useCallback(async () => {
    if (!vaultStatus?.open) {
      setTasks([]);
      setListError(null);
      return;
    }
    setLoading(true);
    setListError(null);
    try {
      const result = await VaultService.ListTasks();
      const validTasks = (result ?? []).filter((t): t is Task => t !== null);
      setTasks(validTasks);
    } catch (err: any) {
      console.error('Failed to list tasks:', err);
      setListError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [vaultStatus?.open, vaultStatus?.path]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleRescan = async () => {
    setRescanLoading(true);
    setListError(null);
    try {
      await VaultService.RescanVault();
      if (onRescanVault) {
        onRescanVault();
      }
      await loadTasks();
    } catch (err: any) {
      console.error('Failed to rescan vault:', err);
      setListError(`重新扫描失败: ${err?.message || err}`);
    } finally {
      setRescanLoading(false);
    }
  };

  // Find currently selected task
  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return tasks.find((t) => t.id === selectedTaskId) ?? null;
  }, [tasks, selectedTaskId]);

  // When selected task changes, sync form fields
  useEffect(() => {
    if (selectedTask) {
      setDetailTitle(selectedTask.title);
      setDetailStatus(selectedTask.status);
      setDetailPriority(selectedTask.priority);
      setDetailDue(selectedTask.due ?? '');
      setDetailTags((selectedTask.tags ?? []).join(', '));
      setDetailBody(selectedTask.body ?? '');
      setDetailError(null);
      setSaveSuccessMsg(null);
    }
  }, [selectedTask]);

  // Quick create task
  const handleQuickCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;

    setCreating(true);
    setCreateError(null);

    try {
      const input: CreateTaskInput = {
        title,
        status: TaskStatus.TaskStatusTodo,
        priority: TaskPriority.TaskPriorityP2,
      };
      const created = await VaultService.CreateTask(input);
      setQuickTitle('');
      await loadTasks();
      if (created) {
        setSelectedTaskId(created.id);
      }
    } catch (err: any) {
      setCreateError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  };

  // Quick toggle status directly from list
  const handleToggleStatus = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    let nextStatus: TaskStatus;
    if (task.status === TaskStatus.TaskStatusDone) {
      nextStatus = TaskStatus.TaskStatusTodo;
    } else if (task.status === TaskStatus.TaskStatusTodo) {
      nextStatus = TaskStatus.TaskStatusDoing;
    } else {
      nextStatus = TaskStatus.TaskStatusDone;
    }

    try {
      await VaultService.SetTaskStatus(task.id, nextStatus);
      await loadTasks();
    } catch (err: any) {
      alert(`变更状态失败: ${err?.message || err}`);
    }
  };

  // Save edited task
  const handleSaveDetail = useCallback(async () => {
    if (!selectedTaskId) return;
    setSaving(true);
    setDetailError(null);
    setSaveSuccessMsg(null);

    try {
      const parsedTags = detailTags
        .split(/[,，]/)
        .map((t) => t.trim().replace(/^#+/, ''))
        .filter((t) => t.length > 0);

      const input: UpdateTaskInput = {
        id: selectedTaskId,
        title: detailTitle.trim(),
        status: detailStatus,
        priority: detailPriority,
        due: detailDue ? detailDue : null,
        tags: parsedTags,
        body: detailBody,
        note_ids: selectedTask?.note_ids ?? [],
      };

      const updated = await VaultService.UpdateTask(input);
      if (updated) {
        setSaveSuccessMsg('已安全保存到 Markdown 文件');
      }
      await loadTasks();
    } catch (err: any) {
      setDetailError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [selectedTaskId, detailTitle, detailStatus, detailPriority, detailDue, detailTags, detailBody, selectedTask?.note_ids, loadTasks]);

  // Clean up saveSuccessMsg auto-dismiss timer
  useEffect(() => {
    if (!saveSuccessMsg) return;
    const timer = setTimeout(() => {
      setSaveSuccessMsg(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [saveSuccessMsg]);

  // Confirm delete
  const handleDeleteTask = async () => {
    if (!selectedTaskId) return;
    setDeleting(true);
    try {
      await VaultService.DeleteTask(selectedTaskId);
      setDeleteModalOpen(false);
      setSelectedTaskId(null);
      await loadTasks();
    } catch (err: any) {
      setDetailError(`删除失败: ${err?.message || err}`);
      setDeleteModalOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  // Keyboard shortcut Cmd+S / Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (selectedTaskId) {
          e.preventDefault();
          handleSaveDetail();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTaskId, handleSaveDetail]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Status filter (all, active, done)
      if (statusFilter === 'active') {
        if (t.status === TaskStatus.TaskStatusDone) return false;
      } else if (statusFilter === 'done') {
        if (t.status !== TaskStatus.TaskStatusDone) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchTitle = t.title.toLowerCase().includes(query);
        const matchTag = (t.tags ?? []).some((tag) => tag.toLowerCase().includes(query));
        if (!matchTitle && !matchTag) return false;
      }

      return true;
    });
  }, [tasks, statusFilter, searchQuery]);

  // Unconfigured Vault state
  if (!vaultStatus?.configured) {
    return (
      <div className="py-16 text-center space-y-4 max-w-md mx-auto">
        <FolderOpen className="w-12 h-12 text-emerald-600 mx-auto opacity-75" />
        <h2 className="text-base font-semibold text-stone-800 dark:text-stone-200">尚未配置 Vault 目录</h2>
        <p className="text-xs text-stone-500 leading-relaxed">
          Pata 以本地纯文本 Markdown 作为唯一数据真相源（Local First）。请先选择一个本地目录。
        </p>
        <button
          onClick={onSelectVault}
          disabled={vaultBusy}
          className="mx-auto flex items-center space-x-1.5 px-4 py-2 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition disabled:opacity-50 shadow-xs"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>选择 Vault 目录</span>
        </button>
      </div>
    );
  }

  // Configured but unopened vault state
  if (!vaultStatus.open) {
    return (
      <div className="p-5 max-w-lg mx-auto rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-xs space-y-3">
        <div className="font-medium text-amber-900 dark:text-amber-200">Vault 打开异常</div>
        <p className="text-stone-600 dark:text-stone-400">
          无法加载目录：<code className="font-mono text-[11px] text-stone-800 dark:text-stone-200">{vaultStatus.path}</code>
        </p>
        <button
          onClick={onSelectVault}
          disabled={vaultBusy}
          className="px-3.5 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-medium transition disabled:opacity-50"
        >
          重新选择目录
        </button>
      </div>
    );
  }

  // Task Detail View (replaces main area in single-column style)
  if (selectedTask) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Navigation & Actions Top Bar */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-stone-200 dark:border-stone-800">
          <button
            onClick={() => {
              setSelectedTaskId(null);
              setDetailError(null);
            }}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回任务列表</span>
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
              onClick={handleSaveDetail}
              disabled={saving}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition shadow-xs disabled:opacity-50"
            >
              <Save className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
              <span>{saving ? '保存中...' : '保存'}</span>
            </button>
          </div>
        </div>

        {/* Error / Success Feedback Banners */}
        {detailError && (
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white/60 dark:bg-stone-950/40">
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

          {/* Priority */}
          <div>
            <label className="block text-[11px] font-medium text-stone-500 mb-1">优先级</label>
            <select
              value={detailPriority}
              onChange={(e) => setDetailPriority(e.target.value as TaskPriority)}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
            >
              <option value={TaskPriority.TaskPriorityP1}>P1 · 紧急优先</option>
              <option value={TaskPriority.TaskPriorityP2}>P2 · 默认</option>
              <option value={TaskPriority.TaskPriorityP3}>P3 · 低优先</option>
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

        {/* Markdown Body Editor */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
            <span className="font-semibold text-[11px] uppercase tracking-wider">正文描述 (Markdown)</span>
            <span className="text-[11px] text-stone-400">仅编辑正文，Go Core 维护 Frontmatter</span>
          </div>
          <textarea
            value={detailBody}
            onChange={(e) => setDetailBody(e.target.value)}
            placeholder="输入任务描述、目标与验收条件（纯 Markdown 格式）..."
            rows={12}
            className="w-full p-3.5 text-sm font-mono rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 resize-y leading-relaxed"
          />
        </div>

        {/* Status Events History & Meta info */}
        <div className="pt-2 border-t border-stone-200 dark:border-stone-800 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-stone-400 font-mono">
            <span>ID: {selectedTask.id}</span>
            <span>创建时间: {selectedTask.created_at?.slice(0, 19).replace('T', ' ')}</span>
            <span>更新时间: {selectedTask.updated_at?.slice(0, 19).replace('T', ' ')}</span>
          </div>

          {selectedTask.status_events && selectedTask.status_events.length > 0 && (
            <div className="rounded-lg bg-stone-100/70 dark:bg-stone-900/60 p-3 space-y-1.5">
              <div className="text-[11px] font-semibold text-stone-500">状态流转历史事件 (status_events):</div>
              <div className="space-y-1">
                {selectedTask.status_events.map((ev, idx) => (
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
              <div className="flex items-start space-x-3">
                <div className="p-2 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">确认删除任务？</h3>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    任务「{selectedTask.title}」的文件将从 Vault 中永久删除。关联的 Memo 将被保留，此操作不可撤销。
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
      </div>
    );
  }

  // Tasks List View
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Top Header Row with Path & Rescan */}
      <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 pb-2 border-b border-stone-200/80 dark:border-stone-800">
        <span className="font-mono text-[11px] truncate max-w-md" title={vaultStatus.path}>
          {vaultStatus.path}
        </span>
        <button
          onClick={handleRescan}
          disabled={vaultBusy || loading || rescanLoading}
          className="flex items-center space-x-1 px-2.5 py-1 rounded border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800 transition disabled:opacity-50"
          title="从磁盘重新扫描 Markdown 索引"
        >
          <RefreshCw className={`w-3 h-3 ${vaultBusy || loading || rescanLoading ? 'animate-spin' : ''}`} />
          <span>重新扫描</span>
        </button>
      </div>

      {/* Quick Create Bar */}
      <form onSubmit={handleQuickCreate} className="space-y-1">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="快速添加任务...（按回车或点击创建）"
            disabled={creating}
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 shadow-2xs"
          />
          <button
            type="submit"
            disabled={creating || !quickTitle.trim()}
            className="flex items-center space-x-1 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition disabled:opacity-40 shadow-2xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{creating ? '创建中' : '快速创建'}</span>
          </button>
        </div>
        {createError && (
          <div className="text-[11px] text-rose-600 dark:text-rose-400 px-1 font-mono">
            创建失败: {createError}
          </div>
        )}
      </form>

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="flex items-center space-x-1 p-0.5 rounded-lg bg-stone-200/60 dark:bg-stone-800/80 text-xs">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              statusFilter === 'all'
                ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-2xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
            }`}
          >
            全部 ({tasks.length})
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              statusFilter === 'active'
                ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-2xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
            }`}
          >
            待办中 ({tasks.filter((t) => t.status !== TaskStatus.TaskStatusDone).length})
          </button>
          <button
            onClick={() => setStatusFilter('done')}
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              statusFilter === 'done'
                ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-2xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
            }`}
          >
            已完成 ({tasks.filter((t) => t.status === TaskStatus.TaskStatusDone).length})
          </button>
        </div>

        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索任务标题或标签..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* List Error Banner */}
      {listError && (
        <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>加载任务列表失败: {listError}</span>
        </div>
      )}

      {/* Task List */}
      {filteredTasks.length === 0 ? (
        <div className="py-12 text-center text-xs text-stone-500 dark:text-stone-400 space-y-1">
          {listError ? (
            <div className="text-rose-600 dark:text-rose-400 font-mono text-[11px]">
              列表加载失败: {listError}
            </div>
          ) : (
            <>
              <div>暂无匹配的任务</div>
              {tasks.length === 0 && (
                <div className="text-[11px] text-stone-400">输入上方标题快速创建第一条任务吧</div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((t) => {
            const isDone = t.status === TaskStatus.TaskStatusDone;
            const isDoing = t.status === TaskStatus.TaskStatusDoing;

            return (
              <div
                key={t.id}
                onClick={() => setSelectedTaskId(t.id)}
                className="group p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 hover:border-emerald-500/60 dark:hover:border-emerald-600/60 hover:shadow-2xs transition cursor-pointer select-none"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-2.5 min-w-0">
                    {/* Status Toggle Button */}
                    <button
                      type="button"
                      onClick={(e) => handleToggleStatus(t, e)}
                      className="p-0.5 rounded text-stone-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition shrink-0"
                      title={
                        isDone
                          ? '点击重新打开为待办'
                          : isDoing
                          ? '点击标记为完成'
                          : '点击标记为进行中'
                      }
                    >
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : isDoing ? (
                        <Clock className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Circle className="w-4 h-4 text-stone-400 group-hover:text-stone-600" />
                      )}
                    </button>

                    <span
                      className={`text-xs font-medium truncate ${
                        isDone
                          ? 'line-through text-stone-400 dark:text-stone-500'
                          : 'text-stone-900 dark:text-stone-100'
                      }`}
                    >
                      {t.title}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5 shrink-0">
                    {/* Priority Badge */}
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                        t.priority === 'p1'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300'
                          : t.priority === 'p2'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300'
                          : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
                      }`}
                    >
                      {t.priority.toUpperCase()}
                    </span>

                    {/* Status Badge */}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        isDone
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
                          : isDoing
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300'
                          : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                </div>

                {/* Sub row: Due date, Tags, Updated At */}
                <div className="flex items-center gap-3 mt-2 text-[11px] text-stone-400">
                  {t.due && (
                    <span className="flex items-center space-x-1 text-stone-500 dark:text-stone-400">
                      <Calendar className="w-3 h-3" />
                      <span>due {t.due}</span>
                    </span>
                  )}

                  {t.tags && t.tags.length > 0 && (
                    <span className="flex items-center gap-1.5">
                      {t.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center text-[10px] px-1.5 py-0.2 rounded bg-stone-100 dark:bg-stone-800 text-emerald-700 dark:text-emerald-300"
                        >
                          #{tag}
                        </span>
                      ))}
                    </span>
                  )}

                  <span className="ml-auto font-mono text-[10px] text-stone-400">
                    {t.updated_at ? t.updated_at.slice(0, 10) : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
