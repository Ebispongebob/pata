#!/bin/bash
# minion 监听:状态机驱动。检测=agent_status 从 working 离开(或起始即 idle 且有完成序号变化);
# 正则仅作核对辅助。按 config poll_interval_seconds=15 低频轮询,到复查节点退出并输出证据摘要。
# 用法: monitor_worker.sh <agent> <task-id> <node_minutes>
AGENT=$1; NODE_MIN=${3:-15}
DEADLINE=$(( $(date +%s) + NODE_MIN * 60 ))

get_status() { herdr agent get "$AGENT" 2>/dev/null | grep -o '"agent_status":"[a-z]*"' | head -1 | cut -d'"' -f4; }

prev=$(get_status)
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  sleep 15
  cur=$(get_status)
  if [ "$cur" != "working" ] && [ "$prev" == "working" ]; then
    echo "RESULT=STATE_LEFT_WORKING now=$cur — 读输出核对最终报告"
    exit 0
  fi
  prev=$cur
done

echo "RESULT=CHECKPOINT_REACHED after ${NODE_MIN}min status=$(get_status)"
echo "--- 最新 PROGRESS 序号 ---"
herdr agent read "$AGENT" --source recent-unwrapped --lines 120 2>/dev/null | grep -o 'PROGRESS [0-9]*' | tail -1
echo "--- workspace evidence ---"
git -C /Users/wuyukang/code/github/pata status --short | wc -l
