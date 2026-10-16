import { useState, useEffect, useCallback, useRef } from 'react';
import { Events } from '@wailsio/runtime';
import {
  Calendar,
  CheckSquare,
  FileText,
  Hash,
  Sun,
  Moon,
  Monitor,
  Search,
  AlertTriangle,
  X,
  FolderOpen,
  RefreshCw,
} from 'lucide-react';
import * as VaultService from '../bindings/pata/vaultservice';
import { VaultStatus, VaultHealth } from '../bindings/pata/models';
import { TagOverviewItem } from '../bindings/pata/internal/storage/markdown/models';
import { TasksView } from './TasksView';
import { TodayView } from './TodayView';
import { NotesView } from './NotesView';
import { TagView } from './TagView';
import { SearchOverlay } from './SearchOverlay';
import { PataLogo } from './components/PataLogo';
import { registerTitlebarLogo, playLogoLaunch } from './logoAnimation';

export default function App() {
  const titlebarLogoRef = useRef<SVGSVGElement | null>(null);
  const [activeNav, setActiveNav] = useState<'today' | 'tasks' | 'notes' | 'tag'>('today');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sidebarCollapsed] = useState(false); // 侧栏恒展开，收起功能按走查反馈移除
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [, setIsResizing] = useState(false); // 手柄无高亮，仅保留状态位供拖拽逻辑判断扩展
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');

  // Vault state (single vault, D18)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);

  // Global tags state
  const [tags, setTags] = useState<TagOverviewItem[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);

  // Vault health state
  const [health, setHealth] = useState<VaultHealth | null>(null);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const healthTriggerRef = useRef<HTMLElement | null>(null);
  const healthModalRef = useRef<HTMLDivElement>(null);

  // Manage focus movement and restoration for health modal
  useEffect(() => {
    if (showHealthModal) {
      healthTriggerRef.current = document.activeElement as HTMLElement | null;
      const timer = setTimeout(() => {
        healthModalRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      if (healthTriggerRef.current && typeof healthTriggerRef.current.focus === 'function') {
        healthTriggerRef.current.focus();
        healthTriggerRef.current = null;
      }
    }
  }, [showHealthModal]);

  // Titlebar logo initialization: play launch animation once on initial app ready
  useEffect(() => {
    const unregister = registerTitlebarLogo(titlebarLogoRef.current);
    playLogoLaunch();
    return () => {
      unregister();
    };
  }, []);

  // Global search overlay state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);

  useEffect(() => {
    if (activeNav !== 'notes') {
      setIsEditingNote(false);
    }
  }, [activeNav]);

  // 当前页面登记的离开前确认（任务详情有未保存草稿时返回 false 表示取消离开）
  const leaveGuardRef = useRef<(() => Promise<boolean>) | null>(null);
  const guarded = async (go: () => void) => {
    if (leaveGuardRef.current && !(await leaveGuardRef.current())) return;
    go();
  };
  const goNav = (nav: 'today' | 'tasks' | 'notes') => {
    if (nav !== activeNav) void guarded(() => setActiveNav(nav));
  };

  const handleOpenTask = (taskID: string) => {
    const go = () => {
      setActiveNav('tasks');
      setFocusTaskId(taskID);
    };
    // 已在 Tasks 时由其详情面板自行确认草稿，避免重复提示
    if (activeNav === 'tasks') go();
    else void guarded(go);
  };

  // 从任务详情打开笔记时记录来源，笔记页「返回」回到该任务
  const [noteOrigin, setNoteOrigin] = useState<{ nav: 'today' | 'tasks' | 'tag'; taskId: string } | null>(null);
  const [todayTaskId, setTodayTaskId] = useState<string | null>(null);
  const [todayDate, setTodayDate] = useState<string | null>(null);
  const [tagTaskId, setTagTaskId] = useState<string | null>(null);

  const handleOpenTodayDate = (date: string) => {
    void guarded(() => {
      setSelectedTag(null);
      setTodayDate(date);
      setActiveNav('today');
    });
  };

  const handleOpenNote = (noteID: string, fromTaskId?: string) => {
    void guarded(() => {
      setNoteOrigin(fromTaskId && (activeNav === 'today' || activeNav === 'tasks' || activeNav === 'tag') ? { nav: activeNav, taskId: fromTaskId } : null);
      setActiveNav('notes');
      setFocusNoteId(noteID);
    });
  };
  const returnToOrigin = () => {
    if (!noteOrigin) return;
    setActiveNav(noteOrigin.nav);
    if (noteOrigin.nav === 'tasks') setFocusTaskId(noteOrigin.taskId);
    else if (noteOrigin.nav === 'today') setTodayTaskId(noteOrigin.taskId);
    else if (noteOrigin.nav === 'tag') setTagTaskId(noteOrigin.taskId);
    setNoteOrigin(null);
  };

  const handleSelectTag = (tag: string) => {
    void guarded(() => {
      setSelectedTag(tag);
      setActiveNav('tag');
    });
  };

  const loadTags = useCallback(async () => {
    try {
      setTagsLoading(true);
      const items = await VaultService.GetTagOverview();
      setTags((items || []).filter((it): it is TagOverviewItem => it !== null));
    } catch (err) {
      console.error('Failed to load tag overview:', err);
    } finally {
      setTagsLoading(false);
    }
  }, []);

  const refreshVault = useCallback(async () => {
    try {
      const st = await VaultService.GetVaultStatus();
      setVaultStatus(st);
      if (st && st.open) {
        await loadTags();
        try {
          const h = await VaultService.GetVaultHealth();
          setHealth(h);
        } catch (err) {
          console.error('Failed to get vault health:', err);
          setHealth(null);
        }
      } else {
        setTags([]);
        setHealth(null);
      }
    } catch (err) {
      console.error('Failed to refresh vault status:', err);
    }
  }, [loadTags]);

  // Fetch vault status on load
  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  // Subscribe to vault:changed application events
  useEffect(() => {
    const unsubscribe = Events.On('vault:changed', () => {
      refreshVault();
    });

    return () => {
      unsubscribe();
    };
  }, [refreshVault]);

  // Global keyboard shortcut for search (⌘K / ⌘P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest?.('.vditor')) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'p' || e.key === 'K' || e.key === 'P')) {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSelectVault = async () => {
    setVaultBusy(true);
    try {
      await VaultService.SelectVaultDirectory();
      await refreshVault();
    } catch (err: any) {
      console.error('Select vault failed:', err);
    } finally {
      setVaultBusy(false);
    }
  };

  const handleRescan = async () => {
    setVaultBusy(true);
    setRescanError(null);
    try {
      await VaultService.RescanVault();
      await refreshVault();
    } catch (err: any) {
      console.error('Rescan failed:', err);
      setRescanError(err?.message || String(err));
    } finally {
      setVaultBusy(false);
    }
  };

  // Theme application
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'dark') {
      root.classList.add('dark');
    } else if (themeMode === 'light') {
      root.classList.remove('dark');
    } else {
      // system: dynamically listen to system dark mode preference
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const applySystemTheme = () => {
        if (mediaQuery.matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      };
      applySystemTheme();
      mediaQuery.addEventListener('change', applySystemTheme);
      return () => {
        mediaQuery.removeEventListener('change', applySystemTheme);
      };
    }
  }, [themeMode]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const newWidth = Math.min(Math.max(e.clientX, 200), 360);
    setSidebarWidth(newWidth);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if already released by browser
      }
    }
    setIsResizing(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  const handleLostPointerCapture = () => {
    setIsResizing(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  const tagNames = tags.map((t) => t.tag);
  const parseErrorCount = health?.parse_errors?.length ?? 0;
  const danglingRefCount = health?.dangling_refs?.length ?? 0;
  const hasHealthIssues = parseErrorCount > 0 || danglingRefCount > 0;

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-stone-100/60 dark:bg-transparent text-stone-900 dark:text-stone-100 font-sans">
      {/* 4px top edge guard: prevents native window resize from triggering wails:drag */}
      <div className="absolute top-0 left-0 right-0 h-1 no-drag-region z-30 pointer-events-auto" />

      {/* Left column: lights+logo strip above sidebar, unified background */}
      <div
        style={{ width: `${sidebarWidth}px` }}
        className="relative shrink-0 flex flex-col bg-stone-100/80 dark:bg-stone-950/80 backdrop-blur select-none"
      >
        <div className="h-[52px] shrink-0 drag-region flex items-center pl-[84px] gap-2 select-none">
          <PataLogo ref={titlebarLogoRef} className="w-6 h-6 shrink-0" />
          <span className="text-sm font-medium text-stone-600 dark:text-stone-300">Pata</span>
        </div>

      {/* Sidebar */}
      <aside
        className="relative flex flex-col flex-1 min-h-0"
      >
        {/* Resize Handle (expanded only) */}
        {!sidebarCollapsed && (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onLostPointerCapture={handleLostPointerCapture}
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize no-drag-region z-20 touch-none"
            title="拖拽调整侧边栏宽度"
          />
        )}

        {/* Primary Navigation */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {/* Quick Search */}
          <button
            onClick={() => setIsSearchOpen(true)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 mb-2 rounded-md text-xs text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 border border-stone-200/80 dark:border-stone-800/80 bg-stone-50/70 dark:bg-stone-900/50 transition-colors shadow-2xs cursor-pointer group"
            title="全局搜索 (⌘K / ⌘P)"
          >
            <div className="flex items-center space-x-2 truncate">
              <Search className="w-3.5 h-3.5 shrink-0 opacity-70 group-hover:opacity-100" />
              {!sidebarCollapsed && <span>搜索</span>}
            </div>
            {!sidebarCollapsed && (
              <kbd className="text-[10px] font-mono opacity-60 bg-stone-200/80 dark:bg-stone-800 px-1 py-0.2 rounded shrink-0">
                ⌘K
              </kbd>
            )}
          </button>

          <button
            onClick={() => goNav('today')}
            className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              activeNav === 'today'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
            title="Today"
          >
            <Calendar className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Today</span>}
          </button>

          <button
            onClick={() => goNav('tasks')}
            className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              activeNav === 'tasks'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
            title="Tasks"
          >
            <CheckSquare className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Tasks</span>}
          </button>

          <button
            onClick={() => goNav('notes')}
            className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              activeNav === 'notes'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
            title="Notes"
          >
            <FileText className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Notes</span>}
          </button>

          {/* Tags section */}
          {!sidebarCollapsed && (
            <div className="pt-3">
              <div className="text-[10px] uppercase font-semibold text-stone-400 px-2 mb-1 flex items-center justify-between">
                <span>全局标签</span>
                {vaultStatus?.open && (
                  <span className="text-[9px] text-stone-400 font-mono">{tags.length}</span>
                )}
              </div>
              <div className="space-y-0.5 px-1">
                {!vaultStatus?.open ? (
                  <div className="px-2 py-1.5 text-xs text-stone-400 italic">Vault 尚未打开</div>
                ) : tagsLoading && tags.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-stone-400">加载标签...</div>
                ) : tags.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-stone-400 italic">暂无标签</div>
                ) : (
                  tags.map((item) => (
                    <button
                      key={item.tag}
                      onClick={() => handleSelectTag(item.tag)}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors min-h-[32px] text-left cursor-pointer ${
                        activeNav === 'tag' && selectedTag === item.tag
                          ? 'bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 font-medium'
                          : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/50 dark:hover:bg-stone-800/50'
                      }`}
                      title={`#${item.tag} (共 ${item.total} 项)`}
                    >
                      <div className="flex items-center space-x-1.5 truncate mr-2">
                        <Hash className="w-3.5 h-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{item.tag}</span>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-500 dark:text-stone-400 shrink-0">
                        {item.total}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Footer: vault menu + theme switcher */}
        {!sidebarCollapsed && (
          <div className="relative p-2 flex items-center justify-between no-drag-region">
            {vaultStatus?.configured ? (
              <button
                onClick={() => setVaultMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={vaultMenuOpen}
                className="relative flex items-center space-x-1.5 min-w-0 px-2 py-1.5 rounded-md text-xs text-stone-500 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition cursor-pointer"
                title={vaultStatus.path}
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[110px]">{vaultStatus.path.split('/').filter(Boolean).pop() || vaultStatus.path}</span>
                {(rescanError || !vaultStatus.open || hasHealthIssues) && (
                  <span className={`absolute top-1 left-1 w-1.5 h-1.5 rounded-full ${hasHealthIssues && !rescanError && vaultStatus.open ? 'bg-amber-500' : 'bg-rose-500'}`} />
                )}
              </button>
            ) : (
              <span />
            )}
            {hasHealthIssues && (
              <button
                onClick={() => {
                  healthTriggerRef.current = document.activeElement as HTMLElement | null;
                  setShowHealthModal(true);
                }}
                className="flex items-center space-x-1 px-1.5 py-1 rounded text-xs font-medium bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800/80 hover:bg-amber-200/80 dark:hover:bg-amber-900/60 transition cursor-pointer shrink-0"
                title="Vault 健康异常提示"
              >
                <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                {!sidebarCollapsed && <span>{parseErrorCount + danglingRefCount}</span>}
              </button>
            )}
            {vaultMenuOpen && vaultStatus?.configured && (
              <>
              <div className="fixed inset-0 z-20" onMouseDown={() => setVaultMenuOpen(false)} />
              <div
                role="menu"
                className="pata-pop absolute left-2 right-2 bottom-full mb-1 z-30 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-lg p-3 space-y-2 text-xs"
                onKeyDown={(e) => e.key === 'Escape' && setVaultMenuOpen(false)}
              >
                <div className="font-mono text-[11px] break-all text-stone-600 dark:text-stone-300">{vaultStatus.path}</div>
                {!vaultStatus.open && <div className="text-rose-600 dark:text-rose-400">Vault 无法打开，请重新选择目录</div>}
                {rescanError && <div className="text-rose-600 dark:text-rose-400 break-all">重新扫描失败: {rescanError}</div>}
                {hasHealthIssues && (
                  <button
                    onClick={() => {
                      setVaultMenuOpen(false);
                      setShowHealthModal(true);
                    }}
                    className="text-amber-700 dark:text-amber-400 hover:underline"
                  >
                    查看 {parseErrorCount + danglingRefCount} 项健康提示
                  </button>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleRescan}
                    disabled={vaultBusy}
                    className="flex items-center space-x-1 px-2 py-1 rounded border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-50"
                    title="从磁盘重新扫描 Markdown 索引"
                  >
                    <RefreshCw className={`w-3 h-3 ${vaultBusy ? 'animate-spin' : ''}`} />
                    <span>重新扫描</span>
                  </button>
                  <button
                    onClick={handleSelectVault}
                    disabled={vaultBusy}
                    className="px-2 py-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-50"
                  >
                    更换目录
                  </button>
                </div>
              </div>
              </>
            )}
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setThemeMode('light')}
                className={`p-1.5 rounded transition ${themeMode === 'light' ? 'bg-stone-200 dark:bg-stone-800 text-amber-600' : 'text-stone-400'}`}
                title="浅色模式"
              >
                <Sun className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setThemeMode('dark')}
                className={`p-1.5 rounded transition ${themeMode === 'dark' ? 'bg-stone-200 dark:bg-stone-800 text-blue-400' : 'text-stone-400'}`}
                title="深色模式"
              >
                <Moon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setThemeMode('system')}
                className={`p-1.5 rounded transition ${themeMode === 'system' ? 'bg-stone-200 dark:bg-stone-800 text-emerald-600' : 'text-stone-400'}`}
                title="跟随系统"
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </aside>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden rounded-2xl border border-stone-200/70 dark:border-stone-800/70 shadow-xs bg-stone-50 dark:bg-stone-900 mt-2 mr-2 mb-2">

        {/* Content Body */}
        <div
          className={
            activeNav === 'today' || activeNav === 'tasks' || activeNav === 'tag' || (activeNav === 'notes' && isEditingNote)
              ? 'flex-1 min-h-0 overflow-hidden' // 三栏或编辑页：内部自适应高度
              : 'flex-1 overflow-y-auto p-6'
          }
        >
          {activeNav === 'today' && (
            <TodayView
              vaultStatus={vaultStatus}
              onSelectVault={handleSelectVault}
              vaultBusy={vaultBusy}
              onOpenNote={handleOpenNote}
              initialTaskId={todayTaskId}
              onInitialTaskConsumed={() => setTodayTaskId(null)}
              initialDate={todayDate}
              onInitialDateConsumed={() => setTodayDate(null)}
              tagNames={tagNames}
              onVaultDataChanged={refreshVault}
              leaveGuardRef={leaveGuardRef}
            />
          )}

          {activeNav === 'tasks' && (
            <TasksView
              vaultStatus={vaultStatus}
              onSelectVault={handleSelectVault}
              vaultBusy={vaultBusy}
              focusTaskId={focusTaskId}
              onClearFocusTask={() => setFocusTaskId(null)}
              onOpenNote={handleOpenNote}
              tagNames={tagNames}
              onVaultDataChanged={refreshVault}
              leaveGuardRef={leaveGuardRef}
            />
          )}

          {activeNav === 'notes' && (
            <NotesView
              vaultStatus={vaultStatus}
              onSelectVault={handleSelectVault}
              onRescanVault={handleRescan}
              vaultBusy={vaultBusy}
              focusNoteId={focusNoteId}
              onClearFocusNote={() => setFocusNoteId(null)}
              returnToTask={noteOrigin ? { label: '返回任务', go: returnToOrigin } : null}
              onOpenTask={handleOpenTask}
              onEditingChange={setIsEditingNote}
            />
          )}

          {activeNav === 'tag' && (
            <TagView
              selectedTag={selectedTag}
              onOpenNote={handleOpenNote}
              initialTaskId={tagTaskId}
              onInitialTaskConsumed={() => setTagTaskId(null)}
              tagNames={tagNames}
              onVaultDataChanged={refreshVault}
              leaveGuardRef={leaveGuardRef}
            />
          )}
        </div>
      </main>

      {/* Global Quick Search Overlay */}
      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onOpenTask={handleOpenTask}
        onOpenNote={handleOpenNote}
        onOpenTodayDate={handleOpenTodayDate}
        vaultOpen={vaultStatus?.open}
      />

      {/* Vault Health Detail Modal */}
      {showHealthModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Vault 健康与降级状态"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 dark:bg-black/60 backdrop-blur-xs select-none"
          onClick={() => setShowHealthModal(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowHealthModal(false);
          }}
        >
          <div
            ref={healthModalRef}
            tabIndex={-1}
            className="w-full max-w-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] text-stone-900 dark:text-stone-100 outline-none"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setShowHealthModal(false);
              } else if (e.key === 'Tab') {
                const focusable = healthModalRef.current?.querySelectorAll<HTMLElement>(
                  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (focusable && focusable.length > 0) {
                  const first = focusable[0];
                  const last = focusable[focusable.length - 1];
                  if (e.shiftKey) {
                    if (document.activeElement === first || document.activeElement === healthModalRef.current) {
                      e.preventDefault();
                      last.focus();
                    }
                  } else {
                    if (document.activeElement === last) {
                      e.preventDefault();
                      first.focus();
                    }
                  }
                }
              }
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-800">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  Vault 降级状态与异常诊断
                </h2>
              </div>
              <button
                onClick={() => setShowHealthModal(false)}
                className="p-1 rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {parseErrorCount > 0 && (
                <div className="space-y-2">
                  <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center justify-between">
                    <span>文件未识别 (解析失败，已隔离保护)</span>
                    <span className="font-mono text-[11px] bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 rounded">
                      {parseErrorCount}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {health?.parse_errors?.map((pe, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30"
                      >
                        <div className="font-mono text-[11px] text-stone-800 dark:text-stone-200 break-all">
                          {pe.path}
                        </div>
                        <div className="text-stone-600 dark:text-stone-400 mt-1">
                          {pe.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {danglingRefCount > 0 && (
                <div className="space-y-2">
                  <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center justify-between">
                    <span>引用悬空 (关联目标缺失，动态降级)</span>
                    <span className="font-mono text-[11px] bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 rounded">
                      {danglingRefCount}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {health?.dangling_refs?.map((dr, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-100/50 dark:bg-stone-800/40"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-stone-800 dark:text-stone-200">
                            [{dr.source_type}:{dr.source_id}] 关联缺失的 {dr.target_type} ({dr.target_id})
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-stone-400 mt-0.5 break-all">
                          来源文件: {dr.source_path}
                        </div>
                        <div className="text-stone-600 dark:text-stone-400 mt-1">
                          {dr.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-2.5 rounded-lg bg-stone-100 dark:bg-stone-800/60 text-stone-500 dark:text-stone-400 text-[11px] leading-relaxed">
                ℹ️ 依据 Pata Local First 规范，异常或未识别文件会被独立隔离保护，不会被程序静默覆盖或删除。在外部编辑器纠正 Frontmatter 或恢复关联后，系统将自动自愈并恢复索引。
              </div>
            </div>

            <div className="px-4 py-2.5 border-t border-stone-200 dark:border-stone-800 flex justify-end bg-stone-100/60 dark:bg-stone-950/60">
              <button
                onClick={() => setShowHealthModal(false)}
                className="px-3 py-1.5 rounded-md bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 text-xs font-medium transition cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
