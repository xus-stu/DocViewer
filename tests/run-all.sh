#!/usr/bin/env bash
# 跑全部测试：解析器 / 冒烟 / 原生写回。本地没装 node 时用随附运行时。
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
NODE="${NODE:-$(command -v node || true)}"
if [ -z "$NODE" ]; then
  NODE="$(ls -d "$HOME"/.dsh/dsh-runtimes/*/dependencies/node/bin/node 2>/dev/null | head -1)"
fi
[ -x "$NODE" ] || { echo "找不到 node，可用 NODE=/path/to/node 指定" >&2; exit 1; }

fail=0
echo "== 解析器 =="
"$NODE" "$HERE/parse.test.js" || fail=1
echo "== 冒烟（整个应用） =="
"$NODE" "$HERE/smoke.test.js" || fail=1
echo "== 原生写回 =="
if command -v swiftc >/dev/null 2>&1; then
  # swiftc 只允许名为 main.swift 的文件放顶层代码
  TMPD="$(mktemp -d)"
  cp "$HERE/append_test.swift" "$TMPD/main.swift"
  swiftc -O "$ROOT/packaging/mac/AppendWriter.swift" "$TMPD/main.swift" -o "$TMPD/write-test" \
    && "$TMPD/write-test" || fail=1
  rm -rf "$TMPD"
else
  echo "（没有 swiftc，跳过原生测试）"
fi
exit $fail
