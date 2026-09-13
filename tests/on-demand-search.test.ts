import assert from "node:assert/strict";
import test from "node:test";
import type {
  FeedSource,
  NewsItemRow,
  TopicId,
} from "../supabase/functions/_shared/types.ts";
import {
  matchesSearchQuery,
  MAX_SEARCH_RESULTS,
  ON_DEMAND_FEED_TIMEOUT_MS,
  searchIntent,
  sourcesForSearch,
} from "../supabase/functions/_shared/news_search_logic.ts";
import { APPROVED_FEEDS } from "../supabase/functions/_shared/feed_sources.ts";

function source(id: keyof typeof APPROVED_FEEDS): FeedSource {
  return {
    id,
    name: id,
    feed_url: APPROVED_FEEDS[id],
    homepage_url: APPROVED_FEEDS[id],
    trust_level: "official",
    source_kind: id === "xai-release-notes" ? "markdown" : "rss",
    base_priority: 100,
    enabled: true,
  };
}

function item(
  id: string,
  title: string,
  topics: TopicId[],
  summary = "Useful update",
): NewsItemRow {
  return {
    id,
    source_id: "openai-news",
    external_key: id,
    canonical_url: `https://example.com/${id}`,
    title,
    summary,
    published_at: "2026-09-09T00:00:00.000Z",
    discovered_at: "2026-09-09T00:00:00.000Z",
    topic_tags: topics,
    match_reasons: ["test"],
    importance: 3,
    verification_status: "official_source_only",
    action: "save_for_later",
    is_opportunity: false,
    sent_at: null,
    telegram_message_id: null,
    feedback_score: null,
    delivery_attempts: 0,
  };
}

test("known topics refresh only their useful official source group", () => {
  const candidates = [
    source("openai-news"),
    source("openai-codex-releases"),
    source("openai-status"),
    source("anthropic-platform-releases"),
    source("bbc-world"),
  ];
  assert.deepEqual(
    sourcesForSearch(candidates, "Codex").map((value) => value.id),
    ["openai-news", "openai-codex-releases", "openai-status"],
  );
});

test("topic, keyword, broad AI, and personalized matching stay distinct", () => {
  const codex = item("codex", "Codex gets a new feature", [
    "openai_chatgpt_codex",
  ]);
  const quantum = item("quantum", "Quantum computing research breakthrough", [
    "applied_ai",
  ]);
  const world = item("world", "Major election result", ["world_high_impact"]);

  assert.equal(matchesSearchQuery(codex, "Codex"), true);
  assert.equal(matchesSearchQuery(world, "Codex"), false);
  assert.equal(matchesSearchQuery(quantum, "quantum computing"), true);
  assert.equal(matchesSearchQuery(world, "AI"), false);
  assert.equal(matchesSearchQuery(codex, "AI"), true);
  assert.equal(matchesSearchQuery(world, ""), true);
});

test("AI query is broad AI rather than an empty keyword search", () => {
  const intent = searchIntent("latest AI");
  assert.equal(intent.mode, "broad_ai");
  assert.ok(intent.topics.includes("openai_chatgpt_codex"));
  assert.ok(intent.topics.includes("ai_hardware_chips"));
});

test("a compound search does not mix unrelated topic matches", () => {
  const awsFeature = item("aws", "AWS launches a routine storage feature", [
    "aws_cloud",
  ]);
  const openAiPrice = item("price", "OpenAI changes ChatGPT pricing", [
    "openai_chatgpt_codex",
    "ai_access_pricing",
  ]);
  const awsPrice = item("aws-price", "AWS pricing change", [
    "aws_cloud",
    "ai_access_pricing",
  ]);
  assert.equal(matchesSearchQuery(awsFeature, "AWS pricing"), false);
  assert.equal(matchesSearchQuery(openAiPrice, "AWS pricing"), false);
  assert.equal(matchesSearchQuery(awsPrice, "AWS pricing"), true);
});

test("on-demand resource limits stay small", () => {
  assert.equal(MAX_SEARCH_RESULTS, 5);
  assert.equal(ON_DEMAND_FEED_TIMEOUT_MS, 6_000);
});
