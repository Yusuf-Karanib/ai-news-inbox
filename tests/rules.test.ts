import assert from "node:assert/strict";
import test from "node:test";
import { analyzeItem } from "../supabase/functions/_shared/rules_analyzer.ts";
import type {
  FeedSource,
  RawFeedItem,
  TopicId,
  TopicWeightRow,
} from "../supabase/functions/_shared/types.ts";

const now = new Date("2026-09-06T08:00:00Z");
const weights: TopicWeightRow[] = [];

function source(id: string, name: string, basePriority = 90): FeedSource {
  return {
    id,
    name,
    feed_url: "https://example.com/feed.xml",
    homepage_url: "https://example.com/",
    trust_level: "official",
    source_kind: "rss",
    base_priority: basePriority,
    enabled: true,
  };
}

function item(title: string, summary = ""): RawFeedItem {
  return {
    externalKey: title,
    title,
    summary,
    url: `https://example.com/${encodeURIComponent(title)}`,
    publishedAt: "2026-09-06T07:00:00Z",
  };
}

test("generic official AI publicity stays filtered", () => {
  const result = analyzeItem(
    source("openai-news", "OpenAI News", 100),
    item("OpenAI shares a company update"),
    weights,
    now,
  );
  assert.equal(result, null);
});

test("major official AI model release gets a discovery slot", () => {
  const result = analyzeItem(
    source("openai-news", "OpenAI News", 100),
    item("OpenAI introduces a new AI model for developers"),
    weights,
    now,
  );
  assert.ok(result);
  assert.ok(result.importance >= 3);
  assert.equal(result.verification_status, "official_source_only");
});

test("a directly relevant ROS 2 update is kept", () => {
  const result = analyzeItem(
    source("ros-announcements", "ROS Announcements", 90),
    item("ROS 2 package synchronization is complete"),
    weights,
    now,
  );
  assert.ok(result);
  assert.equal(result.importance, 2);
});

test("a directly relevant n8n update is kept", () => {
  const result = analyzeItem(
    source("n8n-blog", "n8n Blog", 90),
    item("n8n release notes for September"),
    weights,
    now,
  );
  assert.ok(result);
  assert.equal(result.importance, 2);
});

test("a directly relevant AWS service update is kept", () => {
  const result = analyzeItem(
    source("aws-whats-new", "AWS What's New", 95),
    item("Amazon Bedrock adds a developer option"),
    weights,
    now,
  );
  assert.ok(result);
  assert.equal(result.importance, 2);
});

test("resolved and routine status incidents are not treated as news", () => {
  const resolved = analyzeItem(
    source("xai-status", "xAI Status", 80),
    item(
      "[API (us-east-1.api.x.ai)] Models outage",
      "Status: RESOLVED. Traffic is healthy again. We have resolved the situation.",
    ),
    weights,
    now,
  );
  const routine = analyzeItem(
    source("openai-status", "OpenAI Status", 85),
    item(
      "Elevated errors for a small number of API requests",
      "Status: investigating",
    ),
    weights,
    now,
  );
  assert.equal(resolved, null);
  assert.equal(routine, null);
});

test("only a clearly major active status incident is retained", () => {
  const result = analyzeItem(
    source("anthropic-status", "Claude Status", 85),
    item(
      "Widespread Claude outage affecting most users",
      "Status: investigating. This active incident is ongoing.",
    ),
    weights,
    now,
  );
  assert.ok(result);
  assert.ok(result.importance >= 4);
});

test("generic technical guides are not mistaken for current news", () => {
  const cases: Array<[string, string, string]> = [
    [
      "n8n-blog",
      "AI Agent Reliability: Debug, Evaluate, and Monitor in Production",
      "Learn how to monitor agents with n8n.",
    ],
    [
      "nvidia-technical-blog",
      "Frontier Reasoning Reaches the Edge: How to Deploy and Optimize Models on NVIDIA Jetson",
      "A technical walkthrough.",
    ],
    [
      "openai-news",
      "Rapidly scaling online storage to serve over 1 billion ChatGPT users",
      "An engineering article about storage architecture.",
    ],
  ];
  for (const [sourceId, title, summary] of cases) {
    assert.equal(
      analyzeItem(
        source(sourceId, sourceId, 90),
        item(title, summary),
        weights,
        now,
      ),
      null,
    );
  }
});

test("a real model launch survives even when the title includes a how-to phrase", () => {
  const result = analyzeItem(
    source("openai-news", "OpenAI News", 100),
    item("OpenAI launches a new AI model: how to use it in ChatGPT"),
    weights,
    now,
  );
  assert.ok(result);
  assert.ok(result.importance >= 3);
});

