import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface Props {
  mode: 'find' | 'replace';
  query: string;
  replacement: string;
  index: number;
  count: number;
  onQuery: (query: string) => void;
  onReplacement: (value: string) => void;
  onNavigate: (direction: number) => void;
  onReplace: (all: boolean) => void;
  onClose: () => void;
}

export function DraftFindBar({ mode, query, replacement, index, count, onQuery, onReplacement, onNavigate, onReplace, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, [mode]);
  const inputClass = 'min-w-0 flex-1 rounded-md border border-stone-300 dark:border-stone-700 px-2 py-1.5 bg-white dark:bg-stone-950 text-xs';
  const buttonClass = 'rounded-md px-2 py-1.5 text-xs hover:bg-stone-200 dark:hover:bg-stone-800 disabled:opacity-40 cursor-pointer';
  return (
    <div role="search" aria-label="当前草稿查找" className="shrink-0 rounded-lg border border-stone-200 dark:border-stone-700 p-2 space-y-2 bg-stone-100 dark:bg-stone-900"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === 'Enter') { event.preventDefault(); onNavigate(event.shiftKey ? -1 : 1); }
      }}>
      <div className="flex items-center gap-1.5">
        <input ref={inputRef} aria-label="查找内容" title="按文字查找，不区分大小写" placeholder="查找当前草稿…" value={query} className={inputClass} onChange={(event) => onQuery(event.target.value)} />
        <span className="text-[11px] text-stone-500 whitespace-nowrap" aria-live="polite">{count ? `${index + 1} / ${count}` : query ? '无匹配' : '0 / 0'}</span>
        <button type="button" className={buttonClass} disabled={!count} onClick={() => onNavigate(-1)} title="上一项 (⇧Enter)" aria-label="上一项"><ChevronUp className="w-3.5 h-3.5" /></button>
        <button type="button" className={buttonClass} disabled={!count} onClick={() => onNavigate(1)} title="下一项 (Enter)" aria-label="下一项"><ChevronDown className="w-3.5 h-3.5" /></button>
        <button type="button" className={buttonClass} onClick={onClose} title="关闭查找 (Esc)" aria-label="关闭查找"><X className="w-3.5 h-3.5" /></button>
      </div>
      {mode === 'replace' && <div className="flex items-center gap-1.5">
        <input aria-label="替换为" placeholder="替换为…（可留空）" value={replacement} className={inputClass} onChange={(event) => onReplacement(event.target.value)} />
        <button type="button" className={buttonClass} disabled={!count} onClick={() => onReplace(false)}>替换</button>
        <button type="button" className={buttonClass} disabled={!count} onClick={() => onReplace(true)}>全部替换</button>
      </div>}
    </div>
  );
}
