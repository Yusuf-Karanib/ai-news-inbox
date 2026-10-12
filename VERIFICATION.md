# Verification status

Passed locally:

- 100 rule, preference, search, community-discovery, reset-watch, adaptive-selection,
  delivery-safety, schedule, beginner-card, and configuration tests.
- TypeScript syntax checks for every Edge Function file.
- Real Deno type checks for all three Edge Function entry points and the live-feed checker with the pinned dependencies.
- PowerShell syntax checks for every setup helper.
- Exact feed ID/URL matching between the database and fixed code allowlist.
- Secret scan found no real token-shaped values.

Verified online on 8 and 13 September 2026:

- All 29 endpoints returned usable content from the Supabase-compatible Deno runtime.
- TechCrunch AI, The Verge AI, Al Jazeera, and Jobicy UAE Internships were included in that live check.
- The xAI Markdown release-note parser safely ignores code blocks and creates distinct story IDs.
- Supabase Free supports Cron, Edge Functions, Vault, and the required small database usage.
- Telegram supports secret-protected webhooks and callback buttons.

Verified online on 11 October 2026:

- All 31 scheduled-news endpoints returned usable content.
- DEV Show DEV returned 12 project posts.
- The official Hacker News API returned 24 current Show HN projects through
  the bounded parser.
- Codex Radar's public RSS feed returned the current Tibo reset signal from the
  Deno server runtime.
- FxTwitter's single-post endpoint returned the exact Tibo post ID, author,
  original X link, text, and publication time from the Deno server runtime.
- The combined live check passed for all 31 scheduled-news sources plus the
  separate reset-discovery source.

Still required to activate the Tibo reset watch on Yusuf's existing account:

- Apply `202610110002_tibo_reset_watch.sql`.
- Deploy the new `reset-watch` function plus the two shared-code consumers.
- Trigger the watch once and confirm the newest relevant state arrives only once.

The existing twice-daily deployment remains active while this update is deployed.
