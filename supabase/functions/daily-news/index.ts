import type {
  FeedSource,
  NewsItemRow,
  RunStats,
  TopicWeightRow,
  UserPreferenceRow,
} from "../_shared/types.ts";
import { selectDailyBrief } from "../_shared/brief_selector.ts";
import { deliverNewsItem } from "../_shared/news_delivery.ts";
import { ingestNewsSources } from "../_shared/news_ingestion.ts";
import { adminClient } from "../_shared/supabase.ts";
import { sendSystemMessage } from "../_shared/telegram.ts";
import {
  constantTimeEqual,
  jsonResponse,
  requiredEnv,
  safeError,
  uaeDate,
} from "../_shared/utils.ts";

const MAX_SOURCES = 30;
const MAX_MESSAGES = 10;
const MAX_CANDIDATES = 300;

type RunSlot = "morning" | "evening" | "manual";

interface ClaimedRun {
  claimed: boolean;
  run_token: string | null;
  reason: string;
}

interface RunRequest {
  trigger: string;
  runSlot: RunSlot | null;
}

async function finishRun(
  database: ReturnType<typeof adminClient>,
  runDate: string,
  runSlot: RunSlot,
  runToken: string,
  status: "success" | "failed",
  stats: RunStats,
  errorMessage: string | null = null,
): Promise<void> {
  const { data, error } = await database.rpc("finish_news_run", {
    p_run_date: runDate,
    p_run_slot: runSlot,
    p_run_token: runToken,
    p_status: status,
    p_sources_ok: stats.sourcesOk,
    p_sources_failed: stats.sourcesFailed,
    p_items_found: stats.itemsFound,
    p_items_sent: stats.itemsSent,
    p_error: errorMessage,
  });
  if (error) throw new Error(`Could not finish run: ${error.message}`);
  if (data !== true) throw new Error("Run ownership expired before completion");
}

async function readRunRequest(request: Request): Promise<RunRequest> {
  try {
    const body = await request.json() as { trigger?: unknown; runSlot?: unknown };
    const runSlot = body.runSlot === "morning" || body.runSlot === "evening"
      ? body.runSlot
      : null;
    return {
      trigger: typeof body.trigger === "string" ? body.trigger.slice(0, 40) : "manual",
      runSlot,
    };
  } catch {
    return { trigger: "manual", runSlot: null };
  }
}

function inferredScheduledSlot(date = new Date()): RunSlot {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date));
  return Number.isFinite(hour) && hour < 12 ? "morning" : "evening";
}

