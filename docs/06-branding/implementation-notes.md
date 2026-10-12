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
