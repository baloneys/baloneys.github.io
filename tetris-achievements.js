// tetris-achievements.js: Tetris's achievements (the engine is games-achievements.js).
//
// tetris.js reports what happens (TetrisAchievements.event(name, data)); the handlers below decide what unlocks.
// API (window.TetrisAchievements): see games-achievements.js.
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'basics', name: 'Getting started' },
    { id: 'score', name: 'Score and levels' },
    { id: 'lifetime', name: 'Lifetime' },
    { id: 'streak', name: 'Streaks' },
    { id: 'modes', name: 'Game types' },
    { id: 'skulls', name: 'Skulls and power-ups' },
    { id: 'versus', name: 'Versus' }
  ];

  // goal + stat: a lifetime counter with a progress bar. secret: name and description hidden until unlocked.
  var LIST = [
    { id: 'first_clear', cat: 'basics', tier: 'bronze', icon: 'line', name: 'First Blood', desc: 'Clear your first line.' },
    { id: 'first_tetris', cat: 'basics', tier: 'bronze', icon: 'tetris', name: 'Tetris!', desc: 'Clear four lines with one piece.' },
    { id: 'b2b', cat: 'basics', tier: 'silver', icon: 'chain', name: 'Back to Back', desc: 'Score two Tetrises in a row.' },
    { id: 'combo5', cat: 'basics', tier: 'silver', icon: 'chain', name: 'Combo Chain', desc: 'Keep a combo going for 5 pieces.' },
    { id: 'perfect', cat: 'basics', tier: 'gold', icon: 'sparkle', name: 'Clean Slate', desc: 'Clear lines and leave the well completely empty.' },
    { id: 'score10k', cat: 'score', tier: 'bronze', icon: 'star', name: 'Five Digits', desc: 'Score 10,000 points in one game.' },
    { id: 'score100k', cat: 'score', tier: 'gold', icon: 'gem', name: 'Six Digits', desc: 'Score 100,000 points in one game.' },
    { id: 'level10', cat: 'score', tier: 'silver', icon: 'rocket', name: 'Double Digits', desc: 'Reach level 10.' },
    { id: 'level20', cat: 'score', tier: 'gold', icon: 'rocket', name: 'Terminal Velocity', desc: 'Reach level 20.' },
    { id: 'lines100', cat: 'lifetime', tier: 'bronze', icon: 'line', name: 'Century', desc: 'Clear 100 lines in total.', stat: 'lines', goal: 100 },
    { id: 'lines1000', cat: 'lifetime', tier: 'gold', icon: 'line', name: 'Line Cook', desc: 'Clear 1,000 lines in total.', stat: 'lines', goal: 1000 },
    { id: 'tetris50', cat: 'lifetime', tier: 'silver', icon: 'tetris', name: 'Tetris Enthusiast', desc: 'Score 50 Tetrises in total.', stat: 'tetrises', goal: 50 },
    { id: 'games25', cat: 'lifetime', tier: 'bronze', icon: 'pad', name: 'Regular', desc: 'Finish 25 games.', stat: 'games', goal: 25 },
    { id: 'games100', cat: 'lifetime', tier: 'silver', icon: 'pad', name: 'Furniture', desc: 'Finish 100 games.', stat: 'games', goal: 100 },
    { id: 'streak5', cat: 'streak', tier: 'bronze', icon: 'flame', name: 'Warming Up', desc: 'Reach a 5x streak.' },
    { id: 'streak10', cat: 'streak', tier: 'silver', icon: 'flame', name: 'On Fire', desc: 'Reach a 10x streak and set the stack alight.' },
    { id: 'streak20', cat: 'streak', tier: 'gold', icon: 'flame', name: 'Rainbow Road', desc: 'Reach a 20x streak and burn the whole well.' },
    { id: 'streak30', cat: 'streak', tier: 'platinum', icon: 'bolt', name: 'Overdrive', desc: 'Reach a 30x streak.' },
    { id: 'streak50', cat: 'streak', tier: 'platinum', icon: 'sparkle', name: 'Supernova', desc: 'Reach a 50x streak.', secret: true },
    { id: 'sprint', cat: 'modes', tier: 'bronze', icon: 'flag', name: 'Sprinter', desc: 'Finish Sprint 40.' },
    { id: 'sprint60', cat: 'modes', tier: 'gold', icon: 'hourglass', name: 'Speed Demon', desc: 'Finish Sprint 40 in under a minute.' },
    { id: 'ultra30k', cat: 'modes', tier: 'silver', icon: 'clock', name: 'Ultra Instinct', desc: 'Score 30,000 in Ultra 2:00.' },
    { id: 'dig', cat: 'modes', tier: 'bronze', icon: 'shovel', name: 'Excavator', desc: 'Finish Dig.' },
    { id: 'dig45', cat: 'modes', tier: 'gold', icon: 'shovel', name: 'Mole', desc: 'Finish Dig in under 45 seconds.' },
    { id: 'survival3', cat: 'modes', tier: 'silver', icon: 'heart', name: 'Survivor', desc: 'Last 3 minutes in Survival.' },
    { id: 'skull1', cat: 'skulls', tier: 'bronze', icon: 'skull', name: 'Skull Collector', desc: 'Play a game with a skull on.' },
    { id: 'skull5', cat: 'skulls', tier: 'silver', icon: 'skull', name: 'Iron Will', desc: 'Play with 5 or more skulls at once.' },
    { id: 'mult3', cat: 'skulls', tier: 'gold', icon: 'crown', name: 'Triple Threat', desc: 'Play at a ×3 score multiplier or higher.' },
    { id: 'lightsout10', cat: 'skulls', tier: 'silver', icon: 'moon', name: 'In the Dark', desc: 'Clear 10 lines in one game with Lights Out.' },
    { id: 'birthday', cat: 'skulls', tier: 'bronze', icon: 'cake', name: 'Party Animal', desc: 'Clear a line at a Block Birthday Party.', secret: true },
    { id: 'secondwind', cat: 'skulls', tier: 'bronze', icon: 'heart', name: 'Not Today', desc: 'Get saved by Second Wind.', secret: true },
    { id: 'bomb', cat: 'skulls', tier: 'bronze', icon: 'bomb', name: 'Demolition', desc: 'Set off a Bomb.' },
    { id: 'starbomb', cat: 'skulls', tier: 'bronze', icon: 'star', name: 'Shooting Star', desc: 'Set off a Star Bomb.' },
    { id: 'quake', cat: 'skulls', tier: 'bronze', icon: 'quake', name: 'Earthshaker', desc: 'Trigger a Quake.' },
    { id: 'vs_win', cat: 'versus', tier: 'silver', icon: 'sword', name: 'Victor', desc: 'Win an online match.' },
    { id: 'vs_win5', cat: 'versus', tier: 'gold', icon: 'trophy', name: 'Champion', desc: 'Win 5 online matches.', stat: 'wins', goal: 5 },
    { id: 'elim_win', cat: 'versus', tier: 'gold', icon: 'crown', name: 'Last One Standing', desc: 'Win an online Elimination match.' },
    { id: 'freeze', cat: 'versus', tier: 'bronze', icon: 'ice', name: 'Cold Shoulder', desc: 'Freeze an opponent.' },
    { id: 'shell', cat: 'versus', tier: 'bronze', icon: 'shell', name: 'Blue Shell', desc: 'Hit the leader with a Blue Shell.' }
  ];
  function gameInfo(d) { return d || {}; }

  window.TetrisAchievements = window.GameAchievements.create({
    game: 'tetris',
    storeUnlocks: 'tetris_achievements', storeStats: 'tetris_ach_stats',
    categories: CATEGORIES, list: LIST,
    emptyText: 'Nothing unlocked yet. Your first line clear is a good start.',
    // Everything tetris.js reports. Only local players' events arrive here.
    handlers: function (A) {
      var unlock = A.unlock, addStat = A.addStat;
      return {
        // a piece locked: { cleared, tetris, b2b, combo, perfect, score, level, streak, powers[], lightsOut, birthday, lightsLines }
        lock: function (d) {
          if (d.cleared > 0) unlock('first_clear');
          if (d.tetris) { unlock('first_tetris'); addStat('tetrises', 1); }
          if (d.b2b) unlock('b2b');
          if (d.combo >= 5) unlock('combo5');
          if (d.perfect) unlock('perfect');
          if (d.cleared > 0) addStat('lines', d.cleared);
          if (d.score >= 10000) unlock('score10k');
          if (d.score >= 100000) unlock('score100k');
          if (d.level >= 10) unlock('level10');
          if (d.level >= 20) unlock('level20');
          if (d.streak >= 5) unlock('streak5');
          if (d.streak >= 10) unlock('streak10');
          if (d.streak >= 20) unlock('streak20');
          if (d.streak >= 30) unlock('streak30');
          if (d.streak >= 50) unlock('streak50');
          (d.powers || []).forEach(function (k) {
            if (k === 'bomb') unlock('bomb');
            else if (k === 'starbomb') unlock('starbomb');
            else if (k === 'quake') unlock('quake');
          });
          if (d.birthday && d.cleared > 0) unlock('birthday');
          if (d.lightsLines >= 10) unlock('lightsout10');
        },
        // a game started: { skulls, multiplier }
        start: function (d) {
          d = gameInfo(d);
          if (d.skulls >= 1) unlock('skull1');
          if (d.skulls >= 5) unlock('skull5');
          if (d.multiplier >= 3) unlock('mult3');
        },
        // a solo game finished: { finish: 'sprint'|'dig'|'time'|null, gameType, elapsed, score }
        solo: function (d) {
          d = gameInfo(d);
          addStat('games', 1);
          if (d.finish === 'sprint') { unlock('sprint'); if (d.elapsed < 60) unlock('sprint60'); }
          if (d.finish === 'dig') { unlock('dig'); if (d.elapsed < 45) unlock('dig45'); }
          if (d.gameType === 'ultra' && d.score >= 30000) unlock('ultra30k');
          if (d.gameType === 'survival' && d.elapsed >= 180) unlock('survival3');
        },
        // still alive in Survival: { elapsed }
        survival: function (d) { if (d && d.elapsed >= 180) unlock('survival3'); },
        // a versus round finished for us: { won, online, elimination }
        versus: function (d) {
          d = gameInfo(d);
          addStat('games', 1);
          if (d.won && d.online) { unlock('vs_win'); addStat('wins', 1); if (d.elimination) unlock('elim_win'); }
        },
        freeze: function () { unlock('freeze'); },
        shell: function () { unlock('shell'); },
        secondwind: function () { unlock('secondwind'); }
      };
    }
  });
})();
