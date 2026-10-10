import type { NewsItemRow } from "./types.ts";
import {
  cleanText,
  escapeHtml,
  requiredEnv,
  safeError,
  sleep,
} from "./utils.ts";

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
}

interface SentMessage {
  message_id: number;
}

interface TelegramCallOptions {
  retryAmbiguousErrors?: boolean;
}

export class AmbiguousTelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousTelegramError";
  }
}

const AI_TOPICS = new Set([
  "anthropic_claude",
  "openai_chatgpt_codex",
  "nvidia_ai_hardware",
  "xai_grok",
  "ai_models_releases",
  "ai_access_pricing",
  "ai_hardware_chips",
  "applied_ai",
  "ai_agents_automation",
]);

const UAE_TOPICS = new Set([
  "uae_relevant_news",
  "uae_jobs_internships",
  "uae_events_hackathons",
]);

const OPPORTUNITY_TOPICS = new Set([
  "career_opportunities",
  "uae_jobs_internships",
  "uae_events_hackathons",
  "courses_certifications",
]);

const TECH_TOPICS = new Set([
  "developer_tools",
  "python_apis",
  "n8n",
  "aws_cloud",
  "supabase",
  "docker",
  "react_nextjs",
]);
const SECURITY_NEWS_SOURCE_IDS = new Set([
  "aws-security-bulletins",
  "docker-security-announcements",
]);

const SIMPLE_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\bpace the frontier\b/gi,
    "slow down development of the most powerful AI systems",
  ],
  [/\bfrontier (?:AI|models?)\b/gi, "the most advanced AI systems"],
  [
    /\bmodel[- ]distillation campaigns?\b/gi,
    "attempts to copy another AI system by using its answers as examples",
  ],
  [
    /\bmodel distillation\b/gi,
    "copying another AI system by using its answers as examples",
  ],
  [
    /\breasoning and agentic AI\b/gi,
    "AI that can solve problems and carry out tasks",
  ],
  [/\bagentic AI\b/gi, "AI that can plan and carry out tasks"],
  [/\bmulti[- ]step reasoning\b/gi, "solving a problem in several steps"],
  [/\breasoning models\b/gi, "AI systems that solve problems step by step"],
  [/\ba reasoning model\b/gi, "an AI system that solves problems step by step"],
  [/\bedge AI\b/gi, "AI running directly on a device"],
  [/\bat the edge\b/gi, "directly on a device"],
  [/\bmodel inference\b/gi, "using a trained AI system to produce an answer"],
  [/\binference\b/gi, "running a trained AI system"],
  [/\bmultimodal\b/gi, "able to understand text, images, or audio"],
  [
    /\bopen[- ]weight models?\b/gi,
    "AI systems whose main files can be downloaded",
  ],
  [/\bdeploying\b/gi, "setting up and running"],
  [/\bdeploy\b/gi, "set up and run"],
  [/\bdeployment\b/gi, "setup"],
  [/\boptimizing\b/gi, "making it faster and more efficient"],
  [/\boptimi[sz]e\b/gi, "make it faster and more efficient"],
  [/\blatency\b/gi, "delay"],
  [/\bthroughput\b/gi, "the amount of work it can handle"],
  [/\bcompute\b/gi, "computing power"],
  [/\bAI infrastructure\b/gi, "computer systems used to run AI"],
  [/\bdata cent(?:er|re)s?\b/gi, "large buildings full of computers"],
  [/\btraining data\b/gi, "examples used to teach AI"],
  [/\bvaluation\b/gi, "estimated company value"],
  [/\bcybersecurity\b/gi, "computer security"],
  [/\becosystem\b/gi, "group of connected products and services"],
  [/\bGPUs\b/g, "GPUs (powerful computer chips)"],
  [/\bGPU\b/g, "GPU (a powerful computer chip)"],
  [/\bAPIs\b/g, "APIs (ways for programs to connect)"],
  [/\bAPI\b/g, "API (a way for programs to connect)"],
  [/\bSDKs\b/g, "SDKs (tools for building software)"],
  [/\bSDK\b/g, "SDK (tools for building software)"],
  [
    /\bremote code execution\b/gi,
    "a security flaw that can let an attacker run code from far away",
  ],
  [/\bzero[- ]day\b/gi, "a newly discovered security weakness"],
  [/\bvulnerabilit(?:y|ies)\b/gi, "security weakness"],
  [/\bdeprecated\b/gi, "being phased out"],
  [/\bdeprecation\b/gi, "a planned end of support"],
  [/\bgenerally available\b/gi, "officially available for normal use"],
];

