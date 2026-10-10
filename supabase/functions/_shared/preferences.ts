import type {
  NewsItemRow,
  PreferenceLevel,
  TopicId,
  UserPreferenceRow,
} from "./types.ts";
import { canonicalizeUrl, cleanText } from "./utils.ts";

export const TOPIC_LABELS: Readonly<Record<TopicId, string>> = Object.freeze({
  anthropic_claude: "Claude / Anthropic",
  openai_chatgpt_codex: "ChatGPT / Codex / OpenAI",
  nvidia_ai_hardware: "NVIDIA AI",
  xai_grok: "Grok / xAI",
  ai_models_releases: "major AI model releases",
  ai_access_pricing: "AI usage resets, limits, and pricing",
  ai_hardware_chips: "AI hardware and chips",
  applied_ai: "applied AI",
  robotics_ros2: "robotics and ROS 2",
  python_apis: "Python and APIs",
  ai_agents_automation: "AI agents and automation",
  developer_tools: "developer tools",
  n8n: "n8n",
  aws_cloud: "AWS",
  supabase: "Supabase",
  docker: "Docker",
  react_nextjs: "React and Next.js",
  career_opportunities: "internships, programs, and opportunities",
  uae_relevant_news: "UAE news relevant to Yusuf",
  uae_jobs_internships: "UAE jobs and internships",
  uae_events_hackathons: "UAE programs, events, and hackathons",
  courses_certifications: "useful courses and certifications",
  general_tech_security: "important technology and security changes",
  world_high_impact: "major world news",
  community_projects: "things people are building",
});

const PREFERENCE_TOPIC_RULES: ReadonlyArray<readonly [TopicId, RegExp]> = [
  [
    "anthropic_claude",
    /\b(?:anthropic|claude(?:\s+(?:code|ai|opus|sonnet|haiku))?)\b/i,
  ],
  ["openai_chatgpt_codex", /\b(?:openai|chatgpt|codex|gpt[- ]?\d|sora)\b/i],
  ["nvidia_ai_hardware", /\b(?:nvidia|cuda|dgx|geforce|blackwell|rubin)\b/i],
  ["xai_grok", /\b(?:grok|xai|x\.ai)\b/i],
  [
    "ai_access_pricing",
    /\b(?:usage resets?|reset(?:s|ting)? (?:the )?(?:usage|limit)|rate limit|usage limit|message limit|subscription|credits?|quota|free access|pricing)\b/i,
  ],
  [
    "ai_hardware_chips",
    /\b(?:ai hardware|gpu|npu|tpu|ai chip|accelerator chip|semiconductor|data cent(?:er|re) chip)\b/i,
  ],
  [
    "ai_models_releases",
    /\b(?:new ai model|model release|frontier model|open[- ]weight model|multimodal model)\b/i,
  ],
  [
    "ai_agents_automation",
    /\b(?:ai agents?|agentic|automation|mcp|model context protocol|openbento|openclaw)\b/i,
  ],
  ["robotics_ros2", /\b(?:robotics?|ros\s*2|gazebo|humanoid)\b/i],
  ["python_apis", /\b(?:python|apis?|fastapi|webhooks?)\b/i],
  [
    "developer_tools",
    /\b(?:developer tools?|coding tools?|software development|github|git)\b/i,
  ],
  ["n8n", /\bn8n\b/i],
  ["aws_cloud", /\b(?:aws|amazon web services|bedrock|sagemaker)\b/i],
  ["supabase", /\bsupabase\b/i],
  ["docker", /\b(?:docker|containers?)\b/i],
  ["react_nextjs", /\b(?:react|next\.?js|typescript)\b/i],
  [
    "uae_jobs_internships",
    /\b(?:uae|dubai|abu dhabi|sharjah|mina zayed).{0,80}\b(?:jobs?|hiring|internships?|vacanc(?:y|ies))\b|\b(?:jobs?|hiring|internships?|vacanc(?:y|ies)).{0,80}\b(?:uae|dubai|abu dhabi|sharjah|mina zayed)\b/i,
  ],
  [
    "uae_events_hackathons",
    /\b(?:uae|dubai|abu dhabi|sharjah).{0,80}\b(?:events?|programs?|hackathons?|fellowships?|grants?|competitions?|accelerators?)\b|\b(?:events?|programs?|hackathons?|fellowships?|grants?|competitions?|accelerators?).{0,80}\b(?:uae|dubai|abu dhabi|sharjah)\b/i,
  ],
  [
    "uae_relevant_news",
    /\b(?:uae|united arab emirates|dubai|abu dhabi|sharjah|emirates?)\b/i,
  ],
  [
    "career_opportunities",
    /\b(?:internships?|jobs?|hiring|programs?|hackathons?|fellowships?|grants?|competitions?|accelerators?|applications? open)\b/i,
  ],
  [
    "courses_certifications",
    /\b(?:courses?|certifications?|training|bootcamps?)\b/i,
  ],
  [
    "general_tech_security",
    /\b(?:cybersecurity|security advisory|vulnerabilit(?:y|ies)|zero[- ]day|data breach|breaking change|deprecation)\b/i,
  ],
  [
    "world_high_impact",
    /\b(?:world news|global news|geopolitics|major international news)\b/i,
  ],
  [
    "community_projects",
    /\b(?:things people (?:are )?build(?:ing)?|community projects?|indie projects?|show hn|showdev|people inventing)\b/i,
  ],
];

