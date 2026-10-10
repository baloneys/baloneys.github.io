// chess-achievements.js: Chess's achievements (the engine is games-achievements.js).
//
// chess.js reports what happens (ChessAchievements.event(name, data)); the handlers below decide what unlocks.
// Moves only count when they're this browser's player's (in local games, both sides' moves count for "moves"
// achievements, but wins don't). API (window.ChessAchievements): see games-achievements.js.
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'basics', name: 'Getting started' },
    { id: 'cpu', name: 'Beat the machine' },
    { id: 'moves', name: 'Special moves' },
    { id: 'skill', name: 'Brilliancies' },
    { id: 'lifetime', name: 'Lifetime' },
    { id: 'online', name: 'Online' }
  ];

  var LIST = [
    { id: 'first_capture', cat: 'basics', tier: 'bronze', icon: 'sword', name: 'First Blood', desc: 'Capture a piece.' },
    { id: 'first_check', cat: 'basics', tier: 'bronze', icon: 'bolt', name: 'Check!', desc: 'Put the enemy king in check.' },
    { id: 'first_win', cat: 'basics', tier: 'bronze', icon: 'trophy', name: 'Winner', desc: 'Win a game.' },
    { id: 'local', cat: 'basics', tier: 'bronze', icon: 'pad', name: 'Over the Board', desc: 'Finish a two-player game on one screen.' },
    { id: 'easy_win', cat: 'cpu', tier: 'bronze', icon: 'pad', name: 'Beginner\'s Luck', desc: 'Beat the Easy CPU.' },
    { id: 'normal_win', cat: 'cpu', tier: 'silver', icon: 'sword', name: 'Club Player', desc: 'Beat the Normal CPU.' },
    { id: 'hard_win', cat: 'cpu', tier: 'gold', icon: 'crown', name: 'Grandmaster', desc: 'Beat the Hard CPU.' },
    { id: 'hard_black', cat: 'cpu', tier: 'platinum', icon: 'moon', name: 'Dark Horse', desc: 'Beat the Hard CPU playing Black.' },
    { id: 'castle', cat: 'moves', tier: 'bronze', icon: 'shell', name: 'Safe Keeping', desc: 'Castle.' },
    { id: 'castle_long', cat: 'moves', tier: 'bronze', icon: 'shell', name: 'The Long Way', desc: 'Castle queenside.' },
    { id: 'en_passant', cat: 'moves', tier: 'silver', icon: 'quake', name: 'En Passant', desc: 'Capture en passant.' },
    { id: 'promote', cat: 'moves', tier: 'bronze', icon: 'star', name: 'Promotion', desc: 'Promote a pawn.' },
    { id: 'underpromote', cat: 'moves', tier: 'silver', icon: 'sparkle', name: 'Not a Queen', desc: 'Promote a pawn to a knight, rook or bishop.' },
    { id: 'scholar', cat: 'skill', tier: 'gold', icon: 'flame', name: 'Speedrun', desc: 'Checkmate in 10 of your own moves or fewer.' },
    { id: 'quick_mate', cat: 'skill', tier: 'silver', icon: 'hourglass', name: 'Quick Mate', desc: 'Checkmate in 25 of your own moves or fewer.' },
    { id: 'knight_mate', cat: 'skill', tier: 'gold', icon: 'chain', name: 'Knight Rider', desc: 'Deliver checkmate with a knight.' },
    { id: 'pawn_mate', cat: 'skill', tier: 'platinum', icon: 'gem', name: 'Pawn Storm', desc: 'Deliver checkmate with a pawn.' },
    { id: 'comeback', cat: 'skill', tier: 'gold', icon: 'heart', name: 'Swindle', desc: 'Win after being down 5 or more points of material.' },
    { id: 'time_win', cat: 'skill', tier: 'silver', icon: 'clock', name: 'Flag Fall', desc: 'Win on time.' },
    { id: 'stalemate', cat: 'skill', tier: 'bronze', icon: 'lock', name: 'Stalemate', desc: 'Draw by stalemate.', secret: true },
    { id: 'captures100', cat: 'lifetime', tier: 'bronze', icon: 'sword', name: 'Collector', desc: 'Capture 100 pieces in total.', stat: 'captures', goal: 100 },
    { id: 'games10', cat: 'lifetime', tier: 'bronze', icon: 'pad', name: 'Regular', desc: 'Finish 10 games.', stat: 'games', goal: 10 },
    { id: 'wins25', cat: 'lifetime', tier: 'gold', icon: 'trophy', name: 'Rated Up', desc: 'Win 25 games.', stat: 'wins', goal: 25 },
    { id: 'online_win', cat: 'online', tier: 'silver', icon: 'sword', name: 'Correspondence', desc: 'Win an online game.' },
    { id: 'online_win5', cat: 'online', tier: 'gold', icon: 'crown', name: 'Titled Player', desc: 'Win 5 online games.', stat: 'onlineWins', goal: 5 }
  ];

  window.ChessAchievements = window.GameAchievements.create({
    game: 'chess',
    storeUnlocks: 'chess_achievements', storeStats: 'chess_ach_stats',
    categories: CATEGORIES, list: LIST,
    emptyText: 'Nothing unlocked yet. Capture a piece to get started.',
    handlers: function (A) {
      var unlock = A.unlock, addStat = A.addStat;
      return {
        // you moved: { capture, check, castle: 'k'|'q'|null, ep, promo }
        move: function (d) {
          if (d.capture) { unlock('first_capture'); addStat('captures', 1); }
          if (d.ep) unlock('en_passant');
          if (d.check) unlock('first_check');
          if (d.castle) unlock('castle');
          if (d.castle === 'q') unlock('castle_long');
          if (d.promo) { unlock('promote'); if (d.promo !== 'q') unlock('underpromote'); }
        },
        // a game ended: { mode, won (true/false/null for draws and local), method: 'mate'|'time'|'resign'|'draw'|'stalemate'|...,
        //   difficulty, color, myMoves, matePiece, worstDeficit (centipawns behind at worst) }
        game: function (d) {
          addStat('games', 1);
          if (d.method === 'stalemate') unlock('stalemate');
          if (d.mode === 'local') { unlock('local'); return; }
          if (!d.won) return;
          unlock('first_win');
          addStat('wins', 1);
          if (d.mode === 'cpu') {
            if (d.difficulty === 'easy') unlock('easy_win');
            if (d.difficulty === 'normal') unlock('normal_win');
            if (d.difficulty === 'hard' || d.difficulty === 'ultra') { unlock('hard_win'); if (d.color === 'b') unlock('hard_black'); }
          }
          if (d.mode === 'online') { unlock('online_win'); addStat('onlineWins', 1); }
          if (d.method === 'mate') {
            if (d.myMoves <= 10) unlock('scholar');
            if (d.myMoves <= 25) unlock('quick_mate');
            if (d.matePiece === 'n') unlock('knight_mate');
            if (d.matePiece === 'p') unlock('pawn_mate');
          }
          if (d.method === 'time') unlock('time_win');
          if (d.worstDeficit >= 500) unlock('comeback');
        }
      };
    }
  });
})();
