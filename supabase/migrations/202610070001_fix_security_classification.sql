-- Security advisories are news, not application opportunities. Correct any
-- previously stored rows so older data cannot keep the wrong Telegram label.

update public.news_items
set
  is_opportunity = false,
  action = case when importance = 5 then 'pursue' else 'save_for_later' end,
  topic_tags = array_remove(
    array_remove(
      array_remove(topic_tags, 'career_opportunities'),
      'uae_jobs_internships'
    ),
    'uae_events_hackathons'
  ),
  updated_at = now()
where
  source_id in ('aws-security-bulletins', 'docker-security-announcements')
  or title ~* '\mCVE-[0-9]{4}-[0-9]+\M';
