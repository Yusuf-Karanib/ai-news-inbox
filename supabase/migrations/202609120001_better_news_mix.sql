-- Improve daily brief quality by adding readable news publishers and a focused
-- UAE internship source. Feeds are allowlisted by exact ID and URL in
-- the Edge Function, so database edits still cannot add arbitrary fetches.

insert into public.news_sources
  (id, name, feed_url, homepage_url, trust_level, source_kind, base_priority)
values
  ('techcrunch-ai', 'TechCrunch AI', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'https://techcrunch.com/category/artificial-intelligence/', 'official', 'rss', 90),
  ('the-verge-ai', 'The Verge AI', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'https://www.theverge.com/ai-artificial-intelligence', 'official', 'atom', 88),
  ('aljazeera-news', 'Al Jazeera News', 'https://www.aljazeera.com/xml/rss/all.xml', 'https://www.aljazeera.com/news/', 'official', 'rss', 65),
  ('jobicy-uae-internships', 'Jobicy UAE Internships', 'https://jobicy.com/jobs/feed?type=internship&geo=united-arab-emirates', 'https://jobicy.com/jobs/', 'official', 'rss', 85)
on conflict (id) do update set
  name = excluded.name,
  feed_url = excluded.feed_url,
  homepage_url = excluded.homepage_url,
  trust_level = excluded.trust_level,
  source_kind = excluded.source_kind,
  base_priority = excluded.base_priority,
  updated_at = now();
