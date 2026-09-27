-- Per-device outbox entries are created atomically with a successful list update.
create table if not exists public.family_change_deliveries (
 id bigint generated always as identity primary key,
 trip_id uuid not null references public.family_trips(id) on delete cascade,
 device_id uuid not null references public.family_push_devices(id) on delete cascade,
 scope text not null check(scope in ('shopping','packing')),
 document_version integer not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','retry','skipped')),
 attempts integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '1 hour', error_code integer,
 unique(trip_id,device_id,scope,document_version)
);
alter table public.family_change_deliveries enable row level security;
revoke all on public.family_change_deliveries from public,anon,authenticated;
grant all on public.family_change_deliveries to service_role;
revoke all on sequence public.family_change_deliveries_id_seq from public,anon,authenticated;
grant usage,select on sequence public.family_change_deliveries_id_seq to service_role;
create index if not exists family_change_pending_idx on public.family_change_deliveries(trip_id,created_at) where status in ('pending','retry','sending') and attempts<3;
create index if not exists family_change_device_idx on public.family_change_deliveries(device_id);

create or replace function public.claim_family_changes(p_trip uuid)
returns setof public.family_change_deliveries language sql security invoker set search_path='' as $$
 with selected as (
  select q.id from public.family_change_deliveries q
  join public.family_push_devices d on d.id=q.device_id and d.trip_id=q.trip_id and d.active
  where q.trip_id=p_trip and q.expires_at>now() and q.attempts<3
  and (q.status='pending' or (q.status in ('retry','sending') and q.updated_at<now()-interval '90 seconds'))
  order by q.created_at,q.id limit 4 for update of q skip locked
 )
 update public.family_change_deliveries q set status='sending',attempts=q.attempts+1,updated_at=now()
 from selected where q.id=selected.id returning q.*;
$$;
revoke all on function public.claim_family_changes(uuid) from public,anon,authenticated;
grant execute on function public.claim_family_changes(uuid) to service_role;

create or replace function public.enqueue_family_list_changes()
returns trigger language plpgsql security invoker set search_path='' as $$
declare list_scope text; added int; total_added int:=0; dispatch_secret text;
begin
 foreach list_scope in array array['shopping','packing'] loop
  if new.document->list_scope is distinct from old.document->list_scope then
   insert into public.family_change_deliveries(trip_id,device_id,scope,document_version)
   select new.id,d.id,list_scope,new.version from public.family_push_devices d
   where d.trip_id=new.id and d.active
   on conflict(trip_id,device_id,scope,document_version) do nothing;
   get diagnostics added=row_count; total_added:=total_added+added;
  end if;
 end loop;
 if total_added>0 then
  select c.scheduler_secret into dispatch_secret from public.family_push_config c where c.trip_id=new.id;
  if dispatch_secret is not null then
   -- Async request is dispatched only after commit. Cron retries if the wake-up fails.
   begin
    perform net.http_post(url:='https://pvfvbosolqpqbmocwyrw.supabase.co/functions/v1/family-push/dispatch',
     headers:=jsonb_build_object('Content-Type','application/json','x-scheduler-secret',dispatch_secret),
     body:='{}'::jsonb,timeout_milliseconds:=20000);
   exception when others then null;
   end;
  end if;
 end if;
 return new;
end;$$;
revoke all on function public.enqueue_family_list_changes() from public,anon,authenticated;
grant execute on function public.enqueue_family_list_changes() to service_role;
-- Install the trigger after deploying the worker that consumes this outbox.
notify pgrst,'reload schema';