function hasAny(topics: Set<string>, wanted: Set<string>): boolean {
  for (const topic of wanted) {
    if (topics.has(topic)) return true;
  }
  return false;
}

export function newsTypeLabel(
  item: Pick<
    NewsItemRow,
    "source_id" | "topic_tags" | "is_opportunity" | "action"
  >,
): string {
  const topics = new Set<string>(item.topic_tags);
  const isUae = hasAny(topics, UAE_TOPICS);
  const isAi = hasAny(topics, AI_TOPICS);
  const isOpportunity = hasAny(topics, OPPORTUNITY_TOPICS) ||
    (item.is_opportunity && item.action === "investigate_further");

  if (topics.has("community_projects")) return "People Are Building";

  if (
    SECURITY_NEWS_SOURCE_IDS.has(item.source_id) ||
    (topics.has("general_tech_security") && !isOpportunity)
  ) return "Security News";

  if (isUae && isOpportunity) return "UAE Opportunity";
  if (isOpportunity) return "Opportunity";
  if (isUae && isAi) return "UAE AI News";
  if (isUae) return "UAE News";
  if (topics.has("world_high_impact")) return "World News";

  if (isAi) {
    if (topics.has("openai_chatgpt_codex")) return "AI News: ChatGPT / Codex";
    if (topics.has("anthropic_claude")) return "AI News: Claude";
    if (topics.has("nvidia_ai_hardware")) return "AI News: NVIDIA";
    if (topics.has("xai_grok")) return "AI News: Grok";
    if (topics.has("ai_hardware_chips")) return "AI News: Hardware";
    if (topics.has("ai_agents_automation")) return "AI News: AI Agents";
    if (topics.has("ai_access_pricing")) return "AI News: Access and Pricing";
    if (topics.has("ai_models_releases")) return "AI News: New Models";
    return "AI News";
  }

  if (topics.has("robotics_ros2")) return "Robotics News";
  if (hasAny(topics, TECH_TOPICS)) return "Tech News";
  return "Tech News";
}

function sentenceParts(text: string): string[] {
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    return [...segmenter.segment(text)]
      .map((part) => part.segment.trim())
      .filter(Boolean);
  } catch {
    return (text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text])
      .map((part) => part.trim())
      .filter(Boolean);
  }
}

