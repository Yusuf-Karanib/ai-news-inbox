import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { APPROVED_FEEDS } from "../supabase/functions/_shared/feed_sources.ts";

const originalMigration = readFileSync(
  new URL("../supabase/migrations/202609060001_ai_news.sql", import.meta.url),
  "utf8",
);
const adaptiveMigration = readFileSync(
  new URL(
    "../supabase/migrations/202609080001_adaptive_preferences.sql",
    import.meta.url,
  ),
  "utf8",
);
const twiceDailyMigration = readFileSync(
  new URL(
    "../supabase/migrations/202609090001_twice_daily_and_search.sql",
    import.meta.url,
  ),
  "utf8",
);
const betterNewsMigration = readFileSync(
  new URL(
    "../supabase/migrations/202609120001_better_news_mix.sql",
    import.meta.url,
  ),
  "utf8",
);
const migration =
  `${originalMigration}\n${adaptiveMigration}\n${twiceDailyMigration}\n${betterNewsMigration}`;
const schedule = readFileSync(
  new URL("../supabase/setup_schedule.sql", import.meta.url),
  "utf8",
);
const config = readFileSync(
  new URL("../supabase/config.toml", import.meta.url),
  "utf8",
);
const webhookSetup = readFileSync(
  new URL("../tools/set-telegram-webhook.ps1", import.meta.url),
  "utf8",
);
const dailyFunction = readFileSync(
  new URL("../supabase/functions/daily-news/index.ts", import.meta.url),
  "utf8",
);
const telegramFunction = readFileSync(
  new URL("../supabase/functions/telegram-feedback/index.ts", import.meta.url),
  "utf8",
);
const onDemandFunction = readFileSync(
  new URL("../supabase/functions/_shared/on_demand_news.ts", import.meta.url),
  "utf8",
);
const searchLogic = readFileSync(
  new URL(
    "../supabase/functions/_shared/news_search_logic.ts",
    import.meta.url,
  ),
  "utf8",
);
const deliveryFunction = readFileSync(
  new URL("../supabase/functions/_shared/news_delivery.ts", import.meta.url),
  "utf8",
);
const telegramClient = readFileSync(
  new URL("../supabase/functions/_shared/telegram.ts", import.meta.url),
  "utf8",
);

test("every fetched feed is seeded by exact ID and URL", () => {
  assert.equal(Object.keys(APPROVED_FEEDS).length, 29);
  for (const [id, url] of Object.entries(APPROVED_FEEDS)) {
    assert.ok(migration.includes(`'${id}'`), `migration is missing ${id}`);
    assert.ok(migration.includes(`'${url}'`), `migration is missing ${url}`);
  }
});

test("the adaptive brief can inspect every source and choose up to ten", () => {
  assert.ok(dailyFunction.includes("const MAX_SOURCES = 30"));
  assert.ok(dailyFunction.includes("const MAX_MESSAGES = 10"));
  assert.ok(dailyFunction.includes("selectDailyBrief"));
  assert.ok(
    dailyFunction.includes('.order("base_priority", { ascending: false })'),
  );
});

test("schedule is 7 AM and 7 PM Dubai with separate safe retries", () => {
  for (
    const expression of [
      "0 3 * * *",
      "15 3 * * *",
      "45 3 * * *",
      "0 15 * * *",
      "15 15 * * *",
      "45 15 * * *",
    ]
  ) {
    assert.ok(
      schedule.includes(`'${expression}'`),
      `missing schedule ${expression}`,
    );
  }
  for (const slot of ["morning", "evening"]) {
    assert.ok(schedule.includes(`'${slot}'`), `missing run slot ${slot}`);
  }
  assert.ok(schedule.includes("'x-cron-secret'"));
  assert.ok(schedule.includes("timeout_milliseconds := 120000"));
  assert.ok(twiceDailyMigration.includes("primary key (run_date, run_slot)"));
  assert.ok(dailyFunction.includes("p_run_slot: runSlot"));
});

test("external endpoints use their own in-code authentication", () => {
  assert.match(config, /\[functions\.daily-news\][\s\S]*?verify_jwt = false/);
  assert.match(
    config,
    /\[functions\.telegram-feedback\][\s\S]*?verify_jwt = false/,
  );
  assert.ok(
    migration.includes(
      "revoke all on table public.news_items from anon, authenticated",
    ),
  );
});

test("Telegram webhook accepts buttons and full-story replies", () => {
  assert.ok(webhookSetup.includes('["callback_query","message"]'));
  assert.ok(
    adaptiveMigration.includes(
      "create table if not exists public.user_preferences",
    ),
  );
});

test("on-demand search is allowlisted, bounded, private, and retry-safe", () => {
  assert.ok(telegramFunction.includes('command.kind === "search_news"'));
  assert.ok(
    onDemandFunction.includes("fetchAndParseFeed") ||
      onDemandFunction.includes("ingestNewsSources"),
  );
  assert.ok(searchLogic.includes("ON_DEMAND_FEED_TIMEOUT_MS = 6_000"));
  assert.ok(searchLogic.includes("MAX_SEARCH_RESULTS = 5"));
  assert.ok(
    twiceDailyMigration.includes(
      "create table if not exists public.telegram_news_requests",
    ),
  );
  assert.ok(twiceDailyMigration.includes("pg_advisory_xact_lock"));
  assert.ok(twiceDailyMigration.includes("v_recent_count >= 4"));
  assert.ok(
    twiceDailyMigration.includes(
      "revoke all on table public.telegram_news_requests from anon, authenticated",
    ),
  );
  assert.ok(
    twiceDailyMigration.includes(
      "requested_at < now() - interval '10 minutes'",
    ),
  );
  assert.ok(
    twiceDailyMigration.includes(
      "returns table (claimed boolean, request_token uuid, reason text)",
    ),
  );
  assert.ok(telegramFunction.includes("p_claim_token: claimToken"));
  assert.ok(telegramFunction.includes('action: "news_search_running" }, 503'));
});

test("story delivery uses a database claim and avoids ambiguous Telegram retries", () => {
  assert.ok(twiceDailyMigration.includes("claim_news_item_delivery"));
  assert.ok(twiceDailyMigration.includes("delivery_claim_token"));
  assert.ok(
    deliveryFunction.includes('database.rpc("claim_news_item_delivery"'),
  );
  assert.ok(
    deliveryFunction.includes('database.rpc("finish_news_item_delivery"'),
  );
  assert.ok(deliveryFunction.includes('"quarantine_news_item_delivery"'));
  assert.ok(
    deliveryFunction.includes("error instanceof AmbiguousTelegramError"),
  );
  assert.ok(dailyFunction.includes("deliverNewsItem"));
  assert.ok(telegramFunction.includes("deliverNewsItem"));
  assert.ok(telegramClient.includes("retryAmbiguousErrors: false"));
  assert.ok(
    telegramClient.includes(
      "response.status >= 500 && options.retryAmbiguousErrors !== false",
    ),
  );
});
