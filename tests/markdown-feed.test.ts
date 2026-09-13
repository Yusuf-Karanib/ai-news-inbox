import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownReleaseNotes } from "../supabase/functions/_shared/markdown_feed_parser.ts";
import type { FeedSource } from "../supabase/functions/_shared/types.ts";

const source: FeedSource = {
  id: "xai-release-notes",
  name: "xAI Release Notes",
  feed_url: "https://docs.x.ai/developers/release-notes.md",
  homepage_url: "https://docs.x.ai/developers/release-notes",
  trust_level: "official",
  source_kind: "markdown",
  base_priority: 100,
  enabled: true,
};

test("xAI-style Markdown headings become safe distinct feed items", () => {
  const markdown = `
# Release Notes
## September
### Grok Bot
Grok Bot is now available. See [the guide](/grok-bot/overview).

\`\`\`bash
### This is code, not news
do-not-run-this
\`\`\`

## August
### Grok 4.6
The new model is available.
`;
  const items = parseMarkdownReleaseNotes(markdown, source);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Grok Bot");
  assert.match(items[0].summary, /Grok Bot is now available/);
  assert.doesNotMatch(items[0].summary, /do-not-run-this/);
  assert.equal(items[0].publishedAt, null);
  assert.notEqual(items[0].url, items[1].url);
  assert.match(items[0].url, /^https:\/\/docs\.x\.ai\//);
});
