-- Adaptive news preferences requested by Yusuf on 8 September 2026.
-- Explicit controls stay separate from learned 0-3 rating weights so a rating
-- rebuild cannot erase a mute or a direct "show me more" instruction.

create table if not exists public.user_preferences (
  normalized_label text primary key,
  label text not null,
  level smallint not null check (level in (-2, -1, 1)),
  topic_tags text[] not null default '{}'::text[],
  match_terms text[] not null default '{}'::text[],
  example_text text,
  source_url text,
  telegram_message_id bigint,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_key_length check (
    char_length(normalized_label) between 3 and 180
  ),
  constraint user_preferences_label_length check (
    char_length(label) between 1 and 160
  ),
  constraint user_preferences_example_length check (
    example_text is null or char_length(example_text) <= 1000
  ),
  constraint user_preferences_source_https check (
    source_url is null or source_url ~ '^https://'
  ),
  constraint user_preferences_has_match check (
    cardinality(topic_tags) > 0 or cardinality(match_terms) >= 2
  )
);

alter table public.news_sources drop constraint if exists news_sources_source_kind_check;
alter table public.news_sources add constraint news_sources_source_kind_check
  check (source_kind in ('rss', 'atom', 'markdown'));

create index if not exists user_preferences_topics_idx
  on public.user_preferences using gin (topic_tags);

insert into public.topic_weights (topic)
values
  ('anthropic_claude'),
  ('openai_chatgpt_codex'),
  ('nvidia_ai_hardware'),
  ('xai_grok'),
  ('ai_models_releases'),
  ('ai_access_pricing'),
  ('ai_hardware_chips'),
  ('developer_tools'),
  ('career_opportunities'),
  ('uae_relevant_news'),
  ('world_high_impact')
on conflict (topic) do nothing;

-- Official feeds checked on 8 September 2026. Exact URLs are duplicated in
-- the Edge Function allowlist so a database edit cannot cause arbitrary fetches.
insert into public.news_sources
  (id, name, feed_url, homepage_url, trust_level, source_kind, base_priority)
values
  ('openai-codex-releases', 'OpenAI Codex Releases', 'https://github.com/openai/codex/releases.atom', 'https://github.com/openai/codex/releases', 'official', 'atom', 90),
  ('openai-status', 'OpenAI Status', 'https://status.openai.com/history.atom', 'https://status.openai.com/history', 'official', 'atom', 85),
  ('anthropic-platform-releases', 'Anthropic Platform Release Notes', 'https://platform.claude.com/docs/en/release-notes/feed.xml', 'https://platform.claude.com/docs/en/release-notes/overview', 'official', 'rss', 100),
  ('anthropic-status', 'Claude Status', 'https://status.claude.com/history.atom', 'https://status.claude.com/history', 'official', 'atom', 85),
  ('xai-release-notes', 'xAI Release Notes', 'https://docs.x.ai/developers/release-notes.md', 'https://docs.x.ai/developers/release-notes', 'official', 'markdown', 100),
  ('xai-status', 'xAI Status', 'https://status.x.ai/feed.xml', 'https://status.x.ai/', 'official', 'rss', 80),
  ('nvidia-ai-news', 'NVIDIA Generative AI News', 'https://nvidianews.nvidia.com/cats/generative_al.xml', 'https://nvidianews.nvidia.com/', 'official', 'rss', 100),
  ('nvidia-technical-blog', 'NVIDIA Technical Blog', 'https://developer.nvidia.com/blog/feed/', 'https://developer.nvidia.com/blog/', 'official', 'atom', 85),
  ('amd-news', 'AMD Newsroom', 'https://newsroom.amd.com/rss.xml?content-type=news', 'https://newsroom.amd.com/', 'official', 'rss', 80),
  ('google-deepmind', 'Google DeepMind', 'https://deepmind.google/blog/rss.xml', 'https://deepmind.google/blog/', 'official', 'rss', 95),
  ('hugging-face-blog', 'Hugging Face Blog', 'https://huggingface.co/blog/feed.xml', 'https://huggingface.co/blog', 'official', 'rss', 90),
  ('microsoft-ai-news', 'Microsoft AI News', 'https://news.microsoft.com/source/topics/ai/feed/', 'https://news.microsoft.com/source/topics/ai/', 'official', 'rss', 85),
  ('42-abu-dhabi', '42 Abu Dhabi', 'https://42abudhabi.ae/feed/', 'https://42abudhabi.ae/', 'official', 'rss', 100),
  ('bbc-world', 'BBC World News', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'https://www.bbc.com/news/world', 'official', 'rss', 60)
on conflict (id) do update set
  name = excluded.name,
  feed_url = excluded.feed_url,
  homepage_url = excluded.homepage_url,
  trust_level = excluded.trust_level,
  source_kind = excluded.source_kind,
  base_priority = excluded.base_priority,
  updated_at = now();

-- Starting choices from Yusuf. These are inserted only once. Telegram commands
-- can later update or remove them without a future deployment restoring them.
insert into public.user_preferences
  (normalized_label, label, level, topic_tags, match_terms, example_text)
values
  ('topic:anthropic_claude', 'Claude / Anthropic', 1, array['anthropic_claude'], '{}', 'Starting interest'),
  ('topic:openai_chatgpt_codex', 'ChatGPT / Codex / OpenAI', 1, array['openai_chatgpt_codex'], '{}', 'Starting interest'),
  ('topic:nvidia_ai_hardware', 'NVIDIA AI', 1, array['nvidia_ai_hardware'], '{}', 'Starting interest'),
  ('topic:xai_grok', 'Grok / xAI', 1, array['xai_grok'], '{}', 'Starting interest'),
  ('topic:ai_access_pricing', 'AI usage resets, limits, and pricing', 1, array['ai_access_pricing'], '{}', 'Starting interest'),
  ('topic:ai_hardware_chips', 'AI hardware and chips', 1, array['ai_hardware_chips'], '{}', 'Starting interest'),
  ('topic:career_opportunities', 'Internships, programs, and opportunities', 1, array['career_opportunities'], '{}', 'Starting interest'),
  ('topic:uae_relevant_news', 'UAE news relevant to Yusuf', 1, array['uae_relevant_news'], '{}', 'Starting interest'),
  ('topic:aws_cloud', 'AWS', -2, array['aws_cloud'], '{}', 'Muted because Yusuf wants AI news rather than routine AWS news')
on conflict (normalized_label) do nothing;

alter table public.user_preferences enable row level security;
revoke all on table public.user_preferences from anon, authenticated;
grant all on table public.user_preferences to service_role;
