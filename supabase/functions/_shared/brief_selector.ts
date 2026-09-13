import type { NewsItemRow, TopicId, UserPreferenceRow } from "./types.ts";
import { preferenceMatchesItem } from "./preferences.ts";
import {
  hasDirectTechnicalTopic,
  isGenericTechnicalGuide,
  isRoutineStatusUpdate,
} from "./rules_analyzer.ts";

const PRIORITY_BUCKETS: ReadonlyArray<ReadonlySet<TopicId>> = [
  new Set<TopicId>(["anthropic_claude"]),
  new Set<TopicId>(["openai_chatgpt_codex"]),
  new Set<TopicId>(["nvidia_ai_hardware", "ai_hardware_chips"]),
  new Set<TopicId>(["xai_grok"]),
  new Set<TopicId>(["uae_relevant_news"]),
];

const CORE_NEWS_BUCKETS: ReadonlyArray<ReadonlySet<TopicId>> = [
  new Set<TopicId>(["applied_ai", "ai_models_releases"]),
  new Set<TopicId>(["world_high_impact"]),
];

const READABLE_NEWS_SOURCES = new Set(["techcrunch-ai", "the-verge-ai"]);
const MAX_ITEMS_PER_SOURCE = 2;
const OPPORTUNITY_TOPICS = new Set<TopicId>([
  "career_opportunities",
  "uae_jobs_internships",
  "uae_events_hackathons",
]);
const TECHNICAL_DETAIL_SOURCES = new Set([
  "nvidia-technical-blog",
  "hugging-face-blog",
  "aws-whats-new",
  "supabase-changelog",
  "n8n-blog",
  "docker-blog",
  "github-changelog",
  "python-insider",
  "ros-announcements",
]);
const MEANINGFUL_HARDWARE_PATTERN =
  /\b(?:blackwell|rubin|jetson|new (?:ai )?(?:gpu|chip|hardware)|launch(?:es|ed)? .{0,60}(?:gpu|chip|hardware))\b/i;

function itemTime(item: NewsItemRow): number {
  const published = item.published_at
    ? Date.parse(item.published_at)
    : Number.NaN;
  if (Number.isFinite(published)) return published;
  const discovered = Date.parse(item.discovered_at);
  return Number.isFinite(discovered) ? discovered : 0;
}

function preferenceAdjustment(
  item: NewsItemRow,
  preferences: readonly UserPreferenceRow[],
): { muted: boolean; score: number } {
  let score = 0;
  for (const preference of preferences) {
    if (!preferenceMatchesItem(preference, item)) continue;
    // A topic-only control such as "mute AWS" controls AWS news. It must not
    // accidentally hide an internship merely because its description mentions
    // AWS. Opportunity controls and custom keyword controls still apply.
    if (
      item.is_opportunity &&
      preference.match_terms.length === 0 &&
      preference.topic_tags.length > 0 &&
      !preference.topic_tags.some((topic) =>
        OPPORTUNITY_TOPICS.has(topic as TopicId)
      )
    ) continue;
    if (preference.level === -2) return { muted: true, score: -1_000 };
    score += preference.level === 1 ? 40 : -50;
  }
  return { muted: false, score };
}

function isValuable(item: NewsItemRow, scheduled: boolean): boolean {
  if (isRoutineStatusUpdate(item.source_id, item.title, item.summary)) {
    return false;
  }
  if (
    hasDirectTechnicalTopic(item.topic_tags) &&
    isGenericTechnicalGuide(item.title, item.summary)
  ) return false;
  if (!scheduled) return item.importance >= 2;
  if (
    TECHNICAL_DETAIL_SOURCES.has(item.source_id) &&
    item.importance < 5 &&
    !(
      item.topic_tags.includes("ai_models_releases") ||
      MEANINGFUL_HARDWARE_PATTERN.test(item.title)
    )
  ) return false;
  return item.is_opportunity ? item.importance >= 2 : item.importance >= 3;
}

