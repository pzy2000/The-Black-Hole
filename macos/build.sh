#!/bin/bash
# 构建事件视界 macOS 宿主：实况壁纸 App + 屏幕保护程序 .saver + 屏保测试宿主
set -euo pipefail
cd "$(dirname "$0")/.." # 仓库根

echo "—— ① 构建网页 dist ——"
npm run build

BUILD=macos/build
rm -rf "$BUILD"
mkdir -p "$BUILD"

########## ② 实况壁纸 App ##########
APP="$BUILD/事件视界壁纸.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp macos/wallpaper/Info.plist "$APP/Contents/Info.plist"
swiftc -O -swift-version 5 \
  macos/common/CineSettings.swift \
  macos/common/SchemeHandler.swift \
  macos/common/SettingsUI.swift \
  macos/wallpaper/main.swift \
  -o "$APP/Contents/MacOS/EventHorizonWallpaper" \
  -framework AppKit -framework WebKit -framework ServiceManagement -framework SwiftUI
copy_web() {
  cp -R dist "$1/Contents/Resources/web"
  # BGM：assets/bgms 自动扫描目录 → 包内 Resources/web/bgms（网页端 eh://local/bgms/ 读取）
  if [ -d assets/bgms ] && [ -n "$(ls -A assets/bgms 2>/dev/null)" ]; then
    mkdir -p "$1/Contents/Resources/web/bgms"
    cp assets/bgms/* "$1/Contents/Resources/web/bgms/"
  fi
}
copy_web "$APP"
codesign --force --sign - "$APP"
echo "✓ $APP"

########## ③ 屏幕保护程序 ##########
SAVER="$BUILD/EventHorizon.saver"
mkdir -p "$SAVER/Contents/MacOS" "$SAVER/Contents/Resources"
cp macos/saver/Info.plist "$SAVER/Contents/Info.plist"
# 屏保可执行文件是 MH_BUNDLE；swiftc 不直接支持 -bundle，用 -Xlinker 透传
if ! swiftc -O -swift-version 5 -parse-as-library \
    macos/common/CineSettings.swift macos/common/SchemeHandler.swift macos/common/SettingsUI.swift \
    macos/saver/EHSaverView.swift \
    -emit-library -Xlinker -bundle \
    -o "$SAVER/Contents/MacOS/EventHorizon" \
    -framework AppKit -framework WebKit -framework ScreenSaver -framework SwiftUI 2>/dev/null; then
  echo "  (-bundle 链接失败，退回 dylib)"
  swiftc -O -swift-version 5 -parse-as-library \
    macos/common/CineSettings.swift macos/common/SchemeHandler.swift macos/common/SettingsUI.swift \
    macos/saver/EHSaverView.swift \
    -emit-library \
    -o "$SAVER/Contents/MacOS/EventHorizon" \
    -framework AppKit -framework WebKit -framework ScreenSaver -framework SwiftUI
fi
copy_web "$SAVER"
codesign --force --sign - "$SAVER"
echo "✓ $SAVER"

########## ④ 屏保测试宿主 ##########
mkdir -p "$BUILD/harness"
swiftc -O -swift-version 5 macos/harness/main.swift \
  -o "$BUILD/harness/EHSaverHarness" \
  -framework AppKit -framework WebKit -framework ScreenSaver
echo "✓ $BUILD/harness/EHSaverHarness"
