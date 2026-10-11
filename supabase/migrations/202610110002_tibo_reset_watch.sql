-- Watch one explicitly requested public account for reset announcements.
-- The monitor stores a delivery claim before Telegram is called so repeated
-- cron calls cannot create duplicate alerts.

create table if not exists public.reset_watch_alerts (
  post_id text primary key
    check (post_id ~ '^[0-9]{8,30}$'),
  post_url text not null
    check (post_url ~ '^https://x[.]com/thsottiaux/status/[0-9]{8,30}$'),
  post_text text not null
    check (char_length(post_text) between 1 and 1000),
  alert_kind text not null
    check (alert_kind in (
      'global_announced',
      'global_completed',
      'banked_announced',
      'banked_completed',
      'possible'
    )),
  published_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('ignored', 'pending', 'sending', 'sent', 'failed', 'uncertain')),
  claim_token uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  telegram_message_id bigint,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reset_watch_alerts_published_idx
  on public.reset_watch_alerts (published_at desc);

create or replace function public.claim_reset_watch_alert(
  p_post_id text,
  p_post_url text,
  p_post_text text,
  p_alert_kind text,
  p_published_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid := gen_random_uuid();
  v_claimed uuid;
begin
  if p_post_id !~ '^[0-9]{8,30}$'
    or p_post_url !~ '^https://x[.]com/thsottiaux/status/[0-9]{8,30}$'
    or char_length(coalesce(p_post_text, '')) not between 1 and 1000
    or p_alert_kind not in (
      'global_announced',
      'global_completed',
      'banked_announced',
      'banked_completed',
      'possible'
    )
    or p_published_at is null
  then
    raise exception 'invalid reset alert' using errcode = '22023';
  end if;

  insert into public.reset_watch_alerts (
    post_id,
    post_url,
    post_text,
    alert_kind,
    published_at,
    status
  ) values (
    p_post_id,
    p_post_url,
    p_post_text,
    p_alert_kind,
    p_published_at,
    'pending'
  )
  on conflict (post_id) do nothing;

  update public.reset_watch_alerts
  set
    status = 'sending',
    claim_token = v_token,
    claimed_at = now(),
    completed_at = null,
    attempt_count = attempt_count + 1,
    last_error = null,
    updated_at = now()
  where post_id = p_post_id
    and status in ('pending', 'failed')
  returning claim_token into v_claimed;

  return v_claimed;
end;
$$;

create or replace function public.finish_reset_watch_alert(
  p_post_id text,
  p_claim_token uuid,
  p_status text,
  p_telegram_message_id bigint default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if p_status not in ('sent', 'failed', 'uncertain') then
    raise exception 'invalid reset alert status' using errcode = '22023';
  end if;
  if p_status = 'sent' and (p_telegram_message_id is null or p_telegram_message_id < 1) then
    raise exception 'sent reset alert requires a Telegram message ID' using errcode = '22023';
  end if;

  update public.reset_watch_alerts
  set
    status = p_status,
    telegram_message_id = case
      when p_status = 'sent' then p_telegram_message_id
      else null
    end,
    completed_at = now(),
    claim_token = null,
    claimed_at = null,
    last_error = case
      when p_status = 'sent' then null
      else nullif(left(p_error, 1000), '')
    end,
    updated_at = now()
  where post_id = p_post_id
    and status = 'sending'
    and claim_token = p_claim_token;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

alter table public.reset_watch_alerts enable row level security;
revoke all on table public.reset_watch_alerts from anon, authenticated;
revoke execute on function public.claim_reset_watch_alert(text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.finish_reset_watch_alert(text, uuid, text, bigint, text)
  from public, anon, authenticated;
grant all on table public.reset_watch_alerts to service_role;
grant execute on function public.claim_reset_watch_alert(text, text, text, text, timestamptz)
  to service_role;
grant execute on function public.finish_reset_watch_alert(text, uuid, text, bigint, text)
  to service_role;

-- Existing installations already keep the project URL and cron secret in
-- Vault. If those values are present, activate the ten-minute watch now.
do $$
declare
  v_job_id bigint;
begin
  if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'ai_news_project_url'
  ) or not exists (
    select 1 from vault.decrypted_secrets where name = 'ai_news_cron_secret'
  ) then
    return;
  end if;

  for v_job_id in
    select jobid from cron.job where jobname = 'ai-news-tibo-reset-watch-10min'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'ai-news-tibo-reset-watch-10min',
    '*/10 * * * *',
    $command$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'ai_news_project_url')
          || '/functions/v1/reset-watch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_news_cron_secret')
        ),
        body := jsonb_build_object('trigger', 'tibo_reset_watch'),
        timeout_milliseconds := 30000
      );
    $command$
  );
end;
$$;
