import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import * as VaultService from '../bindings/pata/vaultservice';
import { VaultStatus } from '../bindings/pata/models';
import { TasksView } from './TasksView';
import { TodayView } from './TodayView';
import { NotesView } from './NotesView';

export default function App() {
  const [activeNav, setActiveNav] = useState<'today' | 'tasks' | 'notes'>('tasks');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');

  // Vault state (single vault, D18)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);

  const handleOpenTask = (taskID: string) => {
    setActiveNav('tasks');
    setFocusTaskId(taskID);
  };

  const handleOpenNote = (noteID: string) => {
    setActiveNav('notes');
    setFocusNoteId(noteID);
  };

  const refreshVault = async () => {
    try {
      const st = await VaultService.GetVaultStatus();
      setVaultStatus(st);
    } catch (err) {
      console.error('Failed to refresh vault status:', err);
    }
  };

  // Fetch vault status on load
  useEffect(() => {
    refreshVault();
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
      // system
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  }, [themeMode]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 font-sans">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-stone-200 dark:border-stone-800 bg-stone-100/80 dark:bg-stone-950/80 backdrop-blur transition-all duration-200 select-none ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {/* Sidebar Header with traffic light offset */}
        <div className="h-12 flex items-center px-4 drag-region border-b border-stone-200/50 dark:border-stone-800/50">
          {!sidebarCollapsed ? (
            <div className="flex items-center space-x-2 pl-14">
              <span className="font-semibold text-sm tracking-tight text-emerald-800 dark:text-emerald-400">Pata 啪嗒</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-400">v0.1</span>
            </div>
          ) : (
            <div className="w-full flex justify-center pl-8">
              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
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
                <span className="text-[9px] text-stone-400 font-mono">3</span>
              </div>
              <div className="space-y-0.5 px-1">
                {['架构设计', 'Flink', 'Doris'].map((tag) => (
                  <div
                    key={tag}
                    className="flex items-center space-x-1.5 px-2 py-1 rounded text-xs text-stone-600 dark:text-stone-400 hover:bg-stone-200/40 dark:hover:bg-stone-800/40 cursor-default"
                  >
                    <Hash className="w-3 h-3 text-stone-400" />
                    <span>{tag}</span>
                  </div>
                ))}
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
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-1 rounded text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 no-drag-region"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            <h1 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
              {activeNav === 'today' && 'Today — 今日计划与记录'}
              {activeNav === 'tasks' && 'Tasks — 全量任务池'}
              {activeNav === 'notes' && 'Notes — 单列笔记'}
            </h1>
          </div>

          <div className="flex items-center space-x-2 no-drag-region">
            <div className="text-xs font-mono text-stone-400 dark:text-stone-500 bg-stone-100 dark:bg-stone-800/80 px-2 py-1 rounded border border-stone-200/60 dark:border-stone-700/60">
              macOS · Wails v3
            </div>
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
        </div>
      </main>
    </div>
  );
}
