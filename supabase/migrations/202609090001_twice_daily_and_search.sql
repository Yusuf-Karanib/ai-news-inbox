-- Two independent UAE news briefs plus safe, rate-limited Telegram searches.

alter table public.news_runs add column if not exists run_slot text;
update public.news_runs set run_slot = 'legacy' where run_slot is null;
alter table public.news_runs alter column run_slot set default 'manual';
alter table public.news_runs alter column run_slot set not null;
alter table public.news_runs drop constraint if exists news_runs_run_slot_check;
alter table public.news_runs add constraint news_runs_run_slot_check
  check (run_slot in ('legacy', 'morning', 'evening', 'manual'));
alter table public.news_runs drop constraint if exists news_runs_pkey;
alter table public.news_runs add constraint news_runs_pkey primary key (run_date, run_slot);

alter table public.news_items add column if not exists delivery_claim_token uuid;
alter table public.news_items add column if not exists delivery_claimed_at timestamptz;

drop function if exists public.claim_news_run(date);
drop function if exists public.finish_news_run(date, uuid, text, integer, integer, integer, integer, text);

create or replace function public.claim_news_run(p_run_date date, p_run_slot text)
returns table (claimed boolean, run_token uuid, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid := gen_random_uuid();
  v_rows integer;
  v_status text;
begin
  if p_run_date is null then
    raise exception 'run date is required' using errcode = '22004';
  end if;
  if p_run_slot not in ('morning', 'evening', 'manual') then
    raise exception 'invalid run slot' using errcode = '22023';
  end if;

  insert into public.news_runs (run_date, run_slot, status, run_token, attempt_count, started_at)
  values (p_run_date, p_run_slot, 'running', v_token, 1, now())
  on conflict (run_date, run_slot) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return query select true, v_token, 'new';
    return;
  end if;

  update public.news_runs
  set
    status = 'running',
    run_token = v_token,
    attempt_count = attempt_count + 1,
    started_at = now(),
    completed_at = null,
    sources_ok = 0,
    sources_failed = 0,
    items_found = 0,
    items_sent = 0,
    error_message = null
  where run_date = p_run_date
    and run_slot = p_run_slot
    and (
      status = 'failed'
      or (status = 'running' and started_at < now() - interval '20 minutes')
    );

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return query select true, v_token, 'retry';
    return;
  end if;

  select nr.status into v_status
  from public.news_runs as nr
  where nr.run_date = p_run_date and nr.run_slot = p_run_slot;

  return query
  select false, null::uuid,
    case
      when v_status = 'success' then 'already_successful'
      else 'already_running'
    end;
end;
$$;

create or replace function public.finish_news_run(
  p_run_date date,
  p_run_slot text,
  p_run_token uuid,
  p_status text,
  p_sources_ok integer default 0,
  p_sources_failed integer default 0,
  p_items_found integer default 0,
  p_items_sent integer default 0,
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
  if p_run_slot not in ('morning', 'evening', 'manual') then
    raise exception 'invalid run slot' using errcode = '22023';
  end if;
  if p_status not in ('success', 'failed') then
    raise exception 'finish status must be success or failed' using errcode = '22023';
  end if;

  update public.news_runs
  set
    status = p_status,
    completed_at = now(),
    sources_ok = greatest(coalesce(p_sources_ok, 0), 0),
    sources_failed = greatest(coalesce(p_sources_failed, 0), 0),
    items_found = greatest(coalesce(p_items_found, 0), 0),
    items_sent = greatest(coalesce(p_items_sent, 0), 0),
    error_message = case when p_status = 'failed' then nullif(left(p_error, 4000), '') else null end
  where run_date = p_run_date
    and run_slot = p_run_slot
    and run_token = p_run_token
    and status = 'running';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.claim_news_item_delivery(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid := gen_random_uuid();
  v_claimed_token uuid;
begin
  update public.news_items
  set
    delivery_claim_token = v_token,
    delivery_claimed_at = now(),
    updated_at = now()
  where id = p_item_id
    and sent_at is null
    and suppressed_at is null
    and (
      delivery_claim_token is null
      or delivery_claimed_at < now() - interval '10 minutes'
    )
  returning delivery_claim_token into v_claimed_token;

  return v_claimed_token;
end;
$$;

create or replace function public.finish_news_item_delivery(
  p_item_id uuid,
  p_claim_token uuid,
  p_telegram_message_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if p_telegram_message_id is null or p_telegram_message_id < 1 then
    raise exception 'valid Telegram message ID is required' using errcode = '22023';
  end if;

  update public.news_items
  set
    sent_at = now(),
    telegram_message_id = p_telegram_message_id,
    delivery_attempts = delivery_attempts + 1,
    last_delivery_error = null,
    delivery_claim_token = null,
    delivery_claimed_at = null,
    updated_at = now()
  where id = p_item_id
    and sent_at is null
    and delivery_claim_token = p_claim_token;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.fail_news_item_delivery(
  p_item_id uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.news_items
  set
    delivery_attempts = delivery_attempts + 1,
    last_delivery_error = nullif(left(p_error, 1000), ''),
    delivery_claim_token = null,
    delivery_claimed_at = null,
    updated_at = now()
  where id = p_item_id
    and sent_at is null
    and delivery_claim_token = p_claim_token;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.quarantine_news_item_delivery(
  p_item_id uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.news_items
  set
    delivery_attempts = delivery_attempts + 1,
    last_delivery_error = nullif(left(p_error, 1000), ''),
    suppressed_at = now(),
    suppression_reason = 'telegram_delivery_uncertain',
    delivery_claim_token = null,
    delivery_claimed_at = null,
    updated_at = now()
  where id = p_item_id
    and sent_at is null
    and delivery_claim_token = p_claim_token;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create table if not exists public.telegram_news_requests (
  update_id bigint primary key,
  message_id bigint not null,
  search_query text not null default '',
  claim_token uuid not null default gen_random_uuid(),
  status text not null
    check (status in ('running', 'success', 'failed', 'rate_limited', 'busy')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  items_sent integer not null default 0 check (items_sent >= 0),
  error_message text,
  constraint telegram_news_requests_query_length check (char_length(search_query) <= 160),
  constraint telegram_news_requests_completion check (
    (status = 'running' and completed_at is null)
    or (status <> 'running' and completed_at is not null)
  )
);

create index if not exists telegram_news_requests_rate_idx
  on public.telegram_news_requests (requested_at desc, status);

create or replace function public.claim_telegram_news_request(
  p_update_id bigint,
  p_message_id bigint,
  p_search_query text
)
returns table (claimed boolean, request_token uuid, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent_count integer;
  v_request_status text;
  v_token uuid := gen_random_uuid();
begin
  if p_update_id is null or p_update_id < 0 or p_message_id is null or p_message_id < 1 then
    raise exception 'valid Telegram identifiers are required' using errcode = '22023';
  end if;
  if char_length(coalesce(p_search_query, '')) > 160 then
    raise exception 'search query is too long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(741357922);

  delete from public.telegram_news_requests
  where requested_at < now() - interval '7 days';

  update public.telegram_news_requests
  set
    claim_token = v_token,
    requested_at = now(),
    completed_at = null,
    items_sent = 0,
    error_message = null
  where update_id = p_update_id
    and status = 'running'
    and requested_at < now() - interval '10 minutes';

  if found then
    return query select true, v_token, 'stale_retry';
    return;
  end if;

  select status into v_request_status
  from public.telegram_news_requests
  where update_id = p_update_id;
  if found then
    return query select false, null::uuid,
      case when v_request_status = 'running' then 'running' else 'duplicate' end;
    return;
  end if;

  if exists (
    select 1
    from public.telegram_news_requests
    where status = 'running' and requested_at > now() - interval '10 minutes'
  ) then
    insert into public.telegram_news_requests
      (update_id, message_id, search_query, status, completed_at, error_message)
    values
      (p_update_id, p_message_id, coalesce(p_search_query, ''), 'busy', now(), 'another search is running');
    return query select false, null::uuid, 'busy';
    return;
  end if;

  select count(*)::integer into v_recent_count
  from public.telegram_news_requests
  where requested_at > now() - interval '1 hour'
    and status in ('running', 'success', 'failed');

  if v_recent_count >= 4 then
    insert into public.telegram_news_requests
      (update_id, message_id, search_query, status, completed_at, error_message)
    values
      (p_update_id, p_message_id, coalesce(p_search_query, ''), 'rate_limited', now(), 'four searches per hour limit');
    return query select false, null::uuid, 'rate_limited';
    return;
  end if;

  insert into public.telegram_news_requests
    (update_id, message_id, search_query, claim_token, status)
  values
    (p_update_id, p_message_id, coalesce(p_search_query, ''), v_token, 'running');
  return query select true, v_token, 'new';
end;
$$;

create or replace function public.finish_telegram_news_request(
  p_update_id bigint,
  p_claim_token uuid,
  p_status text,
  p_items_sent integer default 0,
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
  if p_status not in ('success', 'failed') then
    raise exception 'search status must be success or failed' using errcode = '22023';
  end if;

  update public.telegram_news_requests
  set
    status = p_status,
    completed_at = now(),
    items_sent = greatest(coalesce(p_items_sent, 0), 0),
    error_message = case when p_status = 'failed' then nullif(left(p_error, 1000), '') else null end
  where update_id = p_update_id
    and claim_token = p_claim_token
    and status = 'running';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

alter table public.telegram_news_requests enable row level security;
revoke all on table public.telegram_news_requests from anon, authenticated;
revoke execute on function public.claim_news_run(date, text) from public, anon, authenticated;
revoke execute on function public.finish_news_run(date, text, uuid, text, integer, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.claim_news_item_delivery(uuid) from public, anon, authenticated;
revoke execute on function public.finish_news_item_delivery(uuid, uuid, bigint) from public, anon, authenticated;
revoke execute on function public.fail_news_item_delivery(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.quarantine_news_item_delivery(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_telegram_news_request(bigint, bigint, text) from public, anon, authenticated;
revoke execute on function public.finish_telegram_news_request(bigint, uuid, text, integer, text) from public, anon, authenticated;
grant all on table public.telegram_news_requests to service_role;
grant execute on function public.claim_news_run(date, text) to service_role;
grant execute on function public.finish_news_run(date, text, uuid, text, integer, integer, integer, integer, text) to service_role;
grant execute on function public.claim_news_item_delivery(uuid) to service_role;
grant execute on function public.finish_news_item_delivery(uuid, uuid, bigint) to service_role;
grant execute on function public.fail_news_item_delivery(uuid, uuid, text) to service_role;
grant execute on function public.quarantine_news_item_delivery(uuid, uuid, text) to service_role;
grant execute on function public.claim_telegram_news_request(bigint, bigint, text) to service_role;
grant execute on function public.finish_telegram_news_request(bigint, uuid, text, integer, text) to service_role;

-- Existing installations already have the URL and cron secret in Vault. Update
-- their schedules during deployment. New installations use setup_schedule.sql.
do $$
declare
  v_job record;
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
    select jobid from cron.job where jobname in (
      'ai-news-daily-1900-dubai',
      'ai-news-retry-1915-dubai',
      'ai-news-retry-1945-dubai',
      'ai-news-morning-0700-dubai',
      'ai-news-morning-retry-0715-dubai',
      'ai-news-morning-retry-0745-dubai',
      'ai-news-evening-1900-dubai',
      'ai-news-evening-retry-1915-dubai',
      'ai-news-evening-retry-1945-dubai'
    )
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  for v_job in
    select * from (values
      ('ai-news-morning-0700-dubai', '0 3 * * *', 'primary', 'morning'),
      ('ai-news-morning-retry-0715-dubai', '15 3 * * *', 'retry_1', 'morning'),
      ('ai-news-morning-retry-0745-dubai', '45 3 * * *', 'retry_2', 'morning'),
      ('ai-news-evening-1900-dubai', '0 15 * * *', 'primary', 'evening'),
      ('ai-news-evening-retry-1915-dubai', '15 15 * * *', 'retry_1', 'evening'),
      ('ai-news-evening-retry-1945-dubai', '45 15 * * *', 'retry_2', 'evening')
    ) as jobs(job_name, cron_expression, trigger_name, run_slot)
  loop
    perform cron.schedule(
      v_job.job_name,
      v_job.cron_expression,
      format(
        $command$
          select net.http_post(
            url := (select decrypted_secret from vault.decrypted_secrets where name = 'ai_news_project_url')
              || '/functions/v1/daily-news',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_news_cron_secret')
            ),
            body := jsonb_build_object('trigger', %L, 'runSlot', %L),
            timeout_milliseconds := 120000
          );
        $command$,
        v_job.trigger_name,
        v_job.run_slot
      )
    );
  end loop;
end;
$$;
