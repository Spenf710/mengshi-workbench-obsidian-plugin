/**
 * 会话面板 — 驾驶舱第 7 个 Tab（💬 会话）
 *
 * 布局：左侧菜单 + 右侧内容（仿飞书面板）
 *   - 左侧 Tab：项目 / 通用
 *   - 项目 Tab：按项目管理-系统/车型/日常工作-通用 分组的项目列表 + 全部/未归类
 *   - 通用 Tab：搜索 + 全部/今日/本周/未归类
 *   - 右侧：面包屑 + 会话卡片网格 + 详情视图
 */

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import { spawn } from 'child_process';
import { scanSessions, scanAllSessions, parseSessionTurns, archiveSessionFile, getArchivedSessionIds, type SessionCard, type SessionDetail, type TurnBlock } from '../data/sessionScanner';
import { scanProjects, type ProjectInfo } from '../data/projectScanner';
import { getSessionArchiveDir, getSessionTitleOverride, setSessionTitleOverride, getSessionProjectOverride, setSessionProjectOverride, getConfig } from '../data/settings';

// ===== 类型 =====
type SidebarTab = 'projects' | 'general';
type FilterKey = 'all' | 'daily' | 'today' | 'threeDays' | 'week' | 'archived' | 'turn5' | 'turn20' | 'turn20plus';

interface MenuGroup {
  root: string;
  projects: ProjectInfo[];
}

