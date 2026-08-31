/**
 * 飞书面板 — 驾驶舱第 5 个 Tab
 *
 * 支持双数据源：
 *   📚 Wiki 知识库  — 空间 → 节点树
 *   ☁️ Drive 云盘   — 文件夹树 → 文件列表
 *
 * 三种状态：
 *   🔴 no-cli  → 安装引导
 *   🟡 no-auth → 授权引导
 *   🟢 ready   → 双源浏览器 + 链接检查
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import type { App } from 'obsidian';
import {
  checkConnection,
  loadSpaces,
  loadNodes,
  loadDriveRoot,
  loadDriveFolder,
  clearAllCaches,
  getObjTypeEmoji,
  getObjTypeLabel,
  SHEET_GRID_SVG,
  deepScanDriveFiles,
  groupDriveByProject,
  groupDriveByType,
  mergeProjectMaps,
  deleteDriveFile,
  batchGetStatistics,
  type StatisticsInfo,
  type DriveProjectGroup,
  type ProjectMapEntry,
  type MeetingMinute,
  loadMinutes,
  type LarkConnection,
  type FeishuSpace,
  type FeishuNode,
  type DriveFile,
} from '../data/feishuScanner';
import { getFeishuConfig, setFeishuConfig } from '../data/settings';
import { PROJECT_META, scanProjects } from '../data/projectScanner';

// ===== 数据源类型 =====
type SourceType = 'wiki' | 'drive' | 'minutes';

// ===== 安装引导面板 =====
function SetupGuide({ onRecheck }: { onRecheck: () => void }) {
  return (
    <div className="mswb-placeholder">
      <div className="mswb-placeholder-icon" style={{ fontSize: 48 }}>📡</div>
      <h3 style={{ margin: '12px 0 4px' }}>未检测到 lark-cli</h3>
      <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
        要使用飞书集成功能，请先安装 lark-cli 命令行工具
      </p>

      <div style={{
        textAlign: 'left', background: 'var(--background-secondary)', borderRadius: 8,
        padding: '16px 20px', margin: '0 auto', maxWidth: 440, fontSize: 13, lineHeight: 2,
      }}>
        <div style={{ marginBottom: 8, fontWeight: 600 }}>📋 安装方式：</div>
        <div><strong>• 自动安装</strong>（推荐）<br />
          <code style={{ marginLeft: 20, padding: '2px 10px', background: 'var(--background-primary)', borderRadius: 4, fontSize: 12, userSelect: 'all' }}>npm install -g @larksuite/cli</code>
        </div>
        <div style={{ marginTop: 8 }}><strong>• 手动指定</strong><br />
          <span style={{ marginLeft: 20, color: 'var(--text-muted)' }}>插件设置 → 飞书集成 → 填写 lark-cli 路径</span>
        </div>
        <div style={{ marginTop: 8 }}><strong>• npx 临时使用</strong><br />
          <span style={{ marginLeft: 20, color: 'var(--text-muted)' }}>插件会自动尝试 npx @larksuite/cli 作为兜底</span>
        </div>
      </div>

      <button className="mswb-sort-btn active" style={{ marginTop: 20, padding: '6px 24px' }} onClick={onRecheck}>
        🔍 我已安装，重新检测
      </button>
    </div>
  );
}

// ===== 授权引导面板 =====
function AuthGuide({ connection, onRecheck }: { connection: LarkConnection; onRecheck: () => void }) {
  return (
    <div className="mswb-placeholder">
      <div className="mswb-placeholder-icon" style={{ fontSize: 48 }}>🔑</div>
      <h3 style={{ margin: '12px 0 4px' }}>飞书未授权</h3>
      <p style={{ margin: '0 0 8px', color: 'var(--text-muted)', fontSize: 13 }}>
        lark-cli {connection.cliVersion ? `v${connection.cliVersion}` : ''} 已安装，但未检测到有效登录态
      </p>
      {connection.error && (
        <div style={{
          background: 'var(--background-modifier-error)',
          borderRadius: 6, padding: '8px 14px', margin: '0 auto 12px',
          maxWidth: 440, fontSize: 11, color: 'var(--text-error)',
          wordBreak: 'break-all', textAlign: 'left',
        }}>
          ⚠️ {connection.error}
        </div>
      )}
      <div style={{ background: 'var(--background-secondary)', borderRadius: 8, padding: '14px 20px', margin: '0 auto', maxWidth: 400, fontSize: 13, textAlign: 'left' }}>
        <strong>排查步骤：</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
          <li>终端运行 <code style={{ background: 'var(--background-primary)', padding: '1px 6px', borderRadius: 3, fontSize: 11, userSelect: 'all' }}>lark-cli auth status</code> 确认登录态</li>
          <li>如未登录，运行 <code style={{ background: 'var(--background-primary)', padding: '1px 6px', borderRadius: 3, fontSize: 11, userSelect: 'all' }}>lark-cli auth login</code></li>
          <li>浏览器将弹出飞书授权页面，确认授权</li>
          <li>授权完成后点下方「重新检测」</li>
        </ol>
      </div>
      <button className="mswb-sort-btn active" style={{ marginTop: 16, padding: '6px 24px' }} onClick={onRecheck}>🔍 重新检测</button>
    </div>
  );
}

// ===== 主面板 =====
export function FeishuPanel({ app }: { app: App }) {
  const [connection, setConnection] = useState<LarkConnection | null>(null);
  const [checking, setChecking] = useState(true);

  // 数据源切换
  const [source, setSource] = useState<SourceType>('drive');
  // Drive 视图模式
  const [driveViewMode, setDriveViewMode] = useState<'tree' | 'project' | 'type'>('tree');
  // 深度扫描结果（项目视图用）
  const [projectGroups, setProjectGroups] = useState<DriveProjectGroup[]>(() => {
    const cached = getFeishuConfig().cachedProjectGroups;
    if (!Array.isArray(cached)) return [];
    // 清理缓存中的旧「其他」分组，同时过滤掉所有文字记录文件
    return cached
      .filter((g: any) => g.key !== '__other__')
      .map((g: any) => ({
        ...g,
        files: (g.files || []).filter((f: DriveFile) => !/文字记录/.test(f.name)),
      }));
  });
  const [typeGroups, setTypeGroups] = useState<DriveProjectGroup[]>(() => {
    const cached = getFeishuConfig().cachedTypeGroups;
    return Array.isArray(cached) ? cached : [];
  });
  const lastSync = getFeishuConfig().lastSyncAt;
  const [deepScanning, setDeepScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ scanned: 0, total: 0 });
  const [scanTruncated, setScanTruncated] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [excludedFolders, setExcludedFolders] = useState<string[]>(() => getFeishuConfig().excludedFolders);
  const excludedRef = React.useRef(excludedFolders);
  excludedRef.current = excludedFolders;
  const [minutes, setMinutes] = useState<MeetingMinute[]>(() => {
    const cached = getFeishuConfig().cachedMinutes;
    return Array.isArray(cached) ? cached : [];
  });
  const [minutesLoading, setMinutesLoading] = useState(false);

  // 文件统计信息（访问人数）
  const [statsMap, setStatsMap] = useState<Map<string, StatisticsInfo>>(new Map());
  const [statsLoading, setStatsLoading] = useState(false);

  /** 为指定文件列表加载统计信息 */
  const loadStatsForFiles = useCallback(async (files: DriveFile[]) => {
    const entries = files.filter((f) => f.type !== 'folder').map((f) => ({ token: f.token, type: f.type }));
    if (entries.length === 0) return;
    const needLoad = entries.filter((e) => !statsMap.has(e.token));
    if (needLoad.length === 0) return;
    setStatsLoading(true);
    const map = await batchGetStatistics(needLoad);
    setStatsMap((prev) => {
      const merged = new Map(prev);
      map.forEach((v, k) => merged.set(k, v));
      return merged;
    });
    setStatsLoading(false);
  }, [statsMap]);

  // 加载智能纪要
  const doLoadMinutes = useCallback(async () => {
    setMinutesLoading(true);
    const list = await loadMinutes();
    setMinutes(list);
    setMinutesLoading(false);
    await setFeishuConfig({ cachedMinutes: list as any });
  }, []);

  // 排除/取消排除文件夹（即时更新 UI + 持久化）
  const handleToggleExclude = async (token: string) => {
    const list = excludedFolders.includes(token)
      ? excludedFolders.filter((t) => t !== token)
      : [...excludedFolders, token];
    setExcludedFolders(list);
    await setFeishuConfig({ excludedFolders: list });
  };

  // 删除文件：API 调用 + 即时从所有本地状态中移除
  const handleDeleteFile = async (file: DriveFile) => {
    if (!confirm(`确定要删除「${file.name}」吗？此操作不可撤销。`)) return;
    const result = await deleteDriveFile(file.token, file.type);
    if (!result.ok) { alert(`删除失败: ${result.error}`); return; }

    // 从目录视图移除
    setDriveFiles((prev) => prev.filter((f) => f.token !== file.token));
    // 从项目分组移除
    setProjectGroups((prev) => prev.map((g) => ({ ...g, files: g.files.filter((f) => f.token !== file.token) })));
    // 从类型分组移除
    setTypeGroups((prev) => prev.map((g) => ({ ...g, files: g.files.filter((f) => f.token !== file.token) })));
    // 更新缓存
    const updatedProject = projectGroups.map((g) => ({ ...g, files: g.files.filter((f) => f.token !== file.token) }));
    const updatedType = typeGroups.map((g) => ({ ...g, files: g.files.filter((f) => f.token !== file.token) }));
    setFeishuConfig({ cachedProjectGroups: updatedProject, cachedTypeGroups: updatedType });
  };

  // 将文件移动到指定项目（手动覆盖自动分配）
  const handleMoveFile = async (file: DriveFile, targetProjectKey: string) => {
    const cfg = getFeishuConfig();
    const overrides = { ...(cfg.fileOverrides || {}) };
    if (targetProjectKey === '__unassigned__') {
      // 移回待分配 = 删除覆盖记录，让文件重新走自动匹配
      delete overrides[file.token];
    } else {
      overrides[file.token] = targetProjectKey;
    }
    await setFeishuConfig({ fileOverrides: overrides });

    // 即时更新 UI 分组
    const moveFileAcrossGroups = (groups: DriveProjectGroup[]): DriveProjectGroup[] => {
      const src = groups.find((g) => g.files.some((f) => f.token === file.token));
      const dst = groups.find((g) => g.key === targetProjectKey);
      if (!src || !dst) return groups;
      return groups.map((g) => {
        if (g.key === src.key) return { ...g, files: g.files.filter((f) => f.token !== file.token) };
        if (g.key === dst.key) return { ...g, files: [...g.files, file] };
        return g;
      });
    };
    setProjectGroups((prev) => moveFileAcrossGroups(prev));
    const updatedProject = moveFileAcrossGroups(projectGroups);
    setFeishuConfig({ cachedProjectGroups: updatedProject });
  };

  /** 获取所有项目键列表（用于移动弹窗选项，包含待分配，排除当前所在分组） */
  const allProjectKeys = useMemo(() => {
    return projectGroups.map((g) => ({ key: g.key, emoji: g.emoji, name: g.name }));
  }, [projectGroups]);

  // Wiki 状态
  const [spaces, setSpaces] = useState<FeishuSpace[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FeishuNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);

  // Drive 状态
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [folderStack, setFolderStack] = useState<Array<{ token: string; name: string }>>([]); // 面包屑

  // 添加空间
  const [addingSpace, setAddingSpace] = useState(false);
  const [addSpaceInput, setAddSpaceInput] = useState('');

  // 初始化
  const initConnection = useCallback(async () => {
    setChecking(true);
    clearAllCaches();
    const conn = await checkConnection(true);
    setConnection(conn);
    if (conn.status === 'ready') {
      // 预加载两边
      const [spaceList, rootFiles] = await Promise.all([
        loadSpaces(true),
        loadDriveRoot(true),
      ]);
      setSpaces(spaceList);
      setDriveFiles(rootFiles);
      if (spaceList.length > 0) setSelectedSpace(spaceList[0].spaceId);
    }
    setChecking(false);
  }, []);

  useEffect(() => { initConnection(); }, []);

  // Wiki：选中空间 → 加载节点
  useEffect(() => {
    if (source !== 'wiki' || !selectedSpace || connection?.status !== 'ready') return;
    setNodesLoading(true);
    loadNodes(selectedSpace).then((list) => { setNodes(list); setNodesLoading(false); });
  }, [selectedSpace, source, connection?.status]);

  // 统一刷新：根据当前数据源智能刷新
  const switchSource = (s: SourceType) => {
    setSource(s);
  };

  // 第一阶段：扫描 vault，立即显示项目骨架
  const buildProjectSkeleton = useCallback(async () => {
    const vaultProjects = (await scanProjects(app)).map((p) => ({
      folderName: p.folderName, name: p.name, emoji: p.emoji, systemType: p.systemType,
    }));
    const metaProjects = Object.entries(PROJECT_META).map(([key, m]) => ({
      key, emoji: m.emoji, name: m.name, systemType: m.systemType,
    }));
    return mergeProjectMaps(metaProjects, vaultProjects);
  }, [app]);

  // 深度扫描：递归所有子文件夹，收集全部文件后按项目分组
  const doDeepScan = useCallback(async () => {
    setDeepScanning(true);
    setScanProgress({ scanned: 0, total: 0 });

    try {
      // 第一步：先出项目骨架（快）
      const projectList = await buildProjectSkeleton();
      const emptyGroups: DriveProjectGroup[] = projectList.map((p) => ({
        key: p.key, emoji: p.emoji, name: p.name, files: [],
      }));
      // 项目视图：仅项目，不展示「其他」
      setProjectGroups(emptyGroups);
      setSelectedProject(emptyGroups[0]?.key || null);

      // 第二步：后台扫描云盘，文件逐批填入已有项目骨架
      const rootFiles = await loadDriveRoot(true);
      const scanResult = await Promise.race([
        deepScanDriveFiles(
          rootFiles,
          (token) => loadDriveFolder(token),
          (scanned, total) => setScanProgress({ scanned, total }),
          100,
          excludedRef.current,
        ),
        new Promise<{ files: DriveFile[]; truncated: boolean }>((_, reject) =>
          setTimeout(() => reject(new Error('扫描超时')), 60000)
        ),
      ]);
      setScanTruncated(scanResult.truncated);
      const fileOverrides = getFeishuConfig().fileOverrides || {};
      const pg = groupDriveByProject(scanResult.files, projectList, fileOverrides);
      const tg = groupDriveByType(scanResult.files);
      setProjectGroups(pg);
      setTypeGroups(tg);
      // 持久化缓存
      await setFeishuConfig({
        lastSyncAt: new Date().toISOString(),
        cachedProjectGroups: pg,
        cachedTypeGroups: tg,
      });
    } catch {
      setProjectGroups([]);
    }
    setDeepScanning(false);
  }, [buildProjectSkeleton]);

  // 统一刷新：根据当前数据源智能刷新
  const unifiedRefresh = useCallback(() => {
    if (source === 'wiki') {
      initConnection();
    } else if (source === 'drive') {
      doDeepScan();
    } else if (source === 'minutes') {
      doLoadMinutes();
    }
  }, [source, initConnection, doDeepScan, doLoadMinutes]);

  // 切换到项目/类型视图时：有缓存直接用，无缓存才自动扫
  useEffect(() => {
    if (source === 'drive' && (driveViewMode === 'project' || driveViewMode === 'type') && connection?.status === 'ready') {
      if (projectGroups.length === 0) {
        doDeepScan();
      }
    }
  }, [driveViewMode, source, connection?.status]);

  // 扫描完成后自动选中第一个项目
  useEffect(() => {
    if (projectGroups.length > 0 && !selectedProject) {
      setSelectedProject(projectGroups[0].key);
    }
  }, [projectGroups, selectedProject]);

  // Drive：进入文件夹（从项目视图进入时自动切回目录视图）
  const enterFolder = async (folder: DriveFile, fromProjectView = false) => {
    setDriveLoading(true);
    if (fromProjectView) setDriveViewMode('tree');
    const files = await loadDriveFolder(folder.token);
    setFolderStack((prev) => [...prev, { token: folder.token, name: folder.name }]);
    setDriveFiles(files);
    setDriveLoading(false);
  };

  // Drive：面包屑导航
  const navigateBreadcrumb = async (index: number) => {
    setDriveLoading(true);
    if (index < 0) {
      // 回到根目录
      const files = await loadDriveRoot();
      setFolderStack([]);
      setDriveFiles(files);
    } else {
      const target = folderStack[index];
      const files = await loadDriveFolder(target.token);
      setFolderStack(folderStack.slice(0, index + 1));
      setDriveFiles(files);
    }
    setDriveLoading(false);
  };

  // 分类节点
  const { topNodes, childNodes } = useMemo(() => {
    const top: FeishuNode[] = [];
    const child: FeishuNode[] = [];
    for (const n of nodes) {
      (n.parentNodeToken ? child : top).push(n);
    }
    return { topNodes: top, childNodes: child };
  }, [nodes]);

  const handleAddSpace = async () => {
    const id = addSpaceInput.trim();
    if (!id) { setAddingSpace(false); return; }
    const config = getFeishuConfig();
    if (!config.spaces.includes(id)) {
      await setFeishuConfig({ spaces: [...config.spaces, id] });
    }
    setAddSpaceInput(''); setAddingSpace(false);
    setSpaces(await loadSpaces(true));
  };

  // ===== 渲染 =====
  if (checking) {
    return (
      <div className="mswb-placeholder">
        <div className="mswb-placeholder-icon" style={{ fontSize: 32 }}>📡</div>
        <p>检测飞书连接...</p>
      </div>
    );
  }

  if (!connection) return null;
  if (connection.status === 'no-cli') return <SetupGuide onRecheck={initConnection} />;
  if (connection.status === 'no-auth') return <AuthGuide connection={connection} onRecheck={initConnection} />;

  // ===== 已连接 =====
  return (
    <div className="mswb-feishu">
      {/* 顶部状态栏 */}
      <div className="mswb-feishu-header">
        <div className="mswb-feishu-status">
          <span className="mswb-feishu-dot" /> 已连接
          {connection.userName && <span> · {connection.userName}</span>}
        </div>
        <div className="mswb-feishu-source-tabs">
          <button className={`mswb-sort-btn ${source === 'wiki' ? 'active' : ''}`} onClick={() => switchSource('wiki')}>📚 知识库</button>
          <button className={`mswb-sort-btn ${source === 'drive' ? 'active' : ''}`} onClick={() => switchSource('drive')}>☁️ 云盘</button>
          <button className={`mswb-sort-btn ${source === 'minutes' ? 'active' : ''}`} onClick={() => { switchSource('minutes'); if (minutes.length === 0) doLoadMinutes(); }}>🎙️ 纪要</button>
          <button className="mswb-sort-btn" onClick={unifiedRefresh} title="刷新当前数据源" style={{ marginLeft: 4 }}>🔄</button>
        </div>
      </div>

      {/* 主体 */}
      {source === 'minutes' ? (
        <MinutesListView minutes={minutes} loading={minutesLoading} />
      ) : (
      <div className="mswb-feishu-body">
        <div className="mswb-feishu-spaces">
          {source === 'wiki' ? (
            <WikiSidebar
              spaces={spaces}
              selectedSpace={selectedSpace}
              onSelectSpace={setSelectedSpace}
              addingSpace={addingSpace}
              addSpaceInput={addSpaceInput}
              onAddSpaceInputChange={setAddSpaceInput}
              onStartAddSpace={() => setAddingSpace(true)}
              onConfirmAddSpace={handleAddSpace}
              onCancelAddSpace={() => setAddingSpace(false)}
            />
          ) : (
            <>
              <div className="mswb-feishu-section-title" style={{ display: 'flex', gap: 2, padding: '6px 10px' }}>
                {([
                  { key: 'tree' as const, label: '📁 原始' },
                  { key: 'project' as const, label: '📂 项目' },
                  { key: 'type' as const, label: '📋 通用' },
                ]).map((opt) => (
                  <button
                    key={opt.key}
                    className="mswb-sort-btn"
                    style={{ fontSize: 11, padding: '2px 6px', flex: 1, opacity: driveViewMode === opt.key ? 1 : 0.5 }}
                    onClick={() => setDriveViewMode(opt.key)}
                  >{opt.label}</button>
                ))}
              </div>
              {driveViewMode === 'tree' ? (
                <DriveTree
                  files={driveFiles}
                  loading={driveLoading}
                  folderStack={folderStack}
                  onEnterFolder={enterFolder}
                  onNavigateBreadcrumb={navigateBreadcrumb}
                  excludedFolders={excludedFolders}
                  onToggleExclude={handleToggleExclude}
                />
              ) : driveViewMode === 'project' ? (
                <DriveProjectList
                  groups={projectGroups}
                  scanning={deepScanning}
                  scanProgress={scanProgress}
                  truncated={scanTruncated}
                  lastSync={lastSync}
                  selectedKey={selectedProject}
                  onSelect={(key) => setSelectedProject(key)}
                  useDrawer={true}
                />
              ) : (
                <DriveProjectList
                  groups={typeGroups}
                  scanning={deepScanning}
                  scanProgress={scanProgress}
                  truncated={scanTruncated}
                  lastSync={lastSync}
                  selectedKey={selectedProject}
                  onSelect={(key) => setSelectedProject(key)}
                  useDrawer={false}
                />
              )}
            </>
          )}
        </div>
        <div className="mswb-feishu-docs">
          {source === 'wiki' ? (
            <WikiDocList
              topNodes={topNodes}
              childNodes={childNodes}
              totalCount={nodes.length}
              loading={nodesLoading}
              hasSelection={!!selectedSpace}
            />
          ) : driveViewMode === 'tree' ? (
            <DriveContent
              files={driveFiles}
              loading={driveLoading}
              folderStack={folderStack}
              onEnterFolder={enterFolder}
              onNavigateBreadcrumb={navigateBreadcrumb}
              onDelete={handleDeleteFile}
              statsMap={statsMap}
              statsLoading={statsLoading}
              onLoadStats={loadStatsForFiles}
            />
          ) : (
            <DriveProjectFiles
              groups={driveViewMode === 'type' ? typeGroups : projectGroups}
              selectedKey={selectedProject}
              onDelete={handleDeleteFile}
              onMoveFile={handleMoveFile}
              allProjectKeys={allProjectKeys}
              statsMap={statsMap}
              statsLoading={statsLoading}
              onLoadStats={loadStatsForFiles}
            />
          )}
        </div>
      </div>
      )}

    </div>
  );
}

