import { App, TFile } from 'obsidian';
import { getGrowthHistory, getGrowthConfig, saveGrowthHistory, type GrowthHistory, getConfig } from './settings';

// ===== 类型 =====

export interface NoteNode {
  /** 文件路径 */
  path: string;
  /** 文件名（不含.md） */
  name: string;
  /** 原始标题（从 frontmatter title 或首行 # 提取） */
  title: string;
  /** 带上下文的显示标题，如「检规AI审核 › 方案设计」 */
  displayTitle: string;
  /** 文件自身的短标题（去编号前缀，无项目上下文） */
  shortTitle: string;
  /** 所在项目文件夹名，如 "11.检规与检查报告AI审核"；原子笔记/奇思妙想为 null */
  projectFolder: string | null;
  /** 从正文前 500 字提取的语义关键词 */
  excerptKeywords: string[];
  /** 正文摘要（前 80 字，去 markdown 语法，用于 UI 展示） */
  excerpt: string;
  /** 标签列表 */
  tags: string[];
  /** 正向链接（我链向谁） */
  outLinks: string[];
  /** 反向链接（谁链向我） */
  backLinks: string[];
  /** 创建时间 ms */
  ctime: number;
  /** 最后修改时间 ms */
  mtime: number;
  /** 所属领域（项目管理-系统/项目管理-车型/日常工作-通用/原子笔记/会议记录/奇思妙想） */
  domain: string;
  /** 文件扩展名 */
  ext: string;
}

export interface CollisionPair {
  noteA: NoteNode;
  noteB: NoteNode;
  strategy: 'cross-domain' | 'tag-adjacent' | 'time-span' | 'random';
}

export interface MissingLink {
  noteA: NoteNode;
  noteB: NoteNode;
  /** 相似度 0-1 */
  similarity: number;
  /** 匹配原因 */
  reasons: string[];
}

export interface SeedNote {
  note: NoteNode;
}


export interface TopicCluster {
  topic: string;
  notes: NoteNode[];
  linkedPairs: number;
  totalPairs: number;
}

function isExcluded(path: string): boolean {
  return getConfig().excludedFolders.some((prefix) => path.startsWith(prefix));
}

// ===== 领域检测 =====
function detectDomain(path: string): string {
  if (path.startsWith('原子笔记/')) return '原子笔记';
  if (path.startsWith('项目管理-系统/')) return '项目管理-系统';
  if (path.startsWith('项目管理-车型/')) return '项目管理-车型';
  if (path.startsWith('日常工作-通用/')) return '日常工作-通用';
  if (path.startsWith('会议记录/')) return '会议记录';
  if (path.startsWith('奇思妙想/')) return '奇思妙想';
  return '其他';
}

// ===== 中文分词（简单 n-gram） =====
function extractKeywords(text: string, minLen = 2): string[] {
  // 提取中文词（连续中文字符）
  const chineseWords = text.match(/[一-鿿]{2,}/g) ?? [];
  // 提取英文词/缩写
  const englishWords = text.match(/[a-zA-Z]{2,}/g) ?? [];

  const allWords = [...chineseWords, ...englishWords.map((w) => w.toLowerCase())];

  // 过滤通用停用词
  const stopWords = new Set([
    '可以', '这个', '那个', '什么', '怎么', '一个', '我们', '他们',
    '进行', '使用', '通过', '没有', '不是', '以及', '因为', '所以',
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have',
  ]);

  return allWords.filter((w) => w.length >= minLen && !stopWords.has(w));
}

// ===== 标签 Jaccard 相似度 =====
function tagJaccard(tagsA: string[], tagsB: string[]): number {
  if (tagsA.length === 0 && tagsB.length === 0) return 0;
  const setA = new Set(tagsA);
  const setB = new Set(tagsB);
  const intersection = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

// ===== 通用 Jaccard =====
function kwJaccard(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) { if (setB.has(w)) inter++; }
  return inter / (setA.size + setB.size - inter);
}

