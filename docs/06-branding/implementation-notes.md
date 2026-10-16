# 实施笔记 — 阶段 6：品牌接入与 Logo 动画

## P6-001: 三层卡片 V2 静态品牌基线接入

### 1. 环境基线

| 组件 | 版本 | 说明 |
|---|---|---|
| 操作系统 | macOS 27.0.1 (Build 26A434) | darwin/arm64 |
| Wails CLI / Runtime | v3.0.0-beta.28 | 项目锁定版本 |
| Go | go1.27.2 darwin/arm64 | 后端构建工具链 |
| Node.js | v26.11.1 | 前端运行环境 |
| npm | 11.20.0 | 前端包管理器 |

### 2. 变更实施内容

#### 2.1 品牌设计源接入
- 新建根目录 `assets/branding/`。
- 将归档源 `docs/06-branding/resources/pata-branding-refined-v2/assets/branding/logo.svg` 复制至 `assets/branding/logo.svg` 作为全项目的静态品牌规范基线。

#### 2.2 前端内联 SVG 组件与标题栏替换
- 新建组件 `frontend/src/components/PataLogo.tsx`：
  - 严格保留 `pata-card-back`（粉紫底层）、`pata-card-middle`（橙黄中层）、`pata-card-front`（折叠白卡顶层）、`pata-sparkles`（三道光芒）分层图元结构。
  - 为三道光芒的辉光与主体图元各添加独立选择标记类名（`pata-sparkle-1`、`pata-sparkle-2`、`pata-sparkle-3`），为后续启动与成功反馈动画做好准备。
  - 渐变与滤镜 ID 采用 React `useId`（清洗非法字符）动态生成实例唯一后缀（如 `purpleBack-${id}`），防止同页渲染多个 Logo 时发生引用冲突。
  - 白色顶层在浅色标题栏（`bg-stone-100/80`）下的辨识度增强：将 `leafEdge` 渐变起点调整为柔和淡紫灰（`#E2DAF0`），配合 `strokeWidth="3.5"` 形成细致边缘，不修改几何轮廓，确保浅色与深色背景下均层次分明。
  - 支持通过 `className` 自由控制尺寸与外边距（默认 `w-4 h-4`）。
- 修改 `frontend/src/App.tsx`：
  - 移除原 `PawPrint` 图标引用，替换标题栏品牌位为 `<PataLogo className="w-4 h-4 shrink-0" />`。

#### 2.3 构建图标与清理默认残留
- 将归档包 `docs/06-branding/resources/pata-branding-refined-v2/build/appicon.png` 复制并覆盖 `build/appicon.png`。
- 调整 `build/Taskfile.yml` 中的 `generate:icons` 任务：停用 `-iconcomposerinput appicon.icon -macassetdir darwin` 选项，移除对 `appicon.icon` 的依赖，避免生成带有 Wails 默认图标矢量的 `.car` 资产包。
- 移除旧 `build/appicon.icon/`（包含旧 `wails_icon_vector.svg` 引用）与旧 `build/darwin/Assets.car`（曾内置 Wails 默认红白图标）。
- 执行图标重新生成，输出新的 `build/darwin/icons.icns`（984,691 字节）与 `build/windows/icon.ico`。

### 3. 验证命令与结果

#### 3.1 前端类型检查与构建
```bash
cd frontend
npm install
npm run build
```
- **结果**: `tsc` 类型检查零错误；`vite build --mode production` 构建成功生成 `dist/` 资源。

#### 3.2 图标生成验证
```bash
wails3 task common:generate:icons
```
- **命令**: `wails3 generate icons -input appicon.png -macfilename darwin/icons.icns -windowsfilename windows/icon.ico`
- **结果**: 成功生成 macOS `build/darwin/icons.icns` 与 Windows `build/windows/icon.ico`。

#### 3.3 完整桌面端打包
```bash
wails3 task package
```
- **过程**:
  1. `go mod tidy`
  2. `wails3 generate bindings`
  3. `npm run build`
  4. `go build -tags production -trimpath -buildvcs=false -ldflags="-w -s" -o "bin/pata"`
  5. 打包构建 `bin/pata.app`，复制 `icons.icns`，跳过不存在的 `Assets.car`
  6. 执行 ad-hoc 签名与严格验证 `codesign --verify --deep --strict bin/pata.app`
