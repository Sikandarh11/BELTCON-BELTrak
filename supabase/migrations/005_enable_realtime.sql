-- Enable realtime for alarm and bag changes
alter publication supabase_realtime add table public.alarms;
alter publication supabase_realtime add table public.bags;
