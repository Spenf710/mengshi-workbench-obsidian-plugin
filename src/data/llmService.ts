import { requestUrl } from 'obsidian';
import { getLlmConfig, isLlmConfigured } from './settings';

type ApiConfig = { endpoint: string; model: string; apiKey: string; apiType: string };

// ===== 底层 API 调用 =====

function isLocal(url: string): boolean {
  return url.startsWith('http://127') || url.startsWith('http://localhost');
}

async function apiPost(
  url: string, headers: Record<string, string>, body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: any }> {
  if (isLocal(url)) {
    try {
      const resp = await requestUrl({ url, method: 'POST', headers, body: JSON.stringify(body) });
      return { ok: true, status: resp.status, data: resp.json };
    } catch (e: any) { return { ok: false, status: e?.status ?? 0, data: null }; }
  }
  try {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await resp.json();
    return { ok: resp.ok, status: resp.status, data };
  } catch (e: any) { return { ok: false, status: 0, data: e?.message }; }
}

/** 通用 LLM 调用（Chat 格式） */
async function llmChat(systemPrompt: string, userMessage: string, maxTokens = 256): Promise<string | null> {
  if (!isLlmConfigured()) return null;
  const config = getLlmConfig();
  const url = `${config.endpoint.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  const { ok, status, data } = await apiPost(url, headers, {
    model: config.model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
    temperature: 0.3, max_tokens: maxTokens,
  });
  if (!ok) { console.error('[LLM:Chat] HTTP', status, JSON.stringify(data).slice(0, 200)); return null; }
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (text) return text;
  return data?.choices?.[0]?.message?.reasoning_content?.trim()?.slice(-200) ?? null;
}

/** 通用 LLM 调用（Messages 格式） */
async function llmMessages(systemPrompt: string, userMessage: string, maxTokens = 256): Promise<string | null> {
  if (!isLlmConfigured()) return null;
  const config = getLlmConfig();
  const url = `${config.endpoint.replace(/\/+$/, '')}/messages`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'anthropic-version': '2023-06-01',
  };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  const { ok, status, data } = await apiPost(url, headers, {
    model: config.model, max_tokens: maxTokens,
    system: systemPrompt, messages: [{ role: 'user', content: userMessage }],
  });
  if (!ok) { console.error('[LLM:Messages] HTTP', status, JSON.stringify(data).slice(0, 200)); return null; }
  const textBlock = data?.content?.find((c: any) => c.type === 'text')
    ?? data?.content?.[data.content.length - 1];
  return textBlock?.text?.trim() ?? null;
}

async function llm(systemPrompt: string, userMessage: string, maxTokens = 256): Promise<string | null> {
  const config = getLlmConfig();
  if (config.apiType === 'anthropic') return llmMessages(systemPrompt, userMessage, maxTokens);
  return llmChat(systemPrompt, userMessage, maxTokens);
}

// ===== 高层功能 =====

/** 笔记摘要 */
export async function summarizeNote(filePath: string, content: string): Promise<string | null> {
  if (!isLlmConfigured()) return null;
  let body = content;
  const fmMatch = body.match(/^---\n[\s\S]*?\n---\n?/);
  if (fmMatch) body = body.slice(fmMatch[0].length);
  body = body.slice(0, 1500);
  return llm(
    '你是一个笔记摘要助手。请用约100个中文字符概括笔记的核心内容。要求：先识别笔记所属的项目或模块名称，再概括核心内容。输出格式：[项目名] 摘要内容。不要输出多余的前缀或换行。',
    `笔记路径：${filePath}\n\n笔记内容：\n${body}`,
    1024,
  );
}

/** 碰撞问题：生成两篇笔记之间的关联提问 */
export async function generateCollisionQuestion(
  titleA: string, excerptA: string, titleB: string, excerptB: string,
): Promise<string | null> {
  return llm(
    '你是知识库的碰撞引导助手。给出两篇笔记，请用一到两句话提出一个具体的、它们之间可能存在的关联方向或值得思考的问题。必须具体——要引用到两篇笔记的实际内容，不要泛泛而谈。约 50-80 字。',
    `笔记A：${titleA}\n${excerptA.slice(0, 300)}\n\n笔记B：${titleB}\n${excerptB.slice(0, 300)}`,
    256,
  );
}

/** 链接建议判断：两篇笔记是否真的存在有意义的关联 */
export async function judgeRelevance(
  titleA: string, excerptA: string, titleB: string, excerptB: string,
): Promise<{ relevant: boolean; reason: string } | null> {
  const result = await llm(
    '你是知识链接判断助手。判断两篇笔记是否存在有意义的关联（值得用双向链接串联）。回复格式：先输出 YES 或 NO，然后一句话说明理由。',
    `笔记A：${titleA}\n内容：${excerptA.slice(0, 400)}\n\n笔记B：${titleB}\n内容：${excerptB.slice(0, 400)}`,
    128,
  );
  if (!result) return null;
  const upper = result.toUpperCase();
  const relevant = upper.startsWith('YES');
  const reason = (relevant ? result.slice(3) : upper.startsWith('NO') ? result.slice(2) : result).replace(/^[:\s，,]+/, '').trim();
  return { relevant, reason: reason || (relevant ? '内容相关' : '内容无关') };
}

// ===== 生长方向类型 =====

export interface GrowthDirection {
  type: 'derive' | 'supplement' | 'merge' | 'extend' | 'question';
  title: string;
  description: string;
  action: 'create_note' | 'append_to_note' | 'link_to_existing';
}

const GROWTH_SYSTEM = `你是知识生长助手。深度阅读笔记，生成 3-5 条知识生长方向。每条方向必须包含 type / title / description / action 四个字段。

type 字段含义：
- derive（衍生）：从笔记的一个观点出发，创建新笔记
- supplement（补充）：笔记缺少某些内容，需要补充到原笔记
- merge（合并）：可与其他笔记合并成更完整的知识单元
- extend（扩展）：把思路应用到新场景
- question（提问）：提出值得探索的问题

action 字段含义：
- create_note：创建新笔记
- append_to_note：追加到原笔记末尾
- link_to_existing：链接到已有笔记

用纯 JSON 数组输出，不要任何其他文字：
[{"type":"derive","title":"...","description":"...","action":"create_note"}, ...]`;

export async function analyzeSeed(title: string, content: string): Promise<GrowthDirection[] | null> {
  const result = await llm(
    GROWTH_SYSTEM,
    `笔记标题：${title}\n\n笔记内容：\n${content.slice(0, 3000)}`,
    1024,
  );
  if (!result) return null;
  try {
    const jsonStr = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return null;
    return arr.filter((d: any) => d.type && d.title).slice(0, 5);
  } catch {
    console.warn('[LLM] analyzeSeed JSON解析失败:', result.slice(0, 300));
    return null;
  }
}
