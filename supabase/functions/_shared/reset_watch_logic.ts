import type { RawFeedItem } from "./types.ts";
import { cleanText, parseDate } from "./utils.ts";

export type ResetAlertKind =
  | "global_announced"
  | "global_completed"
  | "banked_announced"
  | "banked_completed"
  | "possible";

export interface ResetWatchPost {
  postId: string;
  postUrl: string;
  text: string;
  publishedAt: string;
  kind: ResetAlertKind;
}

const RESET_CONTEXT = /\b(?:reset(?:s|ting|ted)?|usage limits?)\b/i;
const BANKED_CONTEXT =
  /\b(?:banked reset|reset bank|piggy bank|credit(?:ed|ing)? (?:one|an additional) reset)\b/i;
const COMPLETED_SIGNAL =
  /\b(?:all propagated|propagated across|reset(?:s)? (?:has|have|is|are|was|were)?\s*(?:been )?(?:processed|completed|finished|applied|done|landed)|(?:have|has|we(?:'ve)?|i) (?:now )?reset|(?:limits?|usage) (?:have|has|were|are) (?:been )?reset|back to 100%|all fixed|confirmed landed)\b/i;
const BANKED_COMPLETED_SIGNAL =
  /\b(?:banked reset (?:has |have |is |was )?(?:landed|added|loaded|available)|(?:added|loaded|credited) (?:a |the )?banked reset|confirmed landed|should be in your (?:account|piggy bank))\b/i;
const BANKED_ANNOUNCED_SIGNAL =
  /\b(?:loading|adding|crediting|granting|will (?:load|add|credit|grant)|coming|lands?|landing)\b/i;
const GLOBAL_ANNOUNCED_SIGNAL =
  /\b(?:global reset|resetting (?:the )?(?:usage )?limits?|(?:will|going to|we(?:'re| are)) (?:fully )?reset|reset (?:by|at|today|tomorrow|tonight|this morning|this evening|in the next|within the next|coming|lands?|landing|propagating))\b/i;
const NON_ACTIONABLE_SIGNAL =
  /\b(?:would you rather|four updates or a reset|how was day|vote|poll|can(?:not|'t) (?:really )?(?:give|do) a reset|won't reset|no reset|like giving resets|from there onwards|when (?:my|your) (?:usage )?limits? reset|(?:my|your) (?:weekly|five-hour|5-hour|usage) reset|personal reset|next reset)\b/i;

export function classifyResetPost(
  title: string,
  summary = "",
): ResetAlertKind | null {
  const headline = cleanText(title, 900);
  const context = cleanText(`${title} ${summary}`, 2_500);
  if (!RESET_CONTEXT.test(context)) return null;
  if (NON_ACTIONABLE_SIGNAL.test(headline)) return null;

  if (BANKED_CONTEXT.test(context)) {
    if (
      BANKED_COMPLETED_SIGNAL.test(context) ||
      COMPLETED_SIGNAL.test(headline)
    ) return "banked_completed";
    if (BANKED_ANNOUNCED_SIGNAL.test(context)) return "banked_announced";
    return "possible";
  }

  if (COMPLETED_SIGNAL.test(headline)) return "global_completed";
  if (GLOBAL_ANNOUNCED_SIGNAL.test(headline)) return "global_announced";
  return "possible";
}

export function toResetWatchPost(
  item: RawFeedItem,
): ResetWatchPost | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(item.url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "x.com") {
    return null;
  }

  const match = parsedUrl.pathname.match(
    /^\/thsottiaux\/status\/([0-9]{8,30})\/?$/i,
  );
  if (!match) return null;

  const publishedAt = parseDate(item.publishedAt);
  const text = cleanText(item.title, 900);
  const kind = classifyResetPost(text, item.summary);
  if (!publishedAt || !text || !kind) return null;

  return {
    postId: match[1],
    postUrl: `https://x.com/thsottiaux/status/${match[1]}`,
    text,
    publishedAt,
    kind,
  };
}

export function newestUnseenResetPost(
  posts: readonly ResetWatchPost[],
  seenPostIds: ReadonlySet<string>,
): { selected: ResetWatchPost | null; ignored: ResetWatchPost[] } {
  const unseen = posts
    .filter((post) => !seenPostIds.has(post.postId))
    .sort((left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
    );
  return {
    selected: unseen[0] ?? null,
    ignored: unseen.slice(1),
  };
}

function dubaiTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function formatResetWatchMessage(post: ResetWatchPost): string {
  let meaning: string;
  let action: string;

  switch (post.kind) {
    case "global_announced":
      meaning = "Tibo says a normal global usage reset is expected soon.";
      action =
        "Do not spend a banked reset yet. Wait for the global reset, then check your Usage page.";
      break;
    case "global_completed":
      meaning = "Tibo says the global usage reset has finished.";
      action =
        "Check your Usage page first. If your allowance refreshed, keep your banked reset.";
      break;
    case "banked_announced":
      meaning = "Tibo says a banked reset is being added.";
      action = "Wait for it to appear in your account before depending on it.";
      break;
    case "banked_completed":
      meaning = "Tibo says a banked reset should now be available.";
      action =
        "Check your Usage page and its expiry before deciding when to use it.";
      break;
    default:
      meaning =
        "Tibo mentioned a reset, but the timing or who receives it is unclear.";
      action = "Do not use a banked reset based on this post alone.";
  }

  return [
    "Codex reset alert",
    "",
    `Tibo posted: “${post.text}”`,
    "",
    `What it means: ${meaning}`,
    `What to do: ${action}`,
    "",
    `Posted: ${dubaiTime(post.publishedAt)} UAE time`,
    `Source: ${post.postUrl}`,
    "",
    "Discovered through Codex Radar and checked against Tibo's exact public post. Always check your own Usage page before spending a banked reset.",
  ].join("\n");
}
