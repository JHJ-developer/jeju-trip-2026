begin;
CREATE OR REPLACE FUNCTION public.enqueue_family_list_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare list_scope text; added int; total_added int:=0; dispatch_secret text;
begin
 foreach list_scope in array array['packing'] loop
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
end;$function$
;
update public.family_change_deliveries set status='skipped',updated_at=now() where scope in ('shopping','groceries') and status in ('pending','retry','sending');
commit;