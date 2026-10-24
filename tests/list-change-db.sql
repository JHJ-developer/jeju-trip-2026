-- Isolated data; no commit and no calls to the push service.
begin;
set local role service_role;
do $$
declare trip uuid:=gen_random_uuid(); device uuid:=gen_random_uuid(); list_scope text; state text; n int;
begin
 insert into public.family_trips(id,access_hash,document,version,updated_at)
 values(trip,md5(random()::text)||md5(random()::text),'{"days":[],"shopping":{"groups":[]},"packing":{"groups":[]},"groceries":{"groups":[]}}',1,now());
 insert into public.family_push_devices(id,trip_id,token_hash,name,subscription,active)
 values(device,trip,'notification-policy-test','test-only','{}',true);
 foreach list_scope in array array['shopping','packing','groceries'] loop
  update public.family_trips set document=jsonb_set(document,array[list_scope,'groups'],'[{"id":"g","name":"test","items":[{"id":"i","title":"item","done":false}]}]'),version=version+1 where id=trip;
  update public.family_trips set document=jsonb_set(document,array[list_scope,'groups','0','items','0','title'],'"edited"'),version=version+1 where id=trip;
  update public.family_trips set document=jsonb_set(document,array[list_scope,'groups','0','items','0','done'],'true'),version=version+1 where id=trip;
  update public.family_trips set document=jsonb_set(document,array[list_scope,'groups'],'[]'),version=version+1 where id=trip;
 end loop;
 if exists(select 1 from public.family_change_deliveries where trip_id=trip) then
  raise exception 'List edits must not enqueue notifications';
 end if;
 -- Even a legacy pending/retry/in-flight row must never be claimed again.
 foreach list_scope in array array['shopping','packing','groceries'] loop
  foreach state in array array['pending','retry','sending'] loop
   insert into public.family_change_deliveries(trip_id,device_id,scope,document_version,status,updated_at)
   values(trip,device,list_scope,case state when 'pending' then 101 when 'retry' then 102 else 103 end,state,now()-interval '5 minutes');
  end loop;
 end loop;
 select count(*) into n from public.claim_family_changes(trip);
 if n<>0 then raise exception 'Legacy list queue is still claimable';end if;
 if not exists(select 1 from public.family_trips where id=trip and version=13) then
  raise exception 'List saves were unexpectedly blocked';
 end if;
end;$$;
reset role;
select 'PASS: all list edits save without notifications; legacy pending/retry/sending rows cannot be claimed' as result;
rollback;
