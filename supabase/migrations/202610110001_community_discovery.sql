-- Add a separate discovery stream for projects shared by individual developers
-- and small teams. These sources are labelled as community claims rather than
-- being presented as independently verified news.

alter table public.news_sources
  drop constraint if exists news_sources_source_kind_check;

alter table public.news_sources
  add constraint news_sources_source_kind_check
  check (source_kind in ('rss', 'atom', 'markdown', 'json'));

insert into public.topic_weights (topic)
values ('community_projects')
on conflict (topic) do nothing;

insert into public.news_sources
  (id, name, feed_url, homepage_url, trust_level, source_kind, base_priority)
values
  (
    'dev-showdev',
    'DEV Community — Show What You Built',
    'https://dev.to/feed/tag/showdev',
    'https://dev.to/t/showdev',
    'discovery',
    'rss',
    76
  ),
  (
    'hacker-news-show',
    'Hacker News — Show HN',
    'https://hacker-news.firebaseio.com/v0/showstories.json',
    'https://news.ycombinator.com/show',
    'discovery',
    'json',
    74
  )
on conflict (id) do update set
  name = excluded.name,
  feed_url = excluded.feed_url,
  homepage_url = excluded.homepage_url,
  trust_level = excluded.trust_level,
  source_kind = excluded.source_kind,
  base_priority = excluded.base_priority,
  enabled = true,
  updated_at = now();
