import assert from "node:assert/strict";
import test from "node:test";
import { hackerNewsItem } from "../supabase/functions/_shared/community_feed_parser.ts";

test("a Show HN API item becomes a community discovery story", () => {
  const result = hackerNewsItem({
    id: 12345,
    by: "small-builder",
    time: 1_788_863_400,
    title: "Show HN: I built a small AI debugging tool",
    text: "It explains failed agent runs in plain language.",
    url: "https://example.com/project?utm_source=hackernews",
    type: "story",
  });

  assert.ok(result);
  assert.equal(result.externalKey, "12345");
  assert.equal(result.url, "https://news.ycombinator.com/item?id=12345");
  assert.match(result.summary, /small-builder shared this project/);
  assert.match(result.summary, /https:\/\/example\.com\/project/);
  assert.doesNotMatch(result.summary, /utm_source/);
});

test("deleted Hacker News items are ignored", () => {
  assert.equal(
    hackerNewsItem({ id: 12345, deleted: true, title: "Show HN" }),
    null,
  );
});
