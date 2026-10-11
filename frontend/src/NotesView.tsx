import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Events } from '@wailsio/runtime';
import {
  FileText,
  Plus,
  Search,
  X,
  AlertCircle,
  RefreshCw,
  FolderOpen,
  ArrowLeft,
  Info,
} from 'lucide-react';
import * as VaultService from '../bindings/pata/vaultservice';
import { Note } from '../bindings/pata/internal/storage/markdown/models';
import { VaultStatus, CreateNoteInput } from '../bindings/pata/models';

interface NotesViewProps {
  vaultStatus: VaultStatus | null;
  onSelectVault: () => void;
  onRescanVault: () => void;
  vaultBusy?: boolean;
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

function getNoteExcerpt(title: string, body?: string): string {
  if (!body) return '';
  const lines = body.split('\n');
  let startIdx = 0;
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    if (firstLine.startsWith('#')) {
      const headingText = firstLine.replace(/^#+\s*/, '').trim();
      if (headingText.toLowerCase() === title.trim().toLowerCase()) {
        startIdx = 1;
      }
    }
  }
  const remaining = lines.slice(startIdx).join(' ');
  const cleaned = remaining
    .replace(/[#*`>_~\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

export function NotesView({
  vaultStatus,
  onSelectVault,
  onRescanVault,
  vaultBusy = false,
}: NotesViewProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Modal / Create state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newBody, setNewBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [rescanLoading, setRescanLoading] = useState(false);

  // Load notes
  const loadNotes = useCallback(async () => {
    if (!vaultStatus?.open) {
      setNotes([]);
      setListError(null);
      return;
    }
    setLoading(true);
    setListError(null);
    try {
      const result = await VaultService.ListNotes();
      const validNotes = (result ?? []).filter((n): n is Note => n !== null);
      setNotes(validNotes);
    } catch (err: any) {
      console.error('Failed to list notes:', err);
      setListError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [vaultStatus?.open]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Subscribe to external vault changes
  useEffect(() => {
    const unsubscribe = Events.On('vault:changed', () => {
      loadNotes();
    });
    return () => {
      unsubscribe();
    };
  }, [loadNotes]);

  const handleRescan = async () => {
    setRescanLoading(true);
    setListError(null);
    try {
      await VaultService.RescanVault();
      if (onRescanVault) {
        onRescanVault();
      }
      await loadNotes();
    } catch (err: any) {
      console.error('Failed to rescan vault:', err);
      setListError(`重新扫描失败: ${err?.message || err}`);
    } finally {
      setRescanLoading(false);
    }
  };

  // Find currently selected note
  const selectedNote = useMemo(() => {
    if (!selectedNoteId) return null;
    return notes.find((n) => n.id === selectedNoteId) ?? null;
  }, [notes, selectedNoteId]);

  // Filter notes by title, body, and tags (case-insensitive)
  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => {
      const titleMatch = (n.title ?? '').toLowerCase().includes(q);
      const bodyMatch = (n.body ?? '').toLowerCase().includes(q);
      const tagMatch = (n.tags ?? []).some((t) => t.toLowerCase().includes(q));
      return titleMatch || bodyMatch || tagMatch;
    });
  }, [notes, searchQuery]);

  // Create note handler
  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      setCreateError('笔记标题不能为空');
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const parsedTags = newTags
        .split(/[,，]/)
        .map((t) => t.trim().replace(/^#+/, ''))
        .filter((t) => t.length > 0);

      const input: CreateNoteInput = {
        title,
        tags: parsedTags,
        body: newBody,
      };

      const created = await VaultService.CreateNote(input);
      setNewTitle('');
      setNewTags('');
      setNewBody('');
      setCreateModalOpen(false);
      await loadNotes();

      if (created) {
        // Enters placeholder detail before next batch editor
        setSelectedNoteId(created.id);
      }
    } catch (err: any) {
      console.error('Failed to create note:', err);
      setCreateError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  };

  // Fold duplicate # Title in display body (display layer collapse only, does not alter source data)
  const displayBody = useMemo(() => {
    if (!selectedNote?.body) return '';
    const lines = selectedNote.body.split('\n');
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      if (firstLine.startsWith('#')) {
        const headingText = firstLine.replace(/^#+\s*/, '').trim();
        if (headingText.toLowerCase() === selectedNote.title.trim().toLowerCase()) {
          return lines.slice(1).join('\n').trim();
        }
      }
    }
    return selectedNote.body;
  }, [selectedNote]);

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

  // Read-only Note Detail View (replaces main area in single-column style, no textarea editing / no Vditor)
  if (selectedNote) {
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Navigation & Header Top Bar */}
        <div className="flex items-center justify-between pb-3 border-b border-stone-200 dark:border-stone-800">
          <button
            type="button"
            onClick={() => setSelectedNoteId(null)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回笔记列表</span>
          </button>

          <span className="text-[11px] font-mono text-stone-400 dark:text-stone-500">
            {selectedNote.id}
          </span>
        </div>

        {/* Next Batch Editor Placeholder Notice Banner */}
        <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 text-xs flex items-center space-x-2.5 shadow-2xs">
          <Info className="w-4 h-4 text-emerald-600 shrink-0" />
          <div className="leading-relaxed">
            <span className="font-semibold">当前为只读预览</span>
            <span className="text-stone-500 dark:text-stone-400 ml-1.5">
              （编辑器将在下一批集成，本批专注服务层与单列浏览）
            </span>
          </div>
        </div>

        {/* Note Article Details */}
        <div className="p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-2xs space-y-4">
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100 break-words tracking-tight">
              {selectedNote.title}
            </h1>

            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400 pt-1">
              {selectedNote.tags && selectedNote.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedNote.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-md bg-stone-100 dark:bg-stone-800 text-emerald-800 dark:text-emerald-300 font-mono font-medium"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              <span className="text-[11px] font-mono text-stone-400">
                修改于 {formatRelativeTime(selectedNote.updated_at)}
              </span>
            </div>
          </div>

          <div className="pt-4 border-t border-stone-100 dark:border-stone-800/80">
            {displayBody ? (
              <div className="text-xs text-stone-800 dark:text-stone-200 whitespace-pre-wrap leading-relaxed font-sans break-words">
                {displayBody}
              </div>
            ) : (
              <div className="text-xs text-stone-400 dark:text-stone-500 italic py-4 text-center">
                （正文内容为空）
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Single-column Flomo-style Card List View
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

      {/* Top Search Bar & Create Button */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索笔记标题、内容或标签..."
            className="w-full pl-8 pr-8 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 shadow-2xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              title="清除搜索"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setCreateModalOpen(true);
          }}
          className="flex items-center space-x-1 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition shadow-2xs shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新建笔记</span>
        </button>
      </div>

      {/* Error Feedback Banner */}
      {listError && (
        <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>加载笔记列表失败: {listError}</span>
        </div>
      )}

      {/* Section Header */}
      <div className="flex items-center justify-between text-xs text-stone-500 pt-1">
        <div className="flex items-center space-x-2">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            最近修改
          </h2>
          <span className="text-xs font-mono text-stone-400">
            {filteredNotes.length}
          </span>
          {loading && <span className="text-[11px] text-stone-400">加载中...</span>}
        </div>
        <span className="text-[11px] text-stone-400">
          Flomo 式单列卡片浏览 · 无嵌套侧栏
        </span>
      </div>

      {/* Single-column Card Stack */}
      {filteredNotes.length === 0 ? (
        <div className="py-16 text-center rounded-xl border border-dashed border-stone-200 dark:border-stone-800 bg-white/40 dark:bg-stone-950/20 text-xs text-stone-400 space-y-2">
          <FileText className="w-8 h-8 text-stone-300 dark:text-stone-700 mx-auto" />
          {notes.length === 0 ? (
            loading ? (
              <div className="font-medium text-stone-600 dark:text-stone-300">
                加载中...
              </div>
            ) : (
              <>
                <div className="font-medium text-stone-600 dark:text-stone-300">
                  Vault 中暂无笔记
                </div>
                <div className="text-[11px] text-stone-400 max-w-xs mx-auto">
                  点击右上角「新建笔记」写下第一篇长文或记录吧，写 Note 无须建 Task
                </div>
              </>
            )
          ) : (
            <div className="font-medium text-stone-500 dark:text-stone-400">
              未搜索到匹配的笔记
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotes.map((n) => {
            const excerpt = getNoteExcerpt(n.title, n.body);
            const relativeTime = formatRelativeTime(n.updated_at);

            return (
              <div
                key={n.id}
                onClick={() => setSelectedNoteId(n.id)}
                className="group p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 hover:border-emerald-500/60 dark:hover:border-emerald-600/60 hover:shadow-2xs transition cursor-pointer select-none space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 group-hover:text-emerald-800 dark:group-hover:text-emerald-400 transition truncate">
                    {n.title}
                  </h3>
                  <span className="font-mono text-[11px] text-stone-400 shrink-0">
                    {relativeTime}
                  </span>
                </div>

                {excerpt ? (
                  <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 leading-relaxed break-words font-sans">
                    {excerpt}
                  </p>
                ) : (
                  <p className="text-xs text-stone-400/80 dark:text-stone-600 italic">
                    暂无正文描述
                  </p>
                )}

                {n.tags && n.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {n.tags.map((tag) => (
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
            );
          })}
        </div>
      )}

      {/* Create Note Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100 dark:border-stone-800">
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                新建笔记
              </h3>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateNote} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-stone-500 mb-1">
                  笔记标题 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="输入笔记标题..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-500 mb-1">
                  标签（可选，逗号分隔）
                </label>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="例如: 架构设计, ADR, 总结"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-500 mb-1">
                  初始正文（可选，Markdown）
                </label>
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="可预先填入正文，也可稍后在编辑器中书写..."
                  rows={4}
                  className="w-full p-2.5 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-600 resize-none font-sans"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-stone-100 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={creating}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating || !newTitle.trim()}
                  className="px-3.5 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition disabled:opacity-40"
                >
                  {creating ? '创建中...' : '创建笔记'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
