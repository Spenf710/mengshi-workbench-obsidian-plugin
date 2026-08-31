import { App, PluginSettingTab, Setting } from 'obsidian';
import type { Plugin } from 'obsidian';
import {
  getConfig,
  setConfig,
  resetConfig,
  type PluginConfig,
  getSessionConfig,
  setSessionConfig,
  getFeishuConfig,
  setFeishuConfig,
} from '../data/settings';

export class WorkbenchSettingsTab extends PluginSettingTab {
  private config: PluginConfig;

  constructor(app: App, private plugin: Plugin) {
    super(app, plugin);
    this.config = { ...getConfig() };
  }

  display(): void {
    this.config = { ...getConfig() };
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '猛士驾驶舱 设置' });

    // ===== 基础路径 =====
    containerEl.createEl('h3', { text: '📁 基础路径' });

    new Setting(containerEl)
      .setName('工作日志目录')
      .setDesc('存放每日日志的文件夹路径')
      .addText((t) =>
        t.setValue(this.config.workLogPath)
          .setPlaceholder('工作日志')
          .onChange((v) => this.config.workLogPath = v));

    new Setting(containerEl)
      .setName('日记模板')
      .setDesc('创建新日记时使用的模板文件路径')
      .addText((t) =>
        t.setValue(this.config.diaryTemplate)
          .setPlaceholder('templates/工作日志.md')
          .onChange((v) => this.config.diaryTemplate = v));

    new Setting(containerEl)
      .setName('项目根目录')
      .addText((t) => {
        t.setPlaceholder('例: 项目管理-客户');
        t.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && t.getValue().trim()) {
            this.config.projectRoots.push(t.getValue().trim());
            t.setValue('');
            this.renderRoots(rootsContainer);
          }
        });
      })
      .addButton((b) => b.setButtonText('+').onClick(() => {
        const input = containerEl.querySelector('input[placeholder="例: 项目管理-客户"]') as HTMLInputElement;
        if (input && input.value.trim()) {
          this.config.projectRoots.push(input.value.trim());
          input.value = '';
          this.renderRoots(rootsContainer);
        }
      }));

    const rootsContainer = containerEl.createDiv();
    this.renderRoots(rootsContainer);

    // ===== 类别与车型 =====
    containerEl.createEl('h3', { text: '🏷️ 类别与标签' });

    new Setting(containerEl)
      .setName('默认类别')
      .addText((t) => {
        t.setPlaceholder('新类别名');
        t.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && t.getValue().trim()) {
            if (!this.config.baseCategories.includes(t.getValue().trim())) {
              this.config.baseCategories.push(t.getValue().trim());
              t.setValue('');
              this.renderList(catContainer, this.config.baseCategories, (v) => { this.config.baseCategories = v; });
            }
          }
        });
      })
      .addButton((b) => b.setButtonText('+').onClick(() => {
        const input = containerEl.querySelector('input[placeholder="新类别名"]') as HTMLInputElement;
        if (input && input.value.trim() && !this.config.baseCategories.includes(input.value.trim())) {
          this.config.baseCategories.push(input.value.trim());
          input.value = '';
          this.renderList(catContainer, this.config.baseCategories, (v) => { this.config.baseCategories = v; });
        }
      }));

    const catContainer = containerEl.createDiv();
    this.renderList(catContainer, this.config.baseCategories, (v) => { this.config.baseCategories = v; });

    new Setting(containerEl)
      .setName('默认标签')
      .addText((t) => {
        t.setPlaceholder('新标签名');
        t.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && t.getValue().trim()) {
            if (!this.config.baseTags.includes(t.getValue().trim())) {
              this.config.baseTags.push(t.getValue().trim());
              t.setValue('');
              this.renderList(tagContainer, this.config.baseTags, (v) => { this.config.baseTags = v; });
            }
          }
        });
      })
      .addButton((b) => b.setButtonText('+').onClick(() => {
        const input = containerEl.querySelector('input[placeholder="新标签名"]') as HTMLInputElement;
        if (input && input.value.trim() && !this.config.baseTags.includes(input.value.trim())) {
          this.config.baseTags.push(input.value.trim());
          input.value = '';
          this.renderList(tagContainer, this.config.baseTags, (v) => { this.config.baseTags = v; });
        }
      }));

    const tagContainer = containerEl.createDiv();
    this.renderList(tagContainer, this.config.baseTags, (v) => { this.config.baseTags = v; });

    // ===== Tab 页配置 =====
    containerEl.createEl('h3', { text: '📑 Tab 页' });

    const TAB_LABELS: Record<string, string> = {
      calendar: '📅 日历',
      projects: '📂 项目',
      todos: '✅ 待办',
      gantt: '📊 排期',
      feishu: '📡 飞书',
      sessions: '💬 会话',
    };

    for (const [key, label] of Object.entries(TAB_LABELS)) {
      const isVisible = this.config.visibleTabs?.[key] !== false;
      new Setting(containerEl)
        .setName(label)
        .addToggle((t) => t.setValue(isVisible).onChange((v) => {
          if (!this.config.visibleTabs) this.config.visibleTabs = {};
          this.config.visibleTabs[key] = v;
        }));
    }

    // ===== Claude 会话 =====
    const sessionCfg = { ...getSessionConfig() };
    const sessionText: any = {};

    containerEl.createEl('h3', { text: '💬 Claude 会话' });

    new Setting(containerEl)
      .setName('会话目录')
      .setDesc('会话 .jsonl 根目录，默认 ~/.claude/projects')
      .addText((t) => {
        t.setValue(sessionCfg.sessionRootDir)
          .setPlaceholder('C:\\Users\\xxx\\.claude\\projects')
          .onChange((v) => { sessionText.sessionRootDir = v; });
      });

    new Setting(containerEl)
      .setName('claude CLI 路径')
      .setDesc('loop 起新会话用，留空自动检测')
      .addText((t) => {
        t.setValue(sessionCfg.claudeCliPath)
          .setPlaceholder('claude')
          .onChange((v) => { sessionText.claudeCliPath = v; });
      });

    new Setting(containerEl)
      .setName('会话存档目录')
      .setDesc('存档会话的存放路径，留空时默认 ~/.claude/projects/_archived')
      .addText((t) => {
        t.setValue(sessionCfg.archiveDir)
          .setPlaceholder('留空使用默认路径')
          .onChange((v) => { sessionText.archiveDir = v; });
      });

    // ===== 飞书 =====
    const feishuCfg = { ...getFeishuConfig() };
    const feishuText: any = {};

    containerEl.createEl('h3', { text: '📡 飞书' });

    new Setting(containerEl)
      .setName('lark-cli 路径')
      .setDesc('留空自动检测，失败时手动指定')
      .addText((t) => {
        t.setValue(feishuCfg.larkCliPath)
          .setPlaceholder('留空自动检测')
          .onChange((v) => { feishuText.larkCliPath = v; });
      });

    // ===== 操作按钮 =====
    containerEl.createEl('hr');

    new Setting(containerEl)
      .setName('保存设置')
      .setDesc('所有改动一次性保存，需重载插件完全生效')
      .addButton((b) => b
        .setButtonText('💾 保存')
        .setCta()
        .onClick(async () => {
          await setConfig(this.config);
          await setSessionConfig({
            sessionRootDir: sessionText.sessionRootDir ?? '',
            claudeCliPath: sessionText.claudeCliPath ?? '',
            archiveDir: sessionText.archiveDir ?? '',
          });
          await setFeishuConfig({
            larkCliPath: feishuText.larkCliPath ?? '',
          });
          this.config = { ...getConfig() };
          this.display();
        }));

    new Setting(containerEl)
      .setName('恢复默认')
      .setDesc('将所有配置恢复为默认值')
      .addButton((b) => b
        .setButtonText('🔄 恢复默认')
        .setWarning()
        .onClick(async () => {
          await resetConfig();
          await setSessionConfig({ sessionRootDir: '', claudeCliPath: '', archiveDir: '' });
          await setFeishuConfig({ larkCliPath: '' });
          this.config = { ...getConfig() };
          this.display();
        }));
  }

  private renderRoots(container: HTMLElement): void {
    container.empty();
    if (this.config.projectRoots.length === 0) {
      container.createEl('p', { text: '（无）', cls: 'setting-item-description' });
      return;
    }
    for (let i = 0; i < this.config.projectRoots.length; i++) {
      const row = container.createDiv({ cls: 'setting-item' });
      row.createSpan({ text: this.config.projectRoots[i], cls: 'setting-item-name' });
      const btn = row.createEl('button', { text: '✕', cls: 'mswb-del-btn' });
      btn.addEventListener('click', () => {
        this.config.projectRoots.splice(i, 1);
        this.renderRoots(container);
      });
    }
  }

  private renderList(container: HTMLElement, items: string[], onChange: (v: string[]) => void): void {
    container.empty();
    for (let i = 0; i < items.length; i++) {
      const row = container.createDiv({ cls: 'setting-item' });
      row.createSpan({ text: items[i], cls: 'setting-item-name' });
      const btn = row.createEl('button', { text: '✕', cls: 'mswb-del-btn' });
      btn.addEventListener('click', () => {
        items.splice(i, 1);
        onChange([...items]);
        this.renderList(container, items, onChange);
      });
    }
  }
}