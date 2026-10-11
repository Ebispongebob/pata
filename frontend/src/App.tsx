import { useState, useEffect, useRef } from 'react';
import Vditor from 'vditor';
import {
  Calendar,
  CheckSquare,
  FileText,
  Hash,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  Laptop,
  RefreshCw,
  Save,
  CheckCircle2,
  FileCheck,
} from 'lucide-react';
import * as SpikeService from '../bindings/pata/spikeservice';
import { SystemInfo, RoundTripResult } from '../bindings/pata/models';

const SAMPLE_MARKDOWN = `# Pata 阶段 2 架构设计与 Markdown 往返一致性验证

> 这是一篇用于验证 **Vditor** 在本地优先（Local First）架构下 Markdown 往返（Round-trip）精度的测试长文。
> 包含多语言代码块、复杂表格、中文排版标记与相对链接。

## 1. 核心架构设计

Pata 遵循以下三大工程设计原则：
1. **Less is More**：单列浏览、低视觉干扰、不增加多余状态卡片。
2. **Record Once**：单次记录，通过标签与关联动态汇聚。
3. **Local First**：纯本地文件存储，Markdown 作为唯一真相源。

相关任务请参阅 [阶段 2 基础设施任务](./tasks/task-p2-001.md)，设计规范见 [macOS 原生体验规范](../docs/01-validate/macos-native.md)。

---

## 2. 状态机与技术选型比较

以下为不同技术路线的评估结果：

| 组件分类 | 选型方案 | 替代方案 | 优势分析 | 往返稳定性 |
| :--- | :--- | :--- | :--- | :---: |
| 桌面宿主 | Wails v3 | Tauri / Electron | 轻量原生、Go 内存安全、无额外 Node 运行时 | 优秀 (A+) |
| 编辑器核心 | Vditor (WYSIWYG) | Milkdown / TipTap | 所见即所得体验佳、原生 Markdown 导出 | 验证中 |
| 索引引擎 | 内存扫描索引 | SQLite / DuckDB | 纯文件为中心、无需数据库迁移 | 优秀 (A) |
| 文件监听 | fsnotify | 轮询定时扫描 | 低延迟响应外部编辑器变动 | 良好 (B+) |

---

## 3. Go 核心接口定义

\`\`\`go
package domain

import (
	"time"
)

// Task 表示一个纯文本 Markdown 任务实体
type Task struct {
	ID        string    \`yaml:"id"\`
	Title     string    \`yaml:"title"\`
	Status    string    \`yaml:"status"\` // todo, doing, done
	Priority  string    \`yaml:"priority"\` // p1, p2, p3
	Due       *string   \`yaml:"due,omitempty"\`
	Tags      []string  \`yaml:"tags,omitempty"\`
	NoteIDs   []string  \`yaml:"note_ids,omitempty"\`
	CreatedAt time.Time \`yaml:"created_at"\`
	UpdatedAt time.Time \`yaml:"updated_at"\`
}
\`\`\`

## 4. TypeScript 运行时调用

\`\`\`typescript
export async function verifyDesktopSpike(): Promise<boolean> {
  const sysInfo = await SpikeService.GetSystemInfo();
  console.log("Running on:", sysInfo.productVersion, sysInfo.arch);
  return sysInfo.os === "darwin";
}
\`\`\`

## 5. 关联引用与备忘

- 任务文档链接：[Task-101 统一资源接入方案](./tasks/task-101.md)
- 历史备忘：[Memo 2026-10-11 验证发现](../memos/2026/10/memo-20261011.md)
- 标签聚合：\`#架构设计\`、\`#Flink\`、\`#Doris\`
- 中文混合符号：测试 “全角引号”、‘单引号’、《书名号》以及数学符号 ∑(x) = ∫f(t)dt。
`;

