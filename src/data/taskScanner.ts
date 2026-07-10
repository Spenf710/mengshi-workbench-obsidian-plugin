import { App, TFile } from 'obsidian';
import { PROJECT_META, getProjectDisplayName } from './projectScanner';
import { getProjectMetaOverrides, getConfig } from './settings';

// ===== 类型 =====
export interface TaskItem {
  id: string;
  text: string;
  filePath: string;
  fileName: string;
  line: number;
  done: boolean;
  mtime: number;
  project: string | null;
  projectName: string | null;
}

export interface TaskGroup {
  key: string;
  label: string;
  emoji: string;
  tasks: TaskItem[];
}

// ===== 关键词 → 项目文件夹映射 =====
// 关键词按业务术语匹配，文件夹名通过扫描磁盘查找（不硬编码）
const PROJECT_KEYWORDS: { pattern: RegExp; hint: string }[] = [
  { pattern: /GCC/i, hint: 'GCC' },
  { pattern: /RSKD/i, hint: 'RSKD' },
  { pattern: /PPAP/i, hint: 'PPAP' },
  { pattern: /设变/, hint: '设变' },
  { pattern: /EPS|开模令/i, hint: 'EPS' },
  { pattern: /风险清单/, hint: '风险' },
  { pattern: /低合格率/, hint: '低合格率' },
  { pattern: /FQ|SQE分工/, hint: 'FQ' },
  { pattern: /部品主责/, hint: '部品主责' },
  { pattern: /M18-3/, hint: 'M18-3' },
  { pattern: /延锋|超级工程师/, hint: '超级工程师' },
  { pattern: /猛士驾驶舱|工作台插件|Obsidian工作台/, hint: '猛士驾驶舱' },
];

// ===== 从待办文本中的 wiki-link 提取项目 =====
function extractProjectFromLink(text: string): string | null {
  // 匹配 [[xxx|...]] 或 [[xxx]]
  const linkRe = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text)) !== null) {
    const target = match[1].trim();
    // 尝试匹配项目 README 文件名
    for (const [folder, meta] of Object.entries(PROJECT_META)) {
      // 例如 "PPAP-RPA.README" → 1.PPAP-RPA
      const base = folder.replace(/^\d+\./, '');
      if (target.includes(base) || target.includes(meta.name)) {
        return folder;
      }
    }
    // 尝试直接匹配文件夹名
    if (PROJECT_META[target]) return target;
    // 尝试匹配到项目管理-系统/xxx 或 项目管理-车型/xxx
    const pathMatch = target.match(/(?:项目管理-[^/]+\/)([^/]+)/);
    if (pathMatch && PROJECT_META[pathMatch[1]]) return pathMatch[1];
  }
  return null;
}

// ===== 收集所有项目文件夹名（从磁盘扫描） =====
function collectProjectFolders(allFiles: TFile[]): string[] {
  const roots = getConfig().projectRoots.map((r) => r + '/');
  const folders = new Set<string>();
  for (const root of roots) {
    for (const f of allFiles) {
      if (!f.path.startsWith(root)) continue;
      const sub = f.path.slice(root.length).split('/')[0];
      if (sub) folders.add(sub);
    }
  }
  return Array.from(folders);
}

