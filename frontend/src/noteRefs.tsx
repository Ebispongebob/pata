// 阶段 7：笔记引用（`[[` 搜索插入、阅读时点击、路径/链接辅助）。
// Note 正文保存标准 Markdown 相对链接；Task 描述 / 任务评论保留 `[[名称]]` 纯文本，
// 名称到真实 Note ID 的绑定由调用方持久化在 note_refs（见 schema.md）。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import * as VaultService from '../bindings/pata/vaultservice';
import { NoteRef } from '../bindings/pata/internal/storage/markdown/models';

export type { NoteRef };
export type NoteRefMap = { [name: string]: string | undefined };

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

// ---------- 触发与候选 ----------

// 中文输入法下 `[` 会变成 `【`，一并识别。
const TRIGGER = /(\[\[|【【)([^\[\]【】\n]*)$/;

/** 光标前文本以未完成的 `[[查询` 结尾时返回其起点与查询。 */
export function matchTrigger(before: string): { start: number; query: string } | null {
  const m = TRIGGER.exec(before);
  return m ? { start: m.index, query: m[2] } : null;
}

export function filterNotes(notes: NoteRef[], query: string): NoteRef[] {
  const q = query.trim().toLowerCase();
  return notes.filter((n) => !q || n.title.toLowerCase().includes(q)).slice(0, 8);
}

/** 候选弹层键盘处理；返回 true 表示已消费该按键。组合输入期间不拦截。 */
export function pickerKey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; preventDefault(): void },
  composing: boolean,
  count: number,
  index: number,
  setIndex: (i: number) => void,
  pick: () => void,
  close: () => void
): boolean {
  if (composing) return false;
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return true;
  }
  if (count === 0) return false; // 无结果时 Enter 仍是普通换行
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    setIndex((index + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
    return true;
  }
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    pick();
    return true;
  }
  return false;
}

export function NotePicker({
  items,
  allNotes,
  index,
  left,
  top,
  onPick,
  onHover,
}: {
  items: NoteRef[];
  allNotes: NoteRef[];
  index: number;
  left: number;
  top: number;
  onPick: (n: NoteRef) => void;
  onHover: (i: number) => void;
}) {
  const dup = (title: string) => allNotes.filter((n) => n.title === title).length > 1;
  return (
    <div
      role="listbox"
      aria-label="引用笔记"
      style={{ position: 'fixed', left: Math.min(left, window.innerWidth - 300), top, width: 280 }}
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
}

// ---------- 纯文本引用（Task 描述 / 评论） ----------

const textRefRe = () => /(\\)?\[\[([^\[\]\n]+)\]\]/g;

/** 只保留正文中实际出现（未转义）的绑定。 */
export function pruneRefs(text: string, refs: NoteRefMap): NoteRefMap {
  const out: NoteRefMap = {};
  for (const m of text.matchAll(textRefRe())) {
    if (!m[1] && refs[m[2]]) out[m[2]] = refs[m[2]];
  }
  return out;
}

export function sameRefs(a: NoteRefMap, b: NoteRefMap): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** 已绑定只认绑定的 ID；未绑定仅在标题唯一匹配时解析（与 Go Core 规则一致）。 */
export function resolveRef(name: string, refs: NoteRefMap | undefined, notes: NoteRef[]): { note?: NoteRef; reason?: string } {
  if (refs && name in refs) {
    const n = notes.find((x) => x.id === refs[name]);
    return n ? { note: n } : { reason: '笔记不存在或已移动' };
  }
  const m = notes.filter((x) => x.title === name);
  if (m.length === 1) return { note: m[0] };
  return { reason: m.length > 1 ? '有多篇同名笔记，请编辑后重新选择' : '笔记不存在或已移动' };
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
          className="text-emerald-700 dark:text-emerald-400 underline decoration-dotted underline-offset-2 hover:decoration-solid"
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
};

/** 带 `[[` 笔记候选的纯文本输入框。 */
export function NoteRefTextarea({ value, onChange, refs, onRefsChange, notes, onKeyDown, ...rest }: TAProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const dismissed = useRef(-1);
  const [st, setSt] = useState<{ start: number; query: string; index: number; left: number; top: number } | null>(null);
  const items = st ? filterNotes(notes, st.query) : [];

  const sync = (el: HTMLTextAreaElement) => {
    const m = matchTrigger(el.value.slice(0, el.selectionStart));
    if (!m) {
      dismissed.current = -1;
      setSt(null);
      return;
    }
    if (dismissed.current === m.start) return;
    const r = el.getBoundingClientRect();
    setSt((p) => ({ ...m, index: p && p.query === m.query ? p.index : 0, left: r.left, top: r.bottom + 4 }));
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
          onPick={pick}
          onHover={(i) => setSt({ ...st, index: i })}
        />
      )}
    </>
  );
}

// ---------- Note 正文：标准 Markdown 相对链接 ----------

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);

/** `fromPath` 所在目录到 `toPath` 的相对路径（均为 Vault 相对、斜杠分隔），以 ./ 或 ../ 开头。 */
export function relativePath(fromPath: string, toPath: string): string {
  const from = dirOf(fromPath).split('/').filter(Boolean);
  const to = toPath.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const rel = [...Array(from.length - i).fill('..'), ...to.slice(i)].join('/');
  return rel.startsWith('..') ? rel : `./${rel}`;
}

/** 链接目标里只转义会破坏 Markdown 语法的字符（空格、括号、%），中文保持可读。 */
export function escapeLinkPath(p: string): string {
  return p.replace(/[ ()%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** 把编辑器里点击的 href 解析为 Vault 内的 Note；非相对 .md 链接返回 undefined。 */
export function resolveHref(fromPath: string, href: string, notes: NoteRef[]): NoteRef | undefined {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('/') || href.startsWith('#')) return undefined;
  try {
    const clean = decodeURIComponent(href.split(/[#?]/)[0]);
    const parts: string[] = [];
    for (const seg of (dirOf(fromPath) + clean).split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    const target = parts.join('/');
    return notes.find((n) => n.path === target);
  } catch {
    return undefined;
  }
}