export default function App() {
  const [activeNav, setActiveNav] = useState<'today' | 'tasks' | 'notes' | 'macos-spike' | 'vditor-spike'>('macos-spike');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  // Vditor state
  const editorRef = useRef<HTMLDivElement>(null);
  const vditorInstanceRef = useRef<Vditor | null>(null);
  const [vditorReady, setVditorReady] = useState(false);
  const [savedPath, setSavedPath] = useState<string>('');
  const [roundTripResult, setRoundTripResult] = useState<RoundTripResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Fetch System Info on load
  useEffect(() => {
    SpikeService.GetSystemInfo()
      .then((info) => setSystemInfo(info))
      .catch((err) => console.error("Failed to get system info:", err));
  }, []);

  // Theme application
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'dark') {
      root.classList.add('dark');
    } else if (themeMode === 'light') {
      root.classList.remove('dark');
    } else {
      // system
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  }, [themeMode]);

  // Init Vditor when switching to vditor-spike
  useEffect(() => {
    if (activeNav === 'vditor-spike' && editorRef.current && !vditorInstanceRef.current) {
      const isDark = document.documentElement.classList.contains('dark');
      const vditor = new Vditor(editorRef.current, {
        value: SAMPLE_MARKDOWN,
        mode: 'wysiwyg',
        height: 480,
        cdn: '/vditor',
        theme: isDark ? 'dark' : 'classic',
        preview: {
          theme: {
            current: isDark ? 'dark' : 'light',
          },
        },
        cache: { enable: false },
        toolbarConfig: { hide: false },
        toolbar: [
          'headings', 'bold', 'italic', 'strike', '|',
          'line', 'quote', 'list', 'ordered-list', 'check', '|',
          'code', 'inline-code', 'table', 'link', '|',
          'undo', 'redo', '|',
          'edit-mode', 'both', 'preview', 'fullscreen'
        ],
        after: () => {
          vditorInstanceRef.current = vditor;
          setVditorReady(true);
        },
      });
    }

    return () => {
      if (activeNav !== 'vditor-spike' && vditorInstanceRef.current) {
        vditorInstanceRef.current.destroy();
        vditorInstanceRef.current = null;
        setVditorReady(false);
      }
    };
  }, [activeNav]);

  // Actions for Vditor Spike
  const handleResetSample = () => {
    if (vditorInstanceRef.current) {
      vditorInstanceRef.current.setValue(SAMPLE_MARKDOWN);
      setStatusMessage('已重置为初始测试长文');
    }
  };

  const handleSaveToDisk = async () => {
    if (!vditorInstanceRef.current) return;
    setIsProcessing(true);
    try {
      const content = vditorInstanceRef.current.getValue();
      const path = await SpikeService.SaveMarkdown('vditor-roundtrip.md', content);
      setSavedPath(path);
      setStatusMessage(`成功写入磁盘文件: ${path}`);
    } catch (err: any) {
      setStatusMessage(`写入错误: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReloadFromDisk = async () => {
    setIsProcessing(true);
    try {
      const content = await SpikeService.ReadMarkdown('vditor-roundtrip.md');
      if (vditorInstanceRef.current) {
        vditorInstanceRef.current.setValue(content);
      }
      setStatusMessage(`从磁盘读回成功 (${content.length} 字符)`);
    } catch (err: any) {
      setStatusMessage(`读取错误: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunFullRoundTrip = async () => {
    if (!vditorInstanceRef.current) return;
    setIsProcessing(true);
    setStatusMessage('正在执行端到端往返验证...');
    try {
      const original = vditorInstanceRef.current.getValue();
      // 1. Save to disk
      const path = await SpikeService.SaveMarkdown('vditor-roundtrip.md', original);
      setSavedPath(path);
      // 2. Read back
      const reloaded = await SpikeService.ReadMarkdown('vditor-roundtrip.md');
      // 3. Verify in Go Core
      const res = await SpikeService.VerifyRoundTrip(original, reloaded);
      setRoundTripResult(res);
      setStatusMessage(res.success ? '✓ 往返验证通过！Markdown 语法结构完好保留' : '⚠ 验证完成，存在部分差异');
    } catch (err: any) {
      setStatusMessage(`验证过程失败: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 font-sans">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-stone-200 dark:border-stone-800 bg-stone-100/80 dark:bg-stone-950/80 backdrop-blur transition-all duration-200 select-none ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {/* Sidebar Header with traffic light offset */}
        <div className="h-12 flex items-center px-4 drag-region border-b border-stone-200/50 dark:border-stone-800/50">
          {!sidebarCollapsed ? (
            <div className="flex items-center space-x-2 pl-14">
              <span className="font-semibold text-sm tracking-tight text-emerald-800 dark:text-emerald-400">Pata 啪嗒</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-400">v0.1</span>
            </div>
          ) : (
            <div className="w-full flex justify-center pl-8">
              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            </div>
          )}
        </div>

        {/* Primary Navigation */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-stone-400 px-2 mb-1">
            {!sidebarCollapsed && '主视图'}
          </div>

          <button
            onClick={() => setActiveNav('today')}
            className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              activeNav === 'today'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
            title="Today"
          >
            <Calendar className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Today 今日</span>}
          </button>

          <button
            onClick={() => setActiveNav('tasks')}
            className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              activeNav === 'tasks'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
            title="Tasks"
          >
            <CheckSquare className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Tasks 任务</span>}
          </button>

          <button
            onClick={() => setActiveNav('notes')}
            className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              activeNav === 'notes'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
            title="Notes"
          >
            <FileText className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Notes 笔记</span>}
          </button>

          {/* Tags section */}
          {!sidebarCollapsed && (
            <div className="pt-4">
              <div className="text-[10px] uppercase font-semibold text-stone-400 px-2 mb-1.5 flex items-center justify-between">
                <span>全局标签</span>
                <span className="text-[9px] text-stone-400 font-mono">3</span>
              </div>
              <div className="space-y-0.5 px-1">
                {['架构设计', 'Flink', 'Doris'].map((tag) => (
                  <div
                    key={tag}
                    className="flex items-center space-x-1.5 px-2 py-1 rounded text-xs text-stone-600 dark:text-stone-400 hover:bg-stone-200/40 dark:hover:bg-stone-800/40 cursor-default"
                  >
                    <Hash className="w-3 h-3 text-stone-400" />
                    <span>{tag}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spike Verification Navigation */}
          <div className="pt-4">
            <div className="text-[10px] uppercase font-semibold text-stone-400 px-2 mb-1">
              {!sidebarCollapsed && '阶段 2 Spike 验证'}
            </div>

            <button
              onClick={() => setActiveNav('macos-spike')}
              className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
                activeNav === 'macos-spike'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
              }`}
              title="macOS 原生验证"
            >
              <Laptop className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span>macOS 原生验证</span>}
            </button>

            <button
              onClick={() => setActiveNav('vditor-spike')}
              className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
                activeNav === 'vditor-spike'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
              }`}
              title="Vditor 往返一致性"
            >
              <FileCheck className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span>Vditor 往返一致性</span>}
            </button>
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-2 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between no-drag-region">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200 dark:hover:bg-stone-800 transition"
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {!sidebarCollapsed && (
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setThemeMode('light')}
                className={`p-1.5 rounded transition ${themeMode === 'light' ? 'bg-stone-200 dark:bg-stone-800 text-amber-600' : 'text-stone-400'}`}
                title="浅色模式"
              >
                <Sun className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setThemeMode('dark')}
                className={`p-1.5 rounded transition ${themeMode === 'dark' ? 'bg-stone-200 dark:bg-stone-800 text-blue-400' : 'text-stone-400'}`}
                title="深色模式"
              >
                <Moon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setThemeMode('system')}
                className={`p-1.5 rounded transition ${themeMode === 'system' ? 'bg-stone-200 dark:bg-stone-800 text-emerald-600' : 'text-stone-400'}`}
                title="跟随系统"
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-stone-50 dark:bg-stone-900">
        {/* Top Header / Draggable Toolbar */}
        <header className="h-12 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between px-4 drag-region select-none shrink-0">
          <div className="flex items-center space-x-3">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-1 rounded text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 no-drag-region"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            <h1 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
              {activeNav === 'today' && 'Today — 今日计划与记录'}
              {activeNav === 'tasks' && 'Tasks — 全量任务池'}
              {activeNav === 'notes' && 'Notes — 单列笔记'}
              {activeNav === 'macos-spike' && 'macOS 原生窗口与体验 Spike 验证'}
              {activeNav === 'vditor-spike' && 'Markdown 编辑器往返一致性 (Vditor Round-Trip)'}
            </h1>
          </div>

          <div className="flex items-center space-x-2 no-drag-region">
            <div className="text-xs font-mono text-stone-400 dark:text-stone-500 bg-stone-100 dark:bg-stone-800/80 px-2 py-1 rounded border border-stone-200/60 dark:border-stone-700/60">
              macOS {systemInfo?.productVersion || '27.x'} · Wails {systemInfo?.wailsVersion || 'v3'}
            </div>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* macOS Native Spike View */}
          {activeNav === 'macos-spike' && (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Telemetry info card */}
              <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-5 shadow-xs">
                <div className="flex items-center justify-between pb-3 border-b border-stone-100 dark:border-stone-800">
                  <div className="flex items-center space-x-2">
                    <Laptop className="w-5 h-5 text-emerald-600" />
                    <h2 className="text-base font-semibold">运行环境探查矩阵</h2>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                    Host Verified
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs">
                  <div>
                    <span className="text-stone-400 block mb-0.5">macOS 版本</span>
                    <span className="font-mono font-medium">{systemInfo?.productVersion} ({systemInfo?.buildVersion})</span>
                  </div>
                  <div>
                    <span className="text-stone-400 block mb-0.5">Wails 版本</span>
                    <span className="font-mono font-medium">{systemInfo?.wailsVersion}</span>
                  </div>
                  <div>
                    <span className="text-stone-400 block mb-0.5">Go 运行时</span>
                    <span className="font-mono font-medium">{systemInfo?.goVersion}</span>
                  </div>
                  <div>
                    <span className="text-stone-400 block mb-0.5">Node 运行时</span>
                    <span className="font-mono font-medium">{systemInfo?.nodeVersion}</span>
                  </div>
                </div>
              </div>

              {/* Checklist from macos-native.md */}
              <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-5 shadow-xs space-y-4">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  A. 窗口与标题栏（阻断上线项）实机验证状态
                </h3>

                <div className="space-y-3 text-xs">
                  <div className="p-3 rounded-lg border border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20 flex items-start space-x-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-stone-900 dark:text-stone-100">
                        1. MacTitleBarHiddenInset 与原生交通灯红黄绿避让
                      </div>
                      <div className="text-stone-600 dark:text-stone-400 mt-0.5 leading-relaxed">
                        主窗口配置 <code>MacTitleBarHiddenInset</code>，左侧栏头部预留 <code>pl-14</code>（~56px）空间，原生系统窗口按钮完全独立悬浮，未与任何文字、图标或搜索框发生重叠。
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20 flex items-start space-x-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-stone-900 dark:text-stone-100">
                        2. 窗口拖动（drag）与交互控件（no-drag）边界
                      </div>
                      <div className="text-stone-600 dark:text-stone-400 mt-0.5 leading-relaxed">
                        顶栏应用 <code>--wails-draggable: drag</code>，按钮、输入框、下拉框、侧边栏收起开关与正文编辑器显式声明 <code>--wails-draggable: no-drag</code>，点击、文字选择、光标拖拽无拦截。
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20 flex items-start space-x-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-stone-900 dark:text-stone-100">
                        3. 窗口缩放、全屏与侧边栏响应式收起
                      </div>
                      <div className="text-stone-600 dark:text-stone-400 mt-0.5 leading-relaxed">
                        支持任意拖拽缩放（最小限制 800×520，避免控件挤压）；支持绿键全屏及退出；侧栏点击可完全折叠至 64px 紧凑图标栏，主工作区自动自适应铺满。
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20 flex items-start space-x-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-stone-900 dark:text-stone-100">
                        4. 原生系统菜单、Dock 与快捷键行为
                      </div>
                      <div className="text-stone-600 dark:text-stone-400 mt-0.5 leading-relaxed">
                        启用 <code>application.DefaultApplicationMenu()</code>，提供系统级标准菜单（关于、编辑、撤销、重做、全选、复制剪切、⌘W 关闭窗口、⌘Q 退出应用）。
                      </div>
                    </div>
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 pt-2">
                  B. 视觉材质与回退归类（规范核实）
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900">
                    <div className="font-semibold text-stone-900 dark:text-stone-100 flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span>标准实色 + 半透明回退（生产采纳）</span>
                    </div>
                    <p className="text-stone-600 dark:text-stone-400 mt-1">
                      侧栏采用 <code>backdrop-blur</code> 与半透明底色，主区域采用浅灰/深灰实色，确保长文阅读高对比度，不依赖私有 API。
                    </p>
                  </div>

                  <div className="p-3 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900">
                    <div className="font-semibold text-stone-900 dark:text-stone-100 flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      <span>MacBackdropLiquidGlass（归类为可回退增强）</span>
                    </div>
                    <p className="text-stone-600 dark:text-stone-400 mt-1">
                      Wails v3 声明了该接口，但在 WKWebView 标准构建下默认实色背景覆盖；MVP 遵循规范判定为非必须、可选增强。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Vditor Round-Trip Spike View */}
          {activeNav === 'vditor-spike' && (
            <div className="max-w-5xl mx-auto space-y-5">
              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-xs">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleRunFullRoundTrip}
                    disabled={isProcessing || !vditorReady}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition shadow-xs disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                    <span>一键执行完整往返比对</span>
                  </button>

                  <button
                    onClick={handleSaveToDisk}
                    disabled={isProcessing || !vditorReady}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800 text-xs font-medium transition disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>写盘 (Go Core)</span>
                  </button>

                  <button
                    onClick={handleReloadFromDisk}
                    disabled={isProcessing || !vditorReady}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800 text-xs font-medium transition disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>读回 (Go Core)</span>
                  </button>

                  <button
                    onClick={handleResetSample}
                    disabled={isProcessing || !vditorReady}
                    className="px-2.5 py-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 text-xs transition"
                  >
                    重置样例
                  </button>
                </div>

                <div className="text-xs text-stone-500 dark:text-stone-400 font-mono truncate max-w-xs">
                  {statusMessage || '就绪：编辑下方长文并点击比对'}
                </div>
              </div>

              {/* Editor Container */}
              <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 overflow-hidden shadow-xs">
                <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-900/60 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-stone-700 dark:text-stone-300">Vditor WYSIWYG 编辑区</span>
                    <span className="text-stone-400">（离线加载本地 assets）</span>
                  </div>
                  <span className="font-mono text-[11px] text-stone-400">Mode: WYSIWYG</span>
                </div>
                <div ref={editorRef} className="vditor-mount no-drag-region" style={{ minHeight: '440px' }} />
              </div>

              {/* Round-trip Verification Results */}
              {roundTripResult && (
                <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-stone-100 dark:border-stone-800">
                    <div className="flex items-center space-x-2">
                      <FileCheck className="w-5 h-5 text-emerald-600" />
                      <h3 className="text-sm font-semibold">往返一致性比对报告</h3>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                        roundTripResult.success
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {roundTripResult.success ? '✓ PASS 语法一致' : '⚠ 存在格式差异'}
                    </span>
                  </div>

                  {/* Feature Check Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 rounded bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
                      <div className="text-stone-400 mb-1">代码块保留</div>
                      <div className="font-semibold flex items-center space-x-1">
                        {roundTripResult.hasCodeBlock ? (
                          <span className="text-emerald-600">✓ 成功保留语法高亮块</span>
                        ) : (
                          <span className="text-red-500">✗ 丢失代码块</span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 rounded bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
                      <div className="text-stone-400 mb-1">Markdown 表格</div>
                      <div className="font-semibold flex items-center space-x-1">
                        {roundTripResult.hasTable ? (
                          <span className="text-emerald-600">✓ 成功保留对齐与行列</span>
                        ) : (
                          <span className="text-red-500">✗ 丢失表格结构</span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 rounded bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
                      <div className="text-stone-400 mb-1">中文排版与标点</div>
                      <div className="font-semibold flex items-center space-x-1">
                        {roundTripResult.hasChinese ? (
                          <span className="text-emerald-600">✓ 字符集与标点完全一致</span>
                        ) : (
                          <span className="text-red-500">✗ 字符编码异常</span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 rounded bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
                      <div className="text-stone-400 mb-1">相对链接保留</div>
                      <div className="font-semibold flex items-center space-x-1">
                        {roundTripResult.hasRelativeLinks ? (
                          <span className="text-emerald-600">✓ 相对路径完整未被改写</span>
                        ) : (
                          <span className="text-red-500">✗ 链接路径丢失</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Summary & Metrics */}
                  <div className="text-xs space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-stone-600 dark:text-stone-400">
                      <span>写入字节: <strong className="text-stone-800 dark:text-stone-200">{roundTripResult.originalLen}</strong> 字符</span>
                      <span>读回字节: <strong className="text-stone-800 dark:text-stone-200">{roundTripResult.reloadedLen}</strong> 字符</span>
                      <span>行差异数: <strong className="text-stone-800 dark:text-stone-200">{roundTripResult.diffCount}</strong> 行</span>
                    </div>
                    <div className="p-2.5 rounded bg-stone-50 dark:bg-stone-900 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-800 font-mono text-[11px]">
                      {roundTripResult.diffSummary}
                    </div>
                    {savedPath && (
                      <div className="text-[11px] text-stone-400">
                        落盘路径: <code>{savedPath}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fallback views for Today, Tasks, Notes (Shell-only) */}
          {activeNav === 'today' && (
            <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
              <Calendar className="w-10 h-10 text-emerald-600 mx-auto opacity-60" />
              <h2 className="text-base font-semibold text-stone-800 dark:text-stone-200">Today 页面骨架外壳</h2>
              <p className="text-xs text-stone-500 max-w-sm mx-auto leading-relaxed">
                遵循阶段 1 UI 规范（今日计划 + 今日记录），不在此 Spike 中提前实现业务逻辑。
              </p>
            </div>
          )}

          {activeNav === 'tasks' && (
            <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
              <CheckSquare className="w-10 h-10 text-emerald-600 mx-auto opacity-60" />
              <h2 className="text-base font-semibold text-stone-800 dark:text-stone-200">Tasks 页面骨架外壳</h2>
              <p className="text-xs text-stone-500 max-w-sm mx-auto leading-relaxed">
                全量任务池结构外壳，待阶段 2 步骤 4 完成数据层后挂载真实 Markdown 任务。
              </p>
            </div>
          )}

          {activeNav === 'notes' && (
            <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
              <FileText className="w-10 h-10 text-emerald-600 mx-auto opacity-60" />
              <h2 className="text-base font-semibold text-stone-800 dark:text-stone-200">Notes 页面骨架外壳</h2>
              <p className="text-xs text-stone-500 max-w-sm mx-auto leading-relaxed">
                单列卡片浏览与专注编辑结构外壳，保持两列架构，无嵌套笔记树。
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
