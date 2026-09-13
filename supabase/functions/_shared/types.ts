export const TOPIC_IDS = [
  "anthropic_claude",
  "openai_chatgpt_codex",
  "nvidia_ai_hardware",
  "xai_grok",
  "ai_models_releases",
  "ai_access_pricing",
  "ai_hardware_chips",
  "applied_ai",
  "robotics_ros2",
  "python_apis",
  "ai_agents_automation",
  "developer_tools",
  "n8n",
  "aws_cloud",
  "supabase",
  "docker",
  "react_nextjs",
  "career_opportunities",
  "uae_relevant_news",
  "uae_jobs_internships",
  "uae_events_hackathons",
  "courses_certifications",
  "general_tech_security",
  "world_high_impact",
] as const;

export type TopicId = (typeof TOPIC_IDS)[number];

export type RecommendedAction =
  | "pursue"
  | "save_for_later"
  | "ignore"
  | "investigate_further";

export interface FeedSource {
  id: string;
  name: string;
  feed_url: string;
  homepage_url: string;
  trust_level: "official" | string;
  source_kind: "rss" | "atom" | "markdown" | string;
  base_priority: number;
  enabled: boolean;
  consecutive_failures?: number;
  last_success_at?: string | null;
}

export interface RawFeedItem {
  externalKey: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string | null;
}

export interface AnalyzedItem {
  source_id: string;
  external_key: string;
  canonical_url: string;
  title: string;
  summary: string;
  published_at: string | null;
  discovered_at: string;
  topic_tags: TopicId[];
  match_reasons: string[];
  importance: number;
  verification_status: "official_source_only";
  action: RecommendedAction;
  is_opportunity: boolean;
  suppressed_at?: string | null;
  suppression_reason?: string | null;
}

export interface NewsItemRow extends AnalyzedItem {
  id: string;
  sent_at: string | null;
  telegram_message_id: number | null;
  feedback_score: number | null;
  delivery_attempts: number;
}

export interface TopicWeightRow {
  topic: TopicId | string;
  weight: number;
  rating_count: number;
}

export type PreferenceLevel = -2 | -1 | 1;

export interface UserPreferenceRow {
  normalized_label: string;
  label: string;
  level: PreferenceLevel;
  topic_tags: string[];
  match_terms: string[];
  example_text: string | null;
  source_url: string | null;
  telegram_message_id: number | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface RunStats {
  sourcesOk: number;
  sourcesFailed: number;
  itemsFound: number;
  itemsSent: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from?: { id?: number | string };
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id?: number;
  from?: { id?: number | string };
  chat?: { id?: number | string };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id?: string; width?: number; height?: number }>;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id?: number;
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}
