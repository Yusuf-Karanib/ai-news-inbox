import type {
  AnalyzedItem,
  FeedSource,
  RawFeedItem,
  RecommendedAction,
  TopicId,
  TopicWeightRow,
} from "./types.ts";
import { clamp, cleanText } from "./utils.ts";

interface TopicRule {
  id: TopicId;
  label: string;
  patterns: RegExp[];
}

const WORLD_POLITICS_PATTERNS: RegExp[] = [
  /\b(?:state of emergency|major earthquake|major tsunami|pandemic declared|military invasion)\b/i,
  /\b(?:presidential|parliamentary|general|national) election\b.{0,120}\b(?:result|winner|vote|government|coalition)\b/i,
  /\b(?:president|prime minister|government|parliament|congress)\b.{0,100}\b(?:resigns?|ousted|impeached|dissolved|collapsed|forms? (?:a )?(?:new )?government)\b/i,
  /\b(?:trade war|military invasion|coup|major protests?|mass protests?)\b/i,
  /(?:\b(?:ceasefire|peace agreement|peace treaty)\b.{0,100}\b(?:war|conflict|government|countries|signed|agreed|takes effect)\b|\b(?:war|conflict|government|countries)\b.{0,100}\b(?:ceasefire|peace agreement|peace treaty)\b)/i,
  /\b(?:government|president|prime minister|united states|u\.?s\.?|european union|eu|china|russia|india|iran|israel)\b.{0,100}\b(?:imposes?|announces?|raises?|lifts?|expands?)\b.{0,40}\b(?:sanctions?|tariffs?)\b/i,
  /\b(?:formal|international) peace talks?\b.{0,100}\b(?:war|conflict|government|countries|ceasefire)\b/i,
  /\b(?:united nations|\bun\b|nato|g7|g20)\b.{0,100}\b(?:resolution|summit|agreement|sanctions?|military|war|ceasefire|treaty)\b/i,
  /\b(?:state of emergency|major earthquake|major tsunami|pandemic|global markets?|world economy|international trade)\b.{0,120}\b(?:declared|crash|crisis|agreement|sanctions?|tariffs?)\b/i,
];

const DIRECT_OPPORTUNITY_PATTERN =
  /\b(?:internships?|fellowships?|job openings?|vacanc(?:y|ies)|applications? (?:are |is )?open|call for applications|apply now|application deadline|registration (?:is )?open)\b/i;
const HIRING_OPPORTUNITY_PATTERN =
  /(?:\b(?:hiring|recruiting)\b.{0,80}\b(?:interns?|graduates?|developers?|engineers?|candidates?|roles?|jobs?)\b|\b(?:interns?|graduates?|developers?|engineers?|candidates?|roles?|jobs?)\b.{0,80}\b(?:hiring|recruiting)\b)/i;
const PROGRAM_OPPORTUNITY_PATTERN =
  /(?:\b(?:hackathons?|grants?|competitions?|accelerators?|mentorships?|graduate programs?|training programs?|bootcamps?|events?)\b.{0,160}\b(?:apply|applications?|register|registration|join|eligibility|eligible|deadline|submissions?|entries|participants?|cohort|intake)\b|\b(?:apply|applications?|register|registration|join|eligibility|eligible|deadline|submissions?|entries|participants?|cohort|intake)\b.{0,160}\b(?:hackathons?|grants?|competitions?|accelerators?|mentorships?|graduate programs?|training programs?|bootcamps?|events?)\b)/i;
const OPPORTUNITY_PATTERNS = [
  DIRECT_OPPORTUNITY_PATTERN,
  HIRING_OPPORTUNITY_PATTERN,
  PROGRAM_OPPORTUNITY_PATTERN,
];
const DEDICATED_OPPORTUNITY_SOURCE_IDS = new Set([
  "42-abu-dhabi",
  "dubai-future-foundation",
  "jobicy-uae-internships",
]);

