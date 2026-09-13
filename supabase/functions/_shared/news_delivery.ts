import type { NewsItemRow } from "./types.ts";
import { adminClient } from "./supabase.ts";
import { AmbiguousTelegramError, sendNewsMessage } from "./telegram.ts";
import { safeError } from "./utils.ts";

type Database = ReturnType<typeof adminClient>;

export async function deliverNewsItem(
  database: Database,
  item: NewsItemRow,
  sourceName: string,
  position: number,
  total: number,
  heading: string,
): Promise<boolean> {
  const { data: claimData, error: claimError } = await database.rpc("claim_news_item_delivery", {
    p_item_id: item.id,
  });
  if (claimError) throw new Error(`Could not claim story delivery: ${claimError.message}`);
  const claimToken = typeof claimData === "string" ? claimData : null;
  if (!claimToken) return false;

  let telegramAccepted = false;
  try {
    const telegramMessageId = await sendNewsMessage(
      item,
      sourceName,
      position,
      total,
      heading,
    );
    telegramAccepted = true;
    const { data, error } = await database.rpc("finish_news_item_delivery", {
      p_item_id: item.id,
      p_claim_token: claimToken,
      p_telegram_message_id: telegramMessageId,
    });
    if (error) throw new Error(`Telegram sent but saving delivery failed: ${error.message}`);
    if (data !== true) throw new Error("Story delivery claim expired before completion");
    return true;
  } catch (error) {
    const message = safeError(error);
    const uncertain = telegramAccepted || error instanceof AmbiguousTelegramError;
    const { error: failureError } = await database.rpc(
      uncertain ? "quarantine_news_item_delivery" : "fail_news_item_delivery",
      {
        p_item_id: item.id,
        p_claim_token: claimToken,
        p_error: message,
      },
    );
    if (failureError) {
      console.error(`Saving story delivery failure also failed: ${safeError(failureError.message)}`);
    }
    throw error;
  }
}
