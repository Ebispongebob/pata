import test from 'node:test';
import assert from 'node:assert/strict';
import { componentCallbacks } from '../scripts/componentCallbacks.ts';

const callback = componentCallbacks(new URL('./TaskDetailPanel.tsx', import.meta.url));

test('Copy for Agent uses the stable task URI, without MCP setup prose', async () => {
  const copied: string[] = [];
  const menu: boolean[] = [];
  const feedback: boolean[] = [];
  const errors: string[] = [];
  let timeout: (() => void) | undefined;
  const context = {
    taskId: 't-01abc',
    Clipboard: { SetText: async (text: string) => { copied.push(text); } },
    setMenuOpen: (value: boolean) => menu.push(value),
    setCopiedForAgent: (value: boolean) => feedback.push(value),
    setDetailError: (message: string) => errors.push(message),
    copyFeedbackTimerRef: { current: null },
    window: {
      clearTimeout: () => {},
      setTimeout: (fn: () => void, ms: number) => {
        assert.equal(ms, 2000);
        timeout = fn;
        return 1;
      },
    },
  };
  await callback('handleCopyForAgent', context)();
  assert.deepEqual(copied, ['处理这个任务：pata://task/t-01abc']);
  assert.deepEqual(menu, [false]);
  assert.deepEqual(feedback, [true]);
  assert.deepEqual(errors, []);
  timeout?.();
  assert.deepEqual(feedback, [true, false]);
});

test('Clipboard failure explains what happened without reporting a successful copy', async () => {
  const feedback: boolean[] = [];
  const errors: string[] = [];
  await callback('handleCopyForAgent', {
    taskId: 't-01abc',
    Clipboard: { SetText: async () => { throw new Error('clipboard denied'); } },
    setMenuOpen: () => {},
    setCopiedForAgent: (value: boolean) => feedback.push(value),
    setDetailError: (message: string) => errors.push(message),
    copyFeedbackTimerRef: { current: null },
  })();
  assert.deepEqual(feedback, []);
  assert.deepEqual(errors, ['复制给 Agent 失败，请重试']);
});
