-- Chat, presence and moderation for balcade (run once, after the Battleships/Chess migration).
--
-- Adds: social status and presence on profiles, cross-game invites, a public chatroom stored in the
-- database (with reactions, a word filter, slow mode and lock), reports, bans and timeouts enforced by row
-- level security, staff roles (helper, moderator, admin, dev) with exclusive badges, and the "baloneys"
-- master login for the moderation portal.
--
-- Trust model: every permission check happens in the database. Staff actions go through SECURITY DEFINER
-- functions (mod_*) that check the caller's level first; the tables behind them have no client policies.
-- The master password is stored only as a bcrypt hash. Its first-time setup needs a one-time setup code
-- (also stored hashed), so nobody else can claim the account before Sean does.

create extension if not exists pgcrypto with schema extensions;

/* ---------- profiles: status, presence, role ---------- */
alter table public.tetris_profiles add column if not exists status text not null default '' check (char_length(status) <= 60);
alter table public.tetris_profiles add column if not exists status_kind text not null default 'online' check (status_kind in ('online', 'away', 'busy', 'invisible'));
alter table public.tetris_profiles add column if not exists presence jsonb check (presence is null or (jsonb_typeof(presence) = 'object' and length(presence::text) < 300));
alter table public.tetris_profiles add column if not exists role text check (role is null or role in ('helper', 'moderator', 'admin', 'dev'));

-- Players can't give themselves a role: only the mod_set_role function (running as the owner) can change it.
create or replace function public.tetris_touch() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'tetris_profiles' then
    new.updated_at := now(); new.last_seen := now();
    if current_user in ('anon', 'authenticated') then
      if tg_op = 'INSERT' then new.role := null; else new.role := old.role; end if;
    end if;
  else new.updated_at := now(); end if;
  return new;
end $$;

/* ---------- invites say which game they're for ---------- */
alter table public.tetris_notifications add column if not exists game text check (game is null or game in ('tetris', 'pong', 'battleships', 'chess'));
alter table public.tetris_notifications drop constraint if exists tetris_notifications_kind_check;
alter table public.tetris_notifications add constraint tetris_notifications_kind_check check (kind in ('friend_request', 'friend_accept', 'invite', 'mention', 'staff'));

/* ---------- bans and timeouts ---------- */
create table if not exists public.tetris_bans (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.tetris_profiles (id) on delete cascade,
  scope text not null default 'chat' check (scope in ('chat', 'all')),   -- chat: public chat only; all: chat, lobbies, runs, friends, invites
  reason text not null default '' check (char_length(reason) <= 300),
  expires_at timestamptz,                                               -- null = permanent
  lifted boolean not null default false,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists tetris_bans_user on public.tetris_bans (user_id) where not lifted;
alter table public.tetris_bans enable row level security;
drop policy if exists "bans read own" on public.tetris_bans;
create policy "bans read own" on public.tetris_bans for select using (auth.uid() = user_id);

create or replace function public.tetris_is_banned(uid uuid, what text default 'all') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tetris_bans b where b.user_id = uid and not b.lifted
    and (b.expires_at is null or b.expires_at > now()) and (b.scope = 'all' or b.scope = what));
$$;

