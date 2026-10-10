-- Adds Battleships and Chess (run once, after 2026-10-10-pong.sql). A fresh project doesn't need this:
-- tetris-schema.sql already includes it.

-- Featured achievements: up to 3 per game, four games.
alter table public.tetris_profiles drop constraint if exists tetris_profiles_featured_check;
alter table public.tetris_profiles add constraint tetris_profiles_featured_check check (cardinality(featured) <= 12);

alter table public.tetris_runs drop constraint if exists tetris_runs_game_check;
alter table public.tetris_runs add constraint tetris_runs_game_check check (game in ('tetris', 'pong', 'battleships', 'chess'));
alter table public.tetris_runs drop constraint if exists tetris_runs_mode_check;
alter table public.tetris_runs add constraint tetris_runs_mode_check check (mode in ('marathon', 'sprint', 'ultra', 'dig', 'survival', 'versus', 'pong', 'battleships', 'chess'));

alter table public.tetris_lobbies drop constraint if exists tetris_lobbies_game_check;
alter table public.tetris_lobbies add constraint tetris_lobbies_game_check check (game in ('tetris', 'pong', 'battleships', 'chess'));
