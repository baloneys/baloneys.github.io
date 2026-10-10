-- Adds Pong to a database set up with the first version of tetris-schema.sql (run once, in the SQL editor).
-- A fresh project doesn't need this: tetris-schema.sql already includes it.

-- Featured achievements are 'game:id', up to 3 per game.
alter table public.tetris_profiles drop constraint if exists tetris_profiles_featured_check;
alter table public.tetris_profiles add constraint tetris_profiles_featured_check check (cardinality(featured) <= 6);

-- Runs and lobbies say which game they belong to; Pong runs carry their extras in info.
alter table public.tetris_runs add column if not exists game text not null default 'tetris';
alter table public.tetris_runs drop constraint if exists tetris_runs_game_check;
alter table public.tetris_runs add constraint tetris_runs_game_check check (game in ('tetris', 'pong'));
alter table public.tetris_runs drop constraint if exists tetris_runs_mode_check;
alter table public.tetris_runs add constraint tetris_runs_mode_check check (mode in ('marathon', 'sprint', 'ultra', 'dig', 'survival', 'versus', 'pong'));
alter table public.tetris_runs add column if not exists info jsonb;
alter table public.tetris_runs drop constraint if exists tetris_runs_info_check;
alter table public.tetris_runs add constraint tetris_runs_info_check check (info is null or (jsonb_typeof(info) = 'object' and length(info::text) < 1000));
drop index if exists public.tetris_runs_board;
create index if not exists tetris_runs_board on public.tetris_runs (game, mode, kind, skull_count, value);

alter table public.tetris_lobbies add column if not exists game text not null default 'tetris';
alter table public.tetris_lobbies drop constraint if exists tetris_lobbies_game_check;
alter table public.tetris_lobbies add constraint tetris_lobbies_game_check check (game in ('tetris', 'pong'));

-- The views list their columns when created, so rebuild them to pick up the new ones.
drop view if exists public.tetris_board;
create view public.tetris_board with (security_invoker = true) as
select r.*, p.name, p.avatar, p.equipped, p.xp
from public.tetris_runs r
join public.tetris_profiles p on p.id = r.user_id;

drop view if exists public.tetris_open_lobbies;
create view public.tetris_open_lobbies with (security_invoker = true) as
select l.*, p.equipped, p.avatar, p.xp from public.tetris_lobbies l
join public.tetris_profiles p on p.id = l.host_id
where l.updated_at > now() - interval '60 seconds';