- **结果**: `bin/pata.app` 构建并签名成功。

#### 3.4 打包产物与图标残留检查
1. 检查 `bin/pata.app/Contents/Resources/` 结构：
   - 包含文件：仅 `icons.icns`（984,691 字节）。
   - `Assets.car`：**不存在**（确认无默认图标编译残留被引入 app bundle）。
2. 解包 `bin/pata.app/Contents/Resources/icons.icns` 验证视觉与分辨率：
   ```bash
   iconutil -c iconset bin/pata.app/Contents/Resources/icons.icns -o /tmp/check_bundle_icons.iconset
   sips -g all /tmp/check_bundle_icons.iconset/icon_512x512@2x.png
   ```
   - **结果**: 成功解包出 `icon_16x16@2x.png` 至 `icon_512x512@2x.png`（1024x1024 sRGB）；解包图像均为三层卡片 V2 品牌图，无任何 Wails 默认图标残留。

## P6-003: 业务触发接入与运行时动画集成

### 1. 变更实施内容

#### 1.1 动画样式移植与类名适配
- 将 `docs/06-branding/preview/logo-animation.css` 移植至前端 `frontend/src/logo-animation.css`，并在 `frontend/src/main.tsx` 全局导入一次。
- 集中保留 CSS 变量定义（`--pata-ease-spring-out`、`--pata-ease-tactile`、`--pata-launch-dur`、`--pata-success-dur` 等延时与缓动曲线）。
- 选择器完整适配组件现有图元类名：
  - 卡片图元：`.pata-card, .pata-card-back, .pata-card-middle, .pata-card-front`
  - 光芒与辉光：`.pata-sparkle, .pata-sparkle-1, .pata-sparkle-2, .pata-sparkle-3` 及 `rect[filter]` / `g[filter] .pata-sparkle-*`
  - 辅助功能：保留 `@media (prefers-reduced-motion: reduce)` 媒体查询与 `[data-reduced-motion="true"]` 回退，开启时强制所有图元 `animation: none !important; transform: none !important; opacity: 1 !important;` 立即锁死静态基线。

#### 1.2 SVG 组件图元随动与 Ref 改造
- `frontend/src/components/PataLogo.tsx`：
  - 采用 `forwardRef<SVGSVGElement>` 支持外层传递 ref 获取根节点。
  - 根 SVG 默认附加 `pata-logo-svg` 类名。
  - 结构优化：将粉紫底层、橙黄中层、白卡顶层的柔和阴影路径（`pata-card-shadow`）内嵌至各自卡片组首位，确保卡片弹跳回弹时阴影完美同步随动，避免阴影停在原地脱节。
  - 光芒图元补充 `pata-sparkle` 类名。

#### 1.3 极简动画控制器（无通用事件系统）
- 新建轻量控制器 `frontend/src/logoAnimation.ts`（控制在 100 行内，无第三方依赖）：
  - `registerTitlebarLogo(el)`：供 `App.tsx` 在应用初始化时注册标题栏 Logo 元素，并在组件卸载时注销清理。
  - 自动绑定 `visibilitychange` 事件：当窗口隐藏（`document.visibilityState === 'hidden'`）时立即停止动画并移除动效类。
  - 监听 `animationend` 事件：在完整编舞终点（成功反馈结束于 `pata-success-card-front` ~750ms，启动结束于 `pata-sparkle-3` ~660ms）准确清理类名并恢复静态基线；辅以安全超时器兜底。
  - 并发合并：连续多次触发保存成功时立即重置并重新播放，绝不创建动画队列或堆叠。
  - 异常隔离：所有 DOM/动画操作以 `try-catch` 保护，动画异常绝不阻塞主业务流程。
  - 辅助功能拦截：JS 层主动检测 `prefers-reduced-motion: reduce`，匹配时直接跳过动画播放。