// ===== 文件夹名反向模糊匹配（待办文本中的片段 → 项目文件夹名） =====
// 例如："FQ新人引导手册——xxx" → 文件夹名 "猛士科技FQ新人引导手册" 包含该片段 → 匹配
// 例如："新人培训——xxx" → 文件夹名 "培训及AI学习" 拆为 ["培训","AI学习"] → 词段 "新人培训" 包含 "培训" → 匹配
function matchProjectByFolderName(text: string, allFiles: TFile[]): string | null {
  const folders = collectProjectFolders(allFiles);
  let bestMatch: string | null = null;
  let bestScore = 0;

  // 拆分待办文本为词段（按常见分隔符）
  const segments = text.split(/[——：:，,、\s]+/);

  for (const folder of folders) {
    const displayName = folder.replace(/^\d+\./, '');

    // 策略1：待办文本直接包含文件夹全名（精确匹配，最高优先级）
    for (const name of [displayName, folder]) {
      if (name.length >= 2 && text.includes(name) && name.length > bestScore) {
        bestMatch = folder;
        bestScore = name.length;
      }
    }

    // 策略2：文件夹名包含待办中的某个词段（反向包含）
    for (const seg of segments) {
      if (seg.length >= 2 && displayName.includes(seg) && seg.length > bestScore) {
        bestMatch = folder;
        bestScore = seg.length;
      }
    }

    // 策略3：双方都拆词后互相包含匹配
    // 例如文件夹 "培训及AI学习" → ["培训","AI学习"]，待办 "新人培训" 包含 "培训"
    const nameTokens = displayName.split(/[及与和、，\-–—]+/);
    for (const seg of segments) {
      if (seg.length < 2) continue;
      for (const token of nameTokens) {
        if (token.length < 2) continue;
        // 双向检查：词段包含令牌 或 令牌包含词段
        const hit = seg.includes(token) ? token.length : token.includes(seg) ? seg.length : 0;
        if (hit > bestScore) {
          bestMatch = folder;
          bestScore = hit;
        }
      }
    }

    // 策略4：渐进截断匹配（处理带后缀的词段）
    // 例如 "FQ新人引导手册初版" → 截断为 "FQ新人引导手册" → 匹配 "猛士科技FQ新人引导手册"
    for (const seg of segments) {
      if (seg.length < 5) continue; // 只对较长的词段做截断
      // 从右侧逐字截断，直到最小长度2
      for (let end = seg.length - 1; end >= 2; end--) {
        const sub = seg.slice(0, end);
        if (sub.length <= bestScore) break; // 不可能比当前最佳更长了
        // 检查截断后的片段是否被任何文件夹包含
        if (displayName.includes(sub) && sub.length > bestScore) {
          bestMatch = folder;
          bestScore = sub.length;
          break; // 已找到该segment在该folder下的最长匹配
        }
        // 也检查令牌
        for (const token of nameTokens) {
          if (token.length < 2) continue;
          if (token.includes(sub) && sub.length > bestScore) {
            bestMatch = folder;
            bestScore = sub.length;
            break;
          }
        }
      }
    }
  }

  return bestMatch;
}

// ===== 关键词模糊匹配项目（从磁盘动态查文件夹名） =====
function matchProjectByKeyword(text: string, allFiles: TFile[]): string | null {
  for (const { pattern, hint } of PROJECT_KEYWORDS) {
    if (!pattern.test(text)) continue;
    // 从磁盘找出包含 hint 的文件夹
    const folder = findFolderByHint(allFiles, hint);
    if (folder) return folder;
  }
  return null;
}

function findFolderByHint(allFiles: TFile[], hint: string): string | null {
  const roots = getConfig().projectRoots.map((r) => r + '/');
  for (const root of roots) {
    for (const f of allFiles) {
      if (!f.path.startsWith(root)) continue;
      const sub = f.path.slice(root.length).split('/')[0];
      if (sub && sub.includes(hint)) return sub;
    }
  }
  return null;
}

