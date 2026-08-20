/**
 * 任务数据层（Phase 9/10 旧版任务看板，已下线，代码保留待重构复用）
 *
 * 原设计：独立任务清单 + 四状态机（排队/审查/loop/完结）。
 * 已决定移除任务看板 UI，转向「目标→计划→多轮自动执行→感知→继续/停止」的自主 loop 机制。
 * 保留 CRUD + runLoop CLI 封装，后续作为 loop 工程的底层组件复用。
 */

import { App, TFile, Notice } from 'obsidian';
import { exec } from 'child_process';
import { getTaskStorePath, getSessionConfig } from './settings';

// ===== 类型 =====

export type TaskStatus = '排队' | '审查' | 'loop' | '完结';

export const TASK_STATUS_LIST: TaskStatus[] = ['排队', '审查', 'loop', '完结'];

export interface SessionTask {
  /** 文件 vault 相对路径 */
  path: string;
  /** 文件名（去 .md） */
  id: string;
  title: string;
  status: TaskStatus;
  /** 归属项目目录相对路径，如「项目管理-系统/8.猛士驾驶舱插件」 */
  project: string | null;
  /** 挂载的会话 sessionId 列表 */
  sessionIds: string[];
  priority: '高' | '中' | '低' | '';
  created: string;
  /** 更新时间戳 */
  updated: string;
}

// ===== 工具 =====

const STATUS_NEXT: Record<TaskStatus, TaskStatus | null> = {
  '排队': '审查',
  '审查': 'loop',
  'loop': '完结',
  '完结': null,
};

/** 状态机推进，到终态停留 */
export function nextStatus(s: TaskStatus): TaskStatus | null {
  return STATUS_NEXT[s] ?? null;
}

/** 生成任务文件名：YYYYMMDD-HHmm-标题片段.md */
function genTaskFileName(title: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const frag = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 30).trim() || 'untitled';
  return `${stamp}-${frag}.md`;
}

/** 新建任务初始正文模板 */
function initialBody(title: string, project: string | null, priority: string): string {
  const projLine = project ? `> 归属项目：[[${project}]]` : '> 归属项目：（未指定）';
  return `# ${title}

${projLine}

## 任务描述


## 审查意见


## loop 历史

> 每次 loop 起新会话后自动在此记录。

---
> 任务态由猛士驾驶舱会话面板管理，请勿手改 frontmatter 的 status/session_ids。
`;
}

// ===== 路径 =====

function taskStore(): string {
  return getTaskStorePath();
}

/** 确保任务存储目录存在（vault 内相对路径） */
async function ensureStoreDir(app: App): Promise<void> {
  const store = taskStore();
  if (store.endsWith('.md')) return; // 用户误配成文件，不自动建
  if (!app.vault.getAbstractFileByPath(store)) {
    try {
      await app.vault.createFolder(store);
    } catch {
      // 可能已存在，忽略
    }
  }
}

// ===== 读取 =====

/** 扫描任务存储目录下的所有任务 */
export async function scanTasks(app: App): Promise<SessionTask[]> {
  const store = taskStore();
  const folder = app.vault.getAbstractFileByPath(store);
  if (!folder || !('children' in folder)) return [];

  const tasks: SessionTask[] = [];
  const files = (folder as any).children?.filter((f: any) => f instanceof TFile && f.path.endsWith('.md')) ?? [];
  for (const f of files as TFile[]) {
    const t = await parseTaskFile(app, f);
    if (t) tasks.push(t);
  }
  tasks.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  return tasks;
}

/** 从单个文件解析任务 */
async function parseTaskFile(app: App, file: TFile): Promise<SessionTask | null> {
  try {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return null;
    const status = (fm.status as TaskStatus) || '排队';
    const sessionIds = Array.isArray(fm.session_ids) ? fm.session_ids : (fm.session_ids ? [fm.session_ids] : []);
    return {
      path: file.path,
      id: file.basename,
      title: fm.title || file.basename,
      status,
      project: fm.project || null,
      sessionIds,
      priority: fm.priority || '',
      created: fm.created || file.stat.ctime?.toString() || '',
      updated: file.stat.mtime?.toString() || '',
    };
  } catch {
    return null;
  }
}

// ===== 创建 =====