// ===== Wiki 左侧栏 =====
function WikiSidebar({
  spaces, selectedSpace, onSelectSpace,
  addingSpace, addSpaceInput, onAddSpaceInputChange,
  onStartAddSpace, onConfirmAddSpace, onCancelAddSpace,
}: {
  spaces: FeishuSpace[];
  selectedSpace: string | null;
  onSelectSpace: (id: string) => void;
  addingSpace: boolean;
  addSpaceInput: string;
  onAddSpaceInputChange: (v: string) => void;
  onStartAddSpace: () => void;
  onConfirmAddSpace: () => void;
  onCancelAddSpace: () => void;
}) {
  return (
    <>
      <div className="mswb-feishu-section-title">📂 知识库空间</div>
      {spaces.map((space) => (
        <div
          key={space.spaceId}
          className={`mswb-feishu-space-item ${selectedSpace === space.spaceId ? 'active' : ''}`}
          onClick={() => onSelectSpace(space.spaceId)}
        >
          <span className="mswb-feishu-space-icon">{space.spaceId === 'my_library' ? '🏠' : '📚'}</span>
          <span className="mswb-feishu-space-name">{space.name}</span>
        </div>
      ))}
      {addingSpace ? (
        <div className="mswb-feishu-add-space">
          <input className="mswb-action-input" value={addSpaceInput} onChange={(e) => onAddSpaceInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onConfirmAddSpace(); if (e.key === 'Escape') onCancelAddSpace(); }}
            placeholder="空间 ID" autoFocus style={{ width: '100%', marginBottom: 4 }} />
        </div>
      ) : (
        <div className="mswb-feishu-space-item mswb-feishu-add-btn" onClick={onStartAddSpace}>
          <span className="mswb-feishu-space-icon">＋</span>
          <span className="mswb-feishu-space-name" style={{ color: 'var(--text-muted)' }}>添加空间</span>
        </div>
      )}
    </>
  );
}


