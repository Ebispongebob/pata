import type Vditor from 'vditor';

/** 沿用 Vditor 的历史栈，在快捷键执行前收录尚未结束防抖的编辑。 */
export function bindVditorHistory(editor: Vditor): () => void {
  const state = editor.vditor;
  const ir = state.ir;
  const history = state.undo;
  if (!ir || !history) return () => {};

  let recordedMarkdown = editor.getValue();
  const addToUndoStack = history.addToUndoStack;
  history.addToUndoStack = (currentState) => {
    addToUndoStack.call(history, currentState);
    recordedMarkdown = editor.getValue();
  };

  // 初始正文也必须立即入栈，否则刚打开就编辑时会丢失撤销基线。
  window.clearTimeout(ir.processTimeoutId);
  editor.clearStack();

  const onKeyDown = (event: KeyboardEvent) => {
    const modifier = /Mac/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
    const key = event.key.toLowerCase();
    const undo = key === 'z' && !event.shiftKey;
    const redo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey);
    if (!modifier || event.altKey || (!undo && !redo) || event.isComposing ||
        event.keyCode === 229 || ir.composingLock || state.currentMode !== 'ir' ||
        ir.element.getAttribute('contenteditable') !== 'true') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.clearTimeout(ir.processTimeoutId);
    if (editor.getValue() !== recordedMarkdown) {
      history.addToUndoStack(state);
    }
    if (undo) history.undo(state);
    else history.redo(state);
    recordedMarkdown = editor.getValue();
    // 连续撤销或无可重做内容时，也要把最终正文交给原有保存与引用流程。
    state.options.input?.(recordedMarkdown);
  };

  ir.element.addEventListener('keydown', onKeyDown, true);
  return () => {
    ir.element.removeEventListener('keydown', onKeyDown, true);
    window.clearTimeout(ir.processTimeoutId);
    history.addToUndoStack = addToUndoStack;
  };
}