function removeBoilerplate(value: string): string {
  return value
    .replace(
      /^(?:today[,\s]+)?(?:we(?: are|[’']re)?\s+)?(?:are\s+)?(?:excited|pleased|thrilled|happy)\s+to\s+(?:announce|share|introduce)\s+(?:that\s+)?/i,
      "",
    )
    .replace(/\b(?:read|learn|find out) more\b.*$/i, "")
    .replace(/\bcontinue reading\b.*$/i, "")
    .replace(/\bthe post\b[\s\S]*?\bappeared first on\b[\s\S]*$/i, "")
    .trim();
}

function simplifyCommonTerms(value: string): string {
  let result = value;
  for (const [pattern, replacement] of SIMPLE_PHRASES) {
    result = result.replace(pattern, replacement);
  }
  result = cleanText(result, 3_500);
  if (!result) return "";
  return `${result[0].toUpperCase()}${result.slice(1)}`;
}

function trimAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const candidate = value.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const lastSpace = candidate.lastIndexOf(" ");
  const end = lastSpace >= Math.floor(maxLength * 0.65)
    ? candidate.slice(0, lastSpace)
    : candidate;
  return `${end.replace(/[,:;\-\s]+$/, "")}…`;
}

async function telegramCall<T>(
  method: string,
  payload: Record<string, unknown>,
  options: TelegramCallOptions = {},
): Promise<T> {
  const token = requiredEnv("TELEGRAM_BOT_TOKEN");
  let lastError = "Telegram request failed";
  let ambiguousFailure = false;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json() as TelegramEnvelope<T>;
      if (response.ok && body.ok && body.result !== undefined) {
        return body.result;
      }

      lastError = cleanText(
        body.description || `Telegram HTTP ${response.status}`,
        300,
      );
      const retryableResponse = response.status === 429 ||
        (response.status >= 500 && options.retryAmbiguousErrors !== false);
      if (attempt < 3 && retryableResponse) {
        const retrySeconds = Math.min(
          Math.max(body.parameters?.retry_after ?? attempt, 1),
          3,
        );
        await sleep(retrySeconds * 1_000);
        continue;
      }
      if (response.status >= 500 && options.retryAmbiguousErrors === false) {
        ambiguousFailure = true;
      }
      break;
    } catch (error) {
      lastError = safeError(error).replaceAll(token, "[telegram-token]");
      // A timed-out sendMessage may already have reached Telegram. Retrying it
      // immediately could create a duplicate because Telegram has no idempotency
      // key for this method. Only an explicit rate-limit response is safe to retry.
      if (options.retryAmbiguousErrors === false) {
        ambiguousFailure = true;
        break;
      }
      if (attempt < 3) {
        await sleep(attempt * 750);
        continue;
      }
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (ambiguousFailure) throw new AmbiguousTelegramError(lastError);
  throw new Error(lastError);
}

export function shortSummary(value: unknown, maxLength = 320): string {
  const text = cleanText(value, 3_500);
  if (!text) return "";

  const candidates = sentenceParts(text)
    .map(removeBoilerplate)
    .filter((sentence) => sentence.length >= 12);
  if (candidates.length === 0) {
    return trimAtWord(simplifyCommonTerms(text), maxLength);
  }

  const newsSignal =
    /\b(?:announc\w*|launch\w*|releas\w*|introduc\w*|unveil\w*|adds?|updated?|now available|can now|applications? (?:are )?open|deadline)\b/i;
  let selected = candidates[0];
  let bestScore = 1;
  for (const [index, sentence] of candidates.slice(0, 5).entries()) {
    const score = (index === 0 ? 1 : 0) + (newsSignal.test(sentence) ? 3 : 0);
    if (score > bestScore) {
      selected = sentence;
      bestScore = score;
    }
  }
  return trimAtWord(simplifyCommonTerms(selected), maxLength);
}

function compactSummary(item: NewsItemRow): string {
  const title = cleanText(item.title, 500);
  let sourceText = cleanText(item.summary, 3_500);
  const context = `${title} ${sourceText}`;

  if (item.is_opportunity) {
    const isUae = item.topic_tags.some((topic) => UAE_TOPICS.has(topic));
    const audience = isUae
      ? "that may accept people in the UAE"
      : "whose application rules need to be checked";
    if (/\b(?:intern(?:ship)?|job|role|vacanc|hiring)\b/i.test(title)) {
      return `${title} is a current job or internship listing ${audience}.`;
    }
    if (/\b(?:hackathon|competition|challenge)\b/i.test(title)) {
      return `${title} is a current competition or hackathon ${audience}.`;
    }
    if (
      /\b(?:course|training|bootcamp|certificate|certification)\b/i.test(title)
    ) {
      return `${title} is a current learning program ${audience}.`;
    }
    return `${title} is a current program or event ${audience}.`;
  }

  if (
    item.topic_tags.includes("nvidia_ai_hardware") &&
    /\bjetson\b/i.test(context) &&
    /\b(?:edge|on-device)\b/i.test(context) &&
    /\breasoning\b/i.test(context)
  ) {
    return "NVIDIA explains how its Jetson computers can run AI that solves problems in several steps directly on the device. This can help robots or smart machines work without sending every task to a cloud server.";
  }

  if (title && sourceText.toLowerCase().startsWith(title.toLowerCase())) {
    sourceText = sourceText.slice(title.length).replace(/^[\s:;|.\-–—]+/, "");
  }
  return shortSummary(sourceText || title);
}

export function newsReplyMarkup(
  itemId: string,
  expanded = false,
): Record<string, unknown> {
  return {
    inline_keyboard: [
      [0, 1, 2, 3].map((score) => ({
        text: String(score),
        callback_data: `r:${itemId}:${score}`,
      })),
      [
        { text: "More like this", callback_data: `p:${itemId}:1` },
        { text: "Less like this", callback_data: `p:${itemId}:-1` },
      ],
      [
        expanded
          ? { text: "Short version", callback_data: `s:${itemId}` }
          : { text: "Full story", callback_data: `f:${itemId}` },
      ],
    ],
  };
}

export function formatNewsMessage(
  item: NewsItemRow,
  sourceName: string,
  _position: number,
  _total: number,
  _heading = "News brief",
): string {
  const category = escapeHtml(newsTypeLabel(item));
  const summary = escapeHtml(compactSummary(item));
  const source = escapeHtml(cleanText(sourceName, 100));
  const url = escapeHtml(item.canonical_url);
  const opportunityNote = newsTypeLabel(item).includes("Opportunity")
    ? "<b>Before applying:</b> Check the deadline, cost, eligibility, certificate, and UAE availability on the source page."
    : null;
  const communityNote = item.topic_tags.includes("community_projects")
    ? "Shared by a community member; treat it as a lead, not a verified fact."
    : null;

  return [
    `<b>${category}</b>`,
    "",
    `<b>Here’s what’s happening:</b> ${summary}`,
    "",
    opportunityNote,
    opportunityNote ? "" : null,
    communityNote,
    communityNote ? "" : null,
    `<b>Source:</b> <a href="${url}">${source}</a>`,
  ].filter((line): line is string => line !== null).join("\n");
}

export function formatFullStoryMessage(
  item: NewsItemRow,
  sourceName: string,
): string {
  const category = escapeHtml(newsTypeLabel(item));
  const title = escapeHtml(cleanText(item.title, 400));
  const simple = escapeHtml(compactSummary(item));
  const details = escapeHtml(
    cleanText(item.summary, 2_300) ||
      "The feed did not include more detail for this item.",
  );
  const source = escapeHtml(cleanText(sourceName, 100));
  const url = escapeHtml(item.canonical_url);
  const opportunityNote = newsTypeLabel(item).includes("Opportunity")
    ? "<b>Before applying:</b> Check the deadline, cost, eligibility, certificate, and UAE availability on the source page."
    : null;

  return [
    `<b>${category}: Full story</b>`,
    "",
    `<b>${title}</b>`,
    "",
    `<b>In simple words:</b> ${simple}`,
    "",
    `<b>More detail:</b> ${details}`,
    "",
    opportunityNote,
    opportunityNote ? "" : null,
    `<b>Source:</b> <a href="${url}">${source}</a>`,
  ].filter((line): line is string => line !== null).join("\n");
}

export async function sendNewsMessage(
  item: NewsItemRow,
  sourceName: string,
  position: number,
  total: number,
  heading = "News brief",
): Promise<number> {
  const result = await telegramCall<SentMessage>("sendMessage", {
    chat_id: requiredEnv("TELEGRAM_CHAT_ID"),
    text: formatNewsMessage(item, sourceName, position, total, heading),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: newsReplyMarkup(item.id),
  }, { retryAmbiguousErrors: false });
  return result.message_id;
}

export async function editStoryMessage(
  item: NewsItemRow,
  sourceName: string,
  messageId: number,
  expanded: boolean,
): Promise<void> {
  try {
    await telegramCall<SentMessage>("editMessageText", {
      chat_id: requiredEnv("TELEGRAM_CHAT_ID"),
      message_id: messageId,
      text: expanded
        ? formatFullStoryMessage(item, sourceName)
        : formatNewsMessage(item, sourceName, 1, 1),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: newsReplyMarkup(item.id, expanded),
    });
  } catch (error) {
    if (safeError(error).toLowerCase().includes("message is not modified")) {
      return;
    }
    throw error;
  }
}

export async function sendSystemMessage(
  text: string,
  replyToMessageId?: number,
): Promise<number> {
  const result = await telegramCall<SentMessage>("sendMessage", {
    chat_id: requiredEnv("TELEGRAM_CHAT_ID"),
    text: cleanText(text, 3_900),
    disable_web_page_preview: true,
    ...(replyToMessageId
      ? {
        reply_parameters: {
          message_id: replyToMessageId,
          allow_sending_without_reply: true,
        },
      }
      : {}),
  }, { retryAmbiguousErrors: false });
  return result.message_id;
}

export async function answerCallback(
  callbackQueryId: string,
  text: string,
): Promise<void> {
  await telegramCall<boolean>("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: cleanText(text, 180),
    show_alert: false,
  });
}