test("breaking Supabase change is urgent", () => {
  const result = analyzeItem(
    source("supabase-changelog", "Supabase Changelog", 95),
    item("Breaking change: Supabase API is deprecated"),
    weights,
    now,
  );
  assert.ok(result);
  assert.equal(result.importance, 5);
  assert.equal(result.action, "investigate_further");
});

test("near UAE paid internship deadline is urgent but still needs checking", () => {
  const result = analyzeItem(
    source("dubai-future-foundation", "Dubai Future Foundation", 90),
    item(
      "Applications open for a paid Python internship in Abu Dhabi",
      "The application deadline is 15 September 2026.",
    ),
    weights,
    now,
  );
  assert.ok(result);
  assert.equal(result.importance, 5);
  assert.equal(result.action, "investigate_further");
});

test("the dedicated UAE internship feed creates a real opportunity item", () => {
  const result = analyzeItem(
    source("jobicy-uae-internships", "Jobicy UAE Internships", 85),
    item(
      "Junior full-stack intern",
      "Remote role open to applicants in the UAE.",
    ),
    weights,
    now,
  );
  assert.ok(result);
  assert.equal(result.is_opportunity, true);
  assert.ok(result.topic_tags.includes("career_opportunities"));
  assert.ok(result.topic_tags.includes("uae_jobs_internships"));
});

test("the UAE internship feed drops unrelated marketing roles", () => {
  const result = analyzeItem(
    source("jobicy-uae-internships", "Jobicy UAE Internships", 85),
    item(
      "Growth Marketing Intern",
      "A global blockchain company is looking for a marketing trainee.",
    ),
    weights,
    now,
  );
  assert.equal(result, null);
});

test("mentioning senior mentors does not hide a suitable internship", () => {
  const result = analyzeItem(
    source("jobicy-uae-internships", "Jobicy UAE Internships", 85),
    item(
      "Software engineering intern",
      "Build web tools and learn from senior engineers. Applicants in the UAE can apply.",
    ),
    weights,
    now,
  );
  assert.ok(result);
  assert.equal(result.is_opportunity, true);
});

test("an ineligible degree-required listing is filtered from the internship feed", () => {
  const result = analyzeItem(
    source("jobicy-uae-internships", "Jobicy UAE Internships", 85),
    item("AI engineering intern", "Bachelor's degree required."),
    weights,
    now,
  );
  assert.equal(result, null);
});

test("senior degree-mandatory role stays filtered", () => {
  const result = analyzeItem(
    source("dubai-future-foundation", "Dubai Future Foundation", 90),
    item("Senior AI engineer job in Abu Dhabi — bachelor's degree required"),
    weights,
    now,
  );
  assert.equal(result, null);
});

test("clearly expensive course stays filtered", () => {
  const result = analyzeItem(
    source("dubai-future-foundation", "Dubai Future Foundation", 90),
    item("Dubai AI bootcamp applications open", "The course fee is AED 8000."),
    weights,
    now,
  );
  assert.equal(result, null);
});

test("Claude, Codex, NVIDIA AI, and Grok releases get specific tags", () => {
  const cases: Array<[string, string, TopicId]> = [
    [
      "anthropic-platform-releases",
      "Claude Code adds agent tools",
      "anthropic_claude",
    ],
    [
      "openai-news",
      "Codex launches a new coding agent",
      "openai_chatgpt_codex",
    ],
    [
      "nvidia-ai-news",
      "NVIDIA launches new GPUs for AI inference",
      "nvidia_ai_hardware",
    ],
    ["xai-release-notes", "Grok Bot is now available", "xai_grok"],
  ];
  for (const [sourceId, title, topic] of cases) {
    const result = analyzeItem(
      source(sourceId, sourceId, 100),
      item(title),
      weights,
      now,
    );
    assert.ok(result, title);
    assert.ok(result.topic_tags.includes(topic), title);
  }
});

test("an AI usage reset is treated as a high-value access change", () => {
  const result = analyzeItem(
    source("openai-news", "OpenAI News", 100),
    item("ChatGPT will receive a global usage reset for paid subscriptions"),
    weights,
    now,
  );
  assert.ok(result);
  assert.ok(result.topic_tags.includes("ai_access_pricing"));
  assert.equal(result.importance, 5);
});

test("generic NVIDIA gaming news is not forced into the AI brief", () => {
  const result = analyzeItem(
    source("nvidia-ai-news", "NVIDIA News", 100),
    item("Seven new games receive a Game Ready driver"),
    weights,
    now,
  );
  assert.equal(result, null);
});

