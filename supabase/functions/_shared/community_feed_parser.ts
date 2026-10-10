import type { RawFeedItem } from "./types.ts";
import { canonicalizeUrl, cleanText } from "./utils.ts";

export function hackerNewsItem(value: unknown): RawFeedItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = Number(item.id);
  const title = cleanText(item.title, 500);
  if (!Number.isSafeInteger(id) || !title || item.deleted || item.dead) {
    return null;
  }

  const author = cleanText(item.by, 100);
  const description = cleanText(item.text, 2_800);
  const projectUrl = canonicalizeUrl(String(item.url ?? ""));
  const discussionUrl = `https://news.ycombinator.com/item?id=${id}`;
  const summary = cleanText(
    [
      author
        ? `${author} shared this project.`
        : "A developer shared this project.",
      description,
      projectUrl ? `Project link: ${projectUrl}` : "",
    ].filter(Boolean).join(" "),
    3_500,
  );
  const timestamp = Number(item.time);
  const publishedAt = Number.isFinite(timestamp)
    ? new Date(timestamp * 1_000).toISOString()
    : null;

  return {
    externalKey: String(id),
    title,
    summary,
    url: discussionUrl,
    publishedAt,
  };
}
