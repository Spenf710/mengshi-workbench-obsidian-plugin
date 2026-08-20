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
import { scanSessions, parseSessionTurns, type SessionCard, type SessionDetail, type TurnBlock } from '../data/sessionScanner';
import { scanProjects, type ProjectInfo } from '../data/projectScanner';

// ===== 类型 =====
type SidebarTab = 'projects' | 'general';
type FilterKey = 'all' | 'today' | 'week' | 'none';

interface MenuGroup {
  root: string;
  projects: ProjectInfo[];
}

// ===== Markdown 轻量渲染（仅用户输入的安全文本） =====
function mdRender(text: string): string {
  if (!text) return '';
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- \[ \] /gm, '☐ ')
    .replace(/^- \[x\] /gim, '☑ ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, '<br>');
}

// ===== 轮次内容块 =====
function BlockView({ block }: { block: TurnBlock }) {
  const [open, setOpen] = useState(false);

  if (block.kind === 'text') {
    return <div className="mswb-turn-text" dangerouslySetInnerHTML={{ __html: mdRender(block.content) }} />;
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
        <span className="mswb-session-detail-meta">{detail.turns.length} 轮 · {timeLabel}</span>
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
        {detail.turns.map((turn, i) => (
          <div
            key={i}
            ref={(el) => { turnRefs.current[turn.lineIndex] = el; }}
            className={`mswb-turn mswb-turn-${turn.role}`}
          >
            <div className="mswb-turn-role">{turn.role === 'user' ? '🧑 用户' : '🤖 Claude'}</div>
            <div className="mswb-turn-blocks">
              {turn.blocks.map((b, j) => <BlockView key={j} block={b} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== 会话卡片 =====
function SessionCardView({ card, onOpen, onOpenInClaude }: { card: SessionCard; onOpen: (c: SessionCard) => void; onOpenInClaude: (c: SessionCard) => void }) {
  const timeLabel = useMemo(() => {
    if (!card.lastTime) return '';
    const d = new Date(card.lastTime);
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
    cwd: 'cwd',
    none: '未归类',
  };

  return (
    <div className="mswb-session-card">
      <div className="mswb-session-head" onClick={() => onOpen(card)}>
        <span className="mswb-session-title">{card.aiTitle}</span>
      </div>
      <div className="mswb-session-meta-row" onClick={() => onOpen(card)}>
        <span className="mswb-session-time">{timeLabel}</span>
        <span className="mswb-session-messages">{card.userTurns} 轮对话 · {card.apiCalls} 次调用</span>
      </div>
      <div className="mswb-session-sub">
        <span className={`mswb-session-badge source-${card.projectRef.source}`}>
          {sourceLabel[card.projectRef.source] || card.projectRef.source}
        </span>
        {card.projectRef.projectPath && (
          <span className="mswb-session-proj">{card.projectRef.projectPath}</span>
        )}
      </div>
      {card.firstPrompt && (
        <div className="mswb-session-prompt" onClick={() => onOpen(card)}>{card.firstPrompt}</div>
      )}
      <div className="mswb-session-actions">
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

  // 扫描会话
  const doScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vaultPath = (app.vault.adapter as any).getBasePath?.();
      if (!vaultPath || typeof vaultPath !== 'string') {
        setError('无法获取 vault 路径');
        setLoading(false);
        return;
      }
      const [projectList, result] = await Promise.all([
        scanProjects(app),
        scanSessions(vaultPath, (await scanProjects(app)).map((p) => p.folderPath)),
      ]);
      setProjects(projectList);
      setSessions(result.sessions);
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
      res.unref(); // 解除引用，父进程退出不影响子进程
      new Notice('正在打开 Claude Code…');
    } catch (e: any) {
      new Notice(`打开 Claude 失败：${e?.message || e}`);
    }
  }, []);

  // 项目分组
  const menuGroups = useMemo<MenuGroup[]>(() => {
    const roots = ['项目管理-系统', '项目管理-车型', '日常工作-通用'];
    return roots.map((root) => ({
      root,
      projects: projects.filter((p) => p.folderPath.startsWith(root + '/')),
    })).filter((g) => g.projects.length > 0);
  }, [projects]);

  // 右侧过滤
  const filteredSessions = useMemo(() => {
    let list = [...sessions];
    if (activeSidebarTab === 'projects') {
      if (selectedProject) {
        list = list.filter((s) => s.projectRef.projectPath === selectedProject);
      }
      if (selectedFilter === 'none') {
        list = list.filter((s) => s.projectRef.source === 'none');
      }
    } else {
      // 通用 Tab
      if (selectedFilter === 'today') {
        const today = new Date().toISOString().slice(0, 10);
        list = list.filter((s) => s.lastTime?.startsWith(today));
      } else if (selectedFilter === 'week') {
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        list = list.filter((s) => s.lastTime >= weekAgo);
      } else if (selectedFilter === 'none') {
        list = list.filter((s) => s.projectRef.source === 'none');
      }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) => s.aiTitle.toLowerCase().includes(q) || s.firstPrompt.toLowerCase().includes(q));
    }
    return list;
  }, [sessions, activeSidebarTab, selectedProject, selectedFilter, search]);

  // 当前标题
  const currentTitle = useMemo(() => {
    if (activeSidebarTab === 'projects') {
      if (selectedProject) return selectedProject.replace(/^[^/]+\//, '');
      if (selectedFilter === 'none') return '未归类会话';
      return '全部会话';
    }
    if (selectedFilter === 'today') return '今日会话';
    if (selectedFilter === 'week') return '本周会话';
    if (selectedFilter === 'none') return '未归类会话';
    return '全部会话';
  }, [activeSidebarTab, selectedProject, selectedFilter]);

  // 左侧菜单项渲染
  const projectCount = (path: string | null) => {
    if (!path) return sessions.filter((s) => s.projectRef.source === 'none').length;
    return sessions.filter((s) => s.projectRef.projectPath === path).length;
  };

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
        {filteredSessions.map((s) => (
          <SessionCardView key={s.sessionId} card={s} onOpen={openDetail} onOpenInClaude={openInClaude} />
        ))}
      </div>
    );
  };

  return (
    <div className="mswb-sessions">
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
                  {menuGroups.map((g) => (
                    <div key={g.root} className="mswb-sessions-menu-group">
                      <div className="mswb-sessions-menu-group-title">{g.root}</div>
                      {g.projects.map((p) => (
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
                  ))}

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
                  </div>
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
                      { key: 'today', icon: '', label: '今日' },
                      { key: 'week', icon: '📅', label: '本周' },
                      { key: 'none', icon: '🗂️', label: '未归类' },
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