const TOPIC_RULES: TopicRule[] = [
  {
    id: "anthropic_claude",
    label: "Claude or Anthropic",
    patterns: [
      /\banthropic\b.{0,100}\b(?:claude|ai|model|api|research|release|launch|update)\b/i,
      /\bclaude(?:\.ai|\s+(?:ai|code|api|platform|opus|sonnet|haiku|model|release|update))\b/i,
    ],
  },
  {
    id: "openai_chatgpt_codex",
    label: "ChatGPT, Codex, or OpenAI",
    patterns: [
      /\b(?:chatgpt|codex|sora)\b/i,
      /\bgpt[- ]?(?:[4-9]|o\d)\b/i,
      /\bopenai\b.{0,100}\b(?:model|api|chatgpt|codex|release|launch|update|usage|limit|reset)\b/i,
    ],
  },
  {
    id: "nvidia_ai_hardware",
    label: "NVIDIA AI",
    patterns: [
      /\bnvidia\b.{0,120}\b(?:ai|artificial intelligence|gpu|cuda|dgx|blackwell|rubin|inference|training|robotics)\b/i,
      /\b(?:ai|artificial intelligence|gpu|cuda|dgx|blackwell|rubin|inference|training|robotics)\b.{0,120}\bnvidia\b/i,
    ],
  },
  {
    id: "xai_grok",
    label: "Grok or xAI",
    patterns: [
      /\bgrok\b.{0,100}\b(?:ai|models?|api|bot|release|launch|update|voice|image|video)\b/i,
      /\bgrok\s+\d+(?:\.\d+)*\b/i,
      /\bxai\b|\bx\.ai\b/i,
    ],
  },
  {
    id: "ai_access_pricing",
    label: "AI access, usage limits, or pricing",
    patterns: [
      /\b(?:usage|global|weekly|daily)\s+reset\b/i,
      /\b(?:usage|rate|message)\s+limits?\b|\bquota\b/i,
      /\b(?:subscription|credits?|pricing|price)\b.{0,80}\b(?:ai|chatgpt|claude|codex|grok|model|api)\b/i,
      /\b(?:free access|free tier|now free)\b.{0,80}\b(?:ai|model|chatgpt|claude|codex|grok)\b/i,
    ],
  },
  {
    id: "ai_hardware_chips",
    label: "AI hardware or chips",
    patterns: [
      /\b(?:ai|inference|training)\b.{0,100}\b(?:gpu|npu|tpu|chip|accelerator|semiconductor|data cent(?:er|re))\b/i,
      /\b(?:gpu|npu|tpu|ai chip|accelerator chip)\b.{0,100}\b(?:ai|model|inference|training)\b/i,
    ],
  },
  {
    id: "ai_models_releases",
    label: "major AI model release",
    patterns: [
      /\b(?:new|launch(?:es|ed)?|releas(?:es|ed)?)\b.{0,80}\b(?:ai|language|vision|reasoning|multimodal|frontier)\s+model\b/i,
      /\bopen[- ]weights?\b|\bmodel weights?\b/i,
    ],
  },
  {
    id: "robotics_ros2",
    label: "ROS 2 or robotics",
    patterns: [
      /\bros\s*2\b/i,
      /\brobot(?:ics?|ic)\b/i,
      /\bgazebo\b/i,
      /simulation/i,
      /autonomous (?:robot|system)/i,
    ],
  },
  {
    id: "ai_agents_automation",
    label: "AI agents or automation",
    patterns: [
      /\bai agent(?:s|ic)?\b/i,
      /agentic/i,
      /tool calling/i,
      /workflow automation/i,
      /model context protocol|\bmcp\b/i,
      /openbento|openclaw/i,
    ],
  },
  {
    id: "developer_tools",
    label: "developer tools",
    patterns: [
      /\bdeveloper tools?\b|\bcoding (?:agent|assistant|tool)\b/i,
      /\bgithub copilot\b|\bide\b.{0,40}\b(?:ai|agent|coding)\b/i,
    ],
  },
  {
    id: "n8n",
    label: "n8n",
    patterns: [/\bn8n\b/i],
  },
  {
    id: "aws_cloud",
    label: "AWS or cloud",
    patterns: [
      /\baws\b|amazon web services/i,
      /lambda|bedrock|sagemaker/i,
      /cloud (?:service|deployment|infrastructure)/i,
      /serverless/i,
    ],
  },
  {
    id: "supabase",
    label: "Supabase",
    patterns: [
      /\bsupabase\b/i,
      /postgres(?:ql)?/i,
      /row level security|\brls\b/i,
    ],
  },
  {
    id: "python_apis",
    label: "Python or APIs",
    patterns: [
      /\bpython\b/i,
      /\bapi(?:s)?\b/i,
      /fastapi|django|flask/i,
      /webhook/i,
      /whatsapp (?:api|business platform)/i,
    ],
  },
  {
    id: "docker",
    label: "Docker or containers",
    patterns: [
      /\bdocker\b/i,
      /\bcontainer(?:s|ization)?\b/i,
      /docker compose/i,
    ],
  },
  {
    id: "react_nextjs",
    label: "React or Next.js",
    patterns: [/\breact\b/i, /next\.?js/i, /typescript/i],
  },
  {
    id: "career_opportunities",
    label: "internship, program, or opportunity",
    patterns: OPPORTUNITY_PATTERNS,
  },
  {
    id: "uae_relevant_news",
    label: "UAE-relevant news",
    patterns: [
      /\b(?:uae|united arab emirates|dubai|abu dhabi|sharjah|mina zayed)\b/i,
      /\b(?:g42|space42|tii|technology innovation institute|edge group|hub71|dubai future foundation|42 abu dhabi)\b/i,
    ],
  },
  {
    id: "uae_jobs_internships",
    label: "UAE job or paid internship",
    patterns: [
      /(?:uae|united arab emirates|dubai|abu dhabi|sharjah).{0,80}(?:job|role|hiring|internship|vacancy)/i,
      /(?:job|role|hiring|internship|vacancy).{0,80}(?:uae|united arab emirates|dubai|abu dhabi|sharjah)/i,
    ],
  },
  {
    id: "uae_events_hackathons",
    label: "UAE event, grant, or hackathon",
    patterns: [
      /(?:uae|united arab emirates|dubai|abu dhabi|sharjah).{0,80}(?:event|hackathon|fellowship|grant|lab|mentorship|competition)/i,
      /(?:event|hackathon|fellowship|grant|lab|mentorship|competition).{0,80}(?:uae|united arab emirates|dubai|abu dhabi|sharjah)/i,
    ],
  },
  {
    id: "courses_certifications",
    label: "course or certification",
    patterns: [
      /\bcourse\b|training program/i,
      /certificat(?:e|ion)/i,
      /bootcamp/i,
    ],
  },
  {
    id: "general_tech_security",
    label: "security or breaking technical change",
    patterns: [
      /\bsecurity\b|vulnerab(?:ility|le)|\bcve-\d{4}-\d+/i,
      /breaking change|deprecated|deprecation|end of support|end-of-life/i,
      /data breach|remote code execution|zero[- ]day/i,
    ],
  },
  {
    id: "world_high_impact",
    label: "major world event",
    patterns: WORLD_POLITICS_PATTERNS,
  },
  {
    id: "applied_ai",
    label: "applied AI",
    patterns: [
      /artificial intelligence|machine learning/i,
      /computer vision|vision model/i,
      /large language model|\bllm\b/i,
      /\bopenai\b|\bcodex\b/i,
      /model inference|fine[- ]tun/i,
    ],
  },
];

