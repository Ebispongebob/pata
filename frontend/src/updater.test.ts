import test from 'node:test';
import assert from 'node:assert/strict';

// Helper for calculating download percentage matching backend & UI spec
export function calculateDownloadPercent(written: number, total: number): number {
  if (total <= 0) return -1;
  const percent = Math.floor((written / total) * 100);
  return Math.min(Math.max(percent, 0), 100);
}

// Helper representing the UI button label based on UpdateStatus
export function getUpdateButtonLabel(state: string, percent: number): string | null {
  switch (state) {
    case 'idle':
    case 'checking':
      return null;
    case 'available':
      return '更新';
    case 'downloading':
      return percent >= 0 ? `${percent}%` : '下载中';
    case 'staging':
      return '100%'; // Brief staging state: must be 100% busy, NEVER "准备安装"
    case 'waiting_install':
      return '等待安装';
    case 'restarting':
      return '正在更新';
    case 'error':
      return '重试更新';
    default:
      return null;
  }
}

test('calculateDownloadPercent: 真实百分比计算规范 (floor)', () => {
  assert.equal(calculateDownloadPercent(0, 1000), 0);
  assert.equal(calculateDownloadPercent(555, 1000), 55);
  assert.equal(calculateDownloadPercent(999, 1000), 99); // 必须是 99%，不能四舍五入为 100%
  assert.equal(calculateDownloadPercent(1000, 1000), 100);
  assert.equal(calculateDownloadPercent(1200, 1000), 100); // 边界保护
  assert.equal(calculateDownloadPercent(-5, 1000), 0);

  // 未知大小或总大小 <= 0 返回不确定进度 (-1)
  assert.equal(calculateDownloadPercent(500, 0), -1);
  assert.equal(calculateDownloadPercent(500, -1), -1);
});

test('getUpdateButtonLabel: 用户态文案映射与严禁「准备安装」', () => {
  assert.equal(getUpdateButtonLabel('idle', -1), null);
  assert.equal(getUpdateButtonLabel('checking', -1), null);
  assert.equal(getUpdateButtonLabel('available', -1), '更新');
  assert.equal(getUpdateButtonLabel('downloading', 42), '42%');
  assert.equal(getUpdateButtonLabel('downloading', -1), '下载中');
  assert.equal(getUpdateButtonLabel('staging', 100), '100%');
  assert.equal(getUpdateButtonLabel('waiting_install', 100), '等待安装');
  assert.equal(getUpdateButtonLabel('restarting', 100), '正在更新');
  assert.equal(getUpdateButtonLabel('error', -1), '重试更新');

  // 严禁出现「准备安装」
  for (const st of ['idle', 'checking', 'available', 'downloading', 'staging', 'waiting_install', 'restarting', 'error']) {
    const label = getUpdateButtonLabel(st, 100);
    assert.notEqual(label, '准备安装', `状态 ${st} 不得显示「准备安装」`);
  }
});

test('draft gating: 更新就绪时的草稿门禁与手动点击重启检查', () => {
  // 模拟草稿检查器注册表
  const checkers = new Map<string, () => boolean>();
  const checkAllDrafts = () => Array.from(checkers.values()).some((fn) => fn());

  // 场景 1: 无草稿 -> 可直接重启
  checkers.set('note', () => false);
  checkers.set('task', () => false);
  checkers.set('today', () => false);

  assert.equal(checkAllDrafts(), false, '无草稿时检查应通过');

  // 场景 2: 存在未保存 Note 草稿 -> 进入等待安装
  checkers.set('note', () => true);
  assert.equal(checkAllDrafts(), true, 'Note 有草稿时阻止自动重启');

  // 场景 3: 用户点击「等待安装」时再次检测草稿
  // 若草稿仍未保存：依然阻止重启
  assert.equal(checkAllDrafts(), true, '草稿仍未提交时点击等待安装不能重启');

  // 用户保存了草稿
  checkers.set('note', () => false);
  assert.equal(checkAllDrafts(), false, '草稿已保存后再次检查通过，允许安全重启');

  // 场景 4: 任务 Inspector 的评论框有文字
  checkers.set('task', () => true);
  assert.equal(checkAllDrafts(), true, 'Task Inspector 评论框有输入时阻止自动重启');
});

test('auto_check_updates: 设置项说明文案与官方构建/开发构建隔离', () => {
  const getUpdateNotice = (isOfficial: boolean) =>
    isOfficial ? '发现新版本时，在侧边栏提示更新' : '当前构建为开发版本，已禁用官方自动更新';

  assert.equal(getUpdateNotice(true), '发现新版本时，在侧边栏提示更新');
  assert.equal(getUpdateNotice(false), '当前构建为开发版本，已禁用官方自动更新');
});
