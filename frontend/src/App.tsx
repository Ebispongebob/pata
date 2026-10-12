import { useState, useEffect, useCallback, useRef } from 'react';
import { Events } from '@wailsio/runtime';
import {
  Calendar,
  CheckSquare,
  FileText,
  Hash,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  Search,
  AlertTriangle,
  X,
} from 'lucide-react';
import * as VaultService from '../bindings/pata/vaultservice';
import { VaultStatus, VaultHealth } from '../bindings/pata/models';
import { TagOverviewItem } from '../bindings/pata/internal/storage/markdown/models';
import { TasksView } from './TasksView';
import { TodayView } from './TodayView';
import { NotesView } from './NotesView';
import { TagView } from './TagView';
import { SearchOverlay } from './SearchOverlay';

export default function App() {
  const [activeNav, setActiveNav] = useState<'today' | 'tasks' | 'notes' | 'tag'>('tasks');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');

  // Vault state (single vault, D18)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
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

  // Global search overlay state
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const handleOpenTask = (taskID: string) => {
    setActiveNav('tasks');
    setFocusTaskId(taskID);
  };

  const handleOpenNote = (noteID: string) => {
    setActiveNav('notes');
    setFocusNoteId(noteID);
  };

  const handleSelectTag = (tag: string) => {
    setSelectedTag(tag);
    setActiveNav('tag');
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
    try {
      await VaultService.RescanVault();
      await refreshVault();
    } catch (err: any) {
      console.error('Rescan failed:', err);
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

  const parseErrorCount = health?.parse_errors?.length ?? 0;
  const danglingRefCount = health?.dangling_refs?.length ?? 0;
  const hasHealthIssues = parseErrorCount > 0 || danglingRefCount > 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 font-sans">
      {/* Sidebar */}
      <aside
        style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
        className={`relative shrink-0 flex flex-col border-r border-stone-200 dark:border-stone-800 bg-stone-100/80 dark:bg-stone-950/80 backdrop-blur select-none ${
          isResizing ? '' : 'transition-all duration-200'
        } ${sidebarCollapsed ? 'w-20' : ''}`}
      >
        {/* Resize Handle (expanded only) */}
        {!sidebarCollapsed && (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onLostPointerCapture={handleLostPointerCapture}
            className={`absolute top-0 right-0 w-1 h-full cursor-col-resize no-drag-region hover:bg-emerald-500/40 transition-colors z-20 touch-none ${
              isResizing ? 'bg-emerald-500/50' : ''
            }`}
            title="拖拽调整侧边栏宽度"
          />
        )}

        {/* Sidebar Header with traffic light offset */}
        <div className="h-12 flex items-center px-4 drag-region border-b border-stone-200/50 dark:border-stone-800/50">
          {!sidebarCollapsed && (
            <div className="flex items-center space-x-2 pl-20">
              <span className="font-semibold text-sm tracking-tight text-emerald-800 dark:text-emerald-400">Pata 啪嗒</span>
            </div>
          )}
        </div>

        {/* Primary Navigation */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-stone-400 px-2 mb-1">
            {!sidebarCollapsed && '主视图'}
          </div>

          <button
            onClick={() => setActiveNav('today')}
            className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              activeNav === 'today'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
            title="Today"
          >
            <Calendar className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Today 今日</span>}
          </button>

          <button
            onClick={() => setActiveNav('tasks')}
            className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              activeNav === 'tasks'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
            title="Tasks"
          >
            <CheckSquare className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Tasks 任务</span>}
          </button>

          <button
            onClick={() => setActiveNav('notes')}
            className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              activeNav === 'notes'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
            title="Notes"
          >
            <FileText className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Notes 笔记</span>}
          </button>

          {/* Tags section */}
          {!sidebarCollapsed && (
            <div className="pt-4">
              <div className="text-[10px] uppercase font-semibold text-stone-400 px-2 mb-1.5 flex items-center justify-between">
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

        {/* Sidebar Footer */}
        <div className="p-2 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between no-drag-region">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200 dark:hover:bg-stone-800 transition"
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {!sidebarCollapsed && (
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
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-stone-50 dark:bg-stone-900">
        {/* Top Header / Draggable Toolbar */}
        <header className="h-12 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between px-4 drag-region select-none shrink-0">
          <div className="flex items-center space-x-3">
            <h1 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
              {activeNav === 'today' && 'Today — 今日计划与记录'}
              {activeNav === 'tasks' && 'Tasks — 全量任务池'}
              {activeNav === 'notes' && 'Notes — 单列笔记'}
              {activeNav === 'tag' && `#${selectedTag || '标签视图'}`}
            </h1>
          </div>

          <div className="flex items-center space-x-2 no-drag-region">
            {hasHealthIssues && (
              <button
                onClick={() => {
                  healthTriggerRef.current = document.activeElement as HTMLElement | null;
                  setShowHealthModal(true);
                }}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800/80 hover:bg-amber-200/80 dark:hover:bg-amber-900/60 transition cursor-pointer"
                title="Vault 健康异常提示"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  {parseErrorCount > 0 && `${parseErrorCount} 个文件未识别`}
                  {parseErrorCount > 0 && danglingRefCount > 0 && ' · '}
                  {danglingRefCount > 0 && `${danglingRefCount} 个引用悬空`}
                </span>
              </button>
            )}

            <button
              onClick={() => setIsSearchOpen(true)}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 border border-stone-200 dark:border-stone-800 transition cursor-pointer"
              title="全局搜索 (⌘K / ⌘P)"
            >
              <Search className="w-3.5 h-3.5 opacity-70" />
              <span>搜索</span>
              <kbd className="text-[10px] font-mono opacity-60 bg-stone-200/60 dark:bg-stone-800 px-1 py-0.2 rounded">
                ⌘K
              </kbd>
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeNav === 'today' && (
            <TodayView
              vaultStatus={vaultStatus}
              onSelectVault={handleSelectVault}
              onRescanVault={handleRescan}
              vaultBusy={vaultBusy}
              onOpenTask={handleOpenTask}
            />
          )}

          {activeNav === 'tasks' && (
            <TasksView
              vaultStatus={vaultStatus}
              onSelectVault={handleSelectVault}
              onRescanVault={handleRescan}
              vaultBusy={vaultBusy}
              focusTaskId={focusTaskId}
              onClearFocusTask={() => setFocusTaskId(null)}
              onOpenNote={handleOpenNote}
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
            />
          )}

          {activeNav === 'tag' && (
            <TagView
              selectedTag={selectedTag}
              onOpenTask={handleOpenTask}
              onOpenNote={handleOpenNote}
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
