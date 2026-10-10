# Yusuf's free AI News Inbox

This package sends up to ten useful stories to Telegram at **7:00 AM and 7:00 PM UAE time**.

It uses:

- Supabase Free for the schedule, code, and database.
- Telegram for delivery, 0-3 ratings, and direct feed controls.
- Allowlisted publisher, official-company, developer-community, RSS, Atom,
  JSON, and release-note feeds.
- Local rules for filtering and ranking. No paid AI is required.

The brief now treats relevance and news value as different things. A tutorial
about a tool Yusuf uses is not automatically news. Scheduled cards require a
stronger score and favor real AI announcements, major world politics, hardware,
security changes, UAE news, and opportunities. Resolved or small service
incidents and generic technical guides are removed. Routine AWS news remains
muted by default.

One of the ten places is reserved for a real, current opportunity. The
opportunity is selected before urgent AI stories. If no current opportunity
passes the filters, the bot sends at most nine cards instead of inventing one
or sending filler. Other named categories are included only when they have worthwhile news.
The opportunity search now includes Jobicy's UAE-internship RSS feed. Jobicy is
an aggregator, so its listing is a lead to investigate, not proof that Yusuf is
eligible or that every employer detail is correct.

For balance, one source can take at most two places and security alerts can
take at most one place. This prevents a single technical feed from dominating
the brief.

Up to two places are reserved for useful projects shared by individual
developers or small teams. These currently come from DEV Community's
**Show DEV** feed and Hacker News **Show HN**. They are labelled **People Are
Building** and explicitly treated as leads, not verified facts.

Every card starts with a clear type such as **AI News**, **World News**, **UAE
News**, **Opportunity**, **People Are Building**, or **Security News**. The
short version then says **Here's what's happening** in simple language instead
of leading with a large headline. Opportunity cards also show one short
reminder to check application details. The rating buttons remain, but the card
does not repeatedly ask Yusuf to rate it.

**Full story** expands the same Telegram message with the longer detail supplied
by the source feed. **Short version** collapses it again. Yusuf can also reply
`full story` to a stored news message.

Yusuf can also request fresh results at any time:

- `/news` searches for more news based on saved interests.
- `/news Codex` searches for a specific topic.
- Natural wording such as `get me more Claude news` also works.

Each request refreshes only the fixed allowlisted sources, returns up to five new
matching stories, and avoids stories already sent. Searches may show a smaller
technical update that is excluded from the scheduled brief. To protect the free service,
the limit is four searches per hour. The short search query is stored privately
for up to seven days to prevent duplicate Telegram retries and enforce that limit.

## Change the feed from Telegram

- `/more Codex usage resets`
- `/less Docker`
- `/mute AWS`
- `/unmute AWS`
- `/interests`

Every card also has **More like this** and **Less like this** buttons. A link,
copied post, or screenshot can be sent with a short explanation such as
`/more Claude Code releases`. The free bot does not download screenshots, read
their pixels, or open arbitrary user links. This avoids paid OCR and unsafe URL
fetching.

Explicit controls are stored in the private `user_preferences` table. They stay
separate from the learned 0-3 rating weights, so one system cannot erase the
other.

## Honest limit

The free version reads monitored publisher and public community feeds.
High-level AI coverage now
includes TechCrunch AI and The Verge AI. World coverage includes BBC World and
Al Jazeera, but only major political or global events pass the daily filter.
Opinion pages are excluded. The bot cannot independently prove
every claim or inspect every application page like an AI researcher could. The
source link remains on every card so Yusuf can check the original report.

Common AI words are changed into simpler wording using fixed local rules. This
helps with terms such as “agentic AI,” “edge AI,” “inference,” GPUs, and APIs.
Because no paid AI is used, unusual technical language may still appear.

"Full story" means the fuller text available in the publisher's feed plus a link
to the complete article. It is not an AI-written investigation.

The free Supabase plan can also pause a quiet project. This makes the package suitable for a free trial, but it is not a guaranteed-delivery service.

Free, dependable monitoring of every employee post on X is not available. The
official X API is paid, and unofficial mirrors are fragile. Yusuf can paste an
important post into Telegram and teach the bot its topic.

Instagram's official API does not provide a broad feed of ordinary personal
accounts. It mainly supports connected Business and Creator accounts. The bot
does not scrape X or Instagram or bypass their access rules.

## What stays when you upgrade

Telegram, the schedule, the database, your ratings, and your news history stay unchanged. A paid AI can later replace the rule-based analysis and explanation step.

Start with [SETUP.md](SETUP.md).
