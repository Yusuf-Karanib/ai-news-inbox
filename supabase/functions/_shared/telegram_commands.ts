import { cleanText } from "./utils.ts";
import type { PreferenceLevel } from "./types.ts";

const FULL_STORY_PATTERN = /^(?:\/fullstory(?:@[a-z0-9_]+)?|(?:(?:please\s+)?(?:give\s+me\s+)?(?:the\s+)?)?full\s+(?:story|details)(?:\s+please)?|more\s+details)[.!?]*$/i;

export type TelegramCommand =
  | { kind: "search_news"; subject: string }
  | { kind: "set_preference"; level: PreferenceLevel; subject: string }
  | { kind: "unmute"; subject: string }
  | { kind: "interests" }
  | { kind: "help" };

export function isFullStoryRequest(value: unknown): boolean {
  return FULL_STORY_PATTERN.test(cleanText(value, 120));
}

function trimCommandSubject(value: string): string {
  return cleanText(value.replace(/^[:\-–—\s]+/, ""), 1_000);
}

function trimSearchSubject(value: string): string {
  return cleanText(value.replace(/^[:\-–—\s]+/, ""), 500);
}

export function parseTelegramCommand(value: unknown): TelegramCommand | null {
  const text = cleanText(value, 4_000);
  if (!text || isFullStoryRequest(text)) return null;

  if (/^(?:\/start|\/help)(?:@[a-z0-9_]+)?[.!?]*$/i.test(text)) {
    return { kind: "help" };
  }
  if (/^(?:\/interests(?:@[a-z0-9_]+)?|show\s+(?:me\s+)?my\s+interests|what\s+are\s+my\s+interests)[.!?]*$/i.test(text)) {
    return { kind: "interests" };
  }

  const slashSearch = /^\/(?:news|search)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text);
  if (slashSearch) {
    return { kind: "search_news", subject: trimSearchSubject(slashSearch[1] ?? "") };
  }

  const searchText = text
    .replace(/^(?:please\s+|(?:can|could|would)\s+you\s+)/i, "")
    .trim();
  if (/^(?:news|search\s+news)[.!?]*$/i.test(searchText) ||
    /^(?:(?:get|show|give)(?:\s+me)?\s+|i\s+want\s+)?(?:(?:the\s+)?(?:latest|recent)\s+)?more\s+news[.!?]*$/i.test(searchText) ||
    /^(?:(?:get|show|give)(?:\s+me)?\s+)(?:(?:the\s+)?(?:latest|recent)\s+)?news[.!?]*$/i.test(searchText)) {
    return { kind: "search_news", subject: "" };
  }

  const newsAbout = /^(?:(?:get|show|give)(?:\s+me)?\s+|i\s+want\s+|find\s+|search\s+(?:for\s+)?)?(?:(?:the\s+)?(?:latest|recent|more)\s+)?news\s+(?:about|on)\s+([\s\S]+?)[.!?]*$/i.exec(searchText);
  if (newsAbout) {
    return { kind: "search_news", subject: trimSearchSubject(newsAbout[1]) };
  }

  const subjectNews = /^(?:(?:get|show|give)(?:\s+me)?\s+|i\s+want\s+|find\s+|search\s+(?:for\s+)?)?(?:(?:the\s+)?(?:latest|recent|more)\s+)?([\s\S]+?)\s+news[.!?]*$/i.exec(searchText);
  if (subjectNews && !/^(?:of\s+this|like\s+this)$/i.test(subjectNews[1].trim())) {
    return { kind: "search_news", subject: trimSearchSubject(subjectNews[1]) };
  }

  const whatIsNew = /^(?:what(?:'s|\s+is)\s+new\s+(?:with|about)|any\s+news\s+(?:about|on))\s+([\s\S]+?)[.!?]*$/i.exec(searchText);
  if (whatIsNew) {
    return { kind: "search_news", subject: trimSearchSubject(whatIsNew[1]) };
  }

  const slash = /^\/(more|less|mute|unmute)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text);
  if (slash) {
    const verb = slash[1].toLowerCase();
    const subject = trimCommandSubject(slash[2] ?? "");
    if (verb === "unmute") return { kind: "unmute", subject };
    const level: PreferenceLevel = verb === "more" ? 1 : verb === "less" ? -1 : -2;
    return { kind: "set_preference", level, subject };
  }

  const listPrefix = /^(more|less|mute|unmute)\s+([\s\S]+)$/i.exec(text);
  if (listPrefix && !/^more\s+(?:details|information)\b/i.test(text)) {
    const verb = listPrefix[1].toLowerCase();
    const subject = trimCommandSubject(listPrefix[2]);
    if (verb === "unmute") return { kind: "unmute", subject };
    const level: PreferenceLevel = verb === "more" ? 1 : verb === "less" ? -1 : -2;
    return { kind: "set_preference", level, subject };
  }

  const naturalPrefix = /^(?:(?:i\s+want|show\s+me)\s+)?(more|less)\s+(?:of\s+this|like\s+this)(?:\s*[:\-–—]\s*|\s+)?([\s\S]*)$/i.exec(text);
  if (naturalPrefix) {
    return {
      kind: "set_preference",
      level: naturalPrefix[1].toLowerCase() === "more" ? 1 : -1,
      subject: trimCommandSubject(naturalPrefix[2] ?? ""),
    };
  }

  const naturalSuffix = /^([\s\S]+?)\s+(?:(?:i\s+want|show\s+me)\s+)?(more|less)\s+(?:of\s+this|like\s+this)[.!?]*$/i.exec(text);
  if (naturalSuffix) {
    return {
      kind: "set_preference",
      level: naturalSuffix[2].toLowerCase() === "more" ? 1 : -1,
      subject: trimCommandSubject(naturalSuffix[1]),
    };
  }

  return null;
}