/* ---------- public chat ---------- */
create table if not exists public.tetris_chat (
  id bigint generated always as identity primary key,
  room text not null default 'public' check (room ~ '^[a-z0-9_-]{1,24}$'),
  user_id uuid not null references public.tetris_profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  reply_to bigint references public.tetris_chat (id) on delete set null,
  pinned boolean not null default false,
  deleted boolean not null default false,
  deleted_by text,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tetris_chat_room on public.tetris_chat (room, id desc);

create table if not exists public.tetris_chat_reactions (
  message_id bigint not null references public.tetris_chat (id) on delete cascade,
  user_id uuid not null references public.tetris_profiles (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '💀')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.tetris_chat_settings (
  room text primary key check (room ~ '^[a-z0-9_-]{1,24}$'),
  locked boolean not null default false,
  slow_seconds integer not null default 0 check (slow_seconds between 0 and 600),
  motd text not null default '' check (char_length(motd) <= 200)
);
insert into public.tetris_chat_settings (room) values ('public') on conflict do nothing;

-- Words the public chat stars out (case-insensitive, whole words). Staff manage it in the portal.
create table if not exists public.tetris_chat_filter (word text primary key check (word ~ '^[a-z0-9 ]{2,30}$'));
insert into public.tetris_chat_filter (word) values
  ('fuck'), ('fucking'), ('fucker'), ('cunt'), ('cock'), ('dick'), ('pussy'), ('penis'), ('vagina'), ('porn'), ('porno'),
  ('nude'), ('nudes'), ('naked'), ('sex'), ('sexy'), ('horny'), ('cum'), ('blowjob'), ('handjob'), ('dildo'), ('boobs'),
  ('tits'), ('titties'), ('anal'), ('orgasm'), ('masturbate'), ('nsfw'), ('onlyfans'), ('hentai'), ('rape'), ('slut'), ('whore'),
  ('nigger'), ('nigga'), ('faggot'), ('fag'), ('retard'), ('kys')
on conflict do nothing;

-- Before a message is stored: star out filtered words, then enforce lock, slow mode, bans and timeouts.
create or replace function public.tetris_chat_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare w text; st record; last_at timestamptz;
begin
  for w in select word from public.tetris_chat_filter loop
    new.body := regexp_replace(new.body, '\m' || w || '\M', repeat('*', char_length(w)), 'gi');
  end loop;
  if tg_op = 'INSERT' and current_user in ('anon', 'authenticated') then
    if public.tetris_is_banned(new.user_id, 'chat') then raise exception 'You are muted or banned from public chat.' using errcode = 'P0001'; end if;
    select * into st from public.tetris_chat_settings where room = new.room;
    if st.locked and public.tetris_staff_level(new.user_id) < 1 then raise exception 'Public chat is locked right now.' using errcode = 'P0001'; end if;
    if coalesce(st.slow_seconds, 0) > 0 and public.tetris_staff_level(new.user_id) < 1 then
      select max(created_at) into last_at from public.tetris_chat where room = new.room and user_id = new.user_id;
      if last_at is not null and last_at > now() - make_interval(secs => st.slow_seconds) then
        raise exception 'Slow mode: wait % seconds between messages.', st.slow_seconds using errcode = 'P0001';
      end if;
    end if;
    new.pinned := false; new.deleted := false; new.deleted_by := null; new.edited_at := null; new.created_at := now();
  end if;
  return new;
end $$;
drop trigger if exists tetris_chat_guard on public.tetris_chat;
create trigger tetris_chat_guard before insert or update on public.tetris_chat for each row execute function public.tetris_chat_guard();

alter table public.tetris_chat enable row level security;
alter table public.tetris_chat_reactions enable row level security;
alter table public.tetris_chat_settings enable row level security;
alter table public.tetris_chat_filter enable row level security;

drop policy if exists "chat readable" on public.tetris_chat;
create policy "chat readable" on public.tetris_chat for select using (true);
drop policy if exists "chat post" on public.tetris_chat;
create policy "chat post" on public.tetris_chat for insert with check (auth.uid() = user_id and not public.tetris_is_banned(auth.uid(), 'chat'));
drop policy if exists "reactions readable" on public.tetris_chat_reactions;
create policy "reactions readable" on public.tetris_chat_reactions for select using (true);
drop policy if exists "reactions add" on public.tetris_chat_reactions;
create policy "reactions add" on public.tetris_chat_reactions for insert with check (auth.uid() = user_id and not public.tetris_is_banned(auth.uid(), 'chat'));
drop policy if exists "reactions remove" on public.tetris_chat_reactions;
create policy "reactions remove" on public.tetris_chat_reactions for delete using (auth.uid() = user_id);
drop policy if exists "chat settings readable" on public.tetris_chat_settings;
create policy "chat settings readable" on public.tetris_chat_settings for select using (true);
-- the filter list isn't public (no select policy); the client keeps its own small copy for a friendly warning

-- Edit or delete your own message (within 15 minutes for edits).
create or replace function public.chat_edit(msg bigint, new_body text) returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(new_body, '')) not between 1 and 500 then raise exception 'Messages are 1 to 500 characters.'; end if;
  update public.tetris_chat set body = new_body, edited_at = now()
    where id = msg and user_id = auth.uid() and not deleted and created_at > now() - interval '15 minutes';
  if not found then raise exception 'You can only edit your own messages for 15 minutes.'; end if;
end $$;
create or replace function public.chat_delete(msg bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.tetris_chat set deleted = true, body = '[deleted]', deleted_by = 'author' where id = msg and user_id = auth.uid();
end $$;

/* ---------- reports ---------- */
create table if not exists public.tetris_reports (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references public.tetris_profiles (id) on delete cascade,
  target_user uuid references public.tetris_profiles (id) on delete cascade,
  message_id bigint references public.tetris_chat (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 300),
  resolved boolean not null default false,
  resolved_by text,
  created_at timestamptz not null default now()
);
alter table public.tetris_reports enable row level security;
drop policy if exists "reports send" on public.tetris_reports;
create policy "reports send" on public.tetris_reports for insert with check (auth.uid() = reporter);

/* ---------- staff: levels, master login, audit log ---------- */
create table if not exists public.tetris_mod_master (
  id integer primary key default 1 check (id = 1),
  password_hash text,
  setup_hash text not null,
  failed integer not null default 0,
  locked_until timestamptz
);
create table if not exists public.tetris_mod_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
create table if not exists public.tetris_mod_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  target uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.tetris_mod_master enable row level security;
alter table public.tetris_mod_sessions enable row level security;
alter table public.tetris_mod_log enable row level security;
-- (no policies: only the functions below can touch these three tables)

-- Staff level of a player: helper 1, moderator 2, admin 3, dev 4. The master login is 5.
create or replace function public.tetris_staff_level(uid uuid) returns integer language sql stable security definer set search_path = public as $$
  select case (select role from public.tetris_profiles where id = uid)
    when 'helper' then 1 when 'moderator' then 2 when 'admin' then 3 when 'dev' then 4 else 0 end;
$$;

-- The caller's level: a valid master token, otherwise their player role.
create or replace function public.mod_level(token text) returns integer language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if token is not null and token <> '' and exists (select 1 from public.tetris_mod_sessions
      where token_hash = encode(digest(token, 'sha256'), 'hex') and expires_at > now()) then
    return 5;
  end if;
  return coalesce(public.tetris_staff_level(auth.uid()), 0);
end $$;

create or replace function public.mod_actor(token text) returns text language plpgsql stable security definer set search_path = public as $$
begin
  if public.mod_level(token) = 5 then return 'baloneys (master)'; end if;
  return coalesce((select name || ' (' || coalesce(role, '-') || ')' from public.tetris_profiles where id = auth.uid()), 'unknown');
end $$;

create or replace function public.mod_require(token text, need integer) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if public.mod_level(token) < need then raise exception 'Not allowed: this needs a higher staff level.' using errcode = '42501'; end if;
end $$;

create or replace function public.mod_new_session() returns text language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  delete from public.tetris_mod_sessions where expires_at < now();
  insert into public.tetris_mod_sessions (token_hash) values (encode(digest(t, 'sha256'), 'hex'));
  return t;
end $$;

-- First login: the setup code proves it's Sean; the password he picks is stored as a bcrypt hash.
create or replace function public.mod_master_setup(setup_code text, new_password text) returns text language plpgsql security definer set search_path = public, extensions as $$
declare m record;
begin
  select * into m from public.tetris_mod_master where id = 1 for update;
  if m is null then raise exception 'The master account is not configured.'; end if;
  if m.password_hash is not null then raise exception 'The master password is already set. Log in instead.'; end if;
  if char_length(coalesce(new_password, '')) < 10 then raise exception 'Pick a password of at least 10 characters.'; end if;
  if crypt(coalesce(setup_code, ''), m.setup_hash) <> m.setup_hash then
    perform pg_sleep(1);
    raise exception 'That setup code is wrong.';
  end if;
  update public.tetris_mod_master set password_hash = crypt(new_password, gen_salt('bf', 10)), failed = 0, locked_until = null where id = 1;
  insert into public.tetris_mod_log (actor, action) values ('baloneys (master)', 'master password set');
  return public.mod_new_session();
end $$;

create or replace function public.mod_master_status() returns text language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from public.tetris_mod_master) then 'missing'
    when (select password_hash from public.tetris_mod_master where id = 1) is null then 'setup' else 'ready' end;
$$;

-- Log in as "baloneys". Five wrong passwords in a row lock it for 15 minutes.
create or replace function public.mod_master_login(username text, password text) returns text language plpgsql security definer set search_path = public, extensions as $$
declare m record;
begin
  select * into m from public.tetris_mod_master where id = 1 for update;
  if m is null or m.password_hash is null then raise exception 'The master password has not been set yet.'; end if;
  if m.locked_until is not null and m.locked_until > now() then raise exception 'Too many wrong passwords. Try again in a few minutes.'; end if;
  if lower(coalesce(username, '')) <> 'baloneys' or crypt(coalesce(password, ''), m.password_hash) <> m.password_hash then
    update public.tetris_mod_master set failed = failed + 1, locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' else null end where id = 1;
    perform pg_sleep(1);
    raise exception 'Wrong username or password.';
  end if;
  update public.tetris_mod_master set failed = 0, locked_until = null where id = 1;
  return public.mod_new_session();
end $$;

create or replace function public.mod_master_password(token text, new_password text) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.mod_require(token, 5);
  if char_length(coalesce(new_password, '')) < 10 then raise exception 'Pick a password of at least 10 characters.'; end if;
  update public.tetris_mod_master set password_hash = crypt(new_password, gen_salt('bf', 10)) where id = 1;
  delete from public.tetris_mod_sessions where token_hash <> encode(digest(token, 'sha256'), 'hex');
  insert into public.tetris_mod_log (actor, action) values ('baloneys (master)', 'master password changed');
end $$;

create or replace function public.mod_logout(token text) returns void language sql security definer set search_path = public, extensions as $$
  delete from public.tetris_mod_sessions where token_hash = encode(digest(coalesce(token, ''), 'sha256'), 'hex');
$$;

create or replace function public.mod_me(token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lv integer := public.mod_level(token);
begin
  return jsonb_build_object('level', lv, 'actor', case when lv > 0 then public.mod_actor(token) else null end);
end $$;

create or replace function public.mod_log_action(token text, act text, tgt uuid, det jsonb) returns void language sql security definer set search_path = public as $$
  insert into public.tetris_mod_log (actor, action, target, detail) values (public.mod_actor(token), act, tgt, det);
$$;

/* ---------- staff tools ---------- */

-- helper+: open reports
create or replace function public.mod_reports(token text, include_resolved boolean default false) returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mod_require(token, 1);
  return query select jsonb_build_object('id', r.id, 'reason', r.reason, 'resolved', r.resolved, 'resolved_by', r.resolved_by, 'created_at', r.created_at,
      'reporter', jsonb_build_object('id', rp.id, 'name', rp.name), 'target', case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name, 'role', t.role) end,
      'message', case when c.id is null then null else jsonb_build_object('id', c.id, 'body', c.body, 'deleted', c.deleted, 'created_at', c.created_at) end)
    from public.tetris_reports r
    left join public.tetris_profiles rp on rp.id = r.reporter
    left join public.tetris_profiles t on t.id = r.target_user
    left join public.tetris_chat c on c.id = r.message_id
    where include_resolved or not r.resolved
    order by r.created_at desc limit 200;
end $$;

create or replace function public.mod_resolve_report(token text, report bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.mod_require(token, 1);
  update public.tetris_reports set resolved = true, resolved_by = public.mod_actor(token) where id = report;
  perform public.mod_log_action(token, 'resolve report', null, jsonb_build_object('report', report));
end $$;

-- helper+: remove a public chat message
create or replace function public.mod_delete_message(token text, msg bigint, why text default '') returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  perform public.mod_require(token, 1);
  update public.tetris_chat set deleted = true, body = '[removed by staff]', deleted_by = public.mod_actor(token) where id = msg returning user_id into uid;
  perform public.mod_log_action(token, 'delete message', uid, jsonb_build_object('message', msg, 'reason', why));
end $$;

-- moderator+: pin / unpin
create or replace function public.mod_pin(token text, msg bigint, on_off boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.mod_require(token, 2);
  update public.tetris_chat set pinned = on_off where id = msg;
  perform public.mod_log_action(token, case when on_off then 'pin' else 'unpin' end, null, jsonb_build_object('message', msg));
end $$;

-- moderator+: timeouts (kick out of public chat for a while) and bans up to 7 days; admin+: longer, permanent,
-- or site-wide bans. Staff can't act on someone at or above their own level.
create or replace function public.mod_ban(token text, target uuid, minutes integer, ban_scope text, why text) returns bigint language plpgsql security definer set search_path = public as $$
declare lv integer := public.mod_level(token); bid bigint;
begin
  perform public.mod_require(token, 2);
  if public.tetris_staff_level(target) >= lv then raise exception 'You can''t act on staff at or above your own level.'; end if;
  if ban_scope not in ('chat', 'all') then raise exception 'Unknown ban scope.'; end if;
  if lv < 3 and (minutes is null or minutes > 10080 or ban_scope = 'all') then raise exception 'Moderators can mute or ban from chat for up to 7 days. Ask an admin for more.'; end if;
  insert into public.tetris_bans (user_id, scope, reason, expires_at, created_by)
    values (target, ban_scope, left(coalesce(why, ''), 300), case when minutes is null then null else now() + make_interval(mins => minutes) end, public.mod_actor(token))
    returning id into bid;
  delete from public.tetris_lobbies where host_id = target and ban_scope = 'all';
  perform public.mod_log_action(token, case when minutes is not null and minutes <= 60 then 'kick/timeout' else 'ban' end, target,
    jsonb_build_object('minutes', minutes, 'scope', ban_scope, 'reason', why));
  return bid;
end $$;

create or replace function public.mod_unban(token text, ban bigint) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  perform public.mod_require(token, 2);
  update public.tetris_bans set lifted = true where id = ban returning user_id into uid;
  perform public.mod_log_action(token, 'lift ban', uid, jsonb_build_object('ban', ban));
end $$;

-- admin+: wipe someone's public chat messages
create or replace function public.mod_purge_messages(token text, target uuid) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.mod_require(token, 3);
  update public.tetris_chat set deleted = true, body = '[removed by staff]', deleted_by = public.mod_actor(token) where user_id = target and not deleted;
  get diagnostics n = row_count;
  perform public.mod_log_action(token, 'purge messages', target, jsonb_build_object('count', n));
  return n;
end $$;

-- admin+: reset a profile's name, picture, banner, bio and tags (for offensive content)
create or replace function public.mod_reset_profile(token text, target uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.mod_require(token, 3);
  if public.tetris_staff_level(target) >= public.mod_level(token) then raise exception 'You can''t act on staff at or above your own level.'; end if;
  update public.tetris_profiles set name = 'Player', avatar = null, banner = null, bio = '', tags = '{}', status = '' where id = target;
  perform public.mod_log_action(token, 'reset profile', target, null);
end $$;

-- admin+: lock the chat, slow mode, message of the day
create or replace function public.mod_chat_settings(token text, chat_room text, is_locked boolean, slow integer, message text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.mod_require(token, 3);
  insert into public.tetris_chat_settings (room, locked, slow_seconds, motd) values (chat_room, is_locked, greatest(0, least(600, slow)), left(coalesce(message, ''), 200))
    on conflict (room) do update set locked = excluded.locked, slow_seconds = excluded.slow_seconds, motd = excluded.motd;
  perform public.mod_log_action(token, 'chat settings', null, jsonb_build_object('room', chat_room, 'locked', is_locked, 'slow', slow, 'motd', message));
end $$;

-- admin+: the word filter
create or replace function public.mod_filter(token text) returns setof text language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mod_require(token, 3);
  return query select word from public.tetris_chat_filter order by word;
end $$;
create or replace function public.mod_filter_set(token text, filter_word text, add_it boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.mod_require(token, 3);
  if add_it then insert into public.tetris_chat_filter (word) values (lower(trim(filter_word))) on conflict do nothing;
  else delete from public.tetris_chat_filter where word = lower(trim(filter_word)); end if;
  perform public.mod_log_action(token, case when add_it then 'filter add' else 'filter remove' end, null, jsonb_build_object('word', filter_word));
end $$;

-- Roles: admins can make helpers and moderators, devs can also make admins, the master can make anyone dev.
create or replace function public.mod_set_role(token text, target uuid, new_role text) returns void language plpgsql security definer set search_path = public as $$
declare lv integer := public.mod_level(token); need integer;
begin
  perform public.mod_require(token, 3);
  need := case new_role when 'helper' then 3 when 'moderator' then 3 when 'admin' then 4 when 'dev' then 5 else 3 end;
  if new_role is not null and new_role not in ('helper', 'moderator', 'admin', 'dev') then raise exception 'Unknown role.'; end if;
  if lv < need then raise exception 'You can''t give out that role.'; end if;
  if public.tetris_staff_level(target) >= lv then raise exception 'You can''t change the role of staff at or above your own level.'; end if;
  update public.tetris_profiles set role = new_role where id = target;
  insert into public.tetris_notifications (to_id, from_id, kind) select target, target, 'staff' where new_role is not null;
  perform public.mod_log_action(token, 'set role', target, jsonb_build_object('role', new_role));
end $$;

-- helper+: find players; details include role, bans, reports against them and recent messages
create or replace function public.mod_users(token text, q text) returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mod_require(token, 1);
  return query select jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'role', p.role, 'xp', p.xp, 'created_at', p.created_at, 'last_seen', p.last_seen,
      'bans', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'scope', b.scope, 'reason', b.reason, 'expires_at', b.expires_at, 'lifted', b.lifted, 'created_by', b.created_by, 'created_at', b.created_at) order by b.created_at desc)
        from public.tetris_bans b where b.user_id = p.id), '[]'::jsonb),
      'reports', (select count(*) from public.tetris_reports r where r.target_user = p.id and not r.resolved),
      'messages', (select count(*) from public.tetris_chat c where c.user_id = p.id))
    from public.tetris_profiles p
    where q is null or q = '' or p.name ilike '%' || q || '%' or p.id::text = q or p.role is not null and q = '@staff'
    order by (p.role is not null) desc, p.last_seen desc limit 50;
end $$;

create or replace function public.mod_user_messages(token text, target uuid) returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mod_require(token, 1);
  return query select jsonb_build_object('id', id, 'body', body, 'deleted', deleted, 'created_at', created_at) from public.tetris_chat
    where user_id = target order by id desc limit 50;
end $$;

-- dev+: the audit log
create or replace function public.mod_audit(token text) returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mod_require(token, 4);
  return query select jsonb_build_object('id', l.id, 'actor', l.actor, 'action', l.action, 'detail', l.detail, 'created_at', l.created_at,
      'target', case when p.id is null then null else jsonb_build_object('id', p.id, 'name', p.name) end)
    from public.tetris_mod_log l left join public.tetris_profiles p on p.id = l.target order by l.id desc limit 300;
end $$;

-- The caller's own active ban, if any (so the page can say why they can't post).
create or replace function public.my_ban() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('scope', scope, 'reason', reason, 'expires_at', expires_at) from public.tetris_bans
  where user_id = auth.uid() and not lifted and (expires_at is null or expires_at > now()) order by (scope = 'all') desc, expires_at desc nulls first limit 1;