function belongsTo(item: NewsItemRow, bucket: ReadonlySet<TopicId>): boolean {
  return item.topic_tags.some((topic) => bucket.has(topic));
}

export function selectDailyBrief(
  candidates: readonly NewsItemRow[],
  preferences: readonly UserPreferenceRow[],
  maximum = 10,
  options: { scheduled?: boolean } = {},
): NewsItemRow[] {
  const limit = Math.max(0, Math.min(Math.floor(maximum), 10));
  if (limit === 0) return [];
  const scheduled = options.scheduled !== false;

  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const eligible = candidates
    .filter((item) => {
      if (seenIds.has(item.id) || seenUrls.has(item.canonical_url)) {
        return false;
      }
      seenIds.add(item.id);
      seenUrls.add(item.canonical_url);
      return isValuable(item, scheduled) &&
        !preferenceAdjustment(item, preferences).muted;
    })
    .map((item) => ({
      item,
      score: item.importance * 100 +
        preferenceAdjustment(item, preferences).score,
      time: itemTime(item),
    }))
    .sort((left, right) =>
      right.score - left.score ||
      right.time - left.time ||
      left.item.id.localeCompare(right.item.id)
    );

  const selected: NewsItemRow[] = [];
  const selectedIds = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const canAdd = (item: NewsItemRow, enforceSourceLimit: boolean): boolean => {
    if (selectedIds.has(item.id)) return false;
    if (
      scheduled &&
      item.topic_tags.includes("general_tech_security") &&
      selected.some((entry) =>
        entry.topic_tags.includes("general_tech_security")
      )
    ) return false;
    return !enforceSourceLimit ||
      (sourceCounts.get(item.source_id) ?? 0) < MAX_ITEMS_PER_SOURCE;
  };
  const add = (item: NewsItemRow): void => {
    selected.push(item);
    selectedIds.add(item.id);
    sourceCounts.set(
      item.source_id,
      (sourceCounts.get(item.source_id) ?? 0) + 1,
    );
  };

  const opportunity = eligible.find((candidate) =>
    candidate.item.is_opportunity
  );
  // A full brief reserves one of its ten places for a real opportunity. If no
  // current, eligible opportunity exists, the brief stops at nine instead of
  // disguising ordinary news as an opportunity.
  const targetSize = scheduled && limit === 10 && !opportunity ? 9 : limit;
  if (scheduled && opportunity) add(opportunity.item);

  const readablePublisherItem = eligible.find((candidate) =>
    READABLE_NEWS_SOURCES.has(candidate.item.source_id) &&
    canAdd(candidate.item, true)
  );
  if (scheduled && readablePublisherItem && selected.length < targetSize) {
    add(readablePublisherItem.item);
  }

  // Give readable AI news and major world news a chance before technical or
  // security alerts can fill the brief.
  for (const bucket of CORE_NEWS_BUCKETS) {
    if (selected.length >= targetSize) break;
    const match = eligible.find((candidate) =>
      canAdd(candidate.item, true) && belongsTo(candidate.item, bucket)
    );
    if (match) add(match.item);
  }

  // Time-sensitive items come first, regardless of whether they fit a named slot.
  for (const candidate of eligible) {
    if (selected.length >= targetSize) break;
    if (candidate.item.importance === 5 && canAdd(candidate.item, true)) {
      add(candidate.item);
    }
  }

  // Take one useful item from each requested area when that area has real news.
  for (const bucket of PRIORITY_BUCKETS) {
    if (selected.length >= targetSize) break;
    const match = eligible.find((candidate) =>
      canAdd(candidate.item, true) && belongsTo(candidate.item, bucket)
    );
    if (match) add(match.item);
  }

  // Fill unused slots with the strongest remaining items without allowing one
  // publisher to take over the whole brief.
  for (const candidate of eligible) {
    if (selected.length >= targetSize) break;
    if (canAdd(candidate.item, true)) add(candidate.item);
  }

  return selected;
}
