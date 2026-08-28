// ===== 知识笔记扫描器 =====
// 两个插件（猛士驾驶舱、生长）共用

import { App } from 'obsidian';
import type { NoteNode } from './noteTypes';
import {
  detectDomain, extractExcerptKeywords, buildExcerpt,
  extractProjectFolderRaw, buildDisplayTitle,
} from './excerptUtils';

/** 默认排除的文件夹 */
export const DEFAULT_EXCLUDED_FOLDERS = [
  '工作日志/', '工作周报/', 'templates/', '.obsidian/', '.claude/', '.claudian/', '.trash/',
];

/** 扫描全库知识笔记 */
export async function scanKnowledgeNotes(
  app: App,
  excludedFolders: string[] = DEFAULT_EXCLUDED_FOLDERS,
): Promise<NoteNode[]> {
  const files = app.vault.getMarkdownFiles();
  const nodes: NoteNode[] = [];

  for (const file of files) {
    if (excludedFolders.some((prefix) => file.path.startsWith(prefix))) continue;
    if (file.extension !== 'md') continue;

    try {
      const cache = app.metadataCache.getFileCache(file);
      const content = await app.vault.cachedRead(file);

      // 提取标题
      let title = file.basename;
      const headingMatch = content.match(/^#\s+(.+)$/m);
      if (headingMatch) title = headingMatch[1].trim();

      // 提取标签
      const tags: string[] = [];
      if (cache?.frontmatter?.tags) {
        const ft = cache.frontmatter.tags;
        if (Array.isArray(ft)) {
          tags.push(...ft.map((t: string) => t.replace(/^#/, '')));
        } else if (typeof ft === 'string') {
          tags.push(ft.replace(/^#/, ''));
        }
      }
      if (cache?.tags) {
        for (const t of cache.tags) {
          const tagName = t.tag.replace(/^#/, '');
          if (!tags.includes(tagName)) tags.push(tagName);
        }
      }

      // 提取链接
      const outLinks: string[] = [];
      if (cache?.links) {
        for (const link of cache.links) {
          const target = link.link.split('|')[0].split('#')[0].trim();
          if (target) outLinks.push(target);
        }
      }

      // 反向链接
      const backLinks: string[] = [];
      const resolvedLinks = app.metadataCache.resolvedLinks;
      if (resolvedLinks) {
        for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
          if (sourcePath === file.path) continue;
          if (file.path in (targets as Record<string, number>)) {
            backLinks.push(sourcePath);
          }
        }
      }

      const domain = detectDomain(file.path);
      const projectFolder = extractProjectFolderRaw(file.path);
      const shortTitle = title.replace(/^\d+[-.\s]*/, '');
      const displayTitle = buildDisplayTitle(title, file.path, domain);
      const excerptKeywords = extractExcerptKeywords(content);
      const excerpt = buildExcerpt(content);

      nodes.push({
        path: file.path,
        name: file.basename,
        title,
        displayTitle,
        shortTitle,
        projectFolder,
        excerptKeywords,
        excerpt,
        tags,
        outLinks,
        backLinks,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        domain,
        ext: file.extension,
      });
    } catch {
      // 跳过无法读取的文件
    }
  }

  return nodes;
}
