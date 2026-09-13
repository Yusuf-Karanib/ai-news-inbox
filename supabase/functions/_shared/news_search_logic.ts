import type { FeedSource, NewsItemRow, TopicId } from "./types.ts";
import { isApprovedFeed } from "./feed_sources.ts";
import { preferenceMatchTerms, preferenceTopics } from "./preferences.ts";
import { cleanText } from "./utils.ts";

const MAX_SOURCES = 30;
export const MAX_SEARCH_RESULTS = 5;
export const ON_DEMAND_FEED_TIMEOUT_MS = 6_000;

const BROAD_AI_TOPICS = new Set<TopicId>([
  "anthropic_claude",
  "openai_chatgpt_codex",
  "nvidia_ai_hardware",
  "xai_grok",
  "ai_models_releases",
  "ai_access_pricing",
  "ai_hardware_chips",
  "applied_ai",
  "ai_agents_automation",
  "developer_tools",
]);

const TOPIC_SOURCE_IDS: Readonly<Partial<Record<TopicId, readonly string[]>>> =
  Object.freeze({
    anthropic_claude: ["anthropic-platform-releases", "anthropic-status"],
    openai_chatgpt_codex: [
      "openai-news",
      "openai-codex-releases",
      "openai-status",
    ],
    nvidia_ai_hardware: ["nvidia-ai-news", "nvidia-technical-blog", "amd-news"],
    xai_grok: ["xai-release-notes", "xai-status"],
    ai_models_releases: [
      "openai-news",
      "anthropic-platform-releases",
      "xai-release-notes",
      "google-deepmind",
      "hugging-face-blog",
      "microsoft-ai-news",
      "techcrunch-ai",
      "the-verge-ai",
    ],
    ai_access_pricing: [
      "openai-news",
      "openai-status",
      "anthropic-platform-releases",
      "anthropic-status",
      "xai-release-notes",
      "xai-status",
    ],
    ai_hardware_chips: ["nvidia-ai-news", "nvidia-technical-blog", "amd-news"],
    applied_ai: [
      "openai-news",
      "google-deepmind",
      "hugging-face-blog",
      "microsoft-ai-news",
      "nvidia-ai-news",
      "techcrunch-ai",
      "the-verge-ai",
    ],
    robotics_ros2: ["ros-announcements", "nvidia-technical-blog"],
    python_apis: ["python-insider", "github-changelog"],
    ai_agents_automation: [
      "openai-news",
      "openai-codex-releases",
      "anthropic-platform-releases",
      "xai-release-notes",
      "n8n-blog",
      "github-changelog",
    ],
    developer_tools: [
      "openai-codex-releases",
      "github-changelog",
      "n8n-blog",
      "supabase-changelog",
    ],
    n8n: ["n8n-blog"],
    aws_cloud: ["aws-whats-new", "aws-security-bulletins"],
    supabase: ["supabase-changelog"],
    docker: ["docker-blog", "docker-security-announcements"],
    react_nextjs: ["github-changelog"],
    career_opportunities: [
      "jobicy-uae-internships",
      "42-abu-dhabi",
      "dubai-future-foundation",
    ],
    uae_relevant_news: ["42-abu-dhabi", "dubai-future-foundation"],
    uae_jobs_internships: [
      "jobicy-uae-internships",
      "42-abu-dhabi",
      "dubai-future-foundation",
    ],
    uae_events_hackathons: ["42-abu-dhabi", "dubai-future-foundation"],
    courses_certifications: ["42-abu-dhabi", "dubai-future-foundation"],
    general_tech_security: [
      "github-changelog",
      "docker-security-announcements",
      "aws-security-bulletins",
    ],
    world_high_impact: ["bbc-world", "aljazeera-news"],
  });

export type SearchMode = "personalized" | "broad_ai" | "specific";

export interface SearchIntent {
  mode: SearchMode;
  topics: TopicId[];
  terms: string[];
}

function isBroadAiQuery(query: string): boolean {
  return /^(?:(?:latest|recent|new)\s+)?(?:ai|artificial intelligence)(?:\s+news)?$/i
    .test(query);
}

export function searchIntent(value: unknown): SearchIntent {
  const query = cleanText(value, 160);
  if (!query) return { mode: "personalized", topics: [], terms: [] };
  if (isBroadAiQuery(query)) {
    return { mode: "broad_ai", topics: [...BROAD_AI_TOPICS], terms: [] };
  }

  return {
    mode: "specific",
    topics: preferenceTopics(query),
    terms: preferenceMatchTerms(query),
  };
}

export function sourcesForSearch(
  candidateSources: readonly FeedSource[],
  query: unknown,
): FeedSource[] {
  const approved = candidateSources.filter(isApprovedFeed);
  const intent = searchIntent(query);
  if (intent.mode !== "specific" || intent.topics.length === 0) {
    return approved.slice(0, MAX_SOURCES);
  }

  const wantedIds = new Set<string>();
  for (const topic of intent.topics) {
    for (const sourceId of TOPIC_SOURCE_IDS[topic] ?? []) {
      wantedIds.add(sourceId);
    }
  }
  const matched = approved.filter((source) => wantedIds.has(source.id));
  return (matched.length > 0 ? matched : approved).slice(0, MAX_SOURCES);
}

export function matchesSearchQuery(item: NewsItemRow, query: unknown): boolean {
  const intent = searchIntent(query);
  if (intent.mode === "personalized") return true;
  if (intent.mode === "broad_ai") {
    return intent.topics.some((topic) => item.topic_tags.includes(topic));
  }

  const topicsMatch = intent.topics.length === 1
    ? item.topic_tags.includes(intent.topics[0])
    : intent.topics.length > 1 &&
      intent.topics.every((topic) => item.topic_tags.includes(topic));
  if (topicsMatch) {
    return true;
  }
  if (intent.terms.length === 0) return false;

  const text = cleanText(`${item.title} ${item.summary}`, 5_000).toLowerCase();
  const matchCount =
    intent.terms.filter((term) => text.includes(term.toLowerCase())).length;
  const required = intent.terms.length <= 2
    ? intent.terms.length
    : Math.min(3, Math.ceil(intent.terms.length / 2));
  return matchCount >= required;
}
