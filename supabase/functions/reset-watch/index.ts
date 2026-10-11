import type { FeedSource } from "../_shared/types.ts";
import { APPROVED_FEEDS } from "../_shared/feed_sources.ts";
import { fetchAndParseFeed } from "../_shared/feed_parser.ts";
import {
  formatResetWatchMessage,
  newestUnseenResetPost,
  type ResetWatchPost,
} from "../_shared/reset_watch_logic.ts";
import {
  actionableResetPost,
  fetchVerifiedTiboPost,
  type TiboStatusReference,
  tiboStatusReference,
  type VerifiedTiboPost,
} from "../_shared/tibo_post_fetcher.ts";
import { adminClient } from "../_shared/supabase.ts";
import {
  AmbiguousTelegramError,
  sendSystemMessage,
} from "../_shared/telegram.ts";
import {
  constantTimeEqual,
  jsonResponse,
  requiredEnv,
  safeError,
} from "../_shared/utils.ts";

const WATCH_SOURCE: FeedSource = {
  id: "tibo-reset-watch",
  name: "Codex Radar reset discovery feed",
  feed_url: APPROVED_FEEDS["tibo-reset-watch"],
  homepage_url: "https://x.com/thsottiaux",
  trust_level: "discovery",
  source_kind: "rss",
  base_priority: 100,
  enabled: true,
};
const MAX_POST_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_POST_LOOKUPS_PER_RUN = 10;

interface AlertRow {
  post_id: string;
  status: string;
}

async function saveIgnoredPosts(
  database: ReturnType<typeof adminClient>,
  posts: readonly VerifiedTiboPost[],
): Promise<void> {
  if (posts.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await database.from("reset_watch_alerts").upsert(
    posts.map((post) => ({
      post_id: post.postId,
      post_url: post.postUrl,
      post_text: post.text,
      alert_kind: post.kind ?? "possible",
      published_at: post.publishedAt,
      status: "ignored",
      completed_at: now,
    })),
    { onConflict: "post_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not save reset baseline: ${error.message}`);
}

async function finishAlert(
  database: ReturnType<typeof adminClient>,
  postId: string,
  claimToken: string,
  status: "sent" | "failed" | "uncertain",
  messageId: number | null,
  errorMessage: string | null,
): Promise<void> {
  const { data, error } = await database.rpc("finish_reset_watch_alert", {
    p_post_id: postId,
    p_claim_token: claimToken,
    p_status: status,
    p_telegram_message_id: messageId,
    p_error: errorMessage,
  });
  if (error) throw new Error(`Could not finish reset alert: ${error.message}`);
  if (data !== true) throw new Error("Reset alert ownership expired");
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405);
  }
  const suppliedSecret = request.headers.get("x-cron-secret") ?? "";
  if (!constantTimeEqual(suppliedSecret, requiredEnv("CRON_SECRET"))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const database = adminClient();
  let selected: ResetWatchPost | null = null;
  let claimToken: string | null = null;

  try {
    const rawItems = await fetchAndParseFeed(WATCH_SOURCE, 18_000);
    const cutoff = Date.now() - MAX_POST_AGE_MS;
    const uniqueReferences = new Map<string, TiboStatusReference>();
    for (const item of rawItems) {
      const reference = tiboStatusReference(item);
      if (!reference || Date.parse(reference.publishedAt) < cutoff) continue;
      const previous = uniqueReferences.get(reference.postId);
      if (
        !previous ||
        Date.parse(reference.publishedAt) > Date.parse(previous.publishedAt)
      ) uniqueReferences.set(reference.postId, reference);
    }
    const references = [...uniqueReferences.values()].sort((left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
    );

    if (references.length === 0) {
      return jsonResponse({
        ok: true,
        checked: rawItems.length,
        alerted: false,
      });
    }

    const postIds = references.map((post) => post.postId);
    const { data: existingData, error: existingError } = await database
      .from("reset_watch_alerts")
      .select("post_id,status")
      .in("post_id", postIds);
    if (existingError) {
      throw new Error(`Could not load reset alerts: ${existingError.message}`);
    }
    const seenIds = new Set(
      ((existingData ?? []) as AlertRow[])
        .filter((row) => row.status !== "failed")
        .map((row) => row.post_id),
    );
    const unseenReferences = references
      .filter((reference) => !seenIds.has(reference.postId))
      .slice(0, MAX_POST_LOOKUPS_PER_RUN);
    if (unseenReferences.length === 0) {
      return jsonResponse({
        ok: true,
        checked: rawItems.length,
        alerted: false,
      });
    }

    const lookups = await Promise.allSettled(
      unseenReferences.map((reference) => fetchVerifiedTiboPost(reference)),
    );
    const verified: VerifiedTiboPost[] = [];
    const failedReferences: TiboStatusReference[] = [];
    for (let index = 0; index < lookups.length; index += 1) {
      const result = lookups[index];
      if (result.status === "fulfilled") {
        verified.push(result.value);
      } else {
        failedReferences.push(unseenReferences[index]);
        console.error(
          `Tibo post ${unseenReferences[index].postId} could not be checked: ${
            safeError(result.reason)
          }`,
        );
      }
    }

    const staleVerified = verified.filter((post) =>
      Date.parse(post.publishedAt) < cutoff
    );
    const freshVerified = verified.filter((post) =>
      Date.parse(post.publishedAt) >= cutoff
    );
    const nonActionable = freshVerified.filter((post) => post.kind === null);
    const actionable = freshVerified
      .map(actionableResetPost)
      .filter((post): post is ResetWatchPost => post !== null);
    const choice = newestUnseenResetPost(actionable, new Set<string>());
    selected = choice.selected;
    await saveIgnoredPosts(database, [
      ...staleVerified,
      ...nonActionable,
      ...choice.ignored,
    ]);

    if (
      !selected && failedReferences.length > 0 ||
      selected &&
        failedReferences.some((reference) =>
          Date.parse(reference.publishedAt) > Date.parse(selected!.publishedAt)
        )
    ) {
      throw new Error(
        "A newer Tibo post could not be verified; the alert will be retried",
      );
    }

    if (!selected) {
      return jsonResponse({
        ok: true,
        checked: rawItems.length,
        verified: verified.length,
        alerted: false,
      });
    }

    const { data: claimData, error: claimError } = await database.rpc(
      "claim_reset_watch_alert",
      {
        p_post_id: selected.postId,
        p_post_url: selected.postUrl,
        p_post_text: selected.text,
        p_alert_kind: selected.kind,
        p_published_at: selected.publishedAt,
      },
    );
    if (claimError) {
      throw new Error(`Could not claim reset alert: ${claimError.message}`);
    }
    claimToken = typeof claimData === "string" ? claimData : null;
    if (!claimToken) {
      return jsonResponse({
        ok: true,
        checked: rawItems.length,
        alerted: false,
      });
    }

    let messageId: number;
    try {
      messageId = await sendSystemMessage(formatResetWatchMessage(selected));
    } catch (error) {
      const message = safeError(error);
      await finishAlert(
        database,
        selected.postId,
        claimToken,
        error instanceof AmbiguousTelegramError ? "uncertain" : "failed",
        null,
        message,
      );
      throw error;
    }

    await finishAlert(
      database,
      selected.postId,
      claimToken,
      "sent",
      messageId,
      null,
    );
    return jsonResponse({
      ok: true,
      checked: rawItems.length,
      verified: verified.length,
      alerted: true,
      kind: selected.kind,
      postId: selected.postId,
    });
  } catch (error) {
    const message = safeError(error);
    console.error(`Reset watch failed: ${message}`);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
