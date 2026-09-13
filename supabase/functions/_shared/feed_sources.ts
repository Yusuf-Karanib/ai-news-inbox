import type { FeedSource } from "./types.ts";

// Both the ID and URL must match. A changed database row cannot make the
// function fetch an arbitrary server or a private network address.
export const APPROVED_FEEDS: Readonly<Record<string, string>> = Object.freeze({
  "openai-news": "https://openai.com/news/rss.xml",
  "openai-codex-releases": "https://github.com/openai/codex/releases.atom",
  "openai-status": "https://status.openai.com/history.atom",
  "anthropic-platform-releases":
    "https://platform.claude.com/docs/en/release-notes/feed.xml",
  "anthropic-status": "https://status.claude.com/history.atom",
  "xai-release-notes": "https://docs.x.ai/developers/release-notes.md",
  "xai-status": "https://status.x.ai/feed.xml",
  "nvidia-ai-news": "https://nvidianews.nvidia.com/cats/generative_al.xml",
  "nvidia-technical-blog": "https://developer.nvidia.com/blog/feed/",
  "amd-news": "https://newsroom.amd.com/rss.xml?content-type=news",
  "google-deepmind": "https://deepmind.google/blog/rss.xml",
  "hugging-face-blog": "https://huggingface.co/blog/feed.xml",
  "microsoft-ai-news": "https://news.microsoft.com/source/topics/ai/feed/",
  "techcrunch-ai":
    "https://techcrunch.com/category/artificial-intelligence/feed/",
  "the-verge-ai":
    "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
  "42-abu-dhabi": "https://42abudhabi.ae/feed/",
  "bbc-world": "https://feeds.bbci.co.uk/news/world/rss.xml",
  "aljazeera-news": "https://www.aljazeera.com/xml/rss/all.xml",
  "jobicy-uae-internships":
    "https://jobicy.com/jobs/feed?type=internship&geo=united-arab-emirates",
  "aws-whats-new": "https://aws.amazon.com/about-aws/whats-new/recent/feed/",
  "aws-security-bulletins":
    "https://aws.amazon.com/security/security-bulletins/rss/feed/",
  "supabase-changelog": "https://supabase.com/changelog-rss.xml",
  "n8n-blog": "https://blog.n8n.io/rss/",
  "docker-blog": "https://www.docker.com/blog/feed/",
  "docker-security-announcements":
    "https://docs.docker.com/security/security-announcements/index.xml",
  "github-changelog": "https://github.blog/changelog/feed/",
  "python-insider": "https://blog.python.org/rss.xml",
  "ros-announcements":
    "https://discourse.openrobotics.org/c/ros/ros-announcements-news/112.rss",
  "dubai-future-foundation": "https://www.dubaifuture.ae/feed/",
});

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function isApprovedFeed(source: FeedSource): boolean {
  const expected = APPROVED_FEEDS[source.id];
  if (!expected || !source.enabled || source.trust_level !== "official") {
    return false;
  }
  if (
    source.source_kind !== "rss" && source.source_kind !== "atom" &&
    source.source_kind !== "markdown"
  ) return false;
  return normalizedUrl(source.feed_url) === normalizedUrl(expected);
}

export function isApprovedRedirect(
  sourceId: string,
  candidate: string,
): boolean {
  const expected = APPROVED_FEEDS[sourceId];
  if (!expected) return false;

  try {
    const expectedUrl = new URL(expected);
    const candidateUrl = new URL(candidate);
    return candidateUrl.protocol === "https:" &&
      candidateUrl.hostname.toLowerCase() ===
        expectedUrl.hostname.toLowerCase();
  } catch {
    return false;
  }
}