const SOURCE_TOPIC: Readonly<Partial<Record<string, TopicId>>> = Object.freeze({
  "openai-news": "openai_chatgpt_codex",
  "openai-codex-releases": "openai_chatgpt_codex",
  "openai-status": "openai_chatgpt_codex",
  "anthropic-platform-releases": "anthropic_claude",
  "anthropic-status": "anthropic_claude",
  "xai-release-notes": "xai_grok",
  "xai-status": "xai_grok",
  "nvidia-ai-news": "nvidia_ai_hardware",
  "nvidia-technical-blog": "nvidia_ai_hardware",
  "google-deepmind": "ai_models_releases",
  "hugging-face-blog": "ai_models_releases",
  "microsoft-ai-news": "applied_ai",
  "techcrunch-ai": "applied_ai",
  "the-verge-ai": "applied_ai",
  "jobicy-uae-internships": "career_opportunities",
  "42-abu-dhabi": "uae_events_hackathons",
  "bbc-world": "world_high_impact",
  "aws-whats-new": "aws_cloud",
  "aws-security-bulletins": "aws_cloud",
  "supabase-changelog": "supabase",
  "n8n-blog": "n8n",
  "docker-blog": "docker",
  "docker-security-announcements": "docker",
  "python-insider": "python_apis",
  "ros-announcements": "robotics_ros2",
  "dubai-future-foundation": "uae_events_hackathons",
});

