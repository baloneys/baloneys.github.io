-- 2026-10-11-device-links.sql: one balcade account on several devices, linked with a QR code.
--
-- Every browser signs in anonymously and gets its own auth user. Copying a login between devices would break
-- Supabase's refresh-token rotation (both copies get signed out), so instead a device can be LINKED to another
-- account: tetris_device_links maps the device's auth user to the account it acts as, and every rule below asks
-- public.tetris_me() ("the account I act as": the linked owner, or my own id) instead of auth.uid().
--
-- Linking: the account's device calls link_code_create(data) and shows the code as a QR code (chat.html#link/CODE);
-- the new device opens it and calls link_code_redeem(code), which links it and hands back the game data the first
-- device packed into the code (settings, skins, bests: the localStorage side of the games). Codes last 10 minutes
-- and work once. my_devices() lists an account's devices; device_unlink(device) removes one.
--
-- Run once in the SQL editor after the earlier migrations. Safe to run again.

/* ---------- game data that follows the account ---------- */
-- The games' local settings, skins and bests ({ key: { v: value, t: ms } }), kept in step across linked devices
-- by games-social.js (newest change per key wins). Covered by the existing "profiles update own" rule.
alter table public.tetris_profiles add column if not exists device_data jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.tetris_profiles add constraint tetris_profiles_device_data_size check (pg_column_size(device_data) <= 400000);
exception when duplicate_object then null; end $$;

/* ---------- links and codes ---------- */
create table if not exists public.tetris_device_links (
  device uuid primary key,
  owner uuid not null references public.tetris_profiles (id) on delete cascade,
  label text not null default 'Device' check (char_length(label) <= 40),
  linked_at timestamptz not null default now(),
  check (device <> owner)
);
alter table public.tetris_device_links enable row level security;
-- (no table policies: everything goes through the functions below)

create table if not exists public.tetris_link_codes (
  code text primary key check (code ~ '^[A-Z2-9]{8}$'),
  owner uuid not null references public.tetris_profiles (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 200000),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.tetris_link_codes enable row level security;

-- The account the caller acts as: its owner when this device is linked, otherwise itself.
create or replace function public.tetris_me() returns uuid language sql stable security definer set search_path = public as $$
  select coalesce((select owner from public.tetris_device_links where device = auth.uid()), auth.uid());
$$;

create or replace function public.link_code_create(data jsonb default '{}'::jsonb, dev_label text default null) returns text language plpgsql security definer set search_path = public as $$
declare c text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.tetris_profiles where id = public.tetris_me()) then raise exception 'Make a profile first.'; end if;
  delete from public.tetris_link_codes where expires_at < now() or owner = public.tetris_me();
  loop
    c := '';
    for i in 1..8 loop c := c || substr(alphabet, 1 + floor(random() * 32)::int, 1); end loop;
    exit when not exists (select 1 from public.tetris_link_codes where code = c);
  end loop;
  insert into public.tetris_link_codes (code, owner, data) values (c, public.tetris_me(), coalesce(data, '{}'::jsonb));
  return c;
end $$;

