import type {
  NewsItemRow,
  PreferenceLevel,
  TelegramMessage,
  TelegramUpdate,
  TopicWeightRow,
  UserPreferenceRow,
} from "../_shared/types.ts";
import { adminClient } from "../_shared/supabase.ts";
import {
  isFullStoryRequest,
  parseTelegramCommand,
} from "../_shared/telegram_commands.ts";
import {
  buildPreferenceRows,
  specificTopics,
  TOPIC_LABELS,
} from "../_shared/preferences.ts";
import { findOnDemandNews } from "../_shared/on_demand_news.ts";
import { deliverNewsItem } from "../_shared/news_delivery.ts";
import {
  answerCallback,
  editStoryMessage,
  sendSystemMessage,
} from "../_shared/telegram.ts";
import {
  cleanText,
  constantTimeEqual,
  jsonResponse,
  requiredEnv,
  safeError,
} from "../_shared/utils.ts";

const CALLBACK_PATTERN = /^r:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-3])$/i;
const PREFERENCE_CALLBACK_PATTERN = /^p:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(-?1)$/i;
const FULL_STORY_CALLBACK_PATTERN = /^f:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SHORT_STORY_CALLBACK_PATTERN = /^s:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MAX_WEBHOOK_BYTES = 100_000;

interface Story {
  item: NewsItemRow;
  sourceName: string;
}

interface ClaimedNewsRequest {
  claimed: boolean;
  request_token: string | null;
  reason: "new" | "stale_retry" | "running" | "duplicate" | "busy" | "rate_limited" | string;
}

function messageText(message: TelegramMessage | undefined): string {
  return cleanText(message?.text ?? message?.caption ?? "", 4_000);
}

async function loadStory(
  database: ReturnType<typeof adminClient>,
  filter: { itemId: string } | { telegramMessageId: number },
): Promise<Story | null> {
  let query = database.from("news_items").select("*");
  query = "itemId" in filter
    ? query.eq("id", filter.itemId)
    : query.eq("telegram_message_id", filter.telegramMessageId);

  const { data: itemData, error: itemError } = await query.maybeSingle();
  if (itemError) throw new Error(`Could not load story: ${itemError.message}`);
  if (!itemData) return null;

  const item = itemData as NewsItemRow;
  const { data: sourceData, error: sourceError } = await database
    .from("news_sources")
    .select("name")
    .eq("id", item.source_id)
    .maybeSingle();
  if (sourceError) throw new Error(`Could not load story source: ${sourceError.message}`);

  return {
    item,
    sourceName: typeof sourceData?.name === "string" ? sourceData.name : item.source_id,
  };
}

function preferenceReply(rows: UserPreferenceRow[], level: PreferenceLevel): string {
  const labels = [...new Set(rows.map((row) => row.label))].slice(0, 6).join(", ");
  if (level === 1) return `Saved. Show me more: ${labels}`;
  if (level === -1) return `Saved. Show me less: ${labels}`;
  return `Muted: ${labels}`;
}

async function savePreferences(
  database: ReturnType<typeof adminClient>,
  rows: UserPreferenceRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await database.from("user_preferences").upsert(rows, {
    onConflict: "normalized_label",
  });
  if (error) throw new Error(`Could not save preference: ${error.message}`);
}

async function rowsFromMessage(
  database: ReturnType<typeof adminClient>,
  message: TelegramMessage,
  subject: string,
  level: PreferenceLevel,
): Promise<UserPreferenceRow[]> {
  let input = subject;
  let fallbackTopics: string[] = [];

  if (!input && Number.isInteger(message.reply_to_message?.message_id)) {
    const repliedId = message.reply_to_message?.message_id as number;
    const story = await loadStory(database, { telegramMessageId: repliedId });
    if (story) {
      input = `${story.item.title} ${story.item.summary}`;
      fallbackTopics = specificTopics(story.item.topic_tags);
    } else {
      input = messageText(message.reply_to_message);
    }
  }

  return buildPreferenceRows(
    input,
    level,
    Number.isInteger(message.message_id) ? message.message_id as number : null,
    fallbackTopics,
  );
}

function helpText(): string {
  return [
    "Search for more news now",
    "",
    "/news",
    "/news Codex",
    "get me more Claude news",
    "",
    "Change your news feed",
    "",
    "/more Codex usage resets",
    "/less Docker",
    "/mute AWS",
    "/unmute AWS",
    "/interests",
    "",
    "You can also reply to a news card with /more or /less. For a link, copied post, or screenshot, include a few words explaining what part you want. The free bot does not read image pixels or open arbitrary links.",
  ].join("\n");
}

