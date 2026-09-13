import type { RawFeedItem } from "./types.ts";

export function newestFeedItems(
  items: RawFeedItem[],
  limit: number,
): RawFeedItem[] {
  return [...items]
    .sort((left, right) => {
      const leftDate = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      const rightDate = right.publishedAt ? Date.parse(right.publishedAt) : 0;
      return rightDate - leftDate;
    })
    .slice(0, Math.max(0, limit));
}
