import { APPROVED_FEEDS } from "../supabase/functions/_shared/feed_sources.ts";
import { fetchAndParseFeed } from "../supabase/functions/_shared/feed_parser.ts";
import {
  fetchVerifiedTiboPost,
  tiboStatusReference,
} from "../supabase/functions/_shared/tibo_post_fetcher.ts";
import type { FeedSource } from "../supabase/functions/_shared/types.ts";

const results = await Promise.all(
  Object.entries(APPROVED_FEEDS).map(async ([id, feedUrl]) => {
    const source: FeedSource = {
      id,
      name: id,
      feed_url: feedUrl,
      homepage_url: feedUrl,
      trust_level: id === "dev-showdev" || id === "hacker-news-show" ||
          id === "tibo-reset-watch"
        ? "discovery"
        : "official",
      source_kind: id === "xai-release-notes"
        ? "markdown"
        : feedUrl.endsWith(".json")
        ? "json"
        : feedUrl.endsWith(".atom")
        ? "atom"
        : "rss",
      base_priority: 90,
      enabled: true,
    };

    try {
      const items = await fetchAndParseFeed(source, 20_000);
      if (id === "tibo-reset-watch") {
        const reference = items
          .map(tiboStatusReference)
          .find((candidate) => candidate !== null);
        if (!reference) {
          throw new Error(
            "Codex Radar did not contain an exact Tibo post link",
          );
        }
        const verified = await fetchVerifiedTiboPost(reference);
        return {
          id,
          ok: true,
          count: items.length,
          newest: verified.text,
          verifiedPostId: verified.postId,
          verifiedAuthor: "thsottiaux",
        };
      }
      return {
        id,
        ok: true,
        count: items.length,
        newest: items[0]?.title ?? null,
      };
    } catch (error) {
      return { id, ok: false, error: String(error) };
    }
  }),
);

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.ok)) Deno.exit(1);
