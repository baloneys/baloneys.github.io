// battleships-achievements.js: Battleships' achievements (the engine is games-achievements.js).
//
// battleships.js reports what happens (BattleshipsAchievements.event(name, data)); the handlers below decide
// what unlocks. API (window.BattleshipsAchievements): see games-achievements.js.
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'basics', name: 'Getting started' },
    { id: 'cpu', name: 'Beat the machine' },
    { id: 'skill', name: 'Gunnery' },
    { id: 'lifetime', name: 'Lifetime' },
    { id: 'online', name: 'Online' }
  ];

  var LIST = [
    { id: 'first_hit', cat: 'basics', tier: 'bronze', icon: 'bolt', name: 'Direct Hit', desc: 'Land your first hit.' },
    { id: 'first_sink', cat: 'basics', tier: 'bronze', icon: 'bomb', name: 'Sunk!', desc: 'Sink an enemy ship.' },
    { id: 'first_win', cat: 'basics', tier: 'bronze', icon: 'trophy', name: 'Admiral', desc: 'Win a battle.' },
    { id: 'easy_win', cat: 'cpu', tier: 'bronze', icon: 'pad', name: 'Target Practice', desc: 'Beat the Easy CPU.' },
    { id: 'hard_win', cat: 'cpu', tier: 'silver', icon: 'crown', name: 'Fleet Admiral', desc: 'Beat the Hard CPU.' },
    { id: 'hard_flawless', cat: 'cpu', tier: 'platinum', icon: 'gem', name: 'Ghost Fleet', desc: 'Beat the Hard CPU without losing a ship.' },
    { id: 'untouched', cat: 'skill', tier: 'gold', icon: 'sparkle', name: 'Untouchable', desc: 'Win without the enemy landing a single hit.' },
    { id: 'no_losses', cat: 'skill', tier: 'silver', icon: 'heart', name: 'Full Strength', desc: 'Win without losing a ship.' },
    { id: 'last_ship', cat: 'skill', tier: 'silver', icon: 'flag', name: 'Last Ship Standing', desc: 'Win with only one ship left afloat.' },
    { id: 'sharp', cat: 'skill', tier: 'silver', icon: 'star', name: 'Sharpshooter', desc: 'Win with at least 60% accuracy.' },
    { id: 'deadeye', cat: 'skill', tier: 'gold', icon: 'gem', name: 'Deadeye', desc: 'Win with at least 80% accuracy.' },
    { id: 'streak5', cat: 'skill', tier: 'bronze', icon: 'chain', name: 'On Target', desc: 'Land 5 hits in a row.' },
    { id: 'streak10', cat: 'skill', tier: 'gold', icon: 'flame', name: 'Broadside', desc: 'Land 10 hits in a row.' },
    { id: 'quick', cat: 'skill', tier: 'gold', icon: 'hourglass', name: 'Blitz', desc: 'Win in 35 shots or fewer.' },
    { id: 'carrier_first', cat: 'skill', tier: 'bronze', icon: 'shell', name: 'Big Game', desc: 'Make the Carrier the first ship you sink.' },
    { id: 'sinks25', cat: 'lifetime', tier: 'bronze', icon: 'bomb', name: 'Depth Charge', desc: 'Sink 25 ships in total.', stat: 'sinks', goal: 25 },
    { id: 'sinks100', cat: 'lifetime', tier: 'gold', icon: 'bomb', name: 'Davy Jones', desc: 'Sink 100 ships in total.', stat: 'sinks', goal: 100 },
    { id: 'battles10', cat: 'lifetime', tier: 'bronze', icon: 'pad', name: 'Sea Legs', desc: 'Finish 10 battles.', stat: 'battles', goal: 10 },
    { id: 'wins25', cat: 'lifetime', tier: 'gold', icon: 'trophy', name: 'Rule the Waves', desc: 'Win 25 battles.', stat: 'wins', goal: 25 },
    { id: 'online_win', cat: 'online', tier: 'silver', icon: 'sword', name: 'Naval Duel', desc: 'Win an online battle.' },
    { id: 'skull_try', cat: 'skill', tier: 'bronze', icon: 'skull', name: 'Skull Curious', desc: 'Start a battle with a skull on.' },
    { id: 'skull_win', cat: 'skill', tier: 'silver', icon: 'skull', name: 'Bone Crusher', desc: 'Win a battle with 2 or more skulls on.' },
    { id: 'online_win5', cat: 'online', tier: 'gold', icon: 'crown', name: 'Commodore', desc: 'Win 5 online battles.', stat: 'onlineWins', goal: 5 }
  ];

  window.BattleshipsAchievements = window.GameAchievements.create({
    game: 'battleships',
    storeUnlocks: 'bs_achievements', storeStats: 'bs_ach_stats',
    categories: CATEGORIES, list: LIST,
    emptyText: 'Nothing unlocked yet. Land a hit to get started.',
    handlers: function (A) {
      var unlock = A.unlock, addStat = A.addStat;
      return {
        // you fired: { hit, sunk (ship id or null), streak (hits in a row), firstSink }
        shot: function (d) {
          if (d.hit) unlock('first_hit');
          if (d.streak >= 5) unlock('streak5');
          if (d.streak >= 10) unlock('streak10');
          if (d.sunk) { unlock('first_sink'); addStat('sinks', 1); if (d.firstSink && d.sunk === 'carrier') unlock('carrier_first'); }
        },
        // a battle ended: { mode: 'cpu'|'online', won, difficulty, shots, accuracy (0-100), shipsLost, enemyHits }
        start: function (d) { if (d.skulls > 0) unlock('skull_try'); },
        battle: function (d) {
          addStat('battles', 1);
          if (!d.won) return;
          unlock('first_win');
          if (d.skulls >= 2) unlock('skull_win');
          addStat('wins', 1);
          if (d.mode === 'cpu' && d.difficulty === 'easy') unlock('easy_win');
          if (d.mode === 'cpu' && (d.difficulty === 'hard' || d.difficulty === 'ultra')) { unlock('hard_win'); if (d.shipsLost === 0) unlock('hard_flawless'); }
          if (d.mode === 'online') { unlock('online_win'); addStat('onlineWins', 1); }
          if (d.enemyHits === 0) unlock('untouched');
          if (d.shipsLost === 0) unlock('no_losses');
          if (d.shipsLost === 4) unlock('last_ship');
          if (d.accuracy >= 60) unlock('sharp');
          if (d.accuracy >= 80) unlock('deadeye');
          if (d.shots <= 35) unlock('quick');
        }
      };
    }
  });
})();
