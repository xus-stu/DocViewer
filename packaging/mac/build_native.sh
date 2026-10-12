#!/usr/bin/env bash
# 编译 WKWebView 原生外壳并打包成 DocViewer.app（不依赖任何浏览器）
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$HERE/../.." && pwd)"
OUT="${1:-$HOME/Desktop}"
APP="$OUT/DocViewer.app"
VER="$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" "$SRC/js/app.js" | head -1)"; VER="${VER:-1.0.0}"

echo "==> 1/4 编译 Swift 外壳（WKWebView）"
# B14：先装到临时目录，编译成功再替换桌面上的 app ——
# 否则编译失败/中断会留下"原来的可用 app 已被删掉"的局面
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/DocViewer.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -framework Cocoa -framework WebKit \
  "$HERE/DocViewer.swift" "$HERE/AppendWriter.swift" -o "$APP/Contents/MacOS/DocViewer"

echo "==> 2/4 拷贝前端资源"
mkdir -p "$APP/Contents/Resources/web"
for item in index.html css js examples README.md; do
  [ -e "$SRC/$item" ] && cp -R "$SRC/$item" "$APP/Contents/Resources/web/"
done

echo "==> 3/4 图标 + Info.plist"
[ -f "$SRC/packaging/DocViewer.icns" ] && cp "$SRC/packaging/DocViewer.icns" "$APP/Contents/Resources/DocViewer.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>DocViewer</string>
  <key>CFBundleDisplayName</key><string>DocViewer</string>
  <key>CFBundleIdentifier</key><string>local.docviewer.native</string>
  <key>CFBundleExecutable</key><string>DocViewer</string>
  <key>CFBundleIconFile</key><string>DocViewer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundleVersion</key><string>$VER</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppleScriptEnabled</key><true/>
  <key>OSAScriptingDefinition</key><string></string>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Document</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>public.rtf</string>
        <string>public.plain-text</string>
        <string>net.daringfireball.markdown</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST

echo "==> 4/4 签名（ad-hoc）"
if ! codesign --force --deep --sign - "$APP" >/dev/null 2>&1; then
  echo "  ✗ 签名失败"; exit 1
fi

# B14：到这一步都成功了，才替换目标目录里的旧 app
rm -rf "$OUT/DocViewer.app"
mv "$APP" "$OUT/DocViewer.app"
APP="$OUT/DocViewer.app"

echo "完成 → $APP   版本 $VER"
