-- create profiles table linked to auth.users

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  role text not null default 'Operations Officer',
  created_at timestamptz default now(),
  last_login timestamptz,
  is_active boolean default true
);

create index if not exists profiles_email_idx on public.profiles(email);

-- enable RLS
alter table public.profiles enable row level security;

-- policies
-- authenticated users can read and update their own profile
create policy "authenticated_can_read_own_profile" on public.profiles
  for select using (auth.uid() = id);

create policy "authenticated_can_update_own_profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- admins can read and manage all profiles (admins identified by role in profiles)
create policy "admins_manage_profiles" on public.profiles
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'));
