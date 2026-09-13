import assert from "node:assert/strict";
import test from "node:test";
import { newestFeedItems } from "../supabase/functions/_shared/feed_item_order.ts";
import type { RawFeedItem } from "../supabase/functions/_shared/types.ts";

function feedItem(index: number, day: number): RawFeedItem {
  return {
    externalKey: String(index),
    title: `Item ${index}`,
    summary: "",
    url: `https://example.com/${index}`,
    publishedAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z`,
  };
}

test("new items are selected before applying the feed cap", () => {
  const items = Array.from({ length: 100 }, (_, index) => feedItem(index, 1));
  items[79] = feedItem(79, 6);
  items[53] = feedItem(53, 5);

  const selected = newestFeedItems(items, 40);
  assert.equal(selected.length, 40);
  assert.equal(selected[0].externalKey, "79");
  assert.equal(selected[1].externalKey, "53");
});
