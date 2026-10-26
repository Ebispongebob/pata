import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('侧栏收起状态记忆与偏好持久化', () => {
  const appPath = path.resolve(__dirname, 'App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf-8');

  // 1. 初始化偏好读取与异常回退
  assert.ok(
    appContent.includes("localStorage.getItem('pata_sidebar_collapsed') === 'true'"),
    '应从 localStorage 读取 pata_sidebar_collapsed 作为初始状态'
  );

  // 2. 状态变更持久化
  assert.ok(
    appContent.includes("localStorage.setItem('pata_sidebar_collapsed', String(sidebarCollapsed))"),
    '侧栏状态变化时应持久化至 localStorage'
  );

  // 3. 收起宽度固定 88px，展开使用动态宽度
  assert.ok(
    appContent.includes('sidebarCollapsed ? 88 : sidebarWidth'),
    '收起时宽度应固定为 88px，展开时使用 sidebarWidth'
  );
});

test('侧栏收起交互规范：避让交通灯、防透底遮罩、标签展开与设计规范', () => {
  const appPath = path.resolve(__dirname, 'App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf-8');

  // 收起按钮防透底遮罩
  assert.ok(
    appContent.includes('backdrop-blur') && appContent.includes('bg-stone-100'),
    '收起切换按钮在折叠状态下应具备不透明/半透明遮罩背景，防止内容滚动时透底'
  );

  // 顶部拖拽条跨越主内容区，避免窄栏无法拖动窗口
  assert.ok(
    appContent.includes('drag-region') && appContent.includes('top-1'),
    '顶部应包含贯穿工作区的 drag-region，确保侧栏收起时窗口仍可正常拖拽'
  );

  // 标签高亮使用语义 Token 而非硬编码 Tailwind 绿
  assert.ok(
    !appContent.includes('bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-900'),
    '收起态标签按钮不应硬编码 emerald 颜色'
  );
  assert.ok(
    appContent.includes("activeNav === 'tag'") && appContent.includes('var(--pata-brand)'),
    '收起态标签按钮在 active 时应使用 var(--pata-brand) 语义 Token'
  );

  // 标签点击应展开侧栏
  assert.ok(
    appContent.includes('setSidebarCollapsed(false)'),
    '收起状态下的标签按钮点击应展开侧栏'
  );
});

test('工作区页面顶部工具栏支持原生窗口拖拽', () => {
  const todayPath = path.resolve(__dirname, 'TodayView.tsx');
  const todayContent = fs.readFileSync(todayPath, 'utf-8');
  assert.ok(
    todayContent.includes('drag-region') && todayContent.includes('no-drag-region'),
    'TodayView DateBar 应包含 drag-region 与 no-drag-region 交互保护'
  );

  const taskDetailPath = path.resolve(__dirname, 'TaskDetailPanel.tsx');
  const taskDetailContent = fs.readFileSync(taskDetailPath, 'utf-8');
  assert.ok(
    taskDetailContent.includes('drag-region') && taskDetailContent.includes('no-drag-region'),
    'TaskDetailPanel 顶部工具栏应支持原生拖拽'
  );
});
