import React, { useEffect, useRef, useCallback } from 'react';
import { type App, Modal, TFile } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';

// ===== 类型 =====
interface LinkTarget { path: string; label: string; }

interface GraphNode {
  id: string; label: string; path: string;
  type: 'center' | 'outlink' | 'backlink';
  x: number; y: number; vx: number; vy: number;
  labelX?: number; labelY?: number; labelW?: number;
}

// ===== 常量 =====
const W = 520, H = 260;
const CX = W / 2, CY = H / 2;
const NODE_R = 5, CENTER_R = 8;
const HIT_PAD = 5, LABEL_GAP = 4, LABEL_MAX = 10, LABEL_HIT_Y = 9;
const SIM_DAMPING = 0.5, SIM_SPRING = 0.012, SIM_REPEL = 900;
const SIM_PAD = 15, SIM_INIT_R = 100, SIM_INIT_SPREAD = 40;
const SIM_RING_TARGET = 95;
const SIM_DRAG_BOUNCE = 4;
const OUT_COLOR = '#4ade80', BACK_COLOR = '#fb923c';
const FONT_BOLD = 'bold 11px -apple-system, sans-serif';
const FONT_NORM = '10px -apple-system, sans-serif';
const FONT_EMPTY = '13px -apple-system, sans-serif';

// ===== 单步模拟 =====
function simStep(nodes: GraphNode[], alpha: number): number {
  const center = nodes.find((n) => n.type === 'center');
  if (!center) return 0;

  let energy = 0;

  // 弹簧力：目标距离 SIM_RING_TARGET，偏离时拉回
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    const dx = center.x - n.x, dy = center.y - n.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    // 偏离目标距离越多，回拉力越大；小于目标时向外推
    const offset = dist - SIM_RING_TARGET;
    const f = offset * SIM_SPRING * alpha + 0.03 * alpha;
    n.vx += (dx / dist) * f;
    n.vy += (dy / dist) * f;
    energy += Math.abs(f);
  }

  // 节点间斥力
  for (let i = 1; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (!a || !b) continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      const d2 = dx * dx + dy * dy || 1;
      const f = (SIM_REPEL * alpha) / d2;
      const fx = (dx / Math.sqrt(d2)) * f, fy = (dy / Math.sqrt(d2)) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
      energy += f;
    }
  }

  // 应用速度 + 边界
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    n.vx *= SIM_DAMPING; n.vy *= SIM_DAMPING;
    n.x += n.vx; n.y += n.vy;
    const p = SIM_PAD;
    if (n.x < p) n.x = p;
    if (n.x > W - p) n.x = W - p;
    if (n.y < p) n.y = p;
    if (n.y > H - p) n.y = H - p;
  }

  return energy;
}

