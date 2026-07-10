import { App, Modal, Setting, Notice } from 'obsidian';

export interface MilestoneSubmitData {
  date: string;
  label: string;
  icon: string;
}

const PRESET_ICONS = ['◆', '🚩', '⭐', '🔔', '📌', '🎯', '🔧', '📋'];

export class MilestoneModal extends Modal {
  private date = '';
  private label = '';
  private icon = '◆';
  private onSubmit: (data: MilestoneSubmitData) => void;
  private editMs?: { date: string; label: string; icon?: string };

  constructor(
    app: App,
    onSubmit: (data: MilestoneSubmitData) => void,
    editMs?: { date: string; label: string; icon?: string },
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.editMs = editMs;

    const now = new Date();
    this.date =
      editMs?.date ??
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    this.label = editMs?.label ?? '';
    this.icon = editMs?.icon ?? '◆';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mswb-modal');

    const isEdit = !!this.editMs;
    contentEl.createEl('h3', {
      text: isEdit ? '✏️ 编辑里程碑' : '🚩 添加里程碑',
    });

    new Setting(contentEl)
      .setName('日期')
      .addText((t) => {
        t.setValue(this.date).onChange((v) => (this.date = v));
        t.inputEl.type = 'date';
      });

    new Setting(contentEl)
      .setName('标签')
      .addText((t) => {
        t.setPlaceholder('例：V1 上线')
          .setValue(this.label)
          .onChange((v) => (this.label = v));
      });

    // 图标选择器：按钮网格
    const iconSetting = new Setting(contentEl)
      .setName('图标')
      .setDesc('选择里程碑图标');

    const iconGrid = iconSetting.settingEl.createDiv({ cls: 'mswb-icon-grid' });
    for (const ico of PRESET_ICONS) {
      const btn = iconGrid.createEl('button', {
        text: ico,
        cls: `mswb-icon-option${ico === this.icon ? ' selected' : ''}`,
      });
      btn.addEventListener('click', () => {
        this.icon = ico;
        iconGrid
          .querySelectorAll('.mswb-icon-option')
          .forEach((el) => el.classList.remove('selected'));
        btn.classList.add('selected');
      });
    }

    const btnRow = contentEl.createDiv({ cls: 'mswb-modal-actions' });
    btnRow
      .createEl('button', { text: '取消' })
      .addEventListener('click', () => this.close());
    const submitBtn = btnRow.createEl('button', {
      text: isEdit ? '保存修改' : '添加里程碑',
      cls: 'mswb-modal-submit',
    });
    submitBtn.addEventListener('click', () => this.submit());
  }

  private submit(): void {
    if (!this.label.trim()) {
      new Notice('请输入里程碑标签');
      return;
    }
    if (!this.date) {
      new Notice('请选择日期');
      return;
    }

    this.onSubmit({
      date: this.date,
      label: this.label.trim(),
      icon: this.icon,
    });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
