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
  /** 用户提问轮次数 */
  userTurns: number;
  /** API / 工具调用次数（assistant + tool_use + tool_result） */
  apiCalls: number;
  /** 工作目录 */
  cwd: string;
  /** 项目归属（三线索交叉） */
  projectRef: ProjectRef;
  /** .jsonl 文件绝对路径 */
  filePath: string;
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
): ProjectRef {
  const joined = textChunks.join('\n');

  // 线索1：@文件引用 — 形如 @项目管理-系统/8.xxx/ 或 @项目管理-系统/8.xxx/file.md
  const atRefs = [...joined.matchAll(/@([^\s,，()（）]+[^\s,，()（）.]*\.?(?:md)?)/g)].map((m) => m[1]);
  for (const ref of atRefs) {
    const hit = knownProjectPaths.find((p) => ref.startsWith(p) || ref.startsWith(p + '/'));
    if (hit) return { projectPath: hit, source: 'at-ref', evidence: `@${ref}` };
  }

  // 线索2：[[链接]] — 链接目标可能含项目路径，或在 knownProjectPaths 下
  const wiki = [...joined.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split('|')[0]);
  for (const link of wiki) {
    const hit = knownProjectPaths.find((p) => link.startsWith(p) || link.startsWith(p + '/'));
    if (hit) return { projectPath: hit, source: 'wikilink', evidence: `[[${link}]]` };
  }

  // 线索3：cwd 兜底 — 非空但无法精确到项目，标 cwd 命中但 projectPath=null
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
  apiCalls: number;
  cwd: string;
  textChunks: string[];
}

/** 流式按行解析单个 .jsonl，抽元信息 + 文本块（供项目归属分析） */
export async function parseSessionFile(filePath: string): Promise<SessionRaw | null> {
  return new Promise((resolve) => {
    let aiTitle = '';
    let firstPrompt = '';
    let startTime = '';
    let lastTime = '';
    let userTurns = 0;
    let apiCalls = 0;
    let cwd = '';
    let firstUserFound = false;
    const textChunks: string[] = [];

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
        if (t === 'user') {
          userTurns++;
          const text = extractText(obj.message?.content);
          if (text) {
            textChunks.push(text);
            if (!firstUserFound) {
              firstPrompt = text.slice(0, 200);
              firstUserFound = true;
            }
          }
        } else if (t === 'assistant') {
          // assistant 行包含文本/思考/工具调用/工具结果；每条 assistant 消息计为一次 API 调用
          apiCalls++;
          const text = extractText(obj.message?.content);
          if (text) textChunks.push(text);
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
      resolve({ aiTitle, firstPrompt, startTime, lastTime, userTurns, apiCalls, cwd, textChunks });
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
  role: 'user' | 'assistant';
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
          // 仅当一行完全无实质块（如空 content）时跳过
          if (blocks.length) {
            turns.push({ role: t, blocks, timestamp: ts || '', lineIndex: currentLine });
            const textBlock = blocks.find((b) => b.kind === 'text');
            if (textBlock) {
              userPrompts.push({ lineIndex: currentLine, text: textBlock.content.slice(0, 100) });
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
      const projectRef = extractProjectRef(raw.textChunks, knownProjectPaths, raw.cwd);
      const card: SessionCard = {
        sessionId,
        aiTitle: raw.aiTitle || raw.firstPrompt.slice(0, 40) || '(无标题)',
        firstPrompt: raw.firstPrompt,
        startTime: raw.startTime,
        lastTime: raw.lastTime,
        userTurns: raw.userTurns,
        apiCalls: raw.apiCalls,
        cwd: raw.cwd,
        projectRef,
        filePath,
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
      const projectRef = extractProjectRef(raw.textChunks, knownProjectPaths, raw.cwd);
      extra.push({
        sessionId: f.replace(/\.jsonl$/, ''),
        aiTitle: raw.aiTitle || raw.firstPrompt.slice(0, 40) || '(无标题)',
        firstPrompt: raw.firstPrompt,
        startTime: raw.startTime,
        lastTime: raw.lastTime,
        userTurns: raw.userTurns,
        apiCalls: raw.apiCalls,
        cwd: raw.cwd,
        projectRef,
        filePath,
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
 */
export async function scanAllSessions(
  knownProjectPaths: string[],
): Promise<ScanSessionsResult> {
  const root = getSessionRootDir();
  const allDirs = await fs.promises.readdir(root).catch(() => [] as string[]);
  const sessions: SessionCard[] = [];
  let failed = 0;

  for (const d of allDirs) {
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
      const projectRef = extractProjectRef(raw.textChunks, knownProjectPaths, raw.cwd);
      sessions.push({
        sessionId: f.replace(/\.jsonl$/, ''),
        aiTitle: raw.aiTitle || raw.firstPrompt.slice(0, 40) || '(无标题)',
        firstPrompt: raw.firstPrompt,
        startTime: raw.startTime,
        lastTime: raw.lastTime,
        userTurns: raw.userTurns,
        apiCalls: raw.apiCalls,
        cwd: raw.cwd,
        projectRef,
        filePath,
      });
    }
  }

  sessions.sort((a, b) => (b.lastTime || '').localeCompare(a.lastTime || ''));
  return { vaultDirName: '*all*', sessions, scanned: sessions.length, failed };
}
