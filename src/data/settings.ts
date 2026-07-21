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

export interface ProjectMetaOverride {
  systemType?: string;
  vehicle?: string;
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
  baseVehicles: string[];
  /** 生长面板排除的文件夹路径（不会出现在种子浏览器中） */
  excludedFolders: string[];
}

const DEFAULT_CONFIG: PluginConfig = {
  diaryTemplate: 'templates/工作日志.md',
  workLogPath: '工作日志',
  projectRoots: ['项目管理-系统', '项目管理-车型', '日常工作-通用'],
  baseCategories: ['多维表', 'RPA自动化', 'AI智能体', '工具开发', '车型项目', '其他'],
  baseVehicles: ['通用', 'M18-3', 'M18-2'],
  excludedFolders: ['工作日志/', '工作周报/', 'templates/', '.obsidian/', '.claude/', '.claudian/', '.trash/'],
};

interface PluginData {
  config?: PluginConfig;
  projectUrls?: ProjectUrlsData;
  ganttOverrides?: GanttOverridesData;
  projectMetaOverrides?: Record<string, ProjectMetaOverride>;
  customCategories?: string[];
  customVehicles?: string[];
  domainIcons?: Record<string, string>;
  feishu?: FeishuConfig;
  growthHistory?: GrowthHistory;
  growthConfig?: GrowthConfig;
  llm?: LlmConfig;
  summaryCache?: Record<string, string>;
  growthDirections?: Record<string, any[]>;
}

export function getConfig(): PluginConfig {
  return { ...DEFAULT_CONFIG, ...dataCache.config };
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

/** 获取全部车型（配置基础 + 自定义 + 项目实际） */
export function getAllVehicles(projectVehicles?: Set<string>): string[] {
  const cfg = getConfig();
  const custom = dataCache.customVehicles ?? [];
  const project = projectVehicles ? Array.from(projectVehicles) : [];
  return [...new Set([...cfg.baseVehicles, ...project, ...custom])].sort();
}

export async function addCustomVehicle(v: string): Promise<void> {
  if (!dataCache.customVehicles) dataCache.customVehicles = [];
  if (!dataCache.customVehicles.includes(v)) {
    dataCache.customVehicles.push(v);
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

export async function removeCustomVehicle(v: string): Promise<void> {
  if (!dataCache.customVehicles) return;
  dataCache.customVehicles = dataCache.customVehicles.filter((c) => c !== v);
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

// ===== 生长面板（Growth Panel）数据管理 =====

export interface GrowthCollision {
  date: string;
  noteA: string;
  noteB: string;
  action: 'linked' | 'new_note' | 'skipped';
  resultPath?: string;
  userInput?: string;
}

export interface GrowthRegrowth {
  date: string;
  notePath: string;
  snippet: string;
}

export interface GrowthIgnoredSuggestion {
  noteA: string;
  noteB: string;
  ignoreUntil: string;
}

export interface GrowthGeneratedMoc {
  topic: string;
  mocPath: string;
  noteCount: number;
}

export interface GrowthHistory {
  collisions?: GrowthCollision[];
  regrowths?: GrowthRegrowth[];
  ignoredSuggestions?: GrowthIgnoredSuggestion[];
  generatedMocs?: GrowthGeneratedMoc[];
}

export interface GrowthConfig {
  dailyCollisionCount: number;
  collisionStrategies: string[];
  regrowthMinAgeDays: number;
}

const DEFAULT_GROWTH_CONFIG: GrowthConfig = {
  dailyCollisionCount: 1,
  collisionStrategies: ['cross-domain', 'tag-adjacent', 'time-span', 'random'],
  regrowthMinAgeDays: 30,
};

const DEFAULT_GROWTH_HISTORY: GrowthHistory = {
  collisions: [],
  regrowths: [],
  ignoredSuggestions: [],
  generatedMocs: [],
};

// ===== 生长历史 =====
export function getGrowthHistory(): GrowthHistory {
  return dataCache.growthHistory ?? DEFAULT_GROWTH_HISTORY;
}

export async function saveGrowthHistory(history: GrowthHistory): Promise<void> {
  dataCache.growthHistory = history;
  await persist();
}

export async function addCollisionRecord(record: GrowthCollision): Promise<void> {
  const h = getGrowthHistory();
  if (!h.collisions) h.collisions = [];
  h.collisions.push(record);
  await saveGrowthHistory(h);
}

export async function addRegrowthRecord(record: GrowthRegrowth): Promise<void> {
  const h = getGrowthHistory();
  if (!h.regrowths) h.regrowths = [];
  h.regrowths.push(record);
  await saveGrowthHistory(h);
}

export async function addIgnoredSuggestion(suggestion: GrowthIgnoredSuggestion): Promise<void> {
  const h = getGrowthHistory();
  if (!h.ignoredSuggestions) h.ignoredSuggestions = [];
  h.ignoredSuggestions.push(suggestion);
  await saveGrowthHistory(h);
}

export async function addGeneratedMoc(moc: GrowthGeneratedMoc): Promise<void> {
  const h = getGrowthHistory();
  if (!h.generatedMocs) h.generatedMocs = [];
  h.generatedMocs.push(moc);
  await saveGrowthHistory(h);
}

// ===== 生长配置 =====
export function getGrowthConfig(): GrowthConfig {
  return { ...DEFAULT_GROWTH_CONFIG, ...dataCache.growthConfig };
}

export async function setGrowthConfig(config: Partial<GrowthConfig>): Promise<void> {
  dataCache.growthConfig = { ...getGrowthConfig(), ...config };
  await persist();
}

// ===== LLM 配置 =====

export interface LlmConfig {
  /** API 类型：openai（OpenAI 兼容）/ anthropic（Anthropic Messages 兼容） */
  apiType: 'openai' | 'anthropic';
  /** 接口地址，如 http://127.0.0.1:15721 或 https://api.deepseek.com/anthropic */
  endpoint: string;
  /** 模型名，如 deepseek-v4-flash / gpt-4o-mini */
  model: string;
  /** API Key */
  apiKey: string;
}

const DEFAULT_LLM_CONFIG: LlmConfig = {
  apiType: 'openai',
  endpoint: '',
  model: '',
  apiKey: '',
};

export function getLlmConfig(): LlmConfig {
  return { ...DEFAULT_LLM_CONFIG, ...dataCache.llm };
}

export async function setLlmConfig(config: Partial<LlmConfig>): Promise<void> {
  dataCache.llm = { ...getLlmConfig(), ...config };
  await persist();
}

export function isLlmConfigured(): boolean {
  const cfg = getLlmConfig();
  return !!(cfg.endpoint && cfg.model);
}

// ===== 摘要缓存 =====

export function getSummary(path: string): string | null {
  return dataCache.summaryCache?.[path] ?? null;
}

export async function saveSummary(path: string, summary: string): Promise<void> {
  if (!dataCache.summaryCache) dataCache.summaryCache = {};
  dataCache.summaryCache[path] = summary;
  await persist();
}

// ===== 生长方向缓存 =====

export function getGrowthDirections(path: string): any[] | null {
  return dataCache.growthDirections?.[path] ?? null;
}

export async function saveGrowthDirections(path: string, directions: any[]): Promise<void> {
  if (!dataCache.growthDirections) dataCache.growthDirections = {};
  dataCache.growthDirections[path] = directions;
  await persist();
}