async function interestsText(
  database: ReturnType<typeof adminClient>,
): Promise<string> {
  const [preferencesResult, weightsResult] = await Promise.all([
    database.from("user_preferences").select("*").eq("active", true)
      .order("updated_at", { ascending: false }),
    database.from("topic_weights").select("topic,weight,rating_count")
      .gt("rating_count", 0)
      .order("rating_count", { ascending: false }),
  ]);
  if (preferencesResult.error) {
    throw new Error(`Could not load preferences: ${preferencesResult.error.message}`);
  }
  if (weightsResult.error) {
    throw new Error(`Could not load ratings: ${weightsResult.error.message}`);
  }

  const rows = (preferencesResult.data ?? []) as UserPreferenceRow[];
  const group = (level: PreferenceLevel): string => {
    const labels = [...new Set(rows.filter((row) => row.level === level).map((row) => row.label))];
    return labels.length > 0 ? labels.slice(0, 15).join(", ") : "None";
  };
  const learned = ((weightsResult.data ?? []) as TopicWeightRow[])
    .slice(0, 10)
    .map((row) => {
      const label = TOPIC_LABELS[row.topic as keyof typeof TOPIC_LABELS] ?? row.topic.replaceAll("_", " ");
      return `${label} (${row.rating_count} rating${row.rating_count === 1 ? "" : "s"})`;
    });

  return [
    "Your saved feed controls",
    "",
    `More: ${group(1)}`,
    `Less: ${group(-1)}`,
    `Muted: ${group(-2)}`,
    "",
    `Learned from 0-3 buttons: ${learned.length > 0 ? learned.join(", ") : "No ratings yet"}`,
  ].join("\n");
}

async function finishNewsRequest(
  database: ReturnType<typeof adminClient>,
  updateId: number,
  claimToken: string,
  status: "success" | "failed",
  itemsSent: number,
  errorMessage: string | null = null,
): Promise<boolean> {
  const { data, error } = await database.rpc("finish_telegram_news_request", {
    p_update_id: updateId,
    p_claim_token: claimToken,
    p_status: status,
    p_items_sent: itemsSent,
    p_error: errorMessage,
  });
  if (error) throw new Error(`Could not finish news request: ${error.message}`);
  return data === true;
}

