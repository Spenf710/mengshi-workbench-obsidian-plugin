/**
 * 任务编辑弹窗 — 新建/编辑会话任务（Phase 9）
 * 参照 QuickTodoModal 原生 Modal 范式
 */

import { App, Modal } from 'obsidian';
import { scanProjects, type ProjectInfo } from '../data/projectScanner';
import type { TaskStatus } from '../data/taskManager';
import { TASK_STATUS_LIST } from '../data/taskManager';

export interface TaskModalData {
  title: string;
  project: string | null;
  priority: '高' | '中' | '低' | '';
  status: TaskStatus;
}

export class TaskModal extends Modal {
  private data: TaskModalData;
  private onSubmit: (data: TaskModalData) => void;
  private projects: ProjectInfo[] = [];

  constructor(
    app: App,
    initial: Partial<TaskModalData>,
    onSubmit: (data: TaskModalData) => void,
  ) {
    super(app);
    this.data = {
      title: initial.title || '',
      project: initial.project ?? null,
      priority: initial.priority || '中',
      status: initial.status || '排队',
    };
    this.onSubmit = onSubmit;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mswb-modal');

    try {
      this.projects = await scanProjects(this.app);
    } catch {
      this.projects = [];
    }

    contentEl.createEl('h3', { text: this.data.title ? '✏️ 编辑任务' : '🆕 新建任务' });

    // 标题
    const titleRow = contentEl.createDiv({ cls: 'mswb-modal-fullrow' });
    const titleInput = titleRow.createEl('input', {
      type: 'text',
      placeholder: '任务标题...',
      cls: 'mswb-modal-task-input',
    });
    titleInput.value = this.data.title;
    titleInput.addEventListener('input', () => (this.data.title = titleInput.value));
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
    });

    // 项目 + 优先级 + 状态
    const row = contentEl.createDiv({ cls: 'mswb-modal-inlinerow' });

    // 项目下拉
    const projCell = row.createDiv();
    projCell.createEl('label', { text: '归属项目', cls: 'mswb-modal-label' });
    const projSelect = projCell.createEl('select', { cls: 'mswb-modal-select' });
    projSelect.createEl('option', { value: '', text: '（无）' });
    for (const p of this.projects) {
      const opt = projSelect.createEl('option', { value: p.folderPath, text: p.name });
      if (this.data.project === p.folderPath) opt.selected = true;
    }
    projSelect.addEventListener('change', () => {
      this.data.project = projSelect.value || null;
    });

    // 优先级
    const priCell = row.createDiv();
    priCell.createEl('label', { text: '优先级', cls: 'mswb-modal-label' });
    const priSelect = priCell.createEl('select', { cls: 'mswb-modal-select' });
    for (const p of ['', '高', '中', '低'] as const) {
      const opt = priSelect.createEl('option', { value: p, text: p || '—' });
      if (this.data.priority === p) opt.selected = true;
    }
    priSelect.addEventListener('change', () => {
      this.data.priority = priSelect.value as any;
    });

    // 状态
    const stCell = row.createDiv();
    stCell.createEl('label', { text: '状态', cls: 'mswb-modal-label' });
    const stSelect = stCell.createEl('select', { cls: 'mswb-modal-select' });
    for (const s of TASK_STATUS_LIST) {
      const opt = stSelect.createEl('option', { value: s, text: s });
      if (this.data.status === s) opt.selected = true;
    }
    stSelect.addEventListener('change', () => {
      this.data.status = stSelect.value as TaskStatus;
    });

    // 按钮
    const btnRow = contentEl.createDiv({ cls: 'mswb-modal-actions' });
    btnRow.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
    btnRow.createEl('button', { text: '保存', cls: 'mod-cta' }).addEventListener('click', () => this.submit());

    titleInput.focus();
  }

  private submit(): void {
    if (!this.data.title.trim()) {
      return; // 空标题不提交
    }
    this.data.title = this.data.title.trim();
    this.onSubmit(this.data);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}