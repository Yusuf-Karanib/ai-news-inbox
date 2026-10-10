import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFullStoryMessage,
  formatNewsMessage,
  newsReplyMarkup,
  newsTypeLabel,
  shortSummary,
} from "../supabase/functions/_shared/telegram.ts";
import { isFullStoryRequest } from "../supabase/functions/_shared/telegram_commands.ts";
import type {
  NewsItemRow,
  TopicId,
} from "../supabase/functions/_shared/types.ts";

const item: NewsItemRow = {
  id: "12345678-1234-1234-1234-123456789abc",
  source_id: "n8n-blog",
  external_key: "story-1",
  canonical_url: "https://blog.n8n.io/example",
  title: "A useful n8n update",
  summary:
    "First important sentence. Second useful sentence. Third detailed sentence for the expanded view.",
  published_at: "2026-09-07T08:00:00.000Z",
  discovered_at: "2026-09-07T09:00:00.000Z",
  topic_tags: ["n8n", "ai_agents_automation"],
  match_reasons: ["Matches n8n"],
  importance: 3,
  verification_status: "official_source_only",
  action: "save_for_later",
  is_opportunity: false,
  sent_at: null,
  telegram_message_id: 123,
  feedback_score: null,
  delivery_attempts: 0,
};

const removedCardLabels =
  /Importance:|Why for Yusuf:|Why it matters:|Action:|Recommended action:|Status:|Confirmed fact:|Still uncertain:|Your interest:/i;

function typeFor(
  topicTags: TopicId[],
  isOpportunity = false,
  sourceId = "test-source",
): string {
  return newsTypeLabel({
    source_id: sourceId,
    topic_tags: topicTags,
    is_opportunity: isOpportunity,
    action: isOpportunity ? "investigate_further" : "save_for_later",
  });
}

test("common AI jargon is changed into beginner wording", () => {
  const result = shortSummary(
    "Running reasoning and agentic AI at the edge has been harder than it needs to be.",
  );
  assert.match(result, /AI that can solve problems and carry out tasks/);
  assert.match(result, /directly on a device/);
  assert.doesNotMatch(result, /agentic|at the edge/i);
  assert.ok(result.length <= 320);
});

test("a security feed cannot be labelled as an opportunity", () => {
  assert.equal(
    typeFor(
      ["general_tech_security", "career_opportunities"],
      true,
      "aws-security-bulletins",
    ),
    "Security News",
  );
});

test("common AI business and research phrases are changed into beginner wording", () => {
  const result = shortSummary(
    "Leaders want to pace the frontier while model-distillation campaigns use training data in AI infrastructure.",
  );
  assert.match(result, /slow down development of the most powerful AI systems/);
  assert.match(result, /attempts to copy another AI system/);
  assert.match(result, /examples used to teach AI/);
  assert.match(result, /computer systems used to run AI/);
  assert.doesNotMatch(result, /pace the frontier|distillation|infrastructure/i);
});

test("summary removes marketing filler and keeps version numbers together", () => {
  const result = shortSummary(
    "We are excited to announce that Python 3.13.5 can now run this feature. Read more on our blog.",
  );
  assert.match(result, /^Python 3\.13\.5 can now run this feature\./);
  assert.doesNotMatch(result, /excited|Read more/i);
});

test("news type is stable and uses clear category precedence", () => {
  assert.equal(typeFor(["nvidia_ai_hardware"]), "AI News: NVIDIA");
  assert.equal(typeFor(["world_high_impact"]), "World News");
  assert.equal(typeFor(["general_tech_security"]), "Security News");
  assert.equal(typeFor(["n8n"]), "Tech News");
  assert.equal(typeFor([]), "Tech News");
  assert.equal(
    typeFor(["openai_chatgpt_codex", "uae_relevant_news"]),
    "UAE AI News",
  );
  assert.equal(
    typeFor(["uae_relevant_news", "openai_chatgpt_codex"]),
    "UAE AI News",
  );
  assert.equal(
    typeFor(["openai_chatgpt_codex", "uae_events_hackathons"], true),
    "UAE Opportunity",
  );
});

test("default card is simple and removes unwanted fields", () => {
  const result = formatNewsMessage(item, "n8n Blog", 1, 5);
  assert.match(result, /^<b>AI News: AI Agents<\/b>/);
  assert.match(result, /Here’s what’s happening:/);
  assert.match(result, /Source:/);
  assert.doesNotMatch(result, /<b>A useful n8n update<\/b>/);
  assert.doesNotMatch(result, removedCardLabels);
  assert.doesNotMatch(result, /Second useful sentence|Third detailed sentence/);
});

test("the NVIDIA Jetson example gets a useful beginner explanation", () => {
  const nvidiaItem: NewsItemRow = {
    ...item,
    source_id: "nvidia-technical-blog",
    title:
      "Frontier Reasoning Reaches the Edge: How to Deploy and Optimize Models on NVIDIA Jetson",
    summary:
      "Running reasoning and agentic AI at the edge has been harder than it needs to be. Until recently, models capable of multi-step reasoning were too large to run on these devices.",
    topic_tags: ["nvidia_ai_hardware", "ai_agents_automation"],
  };
  const result = formatNewsMessage(nvidiaItem, "NVIDIA Technical Blog", 1, 1);
  assert.match(result, /^<b>AI News: NVIDIA<\/b>/);
  assert.match(
    result,
    /Jetson computers can run AI that solves problems in several steps/,
  );
  assert.match(result, /without sending every task to a cloud server/);
  assert.doesNotMatch(
    result,
    /agentic|frontier reasoning reaches the edge.*In simple words:[\s\S]*frontier reasoning/i,
  );
});