// ===== 正文摘要关键词提取（RAG-lite 核心） =====
const EXCERPT_STOP_WORDS = new Set([
  // 中文通用
  '可以', '这个', '那个', '什么', '怎么', '一个', '我们', '他们', '进行',
  '使用', '通过', '没有', '不是', '以及', '因为', '所以', '如果', '或者',
  '然后', '但是', '已经', '需要', '应该', '可能', '这里', '那里', '这样',
  '那样', '之后', '之前', '其他', '其中', '这些', '那些', '所有', '每个',
  // 英文编程常见词
  'const', 'let', 'var', 'function', 'return', 'import', 'export', 'from',
  'class', 'interface', 'type', 'true', 'false', 'null', 'undefined',
  'async', 'await', 'new', 'this', 'string', 'number', 'boolean', 'any',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'not',
  'but', 'are', 'was', 'were', 'been', 'has', 'had', 'does', 'did',
]);

/** 从正文内容提取语义关键词（去 markdown 语法、去停用词、取 TF 前 20） */
function extractExcerptKeywords(content: string): string[] {
  // 1. 跳过 frontmatter
  let body = content;
  const fmMatch = body.match(/^---\n[\s\S]*?\n---\n?/);
  if (fmMatch) body = body.slice(fmMatch[0].length);

  // 2. 跳过首行 # 标题
  const firstNewline = body.indexOf('\n');
  if (firstNewline > 0) body = body.slice(firstNewline + 1);

  // 3. 截取前 500 字符
  body = body.slice(0, 500);

  // 4. 去除 markdown 语法
  body = body
    .replace(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g, '$1')   // [[link|alias]] → link
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')               // [text](url) → text
    .replace(/[*_`~#>|=\-]+/g, ' ')                         // markdown 标记 → 空格
    .replace(/\d+(\.\d+)?/g, ' ')                           // 数字 → 空格
    .replace(/[^\w一-鿿\s]/g, ' ')                           // 非字母/中文 → 空格

  // 5. 提取词
  const chinese = body.match(/[一-鿿]{2,}/g) ?? [];
  const english = (body.match(/[a-zA-Z]{3,}/g) ?? []).map((w) => w.toLowerCase());
  const allWords = [...chinese, ...english];

  // 6. 去停用词 + 计数 TF
  const freq = new Map<string, number>();
  for (const w of allWords) {
    if (EXCERPT_STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  // 7. � TF 降序取前 20 个
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w);
}

/** 从正文生成可读摘要（前 100 字，去 markdown 语法，用于 UI 展示） */
function buildExcerpt(content: string): string {
  let body = content;
  const fmMatch = body.match(/^---\n[\s\S]*?\n---\n?/);
  if (fmMatch) body = body.slice(fmMatch[0].length);
  const firstNewline = body.indexOf('\n');
  if (firstNewline > 0) body = body.slice(firstNewline + 1);
  body = body
    .replace(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~#>|=\-]+/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return body.slice(0, 100);
}

// ===== 上下文命名 =====

/** 通用标题名单——这些标题出现在多个项目，不加上下文无法区分 */
const GENERIC_TITLES = new Set([
  '背景', '背景与需求', '方案', '方案设计', '架构', '架构设计', '架构总览',
  '开发日志', '使用指南', '需求分析', '需求分析与方案设计', '可行性分析',
  '分工与计划', '分工与协作', '部署', '测试', '总结', '问题记录', '优化',
  '数据存储', '构建与部署', '迭代总结', '甘特图迭代优化', '排期面板详解',
  '功能说明', '功能说明与验证指南', '版本变化分析报告', '规格扩展方案',
  '问题修改记录', '审核结论报告', 'SKILL封装方案',
]);

function isGenericTitle(title: string): boolean {
  const clean = title.replace(/^\d+[-.\s]*/, '').trim();
  return GENERIC_TITLES.has(clean);
}

/** 从路径提取项目文件夹名（去数字前缀），无项目上下文返回 null */
function extractProjectFolder(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 2) return null;

  const topDir = parts[0];
  // 只有项目管理-* 和 日常工作-通用 下的子文件夹才算"项目"
  if (topDir === '项目管理-系统' || topDir === '项目管理-车型' || topDir === '日常工作-通用') {
    if (parts.length >= 2) {
      const folder = parts[1];
      // 去掉数字前缀，如 "11.检规与检查报告AI审核" → "检规与检查报告AI审核"
      return folder.replace(/^\d+\.\s*/, '');
    }
  }
  return null;
}

/** 从路径提取项目文件夹原始名（不去数字前缀），用于精确比较 */
function extractProjectFolderRaw(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 2) return null;
  const topDir = parts[0];
  if (topDir === '项目管理-系统' || topDir === '项目管理-车型' || topDir === '日常工作-通用') {
    return parts[1] ?? null;
  }
  return null;
}

/** 构建显示标题：通用标题拼接项目名，独特标题直接使用 */
function buildDisplayTitle(title: string, path: string, domain: string): string {
  const project = extractProjectFolder(path);

  // 原子笔记/奇思妙想 → 文件名本身足够独特，不拼接
  if (domain === '原子笔记' || domain === '奇思妙想') {
    return title;
  }

  // 没有项目上下文 → 直接用原标题
  if (!project) {
    return title;
  }

  // 标题足够独特（>6 字且不在通用名单）→ 直接用
  if (title.length > 6 && !isGenericTitle(title)) {
    return title;
  }

  // 通用标题 → 拼接项目名
  const cleanTitle = title.replace(/^\d+[-.\s]*/, '');
  return `${project} › ${cleanTitle}`;
}
export async function scanKnowledgeNotes(app: App): Promise<NoteNode[]> {
  const files = app.vault.getMarkdownFiles();
  const nodes: NoteNode[] = [];

  for (const file of files) {
    if (isExcluded(file.path)) continue;
    if (file.extension !== 'md') continue;

    try {
      const cache = app.metadataCache.getFileCache(file);
      const content = await app.vault.cachedRead(file);

      // 提取标题
      let title = file.basename;
      const headingMatch = content.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        title = headingMatch[1].trim();
      }

      // 提取标签
      const tags: string[] = [];
      if (cache?.frontmatter?.tags) {
        const ft = cache.frontmatter.tags;
        if (Array.isArray(ft)) {
          tags.push(...ft.map((t: string) => t.replace(/^#/, '')));
        } else if (typeof ft === 'string') {
          tags.push(ft.replace(/^#/, ''));
        }
      }
      if (cache?.tags) {
        for (const t of cache.tags) {
          const tagName = t.tag.replace(/^#/, '');
          if (!tags.includes(tagName)) tags.push(tagName);
        }
      }

      // 提取链接
      const outLinks: string[] = [];
      if (cache?.links) {
        for (const link of cache.links) {
          const target = link.link.split('|')[0].split('#')[0].trim();
          if (target) outLinks.push(target);
        }
      }

      // 反向链接
      const backLinks: string[] = [];
      const resolvedLinks = app.metadataCache.resolvedLinks;
      if (resolvedLinks) {
        for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
          if (sourcePath === file.path) continue;
          if (file.path in (targets as Record<string, number>)) {
            backLinks.push(sourcePath);
          }
        }
      }

      const domain = detectDomain(file.path);
      const projectFolder = extractProjectFolderRaw(file.path);
      const shortTitle = title.replace(/^\d+[-.\s]*/, '');
      const displayTitle = buildDisplayTitle(title, file.path, domain);
      const excerptKeywords = extractExcerptKeywords(content);
      const excerpt = buildExcerpt(content);

      nodes.push({
        path: file.path,
        name: file.basename,
        title,
        displayTitle,
        shortTitle,
        projectFolder,
        excerptKeywords,
        excerpt,
        tags,
        outLinks,
        backLinks,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        domain,
        ext: file.extension,
      });
    } catch {
      // 跳过无法读取的文件
    }
  }

  return nodes;
}

// ===== 碰撞配对 =====
export function pickCollisionPair(nodes: NoteNode[], history: GrowthHistory): CollisionPair | null {
  if (nodes.length < 2) return null;

  const config = getGrowthConfig();

  // 过滤：排除最近 30 天内已碰撞过的笔记对
  const recentPairs = new Set<string>();
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  for (const col of history.collisions ?? []) {
    if (col.action === 'skipped' && col.date) {
      const colDate = new Date(col.date).getTime();
      if (now - colDate < thirtyDays) {
        recentPairs.add(`${col.noteA}|||${col.noteB}`);
        recentPairs.add(`${col.noteB}|||${col.noteA}`);
      }
    }
    // linked/new_note 的也不重复推荐
    if (col.action === 'linked' || col.action === 'new_note') {
      recentPairs.add(`${col.noteA}|||${col.noteB}`);
      recentPairs.add(`${col.noteB}|||${col.noteA}`);
    }
  }

  const excludeRecent = (a: NoteNode, b: NoteNode): boolean => {
    return recentPairs.has(`${a.path}|||${b.path}`);
  };

  // 策略池
  interface StrategyResult { pair: CollisionPair; weight: number }

  // 策略1：跨领域（40%）
  const crossDomainResults: StrategyResult[] = [];
  const shuffled = [...nodes].sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(shuffled.length, 50); i++) {
    for (let j = i + 1; j < Math.min(shuffled.length, 50); j++) {
      const a = shuffled[i], b = shuffled[j];
      if (a.domain === b.domain) continue;
      if (excludeRecent(a, b)) continue;
      crossDomainResults.push({
        pair: { noteA: a, noteB: b, strategy: 'cross-domain' },
        weight: 0.4,
      });
      if (crossDomainResults.length >= 10) break;
    }
    if (crossDomainResults.length >= 10) break;
  }

  // 策略2：标签相邻（30%）
  const tagAdjResults: StrategyResult[] = [];
  const taggedNodes = nodes.filter((n) => n.tags.length > 0);
  const taggedShuffled = [...taggedNodes].sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(taggedShuffled.length, 40); i++) {
    for (let j = i + 1; j < Math.min(taggedShuffled.length, 40); j++) {
      const a = taggedShuffled[i], b = taggedShuffled[j];
      const jaccard = tagJaccard(a.tags, b.tags);
      if (jaccard === 0 || jaccard >= 1) continue; // 标签无重叠或完全相同
      if (excludeRecent(a, b)) continue;
      tagAdjResults.push({
        pair: { noteA: a, noteB: b, strategy: 'tag-adjacent' },
        weight: 0.3,
      });
      if (tagAdjResults.length >= 10) break;
    }
    if (tagAdjResults.length >= 10) break;
  }

  // 策略3：时间跨度（20%）
  const timeSpanResults: StrategyResult[] = [];
  const nowTs = Date.now();
  const threeMonths = 90 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < Math.min(nodes.length, 30); i++) {
    for (let j = i + 1; j < Math.min(nodes.length, 30); j++) {
      const a = nodes[i], b = nodes[j];
      const timeDiff = Math.abs(a.ctime - b.ctime);
      if (timeDiff < threeMonths) continue;
      if (excludeRecent(a, b)) continue;
      timeSpanResults.push({
        pair: { noteA: a, noteB: b, strategy: 'time-span' },
        weight: 0.2,
      });
      if (timeSpanResults.length >= 10) break;
    }
    if (timeSpanResults.length >= 10) break;
  }

  // 策略4：纯随机（10%）
  const randomResults: StrategyResult[] = [];
  const randShuffled = [...nodes].sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(randShuffled.length - 1, 20); i++) {
    const a = randShuffled[i], b = randShuffled[i + 1];
    if (excludeRecent(a, b)) continue;
    randomResults.push({
      pair: { noteA: a, noteB: b, strategy: 'random' },
      weight: 0.1,
    });
  }

  // 加权随机选择
  const allCandidates = [...crossDomainResults, ...tagAdjResults, ...timeSpanResults, ...randomResults];
  if (allCandidates.length === 0) return null;

  const totalWeight = allCandidates.reduce((s, r) => s + r.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const candidate of allCandidates) {
    rand -= candidate.weight;
    if (rand <= 0) return candidate.pair;
  }

  return allCandidates[allCandidates.length - 1].pair;
}

// ===== 查找缺失链接 =====
export function findMissingLinks(nodes: NoteNode[], history: GrowthHistory): MissingLink[] {
  const config = getGrowthConfig();
  const results: MissingLink[] = [];

  // 构建已链接对集合
  const linkedSet = new Set<string>();
  for (const node of nodes) {
    for (const target of node.outLinks) {
      linkedSet.add(`${node.path}|||${target}`);
    }
  }

  // 构建忽略集合
  const ignoredSet = new Set<string>();
  const now = Date.now();
  for (const ig of history.ignoredSuggestions ?? []) {
    const until = new Date(ig.ignoreUntil).getTime();
    if (now < until) {
      ignoredSet.add(`${ig.noteA}|||${ig.noteB}`);
      ignoredSet.add(`${ig.noteB}|||${ig.noteA}`);
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];

      // 跳过同一目录下的文档（同一项目内大概率已有关联）
      if (a.domain === b.domain && a.path.split('/')[0] === b.path.split('/')[0]) continue;

      // 已链接的直接跳过
      const pairKey = `${a.path}|||${normalizeLink(b.path)}`;
      if (linkedSet.has(pairKey) || linkedSet.has(`${b.path}|||${normalizeLink(a.path)}`)) continue;

      // 被忽略的跳过
      if (ignoredSet.has(`${a.path}|||${b.path}`)) continue;

      // 计算相似度（三分量公式）
      const tagSim = tagJaccard(a.tags, b.tags);

      // 标题关键词相似度
      const titleKwA = extractKeywords(a.displayTitle);
      const titleKwB = extractKeywords(b.displayTitle);
      const titleSim = kwJaccard(new Set(titleKwA), new Set(titleKwB));

      // 正文关键词相似度（RAG-lite 核心）
      const excerptSim = kwJaccard(new Set(a.excerptKeywords), new Set(b.excerptKeywords));

      // --- 硬过滤：正文零重叠 + 至少一篇通用标题 → 直接排除 ---
      const anyGeneric = isGenericTitle(a.shortTitle) || isGenericTitle(b.shortTitle);
      if (excerptSim === 0 && anyGeneric) continue;

      // 综合相似度：标签 20% + 标题 15% + 正文 65%
      const bothGeneric = isGenericTitle(a.shortTitle) && isGenericTitle(b.shortTitle);
      let similarity = bothGeneric
        ? tagSim * 0.10 + titleSim * 0.05 + excerptSim * 0.85
        : tagSim * 0.20 + titleSim * 0.15 + excerptSim * 0.65;

      // 同项目目录下 → 降权
      if (a.projectFolder && b.projectFolder && a.projectFolder === b.projectFolder) {
        similarity *= 0.5;
      }

      if (similarity < 0.15) continue;

      const reasons: string[] = [];
      if (tagSim > 0.3) reasons.push(`共同标签: ${a.tags.filter((t) => b.tags.includes(t)).join(', ')}`);
      const sharedExcerpt = a.excerptKeywords.filter((k) => b.excerptKeywords.includes(k));
      if (sharedExcerpt.length >= 2) reasons.push(`正文关键词: ${sharedExcerpt.slice(0, 4).join(', ')}`);
      const sharedTitle = titleKwA.filter((k) => titleKwB.includes(k));
      if (sharedTitle.length >= 1) reasons.push(`标题关键词: ${sharedTitle.slice(0, 3).join(', ')}`);

      results.push({ noteA: a, noteB: b, similarity, reasons });
    }
  }

  // 按相似度降序，取 top 20
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, 20);
}

// ===== 查找种子笔记（全量知识笔记） =====
export function findSeeds(nodes: NoteNode[]): SeedNote[] {
  return nodes.map((n) => ({ note: n, seedType: 'atomic' as const }))
    .sort((a, b) => a.note.name.localeCompare(b.note.name));
}


// ===== 检测主题聚类 =====
export function detectEmergentTopics(nodes: NoteNode[]): TopicCluster[] {
  // 先尝试标签聚类
  const tagGroups = new Map<string, NoteNode[]>();

  for (const node of nodes) {
    if (node.tags.length === 0) continue;
    for (const tag of node.tags) {
      if (tag === '项目索引') continue;
      const list = tagGroups.get(tag) ?? [];
      list.push(node);
      tagGroups.set(tag, list);
    }
  }

  const clusters: TopicCluster[] = [];

  for (const [topic, topicNotes] of tagGroups) {
    if (topicNotes.length < 2) continue;

    const dirs = new Set(topicNotes.map((n) => n.path.split('/').slice(0, 2).join('/')));
    if (dirs.size < 2) continue;

    let linkedPairs = 0;
    let totalPairs = 0;
    for (let i = 0; i < topicNotes.length; i++) {
      for (let j = i + 1; j < topicNotes.length; j++) {
        totalPairs++;
        const a = topicNotes[i], b = topicNotes[j];
        const aLinkB = a.outLinks.some((l) => normalizeLink(l) === normalizeLink(b.path));
        const bLinkA = b.outLinks.some((l) => normalizeLink(l) === normalizeLink(a.path));
        if (aLinkB || bLinkA) linkedPairs++;
      }
    }

    clusters.push({ topic, notes: topicNotes, linkedPairs, totalPairs });
  }

  // 如果标签聚类结果不足，用关键词补充聚类
  if (clusters.length < 3) {
    const keywordClusters = detectKeywordClusters(nodes, clusters.map((c) => c.topic));
    clusters.push(...keywordClusters);
  }

  // 按笔记数量降序，选 top 5
  return clusters
    .sort((a, b) => b.notes.length - a.notes.length)
    .slice(0, 5);
}

/** 基于文件名关键词的补充聚类（标签聚类不足时启用） */
function detectKeywordClusters(nodes: NoteNode[], existingTopics: string[]): TopicCluster[] {
  // 从文件名提取高频关键词
  const keywordFreq = new Map<string, NoteNode[]>();
  const topicKeywords = ['飞书', 'API', 'AI', '自动化', '多维表', 'RPA', 'PPAP', '审核', '方案', '架构', '数据', '部署'];

  for (const node of nodes) {
    const nameLower = node.name.toLowerCase();
    for (const kw of topicKeywords) {
      if (nameLower.includes(kw.toLowerCase()) || node.displayTitle.includes(kw)) {
        const list = keywordFreq.get(kw) ?? [];
        list.push(node);
        keywordFreq.set(kw, list);
      }
    }
  }

  const clusters: TopicCluster[] = [];

  for (const [topic, topicNotes] of keywordFreq) {
    if (topicNotes.length < 2) continue;
    if (existingTopics.includes(topic)) continue;

    const dirs = new Set(topicNotes.map((n) => n.path.split('/').slice(0, 2).join('/')));
    if (dirs.size < 2) continue;

    let linkedPairs = 0;
    let totalPairs = 0;
    for (let i = 0; i < topicNotes.length; i++) {
      for (let j = i + 1; j < topicNotes.length; j++) {
        totalPairs++;
        const a = topicNotes[i], b = topicNotes[j];
        const aLinkB = a.outLinks.some((l) => normalizeLink(l) === normalizeLink(b.path));
        const bLinkA = b.outLinks.some((l) => normalizeLink(l) === normalizeLink(a.path));
        if (aLinkB || bLinkA) linkedPairs++;
      }
    }

    clusters.push({ topic, notes: topicNotes, linkedPairs, totalPairs });
  }

  return clusters;
}

// ===== 工具函数 =====

/** 标准化链接路径（去掉 .md 后缀） */
function normalizeLink(link: string): string {
  let result = link.trim();
  if (result.endsWith('.md')) result = result.slice(0, -3);
  return result;
}

/** 获取今日日期字符串 YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 格式化时间距离 */
export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

/** 生成 MOC 草稿内容 */
export function generateMocDraft(cluster: TopicCluster): string {
  const lines: string[] = [
    '---',
    'tags:',
    `  - ${cluster.topic}`,
    '  - MOC',
    `created: ${todayStr()}`,
    '---',
    '',
    `# ${cluster.topic} —— 索引`,
    '',
    `> 自动生成的知识索引页，串联 ${cluster.notes.length} 篇相关笔记。`,
    '',
    '## 笔记列表',
    '',
  ];

  for (const note of cluster.notes) {
    const label = note.displayTitle.length > 60 ? note.displayTitle.slice(0, 57) + '...' : note.displayTitle;
    lines.push(`- [[${note.path.replace('.md', '')}|${note.displayTitle}]]`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*由 🌱 生长面板自动生成 · 请审核后调整*');

  return lines.join('\n');
}
