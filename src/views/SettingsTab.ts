import { App, PluginSettingTab, Setting } from 'obsidian';
import type { Plugin } from 'obsidian';
import {
  getConfig,
  setConfig,
  resetConfig,
  getLlmConfig,
  setLlmConfig,
  type PluginConfig,
} from '../data/settings';

export class WorkbenchSettingsTab extends PluginSettingTab {
  private config: PluginConfig;

  constructor(app: App, private plugin: Plugin) {
    super(app, plugin);
    this.config = { ...getConfig() };
  }

  display(): void {
    this.config = { ...getConfig() }; // 每次打开刷新
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '猛士驾驶舱 — 设置' });

    // ===== 基础路径 =====
    containerEl.createEl('h3', { text: '📂 基础路径' });

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

    // ===== 项目根目录 =====
    containerEl.createEl('h3', { text: '📁 项目根目录' });
    containerEl.createEl('p', { text: '插件会扫描这些目录下的子文件夹作为项目', cls: 'setting-item-description' });

    const rootsContainer = containerEl.createDiv();
    this.renderRoots(rootsContainer);

    new Setting(containerEl)
      .setName('添加项目根目录')
      .setDesc('输入路径后回车或点 +')
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

    // ===== 默认类别 =====
    containerEl.createEl('h3', { text: '🏷️ 默认类别' });

    const catContainer = containerEl.createDiv();
    this.renderList(catContainer, this.config.baseCategories, (v) => {
      this.config.baseCategories = v;
    });

    new Setting(containerEl)
      .setName('添加默认类别')
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

    // ===== 默认车型 =====
    containerEl.createEl('h3', { text: '🚗 默认车型' });

    const vehContainer = containerEl.createDiv();
    this.renderList(vehContainer, this.config.baseVehicles, (v) => {
      this.config.baseVehicles = v;
    });

    new Setting(containerEl)
      .setName('添加默认车型')
      .addText((t) => {
        t.setPlaceholder('新车型名');
        t.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && t.getValue().trim()) {
            if (!this.config.baseVehicles.includes(t.getValue().trim())) {
              this.config.baseVehicles.push(t.getValue().trim());
              t.setValue('');
              this.renderList(vehContainer, this.config.baseVehicles, (v) => { this.config.baseVehicles = v; });
            }
          }
        });
      })
      .addButton((b) => b.setButtonText('+').onClick(() => {
        const input = containerEl.querySelector('input[placeholder="新车型名"]') as HTMLInputElement;
        if (input && input.value.trim() && !this.config.baseVehicles.includes(input.value.trim())) {
          this.config.baseVehicles.push(input.value.trim());
          input.value = '';
          this.renderList(vehContainer, this.config.baseVehicles, (v) => { this.config.baseVehicles = v; });
        }
      }));

    // ===== 生长面板排除文件夹 =====
    containerEl.createEl('h3', { text: '🌱 生长面板排除文件夹' });
    containerEl.createEl('p', { text: '这些文件夹不会出现在种子浏览器和知识扫描中。以 / 结尾表示前缀匹配。', cls: 'setting-item-description' });

    const exclContainer = containerEl.createDiv();
    this.renderList(exclContainer, this.config.excludedFolders, (v) => {
      this.config.excludedFolders = v;
    });

    new Setting(containerEl)
      .setName('添加排除文件夹')
      .addText((t) => {
        t.setPlaceholder('例: Clippings/');
        t.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && t.getValue().trim()) {
            if (!this.config.excludedFolders.includes(t.getValue().trim())) {
              this.config.excludedFolders.push(t.getValue().trim());
              t.setValue('');
              this.renderList(exclContainer, this.config.excludedFolders, (v) => { this.config.excludedFolders = v; });
            }
          }
        });
      })
      .addButton((b) => b.setButtonText('+').onClick(() => {
        const input = containerEl.querySelector('input[placeholder="例: Clippings/"]') as HTMLInputElement;
        if (input && input.value.trim() && !this.config.excludedFolders.includes(input.value.trim())) {
          this.config.excludedFolders.push(input.value.trim());
          input.value = '';
          this.renderList(exclContainer, this.config.excludedFolders, (v) => { this.config.excludedFolders = v; });
        }
      }));

    // ===== AI 摘要配置 =====
    containerEl.createEl('h3', { text: '🤖 AI 摘要配置' });
    containerEl.createEl('p', { text: '碰撞面板的笔记摘要由 LLM 生成。支持 OpenAI 兼容接口和 Anthropic Messages 兼容接口。', cls: 'setting-item-description' });

    const llm = getLlmConfig();

    new Setting(containerEl)
      .setName('API 类型')
      .setDesc('OpenAI：/chat/completions 格式；Anthropic：/messages 格式（DeepSeek 等）')
      .addDropdown((d) => {
        d.addOption('openai', 'OpenAI 兼容');
        d.addOption('anthropic', 'Anthropic 兼容');
        d.setValue(llm.apiType ?? 'openai');
        d.onChange(async (v) => { await setLlmConfig({ apiType: v as 'openai' | 'anthropic' }); });
      });

    const endpointSetting = new Setting(containerEl)
      .setName('接口地址')
      .addText((t) =>
        t.setValue(llm.endpoint)
          .setPlaceholder('https://api.deepseek.com/anthropic')
          .onChange(async (v) => { await setLlmConfig({ endpoint: v.trim() }); }));

    endpointSetting.descEl.innerHTML =
      '路由/中转：http://127.0.0.1:15721（OpenCode Go 等本地代理）<br>' +
      '直连：https://api.deepseek.com/anthropic（DeepSeek）';

    new Setting(containerEl)
      .setName('模型名')
      .setDesc('如 deepseek-v4-flash、qwen-plus、qwen-max、glm-4-flash 等')
      .addText((t) =>
        t.setValue(llm.model)
          .setPlaceholder('deepseek-v4-flash')
          .onChange(async (v) => { await setLlmConfig({ model: v.trim() }); }));

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('直连 API 填写对应厂商的 Key，本地路由可留空')
      .addText((t) => {
        t.setValue(llm.apiKey)
          .setPlaceholder('sk-xxxxxxxx（直连填写，路由留空）');
        t.inputEl.type = 'password';
        t.onChange(async (v) => { await setLlmConfig({ apiKey: v.trim() }); });
      });

    // ===== 操作按钮 =====
    containerEl.createEl('h3', { text: '⚙ 操作' });

    new Setting(containerEl)
      .setName('保存设置')
      .setDesc('保存后需要重载插件才能完全生效')
      .addButton((b) => b
        .setButtonText('💾 保存')
        .setCta()
        .onClick(async () => {
          await setConfig(this.config);
          this.config = { ...getConfig() };
        }));

    new Setting(containerEl)
      .setName('恢复默认设置')
      .setDesc('将所有配置恢复为默认值')
      .addButton((b) => b
        .setButtonText('🔄 恢复默认')
        .setWarning()
        .onClick(async () => {
          await resetConfig();
          this.config = { ...getConfig() };
          this.display();
        }));
  }

  private renderRoots(container: HTMLElement): void {
    container.empty();
    if (this.config.projectRoots.length === 0) {
      container.createEl('p', { text: '（无，将使用默认值：项目管理-系统、项目管理-车型）', cls: 'setting-item-description' });
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
