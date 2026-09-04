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
  macos/common/SchemeHandler.swift \
  macos/wallpaper/main.swift \
  -o "$APP/Contents/MacOS/EventHorizonWallpaper" \
  -framework AppKit -framework WebKit -framework ServiceManagement
cp -R dist "$APP/Contents/Resources/web"
codesign --force --sign - "$APP"
echo "✓ $APP"

########## ③ 屏幕保护程序 ##########
SAVER="$BUILD/EventHorizon.saver"
mkdir -p "$SAVER/Contents/MacOS" "$SAVER/Contents/Resources"
cp macos/saver/Info.plist "$SAVER/Contents/Info.plist"
# 屏保可执行文件是 MH_BUNDLE；swiftc 不直接支持 -bundle，用 -Xlinker 透传
if ! swiftc -O -swift-version 5 -parse-as-library \
    macos/common/SchemeHandler.swift macos/saver/EHSaverView.swift \
    -emit-library -Xlinker -bundle \
    -o "$SAVER/Contents/MacOS/EventHorizon" \
    -framework AppKit -framework WebKit -framework ScreenSaver 2>/dev/null; then
  echo "  (-bundle 链接失败，退回 dylib)"
  swiftc -O -swift-version 5 -parse-as-library \
    macos/common/SchemeHandler.swift macos/saver/EHSaverView.swift \
    -emit-library \
    -o "$SAVER/Contents/MacOS/EventHorizon" \
    -framework AppKit -framework WebKit -framework ScreenSaver
fi
cp -R dist "$SAVER/Contents/Resources/web"
codesign --force --sign - "$SAVER"
echo "✓ $SAVER"

########## ④ 屏保测试宿主 ##########
mkdir -p "$BUILD/harness"
swiftc -O -swift-version 5 macos/harness/main.swift \
  -o "$BUILD/harness/EHSaverHarness" \
  -framework AppKit -framework WebKit -framework ScreenSaver
echo "✓ $BUILD/harness/EHSaverHarness"