const WHY: Readonly<Record<TopicId, string>> = Object.freeze({
  anthropic_claude:
    "It is a Claude or Anthropic update Yusuf specifically asked to follow.",
  openai_chatgpt_codex:
    "It may change how Yusuf uses ChatGPT, Codex, or OpenAI tools.",
  nvidia_ai_hardware:
    "It covers NVIDIA AI software or hardware Yusuf asked to follow.",
  xai_grok: "It is a Grok or xAI update Yusuf specifically asked to follow.",
  ai_models_releases:
    "It may be a meaningful new AI capability rather than general hype.",
  ai_access_pricing:
    "It may affect Yusuf's access, usage limits, reset timing, or costs.",
  ai_hardware_chips:
    "It helps Yusuf follow the hardware that makes modern AI possible.",
  applied_ai: "It may affect Yusuf's applied-AI learning or tools.",
  robotics_ros2:
    "It relates directly to Yusuf's planned ROS 2 and robotics path.",
  python_apis: "It may help Yusuf's Python and API work.",
  ai_agents_automation: "It may affect Yusuf's AI-agent and automation work.",
  developer_tools:
    "It may improve or disrupt Yusuf's software-development workflow.",
  n8n: "It may affect workflows Yusuf builds with n8n.",
  aws_cloud: "It may affect Yusuf's AWS costs, skills, or deployments.",
  supabase: "It may affect databases and backends Yusuf builds with Supabase.",
  docker: "It may affect how Yusuf packages and deploys projects.",
  react_nextjs: "It may help with Yusuf's React and Next.js work.",
  career_opportunities:
    "It may be an internship, program, event, or application worth checking.",
  uae_relevant_news:
    "It has a UAE connection that may affect Yusuf's career, income, study, or daily life.",
  uae_jobs_internships:
    "It may be relevant to Yusuf's search for paid UAE work.",
  uae_events_hackathons:
    "It may offer a useful UAE application or networking opportunity.",
  courses_certifications:
    "It may help only if it is affordable and useful for current goals.",
  general_tech_security:
    "It may require a change to keep Yusuf's tools or projects safe.",
  world_high_impact:
    "It is a major world event that may be worth knowing even though it is not AI news.",
});

const UAE_PATTERN =
  /\b(uae|united arab emirates|dubai|abu dhabi|sharjah|mina zayed)\b/i;
const SENIOR_ROLE_TITLE_PATTERN =
  /(?:\b(?:senior|staff|principal|lead)\b.{0,45}\b(?:engineer|developer|scientist|architect|manager|consultant|analyst|designer|specialist)\b|\b(?:director|head of)\b)/i;
const CLEAR_REQUIREMENT_MISMATCH_PATTERN =
  /\b(?:ph\.?d\.? required|doctorate required|master'?s?(?: degree)? required|bachelor'?s?(?: degree)? required|unpaid|pay[- ]to[- ]join|emirati nationals? only|uae nationals? only|currently enrolled students? only)\b/i;
const JOBICY_CAREER_FIT_PATTERN =
  /\b(?:artificial intelligence|machine learning|data|software|full[- ]?stack|front[- ]?end|back[- ]?end|web|mobile|developer|development|engineer(?:ing)?|devops|cloud|computer security|cybersecurity|python|javascript|typescript|react|api|automation|product|technical|technology|computer science|programming|coding|robotics|database|quality assurance|qa)\b/i;
const MARKETING_PATTERN =
  /\b(revolutionary|game[- ]changing|unbelievable|guaranteed income|get rich|10x your|world[- ]changing)\b/i;
const GENERIC_PUBLICITY_PATTERN =
  /\b(company update|shares? (?:a|an|our) update|thought leadership|our approach|our commitment|brand campaign)\b/i;
