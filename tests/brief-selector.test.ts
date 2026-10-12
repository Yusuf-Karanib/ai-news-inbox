import assert from "node:assert/strict";
import test from "node:test";
import { selectDailyBrief } from "../supabase/functions/_shared/brief_selector.ts";
import type {
  NewsItemRow,
  TopicId,
  UserPreferenceRow,
} from "../supabase/functions/_shared/types.ts";

let nextId = 1;

function item(
  sourceId: string,
  topics: TopicId[],
  importance = 3,
  hoursAgo = 1,
): NewsItemRow {
  const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
  return {
    id,
    source_id: sourceId,
    external_key: id,
    canonical_url: `https://example.com/${id}`,
    title: `${topics.join(" ")} story`,
    summary: "Useful official update.",
    published_at: new Date(
      Date.parse("2026-09-08T12:00:00Z") - hoursAgo * 3_600_000,
    ).toISOString(),
    discovered_at: "2026-09-08T12:00:00Z",
    topic_tags: topics,
    match_reasons: [],
    importance,
    verification_status: "official_source_only",
    action: "save_for_later",
    is_opportunity: topics.some((topic) =>
      topic === "career_opportunities" ||
      topic === "uae_jobs_internships" ||
      topic === "uae_events_hackathons"
    ),
    sent_at: null,
    telegram_message_id: null,
    feedback_score: null,
    delivery_attempts: 0,
  };
}

function preference(topic: TopicId, level: -2 | -1 | 1): UserPreferenceRow {
  return {
    normalized_label: `topic:${topic}`,
    label: topic,
    level,
    topic_tags: [topic],
    match_terms: [],
    example_text: null,
    source_url: null,
    telegram_message_id: null,
    active: true,
  };
}

test("brief includes each valuable requested area and never exceeds ten", () => {
  nextId = 1;
  const candidates = [
    item("anthropic", ["anthropic_claude"]),
    item("openai", ["openai_chatgpt_codex"]),
    item("nvidia", ["nvidia_ai_hardware"]),
    item("opportunities", ["career_opportunities", "uae_jobs_internships"], 4),
    item("xai", ["xai_grok"]),
    item("uae", ["uae_relevant_news"]),
    item("deepmind", ["ai_models_releases"]),
    item("agents", ["ai_agents_automation"]),
    item("robotics", ["robotics_ros2"]),
    item("hardware", ["ai_hardware_chips"]),
    item("python", ["python_apis"]),
  ];

  const selected = selectDailyBrief(candidates, [], 50);
  assert.equal(selected.length, 10);
  for (
    const required of [
      "anthropic_claude",
      "openai_chatgpt_codex",
      "nvidia_ai_hardware",
      "career_opportunities",
      "xai_grok",
      "uae_relevant_news",
    ] satisfies TopicId[]
  ) {
    assert.ok(selected.some((entry) => entry.topic_tags.includes(required)));
  }
});

test("missing category news is replaced and no filler is invented", () => {
  nextId = 100;
  const useful = [
    item("openai", ["openai_chatgpt_codex"]),
    item("agents", ["ai_agents_automation"]),
  ];
  const selected = selectDailyBrief(useful, [], 10);
  assert.equal(selected.length, 2);
});

test("a real opportunity is reserved before urgent AI stories fill the brief", () => {
  nextId = 150;
  const opportunity = item("opportunity", ["career_opportunities"], 3);
  const urgent = Array.from(
    { length: 10 },
    (_, index) => item(`urgent-${index}`, ["ai_models_releases"], 5, index),
  );
  const selected = selectDailyBrief([...urgent, opportunity], [], 10);
  assert.equal(selected.length, 10);
  assert.equal(selected[0].id, opportunity.id);
  assert.ok(selected.some((entry) => entry.id === opportunity.id));
});

test("a full brief leaves the opportunity place empty when none exists", () => {
  nextId = 175;
  const news = Array.from(
    { length: 10 },
    (_, index) => item(`news-${index}`, ["ai_models_releases"], 3, index),
  );
  const selected = selectDailyBrief(news, [], 10);
  assert.equal(selected.length, 9);
});

test("readable AI and major world news are chosen before technical alerts", () => {
  nextId = 182;
  const readableAi = item("publisher-ai", ["applied_ai"], 3);
  const world = item("world", ["world_high_impact"], 3);
  const alerts = Array.from(
    { length: 8 },
    (_, index) => item(`alert-${index}`, ["general_tech_security"], 5, index),
  );
  const selected = selectDailyBrief([...alerts, readableAi, world], [], 10);
  assert.equal(selected[0].id, readableAi.id);
  assert.equal(selected[1].id, world.id);
});