// ===== Wiki 文档列表 =====
function WikiDocList({ topNodes, childNodes, totalCount, loading, hasSelection }: {
  topNodes: FeishuNode[];
  childNodes: FeishuNode[];
  totalCount: number;
  loading: boolean;
  hasSelection: boolean;
}) {
  return (
    <>
      <div className="mswb-feishu-section-title">
        📄 文档 {loading && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>加载中...</span>}
        {!loading && <span className="mswb-badge" style={{ marginLeft: 8 }}>{totalCount}</span>}
      </div>
      {totalCount === 0 && !loading ? (
        <div className="mswb-feishu-empty">{hasSelection ? '该空间暂无文档' : '请从左侧选择空间'}</div>
      ) : (
        <div className="mswb-feishu-doc-list">
          {topNodes.map((n) => <DocRow key={n.nodeToken} node={n} isChild={false} />)}
          {childNodes.map((n) => <DocRow key={n.nodeToken} node={n} isChild={true} />)}
        </div>
      )}
    </>
  );
}

// ===== Drive 左侧目录树 =====
function DriveTree({ files, loading, folderStack, onEnterFolder, onNavigateBreadcrumb, excludedFolders, onToggleExclude }: {
  files: DriveFile[];
  loading: boolean;
  folderStack: Array<{ token: string; name: string }>;
  onEnterFolder: (f: DriveFile) => void;
  onNavigateBreadcrumb: (index: number) => void;
  excludedFolders: string[];
  onToggleExclude: (token: string) => void;
}) {
  const isExcluded = (token: string) => excludedFolders.includes(token);
  const folders = files.filter((f) => f.type === 'folder');

  return (
    <>
      <div className="mswb-feishu-section-title">📁 当前目录</div>
      {/* 返回上级 */}
      {folderStack.length > 0 && (
        <div className="mswb-feishu-space-item" onClick={() => onNavigateBreadcrumb(folderStack.length - 2)}>
          <span className="mswb-feishu-space-icon">↩</span>
          <span className="mswb-feishu-space-name" style={{ color: 'var(--text-muted)' }}>返回上级</span>
        </div>
      )}
      {/* 根目录 */}
      <div
        className={`mswb-feishu-space-item ${folderStack.length === 0 ? 'active' : ''}`}
        onClick={() => onNavigateBreadcrumb(-1)}
      >
        <span className="mswb-feishu-space-icon">☁️</span>
        <span className="mswb-feishu-space-name">我的云盘</span>
      </div>
      {/* 面包屑路径中的每一级 */}
      {folderStack.map((item, i) => (
        <div
          key={item.token}
          className={`mswb-feishu-space-item ${i === folderStack.length - 1 ? 'active' : ''}`}
          onClick={() => onNavigateBreadcrumb(i)}
          style={{ paddingLeft: 14 + (i + 1) * 14 }}
        >
          <span className="mswb-feishu-space-icon">📁</span>
          <span className="mswb-feishu-space-name">{item.name}</span>
        </div>
      ))}
      {/* 分隔 */}
      {folders.length > 0 && <div className="mswb-feishu-section-title" style={{ paddingTop: 10 }}>子文件夹</div>}
      {loading ? (
        <div className="mswb-feishu-empty">加载中...</div>
      ) : (
        folders.map((f) => (
          <div
            key={f.token}
            className={`mswb-feishu-space-item ${isExcluded(f.token) ? 'excluded' : ''}`}
            style={{ paddingLeft: 14 + (folderStack.length + 1) * 14 }}
          >
            <span className="mswb-feishu-space-icon" onClick={() => onEnterFolder(f)} style={{ cursor: 'pointer' }}>📁</span>
            <span className="mswb-feishu-space-name" onClick={() => onEnterFolder(f)} style={{ cursor: 'pointer' }}>{f.name}</span>
            <button
              className="mswb-feishu-exclude-btn"
              onClick={(e) => { e.stopPropagation(); onToggleExclude(f.token); }}
              title={isExcluded(f.token) ? '取消排除' : '排除此文件夹'}
            >{isExcluded(f.token) ? '⊞' : '⊘'}</button>
          </div>
        ))
      )}
    </>
  );
}