const CODEX_PREVIEW_RELEASE_PATTERN =
  /\b(?:alpha|beta|nightly|preview|release candidate|rc\.?\d*)\b/i;
const CODEX_MEANINGFUL_RELEASE_PATTERN =
  /\b(?:new features?|breaking changes?|security|deprecat(?:ed|ion)|added|improved|fixed|support(?:s|ed)?|model picker|usage limit)\b/i;
const CLOSED_OPPORTUNITY_PATTERN =
  /\b(?:applications? closed|registration closed|deadline (?:has )?passed|winners? (?:announced|of)|honou?r(?:s|ed)? winners?|event concluded|program completed)\b/i;
const HIGH_IMPACT_COST_PATTERN =
  /\b(pric(?:e|ing) (?:change|update|increase|decrease)|cost (?:change|increase|decrease)|billing change|free (?:access|tier (?:change|ending|ends|launch|available))|now free|(?:global |usage )?usage reset|global reset|quota (?:change|increase|decrease|reduced)|rate limit (?:change|increase|decrease|reduced))\b/i;
const CRITICAL_PATTERN =
  /\b(vulnerab(?:ility|le)|security advisory|\bcve-\d{4}-\d+|remote code execution|zero[- ]day|breaking change|deprecat(?:ed|ion)|end of support|end-of-life)\b/i;
const MAJOR_RELEASE_PATTERN =
  /(?:\b(?:launch(?:es|ed)?|releas(?:es|ed)?|introduc(?:es|ed|ing)|rolls? out|now available|generally available|general availability)\b.{0,100}\b(?:ai|language|reasoning|multimodal|frontier) models?\b|\b(?:launch(?:es|ed)?|releas(?:es|ed)?|introduc(?:es|ed|ing)|rolls? out|now available|generally available|general availability)\b.{0,100}\b(?:chatgpt|claude|grok|codex|coding agent|ai agent|gpu|ai chip)\b|\b(?:major release|new (?:ai )?model|python 3\.\d+ (?:is )?released|ros 2 .{0,30} release)\b)/i;
const STATUS_SOURCE_IDS = new Set([
  "openai-status",
  "anthropic-status",
  "xai-status",
]);
const RESOLVED_STATUS_PATTERN =
  /\b(?:status\s*:\s*resolved|incident (?:has been |is )?resolved|resolved (?:at|on)|traffic is healthy again|service (?:has been |is )?restored|all systems operational|fully operational)\b/i;
const MAJOR_ACTIVE_STATUS_PATTERN =
  /(?:\b(?:major|widespread|global|system[- ]wide|service[- ]wide|multiple regions?|most users?|all users?|complete)\b.{0,100}\b(?:outage|unavailable|disruption|degrad(?:ed|ation)|errors?|incident)\b|\b(?:outage|unavailable|disruption|degrad(?:ed|ation)|errors?|incident)\b.{0,100}\b(?:major|widespread|global|system[- ]wide|service[- ]wide|multiple regions?|most users?|all users?|complete)\b)/i;
const ACTIVE_STATUS_PATTERN =
  /\b(?:status\s*:\s*(?:investigating|identified|monitoring)|investigating|identified|ongoing|currently unavailable|active incident)\b/i;
const TECHNICAL_GUIDE_PATTERN =
  /(?:\b(?:how to|tutorial|step[- ]by[- ]step|best practices?|deep dive|getting started|quickstart|guide to|walkthrough|debug.{0,40}evaluate.{0,40}monitor|deploy and optimize|benchmark(?:ing)?|tips (?:for|to)|building (?:a|an|your)\b)\b|\bhow\b.{0,80}\b(?:uses?|used|builds?|built|works?)\b|\b(?:scaling|optimizing|debugging|monitoring|deploying|benchmarking)\b.{0,80}\b(?:storage|infrastructure|models?|agents?|workflows?|production|systems?|kernels?)\b|\b(?:architecture|observability|production challenges|execution models)\b)/i;