export async function createTask(
  app: App,
  opts: { title: string; project: string | null; priority: '高' | '中' | '低' | ''; status?: TaskStatus; initialSessionId?: string },
): Promise<SessionTask | null> {
  await ensureStoreDir(app);
  const fileName = genTaskFileName(opts.title);
  const filePath = `${taskStore()}/${fileName}`;
  const created = new Date().toISOString().slice(0, 10);
  const status = opts.status || '排队';
  const sessionIds = opts.initialSessionId ? [opts.initialSessionId] : [];

  const frontmatterLines = [
    '---',
    `title: "${opts.title.replace(/"/g, '\\"')}"`,
    `status: ${status}`,
    `project: ${opts.project ? `"${opts.project}"` : 'null'}`,
    `priority: ${opts.priority || '""'}`,
    `created: ${created}`,
    `session_ids: [${sessionIds.map((s) => `"${s}"`).join(', ')}]`,
    'tags: [会话任务, Claude]',
    '---',
    '',
  ].join('\n');
  const content = frontmatterLines + initialBody(opts.title, opts.project, opts.priority);

  try {
    const file = await app.vault.create(filePath, content);
    return await parseTaskFile(app, file);
  } catch (e: any) {
    new Notice(`创建任务失败：${e?.message || e}`);
    return null;
  }
}

// ===== 状态机 =====

export async function updateStatus(app: App, task: SessionTask, status: TaskStatus): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.status = status;
  });
  task.status = status;
}

/** 推进到下一态，到终态停留并提示 */
export async function advanceStatus(app: App, task: SessionTask): Promise<TaskStatus | null> {
  const nx = nextStatus(task.status);
  if (!nx) {
    new Notice('任务已在终态「完结」');
    return null;
  }
  await updateStatus(app, task, nx);
  return nx;
}

// ===== 会话挂载 =====

export async function attachSession(app: App, task: SessionTask, sessionId: string): Promise<void> {
  if (!sessionId || task.sessionIds.includes(sessionId)) return;
  const file = app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm) => {
    const arr = Array.isArray(fm.session_ids) ? fm.session_ids : (fm.session_ids ? [fm.session_ids] : []);
    if (!arr.includes(sessionId)) arr.push(sessionId);
    fm.session_ids = arr;
  });
  task.sessionIds = [...task.sessionIds, sessionId];
}

export async function detachSession(app: App, task: SessionTask, sessionId: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm) => {
    const arr = Array.isArray(fm.session_ids) ? fm.session_ids : [];
    fm.session_ids = arr.filter((s: string) => s !== sessionId);
  });
  task.sessionIds = task.sessionIds.filter((s) => s !== sessionId);
}

// ===== 项目/标题/优先级编辑 =====

export async function updateTaskMeta(
  app: App,
  task: SessionTask,
  meta: { title?: string; project?: string | null; priority?: '高' | '中' | '低' | '' },
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (meta.title !== undefined) fm.title = meta.title;
    if (meta.project !== undefined) fm.project = meta.project;
    if (meta.priority !== undefined) fm.priority = meta.priority;
  });
  if (meta.title !== undefined) task.title = meta.title;
  if (meta.project !== undefined) task.project = meta.project;
  if (meta.priority !== undefined) task.priority = meta.priority;
}

// ===== 删除 =====

export async function deleteTask(app: App, task: SessionTask): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return;
  await app.vault.trash(file);
}

// ===== Phase 10: loop 起新会话 =====

/** 探测 claude CLI 可用路径：用户配置 > Windows npm 全局 > PATH 里的 claude */
function resolveClaudeCli(): string {
  const cfg = getSessionConfig();
  if (cfg.claudeCliPath) return cfg.claudeCliPath;
  if (process.platform === 'win32') {
    const npm = `${process.env.APPDATA || ''}\\npm\\claude.cmd`;
    return npm; // 多数情况 npm 全局装在这里；找不到由 exec 报错兜底
  }
  return 'claude';
}

export interface LoopResult {
  ok: boolean;
  newSessionId?: string;
  error?: string;
  output?: string;
}

/**
 * 用 claude CLI 起新会话（fork 分叉）：保留原会话上下文，生成独立新 session。
 * 命令：claude --resume <原sessionId> --fork-session --print --output-format json -p "<prompt>"
 * 成功后：新 session_id 回填 frontmatter session_ids + 正文追加 loop 历史条目。
 * @param prompt 发给新会话的首条指令（任务描述+审查意见）
 */
