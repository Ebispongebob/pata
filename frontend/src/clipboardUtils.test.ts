import test from 'node:test';
import assert from 'node:assert/strict';
import { copyToClipboard } from './clipboardUtils.ts';

test('copyToClipboard: executes without uncaught exceptions and handles fallbacks', async () => {
  // In Node.js environment without browser DOM or Wails IPC, should return false gracefully
  const res = await copyToClipboard('test text');
  assert.equal(typeof res, 'boolean');
});
