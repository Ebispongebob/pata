import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Events } from '@wailsio/runtime';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  Circle,
  Clock,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Search,
  X,
  AlertCircle,
  RefreshCw,
  FolderOpen,
  FileText,
  Send,
  ExternalLink,
} from 'lucide-react';
import * as VaultService from '../bindings/pata/vaultservice';
import { Task, TaskStatus, TaskPriority } from '../bindings/pata/internal/storage/markdown/models';
import { VaultStatus, CreateTaskInput, TimelineItem, CreateMemoInput } from '../bindings/pata/models';

interface TodayViewProps {
  vaultStatus: VaultStatus | null;
  onSelectVault: () => void;
  onRescanVault: () => void;
  vaultBusy?: boolean;
  onOpenTask?: (taskID: string) => void;
}

function formatTimelineTime(isoString: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return isoString;
  }
}

function getLocalDateStr(d: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDateStr(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + offsetDays);
  return getLocalDateStr(date);
}

function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const w = weekdays[date.getDay()];
  return `${m} 月 ${d} 日 · 星期${w}`;
}

export function TodayView({
  vaultStatus,
  onSelectVault,
  onRescanVault,
  vaultBusy = false,
  onOpenTask,
}: TodayViewProps) {
  const todayStr = useMemo(() => getLocalDateStr(), []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [dayPlanTaskIds, setDayPlanTaskIds] = useState<string[]>([]);
  const [yesterdayTaskIds, setYesterdayTaskIds] = useState<string[]>([]);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rescanLoading, setRescanLoading] = useState(false);

  // Quick memo state
  const [quickMemoBody, setQuickMemoBody] = useState('');
  const [creatingMemo, setCreatingMemo] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);

  // Auto-dismiss notice after 5 seconds
  useEffect(() => {
    if (!noticeMsg) return;
    const timer = setTimeout(() => {
      setNoticeMsg(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [noticeMsg]);

  // Modal / Input states
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickCreating, setQuickCreating] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  // Load all tasks, day plan, and timeline for current selectedDate
  const loadData = useCallback(async () => {
    if (!vaultStatus?.open) {
      setTasks([]);
      setDayPlanTaskIds([]);
      setYesterdayTaskIds([]);
      setTimelineItems([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [allTasksRes, planRes, timelineRes] = await Promise.all([
        VaultService.ListTasks(),
        VaultService.GetDayPlan(selectedDate),
        VaultService.GetDayTimeline(selectedDate),
      ]);

      const validTasks = (allTasksRes ?? []).filter((t): t is Task => t !== null);
      setTasks(validTasks);
      setDayPlanTaskIds((planRes?.task_ids ?? []).filter((id): id is string => typeof id === 'string'));
      setTimelineItems((timelineRes ?? []).filter((item): item is TimelineItem => item !== null));

      // If looking at today, fetch yesterday's plan for uncompleted candidates
      if (selectedDate === todayStr) {
        const yesterdayStr = shiftDateStr(todayStr, -1);
        const yPlanRes = await VaultService.GetDayPlan(yesterdayStr);
        setYesterdayTaskIds((yPlanRes?.task_ids ?? []).filter((id): id is string => typeof id === 'string'));
      } else {
        setYesterdayTaskIds([]);
      }
    } catch (err: any) {
      console.error('Failed to load today data:', err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [vaultStatus?.open, selectedDate, todayStr]);

  useEffect(() => {
    setNoticeMsg(null);
    setSaveError(null);
    setMemoError(null);
  }, [selectedDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Quick memo creation handler
  const handleCreateQuickMemo = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const body = quickMemoBody.trim();
    if (!body) return;

    setCreatingMemo(true);
    setMemoError(null);
    try {
      const input: CreateMemoInput = {
        body,
        tags: [],
      };
      await VaultService.CreateMemo(input);
      setQuickMemoBody('');
      await loadData();
    } catch (err: any) {
      console.error('Failed to create memo:', err);
      setMemoError(err?.message || String(err));
    } finally {
      setCreatingMemo(false);
    }
  };

  // Subscribe to external vault changes
  useEffect(() => {
    const unsubscribe = Events.On('vault:changed', () => {
      loadData();
    });
    return () => {
      unsubscribe();
    };
  }, [loadData]);

  const handleRescan = async () => {
    setRescanLoading(true);
    setError(null);
    try {
      await VaultService.RescanVault();
      if (onRescanVault) {
        onRescanVault();
      }
      await loadData();
    } catch (err: any) {
      console.error('Failed to rescan vault:', err);
      setError(`重新扫描失败: ${err?.message || err}`);
    } finally {
      setRescanLoading(false);
    }
  };

  // Immediate save helper for DayPlan with automatic dangling ID filtration and reporting
  const persistPlan = async (
    newTaskIds: string[],
    newlyCreatedId?: string,
    danglingRemovedCount: number = 0
  ) => {
    setSaving(true);
    setSaveError(null);
    try {
      const validTaskSet = new Set(tasks.map((t) => t.id));
      if (newlyCreatedId) {
        validTaskSet.add(newlyCreatedId);
      }
      const filtered = newTaskIds.filter((id) => validTaskSet.has(id));
      const extraRemoved = newTaskIds.length - filtered.length;
      const totalRemoved = danglingRemovedCount + extraRemoved;

      const updated = await VaultService.SaveDayPlan(selectedDate, filtered);
      setDayPlanTaskIds((updated?.task_ids ?? filtered).filter((id): id is string => typeof id === 'string'));

      if (totalRemoved > 0) {
        setNoticeMsg(`已同步移除 ${totalRemoved} 个失效任务占位`);
      } else {
        setNoticeMsg(null);
      }
    } catch (err: any) {
      console.error('Failed to save day plan:', err);
      const errStr = err?.message || String(err);
      if (errStr.includes('任务不存在') || errStr.toLowerCase().includes('not exist')) {
        setSaveError(`计划中存在已删除任务的占位，请先移除后再试 (${errStr})`);
      } else {
        setSaveError(errStr);
      }
      // Re-sync with disk state
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  // Task map for fast lookup
  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks) {
      map.set(t.id, t);
    }
    return map;
  }, [tasks]);

  // Ordered tasks for the day plan (including dangling references)
  const planItems = useMemo(() => {
    return dayPlanTaskIds.map((id) => {
      const task = taskMap.get(id);
      return {
        id,
        task: task ?? null,
        isDangling: !task,
      };
    });
  }, [dayPlanTaskIds, taskMap]);

  // Valid (non-dangling) items in the plan
  const validPlanItems = useMemo(() => {
    return planItems.filter((item) => !item.isDangling && item.task !== null);
  }, [planItems]);

  // Yesterday's unfinished candidates (only when viewing today)
  const yesterdayCandidates = useMemo(() => {
    if (selectedDate !== todayStr) return [];
    const currentSet = new Set(dayPlanTaskIds);
    return yesterdayTaskIds
      .map((id) => taskMap.get(id))
      .filter((t): t is Task => {
        if (!t) return false;
        // Not done and not already in today's plan
        return t.status !== TaskStatus.TaskStatusDone && !currentSet.has(t.id);
      });
  }, [selectedDate, todayStr, dayPlanTaskIds, yesterdayTaskIds, taskMap]);

  // Toggle status of a task
  const handleToggleStatus = async (task: Task) => {
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
      await loadData();
    } catch (err: any) {
      alert(`变更状态失败: ${err?.message || err}`);
      await loadData();
    }
  };

  // Move task up / down in order (stripping dangling IDs before persistence)
  const handleMove = async (taskId: string, direction: 'up' | 'down') => {
    const validTaskSet = new Set(tasks.map((t) => t.id));
    const validIds = dayPlanTaskIds.filter((id) => validTaskSet.has(id));
    const removedDanglingCount = dayPlanTaskIds.length - validIds.length;

    const currentIndex = validIds.indexOf(taskId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= validIds.length) return;

    const newIds = [...validIds];
    const temp = newIds[currentIndex];
    newIds[currentIndex] = newIds[targetIndex];
    newIds[targetIndex] = temp;

    await persistPlan(newIds, undefined, removedDanglingCount);
  };

  // Remove task from plan
  const handleConfirmRemove = async () => {
    if (!removeConfirmId) return;
    const targetId = removeConfirmId;
    setRemoveConfirmId(null);

    const validTaskSet = new Set(tasks.map((t) => t.id));
    // Filter out targetId first
    const remaining = dayPlanTaskIds.filter((id) => id !== targetId);
    const validRemaining = remaining.filter((id) => validTaskSet.has(id));
    // If other dangling IDs were also stripped, count them
    const otherDanglingRemoved = remaining.length - validRemaining.length;

    await persistPlan(validRemaining, undefined, otherDanglingRemoved);
  };

  // Add existing task to plan
  const handleAddExisting = async (taskId: string) => {
    const validTaskSet = new Set(tasks.map((t) => t.id));
    const validIds = dayPlanTaskIds.filter((id) => validTaskSet.has(id));
    const removedDanglingCount = dayPlanTaskIds.length - validIds.length;

    if (validIds.includes(taskId)) return;
    const newIds = [...validIds, taskId];
    await persistPlan(newIds, undefined, removedDanglingCount);
  };

  // Quick create task and add to plan
  const handleQuickCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;

    setQuickCreating(true);
    setSaveError(null);
    try {
      const input: CreateTaskInput = {
        title,
        status: TaskStatus.TaskStatusTodo,
        priority: TaskPriority.TaskPriorityP2,
      };
      const created = await VaultService.CreateTask(input);
      setQuickTitle('');
      if (created) {
        const validTaskSet = new Set(tasks.map((t) => t.id));
        validTaskSet.add(created.id);
        const validIds = dayPlanTaskIds.filter((id) => validTaskSet.has(id));
        const removedDanglingCount = dayPlanTaskIds.length - validIds.length;

        const newIds = [...validIds, created.id];
        await persistPlan(newIds, created.id, removedDanglingCount);
      }
      await loadData();
    } catch (err: any) {
      console.error('Failed to quick create task:', err);
      const errStr = err?.message || String(err);
      if (errStr.includes('任务不存在') || errStr.toLowerCase().includes('not exist')) {
        setSaveError(`计划中存在已删除任务的占位，请先移除后再试 (${errStr})`);
      } else {
        setSaveError(errStr);
      }
    } finally {
      setQuickCreating(false);
    }
  };

  // Available tasks to add in modal
  const availableTasksToAdd = useMemo(() => {
    const currentSet = new Set(dayPlanTaskIds);
    const query = addSearch.trim().toLowerCase();
    return tasks.filter((t) => {
      if (currentSet.has(t.id)) return false;
      if (!query) return true;
      const matchTitle = t.title.toLowerCase().includes(query);
      const matchTag = (t.tags ?? []).some((tag) => tag.toLowerCase().includes(query));
      return matchTitle || matchTag;
    });
  }, [tasks, dayPlanTaskIds, addSearch]);

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

  const isToday = selectedDate === todayStr;
  const completedCount = planItems.filter((i) => i.task?.status === TaskStatus.TaskStatusDone).length;
  const totalCount = planItems.length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
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

      {/* Date Navigation Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-2xs">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setSelectedDate((d) => shiftDateStr(d, -1))}
              className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              title="前一天"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSelectedDate((d) => shiftDateStr(d, 1))}
              className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              title="后一天"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {formatDateDisplay(selectedDate)}
              </span>
              {isToday ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                  今天
                </span>
              ) : (
                <span className="text-[11px] font-mono text-stone-400">
                  {selectedDate}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-400 mt-0.5">
              {isToday ? '给重要的事留一点空间 · 每日工作闭环' : '回顾历史日安排与记录'}
            </p>
          </div>
        </div>

        {!isToday && (
          <button
            onClick={() => setSelectedDate(todayStr)}
            className="flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-600 dark:text-stone-300 text-xs font-medium transition shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>回到今天</span>
          </button>
        )}
      </div>

      {/* Synchronized Cleanup Notice Banner */}
      {noticeMsg && (
        <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between space-x-2">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{noticeMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setNoticeMsg(null)}
            className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 p-0.5 rounded transition"
            title="关闭提示"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error / Conflict Feedback Banners */}
      {error && (
        <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>加载失败: {error}</span>
        </div>
      )}

      {saveError && (
        <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-start justify-between space-x-2">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-semibold">
                {saveError.includes('任务不存在') || saveError.includes('已删除任务')
                  ? '计划中存在已删除任务的占位，请先移除后再试'
                  : '计划保存失败（可能存在写入冲突）'}
              </div>
              <div className="font-mono text-[11px] break-all">{saveError}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-rose-600 hover:text-rose-800 dark:hover:text-rose-200 p-0.5 rounded transition shrink-0"
            title="关闭提示"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Yesterday Unfinished Candidates Section (Only visible on Today) */}
      {isToday && yesterdayCandidates.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-amber-900 dark:text-amber-200">
                昨日未完成候选 ({yesterdayCandidates.length})
              </span>
              <span className="text-[11px] text-amber-700/80 dark:text-amber-400">
                绝不自动顺延，由你确认安排
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            {yesterdayCandidates.map((cand) => (
              <div
                key={cand.id}
                className="flex items-center justify-between p-2.5 rounded-lg border border-amber-200/80 dark:border-amber-900/40 bg-white/80 dark:bg-stone-900/80 text-xs gap-3"
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500">
                    {cand.priority.toUpperCase()}
                  </span>
                  <span className="truncate text-stone-900 dark:text-stone-100 font-medium">
                    {cand.title}
                  </span>
                  {cand.due && (
                    <span className="text-[10px] text-stone-400 shrink-0">
                      due {cand.due}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleAddExisting(cand.id)}
                  disabled={saving}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition shrink-0 disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" />
                  <span>加入今天</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section A: Today Plan (今日计划) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              今日计划
            </h2>
            <span className="text-xs font-mono text-stone-400">
              {completedCount} / {totalCount}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setAddSearch('');
                setAddModalOpen(true);
              }}
              disabled={saving}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 hover:bg-stone-100 dark:hover:bg-stone-900 text-stone-700 dark:text-stone-300 text-xs font-medium transition shadow-2xs disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-600" />
              <span>选择已有任务</span>
            </button>
          </div>
        </div>

        {/* Quick create and add bar */}
        <form onSubmit={handleQuickCreateAndAdd} className="flex items-center space-x-2">
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="新建任务并直接加入今日计划..."
            disabled={quickCreating || saving}
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 shadow-2xs"
          />
          <button
            type="submit"
            disabled={quickCreating || saving || !quickTitle.trim()}
            className="flex items-center space-x-1 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition disabled:opacity-40 shadow-2xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{quickCreating ? '创建中' : '新建并加入'}</span>
          </button>
        </form>

        {/* Plan Tasks List */}
        {planItems.length === 0 ? (
          <div className="py-12 text-center rounded-xl border border-dashed border-stone-200 dark:border-stone-800 bg-white/40 dark:bg-stone-950/20 text-xs text-stone-400 space-y-1">
            <Calendar className="w-8 h-8 text-stone-300 dark:text-stone-700 mx-auto" />
            <div className="font-medium text-stone-500 dark:text-stone-400">
              {isToday ? '今天还没有安排任务' : '该日期无计划安排'}
            </div>
            <div className="text-[11px] text-stone-400">
              从上方选择已有任务，或输入标题快速新建并加入
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {planItems.map(({ id, task, isDangling }, index) => {
              if (isDangling || !task) {
                // Dangling reference placeholder row
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between p-3 rounded-xl border border-rose-200/70 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 text-xs"
                  >
                    <div className="flex items-center space-x-2.5 text-rose-700 dark:text-rose-300 min-w-0">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                      <span className="font-mono text-[11px]">[已删除任务: {id}]</span>
                      <span className="text-[11px] text-stone-400">外部文件已失效</span>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setRemoveConfirmId(id)}
                        disabled={saving}
                        className="p-1 rounded text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition"
                        title="从计划中移除该失效项"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              }

              const isDone = task.status === TaskStatus.TaskStatusDone;
              const isDoing = task.status === TaskStatus.TaskStatusDoing;
              const validIndex = validPlanItems.findIndex((item) => item.id === task.id);
              const isFirst = validIndex === 0;
              const isLast = validIndex === validPlanItems.length - 1;

              // Due status
              let dueBadge: React.ReactNode = null;
              if (task.due && !isDone) {
                if (task.due < todayStr) {
                  dueBadge = (
                    <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300">
                      逾期 ({task.due})
                    </span>
                  );
                } else if (task.due === todayStr) {
                  dueBadge = (
                    <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                      今日到期
                    </span>
                  );
                } else {
                  dueBadge = (
                    <span className="text-[10px] text-stone-400">
                      due {task.due}
                    </span>
                  );
                }
              }

              return (
                <div
                  key={task.id}
                  className="group flex items-center justify-between p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-2xs hover:border-emerald-500/50 transition gap-3"
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    {/* Status Toggle Button */}
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(task)}
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
                      {task.title}
                    </span>

                    {/* Due Badge */}
                    {dueBadge}

                    {/* Tags */}
                    {task.tags && task.tags.length > 0 && (
                      <span className="hidden sm:inline-flex items-center gap-1">
                        {task.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1 py-0.2 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 font-mono"
                          >
                            #{tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    {/* Footnote for historical date */}
                    {!isToday && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500 font-normal">
                        当前状态
                      </span>
                    )}

                    {/* Priority Badge */}
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                        task.priority === 'p1'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300'
                          : task.priority === 'p2'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300'
                          : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
                      }`}
                    >
                      {task.priority.toUpperCase()}
                    </span>

                    {/* Reorder Buttons */}
                    <button
                      type="button"
                      onClick={() => handleMove(task.id, 'up')}
                      disabled={isFirst || saving}
                      className="p-1 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition disabled:opacity-20"
                      title="上移"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(task.id, 'down')}
                      disabled={isLast || saving}
                      className="p-1 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition disabled:opacity-20"
                      title="下移"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>

                    {/* Remove from Plan Button */}
                    <button
                      type="button"
                      onClick={() => setRemoveConfirmId(task.id)}
                      disabled={saving}
                      className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                      title="从今日计划移出"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-[11px] text-stone-400 leading-relaxed pt-1">
          提示：将任务加入今日计划仅作为当天的执行安排，不会改变任务的实际截止日期（due）。
        </div>
      </section>

      {/* Section B: Today Timeline (今日记录时间线) */}
      <section className="space-y-3 pt-5 border-t border-stone-200/80 dark:border-stone-800">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              {isToday ? '今日记录' : '当日记录'}
            </h2>
            <span className="text-xs font-mono text-stone-400">
              {timelineItems.length}
            </span>
          </div>
          <span className="text-[11px] text-stone-400">
            按发生时间汇聚便签与任务完成事件
          </span>
        </div>

        {/* Quick Memo Input Bar */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-1.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-2xs focus-within:ring-2 focus-within:ring-emerald-600 focus-within:border-transparent transition">
            <textarea
              value={quickMemoBody}
              onChange={(e) => setQuickMemoBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleCreateQuickMemo();
                }
              }}
              placeholder="记录一句话便签（⌘+Enter 快捷发送）..."
              rows={1}
              disabled={creatingMemo}
              className="flex-1 px-2.5 py-1 text-xs bg-transparent text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden resize-none min-h-[34px] max-h-32 leading-relaxed"
            />
            <button
              type="button"
              onClick={() => handleCreateQuickMemo()}
              disabled={creatingMemo || !quickMemoBody.trim()}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition disabled:opacity-40 shrink-0 shadow-2xs"
              title="发送便签 (⌘+Enter)"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{creatingMemo ? '发送中' : '发送'}</span>
            </button>
          </div>

          {!isToday && (
            <div className="text-[11px] text-stone-400 dark:text-stone-500 px-1">
              提示：记录将按当前时间记入今天
            </div>
          )}

          {memoError && (
            <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>便签保存失败: {memoError}</span>
              </div>
              <button
                type="button"
                onClick={() => setMemoError(null)}
                className="text-rose-600 hover:text-rose-800 p-0.5 rounded transition"
                title="关闭错误提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Timeline Items List */}
        {timelineItems.length === 0 ? (
          <div className="py-8 text-center rounded-xl border border-dashed border-stone-200 dark:border-stone-800 bg-white/40 dark:bg-stone-950/20 text-xs text-stone-400 space-y-1">
            <Clock className="w-7 h-7 text-stone-300 dark:text-stone-700 mx-auto" />
            <div className="font-medium text-stone-500 dark:text-stone-400">
              该日期暂无记录
            </div>
            <div className="text-[11px] text-stone-400">
              输入的便签与当日任务完成事件将在此按时间倒序展示
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {timelineItems.map((item, idx) => {
              const timeDisplay = formatTimelineTime(item.time);
              if (item.kind === 'completion') {
                return (
                  <div
                    key={`comp-${item.task_id}-${item.time}-${idx}`}
                    className="flex items-center justify-between p-3 rounded-xl border border-emerald-200/80 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20 text-xs gap-3"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-medium text-stone-900 dark:text-stone-100 shrink-0">
                        完成任务
                      </span>
                      {item.task_title ? (
                        <button
                          type="button"
                          onClick={() => item.task_id && onOpenTask?.(item.task_id)}
                          className="flex items-center space-x-1 px-2 py-0.5 rounded bg-emerald-100/80 dark:bg-emerald-900/60 hover:bg-emerald-200 dark:hover:bg-emerald-800/80 text-emerald-800 dark:text-emerald-200 text-[11px] font-medium transition truncate max-w-xs"
                          title="在 Tasks 中查看任务详情"
                        >
                          <span className="truncate">「{item.task_title}」</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                        </button>
                      ) : (
                        item.task_id && (
                          <span className="font-mono text-[11px] text-stone-400 truncate">
                            {item.task_id}
                          </span>
                        )
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-stone-400 shrink-0">
                      {timeDisplay}
                    </span>
                  </div>
                );
              }

              // Memo item
              return (
                <div
                  key={`memo-${item.memo?.id ?? idx}-${item.time}`}
                  className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-2xs space-y-2"
                >
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center space-x-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      {item.task_id ? (
                        item.task_title ? (
                          <button
                            type="button"
                            onClick={() => onOpenTask?.(item.task_id!)}
                            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 text-[11px] font-medium transition truncate max-w-xs"
                            title="关联任务，点击在 Tasks 中打开"
                          >
                            <span className="text-stone-400">任务:</span>
                            <span className="truncate font-semibold">{item.task_title}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                          </button>
                        ) : (
                          <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-stone-100/70 dark:bg-stone-800/50 text-stone-400 text-[11px] max-w-xs truncate font-mono">
                            <span className="truncate">{item.task_id}</span>
                            <span className="text-[10px] text-rose-500/80 shrink-0 font-normal">(任务已删除)</span>
                          </span>
                        )
                      ) : (
                        <span className="text-[11px] text-stone-400 font-mono">独立便签</span>
                      )}
                      {item.memo?.tags && item.memo.tags.length > 0 && (
                        <span className="hidden sm:inline-flex items-center gap-1">
                          {item.memo.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1 py-0.2 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 font-mono"
                            >
                              #{tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>

                    <span className="font-mono text-[11px] text-stone-400 shrink-0">
                      {timeDisplay}
                    </span>
                  </div>

                  <div className="text-xs text-stone-800 dark:text-stone-200 whitespace-pre-wrap break-words leading-relaxed pl-5.5">
                    {item.memo?.body}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Task Picker Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100 dark:border-stone-800">
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                选择任务加入计划
              </h3>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                placeholder="搜索任务标题或标签..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
            </div>

            {/* Available Task List */}
            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              {availableTasksToAdd.length === 0 ? (
                <div className="py-8 text-center text-xs text-stone-400">
                  {tasks.length === 0
                    ? '任务池为空'
                    : '没有可添加的任务（已全部加入或无匹配项）'}
                </div>
              ) : (
                availableTasksToAdd.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={async () => {
                      await handleAddExisting(t.id);
                      setAddModalOpen(false);
                    }}
                    className="w-full text-left p-2.5 rounded-lg border border-stone-100 dark:border-stone-800 hover:border-emerald-500/60 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 shrink-0">
                        {t.priority.toUpperCase()}
                      </span>
                      <span className="text-xs truncate text-stone-900 dark:text-stone-100">
                        {t.title}
                      </span>
                    </div>
                    <Plus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  </button>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-stone-100 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove from Plan Confirmation Modal */}
      {removeConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  确认移出今日计划？
                </h3>
                <p className="text-xs text-stone-500 leading-relaxed">
                  {taskMap.has(removeConfirmId)
                    ? `任务「${taskMap.get(removeConfirmId)?.title}」仅从当前日计划中移出，任务文件仍保留在 Tasks 任务池中。`
                    : `确认从日计划中清除该失效占位项（ID: ${removeConfirmId}）。`}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setRemoveConfirmId(null)}
                disabled={saving}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmRemove}
                disabled={saving}
                className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition disabled:opacity-50"
              >
                {saving ? '保存中...' : '确认移出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
