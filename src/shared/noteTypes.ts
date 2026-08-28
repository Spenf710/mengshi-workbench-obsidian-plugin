// ===== 生长共享类型 =====
// 两个插件（猛士驾驶舱、生长）共用

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
  similarity: number;
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
