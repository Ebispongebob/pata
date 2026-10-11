import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  Loader2,
  Check,
  Copy,
} from 'lucide-react';
import Vditor from 'vditor';
import * as VaultService from '../bindings/pata/vaultservice';
import { Note } from '../bindings/pata/internal/storage/markdown/models';
import { VaultStatus, CreateNoteInput, UpdateNoteInput } from '../bindings/pata/models';

interface NotesViewProps {
  vaultStatus: VaultStatus | null;
  onSelectVault: () => void;
  onRescanVault: () => void;
  vaultBusy?: boolean;
  focusNoteId?: string | null;
  onClearFocusNote?: () => void;
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

function parseTags(tagStr: string): string[] {
  return tagStr
    .split(/[,，]/)
    .map((t) => t.trim().replace(/^#+/, ''))
    .filter((t) => t.length > 0);
}

interface NoteEditorProps {
  noteId: string;
  onBack: () => void;
  onNoteUpdated: () => void;
}

function NoteEditor({ noteId, onBack, onNoteUpdated }: NoteEditorProps) {
  const [initialNote, setInitialNote] = useState<Note | null>(null);
  const [loadingNote, setLoadingNote] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState<string>('');
  const [editTags, setEditTags] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'conflict'>('saved');
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  const [showReloadConfirm, setShowReloadConfirm] = useState<boolean>(false);
  const [showLeaveConflictConfirm, setShowLeaveConflictConfirm] = useState<boolean>(false);
  const [showSaveFailedConfirm, setShowSaveFailedConfirm] = useState<boolean>(false);
  const [copiedDraft, setCopiedDraft] = useState<boolean>(false);

  const vditorRef = useRef<Vditor | null>(null);
  const vditorContainerRef = useRef<HTMLDivElement | null>(null);
  const lastSavedStateRef = useRef<{ title: string; tags: string[]; body: string } | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const hasConflictRef = useRef<boolean>(false);
  const isSavingRef = useRef<boolean>(false);

  const editTitleRef = useRef<string>('');
  const editTagsRef = useRef<string>('');
  const triggerDebouncedSaveRef = useRef<() => void>(() => {});

  // Dirty check: comparison with last persisted state
  const isDirty = useCallback((currentTitle: string, currentTags: string[], currentBody: string): boolean => {
    if (!lastSavedStateRef.current) return false;
    const last = lastSavedStateRef.current;
    if (currentTitle.trim() !== last.title.trim()) return true;
    if (currentBody !== last.body) return true;
    if (currentTags.length !== last.tags.length) return true;
    for (let i = 0; i < currentTags.length; i++) {
      if (currentTags[i] !== last.tags[i]) return true;
    }
    return false;
  }, []);

  // Save implementation (D19)
  const doSave = useCallback(async (force: boolean = false): Promise<boolean> => {
    if (hasConflictRef.current && !force) {
      return false;
    }

    // must-fix 2: vditorRef 为 null (初始化未完成) 时绝对不能写盘，避免空 body 清空正文
    if (!vditorRef.current) {
      return false;
    }

    const currentTitle = editTitleRef.current.trim();
    if (!currentTitle) {
      setTitleError('笔记标题不能为空，无法保存');
      return false;
    }
    setTitleError(null);

    const currentBody = vditorRef.current.getValue();
    const currentTags = parseTags(editTagsRef.current);

    if (!isDirty(currentTitle, currentTags, currentBody)) {
      setSaveStatus('saved');
      return true;
    }

    if (isSavingRef.current) {
      return false;
    }

    isSavingRef.current = true;
    setSaveStatus('saving');
    let saved = false;

    try {
      // Frontmatter separation: title and tags from top inputs, body from Vditor
      const input: UpdateNoteInput = {
        id: noteId,
        title: currentTitle,
        tags: currentTags,
        body: currentBody,
      };

      const updated = await VaultService.UpdateNote(input);
      if (updated) {
        lastSavedStateRef.current = {
          title: currentTitle,
          tags: currentTags,
          body: currentBody,
        };
        hasConflictRef.current = false;
        setConflictError(null);
        setSaveStatus('saved');
        onNoteUpdated();
        saved = true;
      }
      return saved;
    } catch (err: any) {
      console.error('UpdateNote failed:', err);
      const errMsg = err?.message || String(err);
      const isConflict = errMsg.includes('conflict') || errMsg.includes('写入冲突');

      if (isConflict) {
        hasConflictRef.current = true;
        setSaveStatus('conflict');
        setConflictError('文件已被外部修改（保存冲突）。自动保存已停止，当前本地草稿尚未写盘。为防内容丢失，建议先复制草稿到剪贴板后再重新加载或返回。');
        if (debounceTimerRef.current) {
          window.clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
      } else {
        setSaveStatus('unsaved');
        setTitleError(errMsg);
      }
      return false;
    } finally {
      isSavingRef.current = false;
      // 仅当本次保存成功时才重排（保存 in-flight 期间新输入不丢）；若保存失败则不自动重排，避免无限重试
      if (saved && vditorRef.current) {
        const bodyNow = vditorRef.current.getValue();
        const titleNow = editTitleRef.current;
        const tagsNow = parseTags(editTagsRef.current);
        if (isDirty(titleNow, tagsNow, bodyNow) && !hasConflictRef.current) {
          triggerDebouncedSaveRef.current();
        }
      }
    }
  }, [noteId, isDirty, onNoteUpdated]);

  // Debounced auto-save (1.5s as per D19)
  const triggerDebouncedSave = useCallback(() => {
    if (hasConflictRef.current) return;
    setSaveStatus('unsaved');
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      doSave();
    }, 1500);
  }, [doSave]);

  useEffect(() => {
    triggerDebouncedSaveRef.current = triggerDebouncedSave;
  }, [triggerDebouncedSave]);

  const handleTitleChange = (val: string) => {
    setEditTitle(val);
    editTitleRef.current = val;
    if (!val.trim()) {
      setTitleError('笔记标题不能为空');
    } else {
      setTitleError(null);
    }
    triggerDebouncedSave();
  };

  const handleTagsChange = (val: string) => {
    setEditTags(val);
    editTagsRef.current = val;
    triggerDebouncedSave();
  };

  // Load note details on mount
  useEffect(() => {
    let mounted = true;
    setLoadingNote(true);
    setLoadError(null);
    VaultService.GetNote(noteId)
      .then((n) => {
        if (!mounted || !n) return;
        setInitialNote(n);
        setEditTitle(n.title);
        editTitleRef.current = n.title;
        const tagsStr = (n.tags ?? []).join(', ');
        setEditTags(tagsStr);
        editTagsRef.current = tagsStr;
        lastSavedStateRef.current = {
          title: n.title,
          tags: n.tags ?? [],
          body: n.body ?? '',
        };
        setLoadingNote(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setLoadError(err?.message || String(err));
        setLoadingNote(false);
      });
    return () => {
      mounted = false;
    };
  }, [noteId]);

  // Mount Vditor editor when note is loaded
  useEffect(() => {
    if (loadingNote || !initialNote || !vditorContainerRef.current) return;

    const isDark = document.documentElement.classList.contains('dark');

    // Vditor 离线包已裁剪至 <=8MB (从 23MB 裁剪至 7.5MB，保留 lute, highlight.js, icons, i18n, content-theme; 移除数学公式、流程图、脑图等重型图表库)
    // 若未来从 node_modules 重新同步，需参照 docs/02-foundation/spike-desktop-result.md §4 重新裁剪。
    const vditor = new Vditor(vditorContainerRef.current, {
      cdn: '/vditor',
      mode: 'wysiwyg',
      value: initialNote.body ?? '',
      height: '100%',
      placeholder: '开始记录内容...（支持 Markdown 语法、表格、代码块）',
      theme: isDark ? 'dark' : 'classic',
      preview: {
        theme: {
          current: isDark ? 'dark' : 'light',
        },
        hljs: {
          style: isDark ? 'github-dark' : 'github',
        },
        markdown: {
          toc: true,
          mark: true,
          footnotes: true,
          autoSpace: true,
        },
      },
      cache: {
        enable: false,
      },
      toolbar: [
        'emoji',
        'headings',
        'bold',
        'italic',
        'strike',
        'link',
        '|',
        'list',
        'ordered-list',
        'check',
        'outdent',
        'indent',
        '|',
        'quote',
        'line',
        'code',
        'inline-code',
        'insert-before',
        'insert-after',
        '|',
        'table',
        '|',
        'undo',
        'redo',
      ],
      input: () => {
        triggerDebouncedSave();
      },
      after: () => {
        vditorRef.current = vditor;
        // 如果在加载期间用户编辑了标题/标签，触发一次防抖保存检查
        const bodyNow = vditor.getValue();
        if (isDirty(editTitleRef.current, parseTags(editTagsRef.current), bodyNow)) {
          triggerDebouncedSave();
        }
      },
    });

    // Dark mode observer
    const observer = new MutationObserver(() => {
      const dark = document.documentElement.classList.contains('dark');
      vditor.setTheme(
        dark ? 'dark' : 'classic',
        dark ? 'dark' : 'light',
        dark ? 'github-dark' : 'github'
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      try {
        vditor.destroy();
      } catch {
        // ignore
      }
      vditorRef.current = null;
    };
  }, [loadingNote, initialNote, isDirty, triggerDebouncedSave]);

  // Subscribe to vault:changed: if hitting current note, trigger conflict path
  useEffect(() => {
    const unsubscribe = Events.On('vault:changed', (ev) => {
      const data = ev.data as { op?: string; path?: string; entity_id?: string; type?: string } | undefined;
      if (data?.entity_id === noteId) {
        hasConflictRef.current = true;
        if (debounceTimerRef.current) {
          window.clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        setSaveStatus('conflict');
        setConflictError('外部检测到文件变动，自动保存已停止，当前本地草稿尚未写盘。为防内容丢失，建议先复制草稿到剪贴板后再重新加载或返回。');
      }
    });
    return () => {
      unsubscribe();
    };
  }, [noteId]);

  // Window beforeunload flush
  useEffect(() => {
    const handleBeforeUnload = () => {
      // shortcut: 导航切走时 best-effort flush,关窗/极速切换仍可能丢 ≤1.5s 输入,实机走查评估
      // 注：beforeunload 异步 IPC 关窗由于浏览器生命周期与 IPC 异步性亦可能丢失未保存数据，接受现状，不实现 Go 退出钩子
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        doSave();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [doSave]);

  // Unmount cleanup best-effort flush (should-fix 4)
  const doSaveRef = useRef<() => Promise<boolean>>(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  useEffect(() => {
    return () => {
      // shortcut: 导航切走时 best-effort flush,关窗/极速切换仍可能丢 ≤1.5s 输入,实机走查评估
      // 注：beforeunload 异步 IPC 关窗由于浏览器生命周期与 IPC 异步性亦可能丢失未保存数据，接受现状，不实现 Go 退出钩子
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      doSaveRef.current();
    };
  }, []);

  // Keyboard shortcut Cmd+S / Ctrl+S to save immediately
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (debounceTimerRef.current) {
          window.clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        doSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [doSave]);

  // Back button handling with flush (must-fix 3)
  const handleBackClick = async () => {
    if (hasConflictRef.current) {
      setShowLeaveConflictConfirm(true);
      return;
    }
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const currentTitle = editTitleRef.current;
    const currentTags = parseTags(editTagsRef.current);
    const currentBody = vditorRef.current ? vditorRef.current.getValue() : (initialNote?.body ?? '');
    const dirty = isDirty(currentTitle, currentTags, currentBody);

    if (!dirty) {
      onBack();
      return;
    }

    const saved = await doSave();
    if (saved) {
      onBack();
    } else {
      setShowSaveFailedConfirm(true);
    }
  };

  // Copy draft to clipboard (should-fix 3)
  const handleCopyDraft = async () => {
    const currentTitle = editTitleRef.current;
    const currentBody = vditorRef.current ? vditorRef.current.getValue() : '';
    const draftText = currentTitle ? `# ${currentTitle}\n\n${currentBody}` : currentBody;
    try {
      await navigator.clipboard.writeText(draftText);
      setCopiedDraft(true);
      setTimeout(() => setCopiedDraft(false), 2500);
    } catch (err) {
      console.error('Failed to copy draft to clipboard:', err);
    }
  };

  // Reload handler (discard local changes and reload from disk)
  const handleConfirmReload = async () => {
    setShowReloadConfirm(false);
    try {
      const diskNote = await VaultService.GetNote(noteId);
      if (!diskNote) return;

      setEditTitle(diskNote.title);
      editTitleRef.current = diskNote.title;
      const tagsStr = (diskNote.tags ?? []).join(', ');
      setEditTags(tagsStr);
      editTagsRef.current = tagsStr;
      setTitleError(null);

      const body = diskNote.body ?? '';
      if (vditorRef.current) {
        vditorRef.current.setValue(body);
      }

      lastSavedStateRef.current = {
        title: diskNote.title,
        tags: diskNote.tags ?? [],
        body,
      };

      hasConflictRef.current = false;
      setConflictError(null);
      setSaveStatus('saved');
      onNoteUpdated();
    } catch (err: any) {
      console.error('Failed to reload note:', err);
      setConflictError(`重新加载失败: ${err?.message || err}`);
    }
  };

  // Abandon changes and return to list
  const handleAbandonAndReturn = () => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    hasConflictRef.current = false;
    onBack();
  };

  if (loadingNote) {
    return (
      <div className="flex items-center justify-center py-24 text-xs text-stone-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2 text-emerald-600" />
        <span>加载笔记中...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-4">
        <div className="p-3.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>加载笔记失败: {loadError}</span>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center space-x-1 px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>返回笔记列表</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] max-w-5xl mx-auto space-y-2.5">
      {/* Top Header / Metadata Toolbar */}
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-stone-200 dark:border-stone-800 shrink-0">
        <div className="flex items-center space-x-2.5 flex-1 min-w-0">
          <button
            type="button"
            onClick={handleBackClick}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition shrink-0"
            title="返回笔记列表（将自动保存未提交改动）"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>笔记列表</span>
          </button>

          {/* Title Input (Required) */}
          <input
            type="text"
            value={editTitle}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="输入笔记标题（必填）..."
            className={`flex-1 min-w-[200px] px-3 py-1.5 text-sm font-semibold rounded-lg border bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 transition ${
              titleError
                ? 'border-rose-400 dark:border-rose-700 ring-1 ring-rose-400'
                : 'border-stone-200 dark:border-stone-800'
            }`}
          />

          {/* Tags Input (Optional) */}
          <input
            type="text"
            value={editTags}
            onChange={(e) => handleTagsChange(e.target.value)}
            placeholder="标签 (逗号分隔)"
            className="w-44 px-2.5 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-800 dark:text-stone-200 placeholder-stone-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-600 transition"
          />
        </div>

        {/* Status Indicator & ID */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="text-xs">
            {saveStatus === 'saving' && (
              <span className="text-stone-400 flex items-center space-x-1">
                <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                <span>保存中...</span>
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-stone-400 dark:text-stone-500 flex items-center space-x-1">
                <Check className="w-3 h-3 text-emerald-600" />
                <span>已保存</span>
              </span>
            )}
            {saveStatus === 'unsaved' && (
              <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span>未保存</span>
              </span>
            )}
            {saveStatus === 'conflict' && (
              <span className="text-rose-600 dark:text-rose-400 font-semibold flex items-center space-x-1">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                <span>保存冲突</span>
              </span>
            )}
          </div>

          <span className="text-[10px] font-mono text-stone-400 dark:text-stone-500 pl-2 border-l border-stone-200 dark:border-stone-800">
            {noteId}
          </span>
        </div>
      </div>

      {/* Validation Warning */}
      {titleError && (
        <div className="text-[11px] text-rose-600 dark:text-rose-400 px-1 font-medium shrink-0">
          {titleError}
        </div>
      )}

      {/* Conflict Warning Banner (Stops auto-save) */}
      {(hasConflictRef.current || conflictError) && (
        <div className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-3 shadow-xs shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="font-medium">
              {conflictError ||
                '文件已被外部修改（保存冲突）。自动保存已停止，当前本地草稿尚未写盘。为防内容丢失，建议先复制草稿到剪贴板后再重新加载或返回。'}
            </span>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyDraft}
              className="flex items-center space-x-1 px-3 py-1 rounded-md bg-stone-700 hover:bg-stone-800 text-white text-xs font-medium transition shadow-2xs"
              title="将当前编辑器中的草稿（标题与正文）复制到剪贴板"
            >
              {copiedDraft ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedDraft ? '已复制草稿' : '复制草稿到剪贴板'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowReloadConfirm(true)}
              className="flex items-center space-x-1 px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition shadow-2xs"
            >
              <RefreshCw className="w-3 h-3" />
              <span>重新加载（丢弃本地改动）</span>
            </button>
            <button
              type="button"
              onClick={handleAbandonAndReturn}
              className="px-2.5 py-1 rounded-md border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-xs transition"
            >
              放弃保存返回
            </button>
          </div>
        </div>
      )}

      {/* Vditor WYSIWYG Editor Container (occupies remaining height) */}
      <div
        ref={vditorContainerRef}
        className="flex-1 min-h-0 rounded-xl overflow-hidden border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-2xs [&_.vditor]:border-0 [&_.vditor]:rounded-xl"
      />

      {/* Confirmation Modal for Discarding Local Changes on Reload */}
      {showReloadConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  确认重新加载？
                </h3>
                <p className="text-xs text-stone-500 leading-relaxed">
                  重新加载将从磁盘读取最新的笔记内容，您当前在编辑器中未保存的本地修改将被全部丢弃。
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setShowReloadConfirm(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmReload}
                className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition shadow-xs"
              >
                确认重新加载
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Leaving During Conflict */}
      {showLeaveConflictConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  存在未解决冲突
                </h3>
                <p className="text-xs text-stone-500 leading-relaxed">
                  当前笔记存在外部文件修改冲突。直接返回列表将放弃本地未保存的内容。确认离开吗？
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setShowLeaveConflictConfirm(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              >
                继续编辑
              </button>
              <button
                type="button"
                onClick={handleAbandonAndReturn}
                className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition shadow-xs"
              >
                放弃修改并离开
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Save Failure on Exit (must-fix 3) */}
      {showSaveFailedConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xl space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  保存未成功
                </h3>
                <p className="text-xs text-stone-500 leading-relaxed">
                  当前笔记未能成功保存到磁盘（可能标题为空或写入异常）。直接返回将丢弃未保存的修改，是否确定离开？
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setShowSaveFailedConfirm(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              >
                留在页面
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSaveFailedConfirm(false);
                  onBack();
                }}
                className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition shadow-xs"
              >
                丢弃并返回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function NotesView({
  vaultStatus,
  onSelectVault,
  onRescanVault,
  vaultBusy = false,
  focusNoteId,
  onClearFocusNote,
}: NotesViewProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Consume focusNoteId from parent navigation (one-time consumption)
  useEffect(() => {
    if (focusNoteId) {
      setSelectedNoteId(focusNoteId);
      onClearFocusNote?.();
    }
  }, [focusNoteId, onClearFocusNote]);

  // Search filter (preserved across navigation)
  const [searchQuery, setSearchQuery] = useState('');

  // Scroll position preservation
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollTopRef = useRef<number>(0);

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

  // Record scroll position while in list view
  useEffect(() => {
    if (selectedNoteId) return;
    const scrollContainer = rootRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
    if (!scrollContainer) return;
    const handleScroll = () => {
      scrollTopRef.current = scrollContainer.scrollTop;
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [selectedNoteId]);

  // Restore scroll position when returning to list view
  useEffect(() => {
    if (selectedNoteId === null) {
      const scrollContainer = rootRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
      if (scrollContainer && scrollTopRef.current > 0) {
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollTopRef.current;
        });
      }
    }
  }, [selectedNoteId]);

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

  // Select note and record scroll position
  const handleSelectNote = (id: string) => {
    const scrollContainer = rootRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
    if (scrollContainer) {
      scrollTopRef.current = scrollContainer.scrollTop;
      scrollContainer.scrollTop = 0;
    }
    setSelectedNoteId(id);
  };

  // Create note handler (directly enters editor on success)
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
      const parsedTags = parseTags(newTags);
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
        // Enters editor directly
        const scrollContainer = rootRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
        if (scrollContainer) {
          scrollTopRef.current = scrollContainer.scrollTop;
          scrollContainer.scrollTop = 0;
        }
        setSelectedNoteId(created.id);
      }
    } catch (err: any) {
      console.error('Failed to create note:', err);
      setCreateError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  };

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

  // Editor View (occupies full main content area)
  if (selectedNoteId) {
    return (
      <NoteEditor
        noteId={selectedNoteId}
        onBack={() => setSelectedNoteId(null)}
        onNoteUpdated={loadNotes}
      />
    );
  }

  // Single-column Flomo-style Card List View
  return (
    <div ref={rootRef} className="max-w-3xl mx-auto space-y-5">
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
                onClick={() => handleSelectNote(n.id)}
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
                  {creating ? '创建中...' : '创建并进入编辑'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
