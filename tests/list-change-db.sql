begin;
create or replace trigger family_list_change_push after update of document on public.family_trips
 for each row execute function public.enqueue_family_list_changes();
set local role service_role;
do $$
declare trip uuid:=gen_random_uuid(); d1 uuid:=gen_random_uuid(); d2 uuid:=gen_random_uuid(); n int;
begin
 insert into public.family_trips(id,access_hash,document,version,updated_at)
 values(trip,md5(random()::text)||md5(random()::text),'{"days":[],"shopping":{"groups":[]},"packing":{"groups":[]}}',1,now());
 insert into public.family_push_config values(trip,'unused','unused','unused',repeat('e',64));
 insert into public.family_push_devices(id,trip_id,token_hash,name,subscription,active)
 values(d1,trip,'t1','test1','{}',true),(d2,trip,'t2','test2','{}',true),(gen_random_uuid(),trip,'t3','revoked','{}',false);
 update public.family_trips set document=document,version=2 where id=trip;
 update public.family_trips set document=document||'{"title":"unrelated"}',version=3 where id=trip;
 if exists(select 1 from public.family_change_deliveries where trip_id=trip) then raise exception 'no-op or unrelated update enqueued';end if;
 update public.family_trips set document=jsonb_set(document,'{shopping,groups}','[{"id":"g","name":"buy","items":[{"id":"i","title":"item","done":false}]}]'),version=4 where id=trip;
 select count(*) into n from public.family_change_deliveries where trip_id=trip and scope='shopping';if n<>2 then raise exception 'expected two active recipients: %',n;end if;
 update public.family_trips set document=jsonb_set(document,'{shopping,groups,0,items,0,done}','true'),version=5 where id=trip;
 select count(*) into n from public.family_change_deliveries where trip_id=trip;if n<>4 then raise exception 'check change missing';end if;
 select count(*) into n from public.claim_family_changes(trip);if n<>4 then raise exception 'claim missing';end if;
 select count(*) into n from public.claim_family_changes(trip);if n<>0 then raise exception 'duplicate claim';end if;
 update public.family_change_deliveries set status='retry',updated_at=now()-interval '100 seconds' where trip_id=trip;
 select count(*) into n from public.claim_family_changes(trip);if n<>4 then raise exception 'retry claim missing';end if;
 update public.family_change_deliveries set status='sent' where trip_id=trip;
 select count(*) into n from public.claim_family_changes(trip);if n<>0 then raise exception 'sent claimed again';end if;
 update public.family_trips set document=jsonb_set(document,'{shopping,groups}','[]'),version=6 where id=trip;
 update public.family_trips set document=jsonb_set(document,'{packing,groups}','[{"id":"p","name":"packing","items":[]}]'),version=7 where id=trip;
 select count(*) into n from public.family_change_deliveries where trip_id=trip;if n<>8 then raise exception 'delete or packing change missing';end if;
end;$$;
reset role;
select 'PASS: transaction-local add/check/delete/packing changes, no-op exclusion, active recipients, atomic claim and retry; rollback prevents all test pushes' as result,
 (select count(*)>=4 from net.http_request_queue where headers->>'x-scheduler-secret'=repeat('e',64)) as immediate_dispatch_enqueued;
rollback;
