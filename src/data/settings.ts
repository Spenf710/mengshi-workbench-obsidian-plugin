import type { Plugin } from 'obsidian';

// ===== 飞书配置 =====
export interface FeishuConfig {
  /** lark-cli 自定义路径（空字符串 = 自动检测） */
  larkCliPath: string;
  /** 监控的飞书空间 ID 列表 */
  spaces: string[];
  /** 刷新间隔（秒），0 = 手动刷新 */
  refreshInterval: number;
  /** 上次同步时间 */
  lastSyncAt: string | null;
  /** 扫描时排除的文件夹 token 列表 */
  excludedFolders: string[];
  /** 缓存的项目分组结果 */
  cachedProjectGroups?: any[];
  /** 缓存的类型分组结果 */
  cachedTypeGroups?: any[];
  /** 缓存的智能纪要 */
  cachedMinutes?: any[];
  /** 文件归属手动覆盖：fileToken → projectKey */
  fileOverrides?: Record<string, string>;
}

const DEFAULT_FEISHU_CONFIG: FeishuConfig = {
  larkCliPath: '',
  spaces: [],
  refreshInterval: 300,
  lastSyncAt: null,
  excludedFolders: [],
};

// ===== 类型 =====
export interface GanttOverride {
  start?: string;
  end?: string;
  progress?: number;
  milestones?: { date: string; label: string; icon?: string }[];
  phases?: { id: string; label: string; start: string; end: string; progress: number }[];
}

// ===== 会话管理配置 =====
export interface SessionConfig {
  /** Claude 会话根目录（默认 ~/.claude/projects），存放各 vault 的 .jsonl */
  sessionRootDir: string;
  /** claude CLI 路径（空 = 自动检测，loop 功能用） */
  claudeCliPath: string;
}

const DEFAULT_SESSION_CONFIG: SessionConfig = {
  sessionRootDir: '',
  claudeCliPath: '',
};

export interface ProjectMetaOverride {
  systemType?: string;
  tag?: string;
  emoji?: string;
}

interface GanttOverridesData {
  [projectId: string]: GanttOverride;
}

interface ProjectUrlsData {
  [folderName: string]: string;
}

// ===== 插件配置 =====
export interface PluginConfig {
  diaryTemplate: string;
  workLogPath: string;
  projectRoots: string[];
  baseCategories: string[];
  baseTags: string[];
  /** 生长面板排除的文件夹路径（不会出现在种子浏览器中） */
  excludedFolders: string[];
  /** 会话任务存储目录（vault 内相对路径，存放独立任务清单 md） */
  taskStorePath: string;
  /** 可见 Tab 页配置：key 为 tabKey，true=显示 */
  visibleTabs: Record<string, boolean>;
}

const DEFAULT_CONFIG: PluginConfig = {
  diaryTemplate: 'templates/工作日志.md',
  workLogPath: '工作日志',
  projectRoots: ['项目管理-系统', '项目管理-车型', '日常工作-通用'],
  baseCategories: ['通用', '其他'],
  baseTags: ['通用'],
  excludedFolders: ['工作日志/', '工作周报/', 'templates/', '.obsidian/', '.claude/', '.claudian/', '.trash/'],
  taskStorePath: '会话任务',
  visibleTabs: {
    calendar: true,
    projects: true,
    todos: true,
    gantt: true,
    feishu: true,
    sessions: true,
  },
};

interface PluginData {
  config?: PluginConfig;
  projectUrls?: ProjectUrlsData;
  ganttOverrides?: GanttOverridesData;
  projectMetaOverrides?: Record<string, ProjectMetaOverride>;
  customCategories?: string[];
  customTags?: string[];
  domainIcons?: Record<string, string>;
  feishu?: FeishuConfig;
  session?: SessionConfig;
}

export function getConfig(): PluginConfig {
  return { ...DEFAULT_CONFIG, ...dataCache.config };
}

/** 任务存储目录路径（保证非空，兜底默认值） */
export function getTaskStorePath(): string {
  const p = getConfig().taskStorePath;
  return p && p.trim() ? p.trim() : '会话任务';
}

export async function setConfig(config: PluginConfig): Promise<void> {
  dataCache.config = config;
  await persist();
}

export async function resetConfig(): Promise<void> {
  dataCache.config = undefined;
  await persist();
}

// ===== 实例 =====
let pluginInstance: Plugin | null = null;
let dataCache: PluginData = {};
let persistQueue: Promise<void> = Promise.resolve();

/** 插件加载时调用，必须 await */
export async function initSettings(plugin: Plugin): Promise<void> {
  pluginInstance = plugin;
  dataCache = (await plugin.loadData()) ?? {};
}

/** 串行化持久化，防止并发写入互相覆盖 */
function persist(): Promise<void> {
  if (!pluginInstance) return Promise.resolve();
  persistQueue = persistQueue.then(() => pluginInstance!.saveData(dataCache));
  return persistQueue;
}

// ===== URL 管理 =====
export function getProjectUrl(folderName: string): string | null {
  return dataCache.projectUrls?.[folderName] ?? null;
}

export async function setProjectUrl(folderName: string, url: string): Promise<void> {
  if (!dataCache.projectUrls) dataCache.projectUrls = {};
  dataCache.projectUrls[folderName] = url;
  await persist();
}

