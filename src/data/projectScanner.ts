import { App, TFile } from 'obsidian';
import { getProjectUrl, getProjectMetaOverrides, getAllCategories, getAllVehicles, getConfig } from './settings';

// ===== 类型定义 =====
export interface ProjectInfo {
  folderName: string;
  name: string;
  emoji: string;
  folderPath: string;
  readmePath: string | null;
  description: string;
  fileCount: number;
  lastModified: number;
  vehicle: string;
  systemType: string;
  baseUrl: string | null;
  source: string;
}

export interface ProjectGroup {
  key: string;
  label: string;
  projects: ProjectInfo[];
}

// ===== 分类映射表 =====
// 新增项目时在这里加一行即可，fileCount/lastModified 自动扫描
export const PROJECT_META: Record<string, {
  name: string;
  emoji: string;
  vehicle: string;
  systemType: string;
  description: string;
  baseUrl?: string;
}> = {
  '1.超级工程师-李尔': {
    name: '超级工程师 · 李尔',
    emoji: '🤖',
    vehicle: '通用',
    systemType: 'AI智能体',
    description: 'AI + 数字化，供应商质量前置管理。两次东风李尔调研 + 供应商数据监控平台。',
    baseUrl: 'https://m-hero.feishu.cn/base/IkOObXutDazmzIsyXZLchdMQnpZ',
  },
  '1.PPAP-RPA': {
    name: 'PPAP-RPA 自动化',
    emoji: '📦',
    vehicle: '通用',
    systemType: 'RPA自动化',
    description: 'MOS 数据爬取 → 聚类计算 → 飞书多维表同步，全流程自动化。Python + 飞书 API。',
    baseUrl: 'https://m-hero.feishu.cn/base/ENtnbmbsNaRJwksChuccjDN3nuh',
  },
  '2.部品风险清单管控系统': {
    name: '部品风险清单管控',
    emoji: '🛡️',
    vehicle: '通用',
    systemType: '多维表',
    description: '风险录入 → SQE整改 → 二级审批 → 闭环，飞书多维表零代码搭建。V1 → V2 迭代。',
    baseUrl: 'https://m-hero.feishu.cn/base/YpnsbspKxaDUmXssM9dc52BYnQf',
  },
  '3.设变流程自动化系统': {
    name: '设变流程自动化',
    emoji: '🔄',
    vehicle: '通用',
    systemType: 'RPA自动化',
    description: '解决 SQE 会前不知情痛点。多维表 → 飞书机器人 → RPA/AI 三版演进。含培训视频。',
    baseUrl: 'https://m-hero.feishu.cn/base/WErMbFhnia8AYSsR8TyctDpFn1g',
  },
  '4.低合格率零件全流程管控': {
    name: '低合格率全流程管控',
    emoji: '📉',
    vehicle: 'M18-3',
    systemType: '多维表',
    description: 'M18-3 低合格率零件管控，多维表/Aily 双方案对比。含试做问题点追踪。',
    baseUrl: 'https://m-hero.feishu.cn/base/ETYvb2XlIaaRY6sVF5vcjqzVnHU',
  },
  '5.FQ-SQE分工智能体': {
    name: 'FQ-SQE 分工智能体',
    emoji: '🧠',
    vehicle: '通用',
    systemType: 'AI智能体',
    description: '飞书 Aily 轻量化 SQE 分工查询。自然语言 → 供应商/零部件/SQE 范围。',
  },
  '6.EPS开模令AI审核': {
    name: 'EPS 开模令 AI 审核',
    emoji: '🔍',
    vehicle: '通用',
    systemType: 'AI智能体',
    description: '数据采集 → 规则引擎 → LLM 审核全链路。Python + ddddocr + Claude API。',
  },
  '7.M18-3部品主责通报': {
    name: 'M18-3 部品主责通报',
    emoji: '📋',
    vehicle: 'M18-3',
    systemType: '多维表',
    description: '问题通报 → SQE填写 → 组长审批 → 经理审批 → 群推送。3表 22字段 + 7工作流。',
    baseUrl: 'https://m-hero.feishu.cn/base/SAoWb59XiaKvnjs06Ugc9zovnKc',
  },
  '8.猛士驾驶舱插件': {
    name: '猛士驾驶舱',
    emoji: '⚙',
    vehicle: '通用',
    systemType: '工具开发',
    description: '日历、项目、待办、排期一体化驾驶舱面板。TypeScript + React + esbuild。',
  },
  'M18-3 GCC项目': {
    name: 'M18-3 GCC 长续航',
    emoji: '🌍',
    vehicle: 'M18-3',
    systemType: '车型项目',
    description: 'GCC 左舵大电池项目。3 篇工作文档，含多维表结构。13 个专用件。',
    baseUrl: 'https://m-hero.feishu.cn/base/KGqQbXU5paEkAHs37UGcRMsRnbg',
  },
  'M18-3 RSKD项目': {
    name: 'M18-3 RSKD 散件出口',
    emoji: '📦',
    vehicle: 'M18-3',
    systemType: '车型项目',
    description: '独联体 SKD/DKD 散件出口。三阶段主计划 + 甘特图 + 边界文档。',
  },
};