test("a readable AI publisher gets a place and security alerts are capped at one", () => {
  nextId = 186;
  const publisher = item("the-verge-ai", ["applied_ai"], 3);
  const vendor = item("openai", ["applied_ai", "openai_chatgpt_codex"], 4);
  const alerts = Array.from(
    { length: 4 },
    (_, index) =>
      item(`security-${index}`, ["general_tech_security"], 5, index),
  );
  const selected = selectDailyBrief([...alerts, vendor, publisher], [], 10);
  assert.equal(selected[0].id, publisher.id);
  assert.equal(
    selected.filter((entry) =>
      entry.topic_tags.includes("general_tech_security")
    ).length,
    1,
  );
});

test("ordinary community projects are excluded from scheduled briefs", () => {
  nextId = 188;
  const projects = [
    item("hacker-news-show", ["community_projects", "ai_agents_automation"], 3),
    item("dev-showdev", ["community_projects", "developer_tools"], 3),
  ];
  const selected = selectDailyBrief(projects, [], 10);
  assert.equal(selected.length, 0);
});

test("at most one exceptional relevant community project can compete", () => {
  nextId = 189;
  const projects = [
    item("hacker-news-show", ["community_projects", "ai_agents_automation"], 4),
    item("dev-showdev", ["community_projects", "developer_tools"], 4),
    item("dev-showdev", ["community_projects", "applied_ai"], 5),
  ];
  const selected = selectDailyBrief(projects, [], 10);
  assert.equal(
    selected.filter((entry) => entry.topic_tags.includes("community_projects"))
      .length,
    1,
  );
});

test("scheduled briefs reject ordinary importance-two items but searches can use them", () => {
  nextId = 190;
  const small = item("small", ["n8n"], 2);
  const strong = item("strong", ["openai_chatgpt_codex"], 3);
  const scheduled = selectDailyBrief([small, strong], [], 10);
  const searched = selectDailyBrief([small, strong], [], 5, {
    scheduled: false,
  });
  assert.deepEqual(scheduled.map((entry) => entry.id), [strong.id]);
  assert.ok(searched.some((entry) => entry.id === small.id));
});

test("technical detail stays searchable without entering the scheduled brief", () => {
  nextId = 195;
  const detail = item("nvidia-technical-blog", [
    "nvidia_ai_hardware",
    "python_apis",
  ], 4);
  detail.title = "Introducing CUDA Rust: Two Tracks for Writing GPU Kernels";
  const scheduled = selectDailyBrief([detail], [], 10);
  const searched = selectDailyBrief([detail], [], 5, { scheduled: false });
  assert.equal(scheduled.length, 0);
  assert.deepEqual(searched.map((entry) => entry.id), [detail.id]);
});

test("hard mute blocks old unsent AWS items", () => {
  nextId = 200;
  const aws = item("aws-whats-new", ["aws_cloud"], 5);
  const openai = item("openai", ["openai_chatgpt_codex"], 3);
  const selected = selectDailyBrief(
    [aws, openai],
    [preference("aws_cloud", -2)],
    10,
  );
  assert.deepEqual(selected.map((entry) => entry.id), [openai.id]);
});

test("muting AWS news does not hide an AWS-related internship", () => {
  nextId = 250;
  const internship = item(
    "jobicy-uae-internships",
    ["aws_cloud", "career_opportunities", "uae_jobs_internships"],
    3,
  );
  const selected = selectDailyBrief(
    [internship],
    [preference("aws_cloud", -2)],
    10,
  );
  assert.deepEqual(selected.map((entry) => entry.id), [internship.id]);
});

test("more and less controls change ranking without changing stored importance", () => {
  nextId = 300;
  const claude = item("anthropic", ["anthropic_claude"], 3, 2);
  const agents = item("agents", ["ai_agents_automation"], 3, 1);
  const selected = selectDailyBrief(
    [agents, claude],
    [preference("anthropic_claude", 1), preference("ai_agents_automation", -1)],
    1,
  );
  assert.equal(selected[0].id, claude.id);
  assert.equal(claude.importance, 3);
});

test("weak world news is excluded while major world news can be fallback", () => {
  nextId = 400;
  const weak = item("bbc", ["world_high_impact"], 2);
  const major = item("bbc", ["world_high_impact"], 3);
  const selected = selectDailyBrief([weak, major], [], 10);
  assert.deepEqual(selected.map((entry) => entry.id), [major.id]);
});

test("duplicates and one-source domination are limited", () => {
  nextId = 500;
  const repeatedSource = Array.from(
    { length: 6 },
    (_, index) => item("one-source", ["ai_models_releases"], 3, index),
  );
  const duplicate = { ...repeatedSource[0] };
  const selected = selectDailyBrief([...repeatedSource, duplicate], [], 10);
  assert.equal(selected.length, 2);
  assert.equal(
    new Set(selected.map((entry) => entry.id)).size,
    selected.length,
  );
});
