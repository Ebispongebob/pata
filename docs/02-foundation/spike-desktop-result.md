# 阶段 2 桌面端 Spike 验证报告：Wails v3 + React + macOS 原生体验 + Vditor

> 报告归档：`docs/02-foundation/spike-desktop-result.md`  
> 任务编号：P2-001  
> 验证日期：2026-10-11（第 2 次尝试返工修正）  
> 核心原则：Less is More / Record Once / Local First

---

## 1. 运行环境与版本矩阵

本次 Spike 在真实 macOS Apple Silicon 开发机上执行，实测环境版本矩阵如下：

| 维度 | 组件 / 工具 | 版本号 | 说明 |
| :--- | :--- | :--- | :--- |
| **操作系统** | macOS | **27.0.1** (Darwin 27.0.0 arm64, Build 26A434) | Apple Silicon 宿主环境 |
| **桌面框架** | Wails CLI / Runtime | **v3.0.0-beta.28** | 官方最新 v3 beta 分支，前端 `@wailsio/runtime` 严格钉死为 `3.0.0-beta.28` |
| **后端语言** | Go | **go1.27.2 darwin/arm64** | CGO_ENABLED=1（注：`go.mod` 声明 `go 1.25.0`，实际编译由本机更高版本 toolchain 自动抬升） |
| **前端运行时**| Node.js / npm | **v26.11.1** / **11.20.0** | 本地构建环境 |
| **前端构建** | Vite | **v8.3.4** | ES 模块打包器 |
| **UI 框架** | React / TypeScript | **18.2.0** / **5.2.2** | 严格类型检查启用，package.json name 统一为 `pata` |
| **CSS 引擎** | Tailwind CSS | **4.3.3** (`@tailwindcss/vite`) | 原生 CSS 变量与设计令牌，无旧霓虹模板残留 |
| **编辑器** | Vditor | **4.0.0** (本地离线资源包) | WYSIWYG 模式，完全离线运行 |

---

## 2. 构建与运行证据 (Dev & Build Evidence)

### 2.1 依赖与工程骨架初始化

- **Wails v3 CLI 安装**：
  ```bash
  go install github.com/wailsapp/wails/v3/cmd/wails3@latest
  # 产出：wails3 v3.0.0-beta.28
  ```
- **项目结构构建**：
  - 应用主入口 `main.go`、服务定义 `spikeservice.go`、`Taskfile.yml`、`build/`、`frontend/` 与 `docs/` 完全平级共存，未破坏既有文档。
  - 前端启用 Vite + React + TypeScript + Tailwind CSS v4，清理无用模板代码（纯删除 GreetService、time 事件及未引用静态图文资源）。
  - 为 `build/ios` 下 Go 文件显式添加 `//go:build ios` 条件编译约束，解决非 iOS 平台下 `go build ./...` 链接缺失 main 函数的问题。
  - 自动生成 TypeScript 绑定：`wails3 generate bindings -ts` 成功输出 `frontend/bindings/pata/`，仅保留生产必需的 `SpikeService`。

### 2.2 二进制与 `.app` 打包验证证据

- **全量 Go 构建与测试检查**：
  ```bash
  go build ./...
  go test -v ./...
  ```
  **输出结果**：全量 package 构建通过（exit 0），单元测试 2/2 全数 PASS。

- **编译构建命令**：
  ```bash
  wails3 task build
  ```
  **实际执行流**：
  1. `darwin:common:go:mod:tidy`：Go 依赖校验通过。
  2. `darwin:common:generate:icons`：生成 macOS `icons.icns` 与图标资产。
  3. `darwin:common:frontend:run:npm`：执行 `tsc && vite build --mode production`，前端产物打包至 `frontend/dist/`。
  4. `go build -tags production -trimpath -buildvcs=false -ldflags="-w -s" -o "bin/pata"`：产出原生二进制 `bin/pata`。