async function handleNewsSearch(
  database: ReturnType<typeof adminClient>,
  updateId: number,
  message: TelegramMessage,
  subject: string,
): Promise<Response> {
  const messageId = Number(message.message_id);
  if (!Number.isSafeInteger(updateId) || updateId < 0 || !Number.isSafeInteger(messageId) || messageId < 1) {
    return jsonResponse({ error: "Invalid Telegram identifiers" }, 400);
  }

  const query = cleanText(subject, 500);
  if (query.length > 160) {
    await sendSystemMessage(
      "Keep the news topic under 160 characters. Example: /news Codex usage limits",
      messageId,
    );
    return jsonResponse({ ok: true, action: "news_search_help" });
  }
  if (/https?:\/\//i.test(query)) {
    await sendSystemMessage(
      "Search using a topic, not a link. Example: /news NVIDIA AI hardware. The bot never opens arbitrary links.",
      messageId,
    );
    return jsonResponse({ ok: true, action: "news_search_help" });
  }

  const { data: claimData, error: claimError } = await database.rpc("claim_telegram_news_request", {
    p_update_id: updateId,
    p_message_id: messageId,
    p_search_query: query,
  });
  if (claimError) throw new Error(`Could not start news search: ${claimError.message}`);
  const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as ClaimedNewsRequest | null;
  if (!claim?.claimed) {
    if (claim?.reason === "running") {
      // Telegram retries non-2xx webhook responses. This lets an interrupted
      // search recover after its ten-minute claim expires.
      return jsonResponse({ ok: false, action: "news_search_running" }, 503);
    }
    if (claim?.reason === "duplicate") {
      return jsonResponse({ ok: true, action: "duplicate_news_search" });
    }
    if (claim?.reason === "busy") {
      await sendSystemMessage("Another news search is still running. Try again in about ten minutes.", messageId);
      return jsonResponse({ ok: true, action: "news_search_busy" });
    }
    if (claim?.reason === "rate_limited") {
      await sendSystemMessage("You can run four news searches per hour. Try again later.", messageId);
      return jsonResponse({ ok: true, action: "news_search_rate_limited" });
    }
    throw new Error("News search was not claimed");
  }
  const claimToken = claim.request_token;
  if (!claimToken) throw new Error("News search claim token is missing");

  let itemsSent = 0;
  try {
    await sendSystemMessage(
      query
        ? `Searching the trusted sources for: ${query}`
        : "Searching the trusted sources for more news based on your interests.",
      messageId,
    );
    const result = await findOnDemandNews(database, query);
    if (result.items.length === 0) {
      const noResultText = result.sourcesOk === 0
        ? "The trusted sources could not be refreshed right now. Try again later."
        : "No additional useful matching news was found in the trusted sources.";
      await sendSystemMessage(noResultText, messageId);
    } else {
      const heading = query ? `Requested news: ${query}` : "Requested news";
      for (let index = 0; index < result.items.length; index += 1) {
        const item = result.items[index];
        const delivered = await deliverNewsItem(
          database,
          item,
          result.sourceNames.get(item.source_id) ?? item.source_id,
          index + 1,
          result.items.length,
          heading,
        );
        if (delivered) itemsSent += 1;
      }
    }

    const finished = await finishNewsRequest(database, updateId, claimToken, "success", itemsSent);
    if (!finished) throw new Error("News request ownership expired");
    return jsonResponse({
      ok: true,
      action: "news_search",
      itemsSent,
      sourcesChecked: result.sourcesChecked,
      sourcesOk: result.sourcesOk,
      sourcesFailed: result.sourcesFailed,
    });
  } catch (error) {
    const errorMessage = safeError(error);
    console.error(`On-demand news search failed: ${errorMessage}`);
    let failureRecorded = false;
    try {
      failureRecorded = await finishNewsRequest(
        database,
        updateId,
        claimToken,
        "failed",
        itemsSent,
        errorMessage,
      );
    } catch (finishError) {
      console.error(`Recording search failure also failed: ${safeError(finishError)}`);
    }
    if (failureRecorded) {
      try {
        await sendSystemMessage("The news search failed safely. Try again in a few minutes.", messageId);
      } catch (notificationError) {
        console.error(`Search failure notice could not be sent: ${safeError(notificationError)}`);
      }
    }
    // Return success so Telegram does not retry the same update and duplicate cards.
    return jsonResponse({ ok: true, action: "news_search_failed" });
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405);
  }

  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!constantTimeEqual(suppliedSecret, requiredEnv("TELEGRAM_WEBHOOK_SECRET"))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    return jsonResponse({ error: "Request too large" }, 413);
  }

  let update: TelegramUpdate;
  try {
    const text = await request.text();
    if (text.length > MAX_WEBHOOK_BYTES) return jsonResponse({ error: "Request too large" }, 413);
    update = JSON.parse(text) as TelegramUpdate;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const allowedUser = requiredEnv("TELEGRAM_ALLOWED_USER_ID");
  const allowedChat = requiredEnv("TELEGRAM_CHAT_ID");
  const callback = update.callback_query;
  if (callback) {
    if (String(callback.from?.id ?? "") !== allowedUser ||
      String(callback.message?.chat?.id ?? "") !== allowedChat) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }
    if (!callback.id) return jsonResponse({ error: "Invalid callback" }, 400);

    const ratingMatch = CALLBACK_PATTERN.exec(callback.data ?? "");
    const preferenceMatch = PREFERENCE_CALLBACK_PATTERN.exec(callback.data ?? "");
    const fullStoryMatch = FULL_STORY_CALLBACK_PATTERN.exec(callback.data ?? "");
    const shortStoryMatch = SHORT_STORY_CALLBACK_PATTERN.exec(callback.data ?? "");
    try {
      const database = adminClient();
      if (ratingMatch) {
        const score = Number(ratingMatch[2]);
        const { error } = await database.rpc("record_news_feedback", {
          p_item_id: ratingMatch[1],
          p_score: score,
        });
        if (error) throw new Error(error.message);

        await answerCallback(callback.id, `Saved: ${score}/3`);
        return jsonResponse({ ok: true, action: "rating" });
      }

      if (preferenceMatch) {
        const story = await loadStory(database, { itemId: preferenceMatch[1] });
        if (!story) {
          await answerCallback(callback.id, "Story is no longer available");
          return jsonResponse({ ok: true, action: "story_missing" });
        }
        const messageId = callback.message?.message_id;
        if (!Number.isInteger(messageId) || Number(story.item.telegram_message_id) !== messageId) {
          await answerCallback(callback.id, "This button does not match the story");
          return jsonResponse({ ok: true, action: "story_mismatch" });
        }
        const level = Number(preferenceMatch[2]) as PreferenceLevel;
        const rows = buildPreferenceRows(
          `${story.item.title} ${story.item.summary}`,
          level,
          messageId as number,
          specificTopics(story.item.topic_tags),
        );
        await savePreferences(database, rows);
        await answerCallback(callback.id, preferenceReply(rows, level));
        return jsonResponse({ ok: true, action: "preference" });
      }

      if (fullStoryMatch || shortStoryMatch) {
        const itemId = (fullStoryMatch ?? shortStoryMatch)?.[1] as string;
        const story = await loadStory(database, { itemId });
        if (!story) {
          await answerCallback(callback.id, "Story is no longer available");
          return jsonResponse({ ok: true, action: "story_missing" });
        }

        const messageId = callback.message?.message_id;
        if (!Number.isInteger(messageId) || Number(story.item.telegram_message_id) !== messageId) {
          await answerCallback(callback.id, "This story button does not match the message");
          return jsonResponse({ ok: true, action: "story_mismatch" });
        }

        const expanded = Boolean(fullStoryMatch);
        try {
          await answerCallback(callback.id, expanded ? "Opening full story" : "Shortening story");
        } catch (answerError) {
          console.error(`Answering story button failed: ${safeError(answerError)}`);
        }
        await editStoryMessage(story.item, story.sourceName, messageId as number, expanded);
        return jsonResponse({ ok: true, action: expanded ? "full_story" : "short_story" });
      }

      return jsonResponse({ error: "Unknown callback" }, 400);
    } catch (error) {
      const errorMessage = safeError(error);
      console.error(`Callback failed: ${errorMessage}`);
      return jsonResponse({ ok: false, error: errorMessage }, 500);
    }
  }

  const message = update.message;
  if (!message) return jsonResponse({ ok: true, ignored: true });
  if (String(message.from?.id ?? "") !== allowedUser ||
    String(message.chat?.id ?? "") !== allowedChat) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const text = messageText(message);
  if (isFullStoryRequest(text)) {
    const replyToMessageId = message.reply_to_message?.message_id;
    try {
      if (!Number.isInteger(replyToMessageId)) {
        await sendSystemMessage("Reply directly to a news item with: full story", message.message_id);
        return jsonResponse({ ok: true, action: "story_help" });
      }
      const story = await loadStory(adminClient(), { telegramMessageId: replyToMessageId as number });
      if (!story) {
        await sendSystemMessage(
          "I could not match that message to a stored news item. Use the Full story button on a new brief.",
          message.message_id,
        );
        return jsonResponse({ ok: true, action: "story_missing" });
      }
      await editStoryMessage(story.item, story.sourceName, replyToMessageId as number, true);
      return jsonResponse({ ok: true, action: "full_story" });
    } catch (error) {
      const errorMessage = safeError(error);
      console.error(`Full-story message failed: ${errorMessage}`);
      return jsonResponse({ ok: false, error: errorMessage }, 500);
    }
  }

  const command = parseTelegramCommand(text);
  try {
    if (!command) {
      if ((message.photo?.length ?? 0) > 0) {
        await sendSystemMessage(
          "I received the screenshot, but the free bot cannot read its pixels. Add a caption such as: /more Codex usage resets",
          message.message_id,
        );
        return jsonResponse({ ok: true, action: "photo_help" });
      }
      return jsonResponse({ ok: true, ignored: true });
    }

    if (command.kind === "help") {
      await sendSystemMessage(helpText(), message.message_id);
      return jsonResponse({ ok: true, action: "help" });
    }

    const database = adminClient();
    if (command.kind === "interests") {
      await sendSystemMessage(await interestsText(database), message.message_id);
      return jsonResponse({ ok: true, action: "interests" });
    }

    if (command.kind === "search_news") {
      return await handleNewsSearch(database, Number(update.update_id), message, command.subject);
    }

    if (command.kind === "set_preference") {
      const rows = await rowsFromMessage(database, message, command.subject, command.level);
      if (rows.length === 0) {
        await sendSystemMessage(
          "Tell me what part matters. Example: /more Codex usage resets. A bare link or screenshot is not enough for the free bot to understand safely.",
          message.message_id,
        );
        return jsonResponse({ ok: true, action: "preference_help" });
      }
      await savePreferences(database, rows);
      await sendSystemMessage(preferenceReply(rows, command.level), message.message_id);
      return jsonResponse({ ok: true, action: "preference" });
    }

    const rows = await rowsFromMessage(database, message, command.subject, 1);
    if (rows.length === 0) {
      await sendSystemMessage("Say what to unmute. Example: /unmute AWS", message.message_id);
      return jsonResponse({ ok: true, action: "unmute_help" });
    }
    const keys = rows.map((row) => row.normalized_label);
    const { error } = await database.from("user_preferences").delete().in("normalized_label", keys);
    if (error) throw new Error(`Could not unmute preference: ${error.message}`);
    await sendSystemMessage(
      `Removed that feed control: ${[...new Set(rows.map((row) => row.label))].join(", ")}`,
      message.message_id,
    );
    return jsonResponse({ ok: true, action: "unmute" });
  } catch (error) {
    const errorMessage = safeError(error);
    console.error(`Telegram command failed: ${errorMessage}`);
    return jsonResponse({ ok: false, error: errorMessage }, 500);
  }
});
