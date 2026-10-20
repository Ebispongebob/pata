export interface TaskActivity {
  id: string;
  at: string;
  tags?: string[] | null;
  note_refs?: { [_ in string]?: string } | null;
  body: string;
  task_id?: string;
}

export interface TaskStatusEvent {
  action: string;
  at: string;
}

export interface TaskLike {
  id: string;
  title?: string;
  status: string;
  completed_at?: string | null;
  status_events?: TaskStatusEvent[] | null;
}

export interface ActivityTimelineItem {
  kind: 'activity';
  key: string;
  at: string;
  activity: TaskActivity;
}

export interface StatusEventTimelineItem {
  kind: 'status_event';
  key: string;
  at: string;
  action: string;
}

export type TaskTimelineItem = ActivityTimelineItem | StatusEventTimelineItem;

export function formatFullLocalTimestamp(isoString?: string | null): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return isoString;
  }
}

export function formatActivityTimestamp(isoString: string, now: Date = new Date()): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    const pad = (n: number) => n.toString().padStart(2, '0');
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());

    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    if (isToday) {
      return `${hours}:${minutes}`;
    }

    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    if (year === now.getFullYear()) {
      return `${month}-${day} ${hours}:${minutes}`;
    }
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

/**
 * 混排任务的手动 Activity 与状态事件（完成/重新打开）。
 * 按时间正向排序（由早到晚，最早的在最前，最新的在末尾），同时间戳保持稳定排序。
 */
export function buildTaskTimelineItems(
  task: TaskLike | null,
  activities: TaskActivity[]
): TaskTimelineItem[] {
  const items: TaskTimelineItem[] = [];

  for (const act of activities) {
    if (act && act.at) {
      items.push({
        kind: 'activity',
        key: `activity-${act.id}`,
        at: act.at,
        activity: act,
      });
    }
  }

  const rawEvents: TaskStatusEvent[] = task?.status_events ?? [];
  const statusEvents: TaskStatusEvent[] = [...rawEvents];

  // 兼容老数据或外部编辑仅有 completed_at 而无 status_events 的情况
  if (
    task?.status === 'done' &&
    task.completed_at &&
    !statusEvents.some((e) => e.action === 'completed')
  ) {
    statusEvents.push({
      action: 'completed',
      at: task.completed_at,
    });
  }

  statusEvents.forEach((ev, idx) => {
    if (ev?.at) {
      items.push({
        kind: 'status_event',
        key: `status-${ev.action}-${ev.at}-${idx}`,
        at: ev.at,
        action: ev.action,
      });
    }
  });

  return items.sort((a, b) => {
    const tA = new Date(a.at).getTime();
    const tB = new Date(b.at).getTime();
    const validA = !isNaN(tA);
    const validB = !isNaN(tB);
    if (validA && validB && tA !== tB) {
      return tA - tB; // ascending (chronological: oldest first, newest last)
    }
    if (validA && !validB) return -1;
    if (!validA && validB) return 1;
    if (a.at !== b.at) {
      return a.at.localeCompare(b.at);
    }
    return a.key.localeCompare(b.key);
  });
}
