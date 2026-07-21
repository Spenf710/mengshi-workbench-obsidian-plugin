import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { type App, TFile } from 'obsidian';
import {
  scanKnowledgeNotes,
  pickCollisionPair,
  findMissingLinks,
  findSeeds,
  detectEmergentTopics,
  generateMocDraft,
  timeAgo,
  type NoteNode,
  type CollisionPair,
  type MissingLink,
  type SeedNote,
  type TopicCluster,
} from '../data/growthScanner';
import {
  getGrowthHistory,
  addCollisionRecord,
  addIgnoredSuggestion,
  addGeneratedMoc,
  getGrowthConfig,
  getSummary,
  saveSummary,
  isLlmConfigured,
  getGrowthDirections,
  saveGrowthDirections,
  type GrowthHistory,
} from '../data/settings';
import { summarizeNote, generateCollisionQuestion, judgeRelevance, analyzeSeed, type GrowthDirection } from '../data/llmService';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter } from 'd3-force';

// ===== 类型 =====
type SubTab = 'collision' | 'missingLinks' | 'regrowth' | 'structure';

const SUB_TABS: { key: SubTab; label: string; icon: string }[] = [
  { key: 'collision', label: '碰撞', icon: '💥' },
  { key: 'missingLinks', label: '链接建议', icon: '🔗' },
  { key: 'regrowth', label: '再生长', icon: '🌿' },
  { key: 'structure', label: '结构涌现', icon: '🗺️' },
];

// ===== 入口 =====
export function GrowthPanel({ app }: { app: App }) {
  const [nodes, setNodes] = useState<NoteNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<SubTab>('collision');
  const [history, setHistory] = useState<GrowthHistory>(getGrowthHistory());
  const [refreshKey, setRefreshKey] = useState(0);

  // 加载知识笔记
  useEffect(() => {
    scanKnowledgeNotes(app).then((data) => {
      setNodes(data);
      setLoading(false);
    });
  }, [app, refreshKey]);

  // 仪表盘数据
  const stats = useMemo(() => {
    const totalLinks = nodes.reduce((s, n) => s + n.outLinks.length, 0);
    const orphanNodes = nodes.filter((n) => n.backLinks.length === 0 && n.outLinks.length === 0);
    const thisWeek = (history.collisions ?? []).filter((c) => {
      const d = new Date(c.date);
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      return d >= weekAgo;
    });
    const collisionsThisWeek = thisWeek.filter((c) => c.action === 'linked' || c.action === 'new_note').length;
    const regrowthsThisWeek = (history.regrowths ?? []).filter((r) => {
      const d = new Date(r.date);
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      return d >= weekAgo;
    }).length;

    return {
      totalKnowledge: nodes.length,
      linkDensity: nodes.length > 0 ? (totalLinks / nodes.length).toFixed(1) : '0',
      orphanCount: orphanNodes.length,
      collisionsThisWeek,
      regrowthsThisWeek,
    };
  }, [nodes, history]);

  const refresh = () => {
    setHistory(getGrowthHistory());
    setRefreshKey((k) => k + 1);
  };

  if (loading) {
    return (
      <div className="mswb-placeholder">
        <div className="mswb-placeholder-icon">🌱</div>
        <p>扫描知识笔记中...</p>
      </div>
    );
  }

  if (nodes.length < 15) {
    return (
      <div className="mswb-placeholder">
        <div className="mswb-placeholder-icon">🌱</div>
        <p>知识花园还小</p>
        <p style={{ fontSize: '0.85em', opacity: 0.6, marginTop: 8 }}>
          知识笔记（排除日志/周报后）只有 {nodes.length} 篇，还不够产生化学反应。等你写到 15 篇以上再来。
        </p>
      </div>
    );
  }

  return (
    <div className="mswb-growth">
      {/* 子 Tab 导航 */}
      <div className="mswb-proj-sort" style={{ marginBottom: 12 }}>
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`mswb-sort-btn ${subTab === tab.key ? 'active' : ''}`}
            onClick={() => setSubTab(tab.key)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* 子面板 */}
      <div className="mswb-growth-body">
        {subTab === 'collision' && (
          <CollisionView key={`col-${refreshKey}`} app={app} nodes={nodes} history={history} onUpdate={refresh} />
        )}
        {subTab === 'missingLinks' && (
          <MissingLinksView key={`ml-${refreshKey}`} app={app} nodes={nodes} history={history} onUpdate={refresh} />
        )}
        {subTab === 'regrowth' && (
          <RegrowthView key={`rg-${refreshKey}`} app={app} nodes={nodes} history={history} onUpdate={refresh} />
        )}
        {subTab === 'structure' && (
          <StructureView key={`st-${refreshKey}`} app={app} nodes={nodes} history={history} onUpdate={refresh} />
        )}
      </div>

      {/* 迷你仪表盘 */}
      <div className="mswb-growth-stats">
        <span className="mswb-stat">🌱 知识笔记: <strong>{stats.totalKnowledge}</strong></span>
        <span className="mswb-stat">🔗 链接密度: <strong>{stats.linkDensity}/篇</strong></span>
        <span className="mswb-stat">🕸️ 孤立: <strong>{stats.orphanCount}</strong></span>
        <span className="mswb-stat">💥 本周碰撞: <strong>{stats.collisionsThisWeek}</strong></span>
        <span className="mswb-stat">🌿 本周生长: <strong>{stats.regrowthsThisWeek}</strong></span>
      </div>
    </div>
  );
}

