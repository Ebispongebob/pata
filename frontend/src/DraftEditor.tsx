import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { findTextMatches, lineEndSelection, type TextMatch } from './draftEditing';

const searchQuery = StateEffect.define<{ query: string; current: number }>();
const searchMarks = StateField.define({
  create: () => ({ query: '', current: 0, marks: Decoration.none }),
  update(value, transaction) {
    const effect = transaction.effects.find((item) => item.is(searchQuery));
    if (!effect && !transaction.docChanged) return value;
    const { query, current } = effect ? effect.value as { query: string; current: number } : value;
    const marks = Decoration.set(findTextMatches(transaction.newDoc.toString(), query)
      .map(({ from, to }, index) => Decoration.mark({ class: index === current ? 'draft-search-current' : 'draft-search-match' }).range(from, to)));
    return { query, current, marks };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.marks),
});

export interface DraftEditorRef {
  setValue: (body: string, resetHistory?: boolean) => void;
  focus: () => void;
  select: (from: number, to: number) => void;
  selectedText: () => string;
  lineEnds: () => void;
  highlight: (query: string, current?: number) => void;
  replace: (matches: TextMatch[], value: string) => void;
  insert: (value: string) => void;
  composing: () => boolean;
}

interface Props {
  initialValue: string;
  onChange: (body: string) => void;
}

export const DraftEditor = forwardRef<DraftEditorRef, Props>(function DraftEditor({ initialValue, onChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const mutedRef = useRef(false);
  const createState = (doc: string) => EditorState.create({
    doc,
    extensions: [
      EditorState.allowMultipleSelections.of(true), lineNumbers(), drawSelection(), history(),
      markdown(), syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping,
      placeholder('开始记录内容…'), searchMarks,
      keymap.of([
        { key: 'Escape', run: (view) => {
          if (view.state.selection.ranges.length < 2) return false;
          view.dispatch({ selection: EditorSelection.single(view.state.selection.main.head) });
          return true;
        } },
        ...defaultKeymap, ...historyKeymap,
      ]),
      EditorView.contentAttributes.of({ 'aria-label': '草稿编辑器', spellcheck: 'false' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !mutedRef.current) changeRef.current(update.state.doc.toString());
      }),
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: '14px', lineHeight: '1.75' },
        '.cm-content': { padding: '8px 0 80px' },
        '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
        '&.cm-focused': { outline: 'none' },
      }),
    ],
  });

  useEffect(() => {
    const view = new EditorView({ state: createState(initialValue), parent: containerRef.current! });
    viewRef.current = view;
    return () => { viewRef.current = null; view.destroy(); };
  }, []);

  useImperativeHandle(ref, () => ({
    composing() { return viewRef.current?.composing ?? false; },
    setValue(body, resetHistory = false) {
      const view = viewRef.current;
      if (!view) return;
      mutedRef.current = true;
      try {
        if (resetHistory) view.setState(createState(body));
        else if (view.state.doc.toString() !== body) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body } });
      } finally { mutedRef.current = false; }
    },
    focus() { viewRef.current?.requestMeasure(); viewRef.current?.focus(); },
    select(from, to) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ selection: { anchor: Math.min(from, view.state.doc.length), head: Math.min(to, view.state.doc.length) }, scrollIntoView: true });
    },
    selectedText() {
      const view = viewRef.current;
      return view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : '';
    },
    lineEnds() {
      const view = viewRef.current;
      if (view) view.dispatch({ selection: lineEndSelection(view.state), scrollIntoView: true });
    },
    highlight(query, current = 0) { viewRef.current?.dispatch({ effects: searchQuery.of({ query, current }) }); },
    replace(matches, value) {
      const view = viewRef.current;
      if (view && matches.length) view.dispatch({ changes: matches.map(({ from, to }) => ({ from, to, insert: value })), userEvent: 'input.replace', annotations: isolateHistory.of('full') });
    },
    insert(value) {
      const view = viewRef.current;
      if (view) view.dispatch({ ...view.state.replaceSelection(value), userEvent: 'input' });
    },
  }));

  return <div ref={containerRef} className="draft-editor h-full min-h-0" />;
});