// ===== Markdown 完整渲染（支持代码块、表格、标题、列表等） =====
function mdRender(text: string): string {
  if (!text) return '';
  // 先 HTML 转义
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // 按行处理，逐行渲染
  const lines = esc.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeBuf: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块 ``` 开关
    if (/^```/.test(line)) {
      if (inCodeBlock) {
        out.push(`<pre><code${codeLang ? ` class="language-${codeLang}"` : ''}>${codeBuf.join('\n')}</code></pre>`);
        codeBuf = [];
        inCodeBlock = false;
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = line.replace(/^```/, '').trim();
      }
      continue;
    }
    if (inCodeBlock) { codeBuf.push(line); continue; }

    // 空行重置表格状态
    if (!line.trim()) { if (inTable) { inTable = false; } out.push(''); continue; }

    // 表格行：| 内容 | 内容 |
    if (/^\|.+\|$/.test(line.trim())) {
      if (!inTable) {
        inTable = true;
        out.push('<table>');
      }
      // 分隔行 |-|-| 跳过
      if (/^\|[\s\-:]+\|$/.test(line.trim())) continue;
      const cells = line.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      // 判断是否是表头（上一行是分隔行，或者第一行）
      const prevLine = i > 0 ? lines[i - 1] : '';
      const isHeader = inTable && prevLine.trim().startsWith('|') && /^\|[\s\-:]+\|$/.test(lines[i + 1]?.trim() || '');
      const tag = isHeader ? 'th' : 'td';
      out.push(`<tr>${cells.map((c) => `<${tag}>${inlineMd(c.trim())}</${tag}>`).join('')}</tr>`);
      continue;
    } else if (inTable) {
      inTable = false;
      out.push('</table>');
    }

    // 普通行：行内渲染，用 <p> 包裹
    if (line.trim()) {
      const rendered = inlineMd(line);
      if (/^<(h[1-6]|blockquote|hr)/.test(rendered)) {
        out.push(rendered);
      } else if (/^<li>/.test(rendered)) {
        // 收集连续的 <li>，包装为 <ul>
        const listItems = [rendered];
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (!nextLine) break;
          const nextRendered = inlineMd(lines[i + 1]);
          if (/^<li>/.test(nextRendered)) {
            listItems.push(nextRendered);
            i++;
          } else break;
        }
        out.push(`<ul>${listItems.join('')}</ul>`);
      } else {
        out.push(`<p>${rendered}</p>`);
      }
    }
  }

  // 关闭未闭合的代码块
  if (inCodeBlock) {
    out.push(`<pre><code${codeLang ? ` class="language-${codeLang}"` : ''}>${codeBuf.join('\n')}</code></pre>`);
  }
  if (inTable) out.push('</table>');

  return out.join('\n');
}

/** 行内 Markdown 渲染（单行，不含块级元素） */
function inlineMd(text: string): string {
  let s = text;

  // 标题 # ## ###
  s = s.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, content) => {
    const level = hashes.length;
    return `<h${level}>${content}</h${level}>`;
  });

  // 无序列表 - 或 *
  s = s.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li>$1</li>');
  // 有序列表 1. 2.
  s = s.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li>$1</li>');

  // 引用 >
  s = s.replace(/^&gt;\s*(.*)$/gm, '<blockquote>$1</blockquote>');

  // 分隔线 ---
  if (/^-{3,}$/.test(s.trim())) s = '<hr>';

  // 复选框
  s = s.replace(/^- \[ \] /gm, '☐ ');
  s = s.replace(/^- \[x\] /gim, '☑ ');

  // 链接 [text](url) — 协议白名单：仅 https/http/mailto 渲染为可点击链接，其余降级为纯文本防注入
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
    const href = (u as string).trim();
    if (/^(https?:\/\/|mailto:)/i.test(href)) {
      return `<a href="${href}" target="_blank" rel="noopener">${t}</a>`;
    }
    return `${t}（${href}）`; // 非白名单协议 → 纯文本
  });

  // 粗体 + 斜体 ***
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // 粗体 **
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // 斜体 *
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 行内代码 `
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  return s;
}

// ===== 轮次内容块 =====
function BlockView({ block, isAssistant }: { block: TurnBlock; isAssistant?: boolean }) {
  const [open, setOpen] = useState(false);

  if (block.kind === 'text') {
    return <div className={`mswb-turn-text${isAssistant ? ' mswb-turn-text-final' : ''}`} dangerouslySetInnerHTML={{ __html: mdRender(block.content) }} />;
  }
  if (block.kind === 'thinking') {
    return (
      <div className="mswb-turn-block mswb-turn-thinking">
        <div className="mswb-turn-block-head" onClick={() => setOpen((v) => !v)}>
          <span>{open ? '▾' : '▸'} 思考</span>
        </div>
        {open && <div className="mswb-turn-block-body">{block.content}</div>}
      </div>
    );
  }
  if (block.kind === 'tool_use') {
    return (
      <div className="mswb-turn-block mswb-turn-tool">
        <div className="mswb-turn-block-head" onClick={() => setOpen((v) => !v)}>
          <span>{open ? '▾' : '▸'} {block.label}</span>
        </div>
        {open && <div className="mswb-turn-block-body"><pre>{block.content}</pre></div>}
      </div>
    );
  }
  if (block.kind === 'tool_result') {
    const preview = block.content.replace(/\s+/g, ' ').slice(0, 80);
    return (
      <div className="mswb-turn-block mswb-turn-result">
        <div className="mswb-turn-block-head" onClick={() => setOpen((v) => !v)}>
          <span>{open ? '▾' : '▸'} 📤 工具结果 {preview ? `· ${preview}${block.content.length > 80 ? '…' : ''}` : ''}</span>
        </div>
        {open && <div className="mswb-turn-block-body"><pre>{block.content}</pre></div>}
      </div>
    );
  }
  return null;
}

// ===== 会话详情视图 =====
function SessionDetailView({ detail, onBack, onOpenInClaude }: { detail: SessionDetail; onBack: () => void; onOpenInClaude: (sessionId: string) => void }) {
  const timeLabel = useMemo(() => {
    const fmt = (iso: string) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    return `${fmt(detail.startTime)} ~ ${fmt(detail.lastTime)}`;
  }, [detail]);

  const turnRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const scrollToTurn = (lineIndex: number) => {
    const el = turnRefs.current[lineIndex];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('mswb-turn-highlight');
      setTimeout(() => el.classList.remove('mswb-turn-highlight'), 2000);
    }
  };

  return (
    <div className="mswb-session-detail">
      <div className="mswb-session-detail-bar">
        <button className="mswb-session-back" onClick={onBack}>← 返回列表</button>
        <span className="mswb-session-detail-title">{detail.aiTitle}</span>
        <button
          className="mswb-session-back"
          onClick={() => onOpenInClaude(detail.sessionId)}
          title="在 Claude Code 中打开此会话"
        >
          在 Claude 中打开
        </button>
        <span className="mswb-session-detail-meta">{detail.userPrompts.length} 轮提问 · {detail.turns.length} 条消息 · {timeLabel}</span>
      </div>

      {detail.userPrompts.length > 0 && (
        <div className="mswb-session-jumps">
          <span className="mswb-session-jumps-label">🧩 我的提问：</span>
          {detail.userPrompts.map((p, i) => (
            <button key={i} className="mswb-session-jump-chip" onClick={() => scrollToTurn(p.lineIndex)} title={p.text}>
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="mswb-session-detail-turns">
        {detail.turns.map((turn, i) => {
          // 每个 assistant 轮次都是该轮对话的最终输出
          const isFinalOutput = turn.role === 'assistant';
          return (
          <div
            key={i}
            ref={(el) => { turnRefs.current[turn.lineIndex] = el; }}
            className={`mswb-turn mswb-turn-${turn.role}`}
          >
            <div className="mswb-turn-role">{turn.role === 'user' ? '🧑 用户' : turn.role === 'tool' ? '⚙ 系统' : '🤖 Claude'}</div>
            <div className="mswb-turn-blocks">
              {turn.blocks.map((b, j) => <BlockView key={j} block={b} isAssistant={turn.role === 'assistant'} />)}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== 会话卡片 =====
function SessionCardView({ card, archived, titleOverride, effectiveProjectPath, onOpen, onOpenInClaude, onArchive, onTitleChange, onMoveClick }: { card: SessionCard; archived: boolean; titleOverride: string | null; effectiveProjectPath: string | null; onOpen: (c: SessionCard) => void; onOpenInClaude: (c: SessionCard) => void; onArchive: (c: SessionCard) => void; onTitleChange: (sessionId: string, title: string) => void; onMoveClick: (c: SessionCard) => void }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const displayTitle = titleOverride || card.aiTitle;

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setTitleDraft(displayTitle);
    setEditingTitle(true);
    setTimeout(() => inputRef.current?.select(), 50);
  }, [displayTitle]);

  const saveTitle = useCallback(() => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft.trim() !== displayTitle) {
      onTitleChange(card.sessionId, titleDraft.trim());
    }
  }, [titleDraft, displayTitle, card.sessionId, onTitleChange]);

  // 点击外部关闭移动菜单（模态框自带 overlay 点击关闭，此处无需额外处理）

  const timeLabel = useMemo(() => {
    if (!card.startTime) return '';
    const d = new Date(card.startTime);
    if (isNaN(d.getTime())) return card.lastTime;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  }, [card.lastTime]);

  const sourceLabel: Record<string, string> = {
    'at-ref': '@引用',
    wikilink: '[[链接]]',
    cwd: '工作目录',
    none: '未归类',
  };

  const entryLabel: Record<string, string> = {
    Obsidian: 'Obsidian',
    '命令行': '命令行',
  };

  // 项目归属标签（取项目名，不含路径，跟随 override）
  const projectLabel = useMemo(() => {
    if (!effectiveProjectPath) return null;
    if (effectiveProjectPath === '__daily__') return '日常';
    const segments = effectiveProjectPath.split('/');
    const folderName = segments[segments.length - 1];
    return folderName.replace(/^\d+\.\s*/, '');
  }, [effectiveProjectPath]);

  return (
    <div className={`mswb-session-card${archived ? ' archived' : ''}`}>
      <div className="mswb-session-head" onClick={(e) => { if (!editingTitle) onOpen(card); }}>
        {editingTitle ? (
          <input
            ref={inputRef}
            className="mswb-session-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            onBlur={saveTitle}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="mswb-session-title">
            {displayTitle}
            <button className="mswb-session-icon-btn" onClick={startEdit} title="编辑标题">✏️</button>
          </span>
        )}
        <span className="mswb-session-head-actions">
          <button className="mswb-session-icon-btn" onClick={(e) => { e.stopPropagation(); onMoveClick(card); }} title="移动项目">📂</button>
          {!archived && (
            <button className="mswb-session-icon-btn" onClick={(e) => { e.stopPropagation(); onArchive(card); }} title="存档">📦</button>
          )}
          {archived && <span className="mswb-session-archived-badge">📦</span>}
        </span>
      </div>
      <div className="mswb-session-meta-row" onClick={() => onOpen(card)}>
        <span className="mswb-session-time">{timeLabel}</span>
        <span className="mswb-session-messages">{card.userTurns} 轮提问 · {card.toolCalls} 次工具调用</span>
      </div>
      <div className="mswb-session-sub">
        <span className={`mswb-session-badge source-${card.projectRef.source}`}>
          {sourceLabel[card.projectRef.source] || card.projectRef.source}
        </span>
        <span className={`mswb-session-badge entry-${card.entrySource === 'Obsidian' ? 'obsidian' : 'cmd'}`}>
          {entryLabel[card.entrySource] || card.entrySource}
        </span>
        {projectLabel && (
          <span className="mswb-session-badge mswb-session-badge-project">{projectLabel}</span>
        )}
      </div>
      {card.firstPrompt && (
        <div className="mswb-session-prompt" onClick={() => onOpen(card)}>{card.firstPrompt}</div>
      )}
      <div className="mswb-session-actions" style={{ position: 'relative' }}>
        <button className="mswb-session-action-btn" onClick={(e) => { e.stopPropagation(); onOpen(card); }}>查看详情</button>
        <button className="mswb-session-action-btn" onClick={(e) => { e.stopPropagation(); onOpenInClaude(card); }}>在 Claude 中打开</button>
      </div>
    </div>
  );
}

// ===== 主面板 =====
export function SessionsPanel({ app }: { app: App }) {
  const [sessions, setSessions] = useState<SessionCard[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('projects');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});
  const [sessionProjectOverrides, setSessionProjectOverrides] = useState<Record<string, string | null>>({});
  const [moveTarget, setMoveTarget] = useState<SessionCard | null>(null);

  // 扫描会话
  const doScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const projectList = await scanProjects(app);
      const knownPaths = projectList.map((p) => p.folderPath);
      const vaultPath = (app.vault.adapter as any).getBasePath?.();
      // 全量扫描：所有 projects 目录下的会话，不限入口
      const [result, archIds] = await Promise.all([
        scanAllSessions(knownPaths, vaultPath),
        getArchivedSessionIds(getSessionArchiveDir()),
      ]);
      setProjects(projectList);
      setSessions(result.sessions);
      setArchivedIds(archIds);
      // 加载标题覆盖
      const overrides: Record<string, string> = {};
      const projOverrides: Record<string, string | null> = {};
      for (const s of result.sessions) {
        const ov = getSessionTitleOverride(s.sessionId);
        if (ov) overrides[s.sessionId] = ov;
        const po = getSessionProjectOverride(s.sessionId);
        if (po !== undefined) projOverrides[s.sessionId] = po;
      }
      setTitleOverrides(overrides);
      setSessionProjectOverrides(projOverrides);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [app]);

  useEffect(() => { doScan(); }, [doScan]);

  // 详情
  const openDetail = useCallback(async (card: SessionCard) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const d = await parseSessionTurns(card.filePath);
      if (!d) { setDetailError('读取会话失败'); setDetailLoading(false); return; }
      d.sessionId = card.sessionId;
      if (!d.aiTitle) d.aiTitle = card.aiTitle;
      setDetail(d);
    } catch (e: any) {
      setDetailError(e?.message || String(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openInClaude = useCallback((card: SessionCard | string) => {
    const sessionId = typeof card === 'string' ? card : card.sessionId;
    const cwd = typeof card === 'string' ? '' : card.cwd;
    try {
      // 用 spawn 以 detached 模式启动 claude，完全与 Obsidian 进程解耦
      // detached: true 让子进程独立运行，不附加到父进程
      // stdio: 'ignore' 不监听 stdin/stdout/stderr，避免任何管道错误
      // shell: true Windows 上需要来执行 .cmd 批处理文件
      // windowsHide: false 让终端窗口可见
      const res = spawn('claude', ['--resume', sessionId], {
        detached: true,
        stdio: 'ignore',
        shell: true,
        windowsHide: false,
        cwd: cwd || undefined,
      });
      // 监听 error：CLI 不存在/spawn 失败时防止 uncaughtException 崩溃
      res.on('error', (err: any) => {
        if (err?.code === 'ENOENT') {
          new Notice('未找到 claude 命令，请安装 Claude Code 或检查 PATH');
        } else {
          new Notice(`打开 Claude 失败：${err?.message || err}`);
        }
      });
      res.unref(); // 解除引用，父进程退出不影响子进程
      new Notice('正在打开 Claude Code…');
    } catch (e: any) {
      new Notice(`打开 Claude 失败：${e?.message || e}`);
    }
  }, []);

  // 存档
  const handleArchive = useCallback(async (card: SessionCard) => {
    const archiveDir = getSessionArchiveDir();
    const result = await archiveSessionFile(card.filePath, archiveDir);
    if (result.success) {
      new Notice(`✅ 已存档：${card.aiTitle}`);
      // 更新存档集合
      setArchivedIds((prev) => new Set(prev).add(card.sessionId));
    } else {
      new Notice(`❌ 存档失败：${result.archivedPath}`);
    }
  }, []);

  // 标题修改
  const handleTitleChange = useCallback(async (sessionId: string, title: string) => {
    await setSessionTitleOverride(sessionId, title);
    setTitleOverrides((prev) => ({ ...prev, [sessionId]: title }));
  }, []);

  // 左侧菜单项渲染
  const projectCount = useCallback((path: string | null) => {
    if (!path) return sessions.filter((s) => {
      const ov = sessionProjectOverrides?.[s.sessionId];
      const effective = ov !== undefined ? ov : s.projectRef.projectPath;
      return effective === null;
    }).length;
    return sessions.filter((s) => {
      const ov = sessionProjectOverrides?.[s.sessionId];
      const effective = ov !== undefined ? ov : s.projectRef.projectPath;
      return effective === path;
    }).length;
  }, [sessions, sessionProjectOverrides]);

  // 折叠切换
  const toggleGroup = useCallback((root: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });
  }, []);

  // 移动项目
  const handleMoveProject = useCallback(async (sessionId: string, projectPath: string | null) => {
    await setSessionProjectOverride(sessionId, projectPath);
    setMoveTarget(null);
    doScan();
  }, [doScan]);

  // 打开移动对话框
  const openMoveDialog = useCallback((card: SessionCard) => {
    setMoveTarget(card);
  }, []);

  // 项目分组（按会话数量降序排列）— 根目录来自配置，不硬编码
  const menuGroups = useMemo<MenuGroup[]>(() => {
    const roots = getConfig().projectRoots.length > 0 ? getConfig().projectRoots : [];
    return roots.map((root) => ({
      root,
      projects: projects
        .filter((p) => p.folderPath.startsWith(root + '/'))
        .sort((a, b) => projectCount(b.folderPath) - projectCount(a.folderPath)),
    })).filter((g) => g.projects.length > 0);
  }, [projects]);

  // 右侧过滤
  const filteredSessions = useMemo(() => {
    let list = [...sessions];
    // 用 override 覆盖 projectRef（如果存在）
    if (activeSidebarTab === 'projects') {
      const effectiveProject = (s: SessionCard) => {
        const ov = sessionProjectOverrides?.[s.sessionId];
        if (ov === '__daily__') return '__daily__';
        return ov !== undefined ? ov : s.projectRef.projectPath;
      };
      if (selectedProject) {
        list = list.filter((s) => effectiveProject(s) === selectedProject);
      } else if (selectedFilter === 'none') {
        list = list.filter((s) => effectiveProject(s) === null);
      } else if (selectedFilter === 'archived') {
        list = list.filter((s) => archivedIds.has(s.sessionId));
      } else if (selectedFilter === 'daily') {
        // 日常：手动标记为 __daily__ 的会话
        list = list.filter((s) => sessionProjectOverrides?.[s.sessionId] === '__daily__');
      }
    } else {
      // 通用 Tab（全部按本地时区判断，避免 toISOString() 的 UTC 偏移导致早 8 点前「今日」少会话）
      const parseTs = (iso: string | undefined): number => (iso ? new Date(iso).getTime() : NaN);
      const localMidnightDaysAgo = (daysAgo: number): number => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - daysAgo);
        return d.getTime();
      };
      if (selectedFilter === 'today') {
        const now = new Date();
        list = list.filter((s) => {
          const t = parseTs(s.lastTime);
          if (isNaN(t)) return false;
          const d = new Date(t);
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
        });
      } else if (selectedFilter === 'threeDays') {
        const cutoff = localMidnightDaysAgo(2); // 今天 + 前两天
        list = list.filter((s) => {
          const t = parseTs(s.lastTime);
          return !isNaN(t) && t >= cutoff;
        });
      } else if (selectedFilter === 'week') {
        const cutoff = localMidnightDaysAgo(7); // 滚动 7 天
        list = list.filter((s) => {
          const t = parseTs(s.lastTime);
          return !isNaN(t) && t >= cutoff;
        });
      } else if (selectedFilter === 'turn5') {
        list = list.filter((s) => s.userTurns <= 5);
      } else if (selectedFilter === 'turn20') {
        list = list.filter((s) => s.userTurns > 5 && s.userTurns <= 20);
      } else if (selectedFilter === 'turn20plus') {
        list = list.filter((s) => s.userTurns > 20);
      }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) => (titleOverrides[s.sessionId] || s.aiTitle).toLowerCase().includes(q) || s.firstPrompt.toLowerCase().includes(q));
    }
    return list;
  }, [sessions, activeSidebarTab, selectedProject, selectedFilter, search, archivedIds, titleOverrides]);

  // 当前标题
  const currentTitle = useMemo(() => {
    if (activeSidebarTab === 'projects') {
      if (selectedProject) return selectedProject.replace(/^[^/]+\//, '');
      if (selectedFilter === 'none') return '未归类会话';
      if (selectedFilter === 'daily') return '日常会话';
      if (selectedFilter === 'archived') return '已存档';
      return '全部会话';
    }
    if (selectedFilter === 'today') return '今日会话';
    if (selectedFilter === 'threeDays') return '近三日会话';
    if (selectedFilter === 'week') return '本周会话';
    if (selectedFilter === 'turn5') return '≤5 轮提问';
    if (selectedFilter === 'turn20') return '≤20 轮提问';
    if (selectedFilter === 'turn20plus') return '20+ 轮提问';
    return '全部会话';
  }, [activeSidebarTab, selectedProject, selectedFilter]);

  const archivedCount = useMemo(() => sessions.filter((s) => archivedIds.has(s.sessionId)).length, [sessions, archivedIds]);

  // 加载/空/错误占位
  const renderMain = () => {
    if (loading && sessions.length === 0) {
      return <div className="mswb-sessions-empty">扫描会话中…</div>;
    }
    if (error) {
      return (
        <div className="mswb-sessions-empty">
          <div style={{ fontSize: 32 }}>⚠️</div>
          <p>扫描失败：{error}</p>
          <button className="mswb-sessions-refresh-btn" onClick={doScan}>重试</button>
        </div>
      );
    }
    if (sessions.length === 0) {
      return (
        <div className="mswb-sessions-empty">
          <div style={{ fontSize: 32 }}>💬</div>
          <p>未发现 Claude 会话</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>检查设置页「Claude 会话目录」配置</p>
          <button className="mswb-sessions-refresh-btn" onClick={doScan}>🔄 重新扫描</button>
        </div>
      );
    }
    if (filteredSessions.length === 0) {
      return <div className="mswb-sessions-empty">没有符合条件的会话</div>;
    }
    return (
      <div className="mswb-sessions-grid">
        {filteredSessions.map((s) => {
            const ov = sessionProjectOverrides?.[s.sessionId];
            const ep = ov !== undefined ? ov : s.projectRef.projectPath;
            return (
              <SessionCardView key={s.sessionId} card={s} archived={archivedIds.has(s.sessionId)} titleOverride={titleOverrides[s.sessionId] ?? null} effectiveProjectPath={ep} onOpen={openDetail} onOpenInClaude={openInClaude} onArchive={handleArchive} onTitleChange={handleTitleChange} onMoveClick={openMoveDialog} />
            );
          })}
      </div>
    );
  };

  return (
    <div className="mswb-sessions">
      {/* 移动项目模态框（在顶层渲染，避免嵌套问题） */}
      {moveTarget && (
        <div className="mswb-session-modal-overlay" onClick={() => setMoveTarget(null)}>
          <div className="mswb-session-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mswb-session-modal-title">移动到项目</div>
            <div className="mswb-session-modal-body">
              <div className="mswb-session-move-item" onClick={() => { handleMoveProject(moveTarget.sessionId, null); }}>
                🗂️ 不归属
              </div>
              <div className="mswb-session-move-item" onClick={() => { handleMoveProject(moveTarget.sessionId, '__daily__'); }}>
                📔 日常
              </div>
              {projects.map((p) => (
                <div
                  key={p.folderPath}
                  className="mswb-session-move-item"
                  onClick={() => { handleMoveProject(moveTarget.sessionId, p.folderPath); }}
                >
                  {p.emoji || '📁'} {p.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 详情视图优先 */}
      {detail ? (
        <SessionDetailView detail={detail} onBack={() => setDetail(null)} onOpenInClaude={openInClaude} />
      ) : detailLoading ? (
        <div className="mswb-sessions-empty">读取会话内容…</div>
      ) : detailError ? (
        <div className="mswb-sessions-empty">
          <div style={{ fontSize: 32 }}>⚠️</div>
          <p>{detailError}</p>
          <button className="mswb-sessions-refresh-btn" onClick={() => setDetailError(null)}>返回</button>
        </div>
      ) : (
        <>
          {/* 顶部栏 */}
          <div className="mswb-sessions-header">
            <span className="mswb-sessions-title">💬 会话</span>
            <button className="mswb-sessions-refresh-btn" onClick={doScan} disabled={loading}>
              {loading ? '扫描中…' : '🔄 刷新'}
            </button>
          </div>

          {/* 主体 */}
          <div className="mswb-sessions-body">
            {/* 左侧边栏 */}
            <div className="mswb-sessions-sidebar">
              {/* Tab 切换 */}
              <div className="mswb-sessions-tabs">
                <button
                  className={activeSidebarTab === 'projects' ? 'active' : ''}
                  onClick={() => { setActiveSidebarTab('projects'); setSelectedFilter('all'); setSelectedProject(null); }}
                >项目</button>
                <button
                  className={activeSidebarTab === 'general' ? 'active' : ''}
                  onClick={() => { setActiveSidebarTab('general'); setSelectedFilter('all'); setSelectedProject(null); }}
                >通用</button>
              </div>

              {/* 项目 Tab */}
              {activeSidebarTab === 'projects' && (
                <div className="mswb-sessions-menu">
                  {/* 顶部固定项：全部 / 未归类 / 已存档 */}
                  <div className="mswb-sessions-menu-group">
                    <div className="mswb-sessions-menu-item mswb-sessions-menu-all" onClick={() => { setSelectedProject(null); setSelectedFilter('all'); }}>
                      <span className="mswb-sessions-menu-icon">📆</span>
                      <span className="mswb-sessions-menu-name">全部</span>
                      <span className="mswb-sessions-menu-count">{sessions.length}</span>
                    </div>
                    <div className="mswb-sessions-menu-item" onClick={() => { setSelectedProject(null); setSelectedFilter('none'); }}>
                      <span className="mswb-sessions-menu-icon">🗂️</span>
                      <span className="mswb-sessions-menu-name">未归类</span>
                      <span className="mswb-sessions-menu-count">{projectCount(null)}</span>
                    </div>
                    <div className="mswb-sessions-menu-item" onClick={() => { setSelectedProject(null); setSelectedFilter('daily'); }}>
                      <span className="mswb-sessions-menu-icon">📔</span>
                      <span className="mswb-sessions-menu-name">日常</span>
                      <span className="mswb-sessions-menu-count">{sessions.filter((s) => sessionProjectOverrides?.[s.sessionId] === '__daily__').length}</span>
                    </div>
                    <div className="mswb-sessions-menu-item" onClick={() => { setSelectedProject(null); setSelectedFilter('archived'); }}>
                      <span className="mswb-sessions-menu-icon">📦</span>
                      <span className="mswb-sessions-menu-name">已存档</span>
                      <span className="mswb-sessions-menu-count">{archivedCount}</span>
                    </div>
                  </div>

                  {/* 项目分组（可折叠） */}
                  {menuGroups.map((g) => {
                    const isCollapsed = collapsedGroups.has(g.root);
                    return (
                      <div key={g.root} className="mswb-sessions-menu-group">
                        <div
                          className="mswb-sessions-menu-group-title mswb-sessions-group-collapsible"
                          onClick={() => toggleGroup(g.root)}
                        >
                          <span className="mswb-sessions-group-arrow">{isCollapsed ? '▸' : '▾'}</span>
                          {g.root}
                        </div>
                        {!isCollapsed && g.projects.map((p) => (
                          <div
                            key={p.folderPath}
                            className={`mswb-sessions-menu-item ${selectedProject === p.folderPath ? 'active' : ''}`}
                            onClick={() => { setSelectedProject(p.folderPath); setSelectedFilter('all'); }}
                          >
                            <span className="mswb-sessions-menu-icon">{p.emoji || '📁'}</span>
                            <span className="mswb-sessions-menu-name">{p.name}</span>
                            <span className="mswb-sessions-menu-count">{projectCount(p.folderPath)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 通用 Tab */}
              {activeSidebarTab === 'general' && (
                <div className="mswb-sessions-menu">
                  <div className="mswb-sessions-search">
                    <input
                      type="text"
                      placeholder="搜索会话…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="mswb-sessions-menu-group">
                    {[
                      { key: 'all', icon: '📆', label: '全部' },
                      { key: 'today', icon: '📅', label: '今日' },
                      { key: 'threeDays', icon: '📅', label: '近三日' },
                      { key: 'week', icon: '📅', label: '本周' },
                      { key: 'turn5', icon: '🔄', label: '≤5 轮' },
                      { key: 'turn20', icon: '🔄', label: '≤20 轮' },
                      { key: 'turn20plus', icon: '🔄', label: '20+ 轮' },
                    ].map((item) => (
                      <div
                        key={item.key}
                        className={`mswb-sessions-menu-item ${selectedFilter === (item.key as FilterKey) && !search ? 'active' : ''}`}
                        onClick={() => { setSelectedFilter(item.key as FilterKey); setSelectedProject(null); }}
                      >
                        <span className="mswb-sessions-menu-icon">{item.icon}</span>
                        <span className="mswb-sessions-menu-name">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 右侧内容 */}
            <div className="mswb-sessions-main">
              <div className="mswb-sessions-breadcrumb">
                <span>会话</span>
                <span className="mswb-sessions-breadcrumb-sep">/</span>
                <span>{activeSidebarTab === 'projects' ? '项目' : '通用'}</span>
                {selectedProject && (
                  <>
                    <span className="mswb-sessions-breadcrumb-sep">/</span>
                    <span>{selectedProject.replace(/^[^/]+\//, '')}</span>
                  </>
                )}
                {selectedFilter !== 'all' && !selectedProject && (
                  <>
                    <span className="mswb-sessions-breadcrumb-sep">/</span>
                    <span>{currentTitle}</span>
                  </>
                )}
                <span className="mswb-sessions-count">（{filteredSessions.length} 个）</span>
              </div>
              {renderMain()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
