import React, { useEffect, useRef, useCallback } from 'react';
import { type App, Modal, TFile } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';

// ===== 类型 =====
interface LinkTarget {
  path: string;
  label: string;
}

interface GraphNode {
  id: string;
  label: string;
  path: string;
  type: 'center' | 'outlink' | 'backlink';
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 文字渲染边界（用于点击检测） */
  labelX?: number;
  labelY?: number;
  labelW?: number;
}

// ===== 力导向模拟常量 =====
const CANVAS_W = 520;
const CANVAS_H = 260;
const CENTER_X = CANVAS_W / 2;
const CENTER_Y = CANVAS_H / 2;
const ITERATIONS = 120;
const NODE_R = 5;
const CENTER_R = 8;
const HIT_PAD = 4;
const LABEL_GAP = 4;
const LABEL_MAX_LEN = 10;
const LABEL_HIT_TOLERANCE = 8;

// 模拟参数
const SIM_DAMPING = 0.75;
const SIM_SPRING_K = 0.003;
const SIM_REPULSION_K = 1800;
const SIM_BOUNDARY_PAD = 10;
const SIM_INIT_RADIUS = 50;
const SIM_INIT_SPREAD = 80;

// 颜色（渲染 + 图例共享）
const OUTLINK_COLOR = '#4ade80';
const BACKLINK_COLOR = '#fb923c';

// 字体
const FONT_LABEL_BOLD = 'bold 11px -apple-system, sans-serif';
const FONT_LABEL = '10px -apple-system, sans-serif';
const FONT_EMPTY = '13px -apple-system, sans-serif';

function runSimulation(nodes: GraphNode[]): void {
  if (nodes.length === 0) return;

  const center = nodes.find((n) => n.type === 'center');
  if (!center) return;

  // 初始化：出链/入链节点在中心周围随机分布
  for (const n of nodes) {
    if (n.type === 'center') {
      n.x = CENTER_X;
      n.y = CENTER_Y;
      n.vx = 0;
      n.vy = 0;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const dist = SIM_INIT_RADIUS + Math.random() * SIM_INIT_SPREAD;
      n.x = CENTER_X + Math.cos(angle) * dist;
      n.y = CENTER_Y + Math.sin(angle) * dist;
      n.vx = 0;
      n.vy = 0;
    }
  }

  for (let tick = 0; tick < ITERATIONS; tick++) {
    const alpha = 1 - tick / ITERATIONS;

    for (let i = 1; i < nodes.length; i++) {
      // 对中心节点的引力（弹簧力）
      const dx = center.x - nodes[i].x;
      const dy = center.y - nodes[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = dist * SIM_SPRING_K * alpha;
      nodes[i].vx += (dx / dist) * force;
      nodes[i].vy += (dy / dist) * force;

      // 节点间斥力
      for (let j = i + 1; j < nodes.length; j++) {
        const dx2 = nodes[i].x - nodes[j].x;
        const dy2 = nodes[i].y - nodes[j].y;
        const d2 = dx2 * dx2 + dy2 * dy2 || 1;
        const f = (SIM_REPULSION_K * alpha) / d2;
        nodes[i].vx += (dx2 / Math.sqrt(d2)) * f;
        nodes[i].vy += (dy2 / Math.sqrt(d2)) * f;
        nodes[j].vx -= (dx2 / Math.sqrt(d2)) * f;
        nodes[j].vy -= (dy2 / Math.sqrt(d2)) * f;
      }
    }

    // 应用速度 + 阻尼 + 边界
    for (let i = 1; i < nodes.length; i++) {
      nodes[i].vx *= SIM_DAMPING;
      nodes[i].vy *= SIM_DAMPING;
      nodes[i].x += nodes[i].vx;
      nodes[i].y += nodes[i].vy;

      const pad = NODE_R + SIM_BOUNDARY_PAD;
      nodes[i].x = Math.max(pad, Math.min(CANVAS_W - pad, nodes[i].x));
      nodes[i].y = Math.max(pad, Math.min(CANVAS_H - pad, nodes[i].y));
    }
  }
}

// ===== Canvas 初始化（renderGraph / renderEmpty 共享） =====
function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = CANVAS_W + 'px';
  canvas.style.height = CANVAS_H + 'px';
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  return ctx;
}

// ===== 渲染 =====
function renderGraph(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  canvas: HTMLCanvasElement,
): void {
  const center = nodes.find((n) => n.type === 'center');
  if (!center) return;

  const cs = getComputedStyle(canvas);
  const accentColor = cs.getPropertyValue('--interactive-accent').trim() || '#7c3aed';
  const textColor = cs.getPropertyValue('--text-normal').trim() || '#333';
  const bgModifier = cs.getPropertyValue('--background-modifier-border').trim() || '#ddd';

  // 边
  for (const node of nodes) {
    if (node.type === 'center') continue;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(node.x, node.y);
    ctx.strokeStyle = bgModifier;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 节点
  for (const node of nodes) {
    const r = node.type === 'center' ? CENTER_R : NODE_R;

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    if (node.type === 'center') {
      ctx.fillStyle = accentColor;
    } else if (node.type === 'outlink') {
      ctx.fillStyle = OUTLINK_COLOR;
    } else {
      ctx.fillStyle = BACKLINK_COLOR;
    }
    ctx.fill();

    // 标签
    ctx.font = node.type === 'center' ? FONT_LABEL_BOLD : FONT_LABEL;
    ctx.fillStyle = node.type === 'center' ? accentColor : textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const displayLabel = node.label.length > LABEL_MAX_LEN
      ? node.label.slice(0, LABEL_MAX_LEN) + '…'
      : node.label;
    const labelX = node.x + r + LABEL_GAP;
    ctx.fillText(displayLabel, labelX, node.y);

    // 存储文字边界供点击检测
    const metrics = ctx.measureText(displayLabel);
    node.labelX = labelX;
    node.labelY = node.y;
    node.labelW = metrics.width;
  }
}

// ===== 空状态 =====
function renderEmpty(canvas: HTMLCanvasElement, msg: string): void {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;

  const cs = getComputedStyle(canvas);
  const textMuted = cs.getPropertyValue('--text-muted').trim() || '#999';
  ctx.font = FONT_EMPTY;
  ctx.fillStyle = textMuted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, CANVAS_W / 2, CANVAS_H / 2);
}