const HIGH_LEVEL_AI_EVENT_PATTERN =
  /\b(?:launch(?:es|ed)?|releas(?:es|ed)?|introduc(?:es|ed|ing)|rolls? out|becomes? available|funding|raises?|acquir(?:es|ed)|acquisition|merger|partnership|deal|regulation|law|lawsuit|ban(?:s|ned)?|invest(?:s|ment)|pricing|subscription|usage limit|chip|gpu)\b/i;
const GENERAL_AI_NEWS_SOURCE_IDS = new Set(["techcrunch-ai", "the-verge-ai"]);
const EXPENSIVE_LEARNING_PATTERN =
  /\b(expensive|tuition|course fee|program fee|pay to enroll|aed\s*\d{3,}|(?:usd|us\$|\$)\s*\d{3,})\b/i;
const DIRECT_TOOL_TOPICS = new Set<TopicId>([
  "anthropic_claude",
  "openai_chatgpt_codex",
  "nvidia_ai_hardware",
  "xai_grok",
  "ai_models_releases",
  "ai_access_pricing",
  "ai_hardware_chips",
  "robotics_ros2",
  "python_apis",
  "ai_agents_automation",
  "developer_tools",
  "n8n",
  "aws_cloud",
  "supabase",
  "docker",
  "react_nextjs",
]);

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function isRoutineStatusUpdate(
  sourceId: string,
  title: string,
  summary: string,
): boolean {
  if (!STATUS_SOURCE_IDS.has(sourceId)) return false;
  const text = cleanText(`${title} ${summary}`, 4_000);
  if (RESOLVED_STATUS_PATTERN.test(text)) return true;
  return !(MAJOR_ACTIVE_STATUS_PATTERN.test(text) &&
    ACTIVE_STATUS_PATTERN.test(text));
}

export function isGenericTechnicalGuide(
  title: string,
  _summary: string,
): boolean {
  const text = cleanText(title, 1_000);
  if (!TECHNICAL_GUIDE_PATTERN.test(text)) return false;
  return !(
    MAJOR_RELEASE_PATTERN.test(text) ||
    HIGH_IMPACT_COST_PATTERN.test(text) ||
    CRITICAL_PATTERN.test(text) ||
    matchesAny(OPPORTUNITY_PATTERNS, text)
  );
}

export function hasDirectTechnicalTopic(
  topicTags: readonly TopicId[],
): boolean {
  return topicTags.some((topic) => DIRECT_TOOL_TOPICS.has(topic));
}

function weightMap(rows: TopicWeightRow[]): Map<string, number> {
  return new Map(
    rows.map((row) => [row.topic, clamp(Number(row.weight) || 1, 0.5, 1.5)]),
  );
}

function deadlineWithinFourteenDays(text: string, now: Date): boolean {
  const contextPattern =
    /(?:deadline|apply by|applications? close|registration closes?)[^.!?\n]{0,80}/gi;
  const contexts = text.match(contextPattern) ?? [];
  const dates: number[] = [];

  for (const context of contexts) {
    for (
      const match of context.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)
    ) {
      dates.push(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          23,
          59,
          59,
        ),
      );
    }
    for (
      const match of context.matchAll(
        /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?\b/gi,
      )
    ) {
      const parsed = Date.parse(
        `${match[1]} ${match[2]} ${match[3] ?? now.getUTCFullYear()} UTC`,
      );
      if (Number.isFinite(parsed)) dates.push(parsed);
    }
    for (
      const match of context.matchAll(
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/gi,
      )
    ) {
      const parsed = Date.parse(
        `${match[1]} ${match[2]} ${match[3] ?? now.getUTCFullYear()} UTC`,
      );
      if (Number.isFinite(parsed)) dates.push(parsed);
    }
    const relative = /\bin\s+(\d{1,2})\s+days?\b/i.exec(context);
    if (relative && Number(relative[1]) <= 14) return true;
  }

  const start = now.getTime() - 12 * 60 * 60 * 1_000;
  const end = now.getTime() + 14 * 24 * 60 * 60 * 1_000;
  return dates.some((date) => date >= start && date <= end);
}

