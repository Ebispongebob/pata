# 啪嗒 / Pata · 三层卡片边缘精修 · 第二版资源包

## 视觉依据

本包对应**用户确认的橙黄与白色叠层卡片 Logo**（不是蓝紫色羽毛/叶子）。参考图：用户上传的 `image(20261012-045439).png`，其主图左侧为浅色圆角底座、橙黄/粉紫底层、白色卷曲前层和**三束黄色光芒**。

本次优化三层卡片边缘：减少外轮廓锯齿和突兀折点、统一圆滑过渡，并调整三层之间的微小厚度与高光。资源仍由该视觉方向重新手绘成 SVG，**不是原创概念图的精确矢量原稿**：形状、光泽、渐变属于实现时的近似设计，可继续精修。

## 内容

- `assets/branding/logo.svg`：透明底主 Logo，可编辑 SVG，子图层包括 `#pata-card-back`、`#pata-card-middle`、`#pata-card-front` 和 `#pata-sparkles`。
- `assets/branding/logo-mono.svg`：单色版 SVG。
- `assets/branding/logo-wordmark.svg`：「啪嗒 / PATA」组合标识。中文字依赖渲染环境中有中文字体，交付品牌最终稿建议转曲。
- `assets/branding/app-icon-light.svg`、`app-icon-dark.svg`、`app-icon-mono.svg`：三种可编辑图标。
- `assets/branding/appicon-*-1024.png`：三种 1024px RGBA PNG。
- `assets/branding/tray/iconTemplate.svg`、`.png`、`@2x.png`、`@3x.png`：透明黑色菜单栏图标，18/36/54px。模板图标采用简化形状以增强小尺寸清晰度。
- `build/appicon.png`：拷贝浅色 Dock App 图标；可作为 Wails 3 的图标构建源。
- `previews/overview.png`：预览。

## 安装

先检查项目目录。仅在目标是已经存在的 Wails 3 Go 工程（`go.mod` 和 `build/`）时运行：

```bash
./pata-branding-refined-v2/install.sh /你本地的/啪嗒项目
```

脚本在覆盖旧 `assets/branding/` 和 `build/appicon.png` 前保留带时间戳的备份，不会修改业务代码或菜单栏逻辑。也可以手动复制资源。

生成 Dock 图标时，在项目根目录先执行 `wails3 task --list` 确认任务，再运行：

```bash
wails3 task common:generate:icons
```

此包仅提供浅/深色独立图标，**不能单靠 PNG 自动切换 Dock 图标**。如需要原生外观变体，在 macOS 上使用 Apple Icon Composer 输出 `.icon`，并按实际 Wails 3 版本与构建任务接入。由于当前运行环境不是用户的 Mac，未实际验证其项目构建。

菜单栏使用 Wails `SetTemplateIcon()` 时，Go `//go:embed` 相对源文件目录配置路径；若已有托盘实例，应更新实例，不重复创建。逐帧动画属于第二阶段。

## 质量检查

- SVG XML 结构解析与 1024 PNG 图像尺寸校验；
- 菜单栏模板图标为仅黑色 RGB + Alpha，透明背景；
- `build/appicon.png` 与浅色 PNG 一致。
