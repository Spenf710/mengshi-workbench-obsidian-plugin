/**
 * 弹窗辅助 — 将 Obsidian 原生 Modal 定位到插件活动面板中央（无闪烁）
 *
 * 闪烁根因：Obsidian 的 `.modal-container` 默认铺满全屏（flex 居中），自带打开
 * 动画（scale+fade）。若在动画开始后才用 JS 改位置，弹窗会先在窗口中央播放
 * 一帧，再"跳"到插件面板区域 → 晃眼。
 *
 * 解决方案：
 *   1. 在 onOpen()（动画尚未开始）同步完成定位，弹窗直接以最终位置原地出现；
 *   2. 给容器加 `.mswb-modal-noflicker` 类，由 styles.css 强覆盖（!important）
 *      禁用 Obsidian 的打开动画，双保险确保零跳变、零闪烁。
 */
import { Modal } from 'obsidian';

export function centerModalInWorkbench(modal: Modal): void {
  const root = document.querySelector('.mengshi-workbench-root') as HTMLElement | null;
  if (!root) return;

  const container = modal.modalEl.parentElement as HTMLElement | null;
  if (!container) return;

  // 同步定位到插件面板区域（动画尚未开始）
  const r = root.getBoundingClientRect();
  container.style.position = 'fixed';
  container.style.left = `${r.left}px`;
  container.style.top = `${r.top}px`;
  container.style.width = `${r.width}px`;
  container.style.height = `${r.height}px`;
  container.style.maxHeight = 'none';

  // 加专用类名，CSS 用 !important 强覆盖禁用 Obsidian 打开动画
  container.addClass('mswb-modal-noflicker');
}