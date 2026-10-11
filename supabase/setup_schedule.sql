-- Run this once in Supabase SQL Editor after deploying the Edge Functions.
-- Dubai is UTC+4 throughout the year:
-- 03:00 UTC = 07:00 Dubai and 15:00 UTC = 19:00 Dubai.
-- Each brief has retries after 15 and 45 minutes. A successful primary run
-- makes its later retries stop automatically. The separate Tibo reset watch
-- checks every ten minutes and sends nothing when there is no new reset post.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

do $$
declare
  v_project_url text := 'https://YOUR_PROJECT_REF.supabase.co';
  v_cron_secret text;
  v_secret_id uuid;
begin
  if v_project_url like '%YOUR_PROJECT_REF%' then
    raise exception 'Replace the project URL placeholder before running this file.';
  end if;

  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'ai_news_project_url'
  order by created_at desc
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(v_project_url, 'ai_news_project_url', 'AI News Edge Function base URL');
  else
    perform vault.update_secret(v_secret_id, v_project_url, 'ai_news_project_url', 'AI News Edge Function base URL');
  end if;

  v_secret_id := null;
  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'ai_news_cron_secret'
  order by created_at desc
  limit 1;

  if v_secret_id is null then
    v_cron_secret := replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', '');
    perform vault.create_secret(v_cron_secret, 'ai_news_cron_secret', 'Authenticates scheduled AI News calls');
  end if;
end;
$$;

-- Safe to rerun: remove old and current job names before recreating them.
do $$
declare
  v_job record;
  v_job_id bigint;
begin
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
      'ai-news-evening-retry-1945-dubai',
      'ai-news-tibo-reset-watch-10min'
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

-- Copy this value into the CRON_SECRET Edge Function secret.
-- Do not save it in this file or share it in a screenshot.
select decrypted_secret as "CRON_SECRET_copy_into_Edge_Function_secrets"
from vault.decrypted_secrets
where name = 'ai_news_cron_secret'
order by created_at desc
limit 1;