export async function removeProjectUrl(folderName: string): Promise<void> {
  if (dataCache.projectUrls) {
    delete dataCache.projectUrls[folderName];
  }
  await persist();
}

// ===== 甘特图覆盖数据 =====
export function getGanttOverrides(): GanttOverridesData {
  return dataCache.ganttOverrides ?? {};
}

export async function saveGanttOverride(projectId: string, override: GanttOverride): Promise<void> {
  if (!dataCache.ganttOverrides) dataCache.ganttOverrides = {};
  dataCache.ganttOverrides[projectId] = {
    ...dataCache.ganttOverrides[projectId],
    ...override,
  };
  await persist();
}

export async function removeGanttOverride(projectId: string): Promise<void> {
  if (dataCache.ganttOverrides) {
    delete dataCache.ganttOverrides[projectId];
  }
  await persist();
}

// ===== 项目元数据覆盖 =====
export function getProjectMetaOverrides(): Record<string, ProjectMetaOverride> {
  return dataCache.projectMetaOverrides ?? {};
}

export async function saveProjectMeta(folderName: string, override: ProjectMetaOverride): Promise<void> {
  if (!dataCache.projectMetaOverrides) dataCache.projectMetaOverrides = {};
  dataCache.projectMetaOverrides[folderName] = {
    ...dataCache.projectMetaOverrides[folderName],
    ...override,
  };
  await persist();
}

export async function removeProjectMeta(folderName: string): Promise<void> {
  if (dataCache.projectMetaOverrides) {
    delete dataCache.projectMetaOverrides[folderName];
  }
  await persist();
}

// ===== 自定义类别管理 =====
/** 获取全部系统类别（配置基础 + 自定义） */
export function getAllCategories(): string[] {
  const cfg = getConfig();
  const custom = dataCache.customCategories ?? [];
  return [...new Set([...cfg.baseCategories, ...custom])];
}

export async function addCustomCategory(cat: string): Promise<void> {
  if (!dataCache.customCategories) dataCache.customCategories = [];
  if (!dataCache.customCategories.includes(cat)) {
    dataCache.customCategories.push(cat);
    await persist();
  }
}

/** 获取全部标签（配置基础 + 自定义 + 项目实际） */
export function getAllTags(projectTags?: Set<string>): string[] {
  const cfg = getConfig();
  const custom = dataCache.customTags ?? [];
  const project = projectTags ? Array.from(projectTags) : [];
  return [...new Set([...cfg.baseTags, ...project, ...custom])].sort();
}

export async function addCustomTag(v: string): Promise<void> {
  if (!dataCache.customTags) dataCache.customTags = [];
  if (!dataCache.customTags.includes(v)) {
    dataCache.customTags.push(v);
    await persist();
  }
}

/** 删除自定义类别（返回当前使用该类的项目数，>0 时拒绝删除） */
export function getCategoryUsage(cat: string): number {
  const overrides = dataCache.projectMetaOverrides ?? {};
  let count = 0;
  for (const ov of Object.values(overrides)) {
    if (ov.systemType === cat) count++;
  }
  return count;
}

export async function removeCustomCategory(cat: string): Promise<void> {
  if (!dataCache.customCategories) return;
  dataCache.customCategories = dataCache.customCategories.filter((c) => c !== cat);
  await persist();
}

export async function removeCustomTag(v: string): Promise<void> {
  if (!dataCache.customTags) return;
  dataCache.customTags = dataCache.customTags.filter((c) => c !== v);
  await persist();
}

// ===== 领域图标 =====
// 领域图标（与项目图标不重叠）
const DOMAIN_ICONS = ['🚀','💻','🚗','🏭','🔍'];

export function getDomainIcon(rootName: string): string {
  const saved = dataCache.domainIcons?.[rootName];
  if (saved) return saved;
  // 自动分配：取未被占用的第一个图标
  const used = new Set(Object.values(dataCache.domainIcons ?? {}));
  return DOMAIN_ICONS.find((i) => !used.has(i)) ?? '📁';
}

export async function setDomainIcon(rootName: string, icon: string): Promise<void> {
  if (!dataCache.domainIcons) dataCache.domainIcons = {};
  dataCache.domainIcons[rootName] = icon;
  await persist();
}

// ===== 飞书配置管理 =====
export function getFeishuConfig(): FeishuConfig {
  return { ...DEFAULT_FEISHU_CONFIG, ...dataCache.feishu };
}

export async function setFeishuConfig(config: Partial<FeishuConfig>): Promise<void> {
  dataCache.feishu = { ...DEFAULT_FEISHU_CONFIG, ...dataCache.feishu, ...config };
  await persist();
}

// ===== 会话配置管理 =====
import * as os from 'os';
import * as path from 'path';

/** 解析会话根目录：用户配置 > 默认 ~/.claude/projects */
export function getSessionRootDir(): string {
  const cfg = getSessionConfig();
  if (cfg.sessionRootDir) return cfg.sessionRootDir;
  return path.join(os.homedir(), '.claude', 'projects');
}

export function getSessionConfig(): SessionConfig {
  return { ...DEFAULT_SESSION_CONFIG, ...dataCache.session };
}

export async function setSessionConfig(config: Partial<SessionConfig>): Promise<void> {
  dataCache.session = { ...DEFAULT_SESSION_CONFIG, ...dataCache.session, ...config };
  await persist();
}