// ===== 碰撞视图 =====
function CollisionView({
  app, nodes, history, onUpdate,
}: {
  app: App; nodes: NoteNode[]; history: GrowthHistory; onUpdate: () => void;
}) {
  const [pair, setPair] = useState<CollisionPair | null>(null);
  const [userInput, setUserInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'done'>('idle');
  const [llmQuestion, setLlmQuestion] = useState<string | null>(null);

  useEffect(() => {
    const p = pickCollisionPair(nodes, history);
    setPair(p);
    setUserInput('');
    setStatus('idle');
    setLlmQuestion(null);
    // LLM 生成针对性碰撞问题
    if (p && isLlmConfigured()) {
      generateCollisionQuestion(
        p.noteA.displayTitle, p.noteA.excerpt || p.noteA.displayTitle,
        p.noteB.displayTitle, p.noteB.excerpt || p.noteB.displayTitle,
      ).then((q) => { if (q) setLlmQuestion(`💡 ${q}`); });
    }
  }, [nodes, history]);

  const handleLink = async () => {
    if (!pair) return;
    const desc = userInput.trim() || `${pair.noteA.displayTitle} × ${pair.noteB.displayTitle}`;

    // 在两篇笔记末尾互相追加链接
    await appendNoteLink(app, pair.noteA.path, desc, pair.noteB.path);
    await appendNoteLink(app, pair.noteB.path, desc, pair.noteA.path);

    await addCollisionRecord({
      date: new Date().toISOString().split('T')[0],
      noteA: pair.noteA.path,
      noteB: pair.noteB.path,
      action: 'linked',
      userInput: desc,
    });
    setStatus('done');
    onUpdate();
  };

  const handleNewNote = async () => {
    if (!pair || !userInput.trim()) return;

    const content = [
      '---',
      `tags:`,
      ...pair.noteA.tags.filter((t) => pair.noteB.tags.includes(t)).map((t) => `  - ${t}`),
      `created: ${new Date().toISOString().split('T')[0]}`,
      'source:',
      `  - "[[${pair.noteA.path.replace('.md', '')}]]"`,
      `  - "[[${pair.noteB.path.replace('.md', '')}]]"`,
      '---',
      '',
      `# ${userInput.trim().slice(0, 60)}`,
      '',
      userInput.trim(),
      '',
      '## 来源',
      `- [[${pair.noteA.path.replace('.md', '')}|${pair.noteA.displayTitle}]]`,
      `- [[${pair.noteB.path.replace('.md', '')}|${pair.noteB.displayTitle}]]`,
    ].join('\n');

    const noteName = userInput.trim().slice(0, 40).replace(/[\\/:*?"<>|]/g, '-');
    const notePath = `原子笔记/${noteName}.md`;

    try {
      await app.vault.create(notePath, content);
      await addCollisionRecord({
        date: new Date().toISOString().split('T')[0],
        noteA: pair.noteA.path,
        noteB: pair.noteB.path,
        action: 'new_note',
        resultPath: notePath,
        userInput: userInput.trim(),
      });
      setStatus('done');
      onUpdate();
    } catch {
      // 文件创建失败
    }
  };

  const handleSkip = async () => {
    if (!pair) return;
    await addCollisionRecord({
      date: new Date().toISOString().split('T')[0],
      noteA: pair.noteA.path,
      noteB: pair.noteB.path,
      action: 'skipped',
    });
    const newPair = pickCollisionPair(nodes, { ...history, collisions: [...(history.collisions ?? []), {
      date: new Date().toISOString().split('T')[0],
      noteA: pair.noteA.path,
      noteB: pair.noteB.path,
      action: 'skipped' as const,
    }]});
    setPair(newPair);
    setUserInput('');
    onUpdate();
  };

  if (!pair) {
    return (
      <div className="mswb-placeholder" style={{ padding: 24 }}>
        <p>🎉 当前没有可碰撞的笔记对。写得越多，碰撞越有趣。</p>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className="mswb-growth-done">
        <div className="mswb-placeholder-icon">✅</div>
        <p>碰撞完成！知识在生长 🌱</p>
        <button className="mswb-action-btn" onClick={() => {
          const newPair = pickCollisionPair(nodes, history);
          setPair(newPair);
          setUserInput('');
          setStatus('idle');
        }}>
          💥 再来一次
        </button>
      </div>
    );
  }

  return (
    <div className="mswb-collision">
      <div className="mswb-collision-cards">
        <NoteCard note={pair.noteA} side="left" app={app} />
        <div className="mswb-collision-vs">×</div>
        <NoteCard note={pair.noteB} side="right" app={app} />
      </div>

      <div className="mswb-collision-prompt">
        <div className="mswb-collision-question">{llmQuestion || '🤔 它们之间有什么关联？'}</div>
        <textarea
          className="mswb-collision-input"
          placeholder="写下你的想法——比如'设变白名单的审核流程，其实就是API限流处理的一种业务实践'……"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          rows={3}
        />
        <div className="mswb-collision-actions">
          <button className="mswb-action-btn" onClick={handleLink} disabled={userInput.trim().length === 0 && pair.strategy !== 'random'}>
            🔗 建立链接
          </button>
          <button className="mswb-action-btn" onClick={handleNewNote} disabled={!userInput.trim()}>
            📝 写新笔记
          </button>
          <button className="mswb-action-btn" onClick={handleSkip}>
            ⏭ 跳过
          </button>
          <span className="mswb-collision-strategy">
            {pair.strategy === 'cross-domain' && '🌍 跨领域'}
            {pair.strategy === 'tag-adjacent' && '🏷️ 标签相邻'}
            {pair.strategy === 'time-span' && '⏳ 时间跨度'}
            {pair.strategy === 'random' && '🎲 随机'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ===== LLM 摘要 Hook =====
function useNoteSummary(app: App, note: NoteNode): { summary: string | null; loading: boolean } {
  const [summary, setSummary] = useState<string | null>(() => getSummary(note.path));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 缓存命中 → 直接用
    const cached = getSummary(note.path);
    if (cached) { setSummary(cached); return; }
    // LLM 未配置 → 降级
    const configured = isLlmConfigured();
    console.log('[Summary] note:', note.path, 'configured:', configured, 'cached:', !!cached);
    if (!configured) { setSummary(null); return; }
    // 调 LLM
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const file = app.vault.getAbstractFileByPath(note.path);
        if (!file) { console.warn('[Summary] 文件不存在:', note.path); setLoading(false); return; }
        const content = await app.vault.cachedRead(file as any);
        console.log('[Summary] 开始调用 LLM:', note.path, 'content长度:', content.length);
        const result = await summarizeNote(note.path, content);
        console.log('[Summary] LLM 返回:', result ? result.slice(0, 50) : 'null');
        if (!cancelled && result) {
          setSummary(result);
          await saveSummary(note.path, result);
        }
      } catch (err) { console.error('[Summary] 异常:', err); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [note.path, app]);

  return { summary, loading };
}

// ===== 笔记卡片 =====
function NoteCard({ note, side, app }: { note: NoteNode; side: 'left' | 'right'; app: App }) {
  const { summary, loading } = useNoteSummary(app, note);
  const openFile = () => {
    const file = app.vault.getAbstractFileByPath(note.path);
    if (file) app.workspace.getLeaf(false).openFile(file as any);
  };

  // 文件夹路径显示
  const folderParts = note.path.split('/');
  const folderDisplay = folderParts.length >= 3
    ? `${folderParts[0]} / ${folderParts[1]}`
    : folderParts.slice(0, -1).join(' / ');

  return (
    <div className="mswb-note-card mswb-note-card-tall" onClick={openFile} title={note.displayTitle}>
      {/* 领域标签 */}
      <div className="mswb-note-card-domain">
        {note.domain === '原子笔记' && '🧠'}
        {note.domain === '项目管理-系统' && '⚙'}
        {note.domain === '项目管理-车型' && '🚗'}
        {note.domain === '日常工作-通用' && '📋'}
        {note.domain === '会议记录' && '🎙️'}
        {note.domain === '奇思妙想' && '💡'}
        {note.domain === '其他' && '📄'}
        {' '}{folderDisplay}
      </div>

      {/* 标题 */}
      <div className="mswb-note-card-title">{note.displayTitle}</div>

      {/* 分隔线 */}
      <div className="mswb-note-card-divider" />

      {/* 摘要区域 */}
      <div className="mswb-note-card-summary">
        {loading ? (
          <div className="mswb-note-card-loading">
            <span className="mswb-skeleton" />
            <span className="mswb-skeleton short" />
          </div>
        ) : summary ? (
          <span>{summary}</span>
        ) : note.excerpt ? (
          <span className="mswb-note-card-fallback">{note.excerpt}…</span>
        ) : (
          <span className="mswb-note-card-empty">暂无摘要</span>
        )}
      </div>

      {/* 分隔线 */}
      <div className="mswb-note-card-divider" />

      {/* 标签 */}
      {note.tags.length > 0 && (
        <div className="mswb-note-card-tags">
          {note.tags.slice(0, 3).map((t) => (
            <span key={t} className="mswb-tag" style={{ fontSize: '0.72em' }}>{t}</span>
          ))}
        </div>
      )}

      {/* 元信息 */}
      <div className="mswb-note-card-meta">
        {note.backLinks.length} 个反向链接 · {timeAgo(note.ctime)}
      </div>
    </div>
  );
}

// ===== 链接建议视图 =====
function MissingLinksView({
  app, nodes, history, onUpdate,
}: {
  app: App; nodes: NoteNode[]; history: GrowthHistory; onUpdate: () => void;
}) {
  const [links, setLinks] = useState<MissingLink[]>([]);
  const [llmJudgments, setLlmJudgments] = useState<Record<number, { relevant: boolean; reason: string }>>({});
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    const result = findMissingLinks(nodes, history);
    setLinks(result);
    setLlmJudgments({});
  }, [nodes, history]);

  const handleAnalyze = async () => {
    if (!isLlmConfigured()) return;
    setAnalyzing(true);
    const topN = links.slice(0, 10);
    const results: Record<number, { relevant: boolean; reason: string }> = {};
    for (let i = 0; i < topN.length; i++) {
      const ml = topN[i];
      const judgment = await judgeRelevance(
        ml.noteA.displayTitle, ml.noteA.excerpt || ml.noteA.displayTitle,
        ml.noteB.displayTitle, ml.noteB.excerpt || ml.noteB.displayTitle,
      );
      if (judgment) results[i] = judgment;
    }
    setLlmJudgments(results);
    setAnalyzing(false);
  };

  // 分组：有 LLM 判断 → 按 relevant 分组；无 → 全部显示
  const hasAI = Object.keys(llmJudgments).length > 0;
  const verified = hasAI ? links.filter((_, i) => llmJudgments[i]?.relevant) : links;
  const dismissed = hasAI ? links.filter((_, i) => llmJudgments[i] && !llmJudgments[i].relevant) : [];
  const unjudged = hasAI ? [] : links;

  const handleLink = async (ml: MissingLink) => {
    await appendNoteLink(app, ml.noteA.path, `关联笔记`, ml.noteB.path);
    await appendNoteLink(app, ml.noteB.path, `关联笔记`, ml.noteA.path);
    setLinks((prev) => prev.filter((l) => l !== ml));
    onUpdate();
  };

  const handleIgnore = async (ml: MissingLink) => {
    const thirtyDaysLater = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    await addIgnoredSuggestion({
      noteA: ml.noteA.path,
      noteB: ml.noteB.path,
      ignoreUntil: thirtyDaysLater,
    });
    setLinks((prev) => prev.filter((l) => l !== ml));
    onUpdate();
  };

  if (unjudged.length === 0 && verified.length === 0) {
    return (
      <div className="mswb-placeholder" style={{ padding: 24 }}>
        <p>🎉 当前没有发现缺失链接。写得越多，新的链接可能就会出现。</p>
      </div>
    );
  }

  const renderItem = (ml: MissingLink, i: number) => {
    const j = llmJudgments[i];
    return (
      <div key={i} className="mswb-missing-link-item">
        <div className="mswb-missing-link-pair">
          <span className="mswb-missing-link-note clickable" onClick={() => openNote(app, ml.noteA.path)}>📝 {ml.noteA.displayTitle}</span>
          <span className="mswb-missing-link-connector">⟷</span>
          <span className="mswb-missing-link-note clickable" onClick={() => openNote(app, ml.noteB.path)}>🧠 {ml.noteB.displayTitle}</span>
        </div>
        {j ? (
          <div className="mswb-missing-link-reasons">
            <span className={`mswb-ai-badge ${j.relevant ? 'relevant' : 'dismissed'}`}>
              🤖 {j.reason}
            </span>
          </div>
        ) : (
          <div className="mswb-missing-link-reasons">
            {ml.reasons.map((r, jj) => (
              <span key={jj} className="mswb-missing-link-reason">{r}</span>
            ))}
            <span className="mswb-missing-link-sim">
              相似度: {(ml.similarity * 100).toFixed(0) + '%'}
            </span>
          </div>
        )}
        <div className="mswb-missing-link-actions">
          <button className="mswb-action-btn" onClick={() => handleLink(ml)}>
            🔗 建立双向链接
          </button>
          <button className="mswb-action-btn" onClick={() => handleIgnore(ml)} style={{ opacity: 0.5 }}>
            ⏭ 忽略 30 天
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="mswb-missing-links">
      <div className="mswb-proj-stats">
        <span className="mswb-stat">
          {hasAI
            ? <>✅ 确认 <strong>{verified.length}</strong> 对 · ⏭ 排除 <strong>{dismissed.length}</strong> 对</>
            : <>发现 <strong>{links.length}</strong> 对可能的链接</>
          }
        </span>
        {isLlmConfigured() && !hasAI && (
          <button className="mswb-action-btn" onClick={handleAnalyze} disabled={analyzing} style={{ marginLeft: 8 }}>
            {analyzing ? '🤖 分析中…' : '🤖 AI 智能分析'}
          </button>
        )}
      </div>
      {unjudged.map((ml, i) => renderItem(ml, i))}
      {hasAI && verified.map((ml) => renderItem(ml, links.indexOf(ml)))}
      {hasAI && dismissed.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.85em', color: 'var(--text-muted)' }}>
            ⏭ AI 判定无关（{dismissed.length} 对）
          </summary>
          <div style={{ opacity: 0.5 }}>
            {dismissed.map((ml) => renderItem(ml, links.indexOf(ml)))}
          </div>
        </details>
      )}
    </div>
  );
}

// ===== 再生长视图 v3：D3-force 图谱 =====
function RegrowthView({
  app, nodes, history, onUpdate,
}: {
  app: App; nodes: NoteNode[]; history: GrowthHistory; onUpdate: () => void;
}) {
  const [seeds, setSeeds] = useState<SeedNote[]>([]);
  const [seed, setSeed] = useState<NoteNode | null>(null);
  const [directions, setDirections] = useState<GrowthDirection[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSeeds, setShowSeeds] = useState(false);
  const [seedFolder, setSeedFolder] = useState<string[]>([]); // 当前浏览的种子文件夹路径
  const [selectedDir, setSelectedDir] = useState<GrowthDirection | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<any>(null);
  const [nodePos, setNodePos] = useState<any[]>([]);
  const [linkData, setLinkData] = useState<any[]>([]);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; sx: number; sy: number } | null>(null);

  useEffect(() => { setSeeds(findSeeds(nodes)); }, [nodes]);

  // 选种子
  const selectSeed = async (s: NoteNode) => {
    setSeed(s); setShowSeeds(false); setSelectedDir(null);
    const cached = getGrowthDirections(s.path);
    if (cached) { setDirections(cached); return; }
    const file = app.vault.getAbstractFileByPath(s.path);
    if (!file) return;
    setLoading(true);
    const content = await app.vault.cachedRead(file as any);
    const dirs = await analyzeSeed(s.displayTitle, content);
    setLoading(false);
    if (dirs && dirs.length > 0) { setDirections(dirs); await saveGrowthDirections(s.path, dirs); }
  };

  useEffect(() => { if (!seed && seeds.length > 0) selectSeed(seeds[0].note); }, [seeds]);

  // D3 力导向（拖拽节点 + 连线高亮）
  useEffect(() => {
    if (!containerRef.current || directions.length === 0 || !seed) return;
    const w = containerRef.current.getBoundingClientRect().width || 600;
    const h = containerRef.current.getBoundingClientRect().height || 400;
    if (simRef.current) simRef.current.stop();

    const colorMap: Record<string, string> = { derive: '#4CAF50', supplement: '#2196F3', merge: '#9C27B0', extend: '#FF9800', question: '#E91E63' };
    const nodes: any[] = [
      { id: 'seed', type: 'seed', title: seed.name, fixed: true, fx: w / 2, fy: h / 2 },
      ...directions.map((d, i) => ({ id: `dir-${i}`, type: d.type, title: d.title, description: d.description, action: d.action, color: colorMap[d.type] || '#888' })),
    ];
    const links: any[] = directions.map((_, i) => ({ source: 'seed', target: `dir-${i}` }));

    const sim = forceSimulation(nodes)
      .force('link', forceLink(links).id((d: any) => d.id).distance(140).strength(0.2))
      .force('charge', forceManyBody().strength(-400))
      .force('collision', forceCollide(40))
      .force('center', forceCenter(w / 2, h / 2))
      .on('tick', () => {
        setNodePos(nodes.map((n: any) => ({ id: n.id, type: n.type, title: n.title, description: n.description, action: n.action, color: n.color, x: n.x, y: n.y })));
        setLinkData(links.map((l: any) => ({ source: l.source.id, target: l.target.id, x1: l.source.x, y1: l.source.y, x2: l.target.x, y2: l.target.y })));
      });
    simRef.current = sim;
    return () => { sim.stop(); };
  }, [directions, seed]);

  // 节点拖拽
  const handleNodeMouseDown = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const sim = simRef.current; if (!sim) return;
    const node = sim.nodes().find((n: any) => n.id === nodeId); if (!node) return;
    node.fx = node.x; node.fy = node.y;
    dragRef.current = { id: nodeId, sx: e.clientX, sy: e.clientY };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      const n = sim.nodes().find((nn: any) => nn.id === nodeId); if (!n) return;
      n.fx = (n.fx || n.x) + ev.clientX - d.sx;
      n.fy = (n.fy || n.y) + ev.clientY - d.sy;
      d.sx = ev.clientX; d.sy = ev.clientY;
      sim.alpha(0.3).restart();
    };
    const onUp = () => {
      const d = dragRef.current; if (!d) return;
      const n = sim.nodes().find((nn: any) => nn.id === d.id);
      if (n && d.id !== 'seed') { n.fx = null; n.fy = null; }
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // 快捷标签名
  const typeName = (t: string) => ({ derive: '衍生', supplement: '补充', merge: '合并', extend: '扩展', question: '提问' } as any)[t] || t;

  // 执行动作
  const execute = async (dir: GrowthDirection) => {
    if (!seed) return;
    if (dir.action === 'create_note') {
      const name = dir.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 30);
      const seedDir2 = seed.path.split("/").slice(0, -1).join("/") || "原子笔记";
      const path = seedDir2 + `/${name}.md`;
      const content = `---\nsource: "[[${seed.path.replace('.md', '')}]]"\ncreated: ${new Date().toISOString().split('T')[0]}\n---\n\n# ${dir.title}\n\n${dir.description}\n\n## 来源\n- [[${seed.path.replace('.md', '')}|${seed.displayTitle}]]`;
      const file = await app.vault.create(path, content);
      app.workspace.getLeaf(false).openFile(file as any);
    } else if (dir.action === 'append_to_note') {
      const file = app.vault.getAbstractFileByPath(seed.path);
      if (file instanceof TFile) {
        const now = new Date().toISOString().split('T')[0];
        await app.vault.append(file, `\n\n### 🌱 生长于 ${now}\n\n${dir.description}\n`);
      }
    } else if (dir.action === 'link_to_existing') {
      // 打开搜索面板
      try {
        const searchLeaf = (app as any).internalPlugins?.plugins?.['global-search'];
        if (searchLeaf?.instance) searchLeaf.instance.openGlobalSearch(dir.title);
      } catch { /* ignore */ }
    }
    // 标记已执行
    setDirections((prev) => prev.map((d) => (d === dir ? { ...d } : d)));
    setSelectedDir(null);
    onUpdate();
  };

  const typeLabel = (t: string) => ({ derive: '🌱衍生', supplement: '📝补充', merge: '🔀合并', extend: '↗️扩展', question: '💡提问' } as any)[t] || t;
  const typeLabelShort = (t: string) => ({ derive: '🌱', supplement: '📝', merge: '🔀', extend: '↗️', question: '💡' } as any)[t] || '';

  return (
    <div className="mswb-regrowth-v3" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶栏：种子选择 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--background-modifier-border)' }}>
        <span style={{ fontSize: '0.85em', fontWeight: 600 }}>🌰 当前种子：</span>
        <div style={{ position: 'relative', flex: 1 }}>
          <button className="mswb-action-btn" style={{ fontSize: '0.82em', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => { setShowSeeds(!showSeeds); setSeedFolder([]); }}>
            {seed?.name || '选择种子'} ▾
          </button>
          {showSeeds && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 9 }} onClick={() => setShowSeeds(false)} />
              <div className="mswb-seed-dropdown" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10, background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', borderRadius: 8, width: 380, maxHeight: 360, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
                <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--background-modifier-border)', fontSize: '0.75em', color: 'var(--text-muted)' }}>
                  <span style={{ cursor: 'pointer' }} onClick={() => setSeedFolder([])}>📂 知识库</span>
                  {seedFolder.map((f, i) => (
                    <span key={i}>
                      <span style={{ margin: '0 4px' }}>›</span>
                      <span style={{ cursor: 'pointer' }} onClick={() => setSeedFolder(seedFolder.slice(0, i + 1))}>{f}</span>
                    </span>
                  ))}
                </div>
                {(() => {
                  const prefix = seedFolder.length > 0 ? seedFolder.join('/') + '/' : '';
                  const folders = new Set<string>();
                  const files: SeedNote[] = [];
                  for (const s of seeds) {
                    if (!s.note.path.startsWith(prefix)) continue;
                    const rest = s.note.path.slice(prefix.length);
                    const slashIdx = rest.indexOf('/');
                    if (slashIdx > 0) { folders.add(rest.slice(0, slashIdx)); }
                    else { files.push(s); }
                  }
                  return (
                    <>
                      {Array.from(folders).sort().map((f) => (
                        <div key={'f-'+f} onClick={() => setSeedFolder([...seedFolder, f])}
                          style={{ padding: '7px 14px', cursor: 'pointer', fontSize: '0.82em', borderBottom: '1px solid var(--background-modifier-border)' }}>
                          📁 {f}
                        </div>
                      ))}
                      {files.sort((a,b) => a.note.name.localeCompare(b.note.name)).map((s) => (
                        <div key={s.note.path} onClick={() => selectSeed(s.note)}
                          style={{ padding: '7px 14px', cursor: 'pointer', fontSize: '0.82em', borderBottom: '1px solid var(--background-modifier-border)' }}>
                          📄 {s.note.name}
                        </div>
                      ))}
                      {folders.size === 0 && files.length === 0 && (
                        <div style={{ padding: '14px', fontSize: '0.82em', color: 'var(--text-muted)', textAlign: 'center' }}>空文件夹</div>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </div>
        <button className="mswb-action-btn" style={{ fontSize: '0.82em', marginLeft: 'auto' }} onClick={() => { if (seed) selectSeed(seed); }}>🤖 重新分析</button>
      </div>

      {/* 图谱区域 */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--background-primary)' }}>
        {loading ? (
          <div className="mswb-placeholder" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p>🤖 AI 正在分析这篇笔记……</p>
          </div>
        ) : directions.length === 0 ? (
          <div className="mswb-placeholder" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p>🌿 选择一颗种子，看看它能长出什么</p>
          </div>
        ) : (
          <svg ref={svgRef} width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <filter id="mswb-seed-glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {/* 连线 */}
            {linkData.map((l, i) => {
              const hl = hoverNode && (l.source === hoverNode || l.target === hoverNode);
              return <line key={`l-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke={hl ? '#5B9A6B' : '#5B9A6B'} strokeOpacity={hl ? 0.8 : hoverNode ? 0.08 : 0.3}
                strokeWidth={hl ? 2 : 1} style={{ transition: 'stroke-opacity 0.2s' }} />;
            })}
            {/* 节点 */}
            {nodePos.map((n) => {
              const isSeed = n.id === 'seed';
              const r = isSeed ? 22 : 16;
              const fill = isSeed ? '#C8A951' : n.color;
              const dim = hoverNode && hoverNode !== n.id;
              return (
                <g key={n.id} style={{ cursor: isSeed ? 'default' : 'grab', opacity: dim ? 0.3 : 1, transition: 'opacity 0.2s' }}
                  onMouseDown={(e) => handleNodeMouseDown(n.id, e)}
                  onMouseEnter={() => setHoverNode(n.id)}
                  onMouseLeave={() => setHoverNode(null)}
                  onClick={() => { if (!isSeed) { const dir = directions.find((_, i) => `dir-${i}` === n.id); if (dir) setSelectedDir(dir); }}}>
                  <circle cx={n.x} cy={n.y} r={r} fill={fill} stroke={fill}
                    strokeOpacity={dim ? 0.2 : 0.5} strokeWidth="1.5"
                    filter={isSeed ? 'url(#mswb-seed-glow)' : undefined} />
                  {/* 类型名写节点内 */}
                  <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="central"
                    fill="#fff" fontSize="9" fontWeight="700" style={{ pointerEvents: 'none' }}>
                    {isSeed ? '种子' : typeName(n.type)}
                  </text>
                  {/* 标题全文 */}
                  <text x={n.x} y={n.y + r + 13} textAnchor="middle"
                    fill="var(--text-normal)" fontSize="11" fontWeight={isSeed ? 600 : 400}
                    style={{ pointerEvents: 'none' }}>
                    {n.title || ''}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {/* 浮动卡片 */}
        {selectedDir && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setSelectedDir(null)} />
            <div className="mswb-growth-popup" style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', background: 'var(--background-secondary)', border: '1px solid var(--background-modifier-border)', borderRadius: 12, padding: 16, width: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {typeName(selectedDir.type)} · {selectedDir.title}
            </div>
            <div style={{ fontSize: '0.82em', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
              {selectedDir.description}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="mswb-action-btn" onClick={() => setSelectedDir(null)} style={{ fontSize: '0.8em' }}>✕ 关闭</button>
              <button className="mswb-action-btn" onClick={() => execute(selectedDir)} style={{ fontSize: '0.8em' }}>
                {selectedDir.action === 'create_note' ? '🔗 创建笔记' : selectedDir.action === 'append_to_note' ? '📝 追加原文' : '🔗 搜索链接'}
              </button>
            </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ===== 结构涌现视图 =====
function StructureView({
  app, nodes, history, onUpdate,
}: {
  app: App; nodes: NoteNode[]; history: GrowthHistory; onUpdate: () => void;
}) {
  const [clusters, setClusters] = useState<TopicCluster[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    const result = detectEmergentTopics(nodes);
    setClusters(result);
  }, [nodes]);

  const handleGenerateMoc = async (cluster: TopicCluster) => {
    setGenerating(cluster.topic);

    // 生成安全的文件名
    const safeTopic = cluster.topic.replace(/[\\/:*?"<>|]/g, '-');
    let mocPath = `原子笔记/${safeTopic}——索引.md`;

    // 如果文件已存在，追加序号
    let suffix = 1;
    while (app.vault.getAbstractFileByPath(mocPath)) {
      suffix++;
      mocPath = `原子笔记/${safeTopic}——索引-${suffix}.md`;
    }

    try {
      const content = generateMocDraft(cluster);
      const file = await app.vault.create(mocPath, content);
      await addGeneratedMoc({
        topic: cluster.topic,
        mocPath,
        noteCount: cluster.notes.length,
      });
      setGenerating(null);
      // 打开创建的文件
      app.workspace.getLeaf(false).openFile(file as any);
      onUpdate();
    } catch (err) {
      console.error('[GrowthPanel] MOC 创建失败:', err);
      setGenerating(null);
    }
  };

  if (clusters.length === 0) {
    return (
      <div className="mswb-placeholder" style={{ padding: 24 }}>
        <p>🗺️ 当前没有发现可汇聚的主题。继续写笔记，结构会自然涌现。</p>
      </div>
    );
  }

  return (
    <div className="mswb-structure">
      <div className="mswb-proj-stats">
        <span className="mswb-stat">发现 <strong>{clusters.length}</strong> 个可能的结构</span>
      </div>
      {clusters.map((cluster) => (
        <div key={cluster.topic} className="mswb-structure-item">
          <div className="mswb-structure-header">
            <span className="mswb-structure-topic">💡 主题: {cluster.topic}</span>
            <span className="mswb-structure-count">
              {cluster.notes.length} 篇笔记 · {cluster.linkedPairs}/{cluster.totalPairs} 对互链
            </span>
          </div>
          <div className="mswb-structure-notes">
            {cluster.notes.slice(0, 5).map((n) => (
              <span key={n.path} className="mswb-structure-note-path">
                {n.path}
              </span>
            ))}
            {cluster.notes.length > 5 && (
              <span className="mswb-structure-more">...还有 {cluster.notes.length - 5} 篇</span>
            )}
          </div>
          <div className="mswb-structure-actions">
            <button
              className="mswb-action-btn"
              onClick={() => handleGenerateMoc(cluster)}
              disabled={generating === cluster.topic}
            >
              {generating === cluster.topic ? '⏳ 生成中...' : '📝 生成 MOC 草稿'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== 工具：在笔记末尾追加关联链接 =====
async function appendNoteLink(app: App, targetPath: string, description: string, linkPath: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(targetPath);
  if (!(file instanceof TFile)) return;

  const linkName = linkPath.replace(/\.md$/, '').split('/').pop() ?? linkPath;
  const now = new Date().toISOString().split('T')[0];
  const block = `\n\n### 🔗 关联笔记 (${now})\n> ${description}\n[[${linkPath.replace('.md', '')}|${linkName}]]\n`;

  try {
    await app.vault.append(file, block);
  } catch {
    // 静默失败
  }
}

/** 打开指定路径的笔记 */
function openNote(app: App, path: string): void {
  const file = app.vault.getAbstractFileByPath(path);
  if (file) app.workspace.getLeaf(false).openFile(file as any);
}
