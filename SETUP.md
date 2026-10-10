# Setup: free Telegram news brief

You need about 20-30 minutes. This setup is designed to stay inside free tiers.

## Before you start

You need:

1. A free Supabase account and project.
2. A Telegram account.
3. Node.js 20 or newer on the computer used for setup.

The automation does **not** use Codex after deployment.

## 1. Make the Telegram bot

1. Open Telegram and message `@BotFather`.
2. Send `/newbot` and follow its instructions.
3. Keep the bot token private.
4. Open your new bot and send it `/start`. A bot cannot message you until you do this.

To find your Telegram IDs, open PowerShell in this package and run:

```powershell
./tools/get-telegram-ids.ps1
```

Paste the bot token only when the script asks. Save the shown user ID and chat ID.

## 2. Make the Supabase project

1. Create a Free project at [Supabase](https://supabase.com/dashboard).
2. Copy the project reference from **Project Settings > General**.
3. Keep the database password private.
4. Confirm the project still says **Free**. Do not enable paid compute or a paid plan for this trial.

## 3. Deploy the database and functions

Open PowerShell in this package, then run:

```powershell
./tools/deploy.ps1
```

The script installs a current free Supabase command-line tool, uses your saved sign-in when possible, applies the database migrations, and deploys both functions. It opens browser sign-in only when the saved sign-in no longer works. It does not store your Telegram token. On an existing installation, the twice-daily migration also replaces the old 7 PM-only schedule when the saved Vault values are present.

## 4. Turn on the 7 AM and 7 PM schedules

1. In Supabase, open **SQL Editor**.
2. Copy `supabase/setup_schedule.sql` into the editor. Do not edit the local file.
3. Replace the one marked project URL placeholder in the editor.
4. Run it once.
5. Copy the `CRON_SECRET` value shown in the final result. Do not share or screenshot it.

Each brief tries at 7:00, 7:15, and 7:45 AM or PM UAE time. Once a brief succeeds, its later attempts stop automatically. Morning and evening have separate locks, so one cannot block the other.

## 5. Add private secrets

First run this helper to make a strong Telegram webhook value:

```powershell
./tools/make-secrets.ps1
```

Then, in Supabase, open **Project Settings > Edge Functions > Secrets**. Add these five values:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `TELEGRAM_CHAT_ID` | Chat ID from the helper script |
| `TELEGRAM_ALLOWED_USER_ID` | User ID from the helper script |
| `TELEGRAM_WEBHOOK_SECRET` | Value from `make-secrets.ps1` |
| `CRON_SECRET` | Value returned by the schedule SQL |

Do not put these values in files or screenshots.

## 6. Connect Telegram's buttons and replies

Run:

```powershell
./tools/set-telegram-webhook.ps1
```

Use the same webhook secret saved in Supabase.

This enables the 0-3 rating buttons, **More like this**, **Less like this**, the
**Full story** button, preference commands, direct `full story` replies, and
on-demand news searches.

## 7. Test it now

Run:

```powershell
./tools/test-daily-news.ps1
```

Use the same cron secret saved in Supabase. You should receive a brief or a clear “no useful items” message in Telegram.

## How ratings work

- `3`: show more of that specific topic.
- `2`: slightly raise that topic.
- `1`: no change yet.
- `0`: reduce that topic.

One rating is a weak signal. If an item has several topics, its rating is split between them instead of making a broad assumption. Repeated and recent ratings matter more. A genuinely urgent item can still appear even if its topic has a low rating.

## How to directly change the feed

- `/more Claude Code`
- `/less Docker`
- `/mute AWS`
- `/unmute AWS`
- `/interests`

You can also reply `/more` or `/less` to a news card. For a pasted link, copied
post, or screenshot, add a few words explaining what matters. Example:
`/more Codex usage resets`. The free bot does not read screenshot pixels or open
arbitrary links.

## Search for more news now

- `/news` finds more stories based on your saved interests.
- `/news Codex` searches for a topic.
- You can also say `get me more Claude news`.
- A search returns up to five new useful stories.
- The limit is four searches per hour to protect the free Supabase allowance.
- Searches use only the fixed allowlisted feeds. They do not search the whole web,
  open a supplied link, or monitor every social-media post.

## Short and full story views

- Every card starts with a clear type: AI News, World News, UAE News,
  Opportunity, People Are Building, Security News, Robotics News, or Tech News.
- The short card says “Here's what's happening” in simple language and links
  to the source instead of leading with a large headline.
  An opportunity also shows one reminder to check its deadline, cost,
  eligibility, certificate, and UAE availability. Importance, status,
  recommended action, and “why for Yusuf” are not displayed.
- The 0-3 rating buttons remain, but the card does not ask for a rating in its text.
- Press **Full story** to expand the same message.
- Press **Short version** to collapse it again.
- Or reply directly to a stored news message with `full story`.
- The expanded view uses the longer text supplied in the source feed. It does
  not scrape the full webpage or independently verify the publisher's claims.

## Important limits

- Only fixed allowlisted feeds and public community sources are read
  automatically. DEV Show DEV and Hacker News Show HN supply community-built
  projects, with at most two places in a scheduled brief.
- Scheduled briefs reject resolved or routine outages, generic how-to guides,
  and other low-value technical filler. One place is reserved for a current
  opportunity; if none exists, the brief contains at most nine cards.
- Reliable free monitoring of every X post is not available; X charges for API
  reads. Instagram does not offer a broad ordinary-user discovery feed through
  its official API. Paste important posts into the bot.
- An official announcement is evidence of what the organization announced, not proof that every claim is true.
- The free local rules explain common technical words, but they cannot simplify every unusual term as well as a paid AI model.
- “Full story” contains available source-feed details and the source article link; it is not a paid-AI analysis.
- Free Supabase projects can be paused for low activity and have no uptime guarantee.
- Missed items can be recovered for up to seven days after the project resumes.
- Docker's security feed has no item dates. Its first read is stored silently, and an undated backlog older than seven days is not sent.
- If Telegram's reply is lost after a send, that uncertain story is skipped instead of retried. This strongly reduces duplicate cards, though no Telegram bot can guarantee exactly-once delivery during a simultaneous Telegram and database failure.

## Stop the automation

In Supabase SQL Editor, run:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'ai-news-daily-1900-dubai',
  'ai-news-retry-1915-dubai',
  'ai-news-retry-1945-dubai',
  'ai-news-morning-0700-dubai',
  'ai-news-morning-retry-0715-dubai',
  'ai-news-morning-retry-0745-dubai',
  'ai-news-evening-1900-dubai',
  'ai-news-evening-retry-1915-dubai',
  'ai-news-evening-retry-1945-dubai'
);
```

This stops future briefs without deleting your history or ratings.

## Official references

- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Telegram Bot API](https://core.telegram.org/bots/api)
