// games-config.js: where Tetris and Pong keep profiles, friends, invites, achievements, the public leaderboards
// and the lobby finder (one Supabase project for the whole site).
//
// Fill these in from the Supabase dashboard (Project Settings -> API): the Project URL and the "anon public"
// key. The anon key is designed to be public; row level security in supabase/tetris-schema.sql decides who
// can read and write what. Leave them empty and the social features stay switched off.
window.GAMES_SUPABASE = {
  url: 'https://omumcgompiqmrfxqcezw.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdW1jZ29tcGlxbXJmeHFjZXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NzUwNjQsImV4cCI6MjEwNzE1MTA2NH0.F90ZvVeSf_0T1WO7Mte29sqBH84KvNzPhSC67Qa7zF4'
};
