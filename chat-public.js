// chat-public.js: the balcade public chatroom inside /chat. Unlike DMs and rooms (peer-to-peer in chat.js),
// it's stored in the Supabase database, so everyone sees the same history and staff can moderate it.
//
// Uses the same profile as the games (games-social.js on this page signs you in and supplies names, badges,
// avatars and the profile popup). Messages arrive live over Supabase Realtime, with polling as a fallback.
// Everything that matters is enforced by the database: the word filter (stars words out), slow mode, the
// lock, mutes and bans, and staff powers (see supabase/migrations/2026-10-10-chat-moderation.sql).
//
// Features: replies, reactions, @mentions (they ring the mentioned player's bell), edits and deletes of your
// own messages, /me /shrug /tableflip /unflip, clickable names and links, pinned messages, a message of the
// day, report buttons, and inline staff tools for players with a staff role.
//
// API (window.ChatPublic): show(), hide()
(function () {
  'use strict';
  // The game bubble is a direct-message surface, not the public room.
  if (/[?&]mini(?:=|&|$)/.test(location.search)) return;

  var ROOM = 'public', PAGE_SIZE = 60, REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '💀'];
  var LEVEL = { helper: 1, moderator: 2, admin: 3, dev: 4 };
  // A small copy of the filter so you're warned before sending; the database's list is the real one.
  var SOFT_FILTER = /\b(fuck\w*|cunt|cock|dick|pussy|porn\w*|nudes?|sex|horny|cum|dildo|tits|slut|whore|rape|nigg\w*|fag\w*|retard|kys)\b/i;

  var SOC = window.GameSocial;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var S = {
    built: false, open: false, sb: null, me: null, uid: null, msgs: new Map(), order: [], profiles: {}, reactions: {},
    settings: { locked: false, slow_seconds: 0, motd: '' }, replyTo: null, editing: null, oldestId: null, newestId: 0,
    channel: null, poll: null, lastSent: 0, unavailable: null, online: 0
  };

  /* ---------- sidebar entry ---------- */

  function buildEntry() {
    var scroll = document.querySelector('.side-scroll');
    if (!scroll || $('pubEntry')) return;
    var title = el('p', 'side-title', 'Public');
    var b = el('button', 'conv pub-entry');
    b.type = 'button';
    b.id = 'pubEntry';
    var icon = el('span', 'pub-entry-icon', '🌐');
    var text = el('span', 'conv-text');
    text.appendChild(el('span', 'conv-name', 'balcade public chat'));
    var sub = el('span', 'conv-preview', 'Everyone, one room');
    sub.id = 'pubEntrySub';
    text.appendChild(sub);
    b.appendChild(icon);
    b.appendChild(text);
    b.addEventListener('click', function () { location.hash = '#public'; });
    scroll.insertBefore(b, scroll.firstChild);
    scroll.insertBefore(title, b);
  }

  /* ---------- the view ---------- */

  function build() {
    if (S.built) return;
    S.built = true;
    var view = el('div', 'conv-view pub-view hidden');
    view.id = 'publicView';
    view.innerHTML =
      '<div class="conv-head">' +
      '  <button class="icon-btn back-btn" type="button" id="pubBack" aria-label="Back"><svg><use href="#i-back"/></svg></button>' +
      '  <span class="pub-head-icon">🌐</span>' +
      '  <div class="conv-head-text"><h2 class="conv-head-title">balcade public chat</h2><p class="conv-head-sub" id="pubSub">Connecting…</p></div>' +
      '</div>' +
      '<div class="banner hidden" id="pubMotd"></div>' +
      '<div class="pub-pinned hidden" id="pubPinned"></div>' +
      '<div class="messages" id="pubMessages" tabindex="0" aria-label="Public chat messages"></div>' +
      '<div class="pub-notice hidden" id="pubNotice"></div>' +
      '<div class="composer">' +
      '  <div class="composer-bars" id="pubBars"></div>' +
      '  <div class="composer-box">' +
      '    <textarea class="composer-input" id="pubInput" rows="1" maxlength="500" placeholder="Message everyone" aria-label="Message the public chat"></textarea>' +
      '    <button class="send-btn" type="button" id="pubSend" aria-label="Send"><svg><use href="#i-send"/></svg></button>' +
      '  </div>' +
      '  <p class="pub-rules">Be kind. Words on the filter are starred out, and staff can mute or ban. <kbd>/me</kbd> <kbd>/shrug</kbd> <kbd>/tableflip</kbd> work.</p>' +
      '</div>';
    $('mainPane').appendChild(view);
    $('pubBack').addEventListener('click', function () { if (window.ChatApp) window.ChatApp.home(); });
    $('pubSend').addEventListener('click', send);
    var input = $('pubInput');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      if (e.key === 'Escape') { S.replyTo = null; S.editing = null; input.value = ''; paintBars(); }
      if (e.key === 'ArrowUp' && !input.value) editLastOwn();
    });
    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; softWarn(); });
    $('pubMessages').addEventListener('scroll', function () { if ($('pubMessages').scrollTop < 40) loadOlder(); });
  }

  function show() {
    build();
    S.open = true;
    $('publicView').classList.remove('hidden');
    document.querySelectorAll('.conv.active').forEach(function (c) { c.classList.remove('active'); });
    $('pubEntry') && $('pubEntry').classList.add('active');
    if (!SOC || !SOC.enabled) return unavailable('Public chat needs the site\'s database, which isn\'t set up on this copy of the page.');
    SOC.ready(function () { start(); });
  }
  function hide() {
    S.open = false;
    if ($('publicView')) $('publicView').classList.add('hidden');
    $('pubEntry') && $('pubEntry').classList.remove('active');
  }

  function unavailable(msg) {
    S.unavailable = msg;
    var list = $('pubMessages');
    list.textContent = '';
    list.appendChild(el('div', 'conv-start pub-empty', msg));
    $('pubSub').textContent = 'Unavailable';
    $('pubInput').disabled = true;
    $('pubSend').disabled = true;
  }

  /* ---------- data ---------- */

  var started = false;
  function start() {
    if (started) { scrollToEnd(); return; }
    S.sb = SOC.client();
    S.uid = SOC.uid();
    S.me = SOC.me();
    if (!S.sb) return unavailable('Public chat is only available on the live site.');
    started = true;
    Promise.all([
      S.sb.from('tetris_chat_settings').select('*').eq('room', ROOM).maybeSingle(),
      S.sb.from('tetris_chat').select('*').eq('room', ROOM).order('id', { ascending: false }).limit(PAGE_SIZE)
    ]).then(function (res) {
      if (res[1].error) {
        started = false;
        return unavailable(/does not exist|schema cache/i.test(res[1].error.message || '') ? 'Public chat is waiting for its database update. It\'ll open here as soon as that\'s run.' : 'Couldn\'t load public chat: ' + res[1].error.message);
      }
      if (res[0].data) S.settings = res[0].data;
      var rows = res[1].data.reverse();
      return absorb(rows).then(function () { paintAll(); scrollToEnd(); subscribe(); paintHeader(); checkMute(); countOnline(); });
    });
    setInterval(countOnline, 60000);
  }

  // Bring in messages: their authors' profiles and reactions.
  function absorb(rows) {
    if (!rows.length) return Promise.resolve();
    rows.forEach(function (m) {
      S.msgs.set(m.id, m);
      if (S.order.indexOf(m.id) === -1) S.order.push(m.id);
      S.newestId = Math.max(S.newestId, m.id);
      S.oldestId = S.oldestId == null ? m.id : Math.min(S.oldestId, m.id);
    });
    S.order.sort(function (a, b) { return a - b; });
    var ids = rows.map(function (m) { return m.user_id; }).filter(function (id, i, a) { return a.indexOf(id) === i && !S.profiles[id]; });
    var msgIds = rows.map(function (m) { return m.id; });
    return Promise.all([
      ids.length ? SOC.loadProfiles(ids).then(function (ps) { ps.forEach(function (p, i) { if (p) S.profiles[ids[i]] = p; }); }) : null,
      S.sb.from('tetris_chat_reactions').select('*').in('message_id', msgIds).then(function (r) {
        msgIds.forEach(function (id) { S.reactions[id] = []; });
        (r.data || []).forEach(function (x) { (S.reactions[x.message_id] = S.reactions[x.message_id] || []).push(x); });
      })
    ]);
  }

  function subscribe() {
    try {
      S.channel = S.sb.channel('balcade-public-chat')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tetris_chat', filter: 'room=eq.' + ROOM }, function (ev) {
          var m = ev.new && ev.new.id ? ev.new : null;
          if (!m) return;
          var fresh = !S.msgs.has(m.id);
          absorb([m]).then(function () { if (fresh) appendOne(m.id); else repaintOne(m.id); paintPinned(); });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tetris_chat_reactions' }, function (ev) {
          var r = ev.new && ev.new.message_id ? ev.new : ev.old;
          if (!r || !S.msgs.has(r.message_id)) return;
          refreshReactions(r.message_id);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tetris_chat_settings', filter: 'room=eq.' + ROOM }, function (ev) {
          if (ev.new) { S.settings = ev.new; paintHeader(); }
        })
        .subscribe();
    } catch (e) { console.warn('[public chat] realtime', e); }
    // Polling as a safety net (and for networks that block websockets).
    S.poll = setInterval(function () { if (S.open && !document.hidden) pollNew(); }, 6000);
  }

  function pollNew() {
    S.sb.from('tetris_chat').select('*').eq('room', ROOM).gt('id', S.newestId).order('id').limit(100).then(function (r) {
      var rows = (r.data || []).filter(function (m) { return !S.msgs.has(m.id); });
      if (rows.length) absorb(rows).then(function () { rows.forEach(function (m) { appendOne(m.id); }); });
    });
  }

  var loadingOlder = false;
  function loadOlder() {
    if (loadingOlder || S.oldestId == null || !S.sb) return;
    loadingOlder = true;
    var list = $('pubMessages'), before = list.scrollHeight;
    S.sb.from('tetris_chat').select('*').eq('room', ROOM).lt('id', S.oldestId).order('id', { ascending: false }).limit(PAGE_SIZE).then(function (r) {
      var rows = (r.data || []).reverse();
      if (!rows.length) { S.oldestId = null; loadingOlder = false; return; }
      return absorb(rows).then(function () { paintAll(); list.scrollTop = list.scrollHeight - before; loadingOlder = false; });
    });
  }

  function refreshReactions(id) {
    S.sb.from('tetris_chat_reactions').select('*').eq('message_id', id).then(function (r) { S.reactions[id] = r.data || []; repaintOne(id); });
  }

  function countOnline() {
    if (!S.sb) return;
    var since = new Date(Date.now() - 150000).toISOString();
    S.sb.from('tetris_profiles').select('id', { count: 'exact', head: true }).eq('presence->>page', 'chat').gte('last_seen', since).then(function (r) {
      if (r.error) return;
      S.online = r.count || 0;
      paintHeader();
    });
  }

  function checkMute() {
    S.sb.rpc('my_ban').then(function (r) {
      var b = r.data;
      if (!b) { notice(''); return; }
      notice((b.scope === 'all' ? 'You are banned' : 'You are muted in public chat') + (b.expires_at ? ' until ' + new Date(b.expires_at).toLocaleString('en-AU') : '') + (b.reason ? ' · ' + b.reason : ''), true);
    });
  }

  /* ---------- rendering ---------- */

  function level() { var me = SOC.me(); return me && LEVEL[me.role] || 0; }
  function profileOf(uid) { return S.profiles[uid] || SOC.cleanProfile({ id: uid, name: 'Player' }); }
  function fmtTime(iso) { var d = new Date(iso); return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }); }
  function fmtDay(iso) { return new Date(iso).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }); }

  function paintHeader() {
    var st = S.settings, bits = [];
    bits.push(S.online ? S.online + ' in chat now' : 'Everyone on balcade');
    if (st.slow_seconds) bits.push('slow mode ' + st.slow_seconds + 's');
    if (st.locked) bits.push('locked');
    $('pubSub').textContent = bits.join(' · ');
    var sub = $('pubEntrySub');
    if (sub) sub.textContent = S.online ? S.online + ' online' : 'Everyone, one room';
    var motd = $('pubMotd');
    motd.textContent = st.motd || '';
    motd.classList.toggle('hidden', !st.motd);
    var locked = st.locked && level() < 1;
    $('pubInput').disabled = locked || !!S.unavailable;
    $('pubInput').placeholder = locked ? 'Public chat is locked by staff right now' : 'Message everyone';
  }

  function notice(text, bad) {
    var n = $('pubNotice');
    n.textContent = text || '';
    n.classList.toggle('hidden', !text);
    n.classList.toggle('bad', !!bad);
  }

  function paintAll() {
    var list = $('pubMessages');
    list.textContent = '';
    if (S.oldestId != null) {
      var more = el('button', 'pub-older', 'Load earlier messages');
      more.type = 'button';
      more.addEventListener('click', loadOlder);
      list.appendChild(more);
    }
    if (!S.order.length) list.appendChild(el('div', 'conv-start pub-empty', 'No messages yet. Say hi to everyone!'));
    var prev = null;
    S.order.forEach(function (id) { list.appendChild(msgNode(S.msgs.get(id), prev)); prev = S.msgs.get(id); });
    paintPinned();
  }

  function appendOne(id) {
    var list = $('pubMessages');
    var nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 140;
    var empty = list.querySelector('.pub-empty');
    if (empty) empty.remove();
    var idx = S.order.indexOf(id), prev = idx > 0 ? S.msgs.get(S.order[idx - 1]) : null;
    list.appendChild(msgNode(S.msgs.get(id), prev));
    var m = S.msgs.get(id);
    if (nearEnd || m.user_id === S.uid) scrollToEnd();
  }

  function repaintOne(id) {
    var old = document.querySelector('#pubMessages [data-id="' + id + '"]');
    if (!old) return;
    var idx = S.order.indexOf(id), prev = idx > 0 ? S.msgs.get(S.order[idx - 1]) : null;
    old.replaceWith(msgNode(S.msgs.get(id), prev, true));
  }

  function scrollToEnd() { var list = $('pubMessages'); if (list) list.scrollTop = list.scrollHeight; }

  // noSep: when repainting one message in place, its day separator is already there.
  function msgNode(m, prev, noSep) {
    var p = profileOf(m.user_id), mine = m.user_id === S.uid;
    var grouped = prev && prev.user_id === m.user_id && !prev.deleted && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000 && !m.reply_to;
    var wrap = document.createDocumentFragment();
    if (!noSep && (!prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString())) {
      var sep = el('div', 'day-sep', fmtDay(m.created_at));
      wrap.appendChild(sep);
    }
    var action = /^\/me /.test(m.body);
    var me = SOC.me();
    var mentionsMe = me && !mine && new RegExp('@' + escapeRe(me.name) + '\\b', 'i').test(m.body);
    var node = el('div', 'msg' + (grouped ? ' grouped' : '') + (action ? ' action' : '') + (mentionsMe ? ' mentioned' : '') + (m.pinned ? ' pinned' : ''));
    node.dataset.id = m.id;
    var av = SOC.ui.avatarEl(p, 40);
    av.classList.add('pub-avatar');
    av.addEventListener('click', function () { SOC.openProfile(p.id); });
    node.appendChild(grouped ? el('span', 'msg-gutter', fmtTime(m.created_at)) : av);
    var body = el('div', 'msg-body');
    if (!grouped) {
      var head = el('div', 'msg-head');
      var nm = SOC.ui.nameSpan(p, 'msg-user');
      nm.addEventListener('click', function () { SOC.openProfile(p.id); });
      head.appendChild(nm);
      if (p.role) head.appendChild(el('span', 'soc-role-pill role-' + p.role, SOC.ui.roleNames[p.role]));
      (p.badges || []).forEach(function (b) { if (SOC.ui.hasBadge(p, b)) head.appendChild(SOC.ui.badgeChip(b)); });
      head.appendChild(el('span', 'msg-time', fmtTime(m.created_at)));
      if (m.pinned) head.appendChild(el('span', 'pub-pin-tag', '📌 pinned'));
      body.appendChild(head);
    }
    if (m.reply_to) {
      var r = S.msgs.get(m.reply_to), rq = el('div', 'msg-reply');
      if (r) { rq.appendChild(el('b', null, profileOf(r.user_id).name)); rq.appendChild(document.createTextNode(' ' + r.body.slice(0, 120))); rq.addEventListener('click', function () { flash(r.id); }); }
      else rq.textContent = '↩ an earlier message';
      body.appendChild(rq);
    }
    if (m.deleted) body.appendChild(el('div', 'msg-deleted', m.body === '[deleted]' ? 'Message deleted' : 'Removed by staff'));
    else {
      var text = el('div', 'msg-text');
      renderText(text, action ? '* ' + p.name + ' ' + m.body.slice(4) : m.body);
      if (m.edited_at) text.appendChild(el('span', 'msg-edited', '(edited)'));
      body.appendChild(text);
    }
    // reactions
    var rs = S.reactions[m.id] || [];
    if (rs.length && !m.deleted) {
      var counts = {};
      rs.forEach(function (x) { counts[x.emoji] = counts[x.emoji] || { n: 0, mine: false }; counts[x.emoji].n++; if (x.user_id === S.uid) counts[x.emoji].mine = true; });
      var row = el('div', 'reactions');
      Object.keys(counts).forEach(function (e) {
        var b = el('button', 'reaction' + (counts[e].mine ? ' mine' : ''));
        b.type = 'button';
        b.appendChild(document.createTextNode(e + ' '));
        b.appendChild(el('b', null, String(counts[e].n)));
        b.addEventListener('click', function () { toggleReaction(m.id, e, counts[e].mine); });
        row.appendChild(b);
      });
      body.appendChild(row);
    }
    node.appendChild(body);
    if (!m.deleted) node.appendChild(tools(m, mine));
    wrap.appendChild(node);
    return wrap;
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Text with clickable links and highlighted @mentions, built from text nodes (never innerHTML).
  function renderText(target, text) {
    var re = /(https?:\/\/[^\s<]+)|(@[A-Za-z0-9_][A-Za-z0-9_ .-]{0,15})/g, last = 0, m;
    var me = SOC.me();
    while ((m = re.exec(text))) {
      if (m.index > last) target.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        var a = el('a', null, m[1]);
        a.href = m[1]; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow ugc';
        target.appendChild(a);
      } else {
        var who = m[2].trim();
        var span = el('span', 'mention' + (me && who.toLowerCase() === '@' + me.name.toLowerCase() ? ' me' : ''), who);
        target.appendChild(span);
        if (m[2] !== who) target.appendChild(document.createTextNode(m[2].slice(who.length)));
      }
      last = re.lastIndex;
    }
    if (last < text.length) target.appendChild(document.createTextNode(text.slice(last)));
  }

  function tools(m, mine) {
    var bar = el('div', 'msg-tools');
    function tool(label, title, fn) { var b = el('button', 'icon-btn', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); bar.appendChild(b); }
    tool('↩', 'Reply', function () { S.replyTo = m.id; S.editing = null; paintBars(); $('pubInput').focus(); });
    tool('😊', 'React', function (e) { reactPicker(e.currentTarget, m.id); });
    if (mine) {
      if (Date.now() - new Date(m.created_at) < 15 * 60000) tool('✎', 'Edit', function () { startEdit(m); });
      tool('🗑', 'Delete', function () { if (confirm('Delete this message?')) S.sb.rpc('chat_delete', { msg: m.id }).then(errToast); });
    } else {
      tool('⚑', 'Report', function () { report(m); });
    }
    var lv = level();
    if (lv >= 1 && !mine) {
      tool('⛔', 'Staff: remove message', function () { var why = prompt('Remove this message. Reason (optional):', ''); if (why !== null) S.sb.rpc('mod_delete_message', { token: null, msg: m.id, why: why }).then(errToast); });
    }
    if (lv >= 2) {
      tool(m.pinned ? '📍' : '📌', m.pinned ? 'Staff: unpin' : 'Staff: pin', function () { S.sb.rpc('mod_pin', { token: null, msg: m.id, on_off: !m.pinned }).then(errToast); });
      if (!mine) {
        tool('⏳', 'Staff: mute for 10 minutes', function () { var why = prompt('Mute ' + profileOf(m.user_id).name + ' from public chat for 10 minutes. Reason:', ''); if (why !== null) S.sb.rpc('mod_ban', { token: null, target: m.user_id, minutes: 10, ban_scope: 'chat', why: why }).then(okToast('Muted for 10 minutes')); });
        tool('🚫', 'Staff: ban from chat for a day', function () { var why = prompt('Ban ' + profileOf(m.user_id).name + ' from public chat for 24 hours. Reason:', ''); if (why !== null) S.sb.rpc('mod_ban', { token: null, target: m.user_id, minutes: 1440, ban_scope: 'chat', why: why }).then(okToast('Banned from chat for 24 hours')); });
      }
    }
    return bar;
  }

  function reactPicker(anchor, id) {
    var old = document.querySelector('.pub-react-pop');
    if (old) { old.remove(); return; }
    var pop = el('div', 'pub-react-pop');
    REACTIONS.forEach(function (e) {
      var b = el('button', null, e);
      b.type = 'button';
      b.addEventListener('click', function () {
        pop.remove();
        var mine = (S.reactions[id] || []).some(function (x) { return x.user_id === S.uid && x.emoji === e; });
        toggleReaction(id, e, mine);
      });
      pop.appendChild(b);
    });
    anchor.parentNode.appendChild(pop);
    setTimeout(function () { document.addEventListener('click', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', off); } }); }, 0);
  }

  function toggleReaction(id, emoji, mine) {
    var q = mine
      ? S.sb.from('tetris_chat_reactions').delete().eq('message_id', id).eq('user_id', S.uid).eq('emoji', emoji)
      : S.sb.from('tetris_chat_reactions').insert({ message_id: id, user_id: S.uid, emoji: emoji });
    q.then(function (r) { if (r.error) toast(r.error.message); refreshReactions(id); });
  }

  function paintPinned() {
    var pins = S.order.map(function (id) { return S.msgs.get(id); }).filter(function (m) { return m.pinned && !m.deleted; });
    var box = $('pubPinned');
    box.textContent = '';
    box.classList.toggle('hidden', !pins.length);
    if (!pins.length) return;
    var m = pins[pins.length - 1];
    var b = el('button', 'pub-pinned-btn');
    b.type = 'button';
    b.appendChild(el('span', null, '📌'));
    b.appendChild(el('b', null, profileOf(m.user_id).name + ': '));
    b.appendChild(document.createTextNode(m.body.slice(0, 140)));
    b.addEventListener('click', function () { flash(m.id); });
    box.appendChild(b);
  }

  function flash(id) {
    var n = document.querySelector('#pubMessages [data-id="' + id + '"]');
    if (!n) return;
    n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
  }

  function paintBars() {
    var bars = $('pubBars');
    bars.textContent = '';
    var target = S.editing ? S.msgs.get(S.editing) : S.replyTo ? S.msgs.get(S.replyTo) : null;
    if (!target) return;
    var bar = el('div', 'composer-bar');
    bar.appendChild(el('span', null, S.editing ? 'Editing your message' : 'Replying to ' + profileOf(target.user_id).name));
    var x = el('button', 'icon-btn', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Cancel');
    x.addEventListener('click', function () { S.replyTo = null; S.editing = null; if (!S.editing) $('pubInput').value = ''; paintBars(); });
    bar.appendChild(x);
    bars.appendChild(bar);
  }

  function startEdit(m) { S.editing = m.id; S.replyTo = null; $('pubInput').value = m.body; paintBars(); $('pubInput').focus(); }
  function editLastOwn() {
    for (var i = S.order.length - 1; i >= 0; i--) {
      var m = S.msgs.get(S.order[i]);
      if (m.user_id === S.uid && !m.deleted && Date.now() - new Date(m.created_at) < 15 * 60000) return startEdit(m);
    }
  }

  function softWarn() {
    var v = $('pubInput').value;
    if (SOFT_FILTER.test(v)) notice('Heads up: some of those words are on the filter and will be starred out.');
    else if ($('pubNotice').classList.contains('bad')) return;
    else notice('');
  }

  /* ---------- sending ---------- */

  var COMMANDS = { '/shrug': '¯\\_(ツ)_/¯', '/tableflip': '(╯°□°)╯︵ ┻━┻', '/unflip': '┬─┬ ノ( ゜-゜ノ)', '/lenny': '( ͡° ͜ʖ ͡°)' };

  function send() {
    var input = $('pubInput');
    var text = input.value.trim();
    if (!text || !S.sb || S.unavailable) return;
    var cmd = text.split(' ')[0].toLowerCase();
    if (COMMANDS[cmd]) text = (text.slice(cmd.length).trim() + ' ' + COMMANDS[cmd]).trim();
    if (text.length > 500) { toast('Messages are up to 500 characters.'); return; }
    if (S.editing) {
      var id = S.editing;
      S.editing = null;
      input.value = '';
      paintBars();
      S.sb.rpc('chat_edit', { msg: id, new_body: text }).then(errToast);
      return;
    }
    var slow = S.settings.slow_seconds;
    if (slow && level() < 1 && Date.now() - S.lastSent < slow * 1000) { notice('Slow mode: wait ' + Math.ceil((slow * 1000 - (Date.now() - S.lastSent)) / 1000) + 's.'); return; }
    var row = { room: ROOM, user_id: S.uid, body: text, reply_to: S.replyTo || null };
    input.value = '';
    input.style.height = 'auto';
    S.replyTo = null;
    paintBars();
    $('pubSend').disabled = true;
    S.sb.from('tetris_chat').insert(row).select().single().then(function (r) {
      $('pubSend').disabled = false;
      if (r.error) { input.value = text; notice(friendlyError(r.error), true); return; }
      S.lastSent = Date.now();
      notice('');
      var m = r.data;
      absorb([m]).then(function () { if (!document.querySelector('#pubMessages [data-id="' + m.id + '"]')) appendOne(m.id); });
      pingMentions(text);
    });
  }

  function friendlyError(e) {
    var msg = e.message || 'Couldn\'t send that.';
    if (/row-level security/i.test(msg)) return 'You can\'t post right now (you may be muted or banned).';
    return msg;
  }

  // @Name rings that player's bell, if they've posted here recently or are your friend.
  function pingMentions(text) {
    var names = {};
    Object.keys(S.profiles).forEach(function (id) { names[S.profiles[id].name.toLowerCase()] = id; });
    (SOC.friends() || []).forEach(function (f) { if (f.profile) names[f.profile.name.toLowerCase()] = f.id; });
    var sent = {};
    (text.match(/@[A-Za-z0-9_][A-Za-z0-9_ .-]{0,15}/g) || []).forEach(function (tag) {
      var n = tag.slice(1).trim().toLowerCase();
      var id = names[n];
      if (id && id !== S.uid && !sent[id]) { sent[id] = true; SOC.sendNote(id, 'mention').catch(function () {}); }
    });
  }

  function report(m) {
    var why = prompt('Report this message to staff. What\'s wrong with it?', '');
    if (!why) return;
    S.sb.from('tetris_reports').insert({ reporter: S.uid, target_user: m.user_id, message_id: m.id, reason: why.slice(0, 300) }).then(function (r) {
      toast(r.error ? 'Couldn\'t send the report' : 'Reported. Thanks, staff will take a look.');
    });
  }

  function toast(text) { if (window.Games && window.Games.banner) window.Games.banner(text); }
  function errToast(r) { if (r && r.error) toast(r.error.message); }
  function okToast(text) { return function (r) { toast(r && r.error ? r.error.message : text); }; }

  function init() {
    buildEntry();
    // chat.js may have already routed before this file loaded
    if (location.hash === '#public') { var go = function () { if (window.ChatApp) { location.hash = ''; location.hash = '#public'; } }; setTimeout(go, 600); }
  }

  window.ChatPublic = { show: show, hide: hide };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
