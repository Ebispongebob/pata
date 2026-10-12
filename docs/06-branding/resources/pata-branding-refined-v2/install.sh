#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "用法: $0 /绝对路径/到/pata-项目" >&2
  exit 2
fi
PROJECT="$1"
if [ ! -d "$PROJECT" ] || [ ! -f "$PROJECT/go.mod" ] || [ ! -d "$PROJECT/build" ]; then
  echo "目标目录不是可识别的 Wails Go 项目（需要存在 go.mod 和 build/）；未修改任何文件。" >&2
  exit 1
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date '+%Y%m%d-%H%M%S')"
mkdir -p "$PROJECT/assets" "$PROJECT/docs/branding"

if [ -e "$PROJECT/assets/branding" ]; then
  mv "$PROJECT/assets/branding" "$PROJECT/assets/branding.backup-$STAMP"
  echo "已备份 assets/branding -> assets/branding.backup-$STAMP"
fi
cp -R "$HERE/assets/branding" "$PROJECT/assets/branding"

if [ -e "$PROJECT/build/appicon.png" ]; then
  cp -p "$PROJECT/build/appicon.png" "$PROJECT/build/appicon.png.backup-$STAMP"
  echo "已备份 build/appicon.png"
fi
cp "$HERE/build/appicon.png" "$PROJECT/build/appicon.png"

if [ -e "$PROJECT/docs/branding/README.md" ]; then
  cp -p "$PROJECT/docs/branding/README.md" "$PROJECT/docs/branding/README.md.backup-$STAMP"
fi
cp "$HERE/docs/branding/README.md" "$PROJECT/docs/branding/README.md"

echo "资源已安装到：$PROJECT"
echo "下一步：cd \"$PROJECT\" && wails3 task common:generate:icons"
echo "说明：仅安装静态图标资源；没有修改业务代码、启动流程和菜单栏初始化。"
