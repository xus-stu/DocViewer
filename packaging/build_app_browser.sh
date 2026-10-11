#!/usr/bin/env bash
# 【旧方案·不推荐】用系统浏览器承载的 .app
#   现在请用 packaging/mac/build_native.sh（WKWebView 原生外壳，不依赖浏览器）
# 把 DocViewer 打包成 macOS 应用（.app）
#   结构：DocViewer.app/Contents/{Info.plist,MacOS,Resources}
#   启动脚本优先用 Chrome/Edge/Brave 的 --app 模式开一个独立窗口，
#   否则退回默认浏览器的普通窗口。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"
OUT="${1:-$HOME/Desktop}"
APP="$OUT/DocViewer.app"
VER="$(sed -n "s/.*APP_VERSION = '\([^']*\)'.*/\1/p" "$SRC/js/app.js" | head -1)"
VER="${VER:-1.0.0}"

echo "==> 打包 DocViewer $VER"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

# 1) 拷贝前端资源（跳过 tests / packaging，保持体积小）
for item in index.html css js examples README.md run.sh; do
  [ -e "$SRC/$item" ] && cp -R "$SRC/$item" "$APP/Contents/Resources/web/"
done

# 2) 图标
if [ -f "$HERE/DocViewer.icns" ]; then
  cp "$HERE/DocViewer.icns" "$APP/Contents/Resources/DocViewer.icns"
else
  echo "    (跳过图标：未找到 DocViewer.icns)"
fi

# 3) 启动器
cat > "$APP/Contents/MacOS/DocViewer" <<'LAUNCH'
#!/bin/bash
# DocViewer 启动器：用系统浏览器打开本地页面（无服务端依赖）
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Resources/web" && pwd)"
PAGE="file://$DIR/index.html"

BROWSERS=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"
)

for B in "${BROWSERS[@]}"; do
  if [ -x "$B" ]; then
    # --app 模式：去掉地址栏与标签栏，看起来就是个原生窗口
    TMP="$(mktemp -d)"
    exec "$B" --app="$PAGE" --user-data-dir="$TMP" \
      --window-size=1440,960 --no-first-run --no-default-browser-check
  fi
done

# --- 没有 Chromium 系浏览器时的兜底 ---
# 实测（macOS + Safari 17）：
#   Safari --app=<file://...>       → 只开出启动页，无法作为 app 模式
#   open -a Safari <file://...>      → 打开了窗口但没加载该本地文件
#   AppleScript make new document    → 可靠加载（下面用这条）
open_in_default() {
  # 用运行时的 $PAGE，应用被移到别处也能用
  open "$PAGE" 2>/dev/null || true
}

if [ -d "/Applications/Safari.app" ]; then
  osascript >/dev/null 2>&1 <<'OSA' && exit 0
set theURL to "PAGE_URL"
tell application "Safari"
  activate
  if (count of windows) is 0 then
    make new document with properties {URL:theURL}
  else
    tell front window
      set newTab to make new tab with properties {URL:theURL}
      set current tab to newTab
    end tell
  end if
end tell
OSA
fi

# 最后兜底：系统默认浏览器
open_in_default
LAUNCH
# 启动器里的 PAGE_URL 占位符 → 实际的 file:// 地址（供 Safari 分支使用）
LAUNCH_PAGE="file://$APP/Contents/Resources/web/index.html"
sed -i '' "s|PAGE_URL|$LAUNCH_PAGE|g" "$APP/Contents/MacOS/DocViewer"
chmod +x "$APP/Contents/MacOS/DocViewer"

# 4) Info.plist
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>DocViewer</string>
  <key>CFBundleDisplayName</key><string>DocViewer</string>
  <key>CFBundleIdentifier</key><string>local.docviewer.viewer</string>
  <key>CFBundleExecutable</key><string>DocViewer</string>
  <key>CFBundleIconFile</key><string>DocViewer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundleVersion</key><string>$VER</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
</dict>
</plist>
PLIST

# 5) 刷新图标缓存（尽力而为）
touch "$APP"
/usr/bin/touch "$APP/Contents/Info.plist"
echo "==> 完成：$APP"
echo "    图标: $( [ -f "$APP/Contents/Resources/DocViewer.icns" ] && echo 有 || echo 无 )"
echo "    版本: $VER"
