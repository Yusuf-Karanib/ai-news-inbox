import type { FeedSource, RawFeedItem } from "./types.ts";
import { canonicalizeUrl, cleanText } from "./utils.ts";

const MAX_ITEMS = 80;

function markdownHeadingSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "release-note";
}

function cleanMarkdown(value: string): string {
  return cleanText(
    value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_>#~-]+/g, " "),
    3_500,
  );
}

export function parseMarkdownReleaseNotes(
  markdown: string,
  source: FeedSource,
): RawFeedItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: RawFeedItem[] = [];
  let section = "";
  let title = "";
  let body: string[] = [];
  let insideFence = false;

  const finish = (): void => {
    if (!title) return;
    const page = canonicalizeUrl(
      source.homepage_url || source.feed_url,
      undefined,
      {
        preserveHash: true,
      },
    );
    if (!page) return;
    items.push({
      externalKey: cleanText(`${section}:${title}`, 1_000),
      title: cleanText(title, 500),
      summary: cleanMarkdown(body.join("\n")),
      url: `${page.replace(/#.*$/, "")}#${markdownHeadingSlug(title)}`,
      // The machine-readable file gives a month, not a reliable item day.
      // First-seen delta handling is safer than inventing a precise date.
      publishedAt: null,
    });
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      insideFence = !insideFence;
      if (title) body.push(line);
      continue;
    }
    if (insideFence) {
      if (title) body.push(line);
      continue;
    }

    const sectionMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (sectionMatch) {
      finish();
      title = "";
      body = [];
      section = cleanText(sectionMatch[1], 80);
      continue;
    }
    const itemMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (itemMatch) {
      finish();
      title = cleanText(itemMatch[1], 500);
      body = [];
      continue;
    }
    if (title) body.push(line);
  }
  finish();
  return items.slice(0, MAX_ITEMS);
}
