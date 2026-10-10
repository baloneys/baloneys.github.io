// pong-achievements.js: Pong's achievements (the engine is games-achievements.js).
//
// pong.js reports what happens (PongAchievements.event(name, data)); the handlers below decide what unlocks.
// Only things this browser's player did count: in local two-player matches, rallies and matches played count,
// but wins don't (nobody can tell which of you is "you").
// API (window.PongAchievements): see games-achievements.js.
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'basics', name: 'Getting started' },
    { id: 'cpu', name: 'Beat the machine' },
    { id: 'rally', name: 'Rallies' },
    { id: 'skill', name: 'Skill shots' },
    { id: 'lifetime', name: 'Lifetime' },
    { id: 'online', name: 'Online' },
    { id: 'style', name: 'Style' }
  ];

  // goal + stat: a lifetime counter with a progress bar. secret: name and description hidden until unlocked.
  var LIST = [
    { id: 'first_point', cat: 'basics', tier: 'bronze', icon: 'star', name: 'On the Board', desc: 'Score your first point.' },
    { id: 'first_win', cat: 'basics', tier: 'bronze', icon: 'trophy', name: 'First Win', desc: 'Win a match.' },
    { id: 'local', cat: 'basics', tier: 'bronze', icon: 'pad', name: 'Couch Co-op', desc: 'Finish a two-player match on one keyboard.' },
    { id: 'easy_win', cat: 'cpu', tier: 'bronze', icon: 'pad', name: 'Warm-Up', desc: 'Beat the Easy CPU.' },
    { id: 'normal_win', cat: 'cpu', tier: 'silver', icon: 'sword', name: 'Fair Fight', desc: 'Beat the Normal CPU.' },
    { id: 'hard_win', cat: 'cpu', tier: 'gold', icon: 'crown', name: 'Machine Breaker', desc: 'Beat the Hard CPU.' },
    { id: 'hard_long', cat: 'cpu', tier: 'platinum', icon: 'gem', name: 'Marathon Man', desc: 'Beat the Hard CPU in a first-to-11 match.' },
    { id: 'flawless', cat: 'skill', tier: 'gold', icon: 'sparkle', name: 'Flawless', desc: 'Win a first-to-7 (or longer) match without conceding a point.' },
    { id: 'comeback', cat: 'skill', tier: 'silver', icon: 'heart', name: 'Comeback Kid', desc: 'Win a match after being 3 points behind.' },
    { id: 'edge', cat: 'skill', tier: 'bronze', icon: 'bolt', name: 'Edge Case', desc: 'Return the ball off the very tip of your paddle.' },
    { id: 'topspeed', cat: 'skill', tier: 'silver', icon: 'rocket', name: 'Sound Barrier', desc: 'Return the ball at its top speed.' },
    { id: 'rally10', cat: 'rally', tier: 'bronze', icon: 'chain', name: 'Keep It Up', desc: 'Reach a 10-hit rally.' },
    { id: 'rally25', cat: 'rally', tier: 'silver', icon: 'chain', name: 'Back and Forth', desc: 'Reach a 25-hit rally.' },
    { id: 'rally50', cat: 'rally', tier: 'gold', icon: 'flame', name: 'Wall of Paddles', desc: 'Reach a 50-hit rally.' },
    { id: 'rally69', cat: 'rally', tier: 'gold', icon: 'moon', name: 'Nice', desc: 'Reach a 69-hit rally.', secret: true },
    { id: 'rally100', cat: 'rally', tier: 'platinum', icon: 'sparkle', name: 'Infinite Rally', desc: 'Reach a 100-hit rally.' },
    { id: 'points100', cat: 'lifetime', tier: 'bronze', icon: 'star', name: 'Century', desc: 'Score 100 points in total.', stat: 'points', goal: 100 },
    { id: 'points1000', cat: 'lifetime', tier: 'gold', icon: 'gem', name: 'Point Machine', desc: 'Score 1,000 points in total.', stat: 'points', goal: 1000 },
    { id: 'matches10', cat: 'lifetime', tier: 'bronze', icon: 'pad', name: 'Regular', desc: 'Finish 10 matches.', stat: 'matches', goal: 10 },
    { id: 'matches50', cat: 'lifetime', tier: 'silver', icon: 'pad', name: 'Furniture', desc: 'Finish 50 matches.', stat: 'matches', goal: 50 },
    { id: 'wins25', cat: 'lifetime', tier: 'gold', icon: 'trophy', name: 'Serial Winner', desc: 'Win 25 matches.', stat: 'wins', goal: 25 },
    { id: 'endless30', cat: 'lifetime', tier: 'silver', icon: 'hourglass', name: 'No Finish Line', desc: 'Score 30 points in one Endless match.' },
    { id: 'online_win', cat: 'online', tier: 'silver', icon: 'sword', name: 'Netplay', desc: 'Win an online match.' },
    { id: 'online_win5', cat: 'online', tier: 'gold', icon: 'crown', name: 'Ranked Up', desc: 'Win 5 online matches.', stat: 'onlineWins', goal: 5 },
    { id: 'custom_ball', cat: 'style', tier: 'bronze', icon: 'shell', name: 'Bring Your Own Ball', desc: 'Play with your own uploaded picture as the ball.' },
    { id: 'emoji_ball', cat: 'style', tier: 'bronze', icon: 'cake', name: 'Emoji Physics', desc: 'Play with an emoji as the ball.' },
    { id: 'gif_ball', cat: 'style', tier: 'bronze', icon: 'sparkle', name: 'Animated', desc: 'Play with a GIF as the ball.' }
  ];

  window.PongAchievements = window.GameAchievements.create({
    game: 'pong',
    storeUnlocks: 'pong_achievements', storeStats: 'pong_ach_stats',
    categories: CATEGORIES, list: LIST,
    emptyText: 'Nothing unlocked yet. Score a point to get started.',
    handlers: function (A) {
      var unlock = A.unlock, addStat = A.addStat;
      return {
        // a paddle returned the ball: { rally, mine, edge, top }
        hit: function (d) {
          var r = d.rally || 0;
          if (r >= 10) unlock('rally10');
          if (r >= 25) unlock('rally25');
          if (r >= 50) unlock('rally50');
          if (r >= 69) unlock('rally69');
          if (r >= 100) unlock('rally100');
          if (d.mine && d.edge) unlock('edge');
          if (d.mine && d.top) unlock('topspeed');
        },
        // a point was scored: { mine, myScore, target } (mine is false for the opponent's points, null in local matches)
        point: function (d) {
          if (d.mine) { unlock('first_point'); addStat('points', 1); }
          if (d.mine && d.target === 'inf' && d.myScore >= 30) unlock('endless30');
        },
        // a match started with this ball: { ball: 'classic' | 'builtin' | 'image' | 'gif' | 'emoji' }
        start: function (d) {
          if (d.ball === 'image') unlock('custom_ball');
          else if (d.ball === 'gif') unlock('gif_ball');
          else if (d.ball === 'emoji') unlock('emoji_ball');
        },
        // a match ended: { mode: 'cpu'|'online'|'local', won, difficulty, target, myScore, theirScore, maxDeficit }
        match: function (d) {
          addStat('matches', 1);
          if (d.mode === 'local') { unlock('local'); return; }
          if (!d.won) return;
          unlock('first_win');
          addStat('wins', 1);
          if (d.mode === 'cpu') {
            if (d.difficulty === 'easy') unlock('easy_win');
            if (d.difficulty === 'normal') unlock('normal_win');
            if (d.difficulty === 'hard' || d.difficulty === 'ultra') { unlock('hard_win'); if (d.target === '11') unlock('hard_long'); }
          }
          if (d.mode === 'online') { unlock('online_win'); addStat('onlineWins', 1); }
          if (d.theirScore === 0 && (d.target === '7' || d.target === '11')) unlock('flawless');
          if (d.maxDeficit >= 3) unlock('comeback');
        }
      };
    }
  });
})();
