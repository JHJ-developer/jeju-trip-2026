-- Final notification policy: scheduled trip reminders only.
-- Preserve trip documents, registered devices and delivery history.
begin;
drop trigger if exists family_list_change_push on public.family_trips;

-- Compatibility guards for old deployments: never enqueue or claim list pushes.
create or replace function public.enqueue_family_list_changes()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 return new;
end;$$;
create or replace function public.claim_family_changes(p_trip uuid)
returns setof public.family_change_deliveries language sql security invoker set search_path='' as $$
 select q.* from public.family_change_deliveries q where false;
$$;
revoke all on function public.enqueue_family_list_changes() from public,anon,authenticated;
grant execute on function public.enqueue_family_list_changes() to service_role;
revoke all on function public.claim_family_changes(uuid) from public,anon,authenticated;
grant execute on function public.claim_family_changes(uuid) to service_role;

update public.family_change_deliveries set status='skipped',updated_at=now()
 where status in ('pending','retry','sending');

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
notify pgrst,'reload schema';
commit;
