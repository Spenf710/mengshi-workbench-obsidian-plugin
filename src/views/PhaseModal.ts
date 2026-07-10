import { App, Modal, Setting, Notice } from 'obsidian';
import { addWorkingDays } from '../data/dateUtils';
import type { GanttPhase } from '../data/ganttData';

export interface PhaseSubmitData {
  id?: string;          // 编辑时传入已有的 id
  label: string;
  start: string;
  end: string;
}

export class PhaseModal extends Modal {
  private label = '';
  private startDate = '';
  private workDays = 30;
  private endDate = '';
  private existingPhases: GanttPhase[];
  private onSubmit: (data: PhaseSubmitData) => void;
  private editPhase?: GanttPhase;  // 编辑模式时的已有数据

  constructor(
    app: App,
    existingPhases: GanttPhase[],
    onSubmit: (data: PhaseSubmitData) => void,
    editPhase?: GanttPhase,
  ) {
    super(app);
    this.existingPhases = existingPhases;
    this.onSubmit = onSubmit;
    this.editPhase = editPhase;

    const now = new Date();
    this.startDate = editPhase?.start
      ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    this.label = editPhase?.label ?? '';
    this.endDate = editPhase?.end ?? addWorkingDays(this.startDate, this.workDays);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mswb-modal');

    const isEdit = !!this.editPhase;
    const updateEnd = () => {
      this.endDate = addWorkingDays(this.startDate, this.workDays);
    };

    contentEl.createEl('h3', {
      text: isEdit ? '✏️ 编辑阶段' : '📋 添加开发阶段',
    });

    new Setting(contentEl)
      .setName('阶段名称')
      .addText((t) => {
        t.setPlaceholder('例：V1 多维表')
          .setValue(this.label)
          .onChange((v) => (this.label = v));
      });

    new Setting(contentEl)
      .setName('开始日期')
      .addText((t) => {
        t.setValue(this.startDate).onChange((v) => {
          this.startDate = v;
          updateEnd();
        });
        t.inputEl.type = 'date';
      });

    new Setting(contentEl)
      .setName('工作日数')
      .setDesc('自动跳过周六日')
      .addText((t) => {
        t.setValue(String(this.workDays)).onChange((v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) {
            this.workDays = n;
            updateEnd();
          }
        });
        t.inputEl.type = 'number';
        t.inputEl.style.width = '80px';
      });

    new Setting(contentEl)
      .setName('预计结束')
      .setDesc('根据开始日期 + 工作日自动计算')
      .addText((t) => {
        t.setValue(this.endDate);
        t.inputEl.disabled = true;
        t.inputEl.style.opacity = '0.7';
      });

    const btnRow = contentEl.createDiv({ cls: 'mswb-modal-actions' });
    btnRow
      .createEl('button', { text: '取消' })
      .addEventListener('click', () => this.close());
    const submitBtn = btnRow.createEl('button', {
      text: isEdit ? '保存修改' : '添加阶段',
      cls: 'mswb-modal-submit',
    });
    submitBtn.addEventListener('click', () => this.submit());
  }

  private submit(): void {
    if (!this.label.trim()) {
      new Notice('请输入阶段名称');
      return;
    }

    // 验证日期合法性
    const newStart = new Date(this.startDate + 'T00:00:00');
    const newEnd = new Date(this.endDate + 'T00:00:00');
    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
      new Notice('日期格式无效');
      return;
    }
    if (newEnd <= newStart) {
      new Notice('结束日期必须晚于开始日期');
      return;
    }

    // 重叠检查：新阶段的 [start, end) 不与已有阶段交集
    for (const ep of this.existingPhases) {
      // 编辑时跳过自身
      if (this.editPhase && ep.id === this.editPhase.id) continue;

      const epStart = new Date(ep.start + 'T00:00:00');
      const epEnd = new Date(ep.end + 'T00:00:00');

      // 区间重叠条件：newStart < epEnd && newEnd > epStart
      if (newStart < epEnd && newEnd > epStart) {
        new Notice(`⚠️ 阶段时间与「${ep.label}」重叠，请调整日期`);
        return;
      }
    }

    this.onSubmit({
      id: this.editPhase?.id,
      label: this.label.trim(),
      start: this.startDate,
      end: this.endDate,
    });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
