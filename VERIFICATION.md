# Verification status

Passed locally:

- 90 rule, preference, search, community-discovery, adaptive-selection,
  delivery-safety, schedule, beginner-card, and configuration tests.
- TypeScript syntax checks for every Edge Function file.
- Real Deno type checks for both Edge Function entry points and the live-feed checker with the pinned dependencies.
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

- All 31 allowlisted endpoints returned usable content.
- DEV Show DEV returned 12 project posts.
- The official Hacker News API returned 24 current Show HN projects through
  the bounded parser.

Still required to activate this feed-quality update on Yusuf's existing accounts:

- Apply `202610070001_fix_security_classification.sql` so stored security notices stop appearing as opportunities.
- Apply `202610110001_community_discovery.sql` to add the two builder sources.
- Deploy both updated functions.
- Send `/news Codex` and `/news` in Telegram.
- Confirm the next brief contains no old tutorial or routine-status backlog.

The existing twice-daily deployment remains active until this package is deployed.