// ===== Canvas 初始化 =====
function setupCv(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr;
  c.style.width = W + 'px'; c.style.height = H + 'px';
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ===== 渲染（含 hover / drag 高亮） =====
function render(
  ctx: CanvasRenderingContext2D, nodes: GraphNode[],
  c: HTMLCanvasElement, hover: string | null, drag: string | null,
): void {
  ctx.clearRect(0, 0, W, H);
  const center = nodes.find((n) => n.type === 'center');
  if (!center) return;

  const cs = getComputedStyle(c);
  const accent = cs.getPropertyValue('--interactive-accent').trim() || '#7c3aed';
  const textCol = cs.getPropertyValue('--text-normal').trim() || '#333';
  const bg = cs.getPropertyValue('--background-modifier-border').trim() || '#ddd';

  // 边
  for (const n of nodes) {
    if (n.type === 'center') continue;
    const isHoverEdge = hover === n.id || drag === n.id;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(n.x, n.y);
    ctx.strokeStyle = isHoverEdge ? accent : bg;
    ctx.lineWidth = isHoverEdge ? 1.5 : 0.8;
    ctx.stroke();
  }

  // 节点
  for (const n of nodes) {
    const r = n.type === 'center' ? CENTER_R : NODE_R;
    const isHover = hover === n.id;
    const isDrag = drag === n.id;

    // 光晕
    if (isHover || isDrag) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
      ctx.fillStyle = accent + '30';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    if (n.type === 'center') ctx.fillStyle = accent;
    else if (n.type === 'outlink') ctx.fillStyle = OUT_COLOR;
    else ctx.fillStyle = BACK_COLOR;
    if (isDrag) ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 标签
    ctx.font = n.type === 'center' ? FONT_BOLD : FONT_NORM;
    ctx.fillStyle = (isHover || isDrag) ? accent : (n.type === 'center' ? accent : textCol);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const txt = n.label.length > LABEL_MAX ? n.label.slice(0, LABEL_MAX) + '…' : n.label;
    const lx = n.x + r + LABEL_GAP;
    ctx.fillText(txt, lx, n.y);
    const m = ctx.measureText(txt);
    n.labelX = lx; n.labelY = n.y; n.labelW = m.width;
  }
}

// ===== 空状态 =====
function renderEmpty(c: HTMLCanvasElement, msg: string): void {
  const ctx = setupCv(c); if (!ctx) return;
  ctx.font = FONT_EMPTY;
  ctx.fillStyle = '#999';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, H / 2);
}

// ===== 命中检测 =====
function hitNode(nodes: GraphNode[], mx: number, my: number): GraphNode | null {
  for (const n of nodes) {
    const r = (n.type === 'center' ? CENTER_R : NODE_R) + HIT_PAD;
    if ((mx - n.x) ** 2 + (my - n.y) ** 2 <= r * r) return n;
    if (n.labelX !== undefined && n.labelW !== undefined &&
      mx >= n.labelX && mx <= n.labelX + n.labelW &&
      my >= n.y - LABEL_HIT_Y && my <= n.y + LABEL_HIT_Y) return n;
  }
  return null;
}

function canvasPos(c: HTMLCanvasElement, e: MouseEvent): { mx: number; my: number } {
  const r = c.getBoundingClientRect();
  return { mx: (e.clientX - r.left) * (W / r.width), my: (e.clientY - r.top) * (H / r.height) };
}

