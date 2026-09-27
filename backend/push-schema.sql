create table if not exists public.family_push_config (
 trip_id uuid primary key references public.family_trips(id) on delete cascade,
 public_key text not null, private_key text not null, enrollment_hash text not null,
 scheduler_secret text not null
);
create table if not exists public.family_push_devices (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.family_trips(id) on delete cascade,
 token_hash text not null, name text not null, subscription jsonb not null,
 active boolean not null default true, created_at timestamptz not null default now(),
 unique(trip_id,token_hash)
);
create table if not exists public.family_push_deliveries (
 device_id uuid not null references public.family_push_devices(id) on delete cascade,
 item_id text not null, starts_at timestamptz not null,
 status text not null default 'sending', attempts int not null default 1,
 updated_at timestamptz not null default now(), error_code int,
 primary key(device_id,item_id,starts_at)
);
alter table public.family_push_config enable row level security;
alter table public.family_push_devices enable row level security;
alter table public.family_push_deliveries enable row level security;
revoke all on public.family_push_config,public.family_push_devices,public.family_push_deliveries from public,anon,authenticated;
grant all on public.family_push_config,public.family_push_devices,public.family_push_deliveries to service_role;
create index if not exists family_push_devices_trip_idx on public.family_push_devices(trip_id) where active;
create or replace function public.register_family_push(p_trip uuid,p_token text,p_name text,p_subscription jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare found_id uuid; device_count int;
begin
 perform 1 from public.family_push_config where trip_id=p_trip for update;
 if not found then raise exception 'missing_config'; end if;
 select id into found_id from public.family_push_devices where trip_id=p_trip and token_hash=p_token and active;
 if found_id is null then
  select count(*) into device_count from public.family_push_devices where trip_id=p_trip and active;
  if device_count>=2 then raise exception 'device_limit'; end if;
 end if;
 if exists(select 1 from public.family_push_devices where trip_id=p_trip and active and token_hash<>p_token and subscription->>'endpoint'=p_subscription->>'endpoint') then raise exception 'duplicate_endpoint'; end if;
 insert into public.family_push_devices(trip_id,token_hash,name,subscription,active)
 values(p_trip,p_token,p_name,p_subscription,true)
 on conflict(trip_id,token_hash) do update set name=excluded.name,subscription=excluded.subscription,active=true
 returning id into found_id;
 return found_id;
end;$$;
create or replace function public.claim_family_push(p_device uuid,p_item text,p_start timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed int;
begin
 insert into public.family_push_deliveries(device_id,item_id,starts_at) values(p_device,p_item,p_start)
 on conflict(device_id,item_id,starts_at) do update set status='sending',attempts=public.family_push_deliveries.attempts+1,updated_at=now()
 where public.family_push_deliveries.status<>'sent' and public.family_push_deliveries.attempts<3
 and public.family_push_deliveries.updated_at<now()-interval '90 seconds';
 get diagnostics changed=row_count;
 return changed=1;
end;$$;
revoke all on function public.register_family_push(uuid,text,text,jsonb),public.claim_family_push(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.register_family_push(uuid,text,text,jsonb),public.claim_family_push(uuid,text,timestamptz) to service_role;