// ===== Drive 项目列表（左栏）— 抽屉式按系统类别分组 =====
function DriveProjectList({ groups, scanning, scanProgress, truncated, lastSync, selectedKey, onSelect, useDrawer = true }: {
  groups: DriveProjectGroup[];
  scanning: boolean;
  scanProgress: { scanned: number; total: number };
  truncated: boolean;
  lastSync: string | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  useDrawer?: boolean;
}) {
  const syncHint = lastSync ? (() => {
    const diff = Date.now() - new Date(lastSync).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
  })() : null;

  // 按系统类别组织分组
  const categorizedGroups = useMemo(() => {
    const categories: Record<string, { emoji: string; projects: DriveProjectGroup[] }> = {};
    const unassigned: DriveProjectGroup[] = [];

    // 旧缓存回退：从 PROJECT_META 查 systemType（缓存升级前的数据没有 systemType 字段）
    const systemTypeMap = new Map<string, string>();
    for (const [key, meta] of Object.entries(PROJECT_META)) {
      systemTypeMap.set(key, meta.systemType);
    }

    for (const g of groups) {
      if (g.key === '__unassigned__') {
        unassigned.push(g);
        continue;
      }
      // 优先用 group 上的 systemType，旧缓存回退到 PROJECT_META 查找
      const cat = g.systemType || systemTypeMap.get(g.key) || '其他';
      if (!categories[cat]) {
        let emoji = '📁';
        if (cat === 'AI智能体') emoji = '🧠';
        else if (cat === 'RPA自动化') emoji = '📦';
        else if (cat === '多维表') emoji = '📋';
        else if (cat === '工具开发') emoji = '⚙';
        else if (cat === '车型项目') emoji = '🚗';
        categories[cat] = { emoji, projects: [] };
      }
      categories[cat].projects.push(g);
    }

    return { categories, unassigned };
  }, [groups]);

  // 抽屉展开状态
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(() => {
    // 默认展开第一个有项目的类别
    const init: Record<string, boolean> = {};
    let firstSet = false;
    for (const cat of Object.keys(categorizedGroups.categories)) {
      if (!firstSet && categorizedGroups.categories[cat].projects.length > 0) {
        init[cat] = true;
        firstSet = true;
      } else {
        init[cat] = false;
      }
    }
    return init;
  });

  // 扫描完成后新增类别仍未初始化 → 补一次默认展开（首次无缓存场景）
  React.useEffect(() => {
    if (Object.keys(expanded).length > 0) return; // 已有状态（含用户手动折叠）不覆盖
    const init: Record<string, boolean> = {};
    let firstSet = false;
    for (const cat of Object.keys(categorizedGroups.categories)) {
      if (!firstSet && categorizedGroups.categories[cat].projects.length > 0) {
        init[cat] = true;
        firstSet = true;
      } else {
        init[cat] = false;
      }
    }
    if (Object.keys(init).length > 0) setExpanded(init);
  }, [categorizedGroups]);

  const toggleCategory = (cat: string) => {
    setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  if (scanning) {
    return (
      <div className="mswb-feishu-empty" style={{ padding: 12, fontSize: 12 }}>
        <p>🔍 扫描云盘文件夹...</p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {scanProgress.scanned > 0 ? `${scanProgress.scanned} 个文件夹已扫描` : '正在递归遍历...'}
        </p>
      </div>
    );
  }

  const totalFiles = groups.reduce((s, g) => s + g.files.length, 0);
  const catEntries = Object.entries(categorizedGroups.categories);

  // 通用视图（useDrawer=false）：扁平列表，按类型显示
  if (!useDrawer) {
    return (
      <>
        <div className="mswb-feishu-section-title">📋 通用</div>
        <div style={{ padding: '2px 14px 6px', fontSize: 11, color: 'var(--text-faint)' }}>
          {groups.length} 组 · {totalFiles} 文件
          {syncHint && <span style={{ marginLeft: 4 }}>· {syncHint}</span>}
        </div>
        {groups.map((g) => (
          <div
            key={g.key}
            className={`mswb-feishu-space-item ${selectedKey === g.key ? 'active' : ''}`}
            onClick={() => onSelect(g.key)}
          >
            <span className="mswb-feishu-space-icon">{g.emoji}</span>
            <span className="mswb-feishu-space-name">{g.name}</span>
            <span className="mswb-badge" style={{ marginLeft: 'auto' }}>{g.files.length}</span>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <div className="mswb-feishu-section-title">📂 项目</div>
      <div style={{ padding: '2px 14px 6px', fontSize: 11, color: 'var(--text-faint)' }}>
        {groups.length} 组 · {totalFiles} 文件
        {syncHint && <span style={{ marginLeft: 4 }}>· {syncHint}</span>}
        {truncated && <span style={{ color: 'var(--text-warning)', marginLeft: 4 }}>（已达上限）</span>}
      </div>

      {/* 抽屉式类别 */}
      {catEntries.map(([cat, { emoji, projects }]) => {
        const isExpanded = expanded[cat];
        const catFileCount = projects.reduce((s, p) => s + p.files.length, 0);
        return (
          <div key={cat}>
            <div
              className="mswb-feishu-category-header"
              onClick={() => toggleCategory(cat)}
            >
              <span className="mswb-feishu-category-arrow">{isExpanded ? '▼' : '▶'}</span>
              <span className="mswb-feishu-space-icon">{emoji}</span>
              <span className="mswb-feishu-space-name">{cat}</span>
              <span className="mswb-badge" style={{ marginLeft: 'auto' }}>{catFileCount}</span>
            </div>
            {isExpanded && projects.map((g) => (
              <div
                key={g.key}
                className={`mswb-feishu-space-item mswb-feishu-project-item ${selectedKey === g.key ? 'active' : ''}`}
                onClick={() => onSelect(g.key)}
              >
                <span className="mswb-feishu-space-icon">{g.emoji}</span>
                <span className="mswb-feishu-space-name">{g.name}</span>
                <span className="mswb-badge" style={{ marginLeft: 'auto' }}>{g.files.length}</span>
              </div>
            ))}
          </div>
        );
      })}

      {/* 待分配 */}
      {categorizedGroups.unassigned.map((g) => (
        <div
          key={g.key}
          className={`mswb-feishu-space-item ${selectedKey === g.key ? 'active' : ''}`}
          onClick={() => onSelect(g.key)}
        >
          <span className="mswb-feishu-space-icon">📥</span>
          <span className="mswb-feishu-space-name">待分配</span>
          <span className="mswb-badge" style={{ marginLeft: 'auto' }}>{g.files.length}</span>
        </div>
      ))}
    </>
  );
}

// ===== Drive 项目文件（右栏） =====
function DriveProjectFiles({ groups, selectedKey, onDelete, onMoveFile, allProjectKeys, statsMap, statsLoading, onLoadStats }: {
  groups: DriveProjectGroup[];
  selectedKey: string | null;
  onDelete: (f: DriveFile) => void;
  onMoveFile: (f: DriveFile, targetKey: string) => void;
  allProjectKeys: Array<{ key: string; emoji: string; name: string }>;
  statsMap: Map<string, StatisticsInfo>;
  statsLoading: boolean;
  onLoadStats: (files: DriveFile[]) => void;
}) {
  const group = groups.find((g) => g.key === selectedKey);

  if (!selectedKey || !group) {
    return (
      <div className="mswb-feishu-empty" style={{ padding: 24 }}>
        <p style={{ fontSize: 24, marginBottom: 8 }}>📂</p>
        <p>从左侧选择一个项目查看文件</p>
      </div>
    );
  }

  // 切换项目时触发的统计加载
  const loadedRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    const key = selectedKey || '';
    if (group.files.length > 0 && !loadedRef.current.has(key)) {
      loadedRef.current.add(key);
      onLoadStats(group.files);
    }
  }, [selectedKey, group.files.length, onLoadStats]);

  // 移动弹窗状态
  const [movingFile, setMovingFile] = React.useState<DriveFile | null>(null);

  return (
    <>
      <div className="mswb-feishu-section-title">
        {group.emoji} {group.name}
        <span className="mswb-badge" style={{ marginLeft: 8 }}>{group.files.length} 个文件</span>
      </div>
      <div className="mswb-feishu-doc-list">
        {statsLoading && group.files.length > 0 && (
          <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)' }}>加载访问人数中...</div>
        )}
        {[...group.files]
          .sort((a, b) => parseInt(b.createdTime || '0') - parseInt(a.createdTime || '0'))
          .map((f) => {
            const stats = statsMap.get(f.token);
            return (
            <div key={f.token} className="mswb-feishu-doc-row">
              <span className="mswb-feishu-doc-emoji">
                <TypeEmoji emoji={getObjTypeEmoji(f.type)} />
              </span>
              <a className="mswb-feishu-doc-link" href={f.url} target="_blank" rel="noopener" title={f.name}>
                {f.name}
              </a>
              <span className="mswb-feishu-doc-type">{getObjTypeLabel(f.type)}</span>
              {stats && (
                <span className="mswb-feishu-doc-stats" title={`访问人数: ${stats.uvCount} · 访问次数: ${stats.pvCount}`}>
                  👁 {stats.uvCount}
                </span>
              )}
              <span className="mswb-feishu-doc-time">{fmtTime(f.createdTime)}</span>
              <button className="mswb-feishu-move-btn" onClick={(e) => { e.stopPropagation(); setMovingFile(f); }} title="移动到其他项目">↗</button>
              <button className="mswb-feishu-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(f); }} title="删除">🗑</button>
            </div>
          );
        })}
      </div>

      {/* 移动弹窗 */}
      {movingFile && (
        <div className="mswb-feishu-move-overlay" onClick={() => setMovingFile(null)}>
          <div className="mswb-feishu-move-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mswb-feishu-move-title">移动文件</div>
            <div className="mswb-feishu-move-file-name">{movingFile.name}</div>
            <div className="mswb-feishu-move-list">
              {allProjectKeys.filter((p) => p.key !== selectedKey).map((p) => (
                <div
                  key={p.key}
                  className="mswb-feishu-move-item"
                  onClick={() => {
                    onMoveFile(movingFile, p.key);
                    setMovingFile(null);
                  }}
                >
                  <span className="mswb-feishu-space-icon">{p.emoji}</span>
                  <span className="mswb-feishu-space-name">{p.name}</span>
                </div>
              ))}
            </div>
            <button className="mswb-sort-btn" style={{ marginTop: 8, width: '100%' }} onClick={() => setMovingFile(null)}>取消</button>
          </div>
        </div>
      )}
    </>
  );
}

// ===== 时间格式化 =====
function fmtTime(ts: string): string {
  if (!ts) return '';
  const d = new Date(parseInt(ts) * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ===== Drive 右侧内容 =====
function DriveContent({ files, loading, folderStack, onEnterFolder, onNavigateBreadcrumb, onDelete, statsMap, statsLoading, onLoadStats }: {
  files: DriveFile[];
  loading: boolean;
  folderStack: Array<{ token: string; name: string }>;
  onEnterFolder: (f: DriveFile) => void;
  onNavigateBreadcrumb: (index: number) => void;
  onDelete: (f: DriveFile) => void;
  statsMap: Map<string, StatisticsInfo>;
  statsLoading: boolean;
  onLoadStats: (files: DriveFile[]) => void;
}) {
  const docs = files
    .filter((f) => f.type !== 'folder')
    .sort((a, b) => parseInt(b.createdTime || '0') - parseInt(a.createdTime || '0'));

  // 首次渲染时触发加载统计
  const loadedRef = React.useRef(false);
  useEffect(() => {
    if (!loading && docs.length > 0 && !loadedRef.current) {
      loadedRef.current = true;
      onLoadStats(docs);
    }
  }, [loading, docs.length, onLoadStats]);

  return (
    <>
      {/* 面包屑 */}
      <div className="mswb-feishu-breadcrumb">
        <span className="mswb-feishu-breadcrumb-item" onClick={() => onNavigateBreadcrumb(-1)}>☁️ 我的云盘</span>
        {folderStack.map((item, i) => (
          <span key={item.token}>
            <span className="mswb-feishu-breadcrumb-sep">/</span>
            <span
              className={`mswb-feishu-breadcrumb-item ${i === folderStack.length - 1 ? 'active' : ''}`}
              onClick={() => onNavigateBreadcrumb(i)}
            >{item.name}</span>
          </span>
        ))}
        <span className="mswb-badge" style={{ marginLeft: 10 }}>{files.length}</span>
        {loading && <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 11 }}>加载中...</span>}
      </div>

      <div className="mswb-feishu-doc-list">
        {files.length === 0 && !loading ? (
          <div className="mswb-feishu-empty">此文件夹为空</div>
        ) : (
          <>
            {statsLoading && docs.length > 0 && (
              <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)' }}>加载访问人数中...</div>
            )}
            {docs.map((f) => {
              const stats = statsMap.get(f.token);
              return (
                <div key={f.token} className="mswb-feishu-doc-row">
                  <span className="mswb-feishu-doc-emoji">
                    <TypeEmoji emoji={getObjTypeEmoji(f.type)} />
                  </span>
                  <a className="mswb-feishu-doc-link" href={f.url} target="_blank" rel="noopener" title={`在飞书中打开: ${f.name}`}>
                    {f.name}
                  </a>
                  <span className="mswb-feishu-doc-type">{getObjTypeLabel(f.type)}</span>
                  {stats && (
                    <span className="mswb-feishu-doc-stats" title={`访问人数: ${stats.uvCount} · 访问次数: ${stats.pvCount}`}>
                      👁 {stats.uvCount}
                    </span>
                  )}
                  <span className="mswb-feishu-doc-time">{fmtTime(f.createdTime)}</span>
                  <button className="mswb-feishu-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(f); }} title="删除">🗑</button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

// ===== 类型图标渲染 =====
function TypeEmoji({ emoji }: { emoji: string }) {
  if (emoji === '__grid__') {
    return <span className="mswb-feishu-doc-emoji" dangerouslySetInnerHTML={{ __html: SHEET_GRID_SVG }} />;
  }
  return <span className="mswb-feishu-doc-emoji">{emoji}</span>;
}

// ===== 智能纪要全页列表 =====
function MinutesListView({ minutes, loading }: {
  minutes: MeetingMinute[];
  loading: boolean;
}) {
  return (
    <div className="mswb-feishu-body">
      <div className="mswb-feishu-docs" style={{ flex: 1 }}>
        <div className="mswb-feishu-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>🎙️ 智能纪要 <span className="mswb-badge" style={{ marginLeft: 6 }}>{minutes.filter(m => m.type === '智能纪要').length}</span></span>
        </div>
        {loading ? (
          <div className="mswb-feishu-empty">加载中...</div>
        ) : minutes.filter(m => m.type === '智能纪要').length === 0 ? (
          <div className="mswb-feishu-empty">未找到智能纪要</div>
        ) : (
          <div className="mswb-feishu-doc-list">
            {minutes.filter(m => m.type === '智能纪要').map((m) => (
              <div key={m.token} className="mswb-feishu-doc-row">
                <span className="mswb-feishu-doc-emoji">{m.type === '智能纪要' ? '🤖' : '📝'}</span>
                <a className="mswb-feishu-doc-link" href={m.url} target="_blank" rel="noopener" title={m.title}>
                  {m.title}
                </a>
                <span className="mswb-feishu-doc-type">{m.type}</span>
                <span className="mswb-feishu-doc-time" style={{ minWidth: 60, textAlign: 'left' }}>{m.ownerName || ''}</span>
                <span className="mswb-feishu-doc-time">{m.date.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Wiki 文档行 =====
function DocRow({ node, isChild }: { node: FeishuNode; isChild: boolean }) {
  const emoji = getObjTypeEmoji(node.objType);
  const label = getObjTypeLabel(node.objType);

  return (
    <div className={`mswb-feishu-doc-row ${isChild ? 'child' : ''}`}>
      <TypeEmoji emoji={emoji} />
      <a className="mswb-feishu-doc-link" href={node.url} target="_blank" rel="noopener" title={`在飞书中打开: ${node.title}`}>
        {node.title || '(无标题)'}
      </a>
      <span className="mswb-feishu-doc-type">{label}</span>
      {node.hasChild && <span className="mswb-feishu-doc-haschild">📂</span>}
    </div>
  );
}
