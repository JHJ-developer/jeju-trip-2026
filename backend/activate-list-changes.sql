create or replace trigger family_list_change_push after update of document on public.family_trips
 for each row execute function public.enqueue_family_list_changes();

select cron.schedule('family-trip-reminders','* * * * *',$job$
 select net.http_post(
  url:='https://pvfvbosolqpqbmocwyrw.supabase.co/functions/v1/family-push/dispatch',
  headers:=jsonb_build_object('Content-Type','application/json','x-scheduler-secret',c.scheduler_secret),
  body:='{}'::jsonb,timeout_milliseconds:=20000
 ) from public.family_push_config c join public.family_trips t on t.id=c.trip_id
 where exists(select 1 from public.family_push_devices v where v.trip_id=t.id and v.active)
 and (exists(select 1 from jsonb_array_elements(t.document->'days') d,
  lateral jsonb_array_elements(d->'items') i
  where d->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and i->>'start' ~ '^([01]\d|2[0-3]):[0-5]\d$'
  and coalesce(i->>'reminder','true')<>'false'
  and case when d->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and i->>'start' ~ '^([01]\d|2[0-3]):[0-5]\d$'
    then (d->>'date'||'T'||(i->>'start')||':00+09:00')::timestamptz > now()
     and (d->>'date'||'T'||(i->>'start')||':00+09:00')::timestamptz <= now()+interval '10 minutes'
    else false end
 ) or exists(
  select 1 from public.family_change_deliveries q
  join public.family_push_devices d on d.id=q.device_id and d.active
  where q.trip_id=t.id and q.expires_at>now() and q.attempts<3
  and (q.status='pending' or (q.status in ('retry','sending') and q.updated_at<now()-interval '90 seconds'))
 ));
$job$);