// ===== 扫描逻辑 =====

function isReadme(file: TFile): boolean {
  return file.name.endsWith('.README.md') || file.name === 'README.md';
}

function findReadme(files: TFile[]): TFile | null {
  // 优先 .README.md，其次 README.md
  const pri = files.find((f) => f.name.endsWith('.README.md'));
  if (pri) return pri;
  return files.find((f) => f.name === 'README.md') ?? null;
}

function extractDescription(content: string): string | null {
  // 提取 README 中 > 开头的第一行作为描述（比映射表里的更实时）
  const match = content.match(/^>\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractBaseUrl(content: string): string | null {
  // 匹配飞书链接（多维表、文档、知识库等都支持）
  const match = content.match(/https:\/\/[^\s)]+\.feishu\.cn\/[^\s)]+/);
  return match ? match[0] : null;
}

// ===== 读写 README 中的云文档链接 =====
const README_URL_SECTION = '## 📊 云文档';

/** 把项目 URL 写入 README 文件（README 是唯一数据源） */
export async function writeUrlToReadme(
  app: App,
  folderPath: string,
  url: string,
  projectName: string,
): Promise<boolean> {
  const readme = findReadmeInFolder(app, folderPath);
  if (!readme) return false;

  const linkLine = `- [${projectName} 云文档](${url})`;

  await app.vault.process(readme, (content) => {
    const lines = content.split('\n');
    let headerLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === README_URL_SECTION) { headerLine = i; break; }
    }

    if (headerLine >= 0) {
      // 已有该 section：替换第一个链接行，或插入新链接行
      let found = false;
      for (let i = headerLine + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) break;
        if (/\[.+\]\(https?:\/\/.+\.feishu\.cn/.test(lines[i])) {
          lines[i] = linkLine;
          found = true;
          break;
        }
      }
      if (!found) {
        lines.splice(headerLine + 1, 0, '', linkLine);
      }
    } else {
      // 没有该 section：在末尾追加
      lines.push('', '---', '', README_URL_SECTION, '', linkLine);
    }

    return lines.join('\n');
  });

  return true;
}

/** 从 README 中移除云文档链接 */
export async function removeUrlFromReadme(
  app: App,
  folderPath: string,
): Promise<boolean> {
  const readme = findReadmeInFolder(app, folderPath);
  if (!readme) return false;

  await app.vault.process(readme, (content) => {
    const lines = content.split('\n');
    let headerLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === README_URL_SECTION) { headerLine = i; break; }
    }
    if (headerLine < 0) return content;

    // 移除该 section 下的链接行
    for (let i = headerLine + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) break;
      if (/\[.+\]\(https?:\/\/.+\.feishu\.cn/.test(lines[i])) {
        lines[i] = '';
        break;
      }
    }
    return lines.join('\n');
  });

  return true;
}

