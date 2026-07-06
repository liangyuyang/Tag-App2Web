create extension if not exists pgcrypto;

create schema if not exists authz;

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  tag_code text not null unique,
  short_code text generated always as (right(regexp_replace(tag_code, '[^0-9A-Za-z]', '', 'g'), 4)) stored,
  nickname text,
  customer_name text not null default '',
  site_name text not null default '',
  status text not null default 'normal' check (status in ('normal', 'warning', 'offline')),
  latest_temperature numeric(7, 2),
  latest_humidity numeric(7, 2),
  battery_percent numeric(5, 2),
  rssi integer,
  high_limit numeric(7, 2) not null default 8,
  low_limit numeric(7, 2) not null default -2,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tag_readings (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tags(id) on delete cascade,
  recorded_at timestamptz not null,
  temperature_c numeric(7, 2) not null,
  humidity_percent numeric(7, 2),
  battery_percent numeric(5, 2),
  rssi integer,
  mqtt_topic text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tag_id, recorded_at)
);

create table if not exists public.customer_email_allowlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null default 'viewer' check (role in ('viewer', 'admin')),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email)
);

create table if not exists public.tag_access (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (email, tag_id)
);

create table if not exists public.user_tag_preferences (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  tag_id uuid not null references public.tags(id) on delete cascade,
  nickname text,
  pinned boolean not null default false,
  last_viewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_email, tag_id)
);

create index if not exists tags_short_code_idx on public.tags (short_code);
create index if not exists tags_last_seen_idx on public.tags (last_seen_at desc);
create index if not exists tag_readings_tag_time_idx on public.tag_readings (tag_id, recorded_at desc);
create index if not exists customer_email_allowlist_email_idx on public.customer_email_allowlist (lower(email));
create index if not exists tag_access_email_idx on public.tag_access (lower(email));

create or replace function authz.current_email()
returns text
language sql
stable
set search_path = auth, pg_catalog
as $$
  select lower(coalesce(nullif(auth.jwt() ->> 'email', ''), ''))
$$;

create or replace function authz.is_internal_user()
returns boolean
language sql
stable
set search_path = authz, pg_catalog
as $$
  select split_part(authz.current_email(), '@', 2) = any (
    array['miaomiaoce.com', 'zenmeasure.com', 'zenmeasure.space']
  )
$$;

create or replace function authz.is_allowlisted_user()
returns boolean
language sql
stable
security definer
set search_path = public, authz
as $$
  select exists (
    select 1
    from public.customer_email_allowlist
    where lower(email) = authz.current_email()
      and active = true
  )
$$;

create or replace function authz.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public, authz
as $$
  select authz.is_internal_user()
    or exists (
      select 1
      from public.customer_email_allowlist
      where lower(email) = authz.current_email()
        and active = true
        and role = 'admin'
    )
$$;

create or replace function authz.can_view_tag(target_tag_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, authz
as $$
  select authz.is_internal_user()
    or authz.is_admin_user()
    or exists (
      select 1
      from public.tag_access access
      join public.customer_email_allowlist allowlist
        on lower(allowlist.email) = lower(access.email)
      where access.tag_id = target_tag_id
        and lower(access.email) = authz.current_email()
        and allowlist.active = true
    )
$$;

revoke all on schema authz from public;
grant usage on schema authz to authenticated;
revoke all on all functions in schema authz from public;
grant execute on function authz.current_email() to authenticated;
grant execute on function authz.is_internal_user() to authenticated;
grant execute on function authz.is_allowlisted_user() to authenticated;
grant execute on function authz.is_admin_user() to authenticated;
grant execute on function authz.can_view_tag(uuid) to authenticated;

alter table public.tags enable row level security;
alter table public.tag_readings enable row level security;
alter table public.customer_email_allowlist enable row level security;
alter table public.tag_access enable row level security;
alter table public.user_tag_preferences enable row level security;

drop policy if exists "tags are visible to authorized users" on public.tags;
create policy "tags are visible to authorized users"
on public.tags for select
to authenticated
using ((select auth.uid()) is not null and authz.can_view_tag(id));

drop policy if exists "admins can manage tags" on public.tags;
drop policy if exists "admins can insert tags" on public.tags;
drop policy if exists "admins can update tags" on public.tags;
drop policy if exists "admins can delete tags" on public.tags;
create policy "admins can insert tags"
on public.tags for insert
to authenticated
with check ((select auth.uid()) is not null and (select authz.is_admin_user()));
create policy "admins can update tags"
on public.tags for update
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()))
with check ((select auth.uid()) is not null and (select authz.is_admin_user()));
create policy "admins can delete tags"
on public.tags for delete
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()));