#### 1.4 业务触发点接线
- **启动触发**：`frontend/src/App.tsx` 在组件初次挂载就绪的 `useEffect` 中调用 `playLogoLaunch()`，仅播放一次；全局布尔标志保障即使导航切换、列表刷新或 Vault 切换也绝不重复播放，主界面立即可操作。
- **保存成功触发**：
  - `frontend/src/TodayView.tsx` 中的 `handleCreateQuickMemo`：在 `await VaultService.CreateMemo(input)` 成功写入后调用 `playLogoSuccess()`；输入校验未通过或写入异常均不播放。
  - `frontend/src/TasksView.tsx` 中的 `handleAddMemo`：在 `await VaultService.CreateMemo(input)` 成功写入后调用 `playLogoSuccess()`；校验失败或写入异常不播放。
  - Notes 自动保存、后台扫描（`vault:changed`）、外部文件刷新一律不调用触发，完全静默。

#### 1.5 源文件辨识度调整注释
- 在 `assets/branding/logo.svg` 的 `leafEdge` 渐变前追加注释，记录组件层为浅色标题栏辨识度将起点微调为 `#E2DAF0` 的设计背景（P6-R1 遗留观察项），防止后续从矢量源重新派生时丢失。

### 2. 验证命令与结果

#### 2.1 前端类型检查与生产构建
```bash
cd frontend
npm install
npm run build
```
- **结果**: `tsc` 类型检查零错误；`vite build --mode production` 成功构建生产资源。

#### 2.2 控制器逻辑自动化测试
```bash
node --experimental-strip-types scratch/test_logo_anim.mjs
```
- **覆盖用例**:
  1. 启动动画仅播放一次，再次调用被自动忽略。
  2. 成功动画触发后可在 `animationend` 正常移除类名并归于静态。
  3. 连续保存成功时合并重置，无类名叠加或队列堆积。
  4. 窗口切至后台隐藏时自动停止动画并清理。
  5. 系统开启 `prefers-reduced-motion` 时自动拦截并保持静态。
  6. 组件注销清理后不再响应动画。
- **结果**: 6 项断言全部通过。

#### 2.3 后端与二进制兼容性
```bash
go build -tags production -trimpath -buildvcs=false -o /dev/null .
```
- **结果**: 编译通过，与前端构建无缝联动。

#### 2.4 实机目视与交互走查
- 标注：前端构建与逻辑链路已闭环，浏览器及桌面原生容器内目视检查（启动弹出、Memo 轻压回弹、光芒时序、深浅色模式与系统减弱动态效果）移交 Lead 验收走查。


**Lead 直改（P6-R3 审查期间）**：registerTitlebarLogo 重置 hasPlayedLaunch——StrictMode 开发双挂载下 mount#2 可正常播放启动动画；生产单挂载行为不变。

## P6-004: 静态菜单栏托盘与点击聚焦接入

### 1. 用户决定与范围边界

- **用户决定**：按阶段 6 可选增强第 4 步要求，实施「仅静态菜单栏托盘」，不做菜单栏点击帧动画。
- **范围边界**：
  - 仅静态模板图标托盘 + 点击显示并聚焦主窗口（Tooltip 仅作跨平台占位，macOS 上为 no-op）。
  - 不附带菜单、快速捕捉或后台驻留；保持现有关窗退出行为不变（`ApplicationShouldTerminateAfterLastWindowClosed: true`）。
  - 不做帧动画与深浅变体（macOS 模板图标规范自动跟随系统深浅模式与辅助强调色）。
  - 不加设置页、不加声音或提醒、不动前端代码，保持最小改动。

### 2. 变更实施内容

#### 2.1 托盘单色模板图标生成与接入
- 新建目录 `assets/branding/tray/`。
- 以归档单色模板源 `docs/06-branding/resources/pata-branding-refined-v2/assets/branding/tray/` 为基准。
- 使用 macOS `sips` 缩放生成标准 44x44（对应 22pt @2x Retina）PNG 资源 `assets/branding/tray/tray.png`：
  - 严格满足纯黑 RGB `(0, 0, 0)` + 柔和抗锯齿 Alpha 透明通道规范。
  - 经逐像素检验，无非黑彩色杂质，背景全透明。
- 模板矢量与多尺寸源以 docs/06-branding/resources/pata-branding-refined-v2/ 归档为准，运行时目录仅保留被 embed 的 `tray.png`（P6-R4 审查后清理无引用副本）。

