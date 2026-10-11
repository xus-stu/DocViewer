#!/usr/bin/env bash
# DocViewer 启动脚本：直接用默认浏览器打开，无任何服务端依赖
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="file://$DIR/index.html"
if command -v open >/dev/null 2>&1; then
  open "$URL"                      # macOS
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"                  # Linux
else
  echo "请手动在浏览器中打开：$URL"
fi
echo "DocViewer: $URL"
