import type {
  FeedSource,
  NewsItemRow,
  TopicWeightRow,
  UserPreferenceRow,
} from "./types.ts";
import { selectDailyBrief } from "./brief_selector.ts";
import { isApprovedFeed } from "./feed_sources.ts";
import { ingestNewsSources } from "./news_ingestion.ts";
import {
  matchesSearchQuery,
  MAX_SEARCH_RESULTS,
  ON_DEMAND_FEED_TIMEOUT_MS,
  searchIntent,
  sourcesForSearch,
} from "./news_search_logic.ts";
import { adminClient } from "./supabase.ts";
import { cleanText, safeError } from "./utils.ts";

const MAX_SOURCES = 30;
const MAX_CANDIDATES = 300;

type Database = ReturnType<typeof adminClient>;

export interface OnDemandSearchResult {
  items: NewsItemRow[];
  sourceNames: Map<string, string>;
  sourcesChecked: number;
  sourcesOk: number;
  sourcesFailed: number;
  refreshError: string | null;
}

export async function findOnDemandNews(
  database: Database,
  query: string,
): Promise<OnDemandSearchResult> {
  const cleanQuery = cleanText(query, 160);
  if (/https?:\/\//i.test(cleanQuery)) {
    throw new Error("Search queries cannot contain links");
  }

  const [sourceResult, weightResult, preferenceResult] = await Promise.all([
    database.from("news_sources").select("*").eq("enabled", true)
      .order("base_priority", { ascending: false })
      .order("id", { ascending: true })
      .limit(MAX_SOURCES),
    database.from("topic_weights").select("topic,weight,rating_count"),
    database.from("user_preferences").select("*").eq("active", true),
  ]);
  if (sourceResult.error) {
    throw new Error(`Could not load sources: ${sourceResult.error.message}`);
  }
  if (weightResult.error) {
    throw new Error(
      `Could not load topic weights: ${weightResult.error.message}`,
    );
  }
  if (preferenceResult.error) {
    throw new Error(
      `Could not load preferences: ${preferenceResult.error.message}`,
    );
  }

  const allSources = ((sourceResult.data ?? []) as FeedSource[]).filter(
    isApprovedFeed,
  );
  const selectedSources = sourcesForSearch(allSources, cleanQuery);
  if (selectedSources.length === 0) {
    throw new Error("No approved feeds are enabled");
  }

  let sourcesOk = 0;
  let sourcesFailed = 0;
  let refreshError: string | null = null;
  try {
    const ingestion = await ingestNewsSources(
      database,
      selectedSources,
      (weightResult.data ?? []) as TopicWeightRow[],
      {
        catchUpDays: 7,
        feedTimeoutMilliseconds: ON_DEMAND_FEED_TIMEOUT_MS,
        maxItemsPerSource: 30,
      },
    );
    sourcesOk = ingestion.sourcesOk;
    sourcesFailed = ingestion.sourcesFailed;
  } catch (error) {
    refreshError = safeError(error);
    sourcesFailed = selectedSources.length;
  }

  const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000)
    .toISOString();
  const { data: candidateData, error: candidateError } = await database
    .from("news_items")
    .select("*")
    .is("sent_at", null)
    .is("suppressed_at", null)
    .gte("discovered_at", cutoffIso)
    .order("importance", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("discovered_at", { ascending: false })
    .limit(MAX_CANDIDATES);
  if (candidateError) {
    throw new Error(`Could not load search results: ${candidateError.message}`);
  }

  const intent = searchIntent(cleanQuery);
  const preferences = (preferenceResult.data ?? []) as UserPreferenceRow[];
  const selectionPreferences = intent.mode === "specific"
    ? preferences.filter((preference) => preference.level !== -2)
    : preferences;
  const matches = ((candidateData ?? []) as NewsItemRow[])
    .filter((item) => matchesSearchQuery(item, cleanQuery));
  const items = selectDailyBrief(
    matches,
    selectionPreferences,
    MAX_SEARCH_RESULTS,
    {
      scheduled: false,
    },
  );

  return {
    items,
    sourceNames: new Map(allSources.map((source) => [source.id, source.name])),
    sourcesChecked: selectedSources.length,
    sourcesOk,
    sourcesFailed,
    refreshError,
  };
}
