/**
 * 会话数据层 — 读取 Claude Code 的会话 .jsonl，构建会话卡片
 *
 * 依赖：Node.js fs（Obsidian Electron 环境可用）
 * 数据源：~/.claude/projects/<编码vault路径>/<sessionId>.jsonl
 *
 * 路径默认值在 settings.ts::getSessionRootDir()，用户可在设置页覆盖。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getSessionRootDir } from './settings';

// ===== 类型定义 =====

export interface ProjectRef {
  /** 项目目录相对路径，如「项目管理-系统/8.猛士驾驶舱插件」，无法归属时为 null */
  projectPath: string | null;
  /** 命中线索类型 */
  source: 'at-ref' | 'wikilink' | 'cwd' | 'none';
  /** 命中的原始证据（@引用或链接文本），用于调试/展示 */
  evidence: string;
}

export interface SessionCard {
  sessionId: string;
  /** AI 自动生成的标题（取最后一条 ai-title 事件） */
  aiTitle: string;
  /** 用户首条 prompt，作主题预览 */
  firstPrompt: string;
  /** 会话开始时间 ISO */
  startTime: string;
  /** 会话最后活动时间 ISO */
  lastTime: string;
  /** 用户真实提问轮次数（排除 tool_result 回传） */
  userTurns: number;
  /** 工具调用次数（tool_use 块数） */
  toolCalls: number;
  /** 工作目录 */
  cwd: string;
  /** 项目归属（三线索交叉） */
  projectRef: ProjectRef;
  /** .jsonl 文件绝对路径 */
  filePath: string;
  /** 会话发起入口：Obsidian / 命令行 / 未知 */
  entrySource: string;
  /** 会话内调用的 skill 名集合（判断日常操作：日志/周报等） */
  skills: string[];
}

// ===== Vault 路径编码 =====

/**
 * Claude Code 把 cwd 编码成 projects 子目录名：
 * 盘符冒号、盘符冒号后的斜杠、路径分隔符、非 ASCII 字符 → 全部替换为连字符。
 * 例：E:\obsidian_md\猛士科技 → E--obsidian-md-----
 */
export function encodeVaultPath(vaultPath: string): string {
  // 逐字符映射：ASCII 字母数字原样保留，其余（: \ / _ . 非 ASCII）统一转连字符，不合并
  let out = '';
  for (const ch of vaultPath) {
    if (/[A-Za-z0-9]/.test(ch)) {
      out += ch;
    } else {
      out += '-';
    }
  }
  return out;
}

// ===== 文本提取 =====

/** 判断 user 消息是否是纯 tool_result 回传（非人的实际输入） */
function isToolResultTurn(content: unknown): boolean {
  if (Array.isArray(content)) {
    return content.length > 0 && content.every((b: any) => b?.type === 'tool_result');
  }
  return false;
}

/** 判断 user 消息是否是系统自动注入（非人的实际输入）
 *  真实用户输入 content 是纯字符串，系统注入 content 是数组 */
function isSystemInjected(obj: any): boolean {
  return Array.isArray(obj.message?.content) && !isToolResultTurn(obj.message?.content);
}

