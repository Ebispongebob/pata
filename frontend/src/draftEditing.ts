import { EditorSelection, EditorState } from '@codemirror/state';

export type DraftShortcut = 'new-draft' | 'find' | 'replace' | 'line-ends';

export function draftShortcut(event: {
  key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean;
  altKey: boolean; isComposing?: boolean; keyCode?: number;
}): DraftShortcut | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing || event.keyCode === 229) return null;
  const key = event.key.toLowerCase();
  if (!event.shiftKey && key === 'n') return 'new-draft';
  if (!event.shiftKey && key === 'f') return 'find';
  if (event.shiftKey && key === 'r') return 'replace';
  if (event.shiftKey && key === 'l') return 'line-ends';
  return null;
}

/** 按真实换行分割；选区恰好停在下一行开头时，不包含该行。 */
export function lineEndSelection(state: EditorState): EditorSelection {
  const positions = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to).number;
    for (let number = first; number <= last; number++) positions.add(state.doc.line(number).to);
  }
  return EditorSelection.create([...positions].sort((a, b) => a - b).map((pos) => EditorSelection.cursor(pos)));
}

export interface TextMatch { from: number; to: number }

/** 使用字面量匹配；替换内容中的 $、反斜线不作模板解释。 */
export function findTextMatches(text: string, query: string): TextMatch[] {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...text.matchAll(new RegExp(escaped, 'giu'))].map((match) => ({ from: match.index!, to: match.index! + match[0].length }));
}

export function hasBlockingDraftDialog(): boolean {
  return [...document.querySelectorAll<HTMLElement>('[aria-modal="true"], .fixed.inset-0.z-50')]
    .some((element) => element.getClientRects().length > 0);
}