/** 在指定文件夹内查找 README 文件 */
function findReadmeInFolder(app: App, folderPath: string): TFile | null {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!folder) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children = (folder as any).children as TFile[] | undefined;
  if (!children) return null;
  const mdFiles = children.filter((f) => f.name.endsWith('.md'));
  return findReadme(mdFiles);
}

function extractTags(content: string): string[] {
  const tags: string[] = [];
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return tags;
  const fm = frontmatterMatch[1];
  const tagLines = fm.match(/^\s*-\s+(.+)$/gm);
  if (tagLines) {
    for (const line of tagLines) {
      const tag = line.replace(/^\s*-\s+/, '').trim();
      if (tag && tag !== '项目索引') tags.push(tag);
    }
  }
  return tags;
}

function extractTableField(content: string, field: string): string | null {
  // 匹配 markdown 表格 `| **字段** | 值 |` 或行内 `**字段**：值`
  const regex = new RegExp(`\\*\\*${field}\\*\\*\\s*[：:\\|]\\s*(.+?)(?:\\s*[\\|~]|$)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}


/** 所有可用系统类别（供标签编辑下拉选择，含自定义） */
export function getCategories(): string[] {
  return getAllCategories();
}

/** 获取项目显示名（始终从文件夹名派生，去掉编号前缀） */
export function getProjectDisplayName(folderName: string): string {
  return folderName.replace(/^\d+\./, '');
}

/** 所有可用车型（供标签编辑下拉选择，含自定义） */
export function getVehicles(): string[] {
  const projectVehicles = new Set(Object.values(PROJECT_META).map((m) => m.vehicle));
  return getAllVehicles(projectVehicles);
}

function mapTechToSystem(tech: string): string {
  const t = tech.toLowerCase();
  if (t.includes('多维表') || t.includes('零代码')) return '多维表';
  if (t.includes('python') || t.includes('rpa')) return 'RPA自动化';
  if (t.includes('llm') || t.includes('ai') || t.includes('aily') || t.includes('claude')) return 'AI智能体';
  if (t.includes('plugin') || t.includes('插件')) return '工具开发';
  return '其他';
}

function inferEmoji(tags: string[], source: string): string {
  if (source === '车型') return '🚗';
  const tagSet = new Set(tags);
  if (tagSet.has('AI智能体')) return '🧠';
  if (tagSet.has('RPA自动化')) return '📦';
  if (tagSet.has('多维表')) return '📋';
  if (tagSet.has('工具开发')) return '⚙';
  return '📁';
}

export async function scanProjects(app: App): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  const allFiles = app.vault.getFiles();

  for (const root of getConfig().projectRoots) {
    const source = root;
    const rootPath = root + '/';

    // 收集根目录下的子文件夹
    const subFolders = new Set<string>();
    for (const file of allFiles) {
      if (file.path.startsWith(rootPath)) {
        const sub = file.path.slice(rootPath.length).split('/')[0];
        if (sub) subFolders.add(sub);
      }
    }

    // 为每个子文件夹构建项目数据
    for (const folderName of subFolders) {
      const folderPath = rootPath + folderName;
      const meta = PROJECT_META[folderName];

      // 文件夹内的文件
      const folderFiles = allFiles.filter((f) => f.path.startsWith(folderPath + '/'));
      const mdFiles = folderFiles.filter((f) => f.name.endsWith('.md'));
      const readme = findReadme(mdFiles);

      // 文件数（不含 README 自身）
      const fileCount = mdFiles.filter((f) => !isReadme(f)).length;

      // 最近修改时间
      let lastModified = 0;
      for (const f of folderFiles) {
        if (f.stat.mtime > lastModified) lastModified = f.stat.mtime;
      }

      // 读取 README 内容
      let readmeContent = '';
      if (readme) {
        try {
          readmeContent = await app.vault.cachedRead(readme);
        } catch { /* ignore */ }
      }

      // 从 README 提取字段
      const liveDesc = extractDescription(readmeContent);
      const liveBase = extractBaseUrl(readmeContent);
      const liveTags = extractTags(readmeContent);
      const liveTech = extractTableField(readmeContent, '技术栈');
      const liveVehicle = extractTableField(readmeContent, '所属车型');

      if (meta) {
        // 已知项目：映射表优先，README 实时覆盖
        const project: ProjectInfo = {
          folderName,
          name: getProjectDisplayName(folderName),
          emoji: meta.emoji,
          folderPath,
          readmePath: readme?.path ?? null,
          description: liveDesc || meta.description,
          fileCount,
          lastModified,
          vehicle: meta.vehicle,
          systemType: meta.systemType,
          baseUrl: liveBase || getProjectUrl(folderName) || meta.baseUrl || null,
          source,
        };
        // 应用用户覆盖（data.json > PROJECT_META）
        const overrides = getProjectMetaOverrides();
        const ov = overrides[folderName];
        if (ov) {
          if (ov.vehicle !== undefined) project.vehicle = ov.vehicle;
          if (ov.systemType !== undefined) project.systemType = ov.systemType;
          if (ov.emoji !== undefined) project.emoji = ov.emoji;
        }
        projects.push(project);
      } else {
        // 未知项目：从 README/文件夹名自动推断
        const rawName = folderName.replace(/^\d+\./, '');
        const project: ProjectInfo = {
          folderName,
          name: rawName,
          emoji: inferEmoji(liveTags, source),
          folderPath,
          readmePath: readme?.path ?? null,
          description: liveDesc || '暂无描述',
          fileCount,
          lastModified,
          vehicle: liveVehicle || '通用',
          systemType: liveTech
            ? mapTechToSystem(liveTech)
            : liveTags.find((t) => getAllCategories().includes(t)) || '其他',
          baseUrl: liveBase || getProjectUrl(folderName) || null,
          source,
        };
        // 应用用户覆盖（data.json > README 推断 > 默认值）
        const overrides = getProjectMetaOverrides();
        const ov = overrides[folderName];
        if (ov) {
          if (ov.vehicle !== undefined) project.vehicle = ov.vehicle;
          if (ov.systemType !== undefined) project.systemType = ov.systemType;
          if (ov.emoji !== undefined) project.emoji = ov.emoji;
        }
        projects.push(project);
      }
    }
  }

  // 排序：系统项目按编号，车型项目按字母
  return projects.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source, 'zh');
    return a.folderName.localeCompare(b.folderName, 'zh');
  });
}

// ===== 分组工具 =====
export function groupBySource(projects: ProjectInfo[]): ProjectGroup[] {
  // 按 source（根目录名）分组
  const groups: ProjectGroup[] = [];
  const sourceMap = new Map<string, ProjectInfo[]>();
  for (const p of projects) sourceMap.set(p.source, [...(sourceMap.get(p.source) ?? []), p]);
  for (const [src, projs] of sourceMap) {
    groups.push({ key: src, label: `${src}（${projs.length}）`, projects: projs });
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
}

export function groupByVehicle(projects: ProjectInfo[]): ProjectGroup[] {
  const map = new Map<string, ProjectInfo[]>();
  for (const p of projects) {
    const list = map.get(p.vehicle) ?? [];
    list.push(p);
    map.set(p.vehicle, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === '通用') return 1;
      if (b === '通用') return -1;
      return a.localeCompare(b);
    })
    .map(([key, projs]) => ({ key, label: key, projects: projs }));
}

export function groupBySystem(projects: ProjectInfo[]): ProjectGroup[] {
  const map = new Map<string, ProjectInfo[]>();
  for (const p of projects) {
    const list = map.get(p.systemType) ?? [];
    list.push(p);
    map.set(p.systemType, list);
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b.length - a.length) // 项目多的排前面
    .map(([key, projs]) => ({ key, label: key, projects: projs }));
}

// ===== 格式化工具 =====
export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  const days = Math.floor(diff / 86400000);

  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
