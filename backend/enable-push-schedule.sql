-- Preserve every existing field and only add missing dates to this booked trip.
with changed as (
 select id, jsonb_set(document,'{days}',(select jsonb_agg(
  case when not (d ? 'date') and d->>'id' ~ '^day[1-5]$' and d->>'label' like '%10/'||(25+right(d->>'id',1)::int)::text||'%'
   then d||jsonb_build_object('date','2026-10-'||(25+right(d->>'id',1)::int)::text)
  when not (d ? 'date') and d->>'label'='여행전날' then d||jsonb_build_object('date','2026-10-25')
  else d end order by ord) from jsonb_array_elements(document->'days') with ordinality as x(d,ord))) as doc
 from public.family_trips
 where document->'days' @> '[{"id":"day1","label":"1일차 · 10/26"}]'::jsonb
)
update public.family_trips f set document=c.doc,version=f.version+1,updated_at=now()
from changed c where f.id=c.id and f.document<>c.doc;

create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Cron only invokes the edge worker when approved devices and due items exist.
select cron.schedule('family-trip-reminders','* * * * *',$job$
 select net.http_post(
  url:='https://pvfvbosolqpqbmocwyrw.supabase.co/functions/v1/family-push/dispatch',
  headers:=jsonb_build_object('Content-Type','application/json','x-scheduler-secret',c.scheduler_secret),
  body:='{}'::jsonb,timeout_milliseconds:=20000
 ) from public.family_push_config c join public.family_trips t on t.id=c.trip_id
 where exists(select 1 from public.family_push_devices v where v.trip_id=t.id and v.active)
 and exists(select 1 from jsonb_array_elements(t.document->'days') d,
  lateral jsonb_array_elements(d->'items') i
  where d->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and i->>'start' ~ '^([01]\d|2[0-3]):[0-5]\d$'
  and coalesce(i->>'reminder','true')<>'false'
  and case when d->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and i->>'start' ~ '^([01]\d|2[0-3]):[0-5]\d$'
    then (d->>'date'||'T'||(i->>'start')||':00+09:00')::timestamptz > now()
     and (d->>'date'||'T'||(i->>'start')||':00+09:00')::timestamptz <= now()+interval '10 minutes'
    else false end
 );
$job$);
