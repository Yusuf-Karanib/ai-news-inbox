import { XMLParser } from "npm:fast-xml-parser@5.2.5";
import { isApprovedFeed, isApprovedRedirect } from "./feed_sources.ts";
import { newestFeedItems } from "./feed_item_order.ts";
import { parseMarkdownReleaseNotes } from "./markdown_feed_parser.ts";
import type { FeedSource, RawFeedItem } from "./types.ts";
import { canonicalizeUrl, cleanText, parseDate } from "./utils.ts";

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS_PER_FEED = 80;
const MAX_REDIRECTS = 3;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
});

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(scalarText).find(Boolean) ?? "";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return scalarText(record["#text"] ?? record._ ?? record.value ?? "");
  }
  return "";
}

function atomLink(value: unknown): string {
  for (const link of asArray(value)) {
    if (typeof link === "string") return link;
    if (!link || typeof link !== "object") continue;
    const record = link as Record<string, unknown>;
    const relation = scalarText(record["@_rel"]);
    const href = scalarText(record["@_href"]);
    if (href && (!relation || relation === "alternate")) return href;
  }
  return "";
}

function readEntries(document: Record<string, unknown>): unknown[] {
  const rss = document.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel?.item) return asArray(channel.item);

  const feed = document.feed as Record<string, unknown> | undefined;
  if (feed?.entry) return asArray(feed.entry);

  const rdf = (document.RDF ?? document.rdf) as Record<string, unknown> | undefined;
  if (rdf?.item) return asArray(rdf.item);
  return [];
}

function entryToItem(entry: unknown, source: FeedSource): RawFeedItem | null {
  if (!entry || typeof entry !== "object") return null;
  const item = entry as Record<string, unknown>;
  const title = cleanText(scalarText(item.title), 500);
  const identifierUrl = scalarText(item.guid) || scalarText(item.id);
  const rawUrl = scalarText(item.link) || atomLink(item.link) || scalarText(item.url) ||
    (/^https?:\/\//i.test(identifierUrl) ? identifierUrl : "");
  const url = canonicalizeUrl(rawUrl, source.homepage_url || source.feed_url, {
    preserveHash: source.id === "docker-security-announcements",
  });
  if (!title || !url) return null;

  const rawId = scalarText(item.guid) || scalarText(item.id) || url;
  const externalKey = cleanText(rawId, 1_000) || url;
  const summary = cleanText(
    scalarText(item.description) || scalarText(item.summary) ||
      scalarText(item.encoded) || scalarText(item.content),
    3_500,
  );
  const publishedAt = parseDate(
    item.pubDate ?? item.published ?? item.updated ?? item.date ?? item.created,
  );

  return { externalKey, title, summary, url, publishedAt };
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_FEED_BYTES) throw new Error("Feed exceeds the 2 MB limit");
  if (!response.body) throw new Error("Feed response had no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      await reader.cancel("Feed exceeded size limit");
      throw new Error("Feed exceeds the 2 MB limit");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchWithControlledRedirects(
  source: FeedSource,
  signal: AbortSignal,
): Promise<Response> {
  let nextUrl = source.feed_url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(nextUrl, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        // Two official documentation feeds return a false 404 when a narrow
        // Accept header or Deno's default identifier is used. A normal generic
        // machine client request works for both and for the XML feeds.
        "user-agent": "node",
      },
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Feed redirect had no location");
    const resolved = new URL(location, nextUrl).toString();
    if (!isApprovedRedirect(source.id, resolved)) {
      throw new Error("Feed redirected outside its approved host");
    }
    nextUrl = resolved;
  }

  throw new Error("Feed redirected too many times");
}

export async function fetchAndParseFeed(
  source: FeedSource,
  timeoutMilliseconds = 12_000,
): Promise<RawFeedItem[]> {
  if (!isApprovedFeed(source)) throw new Error("Feed is not on the fixed allowlist");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetchWithControlledRedirects(source, controller.signal);
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
    const body = await readLimitedBody(response);
    if (source.source_kind === "markdown") {
      return parseMarkdownReleaseNotes(body, source);
    }
    let document: Record<string, unknown>;
    try {
      document = parser.parse(body) as Record<string, unknown>;
    } catch {
      throw new Error("Feed XML could not be parsed");
    }

    const entries = readEntries(document);
    const parsedItems = entries
      .map((entry) => entryToItem(entry, source))
      .filter((item): item is RawFeedItem => item !== null);
    return newestFeedItems(parsedItems, MAX_ITEMS_PER_FEED);
  } finally {
    clearTimeout(timeout);
  }
}