$$;

/* ---------- bans reach the rest of the site ---------- */
drop policy if exists "runs insert own" on public.tetris_runs;
create policy "runs insert own" on public.tetris_runs for insert with check (auth.uid() = user_id and not public.tetris_is_banned(auth.uid(), 'all'));
drop policy if exists "lobbies host insert" on public.tetris_lobbies;
create policy "lobbies host insert" on public.tetris_lobbies for insert with check (auth.uid() = host_id and not public.tetris_is_banned(auth.uid(), 'all'));
drop policy if exists "lobbies host update" on public.tetris_lobbies;
create policy "lobbies host update" on public.tetris_lobbies for update using (auth.uid() = host_id) with check (auth.uid() = host_id and not public.tetris_is_banned(auth.uid(), 'all'));
drop policy if exists "notes send" on public.tetris_notifications;
create policy "notes send" on public.tetris_notifications for insert with check (auth.uid() = from_id and to_id <> from_id and kind in ('friend_request', 'friend_accept', 'invite', 'mention') and not public.tetris_is_banned(auth.uid(), 'all'));
drop policy if exists "friends request" on public.tetris_friends;
create policy "friends request" on public.tetris_friends for insert with check (auth.uid() = requester and status = 'pending' and not public.tetris_is_banned(auth.uid(), 'all'));

/* ---------- live updates for the public chat ---------- */
do $$ begin
  begin alter publication supabase_realtime add table public.tetris_chat; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tetris_chat_reactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tetris_chat_settings; exception when duplicate_object then null; end;
end $$;

-- Functions are callable by signed-in players (each checks permissions itself); internal helpers are not.
revoke all on function public.mod_new_session() from public, anon, authenticated;
revoke all on function public.mod_log_action(text, text, uuid, jsonb) from public, anon, authenticated;
