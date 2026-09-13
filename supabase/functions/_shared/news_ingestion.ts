import type {
  AnalyzedItem,
  FeedSource,
  TopicWeightRow,
} from "./types.ts";
import { isApprovedFeed } from "./feed_sources.ts";
import { fetchAndParseFeed } from "./feed_parser.ts";
import { analyzeItem } from "./rules_analyzer.ts";
import { adminClient } from "./supabase.ts";
import { safeError } from "./utils.ts";

const SAFE_UNDATED_DELTA_SOURCES = new Set([
  "docker-security-announcements",
  "xai-release-notes",
]);

type Database = ReturnType<typeof adminClient>;

export interface IngestionOptions {
  catchUpDays?: number;
  feedTimeoutMilliseconds?: number;
  maxItemsPerSource?: number;
}

export interface IngestionResult {
  sources: FeedSource[];
  sourcesOk: number;
  sourcesFailed: number;
  itemsFound: number;
  cutoffMilliseconds: number;
}

function recentEnough(publishedAt: string | null, cutoffMilliseconds: number): boolean {
  if (!publishedAt) return false;
  const value = Date.parse(publishedAt);
  return Number.isFinite(value) && value >= cutoffMilliseconds;
}

async function updateSourceSuccess(database: Database, sourceId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await database.from("news_sources").update({
    last_checked_at: now,
    last_success_at: now,
    last_error: null,
    consecutive_failures: 0,
    updated_at: now,
  }).eq("id", sourceId);
  if (error) console.error(`Source status update failed for ${sourceId}: ${safeError(error.message)}`);
}

async function updateSourceFailure(
  database: Database,
  source: FeedSource,
  failure: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await database.from("news_sources").update({
    last_checked_at: now,
    last_error: safeError(failure),
    consecutive_failures: Math.max(Number(source.consecutive_failures) || 0, 0) + 1,
    updated_at: now,
  }).eq("id", source.id);
  if (error) console.error(`Source failure status update failed for ${source.id}: ${safeError(error.message)}`);
}

async function storeItems(database: Database, items: AnalyzedItem[]): Promise<void> {
  for (let start = 0; start < items.length; start += 100) {
    const { error } = await database.rpc("store_news_items", {
      p_items: items.slice(start, start + 100),
    });
    if (error) throw new Error(`Could not store news: ${error.message}`);
  }
}

export async function ingestNewsSources(
  database: Database,
  candidateSources: readonly FeedSource[],
  topicWeights: TopicWeightRow[],
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const sources = candidateSources.filter(isApprovedFeed);
  if (sources.length === 0) throw new Error("No approved feeds are enabled");

  const catchUpDays = Math.max(1, Math.min(Math.floor(options.catchUpDays ?? 7), 30));
  const feedTimeoutMilliseconds = Math.max(
    2_000,
    Math.min(Math.floor(options.feedTimeoutMilliseconds ?? 12_000), 20_000),
  );
  const maxItemsPerSource = Math.max(
    1,
    Math.min(Math.floor(options.maxItemsPerSource ?? 80), 80),
  );
  const now = new Date();
  const cutoffMilliseconds = now.getTime() - catchUpDays * 24 * 60 * 60 * 1_000;
  const baselineKeys = sources
    .filter((source) => SAFE_UNDATED_DELTA_SOURCES.has(source.id))
    .map((source) => `undated_baseline:${source.id}`);

  let baselineData: Array<{ key: string; value: { at?: unknown } }> = [];
  if (baselineKeys.length > 0) {
    const { data, error } = await database.from("news_state").select("key,value").in("key", baselineKeys);
    if (error) throw new Error(`Could not load undated-feed state: ${error.message}`);
    baselineData = (data ?? []) as Array<{ key: string; value: { at?: unknown } }>;
  }

  const baselineTimes = new Map<string, number>();
  for (const row of baselineData) {
    const parsed = typeof row.value?.at === "string" ? Date.parse(row.value.at) : Number.NaN;
    if (Number.isFinite(parsed)) baselineTimes.set(row.key, parsed);
  }

  const feedResults = await Promise.allSettled(sources.map(async (source) => {
    const rawItems = await fetchAndParseFeed(source, feedTimeoutMilliseconds);
    await updateSourceSuccess(database, source.id);
    return rawItems.slice(0, maxItemsPerSource);
  }));

  const analyzedByUrl = new Map<string, AnalyzedItem>();
  const successfulUndatedSources = new Set<string>();
  const feedErrors: string[] = [];
  let sourcesOk = 0;
  let sourcesFailed = 0;

  for (let index = 0; index < feedResults.length; index += 1) {
    const result = feedResults[index];
    const source = sources[index];
    if (result.status === "rejected") {
      sourcesFailed += 1;
      const message = safeError(result.reason);
      feedErrors.push(`${source.id}: ${message}`);
      console.error(`Feed failed for ${source.id}: ${message}`);
      await updateSourceFailure(database, source, message);
      continue;
    }

    sourcesOk += 1;
    const baselineKey = `undated_baseline:${source.id}`;
    const baselineTime = baselineTimes.get(baselineKey) ?? Number.NaN;
    const hasRecentBaseline = Number.isFinite(baselineTime) && baselineTime >= cutoffMilliseconds;
    if (SAFE_UNDATED_DELTA_SOURCES.has(source.id)) successfulUndatedSources.add(source.id);

    for (const rawItem of result.value) {
      if (!rawItem.url.startsWith("https://")) continue;
      const isSafeUndatedDelta = !rawItem.publishedAt && SAFE_UNDATED_DELTA_SOURCES.has(source.id);
      if (!isSafeUndatedDelta && !recentEnough(rawItem.publishedAt, cutoffMilliseconds)) continue;

      const analyzed = analyzeItem(source, rawItem, topicWeights, now);
      if (!analyzed || analyzedByUrl.has(analyzed.canonical_url)) continue;
      if (isSafeUndatedDelta && !hasRecentBaseline) {
        analyzed.suppressed_at = now.toISOString();
        analyzed.suppression_reason = "initial_or_stale_undated_feed_baseline";
      }
      analyzedByUrl.set(analyzed.canonical_url, analyzed);
    }
  }

  if (sourcesOk === 0) {
    throw new Error(`Every feed failed. ${feedErrors.slice(0, 3).join("; ")}`);
  }

  const analyzedItems = [...analyzedByUrl.values()];
  if (analyzedItems.length > 0) await storeItems(database, analyzedItems);

  if (successfulUndatedSources.size > 0) {
    const completedAt = new Date().toISOString();
    const { error } = await database.from("news_state").upsert(
      [...successfulUndatedSources].map((sourceId) => ({
        key: `undated_baseline:${sourceId}`,
        value: { at: completedAt },
        updated_at: completedAt,
      })),
      { onConflict: "key" },
    );
    if (error) throw new Error(`Could not save undated-feed baseline: ${error.message}`);
  }

  return {
    sources,
    sourcesOk,
    sourcesFailed,
    itemsFound: analyzedItems.length,
    cutoffMilliseconds,
  };
}