function chooseAction(
  isOpportunity: boolean,
  tags: TopicId[],
  text: string,
  importance: number,
): RecommendedAction {
  if (isOpportunity) return "investigate_further";
  if (
    CRITICAL_PATTERN.test(text) ||
    (HIGH_IMPACT_COST_PATTERN.test(text) && importance >= 4)
  ) {
    return "investigate_further";
  }
  if (tags.includes("courses_certifications") && importance <= 2) {
    return "ignore";
  }
  return "save_for_later";
}

export function whyItMatters(topicTags: readonly string[]): string {
  for (const topic of topicTags) {
    if (topic in WHY) return WHY[topic as TopicId];
  }
  return "It is a small discovery item that may affect Yusuf's technical direction.";
}

export function analyzeItem(
  source: FeedSource,
  raw: RawFeedItem,
  topicWeightRows: TopicWeightRow[],
  now = new Date(),
): AnalyzedItem | null {
  const text = cleanText(`${raw.title} ${raw.summary}`, 4_000);
  if (isRoutineStatusUpdate(source.id, raw.title, raw.summary)) return null;
  if (source.id === "aljazeera-news" && /\/opinions?\//i.test(raw.url)) {
    return null;
  }
  if (
    source.id === "jobicy-uae-internships" &&
    !JOBICY_CAREER_FIT_PATTERN.test(cleanText(raw.title, 1_000))
  ) {
    return null;
  }

  const weights = weightMap(topicWeightRows);
  const tags: TopicId[] = [];
  const reasons: string[] = [];
  let score = clamp(Number(source.base_priority) || 0, 0, 100) / 50;

  for (const rule of TOPIC_RULES) {
    const ruleText = rule.id === "career_opportunities" &&
        !DEDICATED_OPPORTUNITY_SOURCE_IDS.has(source.id)
      ? cleanText(raw.title, 1_000)
      : text;
    const matches = rule.patterns.filter((pattern) =>
      pattern.test(ruleText)
    ).length;
    if (matches === 0) continue;
    tags.push(rule.id);
    reasons.push(`Matches ${rule.label}`);
    const interestWeight = weights.get(rule.id) ?? 1;
    // One exact match to Yusuf's working stack should clear the useful-item
    // threshold. Broad applied-AI mentions stay weaker so company publicity
    // does not become news merely because it says "AI" or "OpenAI".
    const firstMatchBoost = DIRECT_TOOL_TOPICS.has(rule.id) ? 1.75 : 1.25;
    score += (firstMatchBoost + Math.min(matches - 1, 2) * 0.35) *
      interestWeight;
  }

  const sourceTopic = SOURCE_TOPIC[source.id];
  if (sourceTopic && !tags.includes(sourceTopic)) {
    tags.push(sourceTopic);
    reasons.push(`Official ${sourceTopic.replaceAll("_", " ")} source`);
    score += 0.55 * (weights.get(sourceTopic) ?? 1);
  }

  if (source.id === "openai-codex-releases") {
    if (
      CODEX_PREVIEW_RELEASE_PATTERN.test(text) ||
      !CODEX_MEANINGFUL_RELEASE_PATTERN.test(text)
    ) {
      return null;
    }
    if (!tags.includes("developer_tools")) tags.push("developer_tools");
    reasons.push("Meaningful stable Codex release notes");
    score += 2.1 * (weights.get("developer_tools") ?? 1);
  }

  const isMajorRelease = MAJOR_RELEASE_PATTERN.test(text);
  if (isMajorRelease && tags.length === 0) {
    tags.push("general_tech_security");
    score += 0.6 * (weights.get("general_tech_security") ?? 1);
  }

  const opportunityText = DEDICATED_OPPORTUNITY_SOURCE_IDS.has(source.id)
    ? text
    : cleanText(raw.title, 1_000);
  const isOpportunity = source.id === "jobicy-uae-internships" ||
    matchesAny(OPPORTUNITY_PATTERNS, opportunityText);
  const isUae = UAE_PATTERN.test(text) ||
    DEDICATED_OPPORTUNITY_SOURCE_IDS.has(source.id);
  const clearMismatch = SENIOR_ROLE_TITLE_PATTERN.test(raw.title) ||
    CLEAR_REQUIREMENT_MISMATCH_PATTERN.test(text);
  const hasDirectToolMatch = tags.some((topic) =>
    DIRECT_TOOL_TOPICS.has(topic)
  );

  if (
    source.id === "jobicy-uae-internships" &&
    !tags.includes("uae_jobs_internships")
  ) {
    tags.push("uae_jobs_internships");
    reasons.push("UAE internship feed");
  }

  if (hasDirectToolMatch && isGenericTechnicalGuide(raw.title, raw.summary)) {
    return null;
  }

  if (isOpportunity && isUae) {
    score += 2.4;
    reasons.push("UAE opportunity wording");
  } else if (isOpportunity && !isUae) {
    score -= 2.5;
    reasons.push("No clear UAE relevance");
  }

  if (clearMismatch) {
    score -= 4;
    reasons.push("May be senior, degree-mandatory, unpaid, or pay-to-join");
  }
  if (
    CLOSED_OPPORTUNITY_PATTERN.test(text) &&
    (
      isOpportunity ||
      DEDICATED_OPPORTUNITY_SOURCE_IDS.has(source.id) ||
      tags.includes("career_opportunities") ||
      tags.includes("uae_events_hackathons")
    )
  ) {
    return null;
  }
  if (MARKETING_PATTERN.test(text)) {
    score -= 1.25;
    reasons.push("Contains marketing-style language");
  }
  if (GENERIC_PUBLICITY_PATTERN.test(text)) {
    score -= 2.25;
    reasons.push("Appears to be a general company publicity item");
  }
  if (
    tags.includes("courses_certifications") &&
    EXPENSIVE_LEARNING_PATTERN.test(text)
  ) {
    return null;
  }
  if (isMajorRelease) {
    score += 2;
    reasons.push("Major release wording from an official source");
  }
  if (STATUS_SOURCE_IDS.has(source.id)) {
    score += 2.6;
    reasons.push("Major active service disruption");
  }
  if (
    tags.includes("world_high_impact") &&
    matchesAny(WORLD_POLITICS_PATTERNS, text)
  ) {
    score += 2.6;
    reasons.push("Matches a major world or political event");
  }
  if (
    GENERAL_AI_NEWS_SOURCE_IDS.has(source.id) &&
    tags.some((topic) =>
      topic === "applied_ai" || DIRECT_TOOL_TOPICS.has(topic)
    ) &&
    HIGH_LEVEL_AI_EVENT_PATTERN.test(text)
  ) {
    score += 2;
    reasons.push("Substantive AI event reported by a news publisher");
  }
  if (CRITICAL_PATTERN.test(text) && hasDirectToolMatch) score += 2.2;
  if (HIGH_IMPACT_COST_PATTERN.test(text) && hasDirectToolMatch) score += 1.4;

  let importance = score >= 7.5 ? 4 : score >= 5 ? 3 : score >= 3.4 ? 2 : 1;
  if (STATUS_SOURCE_IDS.has(source.id)) importance = Math.max(importance, 4);
  const urgentOpportunity = isOpportunity && isUae && !clearMismatch &&
    deadlineWithinFourteenDays(text, now);
  const urgentTechnicalChange = hasDirectToolMatch &&
    (CRITICAL_PATTERN.test(text) || HIGH_IMPACT_COST_PATTERN.test(text));
  if (urgentOpportunity || urgentTechnicalChange) importance = 5;

  // The free rules engine sends useful items only. Low-scoring content remains filtered out.
  if (importance < 2) return null;

  const action = chooseAction(isOpportunity, tags, text, importance);
  if (action === "ignore") return null;
  return {
    source_id: source.id,
    external_key: cleanText(raw.externalKey, 1_000),
    canonical_url: raw.url,
    title: cleanText(raw.title, 500),
    summary: cleanText(raw.summary, 3_500),
    published_at: raw.publishedAt,
    discovered_at: now.toISOString(),
    topic_tags: tags,
    match_reasons: reasons.slice(0, 8),
    importance,
    verification_status: "official_source_only",
    action,
    is_opportunity: isOpportunity,
  };
}

export function actionLabel(action: RecommendedAction): string {
  const labels: Record<RecommendedAction, string> = {
    pursue: "Pursue",
    save_for_later: "Save for later",
    ignore: "Ignore",
    investigate_further: "Investigate further",
  };
  return labels[action];
}