drop policy if exists "readings are visible to authorized users" on public.tag_readings;
create policy "readings are visible to authorized users"
on public.tag_readings for select
to authenticated
using ((select auth.uid()) is not null and authz.can_view_tag(tag_id));

drop policy if exists "admins can manage readings" on public.tag_readings;
drop policy if exists "admins can insert readings" on public.tag_readings;
drop policy if exists "admins can update readings" on public.tag_readings;
drop policy if exists "admins can delete readings" on public.tag_readings;
create policy "admins can insert readings"
on public.tag_readings for insert
to authenticated
with check ((select auth.uid()) is not null and (select authz.is_admin_user()));
create policy "admins can update readings"
on public.tag_readings for update
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()))
with check ((select auth.uid()) is not null and (select authz.is_admin_user()));
create policy "admins can delete readings"
on public.tag_readings for delete
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()));

drop policy if exists "admins can view allowlist" on public.customer_email_allowlist;
create policy "admins can view allowlist"
on public.customer_email_allowlist for select
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()));

drop policy if exists "admins can manage allowlist" on public.customer_email_allowlist;
drop policy if exists "admins can insert allowlist" on public.customer_email_allowlist;
drop policy if exists "admins can update allowlist" on public.customer_email_allowlist;
drop policy if exists "admins can delete allowlist" on public.customer_email_allowlist;
create policy "admins can insert allowlist"
on public.customer_email_allowlist for insert
to authenticated
with check ((select auth.uid()) is not null and (select authz.is_admin_user()));
create policy "admins can update allowlist"
on public.customer_email_allowlist for update
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()))
with check ((select auth.uid()) is not null and (select authz.is_admin_user()));
create policy "admins can delete allowlist"
on public.customer_email_allowlist for delete
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()));

drop policy if exists "admins can view tag access" on public.tag_access;
create policy "admins can view tag access"
on public.tag_access for select
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()));

drop policy if exists "admins can manage tag access" on public.tag_access;
drop policy if exists "admins can insert tag access" on public.tag_access;
drop policy if exists "admins can update tag access" on public.tag_access;
drop policy if exists "admins can delete tag access" on public.tag_access;
create policy "admins can insert tag access"
on public.tag_access for insert
to authenticated
with check ((select auth.uid()) is not null and (select authz.is_admin_user()));
create policy "admins can update tag access"
on public.tag_access for update
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()))
with check ((select auth.uid()) is not null and (select authz.is_admin_user()));
create policy "admins can delete tag access"
on public.tag_access for delete
to authenticated
using ((select auth.uid()) is not null and (select authz.is_admin_user()));

drop policy if exists "users can view own tag preferences" on public.user_tag_preferences;
create policy "users can view own tag preferences"
on public.user_tag_preferences for select
to authenticated
using ((select auth.uid()) is not null and lower(user_email) = (select authz.current_email()));

drop policy if exists "users can manage own tag preferences" on public.user_tag_preferences;
drop policy if exists "users can insert own tag preferences" on public.user_tag_preferences;
drop policy if exists "users can update own tag preferences" on public.user_tag_preferences;
drop policy if exists "users can delete own tag preferences" on public.user_tag_preferences;
create policy "users can insert own tag preferences"
on public.user_tag_preferences for insert
to authenticated
with check ((select auth.uid()) is not null and lower(user_email) = (select authz.current_email()) and authz.can_view_tag(tag_id));
create policy "users can update own tag preferences"
on public.user_tag_preferences for update
to authenticated
using ((select auth.uid()) is not null and lower(user_email) = (select authz.current_email()))
with check ((select auth.uid()) is not null and lower(user_email) = (select authz.current_email()) and authz.can_view_tag(tag_id));
create policy "users can delete own tag preferences"
on public.user_tag_preferences for delete
to authenticated
using ((select auth.uid()) is not null and lower(user_email) = (select authz.current_email()));

grant usage on schema public to anon, authenticated;
grant select on public.tags, public.tag_readings to authenticated;
grant select, insert, update, delete on public.customer_email_allowlist, public.tag_access, public.user_tag_preferences to authenticated;
grant select, insert, update, delete on public.tags, public.tag_readings to authenticated;
grant all on public.tags, public.tag_readings, public.customer_email_allowlist, public.tag_access, public.user_tag_preferences to service_role;
