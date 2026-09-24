// chess.js: Chess for kanaris-beans.com. vs CPU, local 2-player, online (PeerJS).
(function () {
  'use strict';

  var G = window.Games;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* =================================================================
     Engine
     Board: 64 squares, index 0 = a8, 63 = h1. Uppercase = white, lowercase = black.
     ================================================================= */

  var FILES = 'abcdefgh';
  var START = 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR';
  var VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  function sq(r, c) { return r * 8 + c; }
  function rowOf(i) { return i >> 3; }
  function colOf(i) { return i & 7; }
  function name(i) { return FILES[colOf(i)] + (8 - rowOf(i)); }
  function colorOf(p) { return p === '.' ? null : (p === p.toUpperCase() ? 'w' : 'b'); }
  function lower(p) { return p.toLowerCase(); }

  function initial() {
    return { board: START.split(''), turn: 'w', castle: { K: true, Q: true, k: true, q: true }, ep: -1, half: 0, full: 1 };
  }

  function clone(s) {
    return { board: s.board.slice(), turn: s.turn, castle: { K: s.castle.K, Q: s.castle.Q, k: s.castle.k, q: s.castle.q }, ep: s.ep, half: s.half, full: s.full };
  }

  var KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function attacked(s, target, by) {
    var tr = rowOf(target), tc = colOf(target), b = s.board, i, r, c, p;
    // pawns
    var pr = by === 'w' ? tr + 1 : tr - 1;
    for (i = -1; i <= 1; i += 2) {
      c = tc + i;
      if (pr >= 0 && pr < 8 && c >= 0 && c < 8) {
        p = b[sq(pr, c)];
        if (p === (by === 'w' ? 'P' : 'p')) return true;
      }
    }
    for (i = 0; i < 8; i++) {
      r = tr + KNIGHT[i][0]; c = tc + KNIGHT[i][1];
      if (r >= 0 && r < 8 && c >= 0 && c < 8) { p = b[sq(r, c)]; if (p !== '.' && colorOf(p) === by && lower(p) === 'n') return true; }
      r = tr + KING[i][0]; c = tc + KING[i][1];
      if (r >= 0 && r < 8 && c >= 0 && c < 8) { p = b[sq(r, c)]; if (p !== '.' && colorOf(p) === by && lower(p) === 'k') return true; }
    }
    function ray(dirs, kinds) {
      for (var d = 0; d < dirs.length; d++) {
        var rr = tr + dirs[d][0], cc = tc + dirs[d][1];
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          var q = b[sq(rr, cc)];
          if (q !== '.') {
            if (colorOf(q) === by && kinds.indexOf(lower(q)) !== -1) return true;
            break;
          }
          rr += dirs[d][0]; cc += dirs[d][1];
        }
      }
      return false;
    }
    return ray(ROOK_DIRS, 'rq') || ray(BISHOP_DIRS, 'bq');
  }

  function kingSquare(s, color) { return s.board.indexOf(color === 'w' ? 'K' : 'k'); }

  function inCheck(s, color) { return attacked(s, kingSquare(s, color), color === 'w' ? 'b' : 'w'); }

  function pseudoMoves(s) {
    var moves = [], b = s.board, me = s.turn, them = me === 'w' ? 'b' : 'w';
    for (var i = 0; i < 64; i++) {
      var p = b[i];
      if (p === '.' || colorOf(p) !== me) continue;
      var r = rowOf(i), c = colOf(i), k = lower(p);
      if (k === 'p') {
        var dir = me === 'w' ? -1 : 1, startRow = me === 'w' ? 6 : 1, lastRow = me === 'w' ? 0 : 7;
        var one = sq(r + dir, c);
        if (r + dir >= 0 && r + dir < 8 && b[one] === '.') {
          addPawn(moves, i, one, r + dir === lastRow, null);
          var two = sq(r + 2 * dir, c);
          if (r === startRow && b[two] === '.') moves.push({ from: i, to: two, flag: 'double' });
        }
        for (var dc = -1; dc <= 1; dc += 2) {
          var cc = c + dc, rr = r + dir;
          if (cc < 0 || cc > 7 || rr < 0 || rr > 7) continue;
          var t = sq(rr, cc);
          if (b[t] !== '.' && colorOf(b[t]) === them) addPawn(moves, i, t, rr === lastRow, b[t]);
          else if (t === s.ep) moves.push({ from: i, to: t, flag: 'ep', captured: me === 'w' ? 'p' : 'P' });
        }
      } else if (k === 'n' || k === 'k') {
        var offs = k === 'n' ? KNIGHT : KING;
        for (var j = 0; j < 8; j++) {
          var nr = r + offs[j][0], nc = c + offs[j][1];
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
          var tt = sq(nr, nc);
          if (b[tt] === '.' || colorOf(b[tt]) === them) moves.push({ from: i, to: tt, captured: b[tt] === '.' ? null : b[tt] });
        }
        if (k === 'k') castleMoves(s, moves, i);
      } else {
        var dirs = k === 'r' ? ROOK_DIRS : k === 'b' ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
        for (var d = 0; d < dirs.length; d++) {
          var r2 = r + dirs[d][0], c2 = c + dirs[d][1];
          while (r2 >= 0 && r2 < 8 && c2 >= 0 && c2 < 8) {
            var t2 = sq(r2, c2);
            if (b[t2] === '.') moves.push({ from: i, to: t2 });
            else { if (colorOf(b[t2]) === them) moves.push({ from: i, to: t2, captured: b[t2] }); break; }
            r2 += dirs[d][0]; c2 += dirs[d][1];
          }
        }
      }
    }
    return moves;
  }

  function addPawn(moves, from, to, promo, captured) {
    if (promo) ['q', 'r', 'b', 'n'].forEach(function (p) { moves.push({ from: from, to: to, promo: p, captured: captured }); });
    else moves.push({ from: from, to: to, captured: captured });
  }

  function castleMoves(s, moves, k) {
    var me = s.turn, them = me === 'w' ? 'b' : 'w', b = s.board;
    var home = me === 'w' ? 60 : 4;
    if (k !== home || attacked(s, home, them)) return;
    var kingSide = me === 'w' ? s.castle.K : s.castle.k;
    var queenSide = me === 'w' ? s.castle.Q : s.castle.q;
    var rook = me === 'w' ? 'R' : 'r';
    if (kingSide && b[home + 1] === '.' && b[home + 2] === '.' && b[home + 3] === rook &&
        !attacked(s, home + 1, them) && !attacked(s, home + 2, them)) moves.push({ from: home, to: home + 2, flag: 'castleK' });
    if (queenSide && b[home - 1] === '.' && b[home - 2] === '.' && b[home - 3] === '.' && b[home - 4] === rook &&
        !attacked(s, home - 1, them) && !attacked(s, home - 2, them)) moves.push({ from: home, to: home - 2, flag: 'castleQ' });
  }

  function apply(s, m) {
    var n = clone(s), b = n.board, p = b[m.from], me = s.turn;
    var captured = b[m.to] !== '.' ? b[m.to] : null;
    b[m.to] = m.promo ? (me === 'w' ? m.promo.toUpperCase() : m.promo) : p;
    b[m.from] = '.';
    if (m.flag === 'ep') { b[m.to + (me === 'w' ? 8 : -8)] = '.'; captured = me === 'w' ? 'p' : 'P'; }
    if (m.flag === 'castleK') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = '.'; }
    if (m.flag === 'castleQ') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = '.'; }
    n.ep = m.flag === 'double' ? (m.from + m.to) / 2 : -1;
    if (lower(p) === 'k') { if (me === 'w') { n.castle.K = n.castle.Q = false; } else { n.castle.k = n.castle.q = false; } }
    [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']].forEach(function (x) { if (m.from === x[0] || m.to === x[0]) n.castle[x[1]] = false; });
    n.half = (lower(p) === 'p' || captured) ? 0 : s.half + 1;
    if (me === 'b') n.full++;
    n.turn = me === 'w' ? 'b' : 'w';
    return n;
  }

  function legalMoves(s) {
    return pseudoMoves(s).filter(function (m) { return !inCheck(apply(s, m), s.turn); });
  }

  function positionKey(s) {
    return s.board.join('') + s.turn + (s.castle.K ? 'K' : '') + (s.castle.Q ? 'Q' : '') + (s.castle.k ? 'k' : '') + (s.castle.q ? 'q' : '') + s.ep;
  }

  function insufficient(s) {
    var pieces = s.board.filter(function (p) { return p !== '.' && lower(p) !== 'k'; });
    if (!pieces.length) return true;
    if (pieces.length === 1 && (lower(pieces[0]) === 'b' || lower(pieces[0]) === 'n')) return true;
    return false;
  }

  function san(s, m, legal) {
    var p = s.board[m.from], k = lower(p);
    var out;
    if (m.flag === 'castleK') out = 'O-O';
    else if (m.flag === 'castleQ') out = 'O-O-O';
    else {
      var cap = m.captured || m.flag === 'ep';
      if (k === 'p') {
        out = (cap ? FILES[colOf(m.from)] + 'x' : '') + name(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
      } else {
        var same = legal.filter(function (o) { return o.to === m.to && o.from !== m.from && lower(s.board[o.from]) === k; });
        var dis = '';
        if (same.length) {
          var sameFile = same.some(function (o) { return colOf(o.from) === colOf(m.from); });
          var sameRank = same.some(function (o) { return rowOf(o.from) === rowOf(m.from); });
          dis = !sameFile ? FILES[colOf(m.from)] : !sameRank ? String(8 - rowOf(m.from)) : name(m.from);
        }
        out = k.toUpperCase() + dis + (cap ? 'x' : '') + name(m.to);
      }
    }
    var after = apply(s, m);
    if (inCheck(after, after.turn)) out += legalMoves(after).length ? '+' : '#';
    return out;
  }

  /* ---------- AI ---------- */

  // Piece-square tables from white's point of view (a8 first).
  var PST = {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
  };

  function evaluate(s) {
    var score = 0;
    for (var i = 0; i < 64; i++) {
      var p = s.board[i];
      if (p === '.') continue;
      var k = lower(p);
      if (p === k) score -= VALUE[k] + PST[k][(7 - rowOf(i)) * 8 + colOf(i)];
      else score += VALUE[k] + PST[k][i];
    }
    return s.turn === 'w' ? score : -score;
  }

  function order(moves) {
    return moves.sort(function (a, b) {
      var va = (a.captured ? VALUE[lower(a.captured)] * 10 : 0) + (a.promo ? 800 : 0);
      var vb = (b.captured ? VALUE[lower(b.captured)] * 10 : 0) + (b.promo ? 800 : 0);
      return vb - va;
    });
  }

  function negamax(s, depth, alpha, beta, ply) {
    var moves = legalMoves(s);
    if (!moves.length) return inCheck(s, s.turn) ? -100000 + ply : 0;
    if (depth === 0) return quiesce(s, alpha, beta, 3);
    order(moves);
    for (var i = 0; i < moves.length; i++) {
      var v = -negamax(apply(s, moves[i]), depth - 1, -beta, -alpha, ply + 1);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function quiesce(s, alpha, beta, depth) {
    var stand = evaluate(s);
    if (depth === 0) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    var caps = order(pseudoMoves(s).filter(function (m) { return m.captured || m.promo; }));
    for (var i = 0; i < caps.length; i++) {
      var n = apply(s, caps[i]);
      if (inCheck(n, s.turn)) continue;
      var v = -quiesce(n, -beta, -alpha, depth - 1);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  var LEVELS = { easy: { depth: 1, noise: 120 }, normal: { depth: 2, noise: 25 }, hard: { depth: 3, noise: 0 } };

  function bestMove(s, level) {
    var cfg = LEVELS[level] || LEVELS.normal;
    var moves = order(legalMoves(s));
    var best = null, bestV = -Infinity;
    moves.forEach(function (m) {
      var v = -negamax(apply(s, m), cfg.depth - 1, -Infinity, Infinity, 1) + (Math.random() * 2 - 1) * cfg.noise;
      if (v > bestV) { bestV = v; best = m; }
    });
    return best;
  }

  /* =================================================================
     Game state + UI
     ================================================================= */

  var GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

  var settings = {
    mode: null,
    difficulty: G.Store.get('chess_difficulty', 'normal'),
    side: G.Store.get('chess_side', 'w'),
    clock: G.Store.get('chess_clock', '0')
  };

  var game = null;
  var clockTimer = null;

  function newGame(mode, myColor) {
    var s = initial();
    var mins = parseInt(settings.clock, 10) || 0;
    game = {
      mode: mode,
      state: s,
      history: [],       // { state, move, san }
      keys: [positionKey(s)],
      myColor: myColor,  // for cpu/online; null for local
      selected: null,
      legal: legalMoves(s),
      over: false,
      result: '',
      flipped: myColor === 'b',
      clock: mins ? { w: mins * 60000, b: mins * 60000, inc: mins === 3 ? 2000 : 0, last: null } : null,
      thinking: false,
      drawOfferFrom: null
    };
  }

  var SCREENS = ['menuPanel', 'onlinePanel', 'lobbyPanel', 'gameView'];
  function screen(id) { SCREENS.forEach(function (x) { $('#' + x).classList.toggle('hidden', x !== id); }); }

  function startMode(mode, myColor) {
    settings.mode = mode;
    newGame(mode, myColor);
    buildBoard();
    screen('gameView');
    G.hide($('#overlay'));
    $('#undoBtn').classList.toggle('hidden', mode === 'online');
    $('#drawBtn').classList.toggle('hidden', mode !== 'online');
    render();
    startClock();
    maybeCpu();
  }

  function buildBoard() {
    var el = $('#board');
    el.textContent = '';
    for (var i = 0; i < 64; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sq';
      b.addEventListener('click', onSquare);
      el.appendChild(b);
    }
  }

  function viewIndex(k) { return game.flipped ? 63 - k : k; }

  function render() {
    var s = game.state, el = $('#board');
    var lastMove = game.history.length ? game.history[game.history.length - 1].move : null;
    var checkSq = inCheck(s, s.turn) ? kingSquare(s, s.turn) : -1;
    var targets = game.selected != null ? game.legal.filter(function (m) { return m.from === game.selected; }) : [];

    for (var k = 0; k < 64; k++) {
      var i = viewIndex(k);
      var btn = el.children[k];
      btn.dataset.sq = i;
      var light = (rowOf(i) + colOf(i)) % 2 === 0;
      var cls = 'sq ' + (light ? 'light' : 'dark');
      if (lastMove && (lastMove.from === i || lastMove.to === i)) cls += ' last';
      if (game.selected === i) cls += ' selected';
      if (i === checkSq) cls += ' check';
      var t = targets.filter(function (m) { return m.to === i; })[0];
      if (t) cls += s.board[i] !== '.' || t.flag === 'ep' ? ' capture' : ' target';
      btn.className = cls;
      var p = s.board[i];
      btn.textContent = '';
      if (p !== '.') {
        var glyph = document.createElement('span');
        glyph.className = 'piece ' + (colorOf(p) === 'w' ? 'white-piece' : 'black-piece');
        glyph.textContent = GLYPH[lower(p)] + '\uFE0E';
        btn.appendChild(glyph);
      }
      if (rowOf(k) === 7) { var f = document.createElement('span'); f.className = 'coord file'; f.textContent = FILES[colOf(i)]; btn.appendChild(f); }
      if (colOf(k) === 0) { var rk = document.createElement('span'); rk.className = 'coord rank'; rk.textContent = String(8 - rowOf(i)); btn.appendChild(rk); }
      var label = name(i) + (p === '.' ? '' : ' ' + (colorOf(p) === 'w' ? 'white ' : 'black ') + ({ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' })[lower(p)]);
      btn.setAttribute('aria-label', label);
    }
    renderSide();
  }

  function renderSide() {
    var s = game.state;
    var who = s.turn === 'w' ? 'White' : 'Black';
    var status = game.over ? game.result : (game.thinking ? 'CPU is thinking…' : who + ' to move' + (inCheck(s, s.turn) ? ' · check!' : ''));
    if (!game.over && game.mode === 'online') status = s.turn === game.myColor ? 'Your move' + (inCheck(s, s.turn) ? ' · check!' : '') : 'Opponent\'s move';
    $('#chessStatus').textContent = status;

    var list = $('#moveList');
    list.textContent = '';
    for (var i = 0; i < game.history.length; i += 2) {
      var li = document.createElement('li');
      li.textContent = (i / 2 + 1) + '. ' + game.history[i].san + (game.history[i + 1] ? '  ' + game.history[i + 1].san : '');
      list.appendChild(li);
    }
    list.scrollTop = list.scrollHeight;

    // captured material
    var counts = { w: {}, b: {} };
    START.split('').forEach(function (p) { if (p !== '.') counts[colorOf(p)][lower(p)] = (counts[colorOf(p)][lower(p)] || 0) + 1; });
    s.board.forEach(function (p) { if (p !== '.') counts[colorOf(p)][lower(p)]--; });
    var material = 0;
    ['w', 'b'].forEach(function (c) {
      var txt = '';
      ['q', 'r', 'b', 'n', 'p'].forEach(function (k) {
        for (var n = 0; n < Math.max(0, counts[c][k]); n++) txt += GLYPH[k] + '︎';
        material += (c === 'b' ? 1 : -1) * Math.max(0, counts[c][k]) * VALUE[k];
      });
      $(c === 'w' ? '#capturedByBlack' : '#capturedByWhite').textContent = txt;
    });
    $('#materialDiff').textContent = material === 0 ? 'Even material' : (material > 0 ? 'White' : 'Black') + ' +' + Math.round(Math.abs(material) / 100);

    var top = game.flipped ? 'w' : 'b', bottom = game.flipped ? 'b' : 'w';
    $('#topName').textContent = playerLabel(top);
    $('#bottomName').textContent = playerLabel(bottom);
    renderClocks();
  }

  function playerLabel(c) {
    var colour = c === 'w' ? 'White' : 'Black';
    if (game.mode === 'cpu') return colour + (c === game.myColor ? ' · you' : ' · CPU');
    if (game.mode === 'online') return colour + (c === game.myColor ? ' · you' : ' · opponent');
    return colour;
  }

  /* ---------- clocks ---------- */

  function fmt(ms) {
    ms = Math.max(0, ms);
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  function renderClocks() {
    var c = game.clock;
    var top = game.flipped ? 'w' : 'b', bottom = game.flipped ? 'b' : 'w';
    $('#topClock').classList.toggle('hidden', !c);
    $('#bottomClock').classList.toggle('hidden', !c);
    if (!c) return;
    var now = performance.now();
    function left(col) { return c[col] - (c.last && game.state.turn === col && !game.over ? now - c.last : 0); }
    $('#topClock').textContent = fmt(left(top));
    $('#bottomClock').textContent = fmt(left(bottom));
    $('#topClock').classList.toggle('running', game.state.turn === top && !game.over && !!c.last);
    $('#bottomClock').classList.toggle('running', game.state.turn === bottom && !game.over && !!c.last);
    ['w', 'b'].forEach(function (col) {
      if (!game.over && left(col) <= 0) {
        c[col] = 0;
        endGame((col === 'w' ? 'Black' : 'White') + ' wins on time');
      }
    });
  }

  function startClock() {
    clearInterval(clockTimer);
    if (!game.clock) return;
    clockTimer = setInterval(function () { if (game && !game.over) renderClocks(); }, 200);
  }

  function pressClock(mover) {
    var c = game.clock;
    if (!c) return;
    var now = performance.now();
    if (c.last) c[mover] -= now - c.last;
    if (game.history.length > 1) c[mover] += c.inc;
    c.last = game.history.length >= 1 ? now : null;
  }

  /* ---------- moves ---------- */

  function myTurn() {
    if (game.over || game.thinking) return false;
    if (game.mode === 'local') return true;
    return game.state.turn === game.myColor;
  }

  function onSquare(e) {
    if (!game || !myTurn()) return;
    var i = +e.currentTarget.dataset.sq, s = game.state;
    if (game.selected != null) {
      var options = game.legal.filter(function (m) { return m.from === game.selected && m.to === i; });
      if (options.length) {
        if (options.length > 1) return askPromotion(options);
        return makeMove(options[0], true);
      }
    }
    if (s.board[i] !== '.' && colorOf(s.board[i]) === s.turn) {
      game.selected = game.selected === i ? null : i;
    } else {
      game.selected = null;
    }
    render();
  }

  function askPromotion(options) {
    var box = $('#promoChoices');
    box.textContent = '';
    ['q', 'r', 'b', 'n'].forEach(function (k) {
      var m = options.filter(function (o) { return o.promo === k; })[0];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'promo-btn ' + (game.state.turn === 'w' ? 'white-piece' : 'black-piece');
      b.textContent = GLYPH[k] + '︎';
      b.addEventListener('click', function () { G.hide($('#promoModal')); makeMove(m, true); });
      box.appendChild(b);
    });
    G.show($('#promoModal'));
  }

  function makeMove(m, local) {
    var before = game.state;
    var notation = san(before, m, game.legal);
    game.state = apply(before, m);
    game.history.push({ state: before, move: m, san: notation });
    game.keys.push(positionKey(game.state));
    game.selected = null;
    game.legal = legalMoves(game.state);
    game.drawOfferFrom = null;
    pressClock(before.turn);

    var check = inCheck(game.state, game.state.turn);
    if (m.captured || m.flag === 'ep') G.Sound.beep(300, 0.08, 'square', 0.05);
    else G.Sound.beep(520, 0.05, 'triangle', 0.04);
    if (check) G.Sound.beep(880, 0.12, 'triangle', 0.05);

    if (local && game.mode === 'online') netSend({ t: 'move', from: m.from, to: m.to, promo: m.promo || null });
    checkEnd();
    render();
    maybeCpu();
  }

  function checkEnd() {
    var s = game.state;
    if (!game.legal.length) {
      if (inCheck(s, s.turn)) endGame('Checkmate · ' + (s.turn === 'w' ? 'Black' : 'White') + ' wins');
      else endGame('Stalemate · draw');
    } else if (s.half >= 100) endGame('Draw by the 50-move rule');
    else if (insufficient(s)) endGame('Draw · insufficient material');
    else {
      var key = positionKey(s);
      if (game.keys.filter(function (k) { return k === key; }).length >= 3) endGame('Draw by repetition');
    }
  }

  function endGame(text) {
    if (game.over) return;
    game.over = true;
    game.result = text;
    clearInterval(clockTimer);
    renderSide();
    var won = null;
    if (game.mode !== 'local' && /wins/.test(text)) won = (/White wins/.test(text) && game.myColor === 'w') || (/Black wins/.test(text) && game.myColor === 'b');
    if (/resign/i.test(text) && game.mode !== 'local') won = !/^You/.test(text);
    $('#overlayTitle').textContent = won === true ? 'You win!' : won === false ? 'You lose' : text.split(' · ')[0];
    $('#overlayText').textContent = text;
    G.show($('#overlay'));
    G.Sound.beep(won === false ? 200 : 660, 0.5, 'triangle', 0.07);
  }

  function maybeCpu() {
    if (!game || game.over || game.mode !== 'cpu' || game.state.turn === game.myColor) return;
    game.thinking = true;
    renderSide();
    setTimeout(function () {
      if (!game || game.over) return;
      var m = bestMove(game.state, settings.difficulty);
      game.thinking = false;
      if (m) makeMove(m, false);
    }, 350);
  }

  function undo() {
    if (!game || game.mode === 'online' || game.thinking || !game.history.length) return;
    var steps = game.mode === 'cpu' ? (game.state.turn === game.myColor ? 2 : 1) : 1;
    for (var i = 0; i < steps && game.history.length; i++) {
      var h = game.history.pop();
      game.state = h.state;
      game.keys.pop();
    }
    game.over = false;
    game.result = '';
    game.selected = null;
    game.legal = legalMoves(game.state);
    G.hide($('#overlay'));
    render();
    maybeCpu();
  }

  function resign() {
    if (!game || game.over) return;
    if (game.mode === 'local') return endGame((game.state.turn === 'w' ? 'White' : 'Black') + ' resigned · ' + (game.state.turn === 'w' ? 'Black' : 'White') + ' wins');
    if (game.mode === 'online') netSend({ t: 'resign' });
    endGame('You resigned');
  }

  /* =================================================================
     Online
     ================================================================= */

  var net = { role: null, session: null, myReady: false, theirReady: false };

  function netSend(msg) {
    if (!net.session) return;
    if (net.role === 'host') net.session.broadcast(msg);
    else net.session.send(msg);
  }

  function onNet(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'hello': renderLobby(); break;
      case 'ready':
        net.theirReady = !!d.v;
        renderLobby();
        hostMaybeStart();
        break;
      case 'start':
        settings.clock = String(d.clock || '0');
        net.myReady = net.theirReady = false;
        startMode('online', d.hostColor === 'w' ? 'b' : 'w');
        break;
      case 'move':
        if (!game || game.over || game.state.turn === game.myColor) return;
        var m = game.legal.filter(function (x) { return x.from === d.from && x.to === d.to && (x.promo || null) === (d.promo || null); })[0];
        if (m) makeMove(m, false);
        break;
      case 'resign':
        if (game && !game.over) endGame('Opponent resigned · you win');
        break;
      case 'draw-offer':
        if (game && !game.over) {
          game.drawOfferFrom = 'them';
          G.show($('#drawOffer'));
        }
        break;
      case 'draw-accept':
        if (game && !game.over) endGame('Draw by agreement');
        break;
      case 'rematch':
        net.theirReady = true;
        $('#overlayText').textContent = 'Opponent wants a rematch!';
        hostMaybeStart();
        break;
    }
  }

  function hostMaybeStart() {
    if (net.role !== 'host' || !net.myReady || !net.theirReady) return;
    net.myReady = net.theirReady = false;
    var hostColor = Math.random() < 0.5 ? 'w' : 'b';
    netSend({ t: 'start', hostColor: hostColor, clock: settings.clock });
    startMode('online', hostColor);
  }

  function renderLobby() {
    var list = $('#lobbyPlayers');
    list.textContent = '';
    var connected = net.role === 'guest' || (net.session && net.session.conns && net.session.conns.length);
    [[net.role === 'host' ? 'You (host)' : 'Host', net.role === 'host' ? net.myReady : net.theirReady, false],
     [net.role === 'host' ? (connected ? 'Opponent' : 'Waiting for opponent…') : 'You', net.role === 'host' ? net.theirReady : net.myReady, !connected]]
      .forEach(function (row) {
        var li = document.createElement('li');
        var a = document.createElement('span'); a.textContent = row[0];
        var b = document.createElement('span');
        b.className = row[1] ? 'ready' : 'waiting';
        b.textContent = row[2] ? '' : row[1] ? '✓ Ready' : 'Not ready';
        li.appendChild(a); li.appendChild(b);
        list.appendChild(li);
      });
    $('#readyBtn').disabled = !connected;
    $('#readyBtn').textContent = net.myReady ? 'Not ready' : 'Ready';
    $('#lobbyClock').textContent = settings.clock === '0' ? 'No clock' : settings.clock + ' minute clock';
  }

  function createLobby() {
    net.role = 'host';
    net.myReady = net.theirReady = false;
    setNotice('Creating lobby…');
    net.session = G.Net.host('chess', {
      maxGuests: 1,
      onReady: function (code) {
        $('#lobbyCode').textContent = code;
        G.show($('#lobbyCodeBox'));
        screen('lobbyPanel');
        renderLobby();
      },
      onJoin: function (conn) { net.session.send(conn, { t: 'hello' }); G.Sound.beep(660, 0.1, 'triangle'); renderLobby(); },
      onData: function (conn, d) { onNet(d); },
      onLeave: opponentLeft,
      onError: netError
    });
  }

  function joinLobby() {
    var code = G.cleanCode($('#joinCode').value);
    if (code.length !== 5) return netError('Lobby codes are 5 characters.');
    net.role = 'guest';
    net.myReady = net.theirReady = false;
    setNotice('Connecting…');
    net.session = G.Net.join('chess', code, {
      onOpen: function () { G.hide($('#lobbyCodeBox')); screen('lobbyPanel'); renderLobby(); },
      onData: onNet,
      onClose: opponentLeft,
      onError: netError
    });
  }

  function opponentLeft() {
    if (!net.session) return;
    if (net.role === 'host' && !$('#lobbyPanel').classList.contains('hidden')) {
      net.theirReady = false;
      renderLobby();
      G.banner('Opponent left');
      return;
    }
    net.session.close();
    net.session = null;
    if (game && !game.over) endGame('Opponent disconnected · you win');
    else netError('Lost connection to your opponent.');
  }

  function setNotice(msg, err) {
    $('#onlineNotice').textContent = msg;
    $('#onlineNotice').className = 'notice' + (err ? ' error' : '');
  }

  function netError(msg) {
    setNotice(msg, true);
    if (net.session) { net.session.close(); net.session = null; }
    screen('onlinePanel');
  }

  function toMenu() {
    clearInterval(clockTimer);
    if (net.session) { net.session.close(); net.session = null; }
    net.role = null;
    game = null;
    G.hide($('#promoModal'));
    G.hide($('#drawOffer'));
    screen('menuPanel');
  }

  /* =================================================================
     Wiring
     ================================================================= */

  function init() {
    G.chips($('#difficultyChips'), settings.difficulty, function (v) { settings.difficulty = v; G.Store.set('chess_difficulty', v); });
    G.chips($('#sideChips'), settings.side, function (v) { settings.side = v; G.Store.set('chess_side', v); });
    G.chips($('#clockChips'), settings.clock, function (v) { settings.clock = v; G.Store.set('chess_clock', v); });

    $('#modeCpu').addEventListener('click', function () {
      var side = settings.side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.side;
      var saved = settings.clock;
      settings.clock = '0';           // no clock against the CPU
      startMode('cpu', side);
      settings.clock = saved;
    });
    $('#modeLocal').addEventListener('click', function () { startMode('local', null); });
    $('#modeOnline').addEventListener('click', function () {
      setNotice(G.Net.available() ? 'One of you creates a lobby, the other joins with the code. Colours are random.' : 'Online play couldn\'t load on this network.', !G.Net.available());
      screen('onlinePanel');
    });
    $('#createLobby').addEventListener('click', createLobby);
    $('#joinForm').addEventListener('submit', function (e) { e.preventDefault(); joinLobby(); });
    $('#onlineBack').addEventListener('click', function () { screen('menuPanel'); });
    $('#lobbyCode').addEventListener('click', function () { G.copyText($('#lobbyCode').textContent); });
    $('#readyBtn').addEventListener('click', function () {
      net.myReady = !net.myReady;
      netSend({ t: 'ready', v: net.myReady });
      renderLobby();
      hostMaybeStart();
    });
    $('#lobbyLeave').addEventListener('click', toMenu);

    $('#flipBtn').addEventListener('click', function () { if (game) { game.flipped = !game.flipped; render(); } });
    $('#undoBtn').addEventListener('click', undo);
    $('#resignBtn').addEventListener('click', resign);
    $('#drawBtn').addEventListener('click', function () {
      if (!game || game.over) return;
      netSend({ t: 'draw-offer' });
      G.banner('Draw offered');
    });
    $('#acceptDraw').addEventListener('click', function () { G.hide($('#drawOffer')); netSend({ t: 'draw-accept' }); endGame('Draw by agreement'); });
    $('#declineDraw').addEventListener('click', function () { G.hide($('#drawOffer')); });
    $('#quitBtn').addEventListener('click', toMenu);
    $('#againBtn').addEventListener('click', function () {
      if (game && game.mode === 'online') {
        if (!net.session) return toMenu();
        net.myReady = true;
        netSend({ t: 'rematch' });
        if (net.role === 'guest') netSend({ t: 'ready', v: true });
        $('#overlayText').textContent = 'Waiting for your opponent…';
        hostMaybeStart();
        return;
      }
      var mode = game ? game.mode : 'local', color = game ? game.myColor : null;
      startMode(mode, mode === 'cpu' ? (settings.side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.side) : color);
    });
    $('#menuBtn').addEventListener('click', toMenu);
    G.Sound.bindButton($('#soundBtn'));
    screen('menuPanel');
  }

  // Exposed for tests
  window.__chess = { initial: initial, legalMoves: legalMoves, apply: apply, inCheck: inCheck, san: san, bestMove: bestMove };

  init();
})();