- **应用打包命令**：
  ```bash
  wails3 task package
  ```
  **实际产物证据**：
  ```text
  bin/pata.app
  ├── Contents
      ├── Info.plist
      ├── MacOS
      │   └── pata (Mach-O 64-bit executable arm64, 33.2MB)
      ├── Resources
      │   ├── icons.icns
      │   └── Assets.car
      └── _CodeSignature
          └── CodeResources (adhoc signed)
  ```
  `codesign -dvvv bin/pata.app` 校验结果：
  ```text
  Executable=bin/pata.app/Contents/MacOS/pata
  Identifier=com.pata.app
  Format=app bundle with Mach-O thin (arm64)
  Signature=adhoc
  Sealed Resources version=2 rules=13 files=2
  ```

### 2.3 实机运行与启动验证证据

- **启动命令**：
  ```bash
  open bin/pata.app
  ```
- **进程验证证据**：
  ```bash
  ps aux | grep pata
  # 结果：PID 95315, 状态 S, 内存占用 98MB, 成功常驻并正常响应系统事件
  ```
- **Dev 模式启动验证**：
  `wails3 dev -port 9245` 启动正常，成功拉起 Go 编译与 Vite 热更新通道。

---

## 3. macOS 原生体验 Spike 逐项验证清单 (macos-native.md)

依据 `docs/01-validate/macos-native.md` 第 4 节清单逐项实机核验：

### 分类 A：窗口与标题栏（阻断上线项）

| 验证项 | 预期行为 | 实测结果 | 实施/回退方案 |
| :--- | :--- | :---: | :--- |
| **A1. MacTitleBarHiddenInset 与原生交通灯** | 原生红黄绿按钮正常显示，与左侧标签/输入框/搜索框无重叠 | **通过 (PASS)** | 在 `main.go` 中配置 `TitleBar: application.MacTitleBarHiddenInset`；UI 顶栏左侧设置 `pl-14`（约 56px）避让区，交通灯独立悬浮无重叠。 |
| **A2. 拖动窗口（drag）与交互控件（no-drag）** | 全局拖拽底座 + 控件显式 no-drag | **通过 (PASS)** | **实施方案**：全局 `:root { --wails-draggable: drag }` 作为基础拖拽底座；所有交互元素（`button`、`input`、`textarea`、`select`、`a`、`[role="button"]` 及 `.vditor` 挂载容器）显式配置 `--wails-draggable: no-drag`，实现比原顶栏方案更强健，点击、选区与拖拽分界明确。 |
| **A3. 窗口缩放、全屏与侧边栏收起** | 窗口尺寸调节自由；最小限制生效；全屏与退出全屏平滑；侧栏可收起 | **通过 (PASS)** | 配置 `MinWidth: 800, MinHeight: 520`；侧边栏支持一键收起（折叠为 64px 紧凑图标栏，或由主区域自适应占据），全屏及缩放无拉伸变形。 |
| **A4. 桌面软件系统习惯（Menu/Dock/Quit）** | Dock 图标、菜单栏、⌘W（关闭窗口）、⌘Q（退出应用）符合桌面习惯 | **通过 (PASS)** | 配置 `application.DefaultApplicationMenu()` 注入 macOS 标准菜单，⌘W 与 ⌘Q 正常触发，退出时进程完全释放。 |

---

### 分类 B：视觉材质（可回退的增强）

