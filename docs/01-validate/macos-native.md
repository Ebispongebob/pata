# macOS 原生体验与 Magpie 参考 — 阶段 1

> 定位：**设计约束 + 工程验证清单**，不是已实现功能。目标视觉语言参考 macOS 27 与 Apple HIG；首发是 macOS，但最低支持系统版本由阶段 2 的构建测试决定。此文档属于 `01-validate`，不要再创建按平台或技术模块划分的 `docs` 目录。
>
> 决策：借鉴 Magpie 的 **macOS 窗口融合和交互细节**，不复制其业务导航；借鉴 Flomo 的 **Notes 单列内容浏览**，不复制其短记录产品模型。保留 Pata 的 **Today / Tasks / Notes** 三入口。

## 1. 原则：内容优先，而非到处铺玻璃

- **原生窗口优先**：真实的 macOS 交通灯、窗口拖动、缩放、全屏、Dock、菜单栏和系统快捷键；不要用三个 HTML 圆点假装系统窗口按钮。
- **导航/控件与内容分层**：侧边栏、工具栏、弹出菜单可以使用系统材质或克制的半透明效果；Task 列表、Memo 时间线、Notes 正文等内容层优先不透明背景和清晰文字。
- **系统偏好优先**：系统浅/深色、强调色、减少动态效果、减少透明度、提高对比度。绿色可以是品牌识别色，**不应强制所有侧边栏选中态和系统控件使用森林绿**。
- **桌面交互优先**：键盘导航、焦点状态、右键菜单、窗口大小变化、原生菜单栏、支持收起侧边栏；不把 iPhone 交互照搬到 Mac。
- **少即是多**：视觉更新不能导致新增常驻栏、更多层级、重卡片、高密度仪表盘或不必要的动效。

Apple 设计依据：

- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/)：窗口可调整、菜单栏、精准指针和键盘操作。
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)：Liquid Glass 主要表达导航/控制层级；不应该铺在内容层。
- [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)：系统强调色、可收起侧边栏、适配窗口宽度。
- [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)：导航、搜索、操作归于顶部工具栏，避免堆叠。

## 2. Magpie 源码核查（技术参考而非 UI 复刻）