// ===== 组件 =====
export function MiniGraph({
  app, filePath, dateLabel,
}: { app: App; filePath: string; dateLabel: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const simRef = useRef<{ raf: number; hover: string | null; drag: string | null; alpha: number } | null>(null);

  // 清理上一个动画
  const stopSim = useCallback(() => {
    const s = simRef.current;
    if (s) { cancelAnimationFrame(s.raf); simRef.current = null; }
  }, []);

  useEffect(() => {
    stopSim();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupCv(canvas);
    if (!ctx) return;

    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) { renderEmpty(canvas, dateLabel + ' — 暂无日记'); nodesRef.current = []; return; }

    // 收集链接
    const cache = app.metadataCache.getFileCache(file);
    const outlinks: LinkTarget[] = [];
    if (cache?.links) for (const l of cache.links) {
      const t = app.metadataCache.getFirstLinkpathDest(l.link, filePath);
      if (t && t.path !== filePath) outlinks.push({ path: t.path, label: t.basename });
    }
    const backlinks: LinkTarget[] = [];
    const rl = app.metadataCache.resolvedLinks;
    for (const [sp, tgts] of Object.entries(rl)) {
      if (sp === filePath || !(filePath in tgts)) continue;
      backlinks.push({ path: sp, label: sp.split('/').pop()?.replace(/\.md$/, '') ?? sp });
    }
    const outP = new Set(outlinks.map(o => o.path));
    const uniqBack = backlinks.filter(b => !outP.has(b.path));
    const allLinks = [...outlinks, ...uniqBack];
    if (allLinks.length === 0) { renderEmpty(canvas, '暂无关联笔记'); nodesRef.current = []; return; }

    // 构建节点
    const nodes: GraphNode[] = [
      { id: 'center', label: dateLabel, path: filePath, type: 'center', x: CX, y: CY, vx: 0, vy: 0 },
      ...outlinks.map(l => ({ id: l.path, label: l.label, path: l.path, type: 'outlink' as const, x: 0, y: 0, vx: 0, vy: 0 })),
      ...uniqBack.map(l => ({ id: l.path, label: l.label, path: l.path, type: 'backlink' as const, x: 0, y: 0, vx: 0, vy: 0 })),
    ];
    // 初始环形分散排列（保证名称可读）
    const ringCount = nodes.length - 1;
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i];
      const angle = (i - 1) / ringCount * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const dist = SIM_INIT_R + Math.random() * SIM_INIT_SPREAD;
      n.x = CX + Math.cos(angle) * dist;
      n.y = CY + Math.sin(angle) * dist;
    }

    nodesRef.current = nodes;

    // 动画状态
    const state = { raf: 0, hover: null as string | null, drag: null as string | null, alpha: 1.0 };

    // --- 鼠标事件 ---
    const onDown = (e: MouseEvent) => {
      const { mx, my } = canvasPos(canvas, e);
      const hit = hitNode(nodes, mx, my);
      if (hit) { state.drag = hit.id; state.hover = hit.id; }
    };
    const onMove = (e: MouseEvent) => {
      const { mx, my } = canvasPos(canvas, e);
      if (state.drag) {
        const n = nodes.find(x => x.id === state.drag);
        if (n) { n.x = mx; n.y = my; n.vx = 0; n.vy = 0; }
      } else {
        state.hover = hitNode(nodes, mx, my)?.id ?? null;
      }
    };
    const onUp = () => {
      if (state.drag) {
        // 拖拽松手 → 给一点随机初速度让节点自然回弹
        const n = nodes.find(x => x.id === state.drag);
        if (n) { n.vx = (Math.random() - 0.5) * SIM_DRAG_BOUNCE; n.vy = (Math.random() - 0.5) * SIM_DRAG_BOUNCE; }
      }
      state.drag = null;
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // --- 双击 → 打开文件 ---
    const onDbl = (e: MouseEvent) => {
      const { mx, my } = canvasPos(canvas, e);
      const hit = hitNode(nodes, mx, my);
      if (hit) { const f = app.vault.getAbstractFileByPath(hit.path); if (f instanceof TFile) app.workspace.getLeaf(false).openFile(f); }
    };
    canvas.addEventListener('dblclick', onDbl);

    // --- 动画循环 ---
    const tick = () => {
      if (!state.drag) state.alpha *= 0.985;
      simStep(nodes, state.alpha * 0.7);
      render(ctx, nodes, canvas, state.hover, state.drag);
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    simRef.current = state;

    return () => {
      cancelAnimationFrame(state.raf);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('dblclick', onDbl);
      simRef.current = null;
    };
  }, [app, filePath, dateLabel, stopSim]);

  return (
    <div className="mswb-mini-graph">
      <div className="mswb-mini-graph-header">🔗 双链图谱 · {dateLabel}</div>
      <canvas ref={canvasRef} className="mswb-mini-graph-canvas" />
      <div className="mswb-mini-graph-legend">
        <span className="mswb-graph-legend-item"><span className="mswb-graph-dot" style={{ background: OUT_COLOR }} /> 出链</span>
        <span className="mswb-graph-legend-item"><span className="mswb-graph-dot" style={{ background: BACK_COLOR }} /> 入链</span>
        <span className="mswb-graph-legend-item">拖拽节点 · 双击跳转 · hover 高亮</span>
      </div>
    </div>
  );
}

// ===== 图谱弹窗 =====
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
    this.root.render(React.createElement(MiniGraph, { app: this.pluginApp, filePath: this.filePath, dateLabel: this.dateLabel }));
  }

  onClose(): void {
    if (this.root) { this.root.unmount(); this.root = null; }
    this.contentEl.empty();
  }
}
