drop policy if exists "admins_manage_profiles" on public.profiles;

create policy "admins_manage_profiles" on public.profiles
  for all using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Airport Administrator','System Administrator')
    )
  );

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (
    role in (
      'Operations Officer',
      'Control Center Operator',
      'Customs Supervisor',
      'Airport Administrator',
      'System Administrator'
    )
  );