-- Redeem a code. merge: if this device already had its own account, fold its progress into the account it's joining
-- (achievements keep the earliest unlock; XP and points add up; owned items, badges and tags join; friends, runs,
-- invites, public chat and lobbies move across; game data keeps the newest per key), then retire the old account.
-- Without merge the old account is simply left behind. Devices that were linked to the old account follow it.
drop function if exists public.link_code_redeem(text, text);
create or replace function public.link_code_redeem(link text, dev_label text default 'Device', merge boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tetris_link_codes; me uuid := auth.uid(); old public.tetris_profiles; merged boolean := false;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into r from public.tetris_link_codes where code = upper(link) and expires_at > now();
  if not found then raise exception 'That link code has expired or was already used. Make a new one on your other device.'; end if;
  if r.owner = me or r.owner = public.tetris_me() then raise exception 'This device is already part of that account.'; end if;
  delete from public.tetris_link_codes where code = r.code;

  select * into old from public.tetris_profiles where id = me;
  if found and merge then
    update public.tetris_profiles t set
      achievements = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
        select k, min((v)::text::bigint) as v from (
          select key as k, value as v from jsonb_each(t.achievements) union all select key, value from jsonb_each(old.achievements)) a
        where jsonb_typeof(v) = 'number' group by k) b),
      xp = least(50000000, t.xp + old.xp),
      points = least(50000000, t.points + old.points),
      owned = (select coalesce(array_agg(distinct x), '{}') from unnest(t.owned || old.owned) x),
      badges = (select coalesce(array_agg(x), '{}') from (select distinct x from unnest(t.badges || old.badges) x limit 3) b),
      tags = (select coalesce(array_agg(x), '{}') from (select distinct x from unnest(t.tags || old.tags) x limit 5) b),
      device_data = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
        select distinct on (k) k, v from (
          select key as k, value as v from jsonb_each(t.device_data) union all select key, value from jsonb_each(old.device_data)) a
        order by k, (v->>'t')::bigint desc nulls last) b)
    where t.id = r.owner;
    -- friendships: re-point to the account, dropping any that would duplicate or befriend itself
    delete from public.tetris_friends f where (f.requester = me and (f.addressee = r.owner or exists (select 1 from public.tetris_friends g where g.requester = r.owner and g.addressee = f.addressee) or exists (select 1 from public.tetris_friends g where g.addressee = r.owner and g.requester = f.addressee)))
      or (f.addressee = me and (f.requester = r.owner or exists (select 1 from public.tetris_friends g where g.addressee = r.owner and g.requester = f.requester) or exists (select 1 from public.tetris_friends g where g.requester = r.owner and g.addressee = f.requester)));
    update public.tetris_friends set requester = r.owner where requester = me;
    update public.tetris_friends set addressee = r.owner where addressee = me;
    delete from public.tetris_notifications where (to_id = me and from_id = r.owner) or (from_id = me and to_id = r.owner);
    update public.tetris_notifications set to_id = r.owner where to_id = me;
    update public.tetris_notifications set from_id = r.owner where from_id = me;
    update public.tetris_runs set user_id = r.owner where user_id = me;
    update public.tetris_lobbies set host_id = r.owner where host_id = me;
    update public.tetris_chat set user_id = r.owner where user_id = me;
    delete from public.tetris_chat_reactions x where x.user_id = me and exists (select 1 from public.tetris_chat_reactions y where y.user_id = r.owner and y.message_id = x.message_id and y.emoji = x.emoji);
    update public.tetris_chat_reactions set user_id = r.owner where user_id = me;
    update public.tetris_reports set reporter = r.owner where reporter = me;
    update public.tetris_reports set target_user = r.owner where target_user = me;
    merged := true;
  end if;
  -- devices that were linked to this device's old account now belong to the account it's joining
  update public.tetris_device_links set owner = r.owner where owner = me;
  if merged then delete from public.tetris_profiles where id = me; end if;
  insert into public.tetris_device_links (device, owner, label) values (me, r.owner, left(coalesce(dev_label, 'Device'), 40))
    on conflict (device) do update set owner = excluded.owner, label = excluded.label, linked_at = now();
  return jsonb_build_object('owner', r.owner, 'data', r.data, 'merged', merged);
end $$;

-- What this device would bring to a merge (shown before linking): its own account, if it has one.
create or replace function public.my_own_account() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'xp', xp, 'points', points, 'achievements', (select count(*) from jsonb_object_keys(achievements)),
    'friends', (select count(*) from public.tetris_friends f where f.status = 'accepted' and auth.uid() in (f.requester, f.addressee)))
  from public.tetris_profiles where id = auth.uid();
$$;

-- An account's linked devices (the owner's own original device isn't a row; it's always part of the account).
create or replace function public.my_devices() returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('device', device, 'label', label, 'linked_at', linked_at, 'this', device = auth.uid())
  from public.tetris_device_links where owner = public.tetris_me() order by linked_at;
$$;