test("a headline is not repeated as the short card body", () => {
  const repeated = {
    ...item,
    summary: `${item.title}. The update can now handle a useful new task.`,
  };
  const result = formatNewsMessage(repeated, "n8n Blog", 1, 1);
  assert.equal(result.split(item.title).length - 1, 0);
  assert.match(result, /The update can now handle a useful new task/);
});

test("expanded card keeps category and details but not unwanted fields", () => {
  const longItem = { ...item, summary: "Detailed source claim. ".repeat(300) };
  const result = formatFullStoryMessage(longItem, "n8n Blog");
  assert.match(result, /^<b>AI News: AI Agents: Full story<\/b>/);
  assert.match(result, /In simple words:/);
  assert.match(result, /More detail:/);
  assert.match(result, /Source:/);
  assert.doesNotMatch(result, removedCardLabels);
  assert.ok(result.length <= 4_096);
});

test("opportunity cards keep one short application safety reminder", () => {
  const opportunity: NewsItemRow = {
    ...item,
    topic_tags: ["career_opportunities", "uae_jobs_internships"],
    is_opportunity: true,
    action: "investigate_further",
  };
  const shortCard = formatNewsMessage(opportunity, "Official Program", 1, 1);
  const fullCard = formatFullStoryMessage(opportunity, "Official Program");
  for (const card of [shortCard, fullCard]) {
    assert.match(card, /Before applying:/);
    assert.match(
      card,
      /deadline, cost, eligibility, certificate, and UAE availability/,
    );
    assert.doesNotMatch(card, removedCardLabels);
  }
});

test("opportunity cards replace company advertising with a plain explanation", () => {
  const opportunity: NewsItemRow = {
    ...item,
    title: "Cloud Engineer Intern",
    summary:
      "We are a leading global ecosystem delivering revolutionary services to millions of users.",
    topic_tags: ["career_opportunities", "uae_jobs_internships", "aws_cloud"],
    is_opportunity: true,
    action: "investigate_further",
  };
  const result = formatNewsMessage(opportunity, "Job listing feed", 1, 1);
  assert.match(
    result,
    /Cloud Engineer Intern is a current job or internship listing that may accept people in the UAE\./,
  );
  assert.doesNotMatch(result, /leading global|revolutionary services/);
});

test("card text safely escapes Telegram HTML", () => {
  const unsafe = {
    ...item,
    title: "AI <launch> & update",
    summary: "A & B can now work safely.",
  };
  const result = formatNewsMessage(unsafe, "Source & News", 1, 1);
  assert.match(result, /A &amp; B can now work safely/);
  assert.match(result, /Source &amp; News/);
  assert.doesNotMatch(result, /<launch>|<model>/);
});

test("community projects are clearly labelled as unverified leads", () => {
  const community: NewsItemRow = {
    ...item,
    source_id: "hacker-news-show",
    title: "Show HN: I built an AI debugging tool",
    summary: "A developer shared a tool that explains failed agent runs.",
    topic_tags: ["community_projects", "ai_agents_automation"],
    verification_status: "source_reported",
  };
  const result = formatNewsMessage(community, "Hacker News — Show HN", 1, 1);
  assert.match(result, /^<b>People Are Building<\/b>/);
  assert.match(result, /Here’s what’s happening:/);
  assert.match(result, /treat it as a lead, not a verified fact/);
});

test("story buttons keep all rating and view controls", () => {
  const collapsed = newsReplyMarkup(item.id) as {
    inline_keyboard: Array<Array<{ callback_data: string }>>;
  };
  const expanded = newsReplyMarkup(item.id, true) as {
    inline_keyboard: Array<Array<{ callback_data: string }>>;
  };
  assert.deepEqual(
    collapsed.inline_keyboard[0].map((button) => button.callback_data),
    [0, 1, 2, 3].map((score) => `r:${item.id}:${score}`),
  );
  assert.equal(collapsed.inline_keyboard[1][0].callback_data, `p:${item.id}:1`);
  assert.equal(
    collapsed.inline_keyboard[1][1].callback_data,
    `p:${item.id}:-1`,
  );
  assert.equal(collapsed.inline_keyboard[2][0].callback_data, `f:${item.id}`);
  assert.equal(expanded.inline_keyboard[2][0].callback_data, `s:${item.id}`);
  for (const row of collapsed.inline_keyboard) {
    for (const button of row) {
      assert.ok(
        new TextEncoder().encode(button.callback_data).byteLength <= 64,
      );
    }
  }
});

test("only clear full-story phrases are accepted", () => {
  assert.equal(isFullStoryRequest("full story"), true);
  assert.equal(isFullStoryRequest("Give me the full story!"), true);
  assert.equal(isFullStoryRequest("/fullstory"), true);
  assert.equal(isFullStoryRequest("What is today's news?"), false);
});
