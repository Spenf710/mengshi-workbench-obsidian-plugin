// ===== 甘特图数据模型 =====
// 修改此文件即可更新甘特图，无需改 UI 代码

export interface GanttPhase {
  id: string;          // 唯一标识，如 "v1"、"v2"、"break"
  label: string;       // 阶段名，如 "V1 多维表"、"V2 机器人"、"中断"
  start: string;       // YYYY-MM-DD
  end: string;         // YYYY-MM-DD
  progress: number;    // 0-100
}

export interface GanttTask {
  id: string;
  name: string;
  group: string;       // 分组名：系统开发 / 车型项目
  category?: string;   // 项目类型：多维表 / RPA自动化 / AI智能体 / 工具开发 / 车型项目 / 其他
  start: string;       // YYYY-MM-DD（无 phases 时使用）
  end: string;         // YYYY-MM-DD（无 phases 时使用）
  progress: number;    // 0-100（无 phases 时使用）
  color: string;       // CSS 颜色值
  milestones?: { date: string; label: string; icon?: string }[];
  phases?: GanttPhase[];  // 多阶段：存在时替代单一 start/end/progress
}

// ===== 项目时间线数据 =====
// 按实际情况修改日期和进度
export const GANTT_DATA: GanttTask[] = [
  // ---- 数字化系统开发 ----
  {
    id: '1.PPAP-RPA',
    name: 'PPAP-RPA 自动化',
    group: '⚙ 系统开发',
    category: 'RPA自动化',
    start: '2025-11-01',
    end: '2026-03-31',
    progress: 100,
    color: 'var(--color-orange)',
    milestones: [
      { date: '2025-12-15', label: 'v1.0 上线' },
      { date: '2026-02-28', label: '聚类算法优化' },
    ],
  },
  {
    id: '2.部品风险清单管控系统',
    name: '部品风险清单管控',
    group: '⚙ 系统开发',
    category: '多维表',
    start: '2025-12-01',
    end: '2026-02-28',
    progress: 100,
    color: 'var(--color-green)',
    milestones: [
      { date: '2026-01-15', label: 'V1 上线' },
      { date: '2026-02-20', label: 'V2 上线' },
    ],
  },
  {
    id: '3.设变变更自动化系统',
    name: '设变变更自动化',
    group: '⚙ 系统开发',
    category: 'RPA自动化',
    start: '2026-01-01',
    end: '2026-06-30',
    progress: 85,
    color: 'var(--color-blue)',
    milestones: [
      { date: '2026-02-28', label: 'V1 多维表' },
      { date: '2026-04-15', label: 'V2 机器人' },
      { date: '2026-06-10', label: 'V3 RPA/AI' },
    ],
    phases: [
      { id: 'v1', label: 'V1 多维表', start: '2026-01-01', end: '2026-02-28', progress: 100 },
      { id: 'v2', label: 'V2 机器人', start: '2026-03-01', end: '2026-04-15', progress: 100 },
      { id: 'v3', label: 'V3 RPA/AI', start: '2026-04-16', end: '2026-06-30', progress: 70 },
    ],
  },
  {
    id: '4.低合格率零件全流程管控',
    name: '低合格率全流程管控',
    group: '⚙ 系统开发',
    category: '多维表',
    start: '2026-03-01',
    end: '2026-05-31',
    progress: 100,
    color: 'var(--color-red)',
  },
  {
    id: '5.FQ-SQE分工智能体',
    name: 'FQ-SQE 分工智能体',
    group: '⚙ 系统开发',
    category: 'AI智能体',
    start: '2026-04-01',
    end: '2026-05-15',
    progress: 100,
    color: 'var(--color-purple)',
  },
  {
    id: '6.EPS开模令AI审核',
    name: 'EPS 开模令 AI 审核',
    group: '⚙ 系统开发',
    category: 'AI智能体',
    start: '2026-03-15',
    end: '2026-06-30',
    progress: 90,
    color: 'var(--color-cyan)',
    milestones: [
      { date: '2026-05-01', label: 'Phase 2 完成' },
    ],
  },
  {
    id: '7.M18-3部品主责通报',
    name: 'M18-3 部品主责通报',
    group: '⚙ 系统开发',
    category: '多维表',
    start: '2026-06-11',
    end: '2026-07-15',
    progress: 30,
    color: 'var(--color-pink)',
  },
  {
    id: '8.Obsidian工作台插件',
    name: '猛士驾驶舱',
    group: '⚙ 系统开发',
    category: '工具开发',
    start: '2026-06-16',
    end: '2026-07-17',
    progress: 85,
    color: 'var(--color-accent)',
  },
  // ---- 车型项目管理 ----
  {
    id: 'M18-3 GCC项目',
    name: 'M18-3 GCC 长续航',
    group: '🚗 车型项目',
    category: '车型项目',
    start: '2026-04-01',
    end: '2026-10-31',
    progress: 25,
    color: 'var(--color-orange)',
    milestones: [
      { date: '2026-04-17', label: '项目启动' },
      { date: '2026-07-30', label: 'ET 试制' },
      { date: '2026-10-15', label: 'SOP' },
    ],
  },
  {
    id: 'M18-3 RSKD项目',
    name: 'M18-3 RSKD 散件出口',
    group: '🚗 车型项目',
    category: '车型项目',
    start: '2026-03-01',
    end: '2026-09-30',
    progress: 40,
    color: 'var(--color-green)',
    milestones: [
      { date: '2026-03-16', label: 'J1 时点' },
      { date: '2026-06-30', label: '一阶段交付' },
      { date: '2026-09-15', label: 'SOP' },
    ],
  },
];

// ===== 工具函数 =====
export function getDateRange(tasks: GanttTask[]): { min: Date; max: Date } {
  const now = new Date();

  // 空任务 → 返回当前月 ±1 月的默认范围
  if (tasks.length === 0) {
    const min = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const max = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return { min, max };
  }

  // 收集时间戳，过滤 Invalid Date
  const timestamps: number[] = [];
  for (const t of tasks) {
    const s = new Date(t.start).getTime();
    const e = new Date(t.end).getTime();
    if (!isNaN(s)) timestamps.push(s);
    if (!isNaN(e)) timestamps.push(e);
  }

  // 全部无效 → fallback 默认范围
  if (timestamps.length === 0) {
    const min = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const max = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return { min, max };
  }

  const min = new Date(Math.min(...timestamps));
  const max = new Date(Math.max(...timestamps));

  // 扩展 1 个月边距
  min.setMonth(min.getMonth() - 1);
  max.setMonth(max.getMonth() + 1);

  return { min, max };
}

export function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / 86400000);
}

export function getMonthLabels(min: Date, max: Date): string[] {
  const labels: string[] = [];
  const d = new Date(min.getFullYear(), min.getMonth(), 1);
  while (d <= max) {
    labels.push(`${d.getFullYear()}年${d.getMonth() + 1}月`);
    d.setMonth(d.getMonth() + 1);
  }
  return labels;
}
