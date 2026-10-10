BALCADE / TETRIS — GAPLESS MENU LOOP, OCT 2026
================================================

Balcade_Cinematic_60s_MenuReady.wav
  Revised 60.000-second cinematic master. Last 1.7 seconds blend into the
  final 1.7 seconds of the menu loop, allowing a seamless handoff.

Balcade_Menu_Ambient_Seamless_Loop.wav
  21.333 seconds of ambience based on the unused final third of runner2088.
  Synths extracted and softened; drums strongly attenuated; subtle synthetic
  stereo reverb, VHS haze and electrical hum. No programmed fade-out.
  Use WAV for gapless looping; MP3 may add encoder padding on some engines.

Balcade_Cinematic_Plus_2_Loops_Preview.wav / .mp3
  Handoff preview: one 60-second cinematic followed by the loop played twice.

IMPLEMENTATION
  Begin cinematic at t=0.000.
  At t=60.000, play Menu_Ambient_Seamless_Loop.wav from its first sample.
  Loop it indefinitely. On menu mute, fade menu channel volume to zero.
  For reliable gapless playback, keep the WAV decoded / loaded in memory and
  schedule the next track on the audio clock; do NOT append silence between.

SONG CREDIT (required if distributing the temp audio)
  runner2088 by wekont, Free Music Archive, edited into an ambient loop.
  https://freemusicarchive.org/music/wekont/single/runner2088mp3/
  CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
  Changes: extracted final-third synth material, reduced percussion, equalized,
  applied loop seam and synthetic stereo effects, crossfaded cinematic ending.