// ===== 扫描 =====
export async function scanTasks(app: App): Promise<TaskItem[]> {
  const tasks: TaskItem[] = [];
  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    if (file.path.startsWith('templates/')) continue;
    if (file.path.startsWith('.obsidian/')) continue;

    // 仅扫描工作日志、工作周报、项目 README（排除过程文档中的笔记式待办）
    const _isWorkLog = file.path.startsWith(getConfig().workLogPath + '/');
    const _isWeekly = file.path.startsWith('工作周报/');
    const _isProjectReadme = getConfig().projectRoots.some(
      (root) => file.path.startsWith(root + '/') && file.name.endsWith('.README.md'),
    );
    if (!_isWorkLog && !_isWeekly && !_isProjectReadme) continue;

    try {
      const content = await app.vault.cachedRead(file);
      const lines = content.split('\n');

      const isWorkLog = _isWorkLog;
      let inSkipSection = false;
      let inTomorrowSection = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 工作日志中跳过「今天搞哪个项目」区块
        if (isWorkLog) {
          if (/^##\s+.*今天搞哪个项目/.test(line)) {
            inSkipSection = true;
            continue;
          }
          if (inSkipSection && /^##\s/.test(line)) {
            inSkipSection = false;
            // 继续检查是否为「明天要做」区块
          }
          if (inSkipSection) continue;

          // 跳过「明天要做 / 下周一要做」区块（纯文本脑内导出，不追踪）
          if (/^##\s+.*(?:明天要做|下周一要做|后天要做)/.test(line)) {
            inTomorrowSection = true;
            continue;
          }
          if (inTomorrowSection && /^##\s/.test(line)) {
            inTomorrowSection = false;
            // 继续处理新 section
          }
          if (inTomorrowSection) continue;
        }

        // 匹配 "- [ ] " 或 "- [x] " 任务
        const todoMatch = line.match(/^\s*- \[ \]\s+(.+)/);
        const doneMatch = line.match(/^\s*- \[x\]\s+(.+)/i);
        if (!todoMatch && !doneMatch) continue;

        const isDone = !!doneMatch;
        const text = (todoMatch?.[1] ?? doneMatch![1]).trim();
        if (!text) continue;

        // 项目归属：链接 > 文件夹名模糊 > 关键词 > 文件路径
        // 仅工作日志/周报/无归属文件需要模糊分类，项目文件夹内直接锁定
        let project = detectProject(file.path);
        if (!project || project.folder === '__log__' || project.folder === '__weekly__') {
          const linkedProject = extractProjectFromLink(text)
            || matchProjectByFolderName(text, files)
            || matchProjectByKeyword(text, files);
          if (linkedProject) {
            project = {
              folder: linkedProject,
              name: getProjectDisplayName(linkedProject),
            };
          }
        }

        tasks.push({
          id: `${file.path}:${i}`,
          text,
          filePath: file.path,
          fileName: file.name.replace(/\.md$/, ''),
          line: i,
          done: isDone,
          mtime: file.stat.mtime,
          project: project?.folder ?? null,
          projectName: project?.name ?? null,
        });
      }
    } catch {
      // 跳过无法读取的文件
    }
  }

  // 排序：未完成在前，有归属项目在前
  return tasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.project && !b.project) return -1;
    if (!a.project && b.project) return 1;
    if (a.project && b.project) {
      return (a.projectName ?? '').localeCompare(b.projectName ?? '', 'zh');
    }
    return a.text.localeCompare(b.text, 'zh');
  });
}

// ===== 项目检测（从文件路径） =====
function detectProject(
  path: string,
): { folder: string; name: string } | null {
  const roots = getConfig().projectRoots.map((r) => r + '/');

  for (const root of roots) {
    if (path.startsWith(root)) {
      const sub = path.slice(root.length).split('/')[0];
      if (sub) {
        return { folder: sub, name: getProjectDisplayName(sub) };
      }
    }
  }

  const wlPath = getConfig().workLogPath + '/';
  if (path.startsWith(wlPath)) {
    return { folder: '__log__', name: '工作日志' };
  }

  if (path.startsWith('工作周报/')) {
    return { folder: '__weekly__', name: '工作周报' };
  }

  return null;
}

// ===== 分组 =====
export function groupTasks(tasks: TaskItem[]): TaskGroup[] {
  const map = new Map<string, TaskItem[]>();

  for (const task of tasks) {
    const key = task.project ?? '__orphan__';
    const list = map.get(key) ?? [];
    list.push(task);
    map.set(key, list);
  }

  const groups: TaskGroup[] = [];

  for (const [key, taskList] of map.entries()) {
    if (key === '__orphan__') {
      groups.push({
        key: '__orphan__',
        label: '无归属',
        emoji: '📋',
        tasks: taskList,
      });
    } else {
      const name = taskList[0]?.projectName ?? key;
      const emoji = getProjectEmoji(key);
      groups.push({ key, label: name, emoji, tasks: taskList });
    }
  }

  return groups.sort((a, b) => {
    if (a.key === '__orphan__') return 1;
    if (b.key === '__orphan__') return -1;
    return a.label.localeCompare(b.label, 'zh');
  });
}

function getProjectEmoji(folder: string): string {
  if (folder === '__log__') return '📅';
  if (folder === '__weekly__') return '📊';
  if (folder === '__orphan__') return '📋';
  // 用户覆盖优先于 PROJECT_META
  const overrides = getProjectMetaOverrides();
  return overrides[folder]?.emoji ?? PROJECT_META[folder]?.emoji ?? '📁';
}

// ===== 切换任务完成状态 =====
export async function toggleTask(
  app: App,
  task: TaskItem,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return false;

  try {
    await app.vault.process(file, (content) => {
      const lines = content.split('\n');
      if (task.line < lines.length) {
        if (task.done) {
          lines[task.line] = lines[task.line].replace(/\[x\]/i, '[ ]');
        } else {
          lines[task.line] = lines[task.line].replace('[ ]', '[x]');
        }
      }
      return lines.join('\n');
    });
    return true;
  } catch {
    return false;
  }
}
