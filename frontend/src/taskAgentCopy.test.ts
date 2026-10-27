import test from 'node:test';
import assert from 'node:assert/strict';
import { componentCallbacks } from '../scripts/componentCallbacks.ts';

const callback = componentCallbacks(new URL('./TaskDetailPanel.tsx', import.meta.url));
const isMCPReadyForAgent = callback('isMCPReadyForAgent');

test('Copy for Agent is available only while MCP is enabled, running, and on the current vault', () => {
  assert.equal(isMCPReadyForAgent({ enabled: true, running: true, vaultChanged: false }), true);
  assert.equal(isMCPReadyForAgent({ enabled: false, running: false, vaultChanged: false }), false);
  assert.equal(isMCPReadyForAgent({ enabled: true, running: false, vaultChanged: false }), false);
  assert.equal(isMCPReadyForAgent({ enabled: true, running: true, vaultChanged: true }), false);
});

test('Copy for Agent uses the stable task URI, without MCP setup prose', async () => {
  const copied: string[] = [];
  const menu: boolean[] = [];
  const feedback: boolean[] = [];
  const errors: string[] = [];
  let timeout: (() => void) | undefined;
  const context = {
    taskId: 't-01abc',
    MCPService: { GetStatus: async () => ({ enabled: true, running: true, vaultChanged: false }) },
    isMCPReadyForAgent,
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

test('Copy for Agent refuses to copy when MCP stops or switches vault after the menu opened', async () => {
  for (const status of [
    { enabled: true, running: false, vaultChanged: false },
    { enabled: true, running: true, vaultChanged: true },
  ]) {
    const copied: string[] = [];
    const errors: string[] = [];
    await callback('handleCopyForAgent', {
      taskId: 't-01abc',
      MCPService: { GetStatus: async () => status },
      isMCPReadyForAgent,
      Clipboard: { SetText: async (text: string) => { copied.push(text); } },
      setMenuOpen: () => {},
      setCopiedForAgent: () => {},
      setDetailError: (message: string) => errors.push(message),
      copyFeedbackTimerRef: { current: null },
    })();
    assert.deepEqual(copied, []);
    assert.deepEqual(errors, ['MCP 服务未就绪，请先在设置中启动或重启服务']);
  }
});

test('Clipboard failure explains what happened without reporting a successful copy', async () => {
  const feedback: boolean[] = [];
  const errors: string[] = [];
  await callback('handleCopyForAgent', {
    taskId: 't-01abc',
    MCPService: { GetStatus: async () => ({ enabled: true, running: true, vaultChanged: false }) },
    isMCPReadyForAgent,
    Clipboard: { SetText: async () => { throw new Error('clipboard denied'); } },
    setMenuOpen: () => {},
    setCopiedForAgent: (value: boolean) => feedback.push(value),
    setDetailError: (message: string) => errors.push(message),
    copyFeedbackTimerRef: { current: null },
  })();
  assert.deepEqual(feedback, []);
  assert.deepEqual(errors, ['检查 MCP 状态或复制失败，请重试']);
});