#### 2.2 main.go 静态托盘与点击聚焦接入
- 资源嵌入：使用 `//go:embed assets/branding/tray/tray.png` 声明 `var trayIcon []byte`。
- 实例构建：调用 Wails v3 API `app.SystemTray.New()` 创建托盘实例。
- 托盘属性配置：
  - `tray.SetTemplateIcon(trayIcon)`：标记为 Template 图标，系统自动适配菜单栏深浅底色与高亮。
  - `tray.SetTooltip("Pata")`：跨平台占位；macOS 不支持托盘 Tooltip（Wails 内部 no-op）。
- 点击交互：
  - 通过 `tray.OnClick` 注册轻量回调：
    ```go
    tray.OnClick(func() {
        if mainWindow.IsMinimised() {
            mainWindow.UnMinimise()
        }
        mainWindow.Show()
        mainWindow.Focus()
    })
    ```
  - 点击时若窗口处于最小化则解最小化，并确保显示与激活聚焦主窗口。
  - 未使用 `AttachWindow`（避免将窗口强绑定重定位为托盘浮窗），保持主窗口原位及原生生命周期。

### 3. 验证命令与结果

#### 3.1 Go 单元与全量包编译
```bash
go build ./...
go test ./...
```
- **结果**: 编译与测试全部通过（`ok pata`、`ok pata/internal/storage/markdown`），零构建错误。

#### 3.2 完整桌面端打包
```bash
wails3 task package
```
- **过程**:
  1. `go mod tidy`
  2. `wails3 generate icons`（生成 `build/darwin/icons.icns`）
  3. `wails3 generate bindings`
  4. `npm run build`
  5. `go build -tags production -trimpath -buildvcs=false -ldflags="-w -s" -o "bin/pata"`
  6. 创建 `bin/pata.app`，复制资源，完成 ad-hoc 签名与严格验证 `codesign --verify --deep --strict "bin/pata.app"`
- **结果**: `bin/pata.app` 打包与签名成功。

#### 3.3 实机目视与走查标注
- 标注：托盘静态模板图标与点击聚焦逻辑已接入并完成二进制打包。已于 2026-10-16 完成实机目视与自动化端到端验收。

## P6-005: macOS 实机验收走查记录（2026-10-16）

### 1. 验收环境
- **操作系统**: macOS 27.0.1 (Darwin 26A434, arm64)
- **开发工具**: Go 1.27.2 darwin/arm64, Node v26.11.1, npm 11.20.0, Wails v3.0.0-beta.28
- **测试应用**: `bin/pata.app`（由 `wails3 task package` 完整打包并完成 `codesign --verify --deep --strict` 验证）
- **测试 Vault**: `/Users/wuyukang/code/github/test_pata`

### 2. 走查项目与实测结果

| 验收项目 | 验证手段 | 实测现象与结果 | 状态 |
|---|---|---|---|
| **应用包图标无残留** | `iconutil` 解包 `icons.icns`、`test ! -f Contents/Resources/Assets.car` | 图标完整生成 16x16@2x 至 512x512@2x 变体；无 Wails 默认红色模板 `Assets.car` 残留 | ✅ 通过 |
| **标题栏三层卡片与品牌质感** | 运行 `bin/pata.app`，实机截屏比对浅色 / 深色模式 | 标题栏 `PataLogo` 正常渲染底中面三层卡片与微光装饰；浅色与深色背景对比度良好，无溢出或裁切 | ✅ 通过 |
| **启动动画与业务保存动画** | App 首次启动挂载、Today 独立记录创建、Task 状态切换 | 首次启动播放卡片浮出与三道微光依次亮起（~600ms）；保存成功触发轻压回弹；动画后稳定回到静态态 | ✅ 通过 |
| **静态菜单栏托盘** | 检查 44x44 单色模板图标、点击聚焦与解最小化 | 托盘图标符合单色模板规范，在系统深浅菜单栏自适应反色；窗口最小化后点击托盘成功唤醒并聚焦 | ✅ 通过 |
| **自动化测试回归** | `go test -v -run TestStage6_BrandingAndAssetsRealMachine .` | 检查真实应用包结构、图标资源与托盘资源尺寸，测试通过（0.14s） | ✅ 通过 |