export function runLoop(app: App, task: SessionTask, prompt: string): Promise<LoopResult> {
  return new Promise((resolve) => {
    const newSession = task.sessionIds[task.sessionIds.length - 1] || '';
    const cli = resolveClaudeCli();
    // 组装命令：--resume 需有原会话；无原会话时退化为纯新会话（不带 resume/fork）
    const esc = (s: string) => s.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const promptArg = esc(prompt).slice(0, 4000);
    const args = newSession
      ? `--resume "${newSession}" --fork-session --print --output-format json -p "${promptArg}"`
      : `--print --output-format json -p "${promptArg}"`;
    const cmd = `"${cli}" ${args}`;

    exec(cmd, { timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, async (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: `CLI 执行失败：${err.message}`, output: (stderr || '').slice(0, 500) });
        return;
      }
      let obj: any;
      try {
        obj = JSON.parse(stdout);
      } catch {
        resolve({ ok: false, error: '无法解析 CLI 输出 JSON', output: stdout.slice(0, 500) });
        return;
      }
      if (obj.is_error) {
        resolve({ ok: false, error: `Claude 返回错误：${obj.api_error_status || obj.result || ''}`, output: stdout.slice(0, 500) });
        return;
      }
      const newId = obj.session_id as string | undefined;
      if (!newId) {
        resolve({ ok: false, error: 'CLI 输出未含 session_id', output: stdout.slice(0, 500) });
        return;
      }

      // 回填 frontmatter + 正文 loop 历史
      const file = app.vault.getAbstractFileByPath(task.path);
      if (file instanceof TFile) {
        try {
          await app.fileManager.processFrontMatter(file, (fm) => {
            const arr = Array.isArray(fm.session_ids) ? fm.session_ids : (fm.session_ids ? [fm.session_ids] : []);
            if (!arr.includes(newId)) arr.push(newId);
            fm.session_ids = arr;
          });
          task.sessionIds = [...task.sessionIds, newId];
          // 正文追加 loop 历史条目（不碰 frontmatter，process 后单独追加正文）
          const dateStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
          const entry = `\n- [${dateStr}] loop → 会话 \`${newId.slice(0, 8)}…\` 起新，指令：${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}\n`;
          await app.vault.process(file, (content) => {
            // 追加到 ## loop 历史 章节末尾；若找不到该章节则追加到文件末尾
            const marker = '## loop 历史';
            const idx = content.indexOf(marker);
            if (idx === -1) return content + entry;
            // 找到该章节后的下一个 ## 章节或文件尾，插入其前
            const afterMarker = content.indexOf('\n##', idx + marker.length);
            const insertPos = afterMarker === -1 ? content.length : afterMarker;
            return content.slice(0, insertPos) + entry + content.slice(insertPos);
          });
        } catch (e: any) {
          resolve({ ok: false, error: `新会话已创建但回写失败：${e?.message || e}`, output: newId });
          return;
        }
      }
      resolve({ ok: true, newSessionId: newId });
    });
  });
}

// ===== Phase 10: 完结本地归档 =====

/** 结束任务时，把任务摘要追加写入会话任务/已完结归档.md（纯本地轻量归档，不调 Skill） */
export async function finishTask(app: App, task: SessionTask): Promise<void> {
  const archivePath = `${taskStore()}/已完结归档.md`;
  const dateStr = new Date().toISOString().slice(0, 10);
  const projCell = task.project ? `[[${task.project}]]` : '—';
  const sessCell = task.sessionIds.length
    ? task.sessionIds.map((s) => `\`${s.slice(0, 8)}…\``).join(' ')
    : '—';
  const row = `| ${dateStr} | ${projCell} | ${task.title} | ${(task.priority as string) || '—'} | ${task.sessionIds.length} | ${sessCell} |`;

  const sepLine = '|------|------|------|--------|----------|----------|';
  const f = app.vault.getAbstractFileByPath(archivePath);

  if (!(f instanceof TFile)) {
    // 文件不存在：创建表头 + 首行
    const content = `# 已完结任务归档

> 任务完结时自动追写。新条目在表格顶部。

| 完结日期 | 项目 | 任务 | 优先级 | loop 次数 | 挂载会话 |
${sepLine}
${row}
`;
    await app.vault.create(archivePath, content);
    return;
  }

  // 文件已存在：插到分隔行后（新行在上）
  let old = await app.vault.read(f);
  const sepIdx = old.indexOf(sepLine);
  if (sepIdx === -1) {
    // 缺分隔行（如旧文件被手改）：重建标准表头，旧表格行作为历史数据保留在分隔行下
    const header = `# 已完结任务归档\n\n> 任务完结时自动追写。新条目在表格顶部。\n\n| 完结日期 | 项目 | 任务 | 优先级 | loop 次数 | 挂载会话 |\n${sepLine}\n${row}\n`;
    await app.vault.modify(f, header + old);
  } else {
    old = old.slice(0, sepIdx + sepLine.length) + '\n' + row + old.slice(sepIdx + sepLine.length);
    await app.vault.modify(f, old);
  }
}