// 阶段 7：笔记引用（`[[` 搜索插入、阅读时点击、路径/链接辅助）。
// Note 正文保存标准 Markdown 相对链接；Task 描述 / 任务评论保留 `[[名称]]` 纯文本，
// 名称到真实 Note ID 的绑定由调用方持久化在 note_refs（见 schema.md）。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Events } from '@wailsio/runtime';
import * as VaultService from '../bindings/pata/vaultservice';
import {
  NoteRef,
  NoteRefMap,
  filterNotes,
  matchTrigger,
  pickerKey,
  resolveRef,
  textRefRe,
} from './noteRefsCore';

export * from './noteRefsCore';

/** 当前 Vault 全部笔记（ID/标题/相对路径），随 vault:changed 刷新。 */
export function useNoteRefs(): NoteRef[] {
  const [notes, setNotes] = useState<NoteRef[]>([]);
  const load = useCallback(() => {
    VaultService.ListNoteRefs()
      .then((r) => setNotes((r ?? []).filter((n): n is NoteRef => n !== null)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const off = Events.On('vault:changed', load);
    return () => {
      off();
    };
  }, [load]);
  return notes;
}

export function NotePicker({
  items,
  allNotes,
  index,
  left,
  top,
  bottom,
  onPick,
  onHover,
}: {
  items: NoteRef[];
  allNotes: NoteRef[];
  index: number;
  left: number;
  top?: number;
  bottom?: number;
  onPick: (n: NoteRef) => void;
  onHover: (i: number) => void;
}) {
  const dup = (title: string) => allNotes.filter((n) => n.title === title).length > 1;
  const picker = (
    <div
      role="listbox"
      aria-label="引用笔记"
      style={{
        position: 'fixed',
        left: Math.min(left, Math.max(16, window.innerWidth - 300)),
        ...(bottom !== undefined ? { bottom } : { top }),
        width: 280,
      }}
      className="z-50 max-h-64 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl py-1 text-xs"
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-stone-400">没有找到笔记</div>
      ) : (
        items.map((n, i) => (
          <div
            key={n.id}
            role="option"
            aria-selected={i === index}
            // mousedown 而非 click：避免输入框先失焦
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(n);
            }}
            onMouseEnter={() => onHover(i)}
            className={`px-3 py-1.5 cursor-pointer ${
              i === index ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200' : 'text-stone-700 dark:text-stone-300'
            }`}
          >
            <div className="truncate font-medium">{n.title}</div>
            {dup(n.title) && <div className="truncate text-[10px] text-stone-400">{n.path}</div>}
          </div>
        ))
      )}
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(picker, document.body);
  }
  return picker;
}

/** 阅读态：按纯文本显示，仅把 `[[名称]]` 渲染成可点击名称。 */
export function NoteRefText({
  text,
  refs,
  notes,
  onOpenNote,
  className,
}: {
  text: string;
  refs?: NoteRefMap;
  notes: NoteRef[];
  onOpenNote?: (id: string) => void;
  className?: string;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(textRefRe())) {
    const at = m.index ?? 0;
    parts.push(text.slice(last, at));
    last = at + m[0].length;
    const name = m[2];
    if (m[1]) {
      parts.push(`[[${name}]]`); // 转义：字面文字
      continue;
    }
    const { note, reason } = resolveRef(name, refs, notes);
    parts.push(
      note ? (
        <button
          key={at}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenNote?.(note.id);
          }}
          title={note.path}
          className="text-emerald-700 dark:text-emerald-400 underline decoration-dotted underline-offset-2 hover:decoration-solid cursor-pointer text-left"
        >
          {name}
        </button>
      ) : (
        <span key={at} title={reason} className="text-amber-700 dark:text-amber-400">
          [[{name}]]
        </span>
      )
    );
  }
  parts.push(text.slice(last));
  return <div className={`whitespace-pre-wrap break-words ${className ?? ''}`}>{parts}</div>;
}

type TAProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (v: string) => void;
  refs: NoteRefMap;
  onRefsChange: (r: NoteRefMap) => void;
  notes: NoteRef[];
  autoAdjustHeight?: boolean;
  minHeight?: number;
};

/** 带 `[[` 笔记候选的纯文本输入框。 */
export function NoteRefTextarea({
  value,
  onChange,
  refs,
  onRefsChange,
  notes,
  autoAdjustHeight,
  minHeight = 22,
  onKeyDown,
  ...rest
}: TAProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const dismissed = useRef(-1);
  const [st, setSt] = useState<{
    start: number;
    query: string;
    index: number;
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const items = st ? filterNotes(notes, st.query) : [];

  useEffect(() => {
    if (autoAdjustHeight && ta.current) {
      ta.current.style.height = 'auto';
      ta.current.style.height = `${Math.max(ta.current.scrollHeight, minHeight)}px`;
    }
  }, [value, autoAdjustHeight, minHeight]);

  const sync = (el: HTMLTextAreaElement) => {
    const m = matchTrigger(el.value.slice(0, el.selectionStart));
    if (!m) {
      dismissed.current = -1;
      setSt(null);
      return;
    }
    if (dismissed.current === m.start) return;
    const r = el.getBoundingClientRect();
    const pickerHeight = 240;
    const spaceBelow = window.innerHeight - r.bottom;
    const showAbove = spaceBelow < pickerHeight && r.top > pickerHeight;
    setSt((p) => ({
      ...m,
      index: p && p.query === m.query ? p.index : 0,
      left: r.left,
      top: showAbove ? undefined : r.bottom + 4,
      bottom: showAbove ? window.innerHeight - r.top + 4 : undefined,
    }));
  };

  const pick = (n: NoteRef) => {
    const el = ta.current;
    if (!el || !st) return;
    let key = n.title.replace(/[\[\]]/g, '').trim() || n.path;
    // 同一正文里同名但指向不同笔记：用路径区分，绑定按名称保存
    if (refs[key] && refs[key] !== n.id) key = `${key} (${n.path})`.replace(/[\[\]]/g, '');
    const caret = el.selectionStart;
    const ins = `[[${key}]]`;
    onChange(value.slice(0, st.start) + ins + value.slice(caret));
    onRefsChange({ ...refs, [key]: n.id });
    setSt(null);
    const pos = st.start + ins.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <>
      <textarea
        {...rest}
        ref={ta}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (autoAdjustHeight) {
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.max(e.target.scrollHeight, minHeight)}px`;
          }
          sync(e.target);
        }}
        onSelect={(e) => sync(e.currentTarget)}
        onBlur={(e) => {
          setSt(null);
          rest.onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (
            st &&
            pickerKey(
              e,
              e.nativeEvent.isComposing || e.keyCode === 229,
              items.length,
              st.index,
              (i) => setSt({ ...st, index: i }),
              () => pick(items[st.index]),
              () => {
                dismissed.current = st.start;
                setSt(null);
              }
            )
          )
            return;
          onKeyDown?.(e);
        }}
      />
      {st && (
        <NotePicker
          items={items}
          allNotes={notes}
          index={st.index}
          left={st.left}
          top={st.top}
          bottom={st.bottom}
          onPick={pick}
          onHover={(i) => setSt({ ...st, index: i })}
        />
      )}
    </>
  );
}