create or replace function public.device_unlink(dev uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.tetris_device_links where device = dev and owner = public.tetris_me();
end $$;

grant execute on function public.tetris_me(), public.link_code_create(jsonb, text), public.link_code_redeem(text, text, boolean),
  public.my_own_account(), public.my_devices(), public.device_unlink(uuid) to anon, authenticated;

/* ---------- every rule acts for the account, not the device ---------- */

drop policy if exists "profiles insert own" on public.tetris_profiles;
create policy "profiles insert own" on public.tetris_profiles for insert with check (public.tetris_me() = id);
drop policy if exists "profiles update own" on public.tetris_profiles;
create policy "profiles update own" on public.tetris_profiles for update using (public.tetris_me() = id) with check (public.tetris_me() = id);

drop policy if exists "friends read own" on public.tetris_friends;
create policy "friends read own" on public.tetris_friends for select using (public.tetris_me() in (requester, addressee));
drop policy if exists "friends request" on public.tetris_friends;
create policy "friends request" on public.tetris_friends for insert with check (public.tetris_me() = requester and status = 'pending' and not public.tetris_is_banned(public.tetris_me(), 'all'));
drop policy if exists "friends accept" on public.tetris_friends;
create policy "friends accept" on public.tetris_friends for update using (public.tetris_me() = addressee) with check (public.tetris_me() = addressee);
drop policy if exists "friends remove" on public.tetris_friends;
create policy "friends remove" on public.tetris_friends for delete using (public.tetris_me() in (requester, addressee));

drop policy if exists "notes send" on public.tetris_notifications;
create policy "notes send" on public.tetris_notifications for insert with check (public.tetris_me() = from_id and to_id <> from_id and kind in ('friend_request', 'friend_accept', 'invite', 'mention') and not public.tetris_is_banned(public.tetris_me(), 'all'));
drop policy if exists "notes read" on public.tetris_notifications;
create policy "notes read" on public.tetris_notifications for select using (public.tetris_me() = to_id);
drop policy if exists "notes mark" on public.tetris_notifications;
create policy "notes mark" on public.tetris_notifications for update using (public.tetris_me() = to_id) with check (public.tetris_me() = to_id);
drop policy if exists "notes clear" on public.tetris_notifications;
create policy "notes clear" on public.tetris_notifications for delete using (public.tetris_me() = to_id);

drop policy if exists "runs insert own" on public.tetris_runs;
create policy "runs insert own" on public.tetris_runs for insert with check (public.tetris_me() = user_id and not public.tetris_is_banned(public.tetris_me(), 'all'));

drop policy if exists "lobbies host insert" on public.tetris_lobbies;
create policy "lobbies host insert" on public.tetris_lobbies for insert with check (public.tetris_me() = host_id and not public.tetris_is_banned(public.tetris_me(), 'all'));
drop policy if exists "lobbies host update" on public.tetris_lobbies;
create policy "lobbies host update" on public.tetris_lobbies for update using (public.tetris_me() = host_id) with check (public.tetris_me() = host_id and not public.tetris_is_banned(public.tetris_me(), 'all'));
drop policy if exists "lobbies host delete" on public.tetris_lobbies;
create policy "lobbies host delete" on public.tetris_lobbies for delete using (public.tetris_me() = host_id);

drop policy if exists "bans read own" on public.tetris_bans;
create policy "bans read own" on public.tetris_bans for select using (public.tetris_me() = user_id);
drop policy if exists "chat post" on public.tetris_chat;
create policy "chat post" on public.tetris_chat for insert with check (public.tetris_me() = user_id and not public.tetris_is_banned(public.tetris_me(), 'chat'));
drop policy if exists "reactions add" on public.tetris_chat_reactions;
create policy "reactions add" on public.tetris_chat_reactions for insert with check (public.tetris_me() = user_id and not public.tetris_is_banned(public.tetris_me(), 'chat'));
drop policy if exists "reactions remove" on public.tetris_chat_reactions;
create policy "reactions remove" on public.tetris_chat_reactions for delete using (public.tetris_me() = user_id);
drop policy if exists "reports send" on public.tetris_reports;
create policy "reports send" on public.tetris_reports for insert with check (public.tetris_me() = reporter);
alter table public.tetris_reports alter column reporter set default public.tetris_me();

create or replace function public.chat_edit(msg bigint, new_body text) returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(new_body, '')) not between 1 and 500 then raise exception 'Messages are 1 to 500 characters.'; end if;
  update public.tetris_chat set body = new_body, edited_at = now()
    where id = msg and user_id = public.tetris_me() and not deleted and created_at > now() - interval '15 minutes';
  if not found then raise exception 'You can only edit your own messages for 15 minutes.'; end if;
end $$;
create or replace function public.chat_delete(msg bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.tetris_chat set deleted = true, body = '[deleted]', deleted_by = 'author' where id = msg and user_id = public.tetris_me();
end $$;

create or replace function public.mod_level(token text) returns integer language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if token is not null and token <> '' and exists (select 1 from public.tetris_mod_sessions
      where token_hash = encode(digest(token, 'sha256'), 'hex') and expires_at > now()) then
    return 5;
  end if;
  return coalesce(public.tetris_staff_level(public.tetris_me()), 0);
end $$;
create or replace function public.mod_actor(token text) returns text language plpgsql stable security definer set search_path = public as $$
begin
  if public.mod_level(token) = 5 then return 'baloneys (master)'; end if;
  return coalesce((select name || ' (' || coalesce(role, '-') || ')' from public.tetris_profiles where id = public.tetris_me()), 'unknown');
end $$;

create or replace function public.my_ban() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('scope', scope, 'reason', reason, 'expires_at', expires_at) from public.tetris_bans
  where user_id = public.tetris_me() and not lifted and (expires_at is null or expires_at > now()) order by (scope = 'all') desc, expires_at desc nulls first limit 1;
$$;