const DOMAIN_TOPICS: ReadonlyArray<readonly [RegExp, readonly TopicId[]]> = [
  [/\b(?:anthropic\.com|claude\.ai)\b/i, ["anthropic_claude"]],
  [/\b(?:openai\.com|chatgpt\.com)\b/i, ["openai_chatgpt_codex"]],
  [/\bnvidia\.com\b/i, ["nvidia_ai_hardware"]],
  [/\b(?:x\.ai|grok\.com)\b/i, ["xai_grok"]],
  [/\b(?:huggingface\.co|deepmind\.google|mistral\.ai)\b/i, [
    "ai_models_releases",
  ]],
  [/\b(?:thsottiaux|openai|chatgpt|codex)\b/i, ["openai_chatgpt_codex"]],
];

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "because",
  "before",
  "being",
  "but",
  "can",
  "could",
  "does",
  "from",
  "give",
  "have",
  "here",
  "into",
  "just",
  "like",
  "more",
  "news",
  "only",
  "please",
  "post",
  "really",
  "say",
  "show",
  "some",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "update",
  "want",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
  "you",
  "http",
  "https",
  "www",
  "com",
]);

function uniqueTopics(values: readonly string[]): TopicId[] {
  const valid = new Set(Object.keys(TOPIC_LABELS));
  return [
    ...new Set(values.filter((value): value is TopicId => valid.has(value))),
  ];
}

export function preferenceTopics(value: unknown): TopicId[] {
  const text = cleanText(value, 4_000);
  const found: TopicId[] = [];
  for (const [topic, pattern] of PREFERENCE_TOPIC_RULES) {
    if (pattern.test(text)) found.push(topic);
  }
  for (const [pattern, topics] of DOMAIN_TOPICS) {
    if (pattern.test(text)) found.push(...topics);
  }
  return uniqueTopics(found);
}

export function specificTopics(values: readonly string[]): TopicId[] {
  const topics = uniqueTopics(values);
  const broad = new Set<TopicId>([
    "applied_ai",
    "developer_tools",
    "general_tech_security",
    "career_opportunities",
    "uae_relevant_news",
  ]);
  const specific = topics.filter((topic) => !broad.has(topic));
  return specific.length > 0 ? specific : topics;
}

export function extractSourceUrl(value: unknown): string | null {
  const match = String(value ?? "").match(/https:\/\/[^\s<>"']+/i);
  if (!match) return null;
  const trimmed = match[0].replace(/[),.!?;:]+$/g, "");
  const canonical = canonicalizeUrl(trimmed);
  return canonical?.startsWith("https://") ? canonical : null;
}

export function preferenceMatchTerms(value: unknown): string[] {
  const withoutUrls = cleanText(value, 4_000)
    .replace(/https?:\/\/\S+/gi, " ")
    .toLowerCase();
  const tokens = withoutUrls.match(/[a-z][a-z0-9.+#-]{2,}/g) ?? [];
  return [...new Set(tokens.filter((token) => !STOP_WORDS.has(token)))].slice(
    0,
    8,
  );
}

function customLabel(terms: string[]): string {
  return terms.slice(0, 5).join(" ");
}

export function buildPreferenceRows(
  subject: unknown,
  level: PreferenceLevel,
  telegramMessageId: number | null,
  fallbackTopics: readonly string[] = [],
): UserPreferenceRow[] {
  const text = cleanText(subject, 1_000);
  const topics = specificTopics([
    ...preferenceTopics(text),
    ...fallbackTopics,
  ]);
  const sourceUrl = extractSourceUrl(text);
  const now = new Date().toISOString();

  if (topics.length > 0) {
    return topics.map((topic) => ({
      normalized_label: `topic:${topic}`,
      label: TOPIC_LABELS[topic],
      level,
      topic_tags: [topic],
      match_terms: [],
      example_text: text || null,
      source_url: sourceUrl,
      telegram_message_id: telegramMessageId,
      active: true,
      updated_at: now,
    }));
  }

  const terms = preferenceMatchTerms(text);
  if (terms.length < 2) return [];
  const label = customLabel(terms);
  return [{
    normalized_label: `custom:${terms.join("-")}`.slice(0, 180),
    label,
    level,
    topic_tags: [],
    match_terms: terms,
    example_text: text,
    source_url: sourceUrl,
    telegram_message_id: telegramMessageId,
    active: true,
    updated_at: now,
  }];
}

export function preferenceMatchesItem(
  preference: UserPreferenceRow,
  item: NewsItemRow,
): boolean {
  if (!preference.active) return false;
  if (
    preference.topic_tags.some((topic) =>
      item.topic_tags.includes(topic as TopicId)
    )
  ) {
    return true;
  }
  if (preference.match_terms.length === 0) return false;

  const text = cleanText(`${item.title} ${item.summary}`, 5_000).toLowerCase();
  const matches =
    preference.match_terms.filter((term) => text.includes(term.toLowerCase()))
      .length;
  const required = preference.match_terms.length <= 2
    ? preference.match_terms.length
    : Math.min(3, Math.ceil(preference.match_terms.length / 2));
  return matches >= required;
}

export function preferenceKeysForInput(value: unknown): string[] {
  const rows = buildPreferenceRows(value, 1, null);
  return rows.map((row) => row.normalized_label);
}