test("major world news can enter the limited fallback but ordinary world news cannot", () => {
  const major = analyzeItem(
    source("bbc-world", "BBC World", 60),
    item("Major presidential election result changes the government"),
    weights,
    now,
  );
  const ordinary = analyzeItem(
    source("bbc-world", "BBC World", 60),
    item("A city opens a new public park"),
    weights,
    now,
  );
  assert.ok(major);
  assert.ok(major.topic_tags.includes("world_high_impact"));
  assert.ok(major.importance >= 3);
  assert.equal(ordinary, null);
});

test("major world politics is kept across several common event types", () => {
  const headlines = [
    "Parliamentary election result produces a new coalition government",
    "Government announces major sanctions after peace talks collapse",
    "President resigns after parliament votes to remove the government",
    "Military coup removes the government as mass protests spread",
    "NATO summit agrees a new defence treaty",
  ];
  for (const headline of headlines) {
    const result = analyzeItem(
      source("bbc-world", "BBC World", 60),
      item(headline),
      weights,
      now,
    );
    assert.ok(result, headline);
    assert.ok(result.topic_tags.includes("world_high_impact"), headline);
    assert.ok(result.importance >= 3, headline);
  }
});

test("high-level publisher AI announcements can enter the brief", () => {
  const result = analyzeItem(
    source("techcrunch-ai", "TechCrunch AI", 90),
    item("OpenAI launches a new ChatGPT model after a major funding deal"),
    weights,
    now,
  );
  assert.ok(result);
  assert.ok(result.importance >= 3);
  assert.ok(result.topic_tags.includes("openai_chatgpt_codex"));
});

test("publisher promotion in a summary does not create a fake opportunity", () => {
  const result = analyzeItem(
    source("techcrunch-ai", "TechCrunch AI", 90),
    item(
      "Anthropic details model-distillation campaigns",
      "AI researchers discussed training. Register for our startup event and join the next cohort.",
    ),
    weights,
    now,
  );
  assert.ok(result);
  assert.equal(result.is_opportunity, false);
  assert.ok(!result.topic_tags.includes("career_opportunities"));
});

test("a new advisory is not rejected just because its CVE number is older", () => {
  const old = analyzeItem(
    source("docker-security-announcements", "Docker Security", 100),
    item("Docker publishes a new advisory for CVE-2025-44228"),
    weights,
    now,
  );
  const current = analyzeItem(
    source("docker-security-announcements", "Docker Security", 100),
    item(
      "Docker Desktop security update: CVE-2026-12345",
      "The advisory also discusses CVE-2025-44228.",
    ),
    weights,
    now,
  );
  assert.ok(old);
  assert.ok(current);
  assert.equal(old.is_opportunity, false);
  assert.equal(current.is_opportunity, false);
  assert.ok(!current.topic_tags.includes("career_opportunities"));
});

test("small sanctions or vague peace-talk stories are not major world news", () => {
  for (
    const headline of [
      "UK sanctions two local officials over visa dispute",
      "Minister discusses peace talks",
    ]
  ) {
    const result = analyzeItem(
      source("bbc-world", "BBC World", 65),
      item(headline),
      weights,
      now,
    );
    assert.equal(result, null, headline);
  }
});

test("Al Jazeera opinion pages are not treated as hard news", () => {
  const raw = item("Government announces sanctions after ceasefire talks");
  raw.url = "https://www.aljazeera.com/opinions/2026/9/6/example";
  const result = analyzeItem(
    source("aljazeera-news", "Al Jazeera News", 65),
    raw,
    weights,
    now,
  );
  assert.equal(result, null);
});

test("Codex preview patch noise is filtered but meaningful stable notes stay", () => {
  const preview = analyzeItem(
    source("openai-codex-releases", "Codex Releases", 90),
    item("0.154.0-alpha.7", "Release 0.154.0-alpha.7"),
    weights,
    now,
  );
  const stable = analyzeItem(
    source("openai-codex-releases", "Codex Releases", 90),
    item(
      "0.153.4",
      "New features added to the model picker and fixed agent workflows.",
    ),
    weights,
    now,
  );
  assert.equal(preview, null);
  assert.ok(stable);
  assert.ok(stable.topic_tags.includes("openai_chatgpt_codex"));
});

test("a UAE event winners article is not treated as an open opportunity", () => {
  const result = analyzeItem(
    source("42-abu-dhabi", "42 Abu Dhabi", 100),
    item("42 Abu Dhabi honors winners of the agentic AI hackathon"),
    weights,
    now,
  );
  assert.equal(result, null);
});
