import assert from "node:assert/strict";
import test from "node:test";
import {
  isFullStoryRequest,
  parseTelegramCommand,
} from "../supabase/functions/_shared/telegram_commands.ts";
import {
  buildPreferenceRows,
  preferenceTopics,
} from "../supabase/functions/_shared/preferences.ts";

test("direct preference commands map to absolute levels", () => {
  assert.deepEqual(parseTelegramCommand("/more Claude"), {
    kind: "set_preference",
    level: 1,
    subject: "Claude",
  });
  assert.deepEqual(parseTelegramCommand("/less AWS"), {
    kind: "set_preference",
    level: -1,
    subject: "AWS",
  });
  assert.deepEqual(parseTelegramCommand("/mute@MyBot AWS"), {
    kind: "set_preference",
    level: -2,
    subject: "AWS",
  });
  assert.deepEqual(parseTelegramCommand("/unmute AWS"), {
    kind: "unmute",
    subject: "AWS",
  });
});

test("natural copied-post instructions are recognized", () => {
  const prefix = parseTelegramCommand("I want more of this: Codex usage resets");
  assert.equal(prefix?.kind, "set_preference");
  assert.equal(prefix && "level" in prefix ? prefix.level : null, 1);

  const suffix = parseTelegramCommand(
    "A global ChatGPT usage reset is coming tonight. More like this",
  );
  assert.deepEqual(suffix, {
    kind: "set_preference",
    level: 1,
    subject: "A global ChatGPT usage reset is coming tonight.",
  });
});

test("full-story wording is not mistaken for a preference", () => {
  assert.equal(isFullStoryRequest("more details"), true);
  assert.equal(parseTelegramCommand("more details"), null);
});

test("interest and help commands are recognized", () => {
  assert.deepEqual(parseTelegramCommand("show my interests"), { kind: "interests" });
  assert.deepEqual(parseTelegramCommand("/start"), { kind: "help" });
});

test("on-demand news searches are recognized without breaking preferences", () => {
  assert.deepEqual(parseTelegramCommand("/news"), { kind: "search_news", subject: "" });
  assert.deepEqual(parseTelegramCommand("/news@MyBot Codex"), {
    kind: "search_news",
    subject: "Codex",
  });
  assert.deepEqual(parseTelegramCommand("get me more Codex news"), {
    kind: "search_news",
    subject: "Codex",
  });
  assert.deepEqual(parseTelegramCommand("find latest Claude news"), {
    kind: "search_news",
    subject: "Claude",
  });
  assert.deepEqual(parseTelegramCommand("show me more news about UAE internships"), {
    kind: "search_news",
    subject: "UAE internships",
  });
  assert.deepEqual(parseTelegramCommand("get me more news"), {
    kind: "search_news",
    subject: "",
  });
  assert.deepEqual(parseTelegramCommand("Can you get me more news about NVIDIA AI?"), {
    kind: "search_news",
    subject: "NVIDIA AI",
  });
  assert.deepEqual(parseTelegramCommand("what's new with Grok?"), {
    kind: "search_news",
    subject: "Grok",
  });
  assert.deepEqual(parseTelegramCommand("/more Codex"), {
    kind: "set_preference",
    level: 1,
    subject: "Codex",
  });
});

test("known brands and goals become specific saved topics", () => {
  assert.deepEqual(preferenceTopics("Claude and Anthropic news"), ["anthropic_claude"]);
  assert.ok(preferenceTopics("NVIDIA AI hardware").includes("nvidia_ai_hardware"));
  assert.ok(preferenceTopics("NVIDIA AI hardware").includes("ai_hardware_chips"));
  assert.ok(preferenceTopics("Codex usage reset").includes("ai_access_pricing"));

  const rows = buildPreferenceRows("/more Codex usage resets", 1, 99);
  assert.deepEqual(
    rows.map((row) => row.normalized_label).sort(),
    ["topic:ai_access_pricing", "topic:openai_chatgpt_codex"],
  );
  assert.ok(rows.every((row) => row.telegram_message_id === 99));
});

test("bare unknown links require a description and are never fetched", () => {
  assert.deepEqual(buildPreferenceRows("https://example.com/post/123", 1, 1), []);
});

test("official product links can identify a topic without scraping", () => {
  const rows = buildPreferenceRows("https://www.anthropic.com/news/example", 1, 1);
  assert.equal(rows[0]?.normalized_label, "topic:anthropic_claude");
  assert.equal(rows[0]?.source_url, "https://www.anthropic.com/news/example");
});

test("unknown but meaningful descriptions create a limited keyword rule", () => {
  const rows = buildPreferenceRows("quantum computing research breakthroughs", 1, 1);
  assert.equal(rows.length, 1);
  assert.match(rows[0].normalized_label, /^custom:/);
  assert.ok(rows[0].match_terms.length >= 2);
  assert.ok((rows[0].example_text?.length ?? 0) <= 1_000);
});
