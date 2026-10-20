// Today / Tasks 共用的快速创建规则（见 docs/03-daily-loop/proposal.md「共用快速创建与末尾标签」）。

import { dedupeTags } from './tagUtils';
export { dedupeTags };

// 末尾连续、空白分隔的 #标签；`#` 必须开头一个独立词段（不从 C# 内抽取），标签名非空且不含空白或 #。
const TRAILING_TAG = /(^|\s)#([^\s#]+)$/;

export function parseQuickTask(input: string): { title: string; tags: string[] } {
  let rest = input.trim();
  const tags: string[] = [];
  for (let m = TRAILING_TAG.exec(rest); m; m = TRAILING_TAG.exec(rest)) {
    tags.unshift(m[2]);
    rest = rest.slice(0, m.index).trimEnd();
  }
  return { title: rest, tags: dedupeTags(tags) };
}

// 光标在输入末尾且处于以空白后 `#` 开头的词段时，返回该段的起点与已输入的名称。
export function activeTagQuery(value: string): { start: number; query: string } | null {
  const m = /(^|\s)#([^\s#]*)$/.exec(value);
  if (!m) return null;
  return { start: m.index + m[1].length, query: m[2] };
}
