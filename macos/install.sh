#!/bin/bash
# 安装：壁纸 App → /Applications；屏保 → ~/Library/Screen Savers
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD=macos/build

if [ -d "$BUILD/事件视界壁纸.app" ]; then
  rm -rf "/Applications/事件视界壁纸.app"
  cp -R "$BUILD/事件视界壁纸.app" /Applications/
  echo "✓ 已安装 /Applications/事件视界壁纸.app"
else
  echo "✕ 未找到 $BUILD/事件视界壁纸.app，请先运行 macos/build.sh"
  exit 1
fi

if [ -d "$BUILD/EventHorizon.saver" ]; then
  mkdir -p "$HOME/Library/Screen Savers"
  rm -rf "$HOME/Library/Screen Savers/EventHorizon.saver"
  cp -R "$BUILD/EventHorizon.saver" "$HOME/Library/Screen Savers/"
  echo "✓ 已安装 ~/Library/Screen Savers/EventHorizon.saver"
else
  echo "✕ 未找到 $BUILD/EventHorizon.saver，请先运行 macos/build.sh"
  exit 1
fi