function briefHeading(runSlot: RunSlot): string {
  if (runSlot === "morning") return "7 AM news brief";
  if (runSlot === "evening") return "7 PM news brief";
  return "News test";
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405);
  }

  const suppliedSecret = request.headers.get("x-cron-secret") ?? "";
  if (!constantTimeEqual(suppliedSecret, requiredEnv("CRON_SECRET"))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const runRequest = await readRunRequest(request);
  const isManual = new URL(request.url).searchParams.get("manual") === "true";
  const runSlot: RunSlot = isManual ? "manual" : runRequest.runSlot ?? inferredScheduledSlot();
  const trigger = runRequest.trigger;
  const runDate = uaeDate();
  const database = adminClient();
  const stats: RunStats = { sourcesOk: 0, sourcesFailed: 0, itemsFound: 0, itemsSent: 0 };
  let runToken: string | null = null;

  try {
    const { data: claimData, error: claimError } = await database.rpc("claim_news_run", {
      p_run_date: runDate,
      p_run_slot: runSlot,
    });
    if (claimError) throw new Error(`Could not claim run: ${claimError.message}`);

    const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as ClaimedRun | null;
    if (!claim?.claimed || !claim.run_token) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: claim?.reason ?? "not_claimed",
        runDate,
        runSlot,
      });
    }
    runToken = claim.run_token;

    const [
      { data: sourceData, error: sourceError },
      { data: weightData, error: weightError },
      { data: preferenceData, error: preferenceError },
    ] = await Promise.all([
      database.from("news_sources").select("*").eq("enabled", true)
        .order("base_priority", { ascending: false })
        .order("id", { ascending: true })
        .limit(MAX_SOURCES),
      database.from("topic_weights").select("topic,weight,rating_count"),
      database.from("user_preferences").select("*").eq("active", true),
    ]);
    if (sourceError) throw new Error(`Could not load sources: ${sourceError.message}`);
    if (weightError) throw new Error(`Could not load topic weights: ${weightError.message}`);
    if (preferenceError) throw new Error(`Could not load preferences: ${preferenceError.message}`);

    const topicWeights = (weightData ?? []) as TopicWeightRow[];
    const preferences = (preferenceData ?? []) as UserPreferenceRow[];
    const ingestion = await ingestNewsSources(
      database,
      (sourceData ?? []) as FeedSource[],
      topicWeights,
    );
    stats.sourcesOk = ingestion.sourcesOk;
    stats.sourcesFailed = ingestion.sourcesFailed;
    stats.itemsFound = ingestion.itemsFound;

    const cutoffIso = new Date(ingestion.cutoffMilliseconds).toISOString();
    const { data: candidateData, error: unsentError } = await database
      .from("news_items")
      .select("*")
      .is("sent_at", null)
      .is("suppressed_at", null)
      .gte("discovered_at", cutoffIso)
      .order("importance", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("discovered_at", { ascending: false })
      .limit(MAX_CANDIDATES);
    if (unsentError) throw new Error(`Could not load the brief: ${unsentError.message}`);

    const unsent = selectDailyBrief(
      (candidateData ?? []) as NewsItemRow[],
      preferences,
      MAX_MESSAGES,
    );
    const sourceNames = new Map(ingestion.sources.map((source) => [source.id, source.name]));
    const heading = briefHeading(runSlot);

    if (unsent.length === 0) {
      await sendSystemMessage(
        `${heading}\n\nNo additional useful items were found since the previous brief. The bot will not add filler.`,
      );
    } else {
      for (let index = 0; index < unsent.length; index += 1) {
        const item = unsent[index];
        try {
          const delivered = await deliverNewsItem(
            database,
            item,
            sourceNames.get(item.source_id) ?? item.source_id,
            index + 1,
            unsent.length,
            heading,
          );
          if (delivered) stats.itemsSent += 1;
        } catch (error) {
          const message = safeError(error);
          throw new Error(`Delivery failed for ${item.id}: ${message}`);
        }
      }
    }

    const completedAt = new Date().toISOString();
    const stateRows = [
      {
        key: "last_success",
        value: { at: completedAt, run_date: runDate, run_slot: runSlot },
        updated_at: completedAt,
      },
      {
        key: `last_success:${runSlot}`,
        value: { at: completedAt, run_date: runDate, run_slot: runSlot },
        updated_at: completedAt,
      },
    ];
    const { error: stateError } = await database.from("news_state").upsert(stateRows, {
      onConflict: "key",
    });
    if (stateError) throw new Error(`Could not save success state: ${stateError.message}`);

    await finishRun(database, runDate, runSlot, runToken, "success", stats);
    return jsonResponse({ ok: true, runDate, runSlot, trigger, ...stats });
  } catch (error) {
    const message = safeError(error);
    console.error(`Daily news run failed: ${message}`);

    if (runToken) {
      try {
        await finishRun(database, runDate, runSlot, runToken, "failed", stats, message);
      } catch (finishError) {
        console.error(`Recording run failure also failed: ${safeError(finishError)}`);
      }
    }

    if (isManual || trigger === "retry_2") {
      try {
        await sendSystemMessage(
          "AI News Inbox failed after its final attempt for this brief. Your history is safe. Check the Supabase function logs when convenient.",
        );
      } catch (notificationError) {
        console.error(`Failure notice could not be sent: ${safeError(notificationError)}`);
      }
    }

    return jsonResponse({ ok: false, runDate, runSlot, error: message }, 500);
  }
});
