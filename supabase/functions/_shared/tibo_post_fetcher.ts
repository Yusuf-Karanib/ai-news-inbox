import type { RawFeedItem } from "./types.ts";
import type { ResetAlertKind, ResetWatchPost } from "./reset_watch_logic.ts";
import { classifyResetPost } from "./reset_watch_logic.ts";
import { cleanText, parseDate } from "./utils.ts";

export interface TiboStatusReference {
  postId: string;
  postUrl: string;
  publishedAt: string;
}

export interface VerifiedTiboPost {
  postId: string;
  postUrl: string;
  text: string;
  publishedAt: string;
  kind: ResetAlertKind | null;
}

function exactTiboStatus(value: string): TiboStatusReference | null {
  const match = value.match(
    /https:\/\/x[.]com\/thsottiaux\/status\/([0-9]{8,30})/i,
  );
  if (!match) return null;
  return {
    postId: match[1],
    postUrl: `https://x.com/thsottiaux/status/${match[1]}`,
    publishedAt: "",
  };
}

export function tiboStatusReference(
  item: RawFeedItem,
): TiboStatusReference | null {
  const reference = exactTiboStatus(`${item.url} ${item.summary}`);
  const publishedAt = parseDate(item.publishedAt);
  if (!reference || !publishedAt) return null;
  return { ...reference, publishedAt };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseVerifiedTiboPost(
  value: unknown,
  expected: TiboStatusReference,
): VerifiedTiboPost | null {
  const envelope = record(value);
  const tweet = record(envelope?.tweet);
  const author = record(tweet?.author);
  if (
    !tweet || !author || String(tweet.id ?? "") !== expected.postId ||
    String(author.screen_name ?? "").toLowerCase() !== "thsottiaux"
  ) return null;

  const exactUrl = exactTiboStatus(String(tweet.url ?? ""));
  if (!exactUrl || exactUrl.postId !== expected.postId) return null;
  const text = cleanText(tweet.text, 900);
  if (!text) return null;

  const quote = record(tweet.quote);
  const quoteAuthor = record(quote?.author);
  const quoteText = String(quoteAuthor?.screen_name ?? "").toLowerCase() ===
      "thsottiaux"
    ? cleanText(quote?.text, 1_200)
    : "";
  const timestamp = Number(tweet.created_timestamp);
  const publishedAt = Number.isSafeInteger(timestamp) && timestamp > 0
    ? new Date(timestamp * 1_000).toISOString()
    : parseDate(tweet.created_at);
  if (!publishedAt) return null;

  return {
    postId: expected.postId,
    postUrl: expected.postUrl,
    text,
    publishedAt,
    kind: classifyResetPost(text, quoteText),
  };
}

export function actionableResetPost(
  post: VerifiedTiboPost,
): ResetWatchPost | null {
  if (!post.kind) return null;
  return { ...post, kind: post.kind };
}

export async function fetchVerifiedTiboPost(
  reference: TiboStatusReference,
  timeoutMilliseconds = 10_000,
): Promise<VerifiedTiboPost> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetch(
      `https://api.fxtwitter.com/thsottiaux/status/${reference.postId}`,
      {
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "Yusuf-AI-News-Inbox/1.0",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Tibo post lookup returned HTTP ${response.status}`);
    }
    const maximumBytes = 128 * 1024;
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maximumBytes) {
      throw new Error("Tibo post lookup response was too large");
    }
    if (!response.body) {
      throw new Error("Tibo post lookup had no response body");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("Tibo post lookup exceeded its size limit");
        throw new Error("Tibo post lookup response was too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = new TextDecoder().decode(bytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("Tibo post lookup did not return JSON");
    }
    const verified = parseVerifiedTiboPost(parsed, reference);
    if (!verified) throw new Error("Tibo post lookup failed validation");
    return verified;
  } finally {
    clearTimeout(timeout);
  }
}