/** 从一行 message.content 提取纯文本（user 是字符串，assistant 是 block 数组） */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => {
        if (b && typeof b === 'object') {
          if (typeof b.text === 'string') return b.text;
          if (typeof b.thinking === 'string') return ''; // 跳过 thinking
          if (b.type === 'tool_use' || b.type === 'tool_result') return '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

// ===== 项目归属提取（三线索） =====

/** 从会话文本中提取 @文件引用 和 [[链接]]，匹配项目目录 */
export function extractProjectRef(
  textChunks: string[],
  knownProjectPaths: string[],
  cwd: string,
  aiTitle?: string,
): ProjectRef {
  const joined = textChunks.join('\n');

  // 线索1：@文件引用
  const atRefs = [...joined.matchAll(/@([^\s,，()（）]+[^\s,，()（）.]*\.?(?:md)?)/g)].map((m) => m[1]);
  for (const ref of atRefs) {
    const hit = knownProjectPaths.find((p) => ref.startsWith(p) || ref.startsWith(p + '/'));
    if (hit) return { projectPath: hit, source: 'at-ref', evidence: `@${ref}` };
  }

  // 线索2：[[链接]]
  const wiki = [...joined.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split('|')[0]);
  for (const link of wiki) {
    const hit = knownProjectPaths.find((p) => link.startsWith(p) || link.startsWith(p + '/'));
    if (hit) return { projectPath: hit, source: 'wikilink', evidence: `[[${link}]]` };
  }

  // 线索3：aiTitle / firstPrompt 语义匹配项目名
  // 提取每个项目的"核心名"（去掉数字前缀和通用后缀）
  const projectNameMap = new Map<string, { core: string; path: string }>();
  for (const p of knownProjectPaths) {
    const segments = p.split('/');
    const folderName = segments[segments.length - 1];
    const fullName = folderName.replace(/^\d+\.\s*/, '');
    // 核心名：去掉常见后缀词
    const core = fullName.replace(/(?:插件|系统|平台|工具|面板|模块|引擎|管理|助手|项目|开发|重构|自动化|智能体)$/, '');
    projectNameMap.set(fullName, { core: core || fullName, path: p });
  }

  // 用 aiTitle 和 firstPrompt 分别匹配
  const matchTexts = [aiTitle || '', textChunks[0] || ''].filter(Boolean);
  for (const text of matchTexts) {
    if (!text) continue;
    // 先试完整项目名匹配
    for (const [fullName, { path: p }] of projectNameMap) {
      if (text.includes(fullName)) {
        return { projectPath: p, source: 'at-ref', evidence: `标题匹配「${fullName}」` };
      }
    }
    // 再试核心名匹配（排除过于短的核心名避免误匹配）
    for (const [fullName, { core, path: p }] of projectNameMap) {
      if (core.length >= 3 && text.includes(core)) {
        return { projectPath: p, source: 'at-ref', evidence: `标题匹配「${core}」` };
      }
    }
  }

  // 线索4：cwd 兜底
  if (cwd) return { projectPath: null, source: 'cwd', evidence: cwd };

  return { projectPath: null, source: 'none', evidence: '' };
}

// ===== 单会话解析 =====

export interface SessionRaw {
  aiTitle: string;
  firstPrompt: string;
  startTime: string;
  lastTime: string;
  userTurns: number;
  toolCalls: number;
  cwd: string;
  textChunks: string[];
  /** 会话内调用的 skill 名集合（识别日志/周报等日常操作） */
  skills: string[];
}

// ===== 日常操作 skill 识别 =====
// 命中这些 skill 的会话归入"日常"抽屉：日志、周报、日报、站会等
const DAILY_SKILLS = ['work-log-refine', 'weekly-report', 'lark-workflow-standup-report', 'lark-workflow-meeting-summary'];

/** 从一行内容提取 <command-name>/xxx</command-name> 或 Skill("xxx") 调用的 skill 名 */
function extractSkillNames(content: unknown): string[] {
  const names: string[] = [];
  const str = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  for (const m of str.matchAll(/command-name>(.+?)<\/command-name/g)) {
    names.push(m[1].trim());
  }
  for (const m of str.matchAll(/Skill\(\s*["'](.+?)["']\s*\)/g)) {
    names.push(m[1].trim());
  }
  for (const sk of DAILY_SKILLS) {
    if (str.includes(sk)) names.push(sk);
  }
  return names;
}

/** 流式按行解析单个 .jsonl，抽元信息 + 文本块（供项目归属分析） */
export async function parseSessionFile(filePath: string): Promise<SessionRaw | null> {
  return new Promise((resolve) => {
    let aiTitle = '';
    let firstPrompt = '';
    let startTime = '';
    let lastTime = '';
    let userTurns = 0;
    let toolCalls = 0;
    let cwd = '';
    let firstUserFound = false;
    const textChunks: string[] = [];
    const skills: string[] = [];

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let buf = '';

    stream.on('data', (chunk: Buffer | string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? ''; // 最后一行可能当前不完整，留到下次
      for (const line of lines) {
        if (!line.trim()) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        const t = obj.type;
        const ts = obj.timestamp as string | undefined;
        if (ts) {
          if (!startTime) startTime = ts;
          lastTime = ts;
        }
        if (obj.cwd && !cwd) cwd = obj.cwd;
        if (t === 'ai-title' && obj.aiTitle) aiTitle = obj.aiTitle as string;
        // 提取 skill 调用（user 指令 + assistant tool_use）
        if (t === 'user' || t === 'assistant') {
          const found = extractSkillNames(obj.message?.content);
          for (const n of found) if (!skills.includes(n)) skills.push(n);
        }
        if (t === 'user') {
          // 跳过纯 tool_result 回传 + 系统注入的 skill/指令消息
          if (!isToolResultTurn(obj.message?.content) && !isSystemInjected(obj)) {
            userTurns++;
            const text = extractText(obj.message?.content);
            if (text) {
              textChunks.push(text);
              if (!firstUserFound) {
                firstPrompt = text.slice(0, 200);
                firstUserFound = true;
              }
            }
          }
        } else if (t === 'assistant') {
          // 统计 tool_use 块数 = 真实工具调用次数
          const content = obj.message?.content;
          if (Array.isArray(content)) {
            for (const b of content) {
              if (b?.type === 'tool_use') toolCalls++;
            }
          }
        }
      }
    });

    stream.on('end', () => {
      if (buf.trim()) {
        try {
          const obj = JSON.parse(buf);
          if (obj.type === 'ai-title' && obj.aiTitle) aiTitle = obj.aiTitle;
        } catch {
          /* ignore */
        }
      }
      resolve({ aiTitle, firstPrompt, startTime, lastTime, userTurns, toolCalls, cwd, textChunks, skills });
    });

    stream.on('error', () => resolve(null));
  });
}

// ===== 完整轮次解析（详情视图用） =====

export interface TurnBlock {
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  /** text→正文；thinking→思考；tool_use→工具名；tool_result→占位提示 */
  label?: string;
  /** text/thinking: 正文内容；tool_use: 工具输入 JSON */
  content: string;
}

export interface SessionTurn {
  role: 'user' | 'assistant' | 'tool';
  /** 该轮的有序内容块（text/thinking/tool_use/tool_result 分离展示） */
  blocks: TurnBlock[];
  timestamp: string;
  /** 原始行号索引（用于快捷定位） */
  lineIndex: number;
}

export interface SessionDetail {
  sessionId: string;
  aiTitle: string;
  cwd: string;
  startTime: string;
  lastTime: string;
  turns: SessionTurn[];
  /** 用户提问标题列表（用于快速定位） */
  userPrompts: { lineIndex: number; text: string }[];
}

/** 把 message.content 解析为内容块数组 */
function parseBlocks(content: unknown): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  if (typeof content === 'string') {
    if (content.trim()) blocks.push({ kind: 'text', content });
    return blocks;
  }
  if (Array.isArray(content)) {
    for (const b: any of content) {
      if (!b || typeof b !== 'object') continue;
      const t = b.type;
      if (t === 'text' && typeof b.text === 'string' && b.text.trim()) {
        blocks.push({ kind: 'text', content: b.text });
      } else if (t === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) {
        blocks.push({ kind: 'thinking', content: b.thinking });
      } else if (t === 'tool_use') {
        blocks.push({ kind: 'tool_use', label: b.name || '工具', content: JSON.stringify(b.input ?? {}, null, 2).slice(0, 2000) });
      } else if (t === 'tool_result') {
        // tool_result 的 content 可能是 array[{type:text}] 或 string
        let tr = '';
        if (typeof b.content === 'string') tr = b.content;
        else if (Array.isArray(b.content)) {
          tr = b.content.map((x: any) => x?.text ?? '').join('');
        }
        blocks.push({ kind: 'tool_result', content: tr.slice(0, 3000) });
      }
    }
  }
  return blocks;
}

/**
 * 读取单个会话的完整轮次（详情视图用）。
 * 不做合并——保留每条 user/assistant 原始消息为独立 turn，由 UI 决定折叠策略。
 * tool_result 类型的 user 行跳过（避免把工具回显当用户输入）。
 */
export async function parseSessionTurns(filePath: string): Promise<SessionDetail | null> {
  return new Promise((resolve) => {
    let aiTitle = '';
    let cwd = '';
    let startTime = '';
    let lastTime = '';
    const turns: SessionTurn[] = [];
    const userPrompts: { lineIndex: number; text: string }[] = [];

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let buf = '';
    let lineIndex = 0;

    stream.on('data', (chunk: Buffer | string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const currentLine = lineIndex;
        lineIndex++;
        let obj: any;
        try { obj = JSON.parse(line); } catch { continue; }
        const t = obj.type;
        const ts = obj.timestamp as string | undefined;
        if (ts) { if (!startTime) startTime = ts; lastTime = ts; }
        if (obj.cwd && !cwd) cwd = obj.cwd;
        if (t === 'ai-title' && obj.aiTitle) aiTitle = obj.aiTitle;
        if (t === 'user') {
          const blocks = parseBlocks(obj.message?.content);
          // 纯 tool_result 回传 → 标记为 tool 角色
          const isToolOnly = blocks.length > 0 && blocks.every((b) => b.kind === 'tool_result');
          // 系统注入（parentUuid 有值）→ 标记为 tool 角色
          const isSystem = isSystemInjected(obj);
          if (blocks.length) {
            turns.push({ role: isToolOnly || isSystem ? 'tool' : 'user', blocks, timestamp: ts || '', lineIndex: currentLine });
            if (!isToolOnly && !isSystem) {
              const textBlock = blocks.find((b) => b.kind === 'text');
              if (textBlock) {
                userPrompts.push({ lineIndex: currentLine, text: textBlock.content.slice(0, 100) });
              }
            }
          }
        } else if (t === 'assistant') {
          const blocks = parseBlocks(obj.message?.content);
          if (blocks.length) {
            turns.push({ role: t, blocks, timestamp: ts || '', lineIndex: currentLine });
          }
        }
      }
    });

    stream.on('end', () => resolve({ sessionId: '', aiTitle, cwd, startTime, lastTime, turns, userPrompts }));
    stream.on('error', () => resolve(null));
  });
}

// ===== 扫描入口 =====

export interface ScanSessionsResult {
  vaultDirName: string;
  sessions: SessionCard[];
  scanned: number;
  failed: number;
}

/**
 * 扫描当前 vault 的全部会话。
 * @param vaultPath vault 绝对路径（app.vault.adapter.getBasePath()）
 * @param knownProjectPaths 已知项目目录相对路径列表（来自 projectScanner）
 */
export async function scanSessions(
  vaultPath: string,
  knownProjectPaths: string[],
): Promise<ScanSessionsResult> {
  const root = getSessionRootDir();
  const vaultDirName = encodeVaultPath(vaultPath);
  const vaultDir = path.join(root, vaultDirName);

  let entries: string[];
  try {
    entries = await fs.promises.readdir(vaultDir);
  } catch {
    return { vaultDirName, sessions: [], scanned: 0, failed: 0 };
  }

  const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'));
  const results = await Promise.all(
    jsonlFiles.map(async (f) => {
      const filePath = path.join(vaultDir, f);
      const raw = await parseSessionFile(filePath);
      if (!raw) return null;
      const sessionId = f.replace(/\.jsonl$/, '');
      const projectRef = extractProjectRef(raw.textChunks, knownProjectPaths, raw.cwd, raw.aiTitle);
      // 判断入口来源：cwd 编码后是否匹配 vault 目录名
      const encodedCwd = encodeVaultPath(raw.cwd);
      const entrySource = encodedCwd.startsWith(vaultDirName) ? 'Obsidian' : '命令行';
      const card: SessionCard = {
        sessionId,
        aiTitle: raw.aiTitle || raw.firstPrompt.slice(0, 40) || '(无标题)',
        firstPrompt: raw.firstPrompt,
        startTime: raw.startTime,
        lastTime: raw.lastTime,
        userTurns: raw.userTurns,
        toolCalls: raw.toolCalls,
        cwd: raw.cwd,
        projectRef,
        filePath,
        entrySource,
        skills: raw.skills,
      };
      return card;
    }),
  );

  const sessions = (results.filter(Boolean) as SessionCard[]).sort(
    (a, b) => (b.lastTime || '').localeCompare(a.lastTime || ''),
  );
  const failed = jsonlFiles.length - sessions.length;
  return { vaultDirName, sessions, scanned: sessions.length, failed };
}

/**
 * 搜索所有 projects 子目录，查找可能属于当前/指定 vault 的会话目录。
 * 当编码后的 vault 目录不存在时，尝试用 cwd 匹配所有子目录中的 .jsonl。
 */
export async function scanSessionsFallback(
  vaultPath: string,
  knownProjectPaths: string[],
): Promise<ScanSessionsResult> {
  const root = getSessionRootDir();
  const encoded = encodeVaultPath(vaultPath);
  const directDir = path.join(root, encoded);

  // 优先走精确目录
  const direct = await scanSessions(vaultPath, knownProjectPaths);

  // 如果精确目录命中且数据足够，直接返回
  if (direct.sessions.length >= 3) return direct;

  // 否则扫描所有 projects 子目录，按 cwd 字段过滤
  const allDirs = await fs.promises.readdir(root).catch(() => [] as string[]);
  const extra: typeof direct.sessions = [];
  let extraFailed = 0;

  for (const d of allDirs) {
    if (d === encoded) continue; // 已扫过
    const dirPath = path.join(root, d);
    try {
      const st = await fs.promises.stat(dirPath);
      if (!st.isDirectory()) continue;
    } catch { continue; }
    const files = await fs.promises.readdir(dirPath).catch(() => [] as string[]);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
    for (const f of jsonlFiles) {
      const filePath = path.join(dirPath, f);
      const raw = await parseSessionFile(filePath);
      if (!raw) { extraFailed++; continue; }
      if (!raw.cwd.includes(vaultPath)) continue; // 只保留 cwd 匹配当前 vault 的
      const projectRef = extractProjectRef(raw.textChunks, knownProjectPaths, raw.cwd, raw.aiTitle);
      // 来自其他目录的按 cwd 匹配 → 命令行
      const entrySource = '命令行';
      extra.push({
        sessionId: f.replace(/\.jsonl$/, ''),
        aiTitle: raw.aiTitle || raw.firstPrompt.slice(0, 40) || '(无标题)',
        firstPrompt: raw.firstPrompt,
        startTime: raw.startTime,
        lastTime: raw.lastTime,
        userTurns: raw.userTurns,
        toolCalls: raw.toolCalls,
        cwd: raw.cwd,
        projectRef,
        filePath,
        entrySource,
        skills: raw.skills,
      });
    }
  }

  const allSessions = [...direct.sessions, ...extra].sort(
    (a, b) => (b.lastTime || '').localeCompare(a.lastTime || ''),
  );
  return { vaultDirName: encoded, sessions: allSessions, scanned: allSessions.length, failed: direct.failed + extraFailed };
}

/**
 * 一次性扫描所有 projects 子目录下的所有会话（跨 vault 全量）。
 * 用于用户想看到所有历史会话，不限制当前 vault。
 * @param currentVaultPath 当前 vault 绝对路径，用于判断入口来源
 */
export async function scanAllSessions(
  knownProjectPaths: string[],
  currentVaultPath?: string,
): Promise<ScanSessionsResult> {
  const root = getSessionRootDir();
  const allDirs = await fs.promises.readdir(root).catch(() => [] as string[]);
  const sessions: SessionCard[] = [];
  let failed = 0;
  const currentEncoded = currentVaultPath ? encodeVaultPath(currentVaultPath) : '';

  for (const d of allDirs) {
    if (d === '_archived') continue; // 跳过存档目录
    const dirPath = path.join(root, d);
    try {
      const st = await fs.promises.stat(dirPath);
      if (!st.isDirectory()) continue;
    } catch { continue; }
    const files = await fs.promises.readdir(dirPath).catch(() => [] as string[]);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
    for (const f of jsonlFiles) {
      const filePath = path.join(dirPath, f);
      const raw = await parseSessionFile(filePath);
      if (!raw) { failed++; continue; }
      const projectRef = extractProjectRef(raw.textChunks, knownProjectPaths, raw.cwd, raw.aiTitle);
      // 入口来源：目录名匹配当前 vault 编码 → Obsidian，否则 → 命令行
      const entrySource = d === currentEncoded ? 'Obsidian' : '命令行';
      sessions.push({
        sessionId: f.replace(/\.jsonl$/, ''),
        aiTitle: raw.aiTitle || raw.firstPrompt.slice(0, 40) || '(无标题)',
        firstPrompt: raw.firstPrompt,
        startTime: raw.startTime,
        lastTime: raw.lastTime,
        userTurns: raw.userTurns,
        toolCalls: raw.toolCalls,
        cwd: raw.cwd,
        projectRef,
        filePath,
        entrySource,
        skills: raw.skills,
      });
    }
  }

  sessions.sort((a, b) => (b.lastTime || '').localeCompare(a.lastTime || ''));
  return { vaultDirName: '*all*', sessions, scanned: sessions.length, failed };
}

// ===== 存档功能 =====

/**
 * 将会话 .jsonl 文件复制到存档目录（不删除源文件）。
 * 存档文件名格式：<sessionId>_<YYYYMMDD>.jsonl
 */
export async function archiveSessionFile(
  filePath: string,
  archiveDir: string,
): Promise<{ success: boolean; archivedPath: string }> {
  try {
    // 确保存档目录存在
    fs.mkdirSync(archiveDir, { recursive: true });

    // 提取 sessionId
    const basename = path.basename(filePath).replace(/\.jsonl$/, '');
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const archivedName = `${basename}_${dateStr}.jsonl`;
    const archivedPath = path.join(archiveDir, archivedName);

    // 复制文件
    fs.copyFileSync(filePath, archivedPath);

    return { success: true, archivedPath };
  } catch (e: any) {
    return { success: false, archivedPath: e?.message || String(e) };
  }
}

/**
 * 扫描存档目录，返回已存档的 sessionId 集合。
 * 存档文件名格式：<sessionId>_<YYYYMMDD>.jsonl
 */
export async function getArchivedSessionIds(archiveDir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const entries = await fs.promises.readdir(archiveDir);
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      // 去掉 _YYYYMMDD.jsonl 后缀，提取原始 sessionId
      const match = f.match(/^(.+?)_\d{8}\.jsonl$/);
      if (match) {
        ids.add(match[1]);
      }
    }
  } catch {
    // 目录不存在时静默处理
  }
  return ids;
}
