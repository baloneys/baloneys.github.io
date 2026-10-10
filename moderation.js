// moderation.js: the balcade staff portal. Two ways in:
//   - the "baloneys" master login (first time: a one-time setup code, then Sean picks the password), which
//     gets a 12-hour session token from the database, kept in this tab only (sessionStorage);
//   - a player account that's been given a staff role (helper 1, moderator 2, admin 3, dev 4).
// Every action is a database function (mod_*) that checks the caller's level itself, so hiding or showing
// buttons here is only convenience: the database is what enforces who can do what.
// See supabase/migrations/2026-10-10-chat-moderation.sql.
(function () {
  'use strict';

  var CFG = window.GAMES_SUPABASE || {};
  var LEVEL_NAMES = { 1: 'Helper', 2: 'Moderator', 3: 'Admin', 4: 'Developer', 5: 'Master' };
  var ROLES = [['helper', 'Helper'], ['moderator', 'Moderator'], ['admin', 'Admin'], ['dev', 'Developer']];
  var sb = null, token = sessionStorage.getItem('balcade-mod-token') || null, me = { level: 0 }, tab = 'reports';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(label, cls, fn) { var b = el('button', 'btn btn-sm ' + (cls || 'btn-outline'), label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function when(iso) { return iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; }
  function toast(t) { if (window.Games && window.Games.banner) window.Games.banner(t); }
  function rpc(name, args) {
    return sb.rpc(name, Object.assign({ token: token }, args || {})).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function act(name, args, done) {
    return rpc(name, args).then(function (d) { toast('Done'); if (done) done(d); return d; }).catch(function (e) { toast(e.message || 'That didn\'t work'); });
  }

  /* ---------- sign in ---------- */

  function boot() {
    if (!window.supabase || !CFG.url) { $('masterNote').textContent = 'The database isn\'t configured on this copy of the site.'; return; }
    sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tetris-auth' } });
    sb.rpc('mod_master_status').then(function (r) {
      if (r.error) { $('masterNote').textContent = /function|schema/i.test(r.error.message) ? 'The moderation database update hasn\'t been run yet.' : r.error.message; return; }
      if (r.data === 'setup') { $('masterSetup').classList.remove('hidden'); $('masterNote').textContent = 'The master password hasn\'t been set yet.'; }
      else if (r.data === 'ready') $('masterLogin').classList.remove('hidden');
      else $('masterNote').textContent = 'The master account hasn\'t been created in the database yet.';
    });
    // Staff players: sign in quietly with the same anonymous player account the games use in this browser.
    sb.auth.getSession().then(function (r) {
      if (!r.data.session) { $('staffNote').textContent = 'No player account in this browser yet. Play a game or open chat first, then come back.'; return null; }
      return sb.rpc('mod_me', { token: null }).then(function (m) {
        var lv = m.data && m.data.level || 0;
        if (lv > 0) {
          $('staffNote').textContent = 'You\'re signed in as ' + m.data.actor + '.';
          $('staffEnter').classList.remove('hidden');
        } else $('staffNote').textContent = 'Your player account doesn\'t have a staff role. Ask an admin to give you one.';
      });
    });
    $('staffEnter').addEventListener('click', function () { token = null; enter(); });
    $('masterLogin').addEventListener('submit', function (e) {
      e.preventDefault();
      loginError('');
      sb.rpc('mod_master_login', { username: $('mUser').value, password: $('mPass').value }).then(function (r) {
        if (r.error) return loginError(r.error.message);
        token = r.data; sessionStorage.setItem('balcade-mod-token', token); $('mPass').value = ''; enter();
      });
    });
    $('masterSetup').addEventListener('submit', function (e) {
      e.preventDefault();
      loginError('');
      if ($('sPass').value !== $('sPass2').value) return loginError('Those passwords don\'t match.');
      sb.rpc('mod_master_setup', { setup_code: $('sCode').value.trim().toUpperCase(), new_password: $('sPass').value }).then(function (r) {
        if (r.error) return loginError(r.error.message);
        token = r.data; sessionStorage.setItem('balcade-mod-token', token); $('sPass').value = $('sPass2').value = ''; enter();
      });
    });
    $('modLogout').addEventListener('click', function () {
      var t = token;
      token = null; sessionStorage.removeItem('balcade-mod-token');
      (t ? sb.rpc('mod_logout', { token: t }) : Promise.resolve()).then(function () { location.reload(); });
    });
    if (token) enter();
  }

  function loginError(msg) { $('loginError').textContent = msg || ''; $('loginError').classList.toggle('hidden', !msg); }

  function enter() {
    rpc('mod_me').then(function (m) {
      me = m || { level: 0 };
      if (!me.level) { token = null; sessionStorage.removeItem('balcade-mod-token'); return loginError('That session has expired. Log in again.'); }
      $('loginView').classList.add('hidden');
      $('appView').classList.remove('hidden');
      $('modLogout').classList.remove('hidden');
      $('modWho').textContent = '';
      $('modWho').appendChild(document.createTextNode(me.actor + ' '));
      $('modWho').appendChild(el('span', 'mod-level', LEVEL_NAMES[me.level]));
      paintTabs();
      show(tab);
    }).catch(function (e) { loginError(e.message); });
  }

  /* ---------- tabs ---------- */

  var TABS = [
    ['reports', 'Reports', 1], ['chat', 'Public chat', 1], ['players', 'Players', 1], ['staff', 'Staff', 3],
    ['filter', 'Word filter', 3], ['audit', 'Audit log', 4], ['account', 'Master account', 5]
  ];
  function paintTabs() {
    var nav = $('modTabs');
    nav.textContent = '';
    TABS.filter(function (t) { return me.level >= t[2]; }).forEach(function (t) {
      var c = el('button', 'chip' + (tab === t[0] ? ' active' : ''), t[1]);
      c.type = 'button';
      c.addEventListener('click', function () { tab = t[0]; paintTabs(); show(t[0]); });
      nav.appendChild(c);
    });
  }
  function show(name) {
    var pane = $('modPane');
    pane.textContent = '';
    ({ reports: Reports, chat: Chat, players: Players, staff: Staff, filter: Filter, audit: Audit, account: Account }[name] || Reports)(pane);
  }
  function box(pane, title) { var b = el('div', 'mod-box'); if (title) b.appendChild(el('h2', null, title)); pane.appendChild(b); return b; }
  function loading(b) { var l = el('p', 'mod-empty', 'Loading…'); b.appendChild(l); return l; }

  /* ---------- reports ---------- */

  function Reports(pane) {
    var b = box(pane, 'Reports');
    var all = false;
    var toggle = btn('Show resolved too', null, function () { all = !all; toggle.textContent = all ? 'Open only' : 'Show resolved too'; load(); });
    b.appendChild(toggle);
    var list = el('div');
    b.appendChild(list);
    function load() {
      list.textContent = '';
      var l = loading(list);
      rpc('mod_reports', { include_resolved: all }).then(function (rows) {
        l.remove();
        if (!rows.length) { list.appendChild(el('p', 'mod-empty', 'No reports. Nice.')); return; }
        rows.forEach(function (r) {
          var row = el('div', 'mod-row');
          var g = el('div', 'grow');
          g.appendChild(el('div', null, (r.target ? r.target.name : 'Someone') + ' reported by ' + (r.reporter ? r.reporter.name : '?') + ': ' + r.reason));
          if (r.message) g.appendChild(el('div', 'mod-msg' + (r.message.deleted ? ' deleted' : ''), r.message.body));
          g.appendChild(el('small', null, when(r.created_at) + (r.resolved ? ' · resolved by ' + r.resolved_by : '')));
          row.appendChild(g);
          var a = el('div', 'mod-actions');
          if (r.message && !r.message.deleted) a.appendChild(btn('Remove message', null, function () { act('mod_delete_message', { msg: r.message.id, why: 'report: ' + r.reason }, load); }));
          if (r.target) a.appendChild(btn('Player…', null, function () { tab = 'players'; paintTabs(); show('players'); setTimeout(function () { Players.search(r.target.id); }, 50); }));
          if (!r.resolved) a.appendChild(btn('Resolve', 'btn-primary', function () { act('mod_resolve_report', { report: r.id }, load); }));
          row.appendChild(a);
          list.appendChild(row);
        });
      }).catch(function (e) { l.textContent = e.message; });
    }
    load();
  }

  /* ---------- public chat ---------- */

  function Chat(pane) {
    if (me.level >= 3) {
      var s = box(pane, 'Room settings');
      sb.from('tetris_chat_settings').select('*').eq('room', 'public').maybeSingle().then(function (r) {
        var st = r.data || { locked: false, slow_seconds: 0, motd: '' };
        var form = el('form', 'mod-form');
        var lock = el('label', null); var cb = el('input'); cb.type = 'checkbox'; cb.checked = st.locked; lock.appendChild(cb); lock.appendChild(document.createTextNode(' Lock public chat (only staff can post)'));
        var slow = el('label'); slow.appendChild(el('span', 'option-label', 'Slow mode (seconds between messages, 0 = off)')); var si = el('input', 'text-input'); si.type = 'number'; si.min = 0; si.max = 600; si.value = st.slow_seconds; slow.appendChild(si);
        var motd = el('label'); motd.appendChild(el('span', 'option-label', 'Message of the day (shown above the chat)')); var mi = el('input', 'text-input'); mi.maxLength = 200; mi.value = st.motd; motd.appendChild(mi);
        var save = el('button', 'btn btn-primary', 'Save'); save.type = 'submit';
        [lock, slow, motd, save].forEach(function (x) { form.appendChild(x); });
        form.addEventListener('submit', function (e) { e.preventDefault(); act('mod_chat_settings', { chat_room: 'public', is_locked: cb.checked, slow: +si.value || 0, message: mi.value }); });
        s.appendChild(form);
      });
    }
    var b = box(pane, 'Latest messages');
    var list = el('div');
    b.appendChild(list);
    function load() {
      list.textContent = '';
      var l = loading(list);
      sb.from('tetris_chat').select('*').eq('room', 'public').order('id', { ascending: false }).limit(80).then(function (r) {
        l.remove();
        if (r.error) { list.appendChild(el('p', 'mod-empty', r.error.message)); return; }
        var ids = r.data.map(function (m) { return m.user_id; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
        return (ids.length ? sb.from('tetris_profiles').select('id,name,role').in('id', ids) : Promise.resolve({ data: [] })).then(function (pr) {
          var names = {}; (pr.data || []).forEach(function (p) { names[p.id] = p; });
          if (!r.data.length) list.appendChild(el('p', 'mod-empty', 'No messages yet.'));
          r.data.forEach(function (m) {
            var p = names[m.user_id] || { name: '?' };
            var row = el('div', 'mod-row');
            var g = el('div', 'grow');
            g.appendChild(el('small', null, p.name + (p.role ? ' (' + p.role + ')' : '') + ' · ' + when(m.created_at) + (m.pinned ? ' · 📌 pinned' : '')));
            g.appendChild(el('div', 'mod-msg' + (m.deleted ? ' deleted' : ''), m.body));
            row.appendChild(g);
            var a = el('div', 'mod-actions');
            if (!m.deleted) {
              a.appendChild(btn('Remove', 'mod-danger', function () { var why = prompt('Reason (optional):', ''); if (why !== null) act('mod_delete_message', { msg: m.id, why: why }, load); }));
              if (me.level >= 2) a.appendChild(btn(m.pinned ? 'Unpin' : 'Pin', null, function () { act('mod_pin', { msg: m.id, on_off: !m.pinned }, load); }));
            }
            a.appendChild(btn('Player…', null, function () { tab = 'players'; paintTabs(); show('players'); setTimeout(function () { Players.search(m.user_id); }, 50); }));
            row.appendChild(a);
            list.appendChild(row);
          });
        });
      });
    }
    load();
  }

  /* ---------- players ---------- */

  function Players(pane) {
    var b = box(pane, 'Find a player');
    var form = el('form', 'mod-search');
    var q = el('input', 'text-input'); q.placeholder = 'Name, profile id, or @staff';
    var go = el('button', 'btn btn-primary', 'Search'); go.type = 'submit';
    form.appendChild(q); form.appendChild(go);
    b.appendChild(form);
    var list = el('div');
    b.appendChild(list);
    function search(text) {
      q.value = text || q.value;
      list.textContent = '';
      var l = loading(list);
      rpc('mod_users', { q: q.value.trim() }).then(function (rows) {
        l.remove();
        if (!rows.length) { list.appendChild(el('p', 'mod-empty', 'Nobody found.')); return; }
        rows.forEach(function (u) { list.appendChild(userRow(u, function () { search(); })); });
      }).catch(function (e) { l.textContent = e.message; });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); search(); });
    Players.search = search;
    search('');
  }

  function userRow(u, reload) {
    var row = el('div', 'mod-row');
    var g = el('div', 'grow');
    var head = el('div');
    head.appendChild(document.createTextNode(u.name + ' '));
    if (u.role) head.appendChild(el('span', 'soc-role-pill role-' + u.role, u.role));
    g.appendChild(head);
    g.appendChild(el('small', null, u.id + ' · ' + u.messages + ' chat messages · ' + u.reports + ' open reports · last seen ' + when(u.last_seen)));
    var bans = el('div', 'mod-chips');
    (u.bans || []).slice(0, 6).forEach(function (bn) {
      var active = !bn.lifted && (!bn.expires_at || new Date(bn.expires_at) > new Date());
      var chip = el('span', 'mod-ban' + (active ? '' : ' old'), (bn.scope === 'all' ? 'Site ban' : 'Chat') + (bn.expires_at ? ' until ' + when(bn.expires_at) : ' · permanent') + (bn.reason ? ' · ' + bn.reason : '') + (bn.lifted ? ' · lifted' : ''));
      if (active && me.level >= 2) { var x = el('button', null, '×'); x.type = 'button'; x.title = 'Lift'; x.addEventListener('click', function () { act('mod_unban', { ban: bn.id }, reload); }); chip.appendChild(x); }
      bans.appendChild(chip);
    });
    if ((u.bans || []).length) g.appendChild(bans);
    row.appendChild(g);
    var a = el('div', 'mod-actions');
    a.appendChild(btn('Messages', null, function () { showMessages(u, row); }));
    if (me.level >= 2) {
      a.appendChild(btn('Kick (10 min)', null, function () { ban(u, 10, 'chat', reload); }));
      a.appendChild(btn('Mute 1 day', null, function () { ban(u, 1440, 'chat', reload); }));
      a.appendChild(btn('Chat ban 7 days', 'mod-danger', function () { ban(u, 10080, 'chat', reload); }));
    }
    if (me.level >= 3) {
      a.appendChild(btn('Site ban…', 'mod-danger', function () {
        var days = prompt('Ban ' + u.name + ' from chat, lobbies, leaderboards, friends and invites. Days (leave empty for permanent):', '30');
        if (days === null) return;
        ban(u, days.trim() ? Math.round(+days * 1440) : null, 'all', reload);
      }));
      a.appendChild(btn('Reset profile', 'mod-danger', function () { if (confirm('Reset ' + u.name + '\'s name, picture, banner, bio, tags and status?')) act('mod_reset_profile', { target: u.id }, reload); }));
      a.appendChild(btn('Remove all their messages', 'mod-danger', function () { if (confirm('Remove every public chat message by ' + u.name + '?')) act('mod_purge_messages', { target: u.id }, reload); }));
      var sel = el('select', 'text-input'); sel.style.width = 'auto';
      var none = el('option', null, 'No role'); none.value = ''; sel.appendChild(none);
      ROLES.forEach(function (r) { var o = el('option', null, r[1]); o.value = r[0]; if (u.role === r[0]) o.selected = true; sel.appendChild(o); });
      if (!u.role) none.selected = true;
      sel.addEventListener('change', function () { act('mod_set_role', { target: u.id, new_role: sel.value || null }, reload); });
      a.appendChild(sel);
    }
    row.appendChild(a);
    return row;
  }

  function ban(u, minutes, scope, reload) {
    var why = prompt('Reason for ' + u.name + ' (shown to them):', '');
    if (why === null) return;
    act('mod_ban', { target: u.id, minutes: minutes, ban_scope: scope, why: why }, reload);
  }

  function showMessages(u, row) {
    var old = row.querySelector('.mod-user-msgs');
    if (old) { old.remove(); return; }
    var wrap = el('div', 'mod-user-msgs');
    wrap.style.width = '100%';
    row.appendChild(wrap);
    rpc('mod_user_messages', { target: u.id }).then(function (rows) {
      if (!rows.length) wrap.appendChild(el('p', 'mod-empty', 'No public chat messages.'));
      rows.forEach(function (m) {
        var line = el('div', 'mod-row');
        var g = el('div', 'grow');
        g.appendChild(el('small', null, when(m.created_at)));
        g.appendChild(el('div', 'mod-msg' + (m.deleted ? ' deleted' : ''), m.body));
        line.appendChild(g);
        if (!m.deleted) line.appendChild(btn('Remove', 'mod-danger', function () { act('mod_delete_message', { msg: m.id, why: '' }, function () { line.remove(); }); }));
        wrap.appendChild(line);
      });
    }).catch(function (e) { wrap.appendChild(el('p', 'mod-empty', e.message)); });
  }

  /* ---------- staff list ---------- */

  function Staff(pane) {
    var b = box(pane, 'Staff');
    b.appendChild(el('p', 'mod-sub', 'Roles and what they can do. Each role also unlocks its own exclusive badge on the player\'s profile. Helpers: reports and removing messages. Moderators: also kicks, mutes, chat bans up to 7 days and pins. Admins: also site-wide and permanent bans, profile resets, the word filter, chat settings, and making helpers and moderators. Developers: also the audit log and making admins. Only the master account can make developers.'));
    var list = el('div');
    b.appendChild(list);
    function load() {
      list.textContent = '';
      rpc('mod_users', { q: '@staff' }).then(function (rows) {
        rows = rows.filter(function (u) { return u.role; });
        if (!rows.length) list.appendChild(el('p', 'mod-empty', 'No staff yet. Find a player under Players and pick a role.'));
        rows.forEach(function (u) { list.appendChild(userRow(u, load)); });
      }).catch(function (e) { list.appendChild(el('p', 'mod-empty', e.message)); });
    }
    load();
  }

  /* ---------- word filter ---------- */

  function Filter(pane) {
    var b = box(pane, 'Word filter');
    b.appendChild(el('p', 'mod-sub', 'Whole words on this list are starred out in public chat (case doesn\'t matter). Letters, numbers and spaces only.'));
    var form = el('form', 'mod-search');
    var w = el('input', 'text-input'); w.placeholder = 'Add a word'; w.maxLength = 30;
    var add = el('button', 'btn btn-primary', 'Add'); add.type = 'submit';
    form.appendChild(w); form.appendChild(add);
    b.appendChild(form);
    var chips = el('div', 'mod-chips');
    b.appendChild(chips);
    function load() {
      chips.textContent = '';
      rpc('mod_filter').then(function (words) {
        words.forEach(function (word) {
          var c = el('span', 'mod-chip', word);
          var x = el('button', null, '×'); x.type = 'button'; x.title = 'Remove';
          x.addEventListener('click', function () { act('mod_filter_set', { filter_word: word, add_it: false }, load); });
          c.appendChild(x);
          chips.appendChild(c);
        });
      }).catch(function (e) { chips.appendChild(el('p', 'mod-empty', e.message)); });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); if (w.value.trim()) act('mod_filter_set', { filter_word: w.value.trim(), add_it: true }, function () { w.value = ''; load(); }); });
    load();
  }

  /* ---------- audit log ---------- */

  function Audit(pane) {
    var b = box(pane, 'Audit log');
    var list = el('div');
    b.appendChild(list);
    rpc('mod_audit').then(function (rows) {
      if (!rows.length) list.appendChild(el('p', 'mod-empty', 'Nothing logged yet.'));
      rows.forEach(function (l) {
        var row = el('div', 'mod-row');
        var g = el('div', 'grow');
        g.appendChild(el('div', null, l.actor + ' · ' + l.action + (l.target ? ' · ' + l.target.name : '')));
        g.appendChild(el('small', null, when(l.created_at) + (l.detail ? ' · ' + JSON.stringify(l.detail) : '')));
        row.appendChild(g);
        list.appendChild(row);
      });
    }).catch(function (e) { list.appendChild(el('p', 'mod-empty', e.message)); });
  }

  /* ---------- master account ---------- */

  function Account(pane) {
    var b = box(pane, 'Master account');
    var form = el('form', 'mod-form');
    var p1 = el('input', 'text-input'); p1.type = 'password'; p1.placeholder = 'New password (10+ characters)'; p1.autocomplete = 'new-password';
    var p2 = el('input', 'text-input'); p2.type = 'password'; p2.placeholder = 'Again'; p2.autocomplete = 'new-password';
    var save = el('button', 'btn btn-primary', 'Change password'); save.type = 'submit';
    [p1, p2, save].forEach(function (x) { form.appendChild(x); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (p1.value !== p2.value) return toast('Those passwords don\'t match');
      act('mod_master_password', { new_password: p1.value }, function () { p1.value = p2.value = ''; toast('Password changed. Other master sessions were logged out.'); });
    });
    b.appendChild(el('p', 'mod-sub', 'Changing the password logs out every other master session.'));
    b.appendChild(form);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