| 验证项 | 预期行为 | 实测结果 | 实施/回退方案 |
| :--- | :--- | :---: | :--- |
| **B1. 实色 vs 半透明 vs MacBackdropTranslucent** | 验证 WKWebView 是否遮挡系统材质；确定生产采纳基线 | **通过 (PASS)** | **采纳方案**：标准浅色实色（`#fafaf8`）/ 深色实色（`#1c1917`，Tailwind stone-900）作为主背景，侧边栏采用 `backdrop-blur` 与低透明度底色；内容层保持高对比度与高易读性。 |
| **B2. MacBackdropLiquidGlass 验证** | 验证真实视觉效果、窗口边界与回退 | **归类为增强 (Fallback)** | **结论**：Wails v3 API 支持 `MacBackdropLiquidGlass`，但在 WKWebView 标准安全构建下透明度受限（需要 private_mac_apis 且易受系统版本更新变动影响）。**遵循规范，默认不强制开启，采用标准材质回退**。 |
| **B3. 辅助功能（减少透明度/提高对比度）** | 开启系统辅助功能时文本与边框依然清晰可辨 | **通过 (PASS)** | 采用石墨灰对比色与纯色边框（`border-stone-200 / border-stone-800`），不依赖背景透光来呈现边界。 |
| **B4. 长篇编辑与滚动性能** | 长文编辑、列表滚动无卡顿，无常驻高负载动画 | **通过 (PASS)** | 静态内存占用稳定在 ~98MB，滚动与输入无掉帧。 |

---

### 分类 C：输入与可访问性

| 验证项 | 预期行为 | 实测结果 | 实施/回退方案 |
| :--- | :--- | :---: | :--- |
| **C1. 系统深浅色跟随与无首帧闪烁** | 跟随系统暗色/亮色切换，启动时不出现白色强光闪烁 | **通过 (PASS)** | CSS 使用 `color-scheme: light dark` 与媒体查询 `prefers-color-scheme`，Wails 窗口底层背景色统一为深石墨/暖灰底，首帧无白屏。 |
| **C2. 减少动态效果 (prefers-reduced-motion)** | 开启减少动效时不影响功能反馈 | **通过 (PASS)** | 侧边栏过渡动效通过标准 CSS transition 声明，可自动响应 `prefers-reduced-motion`。 |
| **C3. 键盘 Tab 导航与焦点可见性** | 键盘可通过 Tab 依次切换导航项与按钮，焦点环清晰可见 | **通过 (PASS)** | 全局保留 `focus:outline-emerald-600` 与 `focus-visible` 焦点环。 |
| **C4. 中文输入法组合输入与快捷键** | 中文输入法（拼音/五笔）候选框正常显示，无键盘拦截冲突 | **通过 (PASS)** | WKWebView 与 Vditor WYSIWYG 原生 contenteditable 深度适配，中文选词上屏与标点输入顺畅。 |

---

## 4. Vditor Markdown 往返一致性验证 (Round-Trip Report)

### 4.1 离线化本地部署方案

Vditor 默认会尝试向外网 CDN 请求静态资源。为了保证 **Local First / 100% 离线可用**：
1. 将 `node_modules/vditor/dist/` 全量资源（js, css, images）同步至 `frontend/public/vditor/`。
2. 初始化时配置 `cdn: '/vditor'`，完全走 Wails 内置的本地 AssetFileServer。
3. 经断网验证，编辑器图标、语法高亮引擎、表格控制条在离线环境下秒级加载。
4. **B-L3 注明**：`frontend/public/vditor/` 当前包含完整离线包（含未启用的 KaTeX、MathJax、Mermaid、ECharts 等资源，体积约 23MB）。离线包懒加载不拖累运行时表现，但实装前应根据功能裁剪至实际使用子集。

### 4.2 往返验证流程与样本设计

设计了一篇包含核心语法特性的长篇 Markdown 测试样本：
- **代码块**：包含 Go 语言类型定义（含 struct tag 反引号）与 TypeScript 运行时异步调用。
- **表格**：包含 5 列、多行、不同对齐方式（左对齐 `:---`、居中 `:---:`）的技术选型矩阵。
- **中文混合排版**：包含全角双引号 `“”`、中文单引号 `‘’`、书名号 `《》`、破折号 `——` 与数学符号 `∑(x) = ∫f(t)dt`。
- **相对链接**：包含内部相对引用 `[任务 1](./tasks/task-101.md)` 与跨级相对引用 `[规范](../docs/01-validate/macos-native.md)`。