参考仓库：[yetone/magpie](https://github.com/yetone/magpie)，核对日期：2026-10-11。其 `go.mod` 采用 Go + Wails v3 `v3.0.0-beta.24`；前端主要是原生 HTML、JS、CSS。Pata 继续采用 Go + Wails v3 + React/TypeScript + Tailwind/shadcn，不因参考 Magpie 而改用原生 JS。

| 具体做法 | Magpie 代码证据 | Pata 结论 |
|---|---|---|
| 主窗口使用 `MacTitleBarHiddenInset`，窗口内容延伸到标题栏区域 | [mainwindow.go](https://github.com/yetone/magpie/blob/main/internal/gui/mainwindow.go) | **借鉴**；优先保留原生交通灯和窗口能力 |
| 使用 `--wails-draggable: drag/no-drag` 标记顶部拖动与交互区域 | [index.html](https://github.com/yetone/magpie/blob/main/internal/gui/assets/index.html) | **借鉴**；输入框、搜索和按钮必须可点击 |
| 根据缩放校正交通灯周围的页内标题栏空间 | [app.css](https://github.com/yetone/magpie/blob/main/internal/gui/assets/app.css) | **借鉴方法，不复制像素值**；须在真实 Mac/Retina/缩放下测量 |
| 主窗口创建、最小尺寸、尺寸恢复及关闭事件 | [lightweight.go](https://github.com/yetone/magpie/blob/main/internal/gui/lightweight.go) | **借鉴**窗口生命周期、最小尺寸和窗口状态保存 |
| 菜单栏弹出面板使用半透明背景和 `MacBackdropTranslucent` | [app.go](https://github.com/yetone/magpie/blob/main/internal/gui/app.go) | **仅作材质技术参考**；Pata MVP 不开发常驻菜单栏面板 |
| 颜色 Tokens、系统深浅色、系统字体、减少动态效果 | [app.css](https://github.com/yetone/magpie/blob/main/internal/gui/assets/app.css) | **借鉴**系统适配原则；在 React 主题体系中实现 |
| 在首帧渲染前应用主题，避免亮暗色闪烁 | [theme.js](https://github.com/yetone/magpie/blob/main/internal/gui/assets/theme.js) | **借鉴**启动时的首帧主题同步策略 |
| 打包时使用 `Assets.car` / macOS 图标资产 | [Makefile](https://github.com/yetone/magpie/blob/main/Makefile)、[app.go](https://github.com/yetone/magpie/blob/main/internal/gui/app.go) | **验证**原生图标打包及深/浅色外观，不能只依赖运行时 PNG |

**重要区分：** Magpie 的 **主窗口并未从上述配置中启用 `MacBackdropLiquidGlass`**；其面板使用的是 `MacBackdropTranslucent`。不能把“Magpie 在 macOS 上运行”推导为“整个 WebView 自动拥有原生 Liquid Glass”。

Wails v3 beta.24 的 [WebviewWindowOptions 源码](https://github.com/wailsapp/wails/blob/v3.0.0-beta.24/v3/pkg/application/webview_window_options.go) 定义了 `MacBackdropLiquidGlass`、`MacToolbarStyleUnified` 等 API，**存在接口不等于它们在目标 macOS、当前 WKWebView 与我们的布局中已验证可用**。是否启用要经过阶段 2 的独立 Spike；失败则采用可访问、易维护的标准材质/实色回退。

## 3. Pata 的目标窗口结构

```text
原生 macOS 窗口（真实交通灯、系统拖拽、标准窗口行为）
┌─────────────────────────────────────────────────────────┐
│ ● ● ● 〔左侧窗口区域〕          [页面标题/搜索/页面动作]│ ← 与标题栏融合的轻量顶部工具栏
├──────────────┬──────────────────────────────────────────┤
│ Today        │ Today                                    │
│ Tasks        │                                          │
│ Notes        │ 今日计划：列表而非多重卡片                 │
│              │ 今日记录：时间线 / 快速输入                 │
│ 标签         │                                          │
│ #架构设计    │                                          │
│ #Flink       │                                          │
│ #Doris       │                                          │
└──────────────┴──────────────────────────────────────────┘
```

- 侧边栏只承载三个主入口、全局标签和必要搜索入口；可收起，宽度随可用空间适配。
- 顶部工具栏只出现当前页面需要的操作；Today、Tasks、Notes 使用统一的窗口框架。
- 主区以行、分隔线和内容层次组织；避免每层都绘制厚边框和阴影。
- Notes 仍然是 **单列卡片列表 → 同一主区域内的专注编辑**，不会因 Liquid Glass 引入笔记目录栏或右侧常驻详情栏。
- Liquid Glass/系统半透明材质只作为增强，不是完成 MVP 的必要条件。任何玻璃材质都应提供不透明回退。

## 4. 阶段 2 必须完成的原生窗口 Spike

只验证 **一个最小 Wails 窗口**，不增加额外产品模块。先以 Pata 的真实 React 布局骨架实验，验证结果再推广到完整 UI。

### A. 窗口与标题栏（阻断上线的问题）

- [ ] `MacTitleBarHiddenInset` 下，原生红黄绿按钮正常显示；不会与左侧标签、输入框、搜索框重叠。
- [ ] 拖动窗口仅在指定 drag 区生效；按钮、文字选择、输入框、滚动和菜单均为 no-drag。
- [ ] 窗口缩放、全屏、退出全屏、最大/最小宽度与侧边栏收起正常；重启后窗口状态按设计恢复。
- [ ] 目标 macOS 系统上 Dock、系统应用菜单、关闭/退出、⌘W / ⌘Q 等行为符合桌面软件习惯。

### B. 视觉材质（可回退的增强）

- [ ] 比较标准实色、CSS 半透明、Wails `MacBackdropTranslucent`；记录 WKWebView 是否遮挡系统材质。
- [ ] 若测试 `MacBackdropLiquidGlass`，验证其真实视觉效果、窗口边界、性能和系统版本回退；**不要求默认启用**。
- [ ] 辅助功能启用“减少透明度”或“提高对比度”时，文本、状态、选中态仍清楚可辨。
- [ ] 长篇 Notes 编辑、任务列表滚动、Memo 时间线无明显卡顿；不要通过常驻动画掩盖性能问题。

### C. 输入与可访问性

- [ ] 系统自动深浅色切换无明显首帧闪烁；用户自定义强调色不会被品牌色强行覆盖。
- [ ] `prefers-reduced-motion` 下禁用非必要动画，且不影响完成状态反馈。
- [ ] 键盘 Tab 导航、焦点可见、系统字号/应用缩放、Retina 与不同窗口尺寸下无控件遮挡。
- [ ] 中文输入法组合输入、快捷键、右键菜单在 WKWebView/Vditor 场景下无冲突。

### 记录格式

阶段 2 在自己的 `proposal.md` 中记录：测试的 macOS 版本、Wails 版本、机型、截图/录屏、通过/失败项、所选回退方案。**不在阶段 1 原型截图上宣称已通过原生验证**。

## 5. 阶段 5 的 UI 验收边界

- 通过原生窗口/菜单/键盘/主题/无障碍检查后才可称“macOS 桌面应用体验完成”。
- 阶段 1 的 `prototype/` 仍为浏览器里的页面概念图，截图不证明原生材质或标题栏能力。
- `Liquid Glass` 是可选视觉增强；产品功能、文件安全和可读性高于视觉效果。
- MVP 不新增菜单栏常驻工具、不转 SwiftUI、不开发插件/CLI/MCP。
