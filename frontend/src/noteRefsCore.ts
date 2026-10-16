// 阶段 7：笔记引用核心逻辑（候选过滤、键盘处理、绑定解析、相对链接计算）。
// 保持为纯 TypeScript，不包含 JSX/DOM 强依赖，便于单元测试与跨端复用。

export interface NoteRef {
  id: string;
  title: string;
  path: string;
}

export type NoteRefMap = { [name: string]: string | undefined };

// ---------- 触发与候选 ----------

// 中文输入法下 `[` 会变成 `【`，一并识别。
export const TRIGGER = /(\[\[|【【|【\[|\[【)([^\[\]【】\n]*)$/;

/** 光标前文本以未完成的 `[[查询` 结尾时返回其起点与查询。 */
export function matchTrigger(before: string): { start: number; query: string } | null {
  const m = TRIGGER.exec(before);
  return m ? { start: m.index, query: m[2] } : null;
}

export function filterNotes(notes: NoteRef[], query: string): NoteRef[] {
  const q = query.trim().toLowerCase();
  return notes.filter((n) => !q || n.title.toLowerCase().includes(q)).slice(0, 8);
}

export interface FileRef {
  name: string;
  path: string;
  ext: string;
  size: number;
  mod_time?: string;
}

export type CandidateItem =
  | { kind: 'note'; note: NoteRef }
  | { kind: 'file'; file: FileRef };

export function filterCandidates(notes: NoteRef[], files: FileRef[], query: string): CandidateItem[] {
  const q = query.trim().toLowerCase();
  const matchedNotes: CandidateItem[] = notes
    .filter((n) => !q || n.title.toLowerCase().includes(q))
    .map((note) => ({ kind: 'note', note }));
  const matchedFiles: CandidateItem[] = files
    .filter((f) => !q || f.name.toLowerCase().includes(q))
    .map((file) => ({ kind: 'file', file }));
  return [...matchedNotes, ...matchedFiles].slice(0, 10);
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
  if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    pick();
    return true;
  }
  return false;
}

// ---------- 纯文本引用（Task 描述 / 评论） ----------

export const textRefRe = () => /(\\)?\[\[([^\[\]\n]+)\]\]/g;

/** 只保留正文中实际出现（未转义）的绑定。 */
export function pruneRefs(text: string, refs: NoteRefMap): NoteRefMap {
  const out: NoteRefMap = {};
  for (const m of text.matchAll(textRefRe())) {
    if (!m[1]) {
      const k = m[2];
      const trimmed = k.trim();
      if (refs[k]) {
        out[k] = refs[k];
      } else if (refs[trimmed]) {
        out[trimmed] = refs[trimmed];
      } else {
        for (const rk of Object.keys(refs)) {
          if (rk.trim() === trimmed && refs[rk]) {
            out[rk] = refs[rk];
            break;
          }
        }
      }
    }
  }
  return out;
}

export function sameRefs(a: NoteRefMap, b: NoteRefMap): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/**
 * 解析正文中的 `[[名称]]`：
 * 1. 已绑定：只认绑定的 ID。目标不存在即失效并保留失效提示，严禁退回标题匹配（防止新建同名笔记接管旧绑定）。
 * 2. 未绑定：仅在标题唯一匹配时解析；同名或无匹配时保留原文并给出明确原因（与 Go Core 规则一致）。
 */
export function resolveRef(
  name: string,
  refs: NoteRefMap | undefined,
  notes: NoteRef[]
): { note?: NoteRef; reason?: string } {
  const trimmed = name.trim();
  if (refs) {
    let boundId: string | undefined;
    let isBound = false;

    if (name in refs) {
      boundId = refs[name];
      isBound = true;
    } else if (trimmed in refs) {
      boundId = refs[trimmed];
      isBound = true;
    } else {
      for (const k of Object.keys(refs)) {
        if (k.trim() === trimmed) {
          boundId = refs[k];
          isBound = true;
          break;
        }
      }
    }

    if (isBound) {
      if (boundId) {
        const n = notes.find((x) => x.id === boundId);
        if (n) return { note: n };
      }
      return { reason: '笔记不存在或已移动' };
    }
  }

  // 未绑定：仅在标题唯一匹配时解析
  if (!trimmed) {
    return { reason: '笔记不存在或已移动' };
  }
  const m = notes.filter((x) => x.title.trim() === trimmed);
  if (m.length === 1) return { note: m[0] };
  return { reason: m.length > 1 ? '有多篇同名笔记，请编辑后重新选择' : '笔记不存在或已移动' };
}

// ---------- Note 正文：标准 Markdown 相对链接 ----------

export const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);

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

// ---------- 文件链接解析 ----------

export const fileLinkRe = () => /(!?)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** 判断 destination 是否是 Vault 文件相对路径（指向 files/） */
export function isVaultFileLink(dest: string): boolean {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(dest) || dest.startsWith('/') || dest.startsWith('#')) return false;
  return dest.includes('files/');
}

/** 把相对 href 解析为 Vault 内的 FileRef；解析失败或目标非文件返回 undefined。 */
export function resolveFileHref(fromPath: string, href: string, files: FileRef[]): FileRef | undefined {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('/') || href.startsWith('#')) return undefined;
  try {
    const clean = decodeURIComponent(href.split(/[#?]/)[0]);
    const parts: string[] = [];
    for (const seg of (dirOf(fromPath) + clean).split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    const target = parts.join('/');
    return files.find((f) => f.path === target);
  } catch {
    return undefined;
  }
}