// ===== 组件 =====
export function MiniGraph({
  app,
  filePath,
  dateLabel,
}: {
  app: App;
  filePath: string;
  dateLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 获取文件
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      renderEmpty(canvas, dateLabel + ' — 暂无日记');
      nodesRef.current = [];
      return;
    }

    // 出链
    const cache = app.metadataCache.getFileCache(file);
    const outlinks: LinkTarget[] = [];
    if (cache?.links) {
      for (const link of cache.links) {
        const target = app.metadataCache.getFirstLinkpathDest(link.link, filePath);
        if (target && target.path !== filePath) {
          outlinks.push({ path: target.path, label: target.basename });
        }
      }
    }

    // 入链：扫描 resolvedLinks
    const backlinks: LinkTarget[] = [];
    const rl = app.metadataCache.resolvedLinks;
    for (const [sourcePath, targets] of Object.entries(rl)) {
      if (sourcePath === filePath) continue;
      if (filePath in targets) {
        const name = sourcePath.split('/').pop()?.replace(/\.md$/, '') ?? sourcePath;
        backlinks.push({ path: sourcePath, label: name });
      }
    }

    // 去重（同是出链+入链 → 归入出链）
    const outlinkPaths = new Set(outlinks.map((o) => o.path));
    const uniqueBacklinks = backlinks.filter((b) => !outlinkPaths.has(b.path));
    const allLinks = [...outlinks, ...uniqueBacklinks];

    if (allLinks.length === 0) {
      renderEmpty(canvas, '暂无关联笔记');
      nodesRef.current = [];
      return;
    }

    // 构建节点
    const nodes: GraphNode[] = [
      {
        id: 'center',
        label: dateLabel,
        path: filePath,
        type: 'center',
        x: 0, y: 0, vx: 0, vy: 0,
      },
      ...outlinks.map((l) => ({
        id: l.path,
        label: l.label,
        path: l.path,
        type: 'outlink' as const,
        x: 0, y: 0, vx: 0, vy: 0,
      })),
      ...uniqueBacklinks.map((l) => ({
        id: l.path,
        label: l.label,
        path: l.path,
        type: 'backlink' as const,
        x: 0, y: 0, vx: 0, vy: 0,
      })),
    ];

    runSimulation(nodes);
    renderGraph(ctx, nodes, canvas);
    nodesRef.current = nodes;
  }, [app, filePath, dateLabel]);

  // Canvas 点击 → 跳转
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;

      for (const node of nodesRef.current) {
        const r = (node.type === 'center' ? CENTER_R : NODE_R) + HIT_PAD;
        const dx = mx - node.x;
        const dy = my - node.y;
        // 圆点命中
        if (dx * dx + dy * dy <= r * r) {
          const f = app.vault.getAbstractFileByPath(node.path);
          if (f instanceof TFile) app.workspace.getLeaf(false).openFile(f);
          return;
        }
        // 文字标签命中（±tolerance 容差）
        if (
          node.labelX !== undefined && node.labelY !== undefined && node.labelW !== undefined &&
          mx >= node.labelX && mx <= node.labelX + node.labelW &&
          my >= node.labelY - LABEL_HIT_TOLERANCE && my <= node.labelY + LABEL_HIT_TOLERANCE
        ) {
          const f = app.vault.getAbstractFileByPath(node.path);
          if (f instanceof TFile) app.workspace.getLeaf(false).openFile(f);
          return;
        }
      }
    },
    [app],
  );

  return (
    <div className="mswb-mini-graph">
      <div className="mswb-mini-graph-header">
        🔗 双链图谱 · {dateLabel}
      </div>
      <canvas
        ref={canvasRef}
        className="mswb-mini-graph-canvas"
        onClick={handleClick}
      />
      <div className="mswb-mini-graph-legend">
        <span className="mswb-graph-legend-item">
          <span className="mswb-graph-dot" style={{ background: OUTLINK_COLOR }} /> 出链
        </span>
        <span className="mswb-graph-legend-item">
          <span className="mswb-graph-dot" style={{ background: BACKLINK_COLOR }} /> 入链
        </span>
        <span className="mswb-graph-legend-item">
          点击节点或文字跳转
        </span>
      </div>
    </div>
  );
}

// ===== 图谱弹窗（脱离日历面板，独立 Modal 展示） =====
export class GraphModal extends Modal {
  private root: Root | null = null;
  private filePath: string;
  private dateLabel: string;

  constructor(private pluginApp: App, filePath: string, dateLabel: string) {
    super(pluginApp);
    this.filePath = filePath;
    this.dateLabel = dateLabel;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('mswb-modal');
    this.contentEl.createEl('h3', { text: `🔗 双链图谱 · ${this.dateLabel}` });

    const container = this.contentEl.createDiv({ cls: 'mswb-graph-modal-body' });
    this.root = createRoot(container);
    this.root.render(
      React.createElement(MiniGraph, {
        app: this.pluginApp,
        filePath: this.filePath,
        dateLabel: this.dateLabel,
      }),
    );
  }

  onClose(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.contentEl.empty();
  }
}
