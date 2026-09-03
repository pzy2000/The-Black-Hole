#!/bin/bash
# 事件视界 — 双击启动（需已运行 npm install && npm run build）
cd "$(dirname "$0")"
if [ ! -d dist ]; then
  echo "首次运行：构建游戏…"
  npm install
  npm run build
fi
node scripts/serve.mjs &
SERVER_PID=$!
sleep 1
open "http://localhost:8137"
echo "游戏运行中（关闭本窗口即退出）"
wait $SERVER_PID
