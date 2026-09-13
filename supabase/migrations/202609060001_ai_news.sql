-- AI News Inbox: private database, deterministic feedback learning, and safe run locking.
-- Edge Functions use a Supabase secret key. Browser/anonymous access is intentionally denied.

create table if not exists public.news_sources (
  id text primary key,
  name text not null,
  feed_url text not null unique,
  homepage_url text not null,
  trust_level text not null default 'official'
    check (trust_level in ('official', 'discovery')),
  source_kind text not null default 'rss'
    check (source_kind in ('rss', 'atom')),
  base_priority smallint not null default 50
    check (base_priority between 0 and 100),
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0
    check (consecutive_failures >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint news_sources_id_format check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint news_sources_feed_https check (feed_url ~ '^https://'),
  constraint news_sources_homepage_https check (homepage_url ~ '^https://')
);

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.news_sources(id) on update cascade on delete restrict,
  external_key text not null,
  canonical_url text not null unique,
  title text not null,
  summary text not null default '',
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  topic_tags text[] not null default '{}'::text[],
  match_reasons text[] not null default '{}'::text[],
  importance smallint not null check (importance between 1 and 5),
  verification_status text not null default 'source_reported'
    check (verification_status in ('source_reported', 'official_source_only', 'unverified')),
  action text not null
    check (action in ('pursue', 'save_for_later', 'ignore', 'investigate_further')),
  is_opportunity boolean not null default false,
  sent_at timestamptz,
  suppressed_at timestamptz,
  suppression_reason text,
  telegram_message_id bigint,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  last_delivery_error text,
  feedback_score smallint check (feedback_score between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint news_items_source_external_unique unique (source_id, external_key),
  constraint news_items_url_https check (canonical_url ~ '^https://'),
  constraint news_items_nonempty_title check (btrim(title) <> ''),
  constraint news_items_nonempty_topics check (cardinality(topic_tags) > 0)
);

create table if not exists public.news_feedback (
  item_id uuid primary key references public.news_items(id) on delete cascade,
  score smallint not null check (score between 0 and 3),
  rated_at timestamptz not null default now()
);

create table if not exists public.topic_weights (
  topic text primary key,
  weight numeric(4, 3) not null default 1.000
    check (weight between 0.500 and 1.500),
  rating_count integer not null default 0 check (rating_count >= 0),
  updated_at timestamptz not null default now(),
  constraint topic_weights_topic_format check (topic ~ '^[a-z0-9]+(_[a-z0-9]+)*$')
);

create table if not exists public.news_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.news_runs (
  run_date date primary key,
  status text not null default 'running'
    check (status in ('running', 'success', 'failed')),
  run_token uuid not null default gen_random_uuid(),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  sources_ok integer not null default 0 check (sources_ok >= 0),
  sources_failed integer not null default 0 check (sources_failed >= 0),
  items_found integer not null default 0 check (items_found >= 0),
  items_sent integer not null default 0 check (items_sent >= 0),
  error_message text,
  constraint news_runs_completion_state check (
    (status = 'running' and completed_at is null)
    or (status in ('success', 'failed') and completed_at is not null)
  )
);

create index if not exists news_items_unsent_order_idx
  on public.news_items (importance desc, published_at desc nulls last, discovered_at desc)
  where sent_at is null and suppressed_at is null;

create index if not exists news_items_published_idx
  on public.news_items (published_at desc nulls last);

create index if not exists news_items_topic_tags_idx
  on public.news_items using gin (topic_tags);

create index if not exists news_runs_status_idx
  on public.news_runs (status, started_at desc);

insert into public.topic_weights (topic)
values
  ('applied_ai'),
  ('robotics_ros2'),
  ('python_apis'),
  ('ai_agents_automation'),
  ('n8n'),
  ('aws_cloud'),
  ('supabase'),
  ('docker'),
  ('react_nextjs'),
  ('uae_jobs_internships'),
  ('uae_events_hackathons'),
  ('courses_certifications'),
  ('general_tech_security')
on conflict (topic) do nothing;

-- These are official publisher feeds verified when this migration was prepared.
-- Fetching code must also keep a fixed ID + URL allowlist; changing a database row alone
-- must not be enough to make the function request an arbitrary URL.
insert into public.news_sources
  (id, name, feed_url, homepage_url, trust_level, source_kind, base_priority)
values
  ('openai-news', 'OpenAI News', 'https://openai.com/news/rss.xml', 'https://openai.com/news/', 'official', 'rss', 100),
  ('aws-whats-new', 'AWS What''s New', 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', 'https://aws.amazon.com/new/', 'official', 'rss', 95),
  ('aws-security-bulletins', 'AWS Security Bulletins', 'https://aws.amazon.com/security/security-bulletins/rss/feed/', 'https://aws.amazon.com/security/security-bulletins/', 'official', 'rss', 100),
  ('supabase-changelog', 'Supabase Changelog', 'https://supabase.com/changelog-rss.xml', 'https://supabase.com/changelog', 'official', 'rss', 95),
  ('n8n-blog', 'n8n Blog', 'https://blog.n8n.io/rss/', 'https://blog.n8n.io/', 'official', 'rss', 90),
  ('docker-blog', 'Docker Blog', 'https://www.docker.com/blog/feed/', 'https://www.docker.com/blog/', 'official', 'rss', 85),
  ('docker-security-announcements', 'Docker Security Announcements', 'https://docs.docker.com/security/security-announcements/index.xml', 'https://docs.docker.com/security/security-announcements/', 'official', 'rss', 100),
  ('github-changelog', 'GitHub Changelog', 'https://github.blog/changelog/feed/', 'https://github.blog/changelog/', 'official', 'rss', 95),
  ('python-insider', 'Python Insider', 'https://blog.python.org/rss.xml', 'https://blog.python.org/', 'official', 'rss', 90),
  ('ros-announcements', 'ROS Announcements and News', 'https://discourse.openrobotics.org/c/ros/ros-announcements-news/112.rss', 'https://discourse.openrobotics.org/c/ros/ros-announcements-news/112', 'official', 'rss', 90),
  ('dubai-future-foundation', 'Dubai Future Foundation', 'https://www.dubaifuture.ae/feed/', 'https://www.dubaifuture.ae/', 'official', 'rss', 90)
on conflict (id) do update set
  name = excluded.name,
  feed_url = excluded.feed_url,
  homepage_url = excluded.homepage_url,
  trust_level = excluded.trust_level,
  source_kind = excluded.source_kind,
  base_priority = excluded.base_priority,
  updated_at = now();

-- Claim one logical Dubai-calendar-day run. A failed run may be retried immediately.
-- A process stuck in "running" may only be reclaimed after 20 minutes.
create or replace function public.claim_news_run(p_run_date date)
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

  insert into public.news_runs (run_date, status, run_token, attempt_count, started_at)
  values (p_run_date, 'running', v_token, 1, now())
  on conflict (run_date) do nothing;

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
  where nr.run_date = p_run_date;

  return query
  select false, null::uuid,
    case
      when v_status = 'success' then 'already_successful'
      else 'already_running'
    end;
end;
$$;

-- A stale worker cannot finish a newer retry because its old token no longer matches.
create or replace function public.finish_news_run(
  p_run_date date,
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
    and run_token = p_run_token
    and status = 'running';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Insert a feed batch while ignoring any canonical-URL or source-GUID duplicate.
-- The Edge Function owns ranking; this function only makes duplicate handling atomic.
create or replace function public.store_news_items(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;

  with inserted as (
    insert into public.news_items (
      source_id,
      external_key,
      canonical_url,
      title,
      summary,
      published_at,
      discovered_at,
      topic_tags,
      match_reasons,
      importance,
      verification_status,
      action,
      is_opportunity,
      suppressed_at,
      suppression_reason
    )
    select
      item ->> 'source_id',
      item ->> 'external_key',
      item ->> 'canonical_url',
      item ->> 'title',
      coalesce(item ->> 'summary', ''),
      nullif(item ->> 'published_at', '')::timestamptz,
      coalesce(nullif(item ->> 'discovered_at', '')::timestamptz, now()),
      array(select jsonb_array_elements_text(coalesce(item -> 'topic_tags', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(item -> 'match_reasons', '[]'::jsonb))),
      (item ->> 'importance')::smallint,
      coalesce(item ->> 'verification_status', 'official_source_only'),
      item ->> 'action',
      coalesce((item ->> 'is_opportunity')::boolean, false),
      nullif(item ->> 'suppressed_at', '')::timestamptz,
      nullif(item ->> 'suppression_reason', '')
    from jsonb_array_elements(p_items) as payload(item)
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from inserted;

  return v_inserted;
end;
$$;

-- Store the latest 0-3 rating and rebuild every affected weight from all ratings.
-- Rebuilding makes the result deterministic: editing a rating does not double-count it.
create or replace function public.record_news_feedback(p_item_id uuid, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_topics text[];
  v_result jsonb;
begin
  if p_score is null or p_score < 0 or p_score > 3 then
    raise exception 'score must be from 0 to 3' using errcode = '22023';
  end if;

  -- Only one feedback rebuild may run at a time, avoiding concurrent lost updates.
  perform pg_advisory_xact_lock(741357921);

  select ni.topic_tags into v_topics
  from public.news_items as ni
  where ni.id = p_item_id
  for update;

  if not found then
    raise exception 'news item not found' using errcode = 'P0002';
  end if;

  insert into public.news_feedback (item_id, score, rated_at)
  values (p_item_id, p_score::smallint, now())
  on conflict (item_id) do update set
    score = excluded.score,
    rated_at = excluded.rated_at;

  update public.news_items
  set feedback_score = p_score::smallint, updated_at = now()
  where id = p_item_id;

  update public.topic_weights
  set weight = 1.000, rating_count = 0, updated_at = now();

  with feedback_topics as (
    select distinct
      nf.item_id,
      nf.score,
      nf.rated_at,
      greatest(cardinality(ni.topic_tags), 1) as topic_count,
      btrim(tag.topic) as topic
    from public.news_feedback as nf
    join public.news_items as ni on ni.id = nf.item_id
    cross join lateral unnest(ni.topic_tags) as tag(topic)
    where btrim(tag.topic) <> ''
  ),
  feedback_stats as (
    select
      ft.topic,
      count(*)::integer as rating_count,
      sum(
        case ft.score
          when 0 then -0.100::numeric
          when 1 then  0.000::numeric
          when 2 then  0.040::numeric
          when 3 then  0.100::numeric
        end
        / ft.topic_count::numeric
        * power(
          0.500::numeric,
          greatest(
            extract(epoch from (now() - ft.rated_at)) / 7776000.0,
            0
          )::numeric
        )
      ) as cumulative_adjustment
    from feedback_topics as ft
    group by ft.topic
  )
  insert into public.topic_weights (topic, weight, rating_count, updated_at)
  select
    fs.topic,
    round(
      greatest(
        0.500::numeric,
        least(
          1.500::numeric,
          1.000::numeric + fs.cumulative_adjustment
        )
      ),
      3
    ),
    fs.rating_count,
    now()
  from feedback_stats as fs
  on conflict (topic) do update set
    weight = excluded.weight,
    rating_count = excluded.rating_count,
    updated_at = excluded.updated_at;

  select jsonb_build_object(
    'item_id', p_item_id,
    'score', p_score,
    'topics', coalesce(
      jsonb_object_agg(tw.topic, jsonb_build_object(
        'weight', tw.weight,
        'rating_count', tw.rating_count
      )),
      '{}'::jsonb
    )
  )
  into v_result
  from public.topic_weights as tw
  where tw.topic = any(v_topics);

  return v_result;
end;
$$;

alter table public.news_sources enable row level security;
alter table public.news_items enable row level security;
alter table public.news_feedback enable row level security;
alter table public.topic_weights enable row level security;
alter table public.news_state enable row level security;
alter table public.news_runs enable row level security;

-- There are deliberately no RLS policies for anon/authenticated users.
revoke all on table public.news_sources from anon, authenticated;
revoke all on table public.news_items from anon, authenticated;
revoke all on table public.news_feedback from anon, authenticated;
revoke all on table public.topic_weights from anon, authenticated;
revoke all on table public.news_state from anon, authenticated;
revoke all on table public.news_runs from anon, authenticated;

revoke execute on function public.claim_news_run(date) from public, anon, authenticated;
revoke execute on function public.finish_news_run(date, uuid, text, integer, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.store_news_items(jsonb) from public, anon, authenticated;
revoke execute on function public.record_news_feedback(uuid, integer) from public, anon, authenticated;

grant all on table public.news_sources to service_role;
grant all on table public.news_items to service_role;
grant all on table public.news_feedback to service_role;
grant all on table public.topic_weights to service_role;
grant all on table public.news_state to service_role;
grant all on table public.news_runs to service_role;
grant execute on function public.claim_news_run(date) to service_role;
grant execute on function public.finish_news_run(date, uuid, text, integer, integer, integer, integer, text) to service_role;
grant execute on function public.store_news_items(jsonb) to service_role;
grant execute on function public.record_news_feedback(uuid, integer) to service_role;