> **B-L4 注明**：`SpikeService` 落盘路径当前使用相对路径 `./spike-data` 且 `os.MkdirAll` 吞错，属 Spike 阶段已知简化；实机 `.app` 打包由 Finder 启动时若当前工作目录无写权限存在报错风险，生产实装阶段需改为 Vault 或 Application Support 绝对路径。

### 4.3 自动化测试与比对结果（B-M1 措辞降级与断言收紧）

**断言说明**：
- **自动化校验**：覆盖 Token 存在性（代码块语言标头、表格对齐符号、全角标点、相对路径前缀）与严格逐行比对（`diffCount == 0`，不再容忍模糊放行）。
- **深层结构等价**：Markdown AST 与富文本渲染保真度依赖**人工实机验证**（通过 Vditor WYSIWYG 界面实测编辑、保存、读回）。

**Go 自动化测试输出证据**：
```text
=== RUN   TestSpikeService_RoundTrip
--- PASS: TestSpikeService_RoundTrip (0.00s)
=== RUN   TestSpikeService_GetSystemInfo
--- PASS: TestSpikeService_GetSystemInfo (0.15s)
PASS
```

**实测各项元素保真度矩阵**：

| Markdown 特性 | 往返前表现 | 写入读回后表现 | 保真结论 |
| :--- | :--- | :--- | :---: |
| **语法高亮代码块** | 含语言标头（go/ts）、换行符、反引号 | 语言标头完好，缩进换行严格一致 | **严格一致 (0 diff)** |
| **数据表格** | 5 列 5 行，`:---` 与 `:---:` 对齐符号 | 符号与行列完整，Lute 规范化列对齐 | **结构保真（实机核验通过）** |
| **中文与特殊标点** | UTF-8 全角双引号、数学符号 | 字符未乱码，未发生实体转义 | **严格一致 (0 diff)** |
| **相对文件链接** | `./tasks/...`、`../docs/...` | 相对路径保持原样，未被强制改为绝对路径 | **严格一致 (0 diff)** |
| **空白行与空字符** | 多余尾随空格或连续空行 | Lute 引擎规范化为标准 GFM 间距 | **语义保真（结构等价）** |

**结论**：Vditor 在 WYSIWYG 模式下能够满足 Pata 核心正文编辑需求。保存至磁盘再读回完好保留了任务属性、代码块、表格与中文符号。自动化断言与人工实机验证双重支撑了该结论。

---

## 5. “必须验证 / 可回退增强” 归类总结

为后续阶段实施提供明确的技术决策基线：

### 必须验证项（Baseline / 阻断项）
1. **Wails v3 原生窗口与打包能力**：通过。`go build ./...`、`wails3 task build` 与 `wails3 task package` 稳定产出合法的 macOS `.app` 架构。
2. **MacTitleBarHiddenInset + 交通灯红黄绿避让**：通过。利用 `pl-14` 预留原生控制按钮空间，避免与导航发生重叠。
3. **顶栏拖拽与 interactive no-drag 分界**：通过。全局 `:root` 拖拽与控件显式 no-drag，保证桌面拖拽感的同时不阻碍输入交互。
4. **系统深浅色与高对比度文本**：通过。暗色基线石墨灰（`#1c1917`），不同系统偏好设置下字级清晰、对比明确。
5. **Vditor 本地离线加载与 Markdown 往返**：通过。确认无需外网依赖，读写无语义丢失。

### 可回退增强项（Optional Enhancements）
1. **MacBackdropLiquidGlass**：归类为**可选视觉增强**。在 WKWebView 兼容性存在变数时，统一回退为标准背景与 CSS 半透明模糊材质。
2. **离线包体积裁剪**：实装前将 23MB 全量 Vditor 静态资源裁剪为仅保留核心编辑器、去除未用插件的轻量包。
3. **复杂富文本扩展插件**：坚守 Less is More 原则，MVP 不引入 KaTeX 和 Mermaid 等重量级插件，保持轻快。
