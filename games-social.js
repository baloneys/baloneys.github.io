// games-social.js: player profiles, friends, the notification bell, game invites, XP and levels, badges,
// the points shop, the public leaderboards, achievement sync and the public lobby finder, shared by all four games.
// One profile across the site: XP, points, shop items, badges and friends are shared; achievements,
// leaderboards and lobbies belong to the game the page is (<html data-game="tetris|pong|battleships|chess">).
//
// Games stay peer-to-peer (PeerJS). Only the shared bits live in a Supabase project (free tier): see
// supabase/tetris-schema.sql for the tables and security rules, and games-config.js for the URL and key.
// With no config the whole feature stays off and the page behaves exactly as before.
// Add ?mockdb to the URL to run against a stand-in database kept in this browser's localStorage (each tab is
// a different player), which is how the UI is tested without a real project.
//
// The game talks to this file through window.GameSocial (the game-specific Finished hooks,
// lobbyChanged, card, decorateName, openProfile, localProfileChanged) and this file calls back through
// window.GameApp (join(code), lobby(), pause(), profileChanged(), and for Tetris skulls()/skullIcon()).
//
// API (window.GameSocial, also window.TetrisSocial): see the object at the bottom.
(function () {
  'use strict';

  // Which game this page is (<html data-game=...>): picks the achievements shown on profiles and the leaderboard.
  var GAMES = { tetris: 'Tetris', pong: 'Pong', battleships: 'Battleships', chess: 'Chess' };
  var PAGE = document.documentElement.getAttribute('data-game');
  // /chat uses data-game="chat": same profile, friends, bell and invites, but no achievements or leaderboard.
  var GAME = GAMES[PAGE] ? PAGE : PAGE === 'chat' ? 'chat' : 'tetris';
  var GAME_NAME = GAMES[GAME] || 'Chat';
  var G = window.Games;
  var ALL_ACH = { tetris: window.TetrisAchievements, pong: window.PongAchievements, battleships: window.BattleshipsAchievements, chess: window.ChessAchievements };
  var NO_ACH = { list: function () { return []; }, get: function () { return null; }, count: function () { return { unlocked: 0, total: 0 }; },
    badge: function () { return document.createElement('span'); } };
  var ACH = ALL_ACH[GAME] || NO_ACH;
  var CFG = window.GAMES_SUPABASE || {};
  // The game's hooks (window.GameApp, set by each game script); harmless defaults until it exists.
  var NO_APP = { lobby: function () { return null; } };
  function App() { return window.GameApp || NO_APP; }
  var MOCK = /[?&]mockdb\b/.test(location.search);
  var ENABLED = MOCK || !!(CFG.url && CFG.anonKey);
  // The embedded DM window still needs this shared profile and friends service.
  // Its visual dock is hidden by chat.css in mini mode.
  var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  var POLL_MS = 20000, LOBBY_BEAT_MS = 15000;
  var PROFILE_URL = location.origin + location.pathname.replace(/\.html$/, '');

  function $(s, root) { return (root || document).querySelector(s); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(label, cls, onClick) {
    var b = el('button', 'btn btn-sm ' + (cls || 'btn-outline'), label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function uuidOk(s) { return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s); }
  function fmt(n) { return (n || 0).toLocaleString('en-AU'); }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  /* =================================================================
     Levels, rewards, badges and shop items
     ================================================================= */

  // Level n starts at 50·n·(n−1) XP: 100 to reach level 2, 300 for 3, 4,500 for 10, 19,000 for 20.
  function levelOf(xp) { return Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * Math.max(0, xp || 0))) / 2)); }
  function xpAt(level) { return 50 * level * (level - 1); }

  var ACH_REWARD = { bronze: [100, 50], silver: [250, 125], gold: [500, 250], platinum: [1000, 500] };

  // Badges a player can show (up to three). Earned ones test the profile; shop ones must be owned.
  var BADGES = [
    { id: 'founder', name: 'Founder', sym: '✦', a: '#ffd640', b: '#ff8a3d', desc: 'Made a profile in 2026.', test: function (p) { return new Date(p.created_at || Date.now()).getFullYear() <= 2026; } },
    { id: 'lvl5', name: 'Level 5', sym: '5', a: '#9ecbff', b: '#4d80ff', desc: 'Reach level 5.', test: function (p) { return levelOf(p.xp) >= 5; } },
    { id: 'lvl10', name: 'Level 10', sym: '10', a: '#c7a2ff', b: '#7a3cff', desc: 'Reach level 10.', test: function (p) { return levelOf(p.xp) >= 10; } },
    { id: 'lvl25', name: 'Level 25', sym: '25', a: '#ff9ad5', b: '#d6247e', desc: 'Reach level 25.', test: function (p) { return levelOf(p.xp) >= 25; } },
    { id: 'tetrisfan', name: 'Tetris Enthusiast', sym: '▤', a: '#66f2ff', b: '#1aa7c9', desc: 'Tetris: unlock Tetris Enthusiast.', test: function (p) { return !!gameAch(p, 'tetris').tetris50; } },
    { id: 'champion', name: 'Champion', sym: '♛', a: '#ffe27a', b: '#e0a100', desc: 'Tetris: unlock Champion (5 online wins).', test: function (p) { return !!gameAch(p, 'tetris').vs_win5; } },
    { id: 'supernova', name: 'Supernova', sym: '✺', a: '#ffffff', b: '#c77dff', desc: 'Tetris: reach a 50x streak.', test: function (p) { return !!gameAch(p, 'tetris').streak50; } },
    { id: 'pongpro', name: 'Pong Pro', sym: '◐', a: '#7dffcf', b: '#14a37f', desc: 'Pong: beat the Hard CPU.', test: function (p) { return !!gameAch(p, 'pong').hard_win; } },
    { id: 'rallyking', name: 'Rally King', sym: '∞', a: '#9ad5ff', b: '#3d5cff', desc: 'Pong: keep a 50-hit rally going.', test: function (p) { return !!gameAch(p, 'pong').rally50; } },
    { id: 'admiral', name: 'Admiral', sym: '⚓', a: '#7fd8ff', b: '#1f5fa8', desc: 'Battleships: beat the Hard CPU.', test: function (p) { return !!gameAch(p, 'battleships').hard_win; } },
    { id: 'grandmaster', name: 'Grandmaster', sym: '♞', a: '#f3e6ff', b: '#7a3cff', desc: 'Chess: beat the Hard CPU.', test: function (p) { return !!gameAch(p, 'chess').hard_win; } },
    { id: 'allrounder', name: 'All-Rounder', sym: '✚', a: '#ffd6f0', b: '#c77dff', desc: 'Unlock 5 achievements in three different games.', test: function (p) { return Object.keys(GAMES).filter(function (g) { return Object.keys(gameAch(p, g)).length >= 5; }).length >= 3; } },
    { id: 'collector', name: 'Collector', sym: '◆', a: '#b8ff4d', b: '#2dd4bf', desc: 'Unlock 25 achievements across the site.', test: function (p) { return Object.keys(achOf(p)).length >= 25; } },
    { id: 'staff_dev', name: 'Developer', sym: '⌘', a: '#9dfcff', b: '#2a7bff', desc: 'Staff: balcade developer.', test: function (p) { return p.role === 'dev'; } },
    { id: 'staff_admin', name: 'Admin', sym: '★', a: '#ffe27a', b: '#ff5a1f', desc: 'Staff: admin.', test: function (p) { return p.role === 'admin' || p.role === 'dev'; } },
    { id: 'staff_mod', name: 'Moderator', sym: '⚔', a: '#b8ff4d', b: '#14a37f', desc: 'Staff: moderator.', test: function (p) { return ['moderator', 'admin', 'dev'].indexOf(p.role) !== -1; } },
    { id: 'staff_helper', name: 'Helper', sym: '✚', a: '#ffd6f0', b: '#ff3fa4', desc: 'Staff: helper.', test: function (p) { return !!p.role; } },
    { id: 'bean', name: 'Bean', sym: '●', a: '#d99a59', b: '#7a4a1f', desc: 'From the points shop.', shop: true },
    { id: 'skull', name: 'Skull', sym: '☠', a: '#e9e4ff', b: '#6b5d8f', desc: 'From the points shop.', shop: true },
    { id: 'heart', name: 'Sweetheart', sym: '♥', a: '#ff9ac8', b: '#ff3f7f', desc: 'From the points shop.', shop: true },
    { id: 'crown', name: 'Royalty', sym: '♚', a: '#fff1a8', b: '#c9a227', desc: 'From the points shop.', shop: true }
  ];
  var BADGE_BY = {};
  BADGES.forEach(function (b) { BADGE_BY[b.id] = b; });
  function achOf(p) { return (p && p.achievements && typeof p.achievements === 'object') ? p.achievements : {}; }
  // The profile keeps every game's achievements in one map, keyed "game:id" (e.g. "pong:rally50"). Keys
  // without a game prefix come from before Pong had achievements and are Tetris's.
  function akey(game, id) { return game + ':' + id; }
  function gameAch(p, game) {
    var all = achOf(p), out = {};
    Object.keys(all).forEach(function (k) {
      var at = k.indexOf(':');
      if (at === -1) { if (game === 'tetris') out[k] = all[k]; }
      else if (k.slice(0, at) === game) out[k.slice(at + 1)] = all[k];
    });
    return out;
  }
  // Featured achievements are stored as "game:id" too, up to 3 per game; a profile shows the current game's.
  function gameFeatured(p, game) {
    return (p.featured || []).filter(function (k) { return k.indexOf(game + ':') === 0; }).map(function (k) { return k.slice(game.length + 1); });
  }
  function hasBadge(p, id) {
    var b = BADGE_BY[id];
    if (!b) return false;
    return b.shop ? (p.owned || []).indexOf('badge_' + id) !== -1 : !!b.test(p);
  }

  // Name styles (Discord-style gradient names), banners and avatar frames.
  var NAME_STYLES = {
    sunset: ['#ff7a59', '#ff3fa4'], aurora: ['#3fffd2', '#7a5cff'], candy: ['#ff9ad5', '#9ad5ff'],
    toxic: ['#b8ff4d', '#2dd4bf'], royal: ['#ffd640', '#c77dff'], inferno: ['#ffd640', '#ff2a2a'],
    ocean: ['#66f2ff', '#3d5cff'], bean: ['#f2c48d', '#9d00ff']
  };
  var BANNERS = {
    dusk: 'linear-gradient(135deg, #2a0f4d 0%, #6a1fb0 55%, #ff3fa4 100%)',
    night: 'linear-gradient(160deg, #070512 0%, #1b1240 60%, #3a1f73 100%)',
    nebula: 'radial-gradient(circle at 20% 30%, #ff3fa4 0, transparent 40%), radial-gradient(circle at 80% 70%, #3fffd2 0, transparent 45%), linear-gradient(135deg, #12061f, #2c0b52)',
    grid: 'linear-gradient(rgba(157,0,255,.35) 1px, transparent 1px) 0 0 / 16px 16px, linear-gradient(90deg, rgba(157,0,255,.35) 1px, transparent 1px) 0 0 / 16px 16px, linear-gradient(180deg, #0b0718, #24104a)',
    sunset: 'linear-gradient(180deg, #ffd640 0%, #ff7a59 45%, #b0267a 100%)',
    matrix: 'repeating-linear-gradient(90deg, rgba(184,255,77,.18) 0 2px, transparent 2px 14px), linear-gradient(180deg, #041206, #0b2a10)',
    ice: 'linear-gradient(135deg, #c7f7ff 0%, #66b8ff 50%, #3d3cff 100%)',
    lava: 'radial-gradient(circle at 30% 120%, #ffd640 0, #ff5a1f 30%, transparent 60%), linear-gradient(180deg, #1a0503, #4a0d05)'
  };
  var FRAMES = { neon: 1, gold: 1, fire: 1, rainbow: 1 };

  // The shop. Free items are owned by everyone. Prices are points.
  var SHOP = [
    { id: 'banner_dusk', cat: 'Banners', name: 'Dusk', price: 0, kind: 'banner', value: 'dusk' },
    { id: 'banner_night', cat: 'Banners', name: 'Night', price: 0, kind: 'banner', value: 'night' },
    { id: 'banner_grid', cat: 'Banners', name: 'Grid', price: 250, kind: 'banner', value: 'grid' },
    { id: 'banner_nebula', cat: 'Banners', name: 'Nebula', price: 400, kind: 'banner', value: 'nebula' },
    { id: 'banner_sunset', cat: 'Banners', name: 'Sunset', price: 400, kind: 'banner', value: 'sunset' },
    { id: 'banner_matrix', cat: 'Banners', name: 'Matrix', price: 400, kind: 'banner', value: 'matrix' },
    { id: 'banner_ice', cat: 'Banners', name: 'Glacier', price: 500, kind: 'banner', value: 'ice' },
    { id: 'banner_lava', cat: 'Banners', name: 'Lava', price: 600, kind: 'banner', value: 'lava' },
    { id: 'banner_custom', cat: 'Banners', name: 'Your own picture', price: 1500, kind: 'banner', value: 'custom', desc: 'Upload any picture as your banner.' },
    { id: 'name_sunset', cat: 'Name styles', name: 'Sunset', price: 300, kind: 'name', value: 'sunset' },
    { id: 'name_candy', cat: 'Name styles', name: 'Candy', price: 300, kind: 'name', value: 'candy' },
    { id: 'name_ocean', cat: 'Name styles', name: 'Ocean', price: 300, kind: 'name', value: 'ocean' },
    { id: 'name_aurora', cat: 'Name styles', name: 'Aurora', price: 500, kind: 'name', value: 'aurora' },
    { id: 'name_toxic', cat: 'Name styles', name: 'Toxic', price: 500, kind: 'name', value: 'toxic' },
    { id: 'name_bean', cat: 'Name styles', name: 'Kanaris Bean', price: 600, kind: 'name', value: 'bean' },
    { id: 'name_royal', cat: 'Name styles', name: 'Royal', price: 800, kind: 'name', value: 'royal' },
    { id: 'name_inferno', cat: 'Name styles', name: 'Inferno', price: 800, kind: 'name', value: 'inferno' },
    { id: 'name_glow', cat: 'Name styles', name: 'Glow', price: 700, kind: 'glow', value: true, desc: 'A soft glow behind your name. Works with any style.' },
    { id: 'frame_neon', cat: 'Avatar frames', name: 'Neon', price: 400, kind: 'frame', value: 'neon' },
    { id: 'frame_gold', cat: 'Avatar frames', name: 'Gold', price: 700, kind: 'frame', value: 'gold' },
    { id: 'frame_fire', cat: 'Avatar frames', name: 'Fire', price: 1000, kind: 'frame', value: 'fire' },
    { id: 'frame_rainbow', cat: 'Avatar frames', name: 'Rainbow', price: 1200, kind: 'frame', value: 'rainbow' },
    { id: 'badge_bean', cat: 'Badges', name: 'Bean', price: 500, kind: 'badge', value: 'bean' },
    { id: 'badge_skull', cat: 'Badges', name: 'Skull', price: 800, kind: 'badge', value: 'skull' },
    { id: 'badge_heart', cat: 'Badges', name: 'Sweetheart', price: 800, kind: 'badge', value: 'heart' },
    { id: 'badge_crown', cat: 'Badges', name: 'Royalty', price: 2000, kind: 'badge', value: 'crown' }
  ];
  var SHOP_BY = {};
  SHOP.forEach(function (i) { SHOP_BY[i.id] = i; });
  function owns(p, id) { var i = SHOP_BY[id]; return !!i && (i.price === 0 || (p.owned || []).indexOf(id) !== -1); }

  var BANNER_IMG_RE = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

  // Only known values survive, whatever a modified client stored.
  function cleanEquipped(e) {
    e = e && typeof e === 'object' ? e : {};
    return {
      name: NAME_STYLES[e.name] ? e.name : null,
      glow: e.glow === true,
      banner: BANNERS[e.banner] || e.banner === 'custom' ? e.banner : 'dusk',
      frame: FRAMES[e.frame] ? e.frame : null,
      chatCode: typeof e.chatCode === 'string' && /^[a-z2-9]{16}$/.test(e.chatCode) ? e.chatCode : null
    };
  }

  function cleanProfile(p) {
    p = p || {};
    var base = G.Profile.sanitize({ name: p.name, avatar: p.avatar });
    return {
      id: uuidOk(p.id) ? p.id : null,
      name: base.name, avatar: base.avatar,
      banner: typeof p.banner === 'string' && p.banner.length < 120000 && BANNER_IMG_RE.test(p.banner) ? p.banner : null,
      bio: String(p.bio || '').slice(0, 190),
      tags: (Array.isArray(p.tags) ? p.tags : []).map(function (t) { return String(t).replace(/\s+/g, ' ').trim().slice(0, 16); }).filter(Boolean).slice(0, 5),
      badges: (Array.isArray(p.badges) ? p.badges : []).filter(function (b) { return BADGE_BY[b]; }).slice(0, 3),
      featured: (Array.isArray(p.featured) ? p.featured : []).map(function (k) { return k.indexOf(':') === -1 ? 'tetris:' + k : k; })
        .filter(function (k) { return /^(tetris|pong|battleships|chess):[A-Za-z0-9_]{1,32}$/.test(k); }).slice(0, 12),
      achievements: achOf(p),
      xp: Math.max(0, p.xp | 0), points: Math.max(0, p.points | 0),
      owned: (Array.isArray(p.owned) ? p.owned : []).filter(function (i) { return SHOP_BY[i]; }),
      equipped: cleanEquipped(p.equipped),
      created_at: p.created_at || new Date().toISOString(),
      last_seen: p.last_seen || null,
      status: String(p.status || '').slice(0, 60),
      status_kind: ['online', 'away', 'busy', 'invisible'].indexOf(p.status_kind) !== -1 ? p.status_kind : 'online',
      presence: p.presence && typeof p.presence === 'object' ? { page: String(p.presence.page || ''), at: p.presence.at || null, lobby: /^[A-Z0-9]{5}$/.test(p.presence.lobby || '') ? p.presence.lobby : null } : null,
      role: ['helper', 'moderator', 'admin', 'dev'].indexOf(p.role) !== -1 ? p.role : null
    };
  }

  // Where a player is right now: online (and which game or chat) if their page checked in during the last
  // 2.5 minutes and they aren't invisible; otherwise when they were last seen.
  var ROLE_NAMES = { helper: 'Helper', moderator: 'Moderator', admin: 'Admin', dev: 'Developer' };
  function presenceOf(p) {
    var pr = p && p.presence, on = !!(pr && pr.at && Date.now() - new Date(pr.at).getTime() < 150000) && p.status_kind !== 'invisible';
    if (!on) return { on: false, kind: 'offline', text: p && p.last_seen ? 'Last seen ' + ago(p.last_seen) : 'Offline' };
    var where = pr.page === 'chat' ? 'In chat' : GAMES[pr.page] ? 'Playing ' + GAMES[pr.page] : 'Online';
    return { on: true, kind: p.status_kind, page: pr.page, lobby: pr.lobby, text: where + (p.status_kind === 'away' ? ' · away' : p.status_kind === 'busy' ? ' · busy' : '') };
  }

  /* =================================================================
     Backends: Supabase, or a localStorage stand-in for testing
     ================================================================= */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function check(res) { if (res.error) throw res.error; return res.data; }

  function SupabaseBackend() {
    var sb = null, uid = null;
    var api = {
      init: function () {
        return loadScript(SUPABASE_JS).then(function () {
          sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tetris-auth' } });
          return sb.auth.getSession();
        }).then(function (r) {
          if (r.data && r.data.session) return r.data.session;
          return sb.auth.signInAnonymously().then(function (res) { return check(res).session; });
        }).then(function (session) { uid = session.user.id; return uid; });
      },
      uid: function () { return uid; },
      getProfile: function (id) { return sb.from('tetris_profiles').select('*').eq('id', id).maybeSingle().then(check); },
      getProfiles: function (ids) {
        if (!ids.length) return Promise.resolve([]);
        return sb.from('tetris_profiles').select('*').in('id', ids).then(check);
      },
      createProfile: function (row) { return sb.from('tetris_profiles').insert(row).select().single().then(check); },
      updateProfile: function (patch) { return sb.from('tetris_profiles').update(patch).eq('id', uid).select().single().then(check); },
      friendRows: function () { return sb.from('tetris_friends').select('*').or('requester.eq.' + uid + ',addressee.eq.' + uid).then(check); },
      requestFriend: function (id) { return sb.from('tetris_friends').insert({ requester: uid, addressee: id }).then(check); },
      acceptFriend: function (id) { return sb.from('tetris_friends').update({ status: 'accepted' }).eq('requester', id).eq('addressee', uid).then(check); },
      removeFriend: function (id) {
        return sb.from('tetris_friends').delete().or('and(requester.eq.' + uid + ',addressee.eq.' + id + '),and(requester.eq.' + id + ',addressee.eq.' + uid + ')').then(check);
      },
      notes: function () { return sb.from('tetris_notifications').select('*').eq('to_id', uid).order('created_at', { ascending: false }).limit(40).then(check); },
      sendNote: function (to, kind, lobby, game) {
        var row = { to_id: to, from_id: uid, kind: kind, lobby: lobby || null };
        if (game) row.game = game;
        return sb.from('tetris_notifications').insert(row).then(function (r) {
          if (r.error && game && /game/.test(r.error.message || '')) { delete row.game; return sb.from('tetris_notifications').insert(row).then(check); }
          return check(r);
        });
      },
      client: function () { return sb; },
      markRead: function () { return sb.from('tetris_notifications').update({ read: true }).eq('to_id', uid).eq('read', false).then(check); },
      clearNote: function (id) { return sb.from('tetris_notifications').delete().eq('id', id).then(check); },
      addRun: function (row) { row.user_id = uid; row.game = GAME; return sb.from('tetris_runs').insert(row).then(check); },
      // f: { mode, kinds[], versusType|null, skullsOn, skulls[], userIds|null, asc }
      runs: function (f) {
        var q = sb.from('tetris_board').select('*').eq('game', GAME).eq('mode', f.mode).in('kind', f.kinds);
        if (f.versusType) q = q.eq('versus_type', f.versusType);
        if (f.skullsOn === false) q = q.eq('skull_count', 0);
        else if (f.skullsOn) { q = q.gt('skull_count', 0); if (f.skulls.length) q = q.contains('skulls', f.skulls); }
        if (f.userIds) q = q.in('user_id', f.userIds);
        if (f.wonOnly) q = q.eq('won', true);
        Object.keys(f.info || {}).forEach(function (k) { q = q.eq('info->>' + k, String(f.info[k])); });
        return q.order(f.order || 'value', { ascending: f.asc }).order('created_at', { ascending: true }).limit(300).then(check);
      },
      publishLobby: function (row) { row.host_id = uid; return sb.from('tetris_lobbies').upsert(row).then(check); },
      unpublishLobby: function (code) { return sb.from('tetris_lobbies').delete().eq('code', code).then(check); },
      lobbies: function () { return sb.from('tetris_open_lobbies').select('*').eq('game', GAME).order('updated_at', { ascending: false }).limit(40).then(check); }
    };
    return api;
  }

  // Same calls, kept in localStorage so several tabs can play different people (each tab has its own id).
  function MockBackend() {
    var KEY = 'tetris_mockdb', uid = null;
    function db() {
      var d = null;
      try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
      d = d || {};
      ['profiles', 'friends', 'notes', 'scores', 'lobbies'].forEach(function (k) { if (!d[k]) d[k] = k === 'profiles' || k === 'lobbies' ? {} : []; });
      return d;
    }
    function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }
    function later(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 60); }); }
    function nowIso() { return new Date().toISOString(); }
    function newId() {
      return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
    }
    return {
      init: function () {
        uid = sessionStorage.getItem('tetris_mock_uid');
        if (!uid) { uid = newId(); sessionStorage.setItem('tetris_mock_uid', uid); }
        return later(uid);
      },
      uid: function () { return uid; },
      getProfile: function (id) { return later(db().profiles[id] || null); },
      getProfiles: function (ids) { var d = db(); return later(ids.map(function (i) { return d.profiles[i]; }).filter(Boolean)); },
      createProfile: function (row) {
        var d = db();
        row.created_at = row.updated_at = row.last_seen = nowIso();
        d.profiles[uid] = row; save(d); return later(row);
      },
      updateProfile: function (patch) {
        var d = db(), p = d.profiles[uid];
        Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
        p.updated_at = p.last_seen = nowIso();
        save(d); return later(p);
      },
      friendRows: function () { return later(db().friends.filter(function (f) { return f.requester === uid || f.addressee === uid; })); },
      requestFriend: function (id) {
        var d = db();
        if (d.friends.some(function (f) { return (f.requester === uid && f.addressee === id) || (f.requester === id && f.addressee === uid); })) return Promise.reject(new Error('duplicate key'));
        d.friends.push({ requester: uid, addressee: id, status: 'pending', created_at: nowIso() }); save(d); return later(null);
      },
      acceptFriend: function (id) {
        var d = db();
        d.friends.forEach(function (f) { if (f.requester === id && f.addressee === uid) f.status = 'accepted'; });
        save(d); return later(null);
      },
      removeFriend: function (id) {
        var d = db();
        d.friends = d.friends.filter(function (f) { return !((f.requester === uid && f.addressee === id) || (f.requester === id && f.addressee === uid)); });
        save(d); return later(null);
      },
      notes: function () {
        return later(db().notes.filter(function (n) { return n.to_id === uid; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).slice(0, 40));
      },
      sendNote: function (to, kind, lobby, game) {
        var d = db();
        d.notes.push({ id: Date.now() + Math.random(), to_id: to, from_id: uid, kind: kind, lobby: lobby || null, game: game || null, read: false, created_at: nowIso() });
        save(d); return later(null);
      },
      markRead: function () { var d = db(); d.notes.forEach(function (n) { if (n.to_id === uid) n.read = true; }); save(d); return later(null); },
      clearNote: function (id) { var d = db(); d.notes = d.notes.filter(function (n) { return n.id !== id; }); save(d); return later(null); },
      addRun: function (row) {
        var d = db();
        row.id = Date.now() + Math.random(); row.user_id = uid; row.game = GAME; row.created_at = nowIso();
        d.scores.push(row); save(d); return later(null);
      },
      runs: function (f) {
        var d = db();
        return later(d.scores.filter(function (r) {
          var n = (r.skulls || []).length;
          if ((r.game || 'tetris') !== GAME || r.mode !== f.mode || f.kinds.indexOf(r.kind) === -1) return false;
          if (f.versusType && r.versus_type !== f.versusType) return false;
          if (f.skullsOn === false ? n !== 0 : f.skullsOn && n === 0) return false;
          if (f.wonOnly && !r.won) return false;
          if (Object.keys(f.info || {}).some(function (k) { return String((r.info || {})[k]) !== String(f.info[k]); })) return false;
          if (f.skullsOn && f.skulls.some(function (s) { return r.skulls.indexOf(s) === -1; })) return false;
          return !f.userIds || f.userIds.indexOf(r.user_id) !== -1;
        }).sort(function (a, b) { var c = f.order || 'value'; return f.asc ? a[c] - b[c] : b[c] - a[c]; }).slice(0, 300).map(function (r) {
          var p = d.profiles[r.user_id] || {};
          return Object.assign({ name: p.name, avatar: p.avatar, equipped: p.equipped, xp: p.xp }, r);
        }));
      },
      publishLobby: function (row) { var d = db(); row.host_id = uid; row.updated_at = nowIso(); d.lobbies[row.code] = row; save(d); return later(null); },
      unpublishLobby: function (code) { var d = db(); delete d.lobbies[code]; save(d); return later(null); },
      lobbies: function () {
        var d = db(), cutoff = Date.now() - 60000;
        return later(Object.keys(d.lobbies).map(function (k) { return d.lobbies[k]; }).filter(function (l) { return (l.game || 'tetris') === GAME && new Date(l.updated_at).getTime() > cutoff; })
          .map(function (l) { var p = d.profiles[l.host_id] || {}; return Object.assign({ equipped: p.equipped, avatar: p.avatar, xp: p.xp }, l); }));
      }
    };
  }

  var B = ENABLED ? (MOCK ? MockBackend() : SupabaseBackend()) : null;

  /* =================================================================
     State
     ================================================================= */

  var S = {
    ready: false, failed: false, me: null,
    friends: [],        // [{ id, status: 'accepted' | 'incoming' | 'outgoing', profile }]
    notes: [],          // [{ id, kind, from, lobby, read, created_at, profile }]
    pollTimer: null,
    lobby: { publicOn: false, published: null, beat: null },
    readyFns: [], friendFns: []
  };
  function onReady(fn) { if (S.ready) fn(); else S.readyFns.push(fn); }
  function profileCache() { if (!S.cache) S.cache = {}; return S.cache; }
  window.addEventListener('storage', function (e) {
    if (e.key !== 'chat.game-profile-changed' || !S.ready || !B) return;
    B.getProfile(B.uid()).then(function (row) {
      if (!row) return;
      S.me = cleanProfile(row);
      G.Profile.set({ name: S.me.name, avatar: S.me.avatar });
      paintDock();
      if (App().profileChanged) App().profileChanged();
    }).catch(function (error) { console.warn('[social] profile refresh', error); });
  });
  window.addEventListener('storage', function (e) {
    if (e.key === 'chat.game-friends-changed' && S.ready) refreshFriends();
  });

  function start() {
    if (!B) return;
    B.init().then(function () {
      return B.getProfile(B.uid());
    }).then(function (row) {
      if (row) return row;
      // Chat invites a new visitor to create the shared profile in its own window.
      if (GAME === 'chat') return null;
      var local = G.Profile.get();
      return B.createProfile({ id: B.uid(), name: local.name, avatar: local.avatar, equipped: { banner: 'dusk' } });
    }).then(function (row) {
      if (!row) return;
      S.me = cleanProfile(row);
      S.ready = true;
      // The game's own name and picture follow the profile (it's what other players see in lobbies).
      G.Profile.set({ name: S.me.name, avatar: S.me.avatar });
      syncAchievements();
      refreshFriends();
      refreshNotes();
      S.pollTimer = setInterval(function () { if (!document.hidden) refreshNotes(); }, POLL_MS);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshNotes(); heartbeat(); } });
      heartbeat();
      setInterval(heartbeat, 60000);
      setInterval(function () { if (!document.hidden) refreshFriends(); }, 90000);
      checkBan();
      paintDock();
      S.readyFns.splice(0).forEach(function (fn) { try { fn(); } catch (e) { console.warn('[social]', e); } });
      handleUrl();
    }).catch(function (err) {
      S.failed = true;
      console.warn('[social] offline:', err);
      paintDock();
    });
  }

  // Tell friends where you are (this page, and a public lobby code if you're hosting one).
  function heartbeat() {
    if (!S.ready || document.hidden || S.me.status_kind === 'invisible' || S.noPresence) return;
    var lob = App().lobby && App().lobby(), lobby = lob && lob.role === 'host' && S.lobby.publicOn ? lob.code : null;
    B.updateProfile({ presence: { page: GAME, at: new Date().toISOString(), lobby: lobby } }).then(function (row) {
      S.me.presence = cleanProfile(row).presence;
    }).catch(function (e) { if (/presence|column/i.test(e.message || '')) S.noPresence = true; });
  }

  // A ban or mute shows once, so the player knows why posting or hosting fails.
  function checkBan() {
    if (!B.client) return;
    B.client().rpc('my_ban').then(function (r) {
      var b = r.data;
      if (!b) return;
      S.ban = b;
      G.banner((b.scope === 'all' ? 'You are banned' : 'You are muted in public chat') + (b.expires_at ? ' until ' + new Date(b.expires_at).toLocaleString('en-AU') : '') + (b.reason ? ': ' + b.reason : ''));
    }).catch(function () {});
  }

  function saveMe(patch) {
    return B.updateProfile(patch).then(function (row) { S.me = cleanProfile(row); paintDock(); localStorage.setItem('chat.game-profile-changed', String(Date.now())); return S.me; });
  }

  // XP and points for anything earned. Achievements already unlocked in this browser before profiles existed
  // count once too, because the profile's achievements map records which ones were rewarded.
  var granting = Promise.resolve();
  function grant(xp, points, reason) {
    if (!S.ready) return;
    granting = granting.then(function () {
      var before = levelOf(S.me.xp);
      return saveMe({ xp: S.me.xp + xp, points: S.me.points + points }).then(function () {
        var after = levelOf(S.me.xp);
        if (reason) G.banner('+' + fmt(xp) + ' XP · +' + fmt(points) + ' points' + (reason ? ' · ' + reason : ''));
        if (after > before) setTimeout(function () { G.banner('Level up! You\'re level ' + after); }, 1600);
      });
    }).catch(function (e) { console.warn('[social] grant', e); });
  }

  function syncAchievements() {
    if (!S.ready) return;
    granting = granting.then(function () {
      // Down: this game's achievements earned on another device or browser unlock here quietly.
      var mine = gameAch(S.me, GAME);
      if (ACH.importUnlocks) ACH.importUnlocks(mine);
      if (ACH.setSynced) ACH.setSynced(true);
      // Up: ones earned here go to the profile with their XP and points (once, on whichever device was first).
      var have = Object.assign({}, S.me.achievements), xp = 0, pts = 0, fresh = 0, moved = 0;
      if (GAME === 'tetris') Object.keys(have).forEach(function (k) {
        if (k.indexOf(':') === -1) { have[akey('tetris', k)] = have[akey('tetris', k)] || have[k]; delete have[k]; moved++; }
      });
      ACH.list().forEach(function (a) {
        if (a.unlocked && !mine[a.id]) {
          have[akey(GAME, a.id)] = a.unlocked;
          var r = ACH_REWARD[a.tier] || ACH_REWARD.bronze;
          xp += r[0]; pts += r[1]; fresh++;
        }
      });
      if (!fresh) return moved ? saveMe({ achievements: have }) : null;
      var before = levelOf(S.me.xp);
      return saveMe({ achievements: have, xp: S.me.xp + xp, points: S.me.points + pts }).then(function () {
        G.banner('+' + fmt(xp) + ' XP · +' + fmt(pts) + ' points from ' + (fresh === 1 ? 'an achievement' : fresh + ' achievements'));
        var after = levelOf(S.me.xp);
        if (after > before) setTimeout(function () { G.banner('Level up! You\'re level ' + after); }, 1600);
      });
    }).catch(function (e) { console.warn('[social] achievements', e); });
  }

  /* ---------- friends and notifications ---------- */

  function loadProfiles(ids) {
    var cache = profileCache(), need = ids.filter(function (i, k) { return ids.indexOf(i) === k && !cache[i]; });
    return (need.length ? B.getProfiles(need) : Promise.resolve([])).then(function (rows) {
      rows.forEach(function (r) { cache[r.id] = cleanProfile(r); });
      return ids.map(function (i) { return cache[i]; });
    });
  }

  function refreshFriends() {
    if (!S.ready) return Promise.resolve();
    var me = B.uid();
    return B.friendRows().then(function (rows) {
      var list = rows.map(function (f) {
        var other = f.requester === me ? f.addressee : f.requester;
        return { id: other, status: f.status === 'accepted' ? 'accepted' : (f.requester === me ? 'outgoing' : 'incoming') };
      });
      profileCache();
      list.forEach(function (f) { delete S.cache[f.id]; });   // friends' profiles are refetched so levels stay current
      return loadProfiles(list.map(function (f) { return f.id; })).then(function (profiles) {
        list.forEach(function (f, i) { f.profile = profiles[i] || cleanProfile({ id: f.id }); });
        S.friends = list;
        paintDock();
        if (Friends.isOpen()) Friends.render();
        S.friendFns.forEach(function (fn) { try { fn(S.friends.slice()); } catch (e) { console.warn('[social] friend listener', e); } });
      });
    }).catch(function (e) { console.warn('[social] friends', e); });
  }

  function friendState(id) {
    var f = S.friends.filter(function (x) { return x.id === id; })[0];
    return f ? f.status : null;
  }

  function refreshNotes() {
    if (!S.ready) return Promise.resolve();
    return B.notes().then(function (rows) {
      return loadProfiles(rows.map(function (n) { return n.from_id; })).then(function (profiles) {
        var known = {};
        S.notes.forEach(function (n) { known[n.id] = true; });
        var fresh = rows.filter(function (n) { return !known[n.id] && !n.read; });
        rows.forEach(function (n, i) { n.profile = profiles[i] || cleanProfile({ id: n.from_id }); });
        var hadNotes = S.notesLoaded;
        S.notes = rows;
        S.notesLoaded = true;
        if (hadNotes && fresh.length) {
          ringBell();
          var n = fresh[0];
          G.banner(n.kind === 'invite' ? n.profile.name + ' invited you to a game' : n.kind === 'friend_request' ? n.profile.name + ' sent you a friend request' : n.profile.name + ' accepted your friend request');
          if (fresh.some(function (x) { return x.kind !== 'invite'; })) refreshFriends();
        }
        paintDock();
        if (Bell.isOpen()) Bell.render();
      });
    }).catch(function (e) { console.warn('[social] notes', e); });
  }

  function addFriend(id) {
    if (!S.ready || id === B.uid()) return Promise.resolve();
    var state = friendState(id);
    if (state === 'incoming') return acceptFriend(id);
    if (state) return Promise.resolve();
    return B.requestFriend(id).then(function () {
      return B.sendNote(id, 'friend_request');
    }).then(function () { G.banner('Friend request sent'); return refreshFriends(); }).then(function () { localStorage.setItem('chat.game-friends-changed', String(Date.now())); })
      .catch(function (e) { G.banner(/duplicate/i.test(e.message || '') ? 'Already requested' : 'Couldn\'t send the request'); });
  }
  function acceptFriend(id) {
    return B.acceptFriend(id).then(function () { return B.sendNote(id, 'friend_accept'); })
      .then(function () { G.banner('Friend added'); return refreshFriends(); }).then(function () { localStorage.setItem('chat.game-friends-changed', String(Date.now())); })
      .catch(function () { G.banner('Couldn\'t accept that request'); });
  }
  function removeFriend(id) {
    return B.removeFriend(id).then(refreshFriends).then(function () { localStorage.setItem('chat.game-friends-changed', String(Date.now())); }).catch(function () { G.banner('Couldn\'t remove that friend'); });
  }

  function inviteToLobby(id) {
    var lob = App().lobby();
    if (!lob || !lob.code) { G.banner('Create or join a lobby first'); return; }
    B.sendNote(id, 'invite', lob.code, GAMES[GAME] ? GAME : null).then(function () { G.banner('Invite sent'); }).catch(function () { G.banner('Couldn\'t send the invite'); });
  }

  /* =================================================================
     Rendering helpers: names, avatars, badges, cards
     ================================================================= */

  // A name with the player's gradient style (and glow) applied.
  function nameSpan(p, cls) {
    var e = el('span', 'soc-name' + (cls ? ' ' + cls : ''), p.name);
    styleName(e, p.equipped);
    return e;
  }
  function styleName(e, equipped) {
    var eq = cleanEquipped(equipped), g = NAME_STYLES[eq.name];
    e.classList.toggle('soc-grad', !!g);
    e.classList.toggle('soc-glow', eq.glow);
    if (g) { e.style.setProperty('--g1', g[0]); e.style.setProperty('--g2', g[1]); }
    else { e.style.removeProperty('--g1'); e.style.removeProperty('--g2'); }
  }

  function avatarEl(p, size) {
    var wrap = el('span', 'soc-avatar');
    var eq = cleanEquipped(p.equipped);
    if (eq.frame) wrap.classList.add('frame-' + eq.frame);
    wrap.style.setProperty('--sz', size + 'px');
    wrap.appendChild(G.Profile.avatar({ name: p.name, avatar: p.avatar }, size));
    return wrap;
  }

  function badgeChip(id, withName) {
    var b = BADGE_BY[id];
    var c = el('span', 'soc-badge');
    c.style.setProperty('--b1', b.a);
    c.style.setProperty('--b2', b.b);
    c.title = b.name + ' · ' + b.desc;
    c.appendChild(el('i', null, b.sym));
    if (withName) c.appendChild(el('span', null, b.name));
    return c;
  }

  function bannerStyle(target, p) {
    var eq = cleanEquipped(p.equipped);
    if (eq.banner === 'custom' && p.banner) {
      target.style.background = 'center / cover no-repeat url("' + p.banner + '")';
    } else target.style.background = BANNERS[eq.banner] || BANNERS.dusk;
  }

  function levelBar(p) {
    var lv = levelOf(p.xp), lo = xpAt(lv), hi = xpAt(lv + 1);
    var wrap = el('div', 'soc-level');
    wrap.appendChild(el('span', 'soc-level-num', 'LV ' + lv));
    var bar = el('span', 'soc-level-bar');
    var fill = el('i');
    fill.style.width = Math.round((p.xp - lo) / (hi - lo) * 100) + '%';
    bar.appendChild(fill);
    wrap.appendChild(bar);
    wrap.appendChild(el('span', 'soc-level-xp', fmt(p.xp - lo) + ' / ' + fmt(hi - lo) + ' XP'));
    return wrap;
  }

  function profileLink(id) { return PROFILE_URL + '?profile=' + id; }
  // Your status (online / away / busy / invisible, plus a short message), shown to friends.
  function statusEditor() {
    var box = el('form', 'soc-status-edit');
    var kind = el('select', 'text-input');
    [['online', '🟢 Online'], ['away', '🌙 Away'], ['busy', '⛔ Busy'], ['invisible', '👻 Invisible']].forEach(function (o) {
      var op = el('option', null, o[1]); op.value = o[0]; if (S.me.status_kind === o[0]) op.selected = true; kind.appendChild(op);
    });
    var text = el('input', 'text-input');
    text.maxLength = 60; text.placeholder = 'Set a status, e.g. grinding Sprint 40'; text.value = S.me.status;
    var save = el('button', 'btn btn-sm btn-primary', 'Set');
    save.type = 'submit';
    box.appendChild(kind); box.appendChild(text); box.appendChild(save);
    box.addEventListener('submit', function (e) {
      e.preventDefault();
      var k = kind.value;
      saveMe({ status: text.value.trim().slice(0, 60), status_kind: k, presence: k === 'invisible' ? null : { page: GAME, at: new Date().toISOString(), lobby: null } })
        .then(function () { G.banner(k === 'invisible' ? 'You\'re invisible: friends see you as offline' : 'Status set'); })
        .catch(function (err) { G.banner(/status/.test(err.message || '') ? 'Statuses need the database update first' : 'Couldn\'t save your status'); });
    });
    return box;
  }

  function messagePlayer(p) {
    var code = p && p.equipped && p.equipped.chatCode;
    if (!code) return;
    if (window.ChatApp && window.ChatApp.openContact) window.ChatApp.openContact(code);
    else if (window.GameChatDock) window.GameChatDock.openTo(code);
    else window.open('chat.html#add/' + code, '_blank', 'noopener');
  }
  function inviteLink(code) { return PROFILE_URL + '?join=' + code; }

  /* =================================================================
     Modal shell (reuses the achievements glass panel)
     ================================================================= */

  function Modal(id, title, wide) {
    var root = null, body = null, head = null, onClose = null;
    function build() {
      root = el('div', 'ach-modal soc-modal hidden');
      root.id = id;
      root.innerHTML = '<div class="ach-backdrop" data-close></div>' +
        '<section class="ach-panel soc-panel" role="dialog" aria-modal="true">' +
        '<header class="soc-head"><h2></h2><div class="soc-head-extra"></div><button class="ach-close" type="button" aria-label="Close" data-close>×</button></header>' +
        '<div class="soc-body"></div></section>';
      if (wide) root.querySelector('.soc-panel').classList.add('wide');
      root.querySelector('h2').textContent = title;
      body = root.querySelector('.soc-body');
      head = root.querySelector('.soc-head-extra');
      document.body.appendChild(root);
      root.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); } }, true);
    }
    function open(closeFn) {
      if (!root) build();
      onClose = closeFn || null;
      root.classList.remove('hidden');
      document.documentElement.classList.add('ach-open');
      pauseGame();
      return body;
    }
    function close() {
      if (!root) return;
      root.classList.add('hidden');
      if (!document.querySelector('.ach-modal:not(.hidden)')) document.documentElement.classList.remove('ach-open');
      if (onClose) onClose();
    }
    function isOpen() { return !!root && !root.classList.contains('hidden'); }
    return { open: open, close: close, isOpen: isOpen, body: function () { return body; }, head: function () { return head; },
      title: function (t) { if (!root) build(); root.querySelector('h2').textContent = t; } };
  }

  // Opening a panel mid-game pauses offline games, like the achievements browser does.
  function pauseGame() { if (App().pause) App().pause(); }

  function notReady(body) {
    body.textContent = '';
    body.appendChild(el('p', 'soc-empty', S.failed ? 'Couldn\'t reach the profile server. Check your connection and reload.' : 'Signing you in…'));
  }

  /* =================================================================
     Profile card (view + edit)
     ================================================================= */

  var ProfileView = (function () {
    var modal = Modal('socProfile', 'Profile');
    var showing = null;

    function open(id) {
      var body = modal.open();
      if (!S.ready) { notReady(body); onReady(function () { if (modal.isOpen()) open(id); }); return; }
      id = id || B.uid();
      showing = id;
      modal.title(id === B.uid() ? 'Your profile' : 'Profile');
      body.textContent = '';
      body.appendChild(el('p', 'soc-empty', 'Loading…'));
      var get = id === B.uid() ? Promise.resolve(S.me) : B.getProfile(id).then(function (r) { return r ? cleanProfile(r) : null; });
      get.then(function (p) {
        if (showing !== id) return;
        if (!p) { body.textContent = ''; body.appendChild(el('p', 'soc-empty', 'That profile doesn\'t exist (or was deleted).')); return; }
        profileCache()[p.id] = p;
        render(p);
      }).catch(function () { body.textContent = ''; body.appendChild(el('p', 'soc-empty', 'Couldn\'t load that profile.')); });
    }

    function render(p) {
      var body = modal.body(), mine = p.id === B.uid();
      body.textContent = '';
      var card = el('article', 'soc-card');
      var banner = el('div', 'soc-banner');
      bannerStyle(banner, p);
      card.appendChild(banner);
      var top = el('div', 'soc-card-top');
      top.appendChild(avatarEl(p, 88));
      var lvBadge = el('span', 'soc-lv-pill', 'LV ' + levelOf(p.xp));
      top.appendChild(lvBadge);
      card.appendChild(top);

      var main = el('div', 'soc-card-main');
      var nameRow = el('div', 'soc-name-row');
      nameRow.appendChild(nameSpan(p, 'big'));
      if (p.badges.length) {
        var bRow = el('span', 'soc-badges');
        p.badges.forEach(function (b) { if (hasBadge(p, b)) bRow.appendChild(badgeChip(b)); });
        nameRow.appendChild(bRow);
      }
      main.appendChild(nameRow);
      // staff role, presence and status
      var pres = presenceOf(p), meta = el('div', 'soc-card-meta');
      if (p.role) meta.appendChild(el('span', 'soc-role-pill role-' + p.role, ROLE_NAMES[p.role]));
      var where = el('span', 'soc-presence ' + pres.kind); where.appendChild(el('i')); where.appendChild(document.createTextNode(pres.text)); meta.appendChild(where);
      main.appendChild(meta);
      if (p.status) main.appendChild(el('p', 'soc-status-line', '“' + p.status + '”'));
      if (p.tags.length) {
        var tags = el('div', 'soc-tags');
        p.tags.forEach(function (t) { tags.appendChild(el('span', 'soc-tag', t)); });
        main.appendChild(tags);
      }
      var sect = function (label) { var s = el('section', 'soc-sect'); s.appendChild(el('h3', null, label)); main.appendChild(s); return s; };
      if (p.bio) sect('About me').appendChild(el('p', 'soc-bio', p.bio));
      sect('Level').appendChild(levelBar(p));
      // Only this game's achievements show here (a Pong profile shows Pong's); badges and level are site-wide.
      var got = gameAch(p, GAME);
      var feats = gameFeatured(p, GAME).filter(function (id) { return got[id] && ACH.get(id); });
      if (feats.length) {
        var fs = sect('Featured achievements'), grid = el('div', 'soc-feats');
        feats.forEach(function (id) {
          var a = ACH.get(id), f = el('div', 'soc-feat tier-' + a.tier);
          f.appendChild(ACH.badge(id, 40));
          var t = el('div');
          t.appendChild(el('strong', null, a.name));
          t.appendChild(el('span', null, a.desc));
          f.appendChild(t);
          grid.appendChild(f);
        });
        fs.appendChild(grid);
      }
      // On /chat there's no game of its own, so show how far they are in each game instead.
      if (ACH === NO_ACH) {
        var allSec = sect('Achievements'), sum = el('div', 'soc-ach-summary');
        Object.keys(GAMES).forEach(function (g) {
          var A = ALL_ACH[g]; if (!A) return;
          var have = gameAch(p, g), n = A.list().filter(function (a) { return have[a.id]; }).length;
          var d = el('div'); d.appendChild(el('b', null, n + '/' + A.count().total)); d.appendChild(el('span', null, GAMES[g])); sum.appendChild(d);
        });
        allSec.appendChild(sum);
      }
      var gotIds = ACH.list().filter(function (a) { return got[a.id]; });
      if (gotIds.length) {
        var all = sect(GAME_NAME + ' achievements · ' + gotIds.length + '/' + ACH.count().total), wall = el('div', 'soc-ach-wall');
        gotIds.forEach(function (a) { var b = ACH.badge(a.id, 30); b.title = a.name + ': ' + a.desc; wall.appendChild(b); });
        all.appendChild(wall);
      }
      var stats = el('div', 'soc-stats');
      [[GAME_NAME + ' achievements', Object.keys(got).filter(function (id) { return ACH.get(id); }).length + '/' + ACH.count().total], ['Total XP', fmt(p.xp)], ['Member since', new Date(p.created_at).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })]]
        .forEach(function (s) { var d = el('div'); d.appendChild(el('b', null, s[1])); d.appendChild(el('span', null, s[0])); stats.appendChild(d); });
      main.appendChild(stats);

      var actions = el('div', 'soc-actions');
      if (mine) {
        actions.appendChild(btn('Edit profile', 'btn-primary', function () { edit(); }));
        actions.appendChild(btn('Copy profile link', null, function () { G.copyText(profileLink(p.id)); }));
        actions.appendChild(btn('Points shop · ' + fmt(S.me.points), null, function () { modal.close(); Shop.open(); }));
      } else {
        var st = friendState(p.id);
        if (st === 'accepted') {
          actions.appendChild(el('span', 'soc-pill ok', '✓ Friends'));
          if (p.equipped.chatCode) actions.appendChild(btn('Message', 'btn-primary', function () { modal.close(); messagePlayer(p); }));
          var lob = App().lobby();
          if (lob && lob.code) actions.appendChild(btn('Invite to my lobby', 'btn-primary', function () { inviteToLobby(p.id); }));
          actions.appendChild(btn('Remove friend', null, function () { removeFriend(p.id).then(function () { render(p); }); }));
        } else if (st === 'outgoing') {
          actions.appendChild(el('span', 'soc-pill', 'Request sent'));
          actions.appendChild(btn('Cancel request', null, function () { removeFriend(p.id).then(function () { render(p); }); }));
        } else if (st === 'incoming') {
          actions.appendChild(btn('Accept friend request', 'btn-primary', function () { acceptFriend(p.id).then(function () { render(p); }); }));
          actions.appendChild(btn('Decline', null, function () { removeFriend(p.id).then(function () { render(p); }); }));
        } else {
          actions.appendChild(btn('Add friend', 'btn-primary', function () { addFriend(p.id).then(function () { render(p); }); }));
        }
        actions.appendChild(btn('Copy profile link', null, function () { G.copyText(profileLink(p.id)); }));
      }
      main.appendChild(actions);
      card.appendChild(main);
      body.appendChild(card);
    }

    /* ---------- editor ---------- */

    function edit() {
      var p = JSON.parse(JSON.stringify(S.me)), body = modal.body();
      modal.title('Edit profile');
      body.textContent = '';
      var form = el('form', 'soc-edit');
      var preview = el('div', 'soc-edit-preview');
      form.appendChild(preview);
      function paintPreview() {
        preview.textContent = '';
        var b = el('div', 'soc-banner small');
        bannerStyle(b, p);
        preview.appendChild(b);
        var row = el('div', 'soc-edit-who');
        row.appendChild(avatarEl(p, 56));
        row.appendChild(nameSpan(p, 'big'));
        preview.appendChild(row);
      }

      function field(label, input, note) {
        var f = el('label', 'soc-field');
        f.appendChild(el('span', 'option-label', label));
        f.appendChild(input);
        if (note) f.appendChild(el('span', 'soc-note', note));
        form.appendChild(f);
        return f;
      }

      var name = el('input', 'text-input');
      name.maxLength = 16; name.value = p.name; name.required = true;
      name.addEventListener('input', function () { p.name = name.value.trim() || 'Player'; paintPreview(); });
      field('Name', name);

      var picRow = el('div', 'chip-row');
      picRow.appendChild(btn('Upload picture', null, function () {
        G.pickFile('image/*').then(function (file) {
          if (!file) return;
          return G.readImageFile(file, 96, { square: true }).then(function (data) { p.avatar = data; paintPreview(); });
        }).catch(function (err) { G.banner(err.message); });
      }));
      picRow.appendChild(btn('Remove picture', null, function () { p.avatar = null; paintPreview(); }));
      field('Profile picture', picRow);

      var bio = el('textarea', 'text-input soc-bio-input');
      bio.maxLength = 190; bio.rows = 3; bio.value = p.bio; bio.placeholder = 'Say something about yourself';
      var bioNote;
      bio.addEventListener('input', function () { p.bio = bio.value; bioNote.textContent = (190 - bio.value.length) + ' characters left'; });
      bioNote = field('About me', bio, (190 - p.bio.length) + ' characters left').querySelector('.soc-note');

      var tags = el('input', 'text-input');
      tags.value = p.tags.join(', ');
      tags.placeholder = 'e.g. aussie, t-spin enjoyer, chill';
      tags.addEventListener('input', function () { p.tags = tags.value.split(',').map(function (t) { return t.trim().slice(0, 16); }).filter(Boolean).slice(0, 5); });
      field('Tags', tags, 'Up to 5, separated by commas');

      // Banners: owned presets, plus your own picture once bought.
      var banners = el('div', 'soc-pick-row');
      SHOP.filter(function (i) { return i.kind === 'banner'; }).forEach(function (i) {
        var have = owns(S.me, i.id);
        var b = el('button', 'soc-swatch' + (p.equipped.banner === i.value ? ' on' : '') + (have ? '' : ' locked'));
        b.type = 'button';
        b.title = have ? i.name : i.name + ' · ' + fmt(i.price) + ' points in the shop';
        if (i.value === 'custom') { b.textContent = have ? (p.banner ? '✓ Picture' : 'Upload') : '🔒 Picture'; }
        else b.style.background = BANNERS[i.value];
        b.addEventListener('click', function () {
          if (!have) { G.banner(i.name + ' banner is in the points shop'); return; }
          if (i.value === 'custom') {
            G.pickFile('image/*').then(function (file) {
              if (!file) return;
              return G.readImageFile(file, 600, {}).then(function (data) {
                return shrinkBanner(data).then(function (small) { p.banner = small; p.equipped.banner = 'custom'; markOn(banners, b); paintPreview(); });
              });
            }).catch(function (err) { G.banner(err.message || 'Couldn\'t use that picture'); });
            return;
          }
          p.equipped.banner = i.value; markOn(banners, b); paintPreview();
        });
        banners.appendChild(b);
      });
      field('Banner', banners);

      var names = el('div', 'soc-pick-row');
      var none = el('button', 'soc-name-opt' + (!p.equipped.name ? ' on' : ''), 'Plain');
      none.type = 'button';
      none.addEventListener('click', function () { p.equipped.name = null; markOn(names, none); paintPreview(); });
      names.appendChild(none);
      SHOP.filter(function (i) { return i.kind === 'name'; }).forEach(function (i) {
        var have = owns(S.me, i.id);
        var b = el('button', 'soc-name-opt' + (p.equipped.name === i.value ? ' on' : '') + (have ? '' : ' locked'));
        b.type = 'button';
        var s = el('span', null, i.name);
        styleName(s, { name: i.value });
        b.appendChild(s);
        if (!have) b.title = fmt(i.price) + ' points in the shop';
        b.addEventListener('click', function () { if (!have) { G.banner(i.name + ' is in the points shop'); return; } p.equipped.name = i.value; markOn(names, b); paintPreview(); });
        names.appendChild(b);
      });
      if (owns(S.me, 'name_glow')) {
        var glow = el('button', 'soc-name-opt' + (p.equipped.glow ? ' on' : ''), 'Glow');
        glow.type = 'button';
        glow.addEventListener('click', function () { p.equipped.glow = !p.equipped.glow; glow.classList.toggle('on', p.equipped.glow); paintPreview(); });
        names.appendChild(glow);
      }
      field('Name style', names);

      var frames = el('div', 'soc-pick-row');
      var noFrame = el('button', 'soc-name-opt' + (!p.equipped.frame ? ' on' : ''), 'None');
      noFrame.type = 'button';
      noFrame.addEventListener('click', function () { p.equipped.frame = null; markOn(frames, noFrame); paintPreview(); });
      frames.appendChild(noFrame);
      SHOP.filter(function (i) { return i.kind === 'frame'; }).forEach(function (i) {
        var have = owns(S.me, i.id);
        var b = el('button', 'soc-name-opt' + (p.equipped.frame === i.value ? ' on' : '') + (have ? '' : ' locked'), i.name);
        b.type = 'button';
        b.addEventListener('click', function () { if (!have) { G.banner(i.name + ' frame is in the points shop'); return; } p.equipped.frame = i.value; markOn(frames, b); paintPreview(); });
        frames.appendChild(b);
      });
      field('Avatar frame', frames);

      // Badges: choose up to three you've earned or bought.
      var badges = el('div', 'soc-pick-row');
      BADGES.forEach(function (b) {
        var have = hasBadge(S.me, b.id);
        var chip = el('button', 'soc-badge-opt' + (p.badges.indexOf(b.id) !== -1 ? ' on' : '') + (have ? '' : ' locked'));
        chip.type = 'button';
        chip.appendChild(badgeChip(b.id, true));
        chip.title = b.desc;
        chip.addEventListener('click', function () {
          if (!have) { G.banner(b.name + ': ' + b.desc); return; }
          var at = p.badges.indexOf(b.id);
          if (at !== -1) p.badges.splice(at, 1);
          else if (p.badges.length >= 3) { G.banner('You can show 3 badges'); return; }
          else p.badges.push(b.id);
          chip.classList.toggle('on', at === -1);
        });
        badges.appendChild(chip);
      });
      field('Badges to show', badges, 'Pick up to 3. Locked ones show how to earn them.');

      // Featured achievements: up to three unlocked ones from this game (the other game's picks are kept).
      var feats = el('div', 'soc-pick-row soc-feat-pick');
      var unlocked = ACH.list().filter(function (a) { return a.unlocked; });
      if (!unlocked.length) feats.appendChild(el('span', 'soc-note', 'Unlock achievements to feature them here.'));
      unlocked.forEach(function (a) {
        var k = akey(GAME, a.id);
        var chip = el('button', 'soc-ach-opt' + (p.featured.indexOf(k) !== -1 ? ' on' : ''));
        chip.type = 'button';
        chip.title = a.desc;
        chip.appendChild(ACH.badge(a.id, 24));
        chip.appendChild(el('span', null, a.name));
        chip.addEventListener('click', function () {
          var at = p.featured.indexOf(k);
          if (at !== -1) p.featured.splice(at, 1);
          else if (gameFeatured(p, GAME).length >= 3) { G.banner('You can feature 3 achievements per game'); return; }
          else p.featured.push(k);
          chip.classList.toggle('on', at === -1);
        });
        feats.appendChild(chip);
      });
      field('Featured achievements', feats);

      var actions = el('div', 'soc-actions');
      var saveBtn = el('button', 'btn btn-sm btn-primary', 'Save');
      saveBtn.type = 'submit';
      actions.appendChild(saveBtn);
      actions.appendChild(btn('Cancel', null, function () { modal.title('Your profile'); render(S.me); }));
      form.appendChild(actions);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        saveBtn.disabled = true;
        var clean = cleanProfile(Object.assign({}, p, { id: S.me.id }));
        saveMe({ name: clean.name, avatar: clean.avatar, banner: clean.banner, bio: clean.bio, tags: clean.tags, badges: clean.badges, featured: clean.featured, equipped: clean.equipped })
          .then(function (me) {
            G.Profile.set({ name: me.name, avatar: me.avatar });
            if (App().profileChanged) App().profileChanged();
            G.banner('Profile saved');
            modal.title('Your profile');
            render(me);
          }).catch(function (err) { saveBtn.disabled = false; G.banner('Couldn\'t save: ' + (err.message || 'try again')); });
      });
      body.appendChild(form);
      paintPreview();
    }

    function markOn(row, b) { Array.prototype.forEach.call(row.children, function (c) { c.classList.toggle('on', c === b); }); }

    return { open: open, close: modal.close };
  })();

  // Banners are stored in the profile row, so keep them small: 600x200 JPEG, quality stepped down to fit.
  function shrinkBanner(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var W = 600, H = 200, cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        var s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s;
        cv.getContext('2d').drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        for (var q = 0.82; q >= 0.4; q -= 0.12) {
          var out = cv.toDataURL('image/jpeg', q);
          if (out.length < 110000) return resolve(out);
        }
        reject(new Error('That picture is too detailed to fit. Try another.'));
      };
      img.onerror = function () { reject(new Error('Couldn\'t read that picture')); };
      img.src = dataUrl;
    });
  }

  /* =================================================================
     Friends
     ================================================================= */

  var Friends = (function () {
    var modal = Modal('socFriends', 'Friends');
    var tab = 'friends';

    function open() {
      var body = modal.open();
      if (!S.ready) { notReady(body); onReady(function () { if (modal.isOpen()) open(); }); return; }
      render();
      refreshFriends();
    }

    function row(f) {
      var p = f.profile, li = el('li', 'soc-row');
      var who = el('button', 'soc-who');
      who.type = 'button';
      who.appendChild(avatarEl(p, 36));
      var t = el('span', 'soc-who-text');
      t.appendChild(nameSpan(p));
      var pres = presenceOf(p);
      var line = el('small', 'soc-presence ' + (f.status === 'accepted' ? pres.kind : 'offline'));
      line.appendChild(el('i'));
      line.appendChild(document.createTextNode(f.status === 'accepted' ? pres.text + (p.status ? ' · ' + p.status : '') : 'Level ' + levelOf(p.xp)));
      t.appendChild(line);
      who.appendChild(t);
      who.addEventListener('click', function () { modal.close(); ProfileView.open(p.id); });
      li.appendChild(who);
      var act = el('span', 'soc-row-actions');
      if (f.status === 'accepted') {
        var lob = App().lobby();
        if (pres.on && pres.lobby && GAMES[pres.page]) act.appendChild(btn('Join ' + GAMES[pres.page], null, function () { modal.close(); joinGame(pres.page, pres.lobby); }));
        if (p.equipped.chatCode) act.appendChild(btn('Message', 'btn-primary', function () { modal.close(); messagePlayer(p); }));
        if (lob && lob.code) act.appendChild(btn('Invite', 'btn-primary', function () { inviteToLobby(p.id); }));
        act.appendChild(btn('Remove', null, function () { removeFriend(p.id); }));
      } else if (f.status === 'incoming') {
        act.appendChild(btn('Accept', 'btn-primary', function () { acceptFriend(p.id); }));
        act.appendChild(btn('Decline', null, function () { removeFriend(p.id); }));
      } else {
        act.appendChild(el('span', 'soc-pill', 'Sent'));
        act.appendChild(btn('Cancel', null, function () { removeFriend(p.id); }));
      }
      li.appendChild(act);
      return li;
    }

    function render() {
      var body = modal.body();
      body.textContent = '';
      var friends = S.friends.filter(function (f) { return f.status === 'accepted'; }).sort(function (a, b) {
        return (presenceOf(b.profile).on - presenceOf(a.profile).on) || a.profile.name.localeCompare(b.profile.name);
      });
      var pending = S.friends.filter(function (f) { return f.status !== 'accepted'; });
      body.appendChild(statusEditor());
      var tabs = el('div', 'soc-tabs');
      [['friends', 'Friends · ' + friends.length], ['requests', 'Requests · ' + pending.length]].forEach(function (x) {
        var c = el('button', 'chip' + (tab === x[0] ? ' active' : ''), x[1]);
        c.type = 'button';
        c.addEventListener('click', function () { tab = x[0]; render(); });
        tabs.appendChild(c);
      });
      body.appendChild(tabs);

      var add = el('form', 'soc-add');
      var input = el('input', 'text-input');
      input.placeholder = 'Paste a profile link to add someone';
      input.setAttribute('aria-label', 'Profile link');
      add.appendChild(input);
      var go = el('button', 'btn btn-sm btn-primary', 'Add');
      go.type = 'submit';
      add.appendChild(go);
      add.addEventListener('submit', function (e) {
        e.preventDefault();
        var m = input.value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (!m) { G.banner('That isn\'t a profile link'); return; }
        if (m[0].toLowerCase() === B.uid()) { G.banner('That\'s you!'); return; }
        input.value = '';
        modal.close();
        ProfileView.open(m[0].toLowerCase());
      });
      body.appendChild(add);
      var share = el('p', 'soc-note soc-share');
      share.appendChild(document.createTextNode('Share your link so people can add you: '));
      var link = el('button', 'soc-link', profileLink(B.uid()));
      link.type = 'button';
      link.addEventListener('click', function () { G.copyText(profileLink(B.uid())); });
      share.appendChild(link);
      body.appendChild(share);

      var list = el('ul', 'soc-list');
      var items = tab === 'friends' ? friends : pending;
      items.forEach(function (f) { list.appendChild(row(f)); });
      body.appendChild(list);
      if (!items.length) body.appendChild(el('p', 'soc-empty', tab === 'friends' ? 'No friends yet. Send someone your profile link.' : 'No pending requests.'));
    }

    return { open: open, render: render, isOpen: function () { return modal.isOpen(); } };
  })();

  /* =================================================================
     The bell (always visible) and the dock beside it
     ================================================================= */

  var dock = null;
  function buildDock() {
    dock = el('div', 'soc-dock');
    dock.innerHTML =
      '<button class="soc-dock-btn soc-dock-me" type="button" aria-label="Your profile" title="Your profile"></button>' +
      '<button class="soc-dock-btn" type="button" data-act="friends" aria-label="Friends" title="Friends">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></g></svg>' +
      '<span class="soc-count hidden" data-count="friends"></span></button>' +
      '<button class="soc-dock-btn soc-bell" type="button" data-act="bell" aria-label="Notifications" title="Notifications">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></g></svg>' +
      '<span class="soc-count hidden" data-count="bell"></span></button>';
    document.body.appendChild(dock);
    dock.querySelector('.soc-dock-me').addEventListener('click', function () { ProfileView.open(); });
    dock.querySelector('[data-act="friends"]').addEventListener('click', function () { Friends.open(); });
    dock.querySelector('[data-act="bell"]').addEventListener('click', function (e) { e.stopPropagation(); Bell.toggle(); });
  }

  function paintDock() {
    if (!dock) return;
    var me = dock.querySelector('.soc-dock-me');
    me.textContent = '';
    if (S.me) {
      me.appendChild(avatarEl(S.me, 26));
      var lv = el('span', 'soc-dock-lv', levelOf(S.me.xp));
      me.appendChild(lv);
    } else me.appendChild(el('span', 'soc-dock-dot', S.failed ? '!' : '…'));
    var unread = S.notes.filter(function (n) { return !n.read; }).length;
    var reqs = S.friends.filter(function (f) { return f.status === 'incoming'; }).length;
    setCount('bell', unread);
    setCount('friends', reqs);
  }
  function setCount(which, n) {
    var c = dock.querySelector('[data-count="' + which + '"]');
    c.textContent = n > 9 ? '9+' : String(n);
    c.classList.toggle('hidden', !n);
  }
  function ringBell() {
    var b = dock && dock.querySelector('.soc-bell');
    if (!b) return;
    b.classList.remove('ring');
    void b.offsetWidth;
    b.classList.add('ring');
    if (G.Sound && G.Sound.beep) G.Sound.beep(988, 0.07, 'triangle', 0.04);
  }

  var Bell = (function () {
    var pop = null;
    function isOpen() { return !!pop && !pop.classList.contains('hidden'); }
    function toggle() { if (isOpen()) close(); else open(); }
    function open() {
      if (!pop) {
        pop = el('div', 'soc-pop hidden');
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Notifications');
        dock.appendChild(pop);
        document.addEventListener('click', function (e) { if (isOpen() && !e.target.closest('.soc-pop, .soc-bell')) close(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });
      }
      pop.classList.remove('hidden');
      render();
      if (!S.ready) return;
      // Fetch the latest first; everything shown stays highlighted as new until the bell closes.
      refreshNotes().then(function () {
        if (!S.notes.some(function (n) { return !n.read; })) return;
        return B.markRead().then(function () { S.notes.forEach(function (n) { n.seen = !n.read; n.read = true; }); paintDock(); });
      });
    }
    function close() { if (pop) pop.classList.add('hidden'); if (S.ready) render(); }
    function render() {
      if (!pop) return;
      pop.textContent = '';
      var head = el('div', 'soc-pop-head');
      head.appendChild(el('strong', null, 'Notifications'));
      if (S.ready) head.appendChild(btn('Friends', null, function () { close(); Friends.open(); }));
      pop.appendChild(head);
      if (!S.ready) { pop.appendChild(el('p', 'soc-empty', S.failed ? 'Couldn\'t reach the profile server.' : 'Signing you in…')); return; }
      if (!S.notes.length) { pop.appendChild(el('p', 'soc-empty', 'Nothing yet. Friend requests and game invites show up here.')); return; }
      var list = el('ul', 'soc-pop-list');
      S.notes.forEach(function (n) {
        var li = el('li', 'soc-note-row' + (n.read && !n.seen ? '' : ' unread'));
        var who = el('button', 'soc-who');
        who.type = 'button';
        who.appendChild(avatarEl(n.profile, 30));
        var t = el('span', 'soc-who-text');
        var line = el('span');
        line.appendChild(nameSpan(n.profile));
        line.appendChild(document.createTextNode(noteText(n)));
        t.appendChild(line);
        t.appendChild(el('small', null, ago(n.created_at) + (n.kind === 'invite' ? ' · lobby ' + n.lobby : '')));
        who.appendChild(t);
        who.addEventListener('click', function () { close(); ProfileView.open(n.from_id); });
        li.appendChild(who);
        var act = el('span', 'soc-row-actions');
        if (n.kind === 'invite' && n.lobby) act.appendChild(btn('Join', 'btn-primary', function () { close(); B.clearNote(n.id).then(refreshNotes); joinGame(n.game, n.lobby); }));
        if (n.kind === 'mention') act.appendChild(btn('View', 'btn-primary', function () { close(); B.clearNote(n.id).then(refreshNotes); openPublicChat(); }));
        if (n.kind === 'friend_request' && friendState(n.from_id) === 'incoming') {
          act.appendChild(btn('Accept', 'btn-primary', function () { acceptFriend(n.from_id).then(function () { return B.clearNote(n.id); }).then(refreshNotes); }));
        }
        var x = el('button', 'soc-x', '×');
        x.type = 'button';
        x.setAttribute('aria-label', 'Dismiss');
        x.addEventListener('click', function () { B.clearNote(n.id).then(refreshNotes); });
        act.appendChild(x);
        li.appendChild(act);
        list.appendChild(li);
      });
      pop.appendChild(list);
    }
    return { toggle: toggle, isOpen: isOpen, render: render };
  })();

  function joinCode(code) {
    if (App().join) App().join(code);
  }

  function noteText(n) {
    if (n.kind === 'invite') return ' invited you to ' + (GAMES[n.game] ? 'play ' + GAMES[n.game] : 'a game');
    if (n.kind === 'friend_request') return ' wants to be friends';
    if (n.kind === 'friend_accept') return ' accepted your friend request';
    if (n.kind === 'mention') return ' mentioned you in public chat';
    if (n.kind === 'staff') return ': you\'ve been given a staff role. Thanks for helping out!';
    return '';
  }

  // Invites work across games: an invite to Pong opened on the Tetris page goes to Pong's lobby.
  function pageUrl(game) { return /\.html$/.test(location.pathname) ? game + '.html' : game; }
  function joinGame(game, code) {
    if (!game || game === GAME) return joinCode(code);
    location.href = pageUrl(game) + '?join=' + encodeURIComponent(code);
  }
  function openPublicChat() {
    if (GAME === 'chat') { location.hash = '#public'; return; }
    window.open(pageUrl('chat') + '#public', '_blank', 'noopener');
  }

  /* =================================================================
     Public leaderboard
     ================================================================= */

  var MODES = [
    { id: 'marathon', name: 'Marathon', asc: false, unit: 'score' },
    { id: 'sprint', name: 'Sprint 40', asc: true, unit: 'time' },
    { id: 'ultra', name: 'Ultra 2:00', asc: false, unit: 'score' },
    { id: 'dig', name: 'Dig', asc: true, unit: 'time' },
    { id: 'survival', name: 'Survival', asc: false, unit: 'time' },
    { id: 'versus', name: 'Versus', asc: false, unit: 'score' }
  ];
  var MODE_BY = {};
  MODES.forEach(function (m) { MODE_BY[m.id] = m; });
  function clockTenths(t) {
    var s = t / 10, m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }
  // The skull list and pixel icons come from tetris.js, so the leaderboard always matches the game.
  function skullList() { return App().skulls ? App().skulls() : []; }
  function skullIcon(id) { return App().skullIcon ? App().skullIcon(id) : el('span'); }
  function skullName(id) { var s = skullList().filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }
  var CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------- leaderboard ----------
     One board per game, filtered by tags along the top. Each tag is a simple on/off (or pick) with an
     optional dropdown for fine-tuning. Click a run for its details. The tags, query, row text and details
     pane come from the game's spec (TETRIS_BOARD / PONG_BOARD below); the board itself is shared. */

  // Tetris: game type, Solo / Versus (online, vs CPU, rules), Skulls (tick exactly which skulls a run used).
  var TETRIS_BOARD = {
    init: function () { return { mode: 'marathon', kinds: { online: true, cpu: true }, versusType: null, skullsOn: null, skulls: [] }; },  // skullsOn: null any, false none (ranked), true with skulls
    openWith: function (F, m) { if (MODE_BY[m]) F.mode = m; },
    tags: function (F, K) {
      var tag = K.tag, check = K.check, radio = K.radio, closeDrops = K.closeDrops, refresh = K.refresh, bar = K.bar;
      var versus = F.mode === 'versus';
      // game type: the label shows the current one; the dropdown picks another
      var gtLabel = versus ? 'Any game type' : MODE_BY[F.mode].name;
      bar.appendChild(tag(gtLabel, !versus, function () { if (versus) { F.mode = 'marathon'; refresh(); } }, versus ? null : function (drop) {
        drop.appendChild(el('div', 'lb-drop-title', 'Game type'));
        MODES.filter(function (m) { return m.id !== 'versus'; }).forEach(function (m) {
          drop.appendChild(radio('lb-mode', m.name, F.mode === m.id, function () { F.mode = m.id; closeDrops(); refresh(); }));
        });
      }));
      bar.appendChild(tag('Solo', !versus, function () { if (versus) { F.mode = 'marathon'; refresh(); } }));
      var vLabel = 'Versus' + (versus && !(F.kinds.online && F.kinds.cpu) ? (F.kinds.online ? ' · online' : ' · vs CPU') : '') +
        (versus && F.versusType ? (F.versusType === 'elim' ? ' · elimination' : ' · last standing') : '');
      bar.appendChild(tag(vLabel, versus, function () { F.mode = versus ? 'marathon' : 'versus'; refresh(); }, function (drop) {
        drop.appendChild(el('div', 'lb-drop-title', 'Opponents'));
        drop.appendChild(check('Online players', F.kinds.online, function (v) { F.kinds.online = v || !F.kinds.cpu; F.mode = 'versus'; refresh(true); }));
        drop.appendChild(check('vs CPU', F.kinds.cpu, function (v) { F.kinds.cpu = v || !F.kinds.online; F.mode = 'versus'; refresh(true); }));
        drop.appendChild(el('div', 'lb-drop-title', 'Rules'));
        [[null, 'Any rules'], ['last', 'Last Standing'], ['elim', 'Elimination']].forEach(function (x) {
          drop.appendChild(radio('lb-vt', x[1], F.versusType === x[0], function () { F.versusType = x[0]; F.mode = 'versus'; refresh(true); }));
        });
      }));
      var skLabel = el('span', 'lb-sk-label');
      skLabel.appendChild(el('span', null, F.skullsOn ? (F.skulls.length ? 'Skulls · ' + F.skulls.length : 'Skulls on') : F.skullsOn === false ? 'No skulls' : 'Any skulls'));
      // click cycles: any skulls -> no skulls (ranked) -> skulls on -> any; the dropdown picks exact skulls
      bar.appendChild(tag(skLabel, F.skullsOn !== null, function () { F.skullsOn = F.skullsOn === null ? false : F.skullsOn === false ? true : null; if (!F.skullsOn) F.skulls = []; refresh(); }, function (drop) {
        drop.classList.add('wide');
        fillSkulls(drop);
      }));
      function fillSkulls(drop) {
        var head = el('div', 'lb-drop-head');
        head.appendChild(el('div', 'lb-drop-title', 'Runs that used every ticked skull'));
        head.appendChild(btn('Clear', null, function () { F.skulls = []; drop.textContent = ''; fillSkulls(drop); refresh(true); }));
        drop.appendChild(head);
        [['mod', 'Modifiers'], ['power', 'Power-ups'], ['attack', 'Versus attacks']].forEach(function (g) {
          var list = skullList().filter(function (s) { return s.cat === g[0]; });
          if (!list.length) return;
          drop.appendChild(el('div', 'lb-drop-sub', g[1]));
          var grid = el('div', 'lb-skull-grid');
          list.forEach(function (s) {
            grid.appendChild(check(s.name, F.skulls.indexOf(s.id) !== -1, function (v) {
              var at = F.skulls.indexOf(s.id);
              if (v && at === -1) F.skulls.push(s.id);
              if (!v && at !== -1) F.skulls.splice(at, 1);
              F.skullsOn = true;
              refresh(true);
            }, skullIcon(s.id)));
          });
          drop.appendChild(grid);
        });
      }
    },
    describe: function (F) {
      var m = MODE_BY[F.mode];
      return [F.mode === 'versus' ? 'Versus runs ranked by points' : m.name + (m.unit === 'time' ? (m.asc ? ', fastest first' : ', longest first') : ', highest score first'),
        F.skullsOn ? (F.skulls.length ? 'with ' + F.skulls.map(skullName).join(', ') : 'skull runs only') : F.skullsOn === false ? 'no skulls (ranked)' : 'with or without skulls'];
    },
    query: function (F) {
      return { mode: F.mode, kinds: F.mode === 'versus' ? ['online', 'cpu'].filter(function (k) { return F.kinds[k]; }) : ['solo'],
        versusType: F.mode === 'versus' ? F.versusType : null, skullsOn: F.skullsOn, skulls: F.skulls.slice(), asc: MODE_BY[F.mode].asc };
    },
    value: function (r) { var m = MODE_BY[r.mode]; return m && m.unit === 'time' ? clockTenths(r.value) : fmt(r.value); },
    sub: function (r, p, sub) {
      if (r.skulls && r.skulls.length) {
        var icons = el('span', 'lb-run-skulls');
        r.skulls.slice(0, 5).forEach(function (id) { icons.appendChild(skullIcon(id)); });
        if (r.skulls.length > 5) icons.appendChild(el('b', null, '+' + (r.skulls.length - 5)));
        sub.appendChild(icons);
      }
      sub.appendChild(document.createTextNode(r.mode === 'versus' ? (r.won ? 'Won' : 'Place ' + (r.place || '–')) + ' · ' + ((r.players || []).length || 2) + ' players' : 'Level ' + levelOf(p.xp)));
    },
    meta: function (r) { return (r.multiplier && Math.abs(r.multiplier - 1) > 0.01 ? '×' + r.multiplier + ' · ' : '') + (r.mode === 'marathon' ? 'lvl ' + r.level + ' · ' : '') + r.lines + ' lines · ' + ago(r.created_at); },
    kicker: function (r) { return r.mode === 'versus' ? (r.kind === 'cpu' ? 'Versus CPU' : 'Online versus') + (r.versus_type ? ' · ' + (r.versus_type === 'elim' ? 'Elimination' : 'Last Standing') : '') : 'Solo · ' + MODE_BY[r.mode].name; },
    stats: function (r) {
      return [['Points', fmt(r.score)], ['Lines', fmt(r.lines)], [r.mode === 'versus' ? 'Result' : 'Level', r.mode === 'versus' ? (r.won ? 'Won' : 'Place ' + (r.place || '–')) : String(r.level)],
        ['Time', clockTenths(Math.round((r.elapsed || 0) / 100))], ['Multiplier', '×' + (r.multiplier || 1)], ['Skulls', String((r.skulls || []).length)]];
    },
    sections: function (r, pane) {
      var sk = el('section', 'soc-sect');
      sk.appendChild(el('h3', null, 'Skulls on'));
      if (!r.skulls || !r.skulls.length) sk.appendChild(el('p', 'soc-note', 'None. A ranked run.'));
      else {
        var grid = el('div', 'lb-pane-skulls');
        r.skulls.forEach(function (id) { var s = el('span', 'lb-pane-skull'); s.appendChild(skullIcon(id)); s.appendChild(el('span', null, skullName(id))); grid.appendChild(s); });
        sk.appendChild(grid);
      }
      pane.appendChild(sk);
    }
  };

  // Pong: two boards (longest rally, fastest win), filtered by opponent (CPU difficulty or online) and match length.
  // A Pong run: mode 'pong', kind 'cpu' | 'online', value = longest rally, elapsed = match length (ms), score/lines =
  // your points / theirs, info = { difficulty, target, ball, opponent }.
  var PONG_DIFFS = [['easy', 'Easy CPU'], ['normal', 'Normal CPU'], ['hard', 'Hard CPU']];
  var PONG_TARGETS = [['5', 'First to 5'], ['7', 'First to 7'], ['11', 'First to 11'], ['inf', 'Endless']];
  var PONG_BOARD = {
    init: function () { return { board: 'rally', opp: 'any', target: null }; },
    openWith: function (F, m) { if (m === 'rally' || m === 'fastest') F.board = m; },
    tags: function (F, K) {
      var tag = K.tag, radio = K.radio, closeDrops = K.closeDrops, refresh = K.refresh, bar = K.bar;
      bar.appendChild(tag('Longest rally', F.board === 'rally', function () { F.board = 'rally'; refresh(); }));
      bar.appendChild(tag('Fastest win', F.board === 'fastest', function () { F.board = 'fastest'; if (F.target === 'inf') F.target = null; refresh(); }));
      var oppName = F.opp === 'any' ? 'Any opponent' : F.opp === 'online' ? 'Online' : PONG_DIFFS.filter(function (d) { return d[0] === F.opp; })[0][1];
      bar.appendChild(tag(oppName, F.opp !== 'any', function () { F.opp = F.opp === 'any' ? 'online' : 'any'; refresh(); }, function (drop) {
        drop.appendChild(el('div', 'lb-drop-title', 'Opponent'));
        [['any', 'Anyone']].concat(PONG_DIFFS, [['online', 'Online players']]).forEach(function (o) {
          drop.appendChild(radio('lb-opp', o[1], F.opp === o[0], function () { F.opp = o[0]; closeDrops(); refresh(); }));
        });
      }));
      var tName = F.target ? PONG_TARGETS.filter(function (t) { return t[0] === F.target; })[0][1] : 'Any length';
      bar.appendChild(tag(tName, !!F.target, function () { F.target = F.target ? null : '7'; refresh(); }, function (drop) {
        drop.appendChild(el('div', 'lb-drop-title', 'Match length'));
        [[null, 'Any length']].concat(PONG_TARGETS.filter(function (t) { return F.board !== 'fastest' || t[0] !== 'inf'; })).forEach(function (t) {
          drop.appendChild(radio('lb-target', t[1], F.target === t[0], function () { F.target = t[0]; closeDrops(); refresh(); }));
        });
      }));
    },
    describe: function (F) {
      return [F.board === 'rally' ? 'Longest rally in a match' : 'Quickest match wins',
        F.opp === 'any' ? 'any opponent' : F.opp === 'online' ? 'against online players' : 'against the ' + F.opp + ' CPU',
        F.target ? PONG_TARGETS.filter(function (t) { return t[0] === F.target; })[0][1].toLowerCase() : 'any match length'];
    },
    query: function (F) {
      var info = {};
      if (F.opp !== 'any' && F.opp !== 'online') info.difficulty = F.opp;
      if (F.target) info.target = F.target;
      return { mode: 'pong', kinds: F.opp === 'any' ? ['cpu', 'online'] : F.opp === 'online' ? ['online'] : ['cpu'], info: info,
        wonOnly: F.board === 'fastest', order: F.board === 'fastest' ? 'elapsed' : 'value', asc: F.board === 'fastest' };
    },
    // the row's big number follows the board being viewed
    value: function (r, F) { return F && F.board === 'fastest' ? clockTenths(Math.round(r.elapsed / 100)) : fmt(r.value) + ' hits'; },
    sub: function (r, p, sub) {
      sub.appendChild(document.createTextNode((r.won ? 'Won ' : 'Lost ') + r.score + '–' + r.lines + ' · ' + pongOpp(r)));
    },
    meta: function (r) { var i = r.info || {}; return skullTag(r) + (i.target === 'inf' ? 'endless' : 'first to ' + (i.target || '?')) + ' · ' + ago(r.created_at); },
    kicker: function (r) { return 'Pong · ' + pongOpp(r); },
    stats: function (r) {
      var i = r.info || {};
      return [['Result', (r.won ? 'Won ' : 'Lost ') + r.score + '–' + r.lines], ['Longest rally', fmt(r.value)], ['Match time', clockTenths(Math.round((r.elapsed || 0) / 100))],
        ['Length', i.target === 'inf' ? 'Endless' : 'First to ' + (i.target || '?')], ['Opponent', r.kind === 'online' ? 'Online' : (i.difficulty || 'CPU')], ['Top speed', i.speed ? fmt(i.speed) : '–']];
    },
    sections: function (r, pane) {
      var i = r.info || {};
      skullSection(r, pane);
      if (!i.ball) return;
      var s = el('section', 'soc-sect');
      s.appendChild(el('h3', null, 'Ball'));
      s.appendChild(el('p', 'soc-note', String(i.ball).slice(0, 40)));
      pane.appendChild(s);
    }
  };
  function pongOpp(r) {
    var i = r.info || {};
    if (r.kind === 'online') return i.opponent ? 'vs ' + String(i.opponent).slice(0, 16) : 'online';
    return 'vs ' + (i.difficulty || 'normal') + ' CPU';
  }

  // Battleships: Fewest shots (wins only) or Best accuracy (wins only), filtered by opponent.
  // A run: mode 'battleships', kind 'cpu' | 'online', value = shots fired, score = accuracy %, lines = ships lost,
  // info = { difficulty, opponent, enemyHits }.
  var BS_OPPS = [['easy', 'Easy CPU'], ['hard', 'Hard CPU']];
  var BATTLESHIPS_BOARD = {
    init: function () { return { board: 'shots', opp: 'any' }; },
    openWith: function (F, m) { if (m === 'shots' || m === 'accuracy') F.board = m; },
    tags: function (F, K) {
      var tag = K.tag, radio = K.radio, closeDrops = K.closeDrops, refresh = K.refresh, bar = K.bar;
      bar.appendChild(tag('Fewest shots', F.board === 'shots', function () { F.board = 'shots'; refresh(); }));
      bar.appendChild(tag('Best accuracy', F.board === 'accuracy', function () { F.board = 'accuracy'; refresh(); }));
      bar.appendChild(oppTag(F, K, BS_OPPS));
    },
    describe: function (F) { return [F.board === 'shots' ? 'Wins in the fewest shots' : 'Wins with the best accuracy', oppText(F, BS_OPPS)]; },
    query: function (F) {
      return { mode: 'battleships', kinds: oppKinds(F), info: F.opp !== 'any' && F.opp !== 'online' ? { difficulty: F.opp } : {},
        wonOnly: true, order: F.board === 'shots' ? 'value' : 'score', asc: F.board === 'shots' };
    },
    value: function (r, F) { return F && F.board === 'accuracy' ? r.score + '%' : r.value + ' shots'; },
    sub: function (r, p, sub) { sub.appendChild(document.createTextNode(oppOf(r) + ' · ' + r.score + '% accuracy')); },
    meta: function (r) { return skullTag(r) + (r.lines ? r.lines + ' ship' + (r.lines > 1 ? 's' : '') + ' lost' : 'no ships lost') + ' · ' + ago(r.created_at); },
    kicker: function (r) { return 'Battleships · ' + oppOf(r); },
    stats: function (r) {
      var i = r.info || {};
      return [['Shots', String(r.value)], ['Accuracy', r.score + '%'], ['Ships lost', String(r.lines)], ['Hits taken', String(i.enemyHits | 0)],
        ['Time', clockTenths(Math.round((r.elapsed || 0) / 100))], ['Opponent', r.kind === 'online' ? 'Online' : (i.difficulty || 'CPU')]];
    },
    sections: function (r, pane) { skullSection(r, pane); }
  };

  // Chess: Quickest win (fewest of your own moves), filtered by opponent, colour and how it was won.
  // A run: mode 'chess', kind 'cpu' | 'online', value = your moves, score = material edge at the end (pawns),
  // info = { difficulty, opponent, color, method, clock, material }.
  var CHESS_OPPS = [['easy', 'Easy CPU'], ['normal', 'Normal CPU'], ['hard', 'Hard CPU']];
  var CHESS_METHODS = [['mate', 'Checkmate'], ['time', 'On time'], ['resign', 'Resignation']];
  var CHESS_BOARD = {
    init: function () { return { opp: 'any', color: null, method: null }; },
    openWith: function () {},
    tags: function (F, K) {
      var tag = K.tag, radio = K.radio, closeDrops = K.closeDrops, refresh = K.refresh, bar = K.bar;
      bar.appendChild(tag('Quickest win', true, function () {}));
      bar.appendChild(oppTag(F, K, CHESS_OPPS));
      var cName = F.color === 'w' ? 'As White' : F.color === 'b' ? 'As Black' : 'Either colour';
      bar.appendChild(tag(cName, !!F.color, function () { F.color = F.color === 'w' ? 'b' : F.color === 'b' ? null : 'w'; refresh(); }));
      var mName = F.method ? CHESS_METHODS.filter(function (m) { return m[0] === F.method; })[0][1] : 'Any finish';
      bar.appendChild(tag(mName, !!F.method, function () { F.method = F.method ? null : 'mate'; refresh(); }, function (drop) {
        drop.appendChild(el('div', 'lb-drop-title', 'How it was won'));
        [[null, 'Any finish']].concat(CHESS_METHODS).forEach(function (m) {
          drop.appendChild(radio('lb-method', m[1], F.method === m[0], function () { F.method = m[0]; closeDrops(); refresh(); }));
        });
      }));
    },
    describe: function (F) {
      return ['Wins in the fewest moves', oppText(F, CHESS_OPPS), F.color === 'w' ? 'playing White' : F.color === 'b' ? 'playing Black' : 'either colour',
        F.method ? 'by ' + CHESS_METHODS.filter(function (m) { return m[0] === F.method; })[0][1].toLowerCase() : 'any finish'];
    },
    query: function (F) {
      var info = {};
      if (F.opp !== 'any' && F.opp !== 'online') info.difficulty = F.opp;
      if (F.color) info.color = F.color;
      if (F.method) info.method = F.method;
      return { mode: 'chess', kinds: oppKinds(F), info: info, wonOnly: true, order: 'value', asc: true };
    },
    value: function (r) { return r.value + ' moves'; },
    sub: function (r, p, sub) { var i = r.info || {}; sub.appendChild(document.createTextNode((i.color === 'b' ? 'Black' : 'White') + ' · ' + oppOf(r))); },
    meta: function (r) { var i = r.info || {}; return skullTag(r) + chessMethod(i.method) + ' · ' + ago(r.created_at); },
    kicker: function (r) { return 'Chess · ' + oppOf(r); },
    stats: function (r) {
      var i = r.info || {};
      return [['Moves', String(r.value)], ['Finish', chessMethod(i.method)], ['Colour', i.color === 'b' ? 'Black' : 'White'],
        ['Material', ((i.material | 0) > 0 ? '+' : '') + (i.material | 0)], ['Time', clockTenths(Math.round((r.elapsed || 0) / 100))], ['Clock', i.clock && i.clock !== '0' ? i.clock + ' min' : 'None']];
    },
    sections: function (r, pane) { skullSection(r, pane); }
  };
  // Pong, Battleships and Chess runs note their skulls (names come from the game page when it lists them).
  function skullTag(r) { return r.skulls && r.skulls.length ? '☠ ' + r.skulls.length + ' · ' : ''; }
  function skullSection(r, pane) {
    if (!r.skulls || !r.skulls.length) return;
    var known = App().skullList ? App().skullList() : [];
    var sec = el('section', 'soc-sect');
    sec.appendChild(el('h3', null, 'Skulls on'));
    sec.appendChild(el('p', 'soc-note', r.skulls.map(function (id) { var k = known.filter(function (x) { return x.id === id; })[0]; return k ? k.name : id; }).join(', ')));
    pane.appendChild(sec);
  }
  function chessMethod(m) { return { mate: 'Checkmate', time: 'On time', resign: 'Resignation', abandon: 'Opponent left' }[m] || 'Win'; }

  // Shared bits for the two-player games' opponent tag: anyone, a CPU difficulty, or online players.
  function oppTag(F, K, opps) {
    var name = F.opp === 'any' ? 'Any opponent' : F.opp === 'online' ? 'Online' : opps.filter(function (d) { return d[0] === F.opp; })[0][1];
    return K.tag(name, F.opp !== 'any', function () { F.opp = F.opp === 'any' ? 'online' : 'any'; K.refresh(); }, function (drop) {
      drop.appendChild(el('div', 'lb-drop-title', 'Opponent'));
      [['any', 'Anyone']].concat(opps, [['online', 'Online players']]).forEach(function (o) {
        drop.appendChild(K.radio('lb-opp', o[1], F.opp === o[0], function () { F.opp = o[0]; K.closeDrops(); K.refresh(); }));
      });
    });
  }
  function oppText(F, opps) { return F.opp === 'any' ? 'any opponent' : F.opp === 'online' ? 'against online players' : 'against the ' + opps.filter(function (d) { return d[0] === F.opp; })[0][1]; }
  function oppKinds(F) { return F.opp === 'any' ? ['cpu', 'online'] : F.opp === 'online' ? ['online'] : ['cpu']; }
  function oppOf(r) {
    var i = r.info || {};
    if (r.kind === 'online') return i.opponent ? 'vs ' + String(i.opponent).slice(0, 16) : 'online';
    return 'vs ' + (i.difficulty || 'normal') + ' CPU';
  }

  var BOARD = { tetris: TETRIS_BOARD, pong: PONG_BOARD, battleships: BATTLESHIPS_BOARD, chess: CHESS_BOARD }[GAME] || TETRIS_BOARD;

  var Leaderboard = (function () {
    var modal = Modal('socBoard', 'Leaderboard', true);
    var F = BOARD.init();
    F.friends = false; F.all = false;
    var seq = 0, openDrop = null, rows = [], dropHost = null;

    function open(m) {
      var body = modal.open();
      if (m) BOARD.openWith(F, m);
      if (!S.ready) { notReady(body); onReady(function () { if (modal.isOpen()) open(); }); return; }
      render();
    }

    // A tag: click the label to toggle or pick; the chevron (when there is one) opens its dropdown.
    function tag(label, on, onClick, dropFill) {
      var wrap = el('div', 'lb-tag' + (on ? ' on' : '') + (dropFill ? ' has-drop' : ''));
      var main = el('button', 'lb-tag-main');
      main.type = 'button';
      main.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (typeof label === 'string') main.textContent = label; else main.appendChild(label);
      main.addEventListener('click', onClick);
      wrap.appendChild(main);
      if (dropFill) {
        var caret = el('button', 'lb-tag-caret');
        caret.type = 'button';
        caret.innerHTML = CHEVRON;
        caret.setAttribute('aria-label', 'More options');
        var drop = el('div', 'lb-drop hidden');
        caret.addEventListener('click', function (e) {
          e.stopPropagation();
          var was = !drop.classList.contains('hidden');
          closeDrops();
          if (!was) { drop.textContent = ''; dropFill(drop); drop.classList.remove('hidden'); wrap.classList.add('open'); openDrop = drop; }
        });
        drop.addEventListener('click', function (e) { e.stopPropagation(); });
        wrap.appendChild(caret);
        // Dropdowns open in a row under the tags (inside the panel), so they never get clipped.
        (dropHost || wrap).appendChild(drop);
      }
      return wrap;
    }
    function closeDrops() {
      Array.prototype.forEach.call(document.querySelectorAll('#socBoard .lb-drop'), function (d) { d.classList.add('hidden'); });
      Array.prototype.forEach.call(document.querySelectorAll('#socBoard .lb-tag.open'), function (t) { t.classList.remove('open'); });
      openDrop = null;
    }
    document.addEventListener('click', function (e) { if (openDrop && !e.target.closest('.lb-drop')) closeDrops(); });

    function check(label, on, onChange, icon) {
      var l = el('label', 'lb-check' + (on ? ' on' : ''));
      var box = el('input');
      box.type = 'checkbox';
      box.checked = on;
      box.addEventListener('change', function () { l.classList.toggle('on', box.checked); onChange(box.checked); });
      l.appendChild(box);
      l.appendChild(el('i', 'lb-box'));
      if (icon) l.appendChild(icon);
      l.appendChild(el('span', null, label));
      return l;
    }
    function radio(name, label, on, onPick) {
      var l = el('label', 'lb-check lb-radio' + (on ? ' on' : ''));
      var r = el('input');
      r.type = 'radio'; r.name = name; r.checked = on;
      r.addEventListener('change', function () { if (r.checked) onPick(); });
      l.appendChild(r);
      l.appendChild(el('i', 'lb-box'));
      l.appendChild(el('span', null, label));
      return l;
    }

    function renderTags(target) {
      target.textContent = '';
      BOARD.tags(F, { tag: tag, check: check, radio: radio, closeDrops: closeDrops, refresh: refresh, bar: target });
      target.appendChild(tag('Friends', F.friends, function () { F.friends = !F.friends; refresh(); }));
      target.appendChild(tag(F.all ? 'Every run' : 'Best per player', F.all, function () { F.all = !F.all; refresh(); }));
    }

    function describe() {
      var parts = BOARD.describe(F);
      if (F.friends) parts.push('you and your friends');
      parts.push(F.all ? 'every run' : 'best run per player');
      return parts.join(' · ');
    }

    var bar = null, list = null, note = null, pane = null;
    function render() {
      var body = modal.body();
      body.textContent = '';
      var layout = el('div', 'lb-layout');
      var main = el('div', 'lb-main');
      bar = el('div', 'lb-tags');
      dropHost = el('div', 'lb-drop-host');
      note = el('p', 'soc-note lb-desc');
      list = el('ol', 'soc-board');
      main.appendChild(bar);
      main.appendChild(dropHost);
      main.appendChild(note);
      main.appendChild(list);
      pane = el('aside', 'lb-pane hidden');
      layout.appendChild(main);
      layout.appendChild(pane);
      body.appendChild(layout);
      refresh();
    }

    // keepDrop: called from inside a dropdown, so repaint the tag labels but leave the open dropdown alone.
    function refresh(keepDrop) {
      if (!bar) return;
      if (keepDrop && openDrop) {
        var labels = el('div'), host = dropHost;
        dropHost = null;
        renderTags(labels);
        dropHost = host;
        Array.prototype.forEach.call(bar.querySelectorAll('.lb-tag'), function (t, i) {
          var fresh = labels.children[i];
          if (!fresh) return;
          t.className = fresh.className + (t.classList.contains('open') ? ' open' : '');
          var m = t.querySelector('.lb-tag-main');
          m.textContent = '';
          Array.prototype.forEach.call(fresh.querySelector('.lb-tag-main').childNodes, function (n) { m.appendChild(n.cloneNode(true)); });
        });
      } else { closeDrops(); dropHost.textContent = ''; renderTags(bar); }
      note.textContent = describe();
      load();
    }

    function load() {
      var my = ++seq;
      list.textContent = '';
      list.appendChild(el('li', 'soc-empty', 'Loading…'));
      hidePane();
      var q = BOARD.query(F);
      q.userIds = F.friends ? [B.uid()].concat(S.friends.filter(function (f) { return f.status === 'accepted'; }).map(function (f) { return f.id; })) : null;
      B.runs(q).then(function (data) {
        if (my !== seq) return;
        if (!F.all) {
          var seen = {};
          data = data.filter(function (r) { if (seen[r.user_id]) return false; seen[r.user_id] = true; return true; });
        }
        rows = data.slice(0, 50);
        paint();
      }).catch(function (e) {
        if (my !== seq) return;
        console.warn('[social] board', e);
        list.textContent = '';
        list.appendChild(el('li', 'soc-empty', 'Couldn\'t load the leaderboard.'));
      });
    }

    function paint() {
      list.textContent = '';
      if (!rows.length) { list.appendChild(el('li', 'soc-empty', 'No runs match these tags yet. Try another game type or tag, or go set one.')); return; }
      rows.forEach(function (r, i) {
        var p = cleanProfile({ id: r.user_id, name: r.name, avatar: r.avatar, equipped: r.equipped, xp: r.xp });
        var li = el('li', 'soc-board-row lb-run' + (r.user_id === B.uid() ? ' me' : '') + (i < 3 ? ' top' + (i + 1) : ''));
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.setAttribute('aria-label', 'Run details: ' + p.name + ', ' + BOARD.value(r, F));
        li.appendChild(el('span', 'soc-rank', '#' + (i + 1)));
        var who = el('span', 'soc-who');
        who.appendChild(avatarEl(p, 30));
        var t = el('span', 'soc-who-text');
        t.appendChild(nameSpan(p));
        var sub = el('small', 'lb-sub');
        BOARD.sub(r, p, sub);
        t.appendChild(sub);
        who.appendChild(t);
        li.appendChild(who);
        li.appendChild(el('span', 'soc-score', BOARD.value(r, F)));
        li.appendChild(el('span', 'soc-meta', BOARD.meta(r)));
        function show() {
          Array.prototype.forEach.call(list.querySelectorAll('.lb-run.sel'), function (x) { x.classList.remove('sel'); });
          li.classList.add('sel');
          showPane(r, p);
        }
        li.addEventListener('click', show);
        li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
        list.appendChild(li);
      });
    }

    function hidePane() { if (pane) { pane.classList.add('hidden'); pane.textContent = ''; } }

    // The run's info pane: who, when, the numbers, the game's own sections, and everyone else in a versus game.
    function showPane(r, p) {
      pane.textContent = '';
      pane.classList.remove('hidden');
      var head = el('div', 'lb-pane-head');
      head.appendChild(el('span', 'lb-pane-kicker', BOARD.kicker(r)));
      var x = el('button', 'soc-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close run details');
      x.addEventListener('click', function () { hidePane(); Array.prototype.forEach.call(list.querySelectorAll('.lb-run.sel'), function (y) { y.classList.remove('sel'); }); });
      head.appendChild(x);
      pane.appendChild(head);
      var who = el('button', 'soc-who');
      who.type = 'button';
      who.appendChild(avatarEl(p, 44));
      var t = el('span', 'soc-who-text');
      t.appendChild(nameSpan(p, 'big'));
      t.appendChild(el('small', null, new Date(r.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })));
      who.appendChild(t);
      who.addEventListener('click', function () { modal.close(); ProfileView.open(r.user_id); });
      pane.appendChild(who);
      pane.appendChild(el('div', 'lb-pane-value', BOARD.value(r, F)));
      var stats = el('div', 'soc-stats lb-pane-stats');
      BOARD.stats(r).forEach(function (s) {
        var d = el('div'); d.appendChild(el('b', null, s[1])); d.appendChild(el('span', null, s[0])); stats.appendChild(d);
      });
      pane.appendChild(stats);
      BOARD.sections(r, pane);
      if (r.players && r.players.length) {
        var ps = el('section', 'soc-sect');
        ps.appendChild(el('h3', null, 'Players'));
        var ol = el('ol', 'lb-players');
        r.players.slice().sort(function (a, b) { return (a.place || 9) - (b.place || 9); }).forEach(function (q) {
          var li = el('li', q.uid && q.uid === r.user_id ? 'me' : '');
          li.appendChild(el('span', 'lb-place', q.place ? '#' + q.place : '–'));
          var n = el(q.uid && uuidOk(q.uid) ? 'button' : 'span', 'lb-pname', String(q.name || 'Player').slice(0, 40));
          if (q.uid && uuidOk(q.uid)) { n.type = 'button'; n.addEventListener('click', function () { modal.close(); ProfileView.open(q.uid); }); }
          li.appendChild(n);
          if (q.cpu) li.appendChild(el('span', 'soc-pill', 'CPU'));
          li.appendChild(el('span', 'lb-pscore', fmt(q.score | 0)));
          ol.appendChild(li);
        });
        ps.appendChild(ol);
        pane.appendChild(ps);
      }
    }

    return { open: open };
  })();

  /* =================================================================
     Public lobby finder
     ================================================================= */

  var Finder = (function () {
    var modal = Modal('socFinder', 'Find a game', true);
    var timer = null;
    function open() {
      var body = modal.open(function () { clearInterval(timer); });
      if (!S.ready) { notReady(body); onReady(function () { if (modal.isOpen()) open(); }); return; }
      render();
      clearInterval(timer);
      timer = setInterval(function () { if (!document.hidden) render(true); }, 8000);
    }
    function render(quiet) {
      var body = modal.body();
      var list = body.querySelector('.soc-list');
      if (!quiet || !list) {
        body.textContent = '';
        var top = el('div', 'soc-finder-top');
        top.appendChild(el('p', 'soc-note', 'Public lobbies people are hosting right now. Host your own and switch on "Public lobby" to show up here.'));
        top.appendChild(btn('Refresh', null, function () { render(true); }));
        body.appendChild(top);
        list = el('ul', 'soc-list');
        body.appendChild(list);
      }
      B.lobbies().then(function (rows) {
        list.textContent = '';
        var mine = App().lobby();
        rows = rows.filter(function (r) { return !mine || r.code !== mine.code; });
        var old = body.querySelector('.soc-empty');
        if (old) old.remove();
        if (!rows.length) { body.appendChild(el('p', 'soc-empty', 'No public games right now. Host one and you\'ll be the first.')); return; }
        rows.sort(function (a, b) { return (a.in_game - b.in_game) || (b.players - a.players); }).forEach(function (r) {
          var p = cleanProfile({ id: r.host_id, name: r.host_name, avatar: r.avatar, equipped: r.equipped, xp: r.xp });
          var li = el('li', 'soc-row');
          var who = el('button', 'soc-who');
          who.type = 'button';
          who.appendChild(avatarEl(p, 36));
          var t = el('span', 'soc-who-text');
          var line = el('span');
          line.appendChild(nameSpan(p));
          line.appendChild(document.createTextNode('\'s lobby'));
          t.appendChild(line);
          t.appendChild(el('small', null, r.rules || 'Versus'));
          who.appendChild(t);
          who.addEventListener('click', function () { modal.close(); ProfileView.open(r.host_id); });
          li.appendChild(who);
          var act = el('span', 'soc-row-actions');
          act.appendChild(el('span', 'soc-pill' + (r.in_game ? '' : ' ok'), r.in_game ? 'In game' : r.players + '/' + r.max_players + ' players'));
          var full = r.players >= r.max_players;
          var j = btn(full ? 'Full' : 'Join', 'btn-primary', function () { modal.close(); joinCode(r.code); });
          j.disabled = full || r.in_game;
          act.appendChild(j);
          li.appendChild(act);
          list.appendChild(li);
        });
      }).catch(function () { list.textContent = ''; list.appendChild(el('li', 'soc-empty', 'Couldn\'t load public games.')); });
    }
    return { open: open };
  })();

  // Host side: keep this lobby's row fresh while it's public; remove it when it isn't.
  function lobbyChanged() {
    if (!S.ready) return;
    var lob = App().lobby();
    var want = lob && lob.role === 'host' && S.lobby.publicOn;
    paintLobbyTools(lob);
    if (!want) {
      clearInterval(S.lobby.beat); S.lobby.beat = null;
      if (S.lobby.published) { B.unpublishLobby(S.lobby.published).catch(function () {}); S.lobby.published = null; }
      return;
    }
    var row = { code: lob.code, game: GAME, host_name: S.me.name, players: lob.count, max_players: lob.max || 4, rules: String(lob.rules || '').slice(0, 80), in_game: !!lob.inGame };
    if (S.lobby.published && S.lobby.published !== lob.code) B.unpublishLobby(S.lobby.published).catch(function () {});
    S.lobby.published = lob.code;
    B.publishLobby(row).catch(function (e) { console.warn('[social] publish', e); });
    if (!S.lobby.beat) S.lobby.beat = setInterval(function () { if (S.lobby.publicOn) lobbyChanged(); }, LOBBY_BEAT_MS);
  }
  window.addEventListener('pagehide', function () { if (S.lobby.published && B) B.unpublishLobby(S.lobby.published).catch(function () {}); });

  // The row of social buttons inside the lobby panel: public toggle (host), invite friends, copy invite link.
  var lobbyTools = null;
  function paintLobbyTools(lob) {
    var panel = document.getElementById('lobbyPanel');
    if (!panel) return;
    if (!lobbyTools) {
      lobbyTools = el('div', 'soc-lobby-tools');
      var anchor = panel.querySelector('#lobbyPlayers');
      panel.insertBefore(lobbyTools, anchor);
    }
    lobbyTools.textContent = '';
    if (!lob || !lob.code) return;
    if (lob.role === 'host') {
      var pub = btn(S.lobby.publicOn ? '● Public lobby' : '○ Private lobby', S.lobby.publicOn ? 'btn-primary' : null, function () {
        S.lobby.publicOn = !S.lobby.publicOn;
        G.Store.set('tetris_public_lobby', S.lobby.publicOn);
        lobbyChanged();
      });
      pub.title = 'Public lobbies show up in Find a game for anyone to join';
      lobbyTools.appendChild(pub);
    }
    lobbyTools.appendChild(btn('Invite friends', null, function () { InvitePicker.open(); }));
    lobbyTools.appendChild(btn('Copy invite link', null, function () { G.copyText(inviteLink(lob.code)); }));
  }

  var InvitePicker = (function () {
    var modal = Modal('socInvite', 'Invite friends');
    function open() {
      var body = modal.open();
      if (!S.ready) { notReady(body); return; }
      body.textContent = '';
      var lob = App().lobby();
      if (!lob) { body.appendChild(el('p', 'soc-empty', 'Open a lobby first.')); return; }
      var friends = S.friends.filter(function (f) { return f.status === 'accepted'; });
      var share = el('p', 'soc-note soc-share');
      share.appendChild(document.createTextNode('Anyone with this link joins your lobby: '));
      var link = el('button', 'soc-link', inviteLink(lob.code));
      link.type = 'button';
      link.addEventListener('click', function () { G.copyText(inviteLink(lob.code)); });
      share.appendChild(link);
      body.appendChild(share);
      if (!friends.length) { body.appendChild(el('p', 'soc-empty', 'No friends yet. Share your profile link from the friends list.')); return; }
      var list = el('ul', 'soc-list');
      friends.forEach(function (f) {
        var li = el('li', 'soc-row');
        var who = el('span', 'soc-who');
        who.appendChild(avatarEl(f.profile, 32));
        var t = el('span', 'soc-who-text');
        t.appendChild(nameSpan(f.profile));
        t.appendChild(el('small', null, 'Level ' + levelOf(f.profile.xp)));
        who.appendChild(t);
        li.appendChild(who);
        var b = btn('Invite', 'btn-primary', function () { inviteToLobby(f.id); b.disabled = true; b.textContent = 'Invited'; });
        var act = el('span', 'soc-row-actions');
        act.appendChild(b);
        li.appendChild(act);
        list.appendChild(li);
      });
      body.appendChild(list);
    }
    return { open: open };
  })();

  /* =================================================================
     Points shop
     ================================================================= */

  var Shop = (function () {
    var modal = Modal('socShop', 'Points shop', true);
    function open() {
      var body = modal.open();
      if (!S.ready) { notReady(body); onReady(function () { if (modal.isOpen()) open(); }); return; }
      render();
    }
    function preview(i) {
      var box = el('div', 'soc-shop-preview');
      if (i.kind === 'banner') {
        if (i.value === 'custom') { box.classList.add('custom'); box.textContent = 'Your picture'; }
        else box.style.background = BANNERS[i.value];
      } else if (i.kind === 'name' || i.kind === 'glow') {
        var n = el('span', 'soc-name big', S.me.name);
        styleName(n, i.kind === 'glow' ? { name: S.me.equipped.name || 'royal', glow: true } : { name: i.value });
        box.appendChild(n);
      } else if (i.kind === 'frame') {
        box.appendChild(avatarEl(Object.assign({}, S.me, { equipped: { frame: i.value } }), 54));
      } else if (i.kind === 'badge') {
        box.appendChild(badgeChip(i.value, true));
      }
      return box;
    }
    function render() {
      var body = modal.body();
      body.textContent = '';
      var top = el('div', 'soc-shop-top');
      var bal = el('div', 'soc-balance');
      bal.appendChild(el('b', null, fmt(S.me.points)));
      bal.appendChild(el('span', null, 'points'));
      top.appendChild(bal);
      top.appendChild(el('p', 'soc-note', 'Earn points from achievements (50–500 each), finishing games and winning online. Everything here is cosmetic.'));
      body.appendChild(top);
      var cats = [];
      SHOP.forEach(function (i) { if (cats.indexOf(i.cat) === -1) cats.push(i.cat); });
      cats.forEach(function (cat) {
        body.appendChild(el('h3', 'ach-cat', cat));
        var grid = el('div', 'soc-shop-grid');
        SHOP.filter(function (i) { return i.cat === cat; }).forEach(function (i) {
          var have = owns(S.me, i.id), card = el('div', 'soc-shop-item' + (have ? ' owned' : ''));
          card.appendChild(preview(i));
          var info = el('div', 'soc-shop-info');
          info.appendChild(el('strong', null, i.name));
          if (i.desc) info.appendChild(el('span', null, i.desc));
          card.appendChild(info);
          var b;
          if (have) {
            var on = isEquipped(i);
            b = btn(i.kind === 'badge' ? (S.me.badges.indexOf(i.value) !== -1 ? 'Showing' : 'Show') : on ? 'Equipped' : 'Equip', on ? 'btn-primary' : null, function () { equip(i); });
          } else {
            b = btn(i.price ? fmt(i.price) + ' pts' : 'Free', 'btn-primary', function () { buy(i); });
            b.disabled = S.me.points < i.price;
          }
          card.appendChild(b);
          grid.appendChild(card);
        });
        body.appendChild(grid);
      });
    }
    function isEquipped(i) {
      var e = S.me.equipped;
      if (i.kind === 'banner') return e.banner === i.value;
      if (i.kind === 'name') return e.name === i.value;
      if (i.kind === 'glow') return e.glow;
      if (i.kind === 'frame') return e.frame === i.value;
      return false;
    }
    function equip(i) {
      var e = Object.assign({}, S.me.equipped), badges = S.me.badges.slice();
      if (i.kind === 'banner') { if (i.value === 'custom' && !S.me.banner) { modal.close(); ProfileView.open(); G.banner('Edit profile → Banner to upload your picture'); return; } e.banner = i.value; }
      else if (i.kind === 'name') e.name = e.name === i.value ? null : i.value;
      else if (i.kind === 'glow') e.glow = !e.glow;
      else if (i.kind === 'frame') e.frame = e.frame === i.value ? null : i.value;
      else if (i.kind === 'badge') {
        var at = badges.indexOf(i.value);
        if (at !== -1) badges.splice(at, 1); else if (badges.length < 3) badges.push(i.value); else { G.banner('You can show 3 badges'); return; }
      }
      saveMe({ equipped: e, badges: badges }).then(render).catch(function () { G.banner('Couldn\'t save that'); });
    }
    function buy(i) {
      if (S.me.points < i.price) return;
      var owned = S.me.owned.concat([i.id]);
      saveMe({ points: S.me.points - i.price, owned: owned }).then(function () {
        G.banner('Bought ' + i.name + '!');
        if (G.Sound && G.Sound.beep) G.Sound.beep(1320, 0.12, 'triangle', 0.05);
        equip(i);
      }).catch(function () { G.banner('Couldn\'t complete that purchase'); });
    }
    return { open: open };
  })();

  /* =================================================================
     Menu entry points and URL links
     ================================================================= */

  function buildMenu() {
    var panel = document.getElementById('menuPanel');
    if (!panel) return;
    var row = el('div', 'soc-menu');
    [['Find a game', function () { Finder.open(); }, 'Public lobbies'],
      ['Leaderboard', function () { Leaderboard.open(); }, 'Public high scores'],
      ['Profile', function () { ProfileView.open(); }, 'Banner, badges, level'],
      ['Points shop', function () { Shop.open(); }, 'Name styles and more']].forEach(function (x) {
      var b = el('button', 'soc-menu-card');
      b.type = 'button';
      b.appendChild(el('strong', null, x[0]));
      b.appendChild(el('span', null, x[2]));
      b.addEventListener('click', x[1]);
      row.appendChild(b);
    });
    var grid = panel.querySelector('.mode-grid');
    grid.parentNode.insertBefore(row, grid.nextSibling);
  }

  // ?profile=ID opens someone's profile (with Add friend). (?join=CODE invite links are handled by tetris.js,
  // so they work even with the social features off.)
  function handleUrl() {
    var prof = (new URLSearchParams(location.search).get('profile') || '').toLowerCase();
    if (!uuidOk(prof)) return;
    // Remove only this parameter, leaving any others exactly as written (e.g. ?debug).
    var rest = location.search.replace(/^\?/, '').split('&').filter(function (kv) { return kv && !/^profile=/.test(kv); }).join('&');
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    ProfileView.open(prof);
  }

  /* =================================================================
     Hooks from tetris.js
     ================================================================= */

  // Skull ids from the game, as stored on a run (Pong, Battleships and Chess use games-skulls.js).
  function cleanSkullIds(list) { return (Array.isArray(list) ? list : []).slice(0, 12).map(function (x) { return String(x).replace(/[^A-Za-z0-9_]/g, '').slice(0, 24); }).filter(Boolean); }

  function runBase(d) {
    return {
      score: Math.max(0, d.score | 0), lines: Math.max(0, d.lines | 0), level: Math.max(1, d.level | 0),
      elapsed: Math.max(0, Math.round((d.elapsed || 0) * 1000)),
      skulls: (d.skulls || []).slice(0, 40).map(String), multiplier: +d.multiplier || 1
    };
  }
  function addRun(row) { B.addRun(row).catch(function (e) { console.warn('[social] run', e); }); }

  // A solo game ended: every run goes on the leaderboard (skull runs show under the Skulls tag), and every
  // game gives a little XP. Sprint and Dig only count when finished.
  function soloFinished(d) {
    if (!S.ready) return;
    var xp = Math.min(400, 10 + (d.lines || 0) * 2), pts = Math.floor(xp / 4);
    grant(xp, pts, 'game finished');
    var mode = d.gameType, value = null;
    if (mode === 'sprint' || mode === 'dig') { if (d.finish === mode) value = Math.round(d.elapsed * 10); }
    else if (mode === 'survival') value = Math.round(d.elapsed * 10);
    else if (mode === 'marathon' || mode === 'ultra') value = d.score;
    if (value == null || value <= 0 || !MODE_BY[mode]) return;
    addRun(Object.assign(runBase(d), { kind: 'solo', mode: mode, value: value }));
  }

  // A versus game ended (online or vs CPU): one run for you, with everyone's result for the info pane.
  // d: { online, won, versusType, score, lines, level, elapsed, skulls, multiplier, place, players[] }
  function versusFinished(d) {
    if (!S.ready) return;
    if (d.online) grant(d.won ? 125 : 25, d.won ? 60 : 10, d.won ? 'online win' : 'online match');
    else grant(d.won ? 40 : 10, d.won ? 15 : 3, d.won ? 'beat the CPUs' : null);
    var players = (d.players || []).slice(0, 4).map(function (q) {
      return { name: String(q.name || 'Player').slice(0, 40), uid: uuidOk(q.uid) ? q.uid : null, cpu: !!q.cpu, score: Math.max(0, q.score | 0), lines: Math.max(0, q.lines | 0), place: q.place | 0 || null };
    });
    addRun(Object.assign(runBase(d), {
      kind: d.online ? 'online' : 'cpu', mode: 'versus', versus_type: d.versusType === 'elim' ? 'elim' : 'last',
      value: Math.max(0, d.score | 0), won: !!d.won, place: d.place >= 1 && d.place <= 4 ? d.place : null, players: players
    }));
  }

  // A Pong match ended (vs CPU or online; local two-player matches have no single owner, so they don't count).
  // d: { online, won, myScore, theirScore, rally (longest), elapsed (s), target, difficulty, opponent, ball, speed }
  function pongFinished(d) {
    if (!S.ready) return;
    if (d.online) grant(d.won ? 100 : 20, d.won ? 50 : 8, d.won ? 'online win' : 'online match');
    else grant(d.won ? ({ easy: 20, normal: 40, hard: 80, ultra: 110 }[d.difficulty] || 30) : 8, d.won ? ({ easy: 8, normal: 16, hard: 35, ultra: 50 }[d.difficulty] || 12) : 2, d.won ? 'match won' : null);
    var info = { target: String(d.target || '7'), ball: String(d.ball || '').slice(0, 40), speed: Math.max(0, d.speed | 0) };
    if (d.online) info.opponent = String(d.opponent || '').slice(0, 16); else info.difficulty = ['easy', 'normal', 'hard', 'ultra'].indexOf(d.difficulty) !== -1 ? d.difficulty : 'normal';
    addRun({ kind: d.online ? 'online' : 'cpu', mode: 'pong', value: Math.max(0, d.rally | 0), score: Math.max(0, d.myScore | 0), lines: Math.max(0, d.theirScore | 0),
      level: 1, elapsed: Math.max(0, Math.round((d.elapsed || 0) * 1000)), skulls: cleanSkullIds(d.skulls), multiplier: 1, won: !!d.won, info: info });
  }

  // A Battleships battle ended (vs CPU or online).
  // d: { online, won, shots, accuracy, shipsLost, enemyHits, elapsed (s), difficulty, opponent }
  function battleshipsFinished(d) {
    if (!S.ready) return;
    if (d.online) grant(d.won ? 100 : 20, d.won ? 50 : 8, d.won ? 'online win' : 'online battle');
    else grant(d.won ? ({ easy: 30, normal: 50, hard: 70, ultra: 95 }[d.difficulty] || 30) : 8, d.won ? ({ easy: 12, normal: 20, hard: 30, ultra: 42 }[d.difficulty] || 12) : 2, d.won ? 'battle won' : null);
    var info = { enemyHits: Math.max(0, d.enemyHits | 0) };
    if (d.online) info.opponent = String(d.opponent || '').slice(0, 16); else info.difficulty = ['easy', 'normal', 'hard', 'ultra'].indexOf(d.difficulty) !== -1 ? d.difficulty : 'normal';
    addRun({ kind: d.online ? 'online' : 'cpu', mode: 'battleships', value: Math.max(0, d.shots | 0), score: Math.max(0, Math.min(100, d.accuracy | 0)),
      lines: Math.max(0, Math.min(5, d.shipsLost | 0)), level: 1, elapsed: Math.max(0, Math.round((d.elapsed || 0) * 1000)), skulls: cleanSkullIds(d.skulls), multiplier: 1, won: !!d.won, info: info });
  }

  // A Chess game ended (vs CPU or online). d: { online, won (true/false/null for a draw), myMoves, material (pawns, your side),
  //   method, color, difficulty, opponent, clock, elapsed (s) }
  function chessFinished(d) {
    if (!S.ready) return;
    var won = d.won === true;
    if (d.online) grant(won ? 120 : 25, won ? 60 : 10, won ? 'online win' : 'online game');
    else grant(won ? ({ easy: 25, normal: 60, hard: 120, ultra: 150 }[d.difficulty] || 40) : 10, won ? ({ easy: 10, normal: 25, hard: 55, ultra: 70 }[d.difficulty] || 15) : 3, won ? 'game won' : null);
    var info = { color: d.color === 'b' ? 'b' : 'w', method: String(d.method || '').slice(0, 12), clock: String(d.clock || '0'), material: Math.max(-99, Math.min(99, Math.round(d.material || 0))) };
    if (d.online) info.opponent = String(d.opponent || '').slice(0, 16); else info.difficulty = ['easy', 'normal', 'hard', 'ultra'].indexOf(d.difficulty) !== -1 ? d.difficulty : 'normal';
    addRun({ kind: d.online ? 'online' : 'cpu', mode: 'chess', value: Math.max(0, d.myMoves | 0), score: Math.max(0, Math.min(99, Math.round(d.material || 0))),
      lines: 0, level: 1, elapsed: Math.max(0, Math.round((d.elapsed || 0) * 1000)), skulls: cleanSkullIds(d.skulls), multiplier: 1, won: won, info: info });
  }

  // What other players should see of you in a lobby: your id (to open your profile) and name style.
  function card() { return S.ready ? { uid: B.uid(), eq: { name: S.me.equipped.name, glow: S.me.equipped.glow, frame: S.me.equipped.frame } } : null; }
  function cleanCard(c) {
    if (!c || typeof c !== 'object' || !uuidOk(c.uid)) return null;
    var e = cleanEquipped(c.eq);
    return { uid: c.uid, eq: { name: e.name, glow: e.glow, frame: e.frame } };
  }
  // Applies a lobby card to a name element (gradient name) and makes it open that profile when clicked.
  function decorateName(nameEl, c) {
    c = cleanCard(c);
    if (!c || !nameEl) return;
    styleName(nameEl, c.eq);
    nameEl.classList.add('soc-name');
    if (ENABLED) {
      nameEl.classList.add('soc-clickable');
      nameEl.title = 'View profile';
      nameEl.addEventListener('click', function () { ProfileView.open(c.uid); });
    }
  }

  // The plain name/picture editor on the Online panel changed: keep the profile in step.
  var localTimer = null;
  function localProfileChanged(pr) {
    if (!S.ready) return;
    clearTimeout(localTimer);
    localTimer = setTimeout(function () {
      if (pr.name === S.me.name && pr.avatar === S.me.avatar) return;
      saveMe({ name: pr.name, avatar: pr.avatar }).catch(function () {});
    }, 800);
  }

  if (ENABLED) {
    S.lobby.publicOn = G.Store.get('tetris_public_lobby', false) === true;
    buildDock();
    buildMenu();
    paintDock();
    if (ACH.onUnlock) ACH.onUnlock(function () { syncAchievements(); });
    if (GAMES[GAME]) document.querySelector('.soc-dock').dataset.page = GAME;
    start();
    if (GAME === 'chat') window.addEventListener('chat:profile-created', function () { if (!S.ready) start(); });
  }

  window.GameSocial = window.TetrisSocial = {
    enabled: ENABLED,
    soloFinished: soloFinished,
    versusFinished: versusFinished,
    pongFinished: pongFinished,
    battleshipsFinished: battleshipsFinished,
    chessFinished: chessFinished,
    lobbyChanged: lobbyChanged,
    card: card,
    cleanCard: cleanCard,
    decorateName: decorateName,
    localProfileChanged: localProfileChanged,
    openProfile: function (id) { ProfileView.open(id); },
    openLeaderboard: function (m) { Leaderboard.open(m); },
    openFinder: function () { Finder.open(); },
    openShop: function () { Shop.open(); },
    levelOf: levelOf,
    // for /chat's public room (chat-public.js): the same client, profile and look as everywhere else
    ready: onReady,
    client: function () { return B && B.client ? B.client() : null; },
    uid: function () { return B && S.ready ? B.uid() : null; },
    me: function () { return S.me; },
    friends: function () { return S.friends.slice(); },
    onFriendsChange: function (fn) { if (typeof fn === 'function') S.friendFns.push(fn); },
    loadProfiles: function (ids) { return loadProfiles(ids); },
    cleanProfile: cleanProfile,
    ui: { nameSpan: nameSpan, avatarEl: avatarEl, badgeChip: badgeChip, hasBadge: hasBadge, presenceOf: presenceOf, roleNames: ROLE_NAMES },
    sendNote: function (to, kind) { return S.ready ? B.sendNote(to, kind) : Promise.resolve(); },
    openFriends: function () { Friends.open(); }
  };
})();
