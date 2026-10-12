#!/usr/bin/env bash
# DocViewer 启动脚本：用默认浏览器打开，无任何服务端依赖
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAGE="$DIR/index.html"
# B22：先确认文件真的存在，否则别报"成功"
if [ ! -f "$PAGE" ]; then
  echo "找不到 $PAGE" >&2
  exit 1
fi
if command -v open >/dev/null 2>&1; then
  open "$PAGE"                      # macOS：把路径交给 open，中文/空格由它处理
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$PAGE"                  # Linux
else
  echo "请手动在浏览器中打开：$PAGE"
fi
echo "DocViewer: $PAGE"
