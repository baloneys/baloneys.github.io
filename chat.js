// chat.js: /chat. Peer-to-peer chat for baloneys: no accounts server, no database.
//
// - Identity: an ECDSA key pair made in your browser and kept in IndexedDB. Your friend code is a
//   hash of the public key, and every connection proves ownership with a signature.
// - Contacts and DMs go directly between browsers (WebRTC data channels via PeerJS). Messages to
//   someone who is offline wait in an outbox and send when you are both online. History stays on
//   each device.
// - Rooms are hosted by one member's browser, which relays messages and enforces mute/kick/bans.
//   If the host leaves, another member takes over.
// - Voice is peer-to-peer WebRTC audio.
// - PeerJS's public broker only introduces browsers to each other; messages never go through it.
// Notes for the site owner: CHAT.md.
(function () {
  'use strict';

  // ---------- Config ----------

  const params = new URLSearchParams(location.search);
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // PeerJS broker. The free public one by default; a local one for testing (?peerhost=127.0.0.1&peerport=9001).
  const PEER_OPTS = LOCAL && params.get('peerhost')
    ? { host: params.get('peerhost'), port: Number(params.get('peerport') || 9000), path: '/', secure: false }
    : {};
  const PREFIX = 'bchat-';
  const ROOM_PREFIX = 'bchat-room-';
  const GIPHY_KEY = atob('R2xWR1lIa3IzV1NCbmxsY2E1NGlOdDB5RmJqejdMNjU=');
  const NSFW_LIB = 'https://cdn.jsdelivr.net/npm/nsfwjs@4.4.0/dist/browser/nsfwjs.min.js';
  const NSFW_MODEL = new URL('chat-model/model.json', location.href).href;
  // Add a TURN server here if people behind strict networks can't connect.
  const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const PAGE = 80;
  const ROOM_HISTORY = 150;
  const MAX_VOICE = 8;
  const MAX_ROOM = 50;
  const COLORS = ['#9d00ff', '#e60065', '#c77dff', '#ff5fa2', '#4cc9f0', '#3ddc97', '#ffd166', '#ff8c42', '#7b61ff', '#f7f2ff'];
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
  const REPORT_REASONS = [
    ['child_safety', 'Child sexual abuse or exploitation'],
    ['sexual', 'Nudity or sexual content'],
    ['harassment', 'Harassment, hate or bullying'],
    ['violence', 'Violence, threats or gore'],
    ['self_harm', 'Self-harm or suicide'],
    ['spam', 'Spam or scams'],
    ['other', 'Something else']
  ];

  // ---------- State ----------

  const S = {
    me: null,               // { id, name, color, bio, avatar, pub, priv }
    key: null,              // private CryptoKey
    profiles: {},           // id -> { name, color, bio, avatar }
    contacts: {},           // id -> { id, status: 'accepted'|'outgoing'|'incoming', addedAt, lastSeen }
    blocks: {},             // id -> true
    globalBlocks: {},       // id -> reason (chat-blocklist.json on the site)
    rooms: {},              // code -> saved room info (see roomInfo)
    meta: {},               // convKey -> { last: { from, text }, updatedAt, lastRead }
    customs: {},            // my custom emoji/stickers: id -> { kind, name, data }
    online: {},             // id -> true while a verified contact link is open
    conv: null,             // { type: 'dm'|'room', id, key }
    msgs: new Map(),
    msgNodes: new Map(),
    limit: PAGE,
    hasOlder: false,
    reply: null,
    editing: null,
    pendingImages: [],
    members: {},            // current room: id -> 'owner'|'member'
    roomMuted: {},
    roomBanned: {},
    typing: {},
    showMembers: false,
    nsfw: {},               // image key -> 'ok'|'flagged'|'error'|'checking'
    revealed: new Set(),
    settings: loadSettings()
  };

  // ---------- Small helpers ----------

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k in n && k !== 'list' && k !== 'form') n[k] = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }

  function loadSettings() {
    try { return Object.assign({ sounds: true, desktop: true }, JSON.parse(localStorage.getItem('chat.settings') || '{}')); } catch (e) { return { sounds: true, desktop: true }; }
  }
  function saveSettings() { try { localStorage.setItem('chat.settings', JSON.stringify(S.settings)); } catch (e) { /* private mode */ } }

  function toast(text, ms) {
    const t = el('div', { class: 'toast', text });
    $('toasts').append(t);
    setTimeout(() => t.remove(), ms || 3200);
  }

  function fail(err, fallback) {
    console.error(err);
    toast(fallback || (err && err.message) || 'Something went wrong.');
  }

  function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function fmtDay(ts) {
    const d = new Date(ts), now = new Date();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  function fmtAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function randomId(n) {
    const a = new Uint8Array(n || 12); crypto.getRandomValues(a);
    return [...a].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  }

  // Friend codes: 16 chars of base32, shown as ABCD-EFGH-JKLM-NPQR.
  const fmtCode = (id) => (id || '').toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
  const parseCode = (text) => String(text || '').replace(/^.*#add\//, '').toLowerCase().replace(/[^a-z2-9]/g, '');
  const dmKey = (id) => 'dm_' + id;
  const roomKey = (code) => 'room_' + code;

  const profileOf = (id) => (id === (S.me && S.me.id) ? S.me : S.profiles[id]) || null;
  const nameOf = (id) => { const p = profileOf(id); return (p && p.name) || (id ? fmtCode(id).slice(0, 9) : '…'); };
  const isBlocked = (id) => !!S.blocks[id] || !!S.globalBlocks[id];
  const isContact = (id) => S.contacts[id] && S.contacts[id].status === 'accepted';

  // Plain-text summary for replies, the sidebar and notifications: spoilers stay hidden.
  function plain(text) {
    return text.replace(/\|\|[\s\S]+?\|\|/g, '▒▒▒').replace(/(\*\*|__|~~|`)/g, '').replace(/\s+/g, ' ').trim();
  }

  function preview(m) {
    if (m.text) return plain(m.text).slice(0, 200);
    if (m.sticker) return 'Sticker';
    if (m.image) return m.image.startsWith('https://') ? 'GIF' : 'Image';
    return '';
  }

  // Cheap content key for caching image-filter results.
  function imgKey(data) {
    let h = 2166136261;
    const step = Math.max(1, Math.floor(data.length / 4000));
    for (let i = 0; i < data.length; i += step) { h ^= data.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'i' + (h >>> 0).toString(36) + data.length.toString(36);
  }

  // ---------- Local storage (IndexedDB) ----------
  // kv: identity, contacts, blocks, rooms, meta, customs, outboxes. msgs: every message, keyed [conv, id].

  const DB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const req = indexedDB.open('baloneys-chat', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('kv', { keyPath: 'k' });
          const m = d.createObjectStore('msgs', { keyPath: ['conv', 'id'] });
          m.createIndex('byConvTs', ['conv', 'ts']);
        };
        req.onsuccess = () => { this.db = req.result; res(this.db); };
        req.onerror = () => rej(req.error || new Error("This browser can't store chat data (private mode?)."));
      });
    },
    tx(store, mode, fn) {
      return this.open().then((d) => new Promise((res, rej) => {
        const t = d.transaction(store, mode);
        const out = fn(t.objectStore(store));
        t.oncomplete = () => res(out && 'result' in out ? out.result : out);
        t.onerror = () => rej(t.error);
      }));
    },
    get(k) { return this.tx('kv', 'readonly', (s) => s.get(k)).then((r) => (r ? r.v : undefined)); },
    set(k, v) { return this.tx('kv', 'readwrite', (s) => s.put({ k, v })); },
    del(k) { return this.tx('kv', 'readwrite', (s) => s.delete(k)); },
    putMsg(m) { return this.tx('msgs', 'readwrite', (s) => s.put(m)); },
    getMsg(conv, id) { return this.tx('msgs', 'readonly', (s) => s.get([conv, id])); },
    // Newest `limit` messages of a conversation, oldest first.
    recent(conv, limit) {
      return this.open().then((d) => new Promise((res, rej) => {
        const out = [];
        const range = IDBKeyRange.bound([conv, -Infinity], [conv, Infinity]);
        const req = d.transaction('msgs').objectStore('msgs').index('byConvTs').openCursor(range, 'prev');
        req.onsuccess = () => {
          const c = req.result;
          if (!c || out.length >= limit) { res(out.reverse()); return; }
          out.push(c.value); c.continue();
        };
        req.onerror = () => rej(req.error);
      }));
    },
    clearConv(conv) {
      return this.open().then((d) => new Promise((res) => {
        const t = d.transaction('msgs', 'readwrite');
        const req = t.objectStore('msgs').index('byConvTs').openCursor(IDBKeyRange.bound([conv, -Infinity], [conv, Infinity]));
        req.onsuccess = () => { const c = req.result; if (c) { c.delete(); c.continue(); } };
        t.oncomplete = res;
      }));
    }
  };

  // Saves are batched but never postponed more than 150ms, and flushed when the tab closes.
  const saveTimers = {};
  function writeNow(name) {
    clearTimeout(saveTimers[name]);
    delete saveTimers[name];
    const val = { contacts: S.contacts, blocks: S.blocks, rooms: S.rooms, meta: S.meta, customs: S.customs, profiles: S.profiles }[name];
    return DB.set(name, val).catch((e) => console.warn('save', name, e));
  }
  function persist(name) {
    // Rooms, contacts, blocks and emoji save straight away; read markers and profile caches batch.
    if (name !== 'meta' && name !== 'profiles') { writeNow(name); return; }
    if (!saveTimers[name]) saveTimers[name] = setTimeout(() => writeNow(name), 150);
  }
  function flushSaves() { Object.keys(saveTimers).forEach(writeNow); }

  // ---------- Identity (ECDSA P-256) ----------

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function idFromPub(jwk) {
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') throw new Error('bad key');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jwk.x + '.' + jwk.y));
    const bytes = new Uint8Array(digest).slice(0, 10);
    let bits = '', out = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    for (let i = 0; i < 80; i += 5) out += 'abcdefghijkmnpqrstuvwxyz23456789'[parseInt(bits.slice(i, i + 5), 2)];
    return out;
  }

  async function createIdentity(name, color) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const pubClean = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y };
    return { id: await idFromPub(pubClean), name, color, bio: '', avatar: null, pub: pubClean, priv, createdAt: Date.now() };
  }

  async function loadKey(me) {
    return crypto.subtle.importKey('jwk', me.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }

  async function sign(text) {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, S.key, new TextEncoder().encode(text));
    return b64(sig);
  }

  async function verify(pubJwk, sigB64, text) {
    try {
      const key = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(sigB64), new TextEncoder().encode(text));
    } catch (e) { return false; }
  }

  // ---------- Site-wide blocklist (chat-blocklist.json in the repo) ----------

  function loadGlobalBlocks() {
    return fetch('chat-blocklist.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).then((j) => {
      S.globalBlocks = {};
      const list = (j && j.blocked) || {};
      for (const code in list) S.globalBlocks[parseCode(code)] = String(list[code] || 'Blocked by the site');
    }).catch(() => {});
  }

  // ---------- Profiles ----------

  // Clean a profile that came from someone else.
  function cleanProfile(p) {
    p = p || {};
    const out = {
      name: typeof p.name === 'string' ? p.name.replace(/[^\p{L}\p{N}_ .'-]/gu, '').trim().slice(0, 24) || 'someone' : 'someone',
      color: typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#9d00ff',
      bio: typeof p.bio === 'string' ? p.bio.slice(0, 190) : ''
    };
    if (typeof p.avatar === 'string' && p.avatar.length < 70000 && /^data:image\/(png|jpeg|webp|gif);base64,/.test(p.avatar)) out.avatar = p.avatar;
    if (typeof p.banner === 'string' && p.banner.length < 170000 && /^data:image\/(png|jpeg|webp|gif);base64,/.test(p.banner)) out.banner = p.banner;
    if (isHexPair(p.nameGrad)) out.nameGrad = p.nameGrad.slice(0, 2);
    if (isHexPair(p.bannerGrad)) out.bannerGrad = p.bannerGrad.slice(0, 2);
    return out;
  }

  const isHex = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  const isHexPair = (a) => Array.isArray(a) && a.length >= 2 && isHex(a[0]) && isHex(a[1]);

  function myProfile() {
    const m = S.me;
    return { name: m.name, color: m.color, bio: m.bio || '', avatar: m.avatar || undefined, banner: m.banner || undefined, nameGrad: m.nameGrad || undefined, bannerGrad: m.bannerGrad || undefined };
  }
  // Rooms send only this light version on every update; pictures travel once, on join or change.
  function lightProfile(p) { return p ? { name: p.name, color: p.color, bio: p.bio, nameGrad: p.nameGrad, bannerGrad: p.bannerGrad } : {}; }

  function setProfile(id, p, light) {
    let clean = cleanProfile(p);
    const old = S.profiles[id];
    if (light && old) {
      // Light updates carry no pictures: keep the ones we already have.
      if (old.avatar) clean.avatar = old.avatar;
      if (old.banner) clean.banner = old.banner;
    }
    if (old && JSON.stringify(old) === JSON.stringify(clean)) return;
    S.profiles[id] = clean;
    persist('profiles');
    S.msgNodes.clear();
    queueRerender();
  }

  // A person's name in their colour, or their gradient with a soft glow.
  function nameEl(id, cls, extra) {
    const p = profileOf(id) || {};
    const span = el('span', Object.assign({ class: 'uname' + (cls ? ' ' + cls : ''), text: nameOf(id) }, extra || {}));
    if (p.nameGrad) {
      span.classList.add('grad');
      span.style.setProperty('--g1', p.nameGrad[0]);
      span.style.setProperty('--g2', p.nameGrad[1]);
    } else if (p.color) span.style.color = p.color;
    return span;
  }

  function roomIcon(r, big) {
    const img = r && r.image && (iHost(r.code) ? r.image : safeSrc(r.image));
    const n = el('span', { class: 'room-icon' + (big ? ' big' : '') + (r && r.status !== 'connected' ? ' dim' : '') + (img ? ' has-img' : ''), text: img ? '' : ((r && (r.name || r.code)) || '#').slice(0, 1).toUpperCase() });
    if (img) n.style.backgroundImage = 'url("' + img.replace(/"/g, '') + '")';
    return n;
  }

  // Images from other people are only shown once the in-browser filter has passed them.
  function safeSrc(data) {
    if (!data) return null;
    if (data.startsWith('https://')) return data;
    const key = imgKey(data);
    const v = S.nsfw[key];
    if (v === 'ok' || S.revealed.has(key)) return data;
    if (!v) classifyLater(key, data);
    return null;
  }

  function avatar(id, size, withPresence) {
    const p = profileOf(id);
    const a = el('div', { class: 'avatar' + (size ? ' ' + size : '') });
    const url = p && p.avatar && (id === S.me.id ? p.avatar : safeSrc(p.avatar));
    if (url) a.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
    else { a.style.background = (p && p.color) || '#4a4060'; a.textContent = nameOf(id)[0] || '?'; }
    if (withPresence) {
      const dot = el('span', { class: 'presence' + (S.online[id] || id === S.me.id ? ' online' : '') });
      dot.dataset.presence = id;
      a.append(dot);
    }
    return a;
  }

  let rerenderQueued = false;
  function queueRerender() {
    if (rerenderQueued) return;
    rerenderQueued = true;
    requestAnimationFrame(() => {
      rerenderQueued = false;
      if (!S.me) return;
      renderSidebar();
      renderMe();
      if (S.conv) { renderMessages(false); renderConvHead(); renderConvBanner(); if (S.showMembers) renderMembers(); }
      renderVoice();
    });
  }
  // ---------- Modal ----------

  let modalClose = null;
  function openModal(title, body, actions, opts) {
    const card = $('modalCard');
    card.className = 'modal-card' + (opts && opts.wide ? ' wide' : '') + (opts && opts.card ? ' flush' : '');
    card.replaceChildren(...[
      title ? el('h2', { class: 'modal-title', text: title }) : null,
      body,
      actions && actions.length ? el('div', { class: 'modal-actions' }, actions) : null
    ].filter(Boolean));
    $('modal').classList.add('visible');
    modalClose = opts && opts.onClose;
    const f = card.querySelector('input:not([type=checkbox]):not([type=radio]), textarea');
    if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal() {
    $('modal').classList.remove('visible');
    $('modalCard').replaceChildren();
    const cb = modalClose; modalClose = null;
    if (cb) cb();
  }
  function btn(text, cls, onclick, attrs) { return el('button', Object.assign({ class: 'btn ' + (cls || 'btn-outline'), type: 'button', text, onclick }, attrs || {})); }
  function confirmBox(title, text, okText, danger) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      openModal(title, el('p', { class: 'modal-text', text }), [
        btn('Cancel', 'btn-ghost', () => { closeModal(); }),
        btn(okText || 'OK', danger ? 'btn-accent' : 'btn-primary', () => { finish(true); closeModal(); })
      ], { onClose: () => finish(false) });
    });
  }
  function promptBox(title, label, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const input = el('input', { class: 'input', maxLength: opts.max || 60, value: opts.value || '', placeholder: opts.placeholder || '', autocapitalize: opts.upper ? 'characters' : 'off', spellcheck: false });
      const err = el('p', { class: 'form-error' });
      const submit = async () => {
        const v = input.value.trim();
        if (!v) return;
        if (opts.check) {
          const msg = await opts.check(v);
          if (msg) { err.textContent = msg; return; }
        }
        finish(v); closeModal();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      if (opts.upper) input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
      openModal(title, el('div', null, el('div', { class: 'field' }, el('label', { text: label }), input), err), [
        btn('Cancel', 'btn-ghost', () => closeModal()),
        btn(opts.ok || 'OK', 'btn-primary', submit)
      ], { onClose: () => finish(null) });
    });
  }

  $('modal').addEventListener('mousedown', (e) => { if (e.target === $('modal')) closeModal(); });


  // ---------- Identity setup ----------

  let setupColor = COLORS[Math.floor(Math.random() * COLORS.length)];

  function renderSwatches(host, current, onPick) {
    host.replaceChildren(...COLORS.map((c) => el('button', {
      type: 'button', class: 'swatch' + (c === current ? ' selected' : ''), style: { background: c }, 'aria-label': 'Colour ' + c,
      onclick: () => { onPick(c); renderSwatches(host, c, onPick); }
    })));
  }
  renderSwatches($('authSwatches'), setupColor, (c) => { setupColor = c; });

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('authUser').value.trim();
    const err = $('authError');
    err.textContent = '';
    if (!/^[\p{L}\p{N}_ .'-]{2,24}$/u.test(name)) { err.textContent = 'Pick a name of 2 to 24 letters or numbers.'; return; }
    if (!$('authAgree').checked) { err.textContent = 'Please confirm you are 13 or older and agree to the rules.'; return; }
    $('authSubmit').disabled = true;
    try {
      const me = await createIdentity(name, setupColor);
      await DB.set('identity', me);
      await start(me);
    } catch (ex) { err.textContent = ex.message || "Couldn't create your identity."; }
    finally { $('authSubmit').disabled = false; }
  });

  $('importBtn').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      await importBackup(data);
    } catch (ex) { $('authError').textContent = ex.message || "That isn't a chat backup file."; }
  });

  async function importBackup(data) {
    if (!data || data.type !== 'baloneys-chat-identity' || !data.identity) throw new Error("That isn't a chat backup file.");
    const me = data.identity;
    const id = await idFromPub(me.pub);
    if (id !== me.id) throw new Error('That backup is damaged.');
    const key = await loadKey(me);
    const test = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode('check'));
    if (!(await verify(me.pub, b64(test), 'check'))) throw new Error("That backup's keys don't match.");
    await DB.set('identity', me);
    if (data.contacts) await DB.set('contacts', data.contacts);
    if (data.rooms) await DB.set('rooms', data.rooms);
    if (data.blocks) await DB.set('blocks', data.blocks);
    if (data.profiles) await DB.set('profiles', data.profiles);
    if (data.customs) await DB.set('customs', data.customs);
    location.reload();
  }

  function exportBackup() {
    const data = { type: 'baloneys-chat-identity', v: 1, exportedAt: Date.now(), identity: S.me, contacts: S.contacts, rooms: S.rooms, blocks: S.blocks, profiles: S.profiles, customs: S.customs };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = el('a', { href: url, download: 'baloneys-chat-' + S.me.id.slice(0, 8) + '.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---------- Startup ----------

  async function boot() {
    let me = null;
    try { me = await DB.get('identity'); } catch (e) { $('authError').textContent = e.message; }
    $('boot').classList.add('hidden');
    if (!me) { $('authView').classList.remove('hidden'); return; }
    await start(me);
  }

  async function start(me) {
    S.me = me;
    S.key = await loadKey(me);
    const [contacts, blocks, rooms, meta, customs, profiles] = await Promise.all(['contacts', 'blocks', 'rooms', 'meta', 'customs', 'profiles'].map((k) => DB.get(k)));
    Object.assign(S, { contacts: contacts || {}, blocks: blocks || {}, rooms: rooms || {}, meta: meta || {}, customs: customs || {}, profiles: profiles || {} });
    for (const code in S.rooms) S.rooms[code].status = 'offline';
    $('authView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    loadGlobalBlocks().then(queueRerender);
    renderMe();
    renderSidebar();
    startPeer();
    route();
  }

  // ---------- Networking ----------
  // One PeerJS peer per identity (PREFIX + id). Links are data connections that finish a signed
  // handshake before anything else is accepted.

  const net = { peer: null, ready: false, links: new Map(), pending: new Map(), retry: null };

  function peerOptions() {
    return Object.assign({ debug: 1, config: { iceServers: ICE_SERVERS } }, PEER_OPTS);
  }

  function startPeer() {
    if (!window.Peer) { setNetStatus("Couldn't load the connection library. Check your connection and reload."); return; }
    const peer = new window.Peer(PREFIX + S.me.id, peerOptions());
    net.peer = peer;
    peer.on('open', () => {
      net.ready = true;
      net.idRetries = 0;
      setNetStatus('');
      reconnectAll();
      resumeRooms();
    });
    peer.on('connection', (conn) => {
      const pid = conn.peer || '';
      if (!pid.startsWith(PREFIX) || pid.startsWith(ROOM_PREFIX)) { conn.close(); return; }
      if (isBlocked(pid.slice(PREFIX.length))) { conn.on('open', () => conn.close()); return; }
      wire(conn, { kind: 'contact', inbound: true });
    });
    peer.on('call', onIncomingCall);
    peer.on('disconnected', () => {
      net.ready = false;
      setNetStatus('Reconnecting…');
      setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500);
    });
    peer.on('error', (err) => {
      const type = err && err.type;
      if (type === 'peer-unavailable') {
        const m = /bchat-[A-Za-z0-9-]+/.exec(err.message || "");
        if (m) onUnavailable(m[0]);
        return;
      }
      if (type === 'unavailable-id') {
        // A tab that just closed can hold the address for a moment; retry before giving up.
        peer.destroy();
        net.idRetries = (net.idRetries || 0) + 1;
        if (net.idRetries <= 4) { setNetStatus('Connecting…'); setTimeout(startPeer, 2500 * net.idRetries); return; }
        setNetStatus('Chat is open in another tab or window. Close it and reload this page to use chat here.');
        return;
      }
      if (type === 'browser-incompatible') { setNetStatus("This browser can't do peer-to-peer chat."); return; }
      console.warn('peer error', type, err);
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type)) setNetStatus('Connection problem. Retrying…');
    });
    clearInterval(net.retry);
    net.retry = setInterval(() => { if (net.ready) { reconnectAll(); retryOfflineRooms(); } }, 20000);
  }

  // Heartbeat: a browser that vanished without saying goodbye is dropped after ~30s.
  function allLinks() {
    const out = [...net.links.values()];
    for (const code in roomLinks) out.push(roomLinks[code]);
    for (const code in hosts) out.push(...hosts[code].links.values());
    return out;
  }
  setInterval(() => {
    const now = Date.now();
    for (const link of allLinks()) {
      if (!link.verified || !link.conn.open) continue;
      if (now - (link.heard || now) > 30000) { link.conn.close(); continue; }
      try { link.conn.send({ t: 'ping' }); } catch (e) { /* closed */ }
    }
  }, 10000);

  // Closing the tab: tell everyone straight away instead of letting them time out.
  window.addEventListener('pagehide', () => {
    flushSaves();
    for (const link of allLinks()) { try { link.conn.send({ t: 'bye' }); link.conn.close(); } catch (e) { /* closed */ } }
    for (const code in hosts) { try { hosts[code].peer.destroy(); } catch (e) { /* closed */ } }
    try { if (net.peer) net.peer.destroy(); } catch (e) { /* closed */ }
  });

  function setNetStatus(text) {
    const b = $('netBanner');
    b.textContent = text;
    b.classList.toggle('hidden', !text);
  }

  // Try every contact we aren't connected to (offline ones fail fast).
  function reconnectAll() {
    for (const id in S.contacts) {
      const c = S.contacts[id];
      if ((c.status === 'accepted' || c.status === 'outgoing') && !isBlocked(id)) connectTo(id);
    }
  }

  function connectTo(id) {
    if (!net.ready || id === S.me.id || isBlocked(id)) return;
    const live = net.links.get(id);
    if (live && live.conn.open) return;
    if (net.pending.has(PREFIX + id)) return;
    const conn = net.peer.connect(PREFIX + id, { reliable: true });
    if (!conn) return;
    net.pending.set(PREFIX + id, conn);
    wire(conn, { kind: 'contact', expect: id });
  }

  function onUnavailable(peerId) {
    const conn = net.pending.get(peerId);
    if (conn) { net.pending.delete(peerId); try { conn.close(); } catch (e) { /* already gone */ } }
    if (peerId.startsWith(ROOM_PREFIX)) roomUnavailable(peerId.slice(ROOM_PREFIX.length));
  }

  // Wrap a data connection with the identity handshake:
  //   both: hello { pub, profile, nonce }  ->  both: proof { sig(nonce of the other side) }
  function wire(conn, opts) {
    const link = { conn, id: null, pub: null, verified: false, nonce: randomId(16), theirNonce: null, kind: opts.kind, room: opts.room || null, opts };
    const timeout = setTimeout(() => { if (!link.verified) conn.close(); }, 20000);
    // The first message on a fresh connection can be lost, so repeat the hello until verified.
    const hello = () => { if (!link.verified && conn.open) conn.send({ t: 'hello', v: 1, pub: S.me.pub, profile: myProfile(), nonce: link.nonce }); };
    conn.on('open', () => {
      net.pending.delete(conn.peer);
      hello();
      let tries = 0;
      const again = setInterval(() => { if (link.verified || !conn.open || ++tries > 10) clearInterval(again); else hello(); }, 1500);
    });
    conn.on('data', (d) => { link.heard = Date.now(); onData(link, d).catch((e) => console.warn('data', e)); });
    conn.on('close', () => { clearTimeout(timeout); net.pending.delete(conn.peer); onLinkClosed(link); });
    conn.on('error', (e) => console.warn('conn error', e && e.type));
    return link;
  }

  async function onData(link, d) {
    if (!d || typeof d !== 'object' || typeof d.t !== 'string' || d.t === 'ping') return;
    if (d.t === 'hello' && link.id) {
      // A repeated hello means our proof was lost (even if we've already verified them): send it again.
      if (d.nonce === link.theirNonce) link.conn.send({ t: 'proof', sig: await sign('bchat|' + link.theirNonce + '|' + S.me.id + '|' + link.id) });
      return;
    }
    if (!link.verified) {
      if (d.t === 'hello' && !link.id) {
        const id = await idFromPub(d.pub).catch(() => null);
        if (!id) return link.conn.close();
        // Inbound: the broker says who connected; outbound: we know who we wanted.
        if (link.opts.inbound && link.conn.peer !== PREFIX + id) return link.conn.close();
        if (link.opts.expect && link.opts.expect !== id) return link.conn.close();
        if (link.kind === 'host' && link.conn.peer !== PREFIX + id) return link.conn.close();
        if (isBlocked(id)) { link.conn.send({ t: 'bye' }); return setTimeout(() => link.conn.close(), 200); }
        link.id = id; link.pub = d.pub; link.theirNonce = String(d.nonce || '').slice(0, 64);
        link.profile = d.profile;
        link.conn.send({ t: 'proof', sig: await sign('bchat|' + link.theirNonce + '|' + S.me.id + '|' + id) });
      } else if (d.t === 'proof' && link.id) {
        const ok = await verify(link.pub, String(d.sig || ''), 'bchat|' + link.nonce + '|' + link.id + '|' + S.me.id);
        if (!ok) { console.warn('identity proof failed for', link.id); return link.conn.close(); }
        link.verified = true;
        onVerified(link);
      }
      return;
    }
    if (link.kind === 'contact') onContactData(link, d);
    else if (link.kind === 'host') hostOnData(link, d);
    else if (link.kind === 'member') memberOnData(link, d);
  }

  function onVerified(link) {
    if (link.kind === 'contact') {
      const old = net.links.get(link.id);
      if (old && old !== link && old.conn.open) {
        // Both sides dialled at once: keep the connection opened by the smaller id.
        const keep = (S.me.id < link.id) === !link.opts.inbound ? link : old;
        const drop = keep === link ? old : link;
        drop.dropped = true;
        drop.conn.close();
        if (keep === old) return;
      }
      net.links.set(link.id, link);
      contactOnline(link);
    } else if (link.kind === 'host') {
      hostOnVerified(link);
    } else if (link.kind === 'member') {
      memberOnVerified(link);
    }
  }

  function onLinkClosed(link) {
    if (link.dropped) return;
    if (link.kind === 'contact' && link.id && net.links.get(link.id) === link) {
      net.links.delete(link.id);
      delete S.online[link.id];
      if (S.contacts[link.id]) { S.contacts[link.id].lastSeen = Date.now(); persist('contacts'); }
      if (voice && voice.scope === 'dm' && voice.id === link.id) endCall('They went offline.');
      queueRerender();
    } else if (link.kind === 'host') hostOnClosed(link);
    else if (link.kind === 'member') memberOnClosed(link);
  }

  function sendTo(id, msg) {
    const link = net.links.get(id);
    if (!link || !link.verified || !link.conn.open) return false;
    try { link.conn.send(msg); return true; } catch (e) { return false; }
  }

  // ---------- Contacts ----------

  function contactOnline(link) {
    const id = link.id;
    setProfile(id, link.profile);
    S.online[id] = true;
    const c = S.contacts[id];
    if (c && c.status === 'outgoing') sendTo(id, { t: 'request' });
    if (c && c.status === 'accepted') flushOutbox(id);
    queueRerender();
  }

  function onContactData(link, d) {
    const id = link.id;
    const c = S.contacts[id];
    switch (d.t) {
      case 'profile': setProfile(id, d.profile); break;
      case 'request':
        if (c && c.status === 'accepted') { sendTo(id, { t: 'accept' }); break; }
        if (c && c.status === 'outgoing') { acceptContact(id); break; }   // both added each other
        if (!c) {
          S.contacts[id] = { id, status: 'incoming', addedAt: Date.now() };
          persist('contacts');
          notify(nameOf(id), 'wants to chat with you', '#requests');
          queueRerender();
        }
        break;
      case 'accept':
        if (c && (c.status === 'outgoing' || c.status === 'accepted')) {
          c.status = 'accepted'; persist('contacts');
          toast(nameOf(id) + ' accepted your request.');
          flushOutbox(id);
          queueRerender();
        }
        break;
      case 'decline':
      case 'remove':
        if (c && c.status !== 'incoming') { c.status = 'outgoing'; c.declined = true; persist('contacts'); queueRerender(); }
        break;
      case 'op': if (isContact(id)) applyDmOp(id, d.op).then(() => sendTo(id, { t: 'ack', opId: d.op && d.op.opId })); break;
      case 'ack': ackOutbox(id, d.opId); break;
      case 'typing': if (isContact(id)) { S.typing[id] = Date.now(); if (S.conv && S.conv.type === 'dm' && S.conv.id === id) renderTyping(); } break;
      case 'hangup': if (voice && voice.scope === 'dm' && voice.id === id) endCall(nameOf(id) + ' ended the call.'); dismissRing(id); break;
      case 'bye': link.conn.close(); break;
    }
  }

  async function addContact(code) {
    const id = parseCode(code);
    if (id.length !== 16) throw new Error("That isn't a valid friend code.");
    if (id === S.me.id) throw new Error("That's your own code!");
    if (S.globalBlocks[id]) throw new Error('That account is blocked on this site.');
    const c = S.contacts[id];
    if (c && c.status === 'accepted') { openDm(id); return; }
    if (c && c.status === 'incoming') { acceptContact(id); openDm(id); return; }
    S.contacts[id] = { id, status: 'outgoing', addedAt: Date.now() };
    persist('contacts');
    const link = net.links.get(id);
    if (link && link.verified) sendTo(id, { t: 'request' }); else connectTo(id);
    openDm(id);
    queueRerender();
  }

  function acceptContact(id) {
    S.contacts[id] = Object.assign(S.contacts[id] || { id, addedAt: Date.now() }, { status: 'accepted', declined: false });
    persist('contacts');
    if (!sendTo(id, { t: 'accept' })) connectTo(id);
    flushOutbox(id);
    queueRerender();
  }

  function declineContact(id) {
    sendTo(id, { t: 'decline' });
    delete S.contacts[id];
    persist('contacts');
    queueRerender();
  }

  function removeContact(id) {
    sendTo(id, { t: 'remove' });
    delete S.contacts[id];
    persist('contacts');
    const link = net.links.get(id);
    if (link) link.conn.close();
    if (S.conv && S.conv.type === 'dm' && S.conv.id === id) openHome();
    queueRerender();
  }

  // ---------- DM outbox ----------
  // Ops (new message, edit, delete, reaction) wait here until the other side acknowledges them.

  const outboxes = {};
  async function outbox(id) {
    if (!outboxes[id]) outboxes[id] = (await DB.get('outbox:' + id)) || [];
    return outboxes[id];
  }
  function saveOutbox(id) { DB.set('outbox:' + id, outboxes[id] || []).catch(() => {}); }

  async function queueDmOp(id, op) {
    op.opId = randomId(12);
    const box = await outbox(id);
    box.push(op);
    saveOutbox(id);
    if (isContact(id)) sendTo(id, { t: 'op', op });
  }

  async function flushOutbox(id) {
    if (!isContact(id)) return;
    const box = await outbox(id);
    for (const op of box) if (!sendTo(id, { t: 'op', op })) break;
  }

  async function ackOutbox(id, opId) {
    const box = await outbox(id);
    const i = box.findIndex((o) => o.opId === opId);
    if (i < 0) return;
    const [op] = box.splice(i, 1);
    saveOutbox(id);
    if (op.k === 'msg') {
      const m = await DB.getMsg(dmKey(id), op.msg.id);
      if (m && m.status === 'pending') { m.status = 'sent'; await DB.putMsg(m); msgUpdated(m); }
    }
  }

  // ---------- Messages from other browsers ----------
  // Everything that arrives over the network is cleaned before it's stored or shown.

  const GIPHY_RE = /^https:\/\/[a-z0-9]+\.giphy\.com\/[A-Za-z0-9._\/?=&%-]+$/;
  const DATA_IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

  function cleanMsg(raw, from, conv, allowSystem) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '');
    if (!/^[a-z0-9]{6,40}$/.test(id)) return null;
    const m = { conv, id, from, ts: Math.min(Number(raw.ts) || Date.now(), Date.now()) };
    if (typeof raw.text === 'string' && raw.text.trim()) m.text = raw.text.slice(0, 2000);
    if (typeof raw.image === 'string' && ((raw.image.length < 1500000 && DATA_IMG_RE.test(raw.image)) || (raw.image.length < 1000 && GIPHY_RE.test(raw.image)))) m.image = raw.image;
    if (typeof raw.sticker === 'string' && raw.sticker.length <= 16) m.sticker = raw.sticker;
    else if (raw.sticker && typeof raw.sticker === 'object' && typeof raw.sticker.data === 'string' && raw.sticker.data.length < 320000 && DATA_IMG_RE.test(raw.sticker.data)) {
      m.sticker = { name: String(raw.sticker.name || 'sticker').slice(0, 32), data: raw.sticker.data };
    }
    if (raw.emoji && typeof raw.emoji === 'object') {
      const e = {};
      let n = 0;
      for (const k of Object.keys(raw.emoji)) {
        const v = raw.emoji[k];
        if (n < 12 && /^[A-Za-z0-9_]{2,32}$/.test(k) && typeof v === 'string' && v.length < 120000 && DATA_IMG_RE.test(v)) { e[k] = v; n++; }
      }
      if (n) m.emoji = e;
    }
    if (raw.replyTo && typeof raw.replyTo === 'object') {
      m.replyTo = { id: String(raw.replyTo.id || '').slice(0, 40), from: String(raw.replyTo.from || '').slice(0, 40), text: String(raw.replyTo.text || '').slice(0, 200) };
    }
    if (raw.kind === 'action' || (allowSystem && raw.kind === 'system')) m.kind = raw.kind;
    if (!m.text && !m.image && !m.sticker) return null;
    return m;
  }

  function cleanReactions(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((e) => typeof e === 'string' && e.length > 0 && e.length <= 32).slice(0, 8);
  }

  async function applyDmOp(from, op) {
    if (!op || typeof op !== 'object') return;
    const conv = dmKey(from);
    if (op.k === 'msg') {
      const m = cleanMsg(op.msg, from, conv, false);
      if (!m || (await DB.getMsg(conv, m.id))) return;
      await storeIncoming(m);
    } else if (op.k === 'edit' || op.k === 'del' || op.k === 'react') {
      const m = await DB.getMsg(conv, String(op.id || ''));
      if (!m) return;
      if (op.k === 'edit' && m.from === from && !m.deleted && typeof op.text === 'string' && op.text.trim()) { m.text = op.text.slice(0, 2000); m.edited = true; }
      else if (op.k === 'del' && m.from === from) stripMsg(m);
      else if (op.k === 'react' && !m.deleted) setReaction(m, from, cleanReactions(op.list));
      else return;
      await DB.putMsg(m);
      msgUpdated(m);
    }
  }

  function stripMsg(m) {
    m.deleted = true;
    delete m.text; delete m.image; delete m.sticker; delete m.emoji; delete m.replyTo; delete m.reactions;
  }

  function setReaction(m, who, list) {
    m.reactions = m.reactions || {};
    if (list.length) m.reactions[who] = list; else delete m.reactions[who];
  }

  async function storeIncoming(m) {
    await DB.putMsg(m);
    touchMeta(m.conv, m);
    const viewing = S.conv && S.conv.key === m.conv;
    if (viewing) { S.msgs.set(m.id, m); scheduleRender(true); }
    if (m.from !== S.me.id && m.kind !== 'system' && !isBlocked(m.from) && (!viewing || document.hidden)) {
      const where = m.conv.startsWith('room_') ? ' in ' + roomName(m.conv.slice(5)) : '';
      notify(nameOf(m.from) + where, preview(m) || 'New message', m.conv.startsWith('dm_') ? '#dm/' + m.from : '#room/' + m.conv.slice(5));
    }
  }

  function msgUpdated(m) {
    if (S.conv && S.conv.key === m.conv) { S.msgs.set(m.id, m); S.msgNodes.delete(m.id); scheduleRender(false); }
  }

  function touchMeta(conv, m) {
    const meta = S.meta[conv] || (S.meta[conv] = {});
    if (!meta.updatedAt || m.ts >= meta.updatedAt) {
      meta.updatedAt = m.ts;
      meta.last = { from: m.from, text: (m.kind === 'system' ? nameOf(m.from) + ' ' : '') + (preview(m) || '…') };
    }
    if (m.from === S.me.id) meta.lastRead = Math.max(meta.lastRead || 0, m.ts);
    persist('meta');
    queueRerender();
  }

  // ---------- Rooms ----------
  // A room lives on whichever member's browser registered ROOM_PREFIX + code with the broker.
  // That host relays messages, keeps recent history and enforces mute/kick/bans.

  const hosts = {};       // code -> host state (when this browser hosts the room)
  const roomLinks = {};   // code -> member link to the host
  const recovering = {};  // code -> { attempts, claim }

  const roomName = (code) => (S.rooms[code] && S.rooms[code].name) || code;

  function randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = new Uint32Array(6); crypto.getRandomValues(a);
    return [...a].map((n) => chars[n % chars.length]).join('');
  }

  function saveRoom(code, patch) {
    S.rooms[code] = Object.assign(S.rooms[code] || { code, name: code, joinedAt: Date.now(), members: {}, order: [], muted: [], banned: [] }, patch);
    persist('rooms');
    queueRerender();
    return S.rooms[code];
  }

  function iHost(code) { return !!hosts[code]; }

  // --- joining as a member ---

  // Rooms nobody was hosting: look again now and then.
  function retryOfflineRooms() {
    for (const code in S.rooms) if (S.rooms[code].status === 'offline' && !hosts[code] && !roomLinks[code]) connectRoom(code, true);
  }

  function resumeRooms() {
    for (const code in S.rooms) if (!hosts[code] && !roomLinks[code]) connectRoom(code, true);
  }

  function connectRoom(code, quiet) {
    if (!net.ready || hosts[code]) return;
    const existing = roomLinks[code];
    if (existing && existing.conn.open) return;
    saveRoom(code, { status: 'connecting' });
    const conn = net.peer.connect(ROOM_PREFIX + code, { reliable: true });
    if (!conn) return;
    net.pending.set(ROOM_PREFIX + code, conn);
    roomLinks[code] = wire(conn, { kind: 'member', room: code });
    roomLinks[code].quiet = quiet;
  }

  function roomUnavailable(code) {
    delete roomLinks[code];
    const r = S.rooms[code];
    const rec = recovering[code];
    if (rec) { tryRecover(code); return; }
    if (!r || !r.welcomed) {
      if (r && !r.welcomed) { delete S.rooms[code]; persist('rooms'); }
      if (S.conv && S.conv.type === 'room' && S.conv.id === code) openHome();
      toast('No one is hosting room ' + code + ' right now.');
      return;
    }
    saveRoom(code, { status: 'offline' });
  }

  function memberOnVerified(link) {
    link.conn.send({ t: 'join', code: link.room });
  }

  function memberOnData(link, d) {
    const code = link.room;
    if (d.t === 'bye') { link.conn.close(); return; }
    roomReceive(code, d, link);
  }

  // Messages from the host (or from our own host logic when we host).
  function roomReceive(code, d, link) {
    switch (d.t) {
      case 'welcome': {
        delete recovering[code];
        applyRoomState(code, d.room);
        saveRoom(code, { status: 'connected', welcomed: true });
        (async () => {
          for (const raw of (Array.isArray(d.history) ? d.history : []).slice(-ROOM_HISTORY)) {
            const m = cleanMsg(raw, String(raw.from || ''), roomKey(code), true);
            if (!m) continue;
            if (raw.deleted) stripMsg(m);
            if (raw.edited) m.edited = true;
            if (raw.reactions && typeof raw.reactions === 'object') for (const who in raw.reactions) setReaction(m, who, cleanReactions(raw.reactions[who]));
            const old = await DB.getMsg(m.conv, m.id);
            if (old && JSON.stringify(old) === JSON.stringify(m)) continue;
            await DB.putMsg(m);
            touchMeta(m.conv, m);
            if (S.conv && S.conv.key === m.conv) { S.msgs.set(m.id, m); S.msgNodes.delete(m.id); }
          }
          if (S.conv && S.conv.key === roomKey(code)) scheduleRender(true);
        })();
        if (S.conv && S.conv.type === 'room' && S.conv.id === code) enterRoomView(code);
        break;
      }
      case 'room': applyRoomState(code, d.room); break;
      case 'profiles':
        if (d.profiles && typeof d.profiles === 'object') for (const id of Object.keys(d.profiles).slice(0, MAX_ROOM + 5)) if (id !== S.me.id && /^[a-z2-9]{16}$/.test(id)) setProfile(id, d.profiles[id]);
        break;
      case 'rmsg': {
        const m = cleanMsg(d.msg, String(d.msg && d.msg.from || ''), roomKey(code), true);
        if (m) DB.getMsg(m.conv, m.id).then((old) => { if (!old) storeIncoming(m); });
        break;
      }
      case 'rupd': {
        const raw = d.msg || {};
        DB.getMsg(roomKey(code), String(raw.id || '')).then(async (m) => {
          if (!m) return;
          if (raw.deleted) stripMsg(m);
          else {
            if (typeof raw.text === 'string' && raw.edited) { m.text = raw.text.slice(0, 2000); m.edited = true; }
            m.reactions = {};
            if (raw.reactions && typeof raw.reactions === 'object') for (const who in raw.reactions) setReaction(m, who, cleanReactions(raw.reactions[who]));
          }
          await DB.putMsg(m);
          msgUpdated(m);
        });
        break;
      }
      case 'rtyping':
        if (typeof d.from === 'string' && d.from !== S.me.id) { S.typing[d.from] = Date.now(); if (S.conv && S.conv.id === code) renderTyping(); }
        break;
      case 'voice': onRoomVoice(code, d.voice || {}); break;
      case 'rerr': toast(String(d.text || "Couldn't send that.").slice(0, 120)); break;
      case 'hostmove': saveRoom(code, { expectHost: String(d.to || '') }); break;
      case 'handover': becomeHost(code, d.state); break;
      case 'kicked':
      case 'denied':
      case 'closed': {
        const why = d.t === 'kicked' ? 'You were removed from ' + roomName(code) + '.'
          : d.t === 'closed' ? roomName(code) + ' was closed by the host.'
          : String(d.text || "You can't join that room.").slice(0, 120);
        forgetRoom(code, why);
        break;
      }
    }
  }

  function applyRoomState(code, st) {
    if (!st || typeof st !== 'object') return;
    const members = {};
    for (const id of Object.keys(st.members || {}).slice(0, MAX_ROOM + 5)) {
      const p = st.members[id] || {};
      if (id !== S.me.id) setProfile(id, p, true);
      members[id] = { online: !!p.online, joinedAt: Number(p.joinedAt) || 0 };
    }
    const list = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 500) : []);
    saveRoom(code, {
      name: typeof st.name === 'string' ? st.name.slice(0, 40) : code,
      image: typeof st.image === 'string' && st.image.length < 90000 && DATA_IMG_RE.test(st.image) ? st.image : null,
      hostId: typeof st.hostId === 'string' ? st.hostId : '',
      members, order: list(st.order), muted: list(st.muted), banned: list(st.banned)
    });
    if (S.conv && S.conv.type === 'room' && S.conv.id === code) applyRoomMeta(S.rooms[code]);
  }

  function memberOnClosed(link) {
    const code = link.room;
    if (roomLinks[code] === link) delete roomLinks[code];
    if (!S.rooms[code] || link.leaving || hosts[code]) return;
    if (!link.verified) { roomUnavailable(code); return; }
    if (voice && voice.scope === 'room' && voice.id === code) leaveVoice();
    saveRoom(code, { status: 'reconnecting' });
    recovering[code] = { attempts: 0 };
    tryRecover(code);
  }

  // Host gone: reconnect, and if nobody hosts, members take over in join order.
  function tryRecover(code) {
    const rec = recovering[code];
    const r = S.rooms[code];
    if (!rec || !r || hosts[code]) return;
    rec.attempts++;
    if (rec.attempts > 12) { delete recovering[code]; saveRoom(code, { status: 'offline' }); return; }
    const oldHost = r.hostId;
    const successors = (r.order || []).filter((id) => id !== oldHost && r.members[id] && r.members[id].online);
    const rank = Math.max(0, successors.indexOf(S.me.id));
    const expected = r.expectHost === S.me.id;
    const delay = expected ? 300 : rec.attempts === 1 ? 1200 + rank * 2500 : 2500;
    clearTimeout(rec.timer);
    rec.timer = setTimeout(() => {
      if (!recovering[code]) return;
      // After a failed reconnect (nobody hosting), the first successor claims the room.
      if (expected || (rec.attempts > 1 && (rank === 0 || rec.attempts > 3 + rank))) hostRoom(code, localRoomState(code));
      else connectRoom(code, true);
    }, delay);
  }

  function forgetRoom(code, why) {
    if (voice && voice.scope === 'room' && voice.id === code) leaveVoice();
    const link = roomLinks[code];
    if (link) { link.leaving = true; link.conn.close(); delete roomLinks[code]; }
    delete recovering[code];
    delete S.rooms[code];
    persist('rooms');
    DB.clearConv(roomKey(code));
    delete S.meta[roomKey(code)]; persist('meta');
    if (why) toast(why);
    if (S.conv && S.conv.type === 'room' && S.conv.id === code) openHome();
    queueRerender();
  }

  // Send an op to the room's host (ourselves if we host).
  function roomSend(code, op) {
    if (hosts[code]) { hostApply(code, S.me.id, op); return true; }
    const link = roomLinks[code];
    if (!link || !link.verified || !link.conn.open) return false;
    link.conn.send({ t: 'r', op });
    return true;
  }

  // --- hosting ---

  async function localRoomState(code) {
    const r = S.rooms[code] || {};
    const history = await DB.recent(roomKey(code), ROOM_HISTORY);
    return { name: r.name || code, image: r.image || null, members: r.members || {}, order: r.order || [], muted: r.muted || [], banned: r.banned || [], history, known: r.order || [] };
  }

  async function hostRoom(code, statePromise, fresh) {
    if (hosts[code] || !net.ready) return;
    const state = await statePromise;
    const peer = new window.Peer(ROOM_PREFIX + code, peerOptions());
    const H = {
      code, peer, links: new Map(), name: state.name || code, image: typeof state.image === 'string' && DATA_IMG_RE.test(state.image) ? state.image : null, hostId: S.me.id,
      members: {}, order: [], muted: new Set(state.muted || []), banned: new Set(state.banned || []),
      known: new Set(state.known || []), history: (state.history || []).slice(-ROOM_HISTORY), voice: {}, reports: state.reports || [], claiming: true
    };
    hosts[code] = H;
    peer.on('open', () => {
      H.claiming = false;
      delete recovering[code];
      // Keep the join order of earlier members so a later handover follows it.
      for (const id of state.order || []) if (id !== S.me.id && state.members && state.members[id]) {
        H.members[id] = { joinedAt: state.members[id].joinedAt || Date.now(), online: false };
        H.order.push(id);
      }
      H.members[S.me.id] = { joinedAt: (state.members && state.members[S.me.id] && state.members[S.me.id].joinedAt) || Date.now(), online: true };
      if (!H.order.includes(S.me.id)) H.order.unshift(S.me.id);
      H.known.add(S.me.id);
      saveRoom(code, { status: 'connected', welcomed: true });
      roomReceive(code, { t: 'welcome', room: publicState(H), history: [] });
      if (fresh) hostSystem(H, 'created the room');
      else if (!state.handover) hostSystem(H, 'is now hosting the room');
      queueRerender();
    });
    peer.on('connection', (conn) => {
      const pid = conn.peer || '';
      if (!pid.startsWith(PREFIX) || pid.startsWith(ROOM_PREFIX)) { conn.close(); return; }
      wire(conn, { kind: 'host', room: code });
    });
    peer.on('error', (err) => {
      if (err && err.type === 'unavailable-id') {
        // Someone else already hosts it: join them instead (retry briefly during a handover).
        peer.destroy();
        delete hosts[code];
        if (state.handover && (state.tries = (state.tries || 0) + 1) < 15) { setTimeout(() => hostRoom(code, state), 1000); return; }
        if (recovering[code]) connectRoom(code, true);
        else connectRoom(code);
      } else if (err && err.type !== 'peer-unavailable') console.warn('room host error', err.type);
    });
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
  }

  function publicState(H) {
    const members = {};
    for (const id in H.members) {
      const p = id === S.me.id ? myProfile() : (S.profiles[id] || {});
      members[id] = Object.assign(lightProfile(p), { online: H.members[id].online, joinedAt: H.members[id].joinedAt });
    }
    return { name: H.name, image: H.image || null, hostId: H.hostId, members, order: H.order, muted: [...H.muted], banned: [...H.banned] };
  }

  function fullProfile(id) { return id === S.me.id ? myProfile() : S.profiles[id] || null; }
  function hostShareProfiles(H, ids, toLink) {
    const profiles = {};
    for (const id of ids) { const p = fullProfile(id); if (p) profiles[id] = p; }
    const msg = { t: 'profiles', profiles };
    if (toLink) toLink.conn.send(msg); else hostBroadcast(H, msg, S.me.id);
  }

  function hostBroadcast(H, msg, except) {
    for (const [id, link] of H.links) if (id !== except && link.conn.open) { try { link.conn.send(msg); } catch (e) { /* closed */ } }
    if (except !== S.me.id) roomReceive(H.code, msg);
  }

  function hostSync(H) { hostBroadcast(H, { t: 'room', room: publicState(H) }); }

  function hostSystem(H, text) {
    hostPost(H, { id: randomId(12), from: S.me.id, ts: Date.now(), kind: 'system', text });
  }

  function hostPost(H, m) {
    H.history.push(m);
    if (H.history.length > ROOM_HISTORY) H.history.shift();
    hostBroadcast(H, { t: 'rmsg', msg: m });
  }

  function hostOnVerified(link) { /* waits for join */ }

  function hostOnData(link, d) {
    const H = hosts[link.room];
    if (!H) return link.conn.close();
    const id = link.id;
    if (d.t === 'join') {
      if (H.banned.has(id)) { link.conn.send({ t: 'denied', text: "You've been removed from " + H.name + '.' }); return setTimeout(() => link.conn.close(), 300); }
      if (!H.members[id] && Object.keys(H.members).length >= MAX_ROOM) { link.conn.send({ t: 'denied', text: H.name + ' is full.' }); return setTimeout(() => link.conn.close(), 300); }
      const old = H.links.get(id);
      if (old && old !== link) { old.replaced = true; old.conn.close(); }
      H.links.set(id, link);
      setProfile(id, link.profile);
      if (!H.members[id]) { H.members[id] = { joinedAt: Date.now(), online: true }; H.order.push(id); }
      H.members[id].online = true;
      link.conn.send({ t: 'welcome', room: publicState(H), history: H.history.slice(-100) });
      hostShareProfiles(H, Object.keys(H.members).filter((m) => m !== id), link);
      hostShareProfiles(H, [id]);
      hostSync(H);
      if (!H.known.has(id)) { H.known.add(id); hostSystem(H, 'joined'); }
      if (Object.keys(H.voice).length) link.conn.send({ t: 'voice', voice: H.voice });
    } else if (d.t === 'r' && H.links.get(id) === link) {
      hostApply(H.code, id, d.op);
    } else if (d.t === 'leave') {
      removeMember(H, id, 'left');
      link.conn.close();
    }
  }

  function hostOnClosed(link) {
    const H = hosts[link.room];
    if (!H || !link.id || H.links.get(link.id) !== link || link.replaced) return;
    H.links.delete(link.id);
    if (H.members[link.id]) H.members[link.id].online = false;
    if (H.voice[link.id]) { delete H.voice[link.id]; hostBroadcast(H, { t: 'voice', voice: H.voice }); }
    hostSync(H);
  }

  function removeMember(H, id, why) {
    if (!H.members[id]) return;
    delete H.members[id];
    H.order = H.order.filter((x) => x !== id);
    H.known.delete(id);
    if (H.voice[id]) { delete H.voice[id]; hostBroadcast(H, { t: 'voice', voice: H.voice }); }
    H.links.delete(id);
    hostSync(H);
    if (why) hostPost(H, { id: randomId(12), from: id === S.me.id ? S.me.id : id, ts: Date.now(), kind: 'system', text: why });
  }

  function hostFind(H, id) { return H.history.find((m) => m.id === id); }

  function hostApply(code, from, op) {
    const H = hosts[code];
    if (!H || !op || typeof op !== 'object' || !H.members[from]) return;
    const reply = (text) => { if (from === S.me.id) toast(text); else { const l = H.links.get(from); if (l) l.conn.send({ t: 'rerr', text }); } };
    switch (op.k) {
      case 'msg': {
        if (H.muted.has(from)) return reply('The host has muted you in this room.');
        const m = cleanMsg(op.msg, from, roomKey(code), false);
        if (!m || hostFind(H, m.id)) return;
        m.ts = Date.now();
        delete m.conv;
        hostPost(H, Object.assign({ from }, m));
        break;
      }
      case 'edit': case 'del': case 'react': {
        const m = hostFind(H, String(op.id || ''));
        if (!m) return;
        if (op.k === 'edit') {
          if (m.from !== from || m.deleted || typeof op.text !== 'string' || !op.text.trim()) return;
          m.text = op.text.slice(0, 2000); m.edited = true;
        } else if (op.k === 'del') {
          if (m.from !== from && from !== H.hostId) return;
          stripMsg(m);
        } else {
          if (m.deleted) return;
          setReaction(m, from, cleanReactions(op.list));
        }
        hostBroadcast(H, { t: 'rupd', msg: { id: m.id, text: m.text, edited: m.edited, deleted: m.deleted, reactions: m.reactions || {} } });
        break;
      }
      case 'typing': hostBroadcast(H, { t: 'rtyping', from }, from); break;
      case 'profile': if (from !== S.me.id) setProfile(from, op.profile); hostShareProfiles(H, [from]); hostSync(H); break;
      case 'voice': {
        if (op.on && !H.muted.has(from)) {
          if (!H.voice[from] && Object.keys(H.voice).length >= MAX_VOICE) return reply('Voice is full (' + MAX_VOICE + ' people max).');
          H.voice[from] = { muted: !!op.muted, joinedAt: (H.voice[from] && H.voice[from].joinedAt) || Date.now() };
        } else delete H.voice[from];
        hostBroadcast(H, { t: 'voice', voice: H.voice });
        break;
      }
      case 'report': {
        const reason = REPORT_REASONS.find((r) => r[0] === op.reason);
        if (!reason) return;
        const m = hostFind(H, String(op.id || ''));
        H.reports.unshift({ id: randomId(10), by: from, ts: Date.now(), reason: reason[0], note: String(op.note || '').slice(0, 500), msg: m ? Object.assign({}, m) : null, target: m ? m.from : String(op.target || '') });
        H.reports = H.reports.slice(0, 50);
        notify('Report in ' + H.name, nameOf(from) + ' reported ' + (m ? nameOf(m.from) : 'someone') + ': ' + reason[1], '#room/' + code);
        if (S.showMembers) renderMembers();
        break;
      }
    }
  }

  // --- host tools ---

  function hostTool(code, action, id, extra) {
    const H = hosts[code];
    if (!H) return;
    if (action === 'mute') { H.muted.add(id); if (H.voice[id]) { delete H.voice[id]; hostBroadcast(H, { t: 'voice', voice: H.voice }); } hostSync(H); hostSystem(H, 'muted ' + nameOf(id)); }
    else if (action === 'unmute') { H.muted.delete(id); hostSync(H); hostSystem(H, 'unmuted ' + nameOf(id)); }
    else if (action === 'kick') {
      H.banned.add(id);
      const l = H.links.get(id);
      if (l) { l.conn.send({ t: 'kicked' }); setTimeout(() => l.conn.close(), 300); }
      removeMember(H, id, null);
      hostSystem(H, 'removed ' + nameOf(id));
    }
    else if (action === 'unban') { H.banned.delete(id); hostSync(H); }
    else if (action === 'rename') { H.name = String(extra).slice(0, 40); hostSync(H); hostSystem(H, 'renamed the room to ' + H.name); }
    else if (action === 'image') { H.image = extra || null; hostSync(H); hostSystem(H, extra ? 'changed the room picture' : 'removed the room picture'); }
    else if (action === 'delmsg') hostApply(code, S.me.id, { k: 'del', id });
    else if (action === 'transfer') handOver(code, id);
  }

  function roomSettings(code) {
    const H = hosts[code];
    if (!H) return;
    let image = H.image || null;
    const nameIn = el('input', { class: 'input', maxLength: 40, value: H.name });
    const preview = el('div');
    const draw = () => preview.replaceChildren(roomIcon({ code, name: nameIn.value || H.name, image, status: 'connected' }, true));
    draw();
    nameIn.addEventListener('input', draw);
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      try {
        const data = await compress(await readAsDataURL(f), 256, 85000, true);
        if ((await classify(data)) === 'flagged') { toast("That picture can't be used."); return; }
        image = data; draw();
      } catch (e) { fail(e, e.message); }
    });
    openModal('Room settings', el('div', { class: 'stack' },
      el('div', { class: 'row' }, preview, el('div', { class: 'stack' },
        btn('Upload picture', 'btn-sm btn-outline', () => file.click()),
        btn('Remove picture', 'btn-sm btn-ghost', () => { image = null; draw(); }), file)),
      el('div', { class: 'field' }, el('label', { text: 'Room name' }), nameIn)),
    [btn('Cancel', 'btn-ghost', closeModal), btn('Save', 'btn-primary', () => {
      const n = nameIn.value.trim();
      if (n && n !== H.name) hostTool(code, 'rename', null, n);
      if (image !== (H.image || null)) hostTool(code, 'image', null, image);
      closeModal();
    })]);
  }

  // Pass the room to another online member, then step down.
  function handOver(code, to, thenLeave) {
    const H = hosts[code];
    const l = H && H.links.get(to);
    if (!l || !l.conn.open) { toast("They're not online right now."); return false; }
    hostSystem(H, 'made ' + nameOf(to) + ' the host');
    H.hostId = to;
    if (thenLeave) { delete H.members[S.me.id]; H.order = H.order.filter((x) => x !== S.me.id); }
    const state = { name: H.name, image: H.image, members: publicState(H).members, order: H.order, muted: [...H.muted], banned: [...H.banned], history: H.history, known: [...H.known], reports: H.reports, handover: true };
    l.conn.send({ t: 'handover', state });
    hostBroadcast(H, { t: 'hostmove', to }, S.me.id);
    hostSync(H);
    setTimeout(() => {
      H.peer.destroy();
      delete hosts[code];
      if (thenLeave) { forgetRoom(code); return; }
      saveRoom(code, { expectHost: to, status: 'reconnecting' });
      recovering[code] = { attempts: 1 };
      setTimeout(() => connectRoom(code, true), 1500);
    }, 800);
    return true;
  }

  function becomeHost(code, state) {
    if (!state || typeof state !== 'object') return;
    const link = roomLinks[code];
    if (link) { link.leaving = true; }
    const st = Object.assign({}, state, { handover: true });
    st.history = (Array.isArray(st.history) ? st.history : []).map((m) => Object.assign({}, m));
    recovering[code] = { attempts: 0 };
    setTimeout(() => hostRoom(code, st), 900);
  }

  function closeRoom(code) {
    const H = hosts[code];
    if (!H) return;
    hostBroadcast(H, { t: 'closed' }, S.me.id);
    setTimeout(() => { H.peer.destroy(); delete hosts[code]; }, 500);
    forgetRoom(code, 'Room closed.');
  }

  async function createRoom() {
    const name = await promptBox('Create a room', 'Room name', { max: 40, ok: 'Create', placeholder: 'the lounge' });
    if (!name) return;
    if (!net.ready) { toast('Still connecting. Try again in a moment.'); return; }
    const code = randomCode();
    saveRoom(code, { name, hostId: S.me.id, status: 'connecting', welcomed: true, joinedAt: Date.now() });
    hostRoom(code, { name, members: {}, order: [], muted: [], banned: [], history: [] }, true);
    openRoom(code);
    openModal('Room created', el('div', null,
      el('p', { class: 'modal-text', text: 'Share this code so people can join. The room stays open while someone in it has chat open.' }),
      el('p', { class: 'big-code', text: code })),
    [btn('Copy invite link', 'btn-outline', () => { copyCode(); closeModal(); }), btn('Done', 'btn-primary', closeModal)]);
  }

  async function askJoin() {
    const code = await promptBox('Join a room', 'Room code', {
      max: 6, upper: true, ok: 'Join', placeholder: 'ABC234',
      check: (v) => (/^[A-Z2-9]{6}$/.test(v) ? null : 'Codes are 6 letters and numbers.')
    });
    if (code) joinRoom(code);
  }

  function joinRoom(code) {
    code = String(code || '').toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return;
    if (S.rooms[code]) { openRoom(code); if (!hosts[code] && !roomLinks[code]) connectRoom(code); return; }
    if (!net.ready) { toast('Still connecting. Try again in a moment.'); return; }
    saveRoom(code, { name: code, status: 'connecting' });
    connectRoom(code);
    openRoom(code);
  }

  async function leaveRoom(code) {
    const H = hosts[code];
    if (H) {
      const others = H.order.filter((id) => id !== S.me.id && H.links.has(id));
      if (!others.length) {
        if (!(await confirmBox('Close ' + H.name + '?', "You're the only one here, so leaving closes the room.", 'Close room', true))) return;
        closeRoom(code);
        return;
      }
      if (!(await confirmBox('Leave ' + H.name + '?', nameOf(others[0]) + ' will take over as host.', 'Leave'))) return;
      handOver(code, others[0], true);
      return;
    }
    if (!(await confirmBox('Leave room?', 'You can rejoin later with the code ' + code + ' while it’s open.', 'Leave'))) return;
    const link = roomLinks[code];
    if (link && link.conn.open) { link.leaving = true; link.conn.send({ t: 'leave' }); }
    setTimeout(() => forgetRoom(code), 200);
  }

  // ---------- Sidebar ----------

  function renderMe() {
    if (!S.me) return;
    $('meAvatar').replaceChildren(avatar(S.me.id, 'sm', true));
    $('meName').replaceChildren(nameEl(S.me.id));
    $('meCode').textContent = fmtCode(S.me.id);
    $('welcomeName').textContent = S.me.name;
  }

  $('meCode').addEventListener('click', copyMyCode);
  function copyMyCode() {
    const link = location.origin + location.pathname + '#add/' + fmtCode(S.me.id);
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Your add-me link is copied. Send it to a friend.'), () => toast('Your friend code: ' + fmtCode(S.me.id)));
  }

  function isUnread(key) {
    const meta = S.meta[key];
    if (!meta || !meta.updatedAt || !meta.last) return false;
    if (meta.last.from === S.me.id || isBlocked(meta.last.from)) return false;
    return meta.updatedAt > (meta.lastRead || 0);
  }

  function convButton(opts) {
    return el('button', { class: 'conv' + (opts.active ? ' active' : '') + (opts.unread ? ' unread' : ''), type: 'button', onclick: opts.onclick },
      opts.icon,
      el('span', { class: 'conv-text' }, el('span', { class: 'conv-name', text: opts.name }), el('span', { class: 'conv-preview', text: opts.preview || '' })),
      opts.voice ? el('span', { class: 'voice-live', title: 'Voice active', text: '🔊' }) : null,
      opts.unread ? el('span', { class: 'unread-dot', 'aria-label': 'unread' }) : null
    );
  }

  function renderSidebar() {
    if (!S.me) return;
    const requests = Object.values(S.contacts).filter((c) => c.status === 'incoming' && !isBlocked(c.id));
    $('requestList').replaceChildren(...requests.map((c) => el('div', { class: 'request' },
      avatar(c.id, 'sm'),
      el('span', { class: 'request-text' }, el('b', { text: nameOf(c.id) }), el('small', { text: fmtCode(c.id) })),
      btn('Accept', 'btn-sm btn-primary', () => { acceptContact(c.id); openDm(c.id); }),
      el('button', { class: 'icon-btn', type: 'button', title: 'Decline', 'aria-label': 'Decline', onclick: () => declineContact(c.id) }, icon('close')))));
    $('requestTitle').classList.toggle('hidden', !requests.length);

    const contacts = Object.values(S.contacts).filter((c) => c.status !== 'incoming')
      .sort((a, b) => ((S.meta[dmKey(b.id)] || {}).updatedAt || b.addedAt || 0) - ((S.meta[dmKey(a.id)] || {}).updatedAt || a.addedAt || 0));
    const dmNodes = contacts.map((c) => {
      const meta = S.meta[dmKey(c.id)];
      const last = meta && meta.last;
      const pv = isBlocked(c.id) ? 'Blocked'
        : c.status === 'outgoing' ? (c.declined ? 'Request not accepted' : 'Request sent')
        : last ? (last.from === S.me.id ? 'You: ' : '') + last.text
        : S.online[c.id] ? 'Online' : 'Say hi';
      return convButton({
        icon: avatar(c.id, null, true), name: nameOf(c.id), preview: pv,
        active: S.conv && S.conv.type === 'dm' && S.conv.id === c.id,
        unread: isUnread(dmKey(c.id)), voice: voice && voice.scope === 'dm' && voice.id === c.id,
        onclick: () => openDm(c.id)
      });
    });
    $('dmList').replaceChildren(...(dmNodes.length ? dmNodes : [el('p', { class: 'side-empty', text: 'No contacts yet. Share your friend code or add someone’s.' })]));

    const rooms = Object.values(S.rooms).sort((a, b) => ((S.meta[roomKey(b.code)] || {}).updatedAt || b.joinedAt || 0) - ((S.meta[roomKey(a.code)] || {}).updatedAt || a.joinedAt || 0));
    const roomNodes = rooms.map((r) => {
      const meta = S.meta[roomKey(r.code)];
      const last = meta && meta.last;
      const status = r.status === 'connected' ? '' : r.status === 'offline' ? 'Offline · ' : 'Connecting… · ';
      const sys = last && last.text.startsWith(nameOf(last.from) + ' ');
      const pv = status + (!last ? r.code : sys ? last.text : (last.from === S.me.id ? 'You' : nameOf(last.from)) + ': ' + last.text);
      return convButton({
        icon: roomIcon(r), name: r.name || r.code, preview: pv,
        active: S.conv && S.conv.type === 'room' && S.conv.id === r.code,
        unread: isUnread(roomKey(r.code)), voice: !!(roomVoice[r.code] && Object.keys(roomVoice[r.code]).length),
        onclick: () => openRoom(r.code)
      });
    });
    $('roomList').replaceChildren(...(roomNodes.length ? roomNodes : [el('p', { class: 'side-empty', text: 'No rooms yet. Create one or join with a code.' })]));

    const unread = contacts.filter((c) => isUnread(dmKey(c.id))).length + rooms.filter((r) => isUnread(roomKey(r.code))).length + requests.length;
    document.title = (unread ? '(' + unread + ') ' : '') + 'chat | baloneys';
  }

  // ---------- Notifications (in page) ----------

  let audioCtx;
  function ping() {
    if (!S.settings.sounds) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.26);
    } catch (e) { /* no audio */ }
  }

  function notify(title, body, hash) {
    ping();
    if (document.hidden && S.settings.desktop && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, icon: 'public/pw64s5dmavz539gvjm065tw71xp1.png', tag: hash });
        n.onclick = () => { window.focus(); location.hash = hash; n.close(); };
      } catch (e) { /* needs a service worker on some browsers */ }
    } else if (!document.hidden) {
      toast(title + ': ' + body.slice(0, 80));
    }
  }

  // ---------- Routing ----------

  function route() {
    if (!S.me) return;
    const h = decodeURIComponent(location.hash.slice(1));
    let m;
    if ((m = /^dm\/([a-z2-9]{16})$/.exec(h))) openDm(m[1]);
    else if ((m = /^add\/(.+)$/.exec(h))) {
      const id = parseCode(m[1]);
      setHash('');
      if (id === S.me.id) { openHome(); return; }
      if (isContact(id)) { openDm(id); return; }
      confirmBox('Add contact?', 'Send a contact request to ' + fmtCode(id) + '?', 'Send request').then((ok) => {
        if (ok) addContact(id).catch((e) => toast(e.message)); else openHome();
      });
    } else if ((m = /^(?:room|join)\/([A-Za-z2-9]{6})$/.exec(h))) joinRoom(m[1].toUpperCase());
    else openHome(true);
  }
  window.addEventListener('hashchange', route);

  function setHash(h) { if (location.hash !== h) history.replaceState(null, '', h || location.pathname + location.search); }

  function openHome(fromRoute) {
    closeConv();
    if (!fromRoute) setHash('');
    $('welcome').classList.remove('hidden');
    $('convView').classList.add('hidden');
    $('appView').classList.remove('in-conv', 'with-members');
    $('membersPane').classList.add('hidden');
    queueRerender();
  }

  // ---------- Opening conversations ----------

  function closeConv() {
    stopTyping();
    S.conv = null;
    S.msgs = new Map(); S.msgNodes = new Map();
    S.limit = PAGE; S.reply = null; S.editing = null; S.pendingImages = [];
    S.members = {}; S.roomMuted = {}; S.roomBanned = {}; S.typing = {};
    closePopover();
    renderBars();
  }

  function openDm(id) {
    if (!id || id === S.me.id) return openHome();
    if (S.conv && S.conv.type === 'dm' && S.conv.id === id) return;
    if (!S.contacts[id]) { addContact(id).catch((e) => toast(e.message)); return; }
    closeConv();
    S.conv = { type: 'dm', id, key: dmKey(id) };
    setHash('#dm/' + id);
    if (S.contacts[id].status !== 'incoming') connectTo(id);
    enterConv();
  }

  function openRoom(code) {
    if (S.conv && S.conv.type === 'room' && S.conv.id === code) return;
    closeConv();
    S.conv = { type: 'room', id: code, key: roomKey(code) };
    setHash('#room/' + code);
    enterRoomView(code);
    enterConv();
  }

  function enterRoomView(code) {
    const r = S.rooms[code];
    if (r) applyRoomMeta(r);
  }

  // Members, mutes and kicks come from the host's room state.
  function applyRoomMeta(r) {
    S.members = {};
    for (const id of Object.keys(r.members || {})) S.members[id] = id === r.hostId ? 'owner' : 'member';
    S.roomMuted = Object.fromEntries((r.muted || []).map((u) => [u, true]));
    S.roomBanned = Object.fromEntries((r.banned || []).map((u) => [u, true]));
    renderConvBanner();
    renderConvHead();
    if (S.showMembers) renderMembers();
  }

  async function enterConv() {
    const c = S.conv;
    $('welcome').classList.add('hidden');
    $('convView').classList.remove('hidden');
    $('appView').classList.add('in-conv');
    $('messages').replaceChildren(el('div', { class: 'conv-loading', text: 'Loading…' }));
    $('composerInput').value = loadDraft();
    autoGrow();
    S.showMembers = c.type === 'room' && window.innerWidth > 1100;
    renderConvHead();
    renderConvBanner();
    if (S.showMembers) renderMembers(); else { $('membersPane').classList.add('hidden'); $('appView').classList.remove('with-members'); }
    renderVoice();
    await loadMessages();
    if (window.innerWidth > 760) setTimeout(() => $('composerInput').focus(), 0);
  }

  async function loadMessages(keepScroll) {
    const c = S.conv;
    const list = await DB.recent(c.key, S.limit);
    if (S.conv !== c) return;
    S.hasOlder = list.length >= S.limit;
    for (const m of list) S.msgs.set(m.id, m);
    renderMessages(!keepScroll);
    markRead();
  }

  function loadOlder() {
    const box = $('messages');
    const prevHeight = box.scrollHeight, prevTop = box.scrollTop;
    S.limit += PAGE;
    loadMessages(true).then(() => { box.scrollTop = box.scrollHeight - prevHeight + prevTop; });
  }

  function markRead() {
    const c = S.conv;
    if (!c || document.hidden || !atBottom()) return;
    const meta = S.meta[c.key];
    if (!meta || (meta.lastRead || 0) >= (meta.updatedAt || 0)) return;
    meta.lastRead = meta.updatedAt;
    persist('meta');
    queueRerender();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) markRead(); });
  window.addEventListener('focus', markRead);

  // ---------- Rendering messages ----------

  let renderTimer = null, renderWantBottom = false;
  function scheduleRender(maybeBottom) {
    renderWantBottom = renderWantBottom || maybeBottom;
    if (renderTimer) return;
    renderTimer = requestAnimationFrame(() => {
      renderTimer = null;
      const stick = renderWantBottom && atBottom(120);
      renderWantBottom = false;
      renderMessages(stick);
    });
  }

  function sortedKeys() {
    return [...S.msgs.keys()].sort((a, b) => (S.msgs.get(a).ts - S.msgs.get(b).ts) || (a < b ? -1 : 1));
  }

  function atBottom(slack) {
    const b = $('messages');
    return b.scrollHeight - b.scrollTop - b.clientHeight < (slack || 40);
  }

  function scrollToBottom() { const b = $('messages'); b.scrollTop = b.scrollHeight; $('jumpBtn').classList.add('hidden'); }

  // Touch screens have no hover: tapping a message shows its actions.
  const coarse = window.matchMedia('(hover: none)');
  $('messages').addEventListener('click', (e) => {
    if (!coarse.matches) return;
    const msg = e.target.closest('.msg');
    if (!msg || msg.classList.contains('system') || e.target.closest('a, button, img, .spoiler, textarea, .msg-tools')) return;
    const open = msg.classList.contains('tools-open');
    $('messages').querySelectorAll('.msg.tools-open').forEach((n) => n.classList.remove('tools-open'));
    if (!open) msg.classList.add('tools-open');
  });

  $('messages').addEventListener('scroll', () => {
    if (atBottom()) { $('jumpBtn').classList.add('hidden'); markRead(); }
  }, { passive: true });
  $('jumpBtn').addEventListener('click', () => { scrollToBottom(); markRead(); });

  function renderMessages(toBottom) {
    const c = S.conv;
    if (!c) return;
    const box = $('messages');
    const wasBottom = atBottom(120);
    const keys = sortedKeys();
    const out = [];
    if (S.hasOlder) out.push(el('div', { class: 'load-older' }, btn('Load older messages', 'btn-sm btn-ghost', loadOlder)));
    else out.push(convStart());
    let prev = null, prevDay = '';
    for (const key of keys) {
      const m = S.msgs.get(key);
      if (!m || !m.ts) continue;
      const day = new Date(m.ts).toDateString();
      if (day !== prevDay) { out.push(el('div', { class: 'day-sep', text: fmtDay(m.ts) })); prevDay = day; prev = null; }
      const node = msgNode(key, m);
      const grouped = prev && prev.from === m.from && !m.kind && !prev.kind && !m.replyTo && m.ts - prev.ts < 5 * 60 * 1000 && !prev.deleted;
      node.classList.toggle('grouped', !!grouped);
      out.push(node);
      prev = m;
    }
    box.replaceChildren(...out);
    if (toBottom || wasBottom) scrollToBottom();
    markRead();
  }

  function convStart() {
    const c = S.conv;
    if (c.type === 'dm') {
      return el('div', { class: 'conv-start' }, el('strong', { text: nameOf(c.id) }),
        'This is the start of your DMs with ' + nameOf(c.id) + '. Messages go directly between your browsers and are saved only on your devices.');
    }
    return el('div', { class: 'conv-start' }, roomIcon(Object.assign({ code: c.id }, S.rooms[c.id] || {}), true), el('strong', { text: roomName(c.id) }), 'Welcome to the room. Share code ', el('span', { class: 'code-chip', text: c.id, onclick: copyCode }), ' to invite people.');
  }

  function msgSig(key, m) {
    const p = profileOf(m.from) || {};
    return [JSON.stringify(m), p.name, p.color, p.avatar ? p.avatar.length + ':' + S.nsfw[imgKey(p.avatar)] : 0, isBlocked(m.from), S.revealed.has(key),
      m.image && !m.image.startsWith('https') ? S.nsfw[imgKey(m.image)] : '', m.sticker && m.sticker.data ? S.nsfw[imgKey(m.sticker.data)] : '',
      m.emoji ? Object.values(m.emoji).map((d) => S.nsfw[imgKey(d)]).join() : '', S.me.name, S.reply && S.reply.id === key, S.editing === key, canModerateConv(), roomHostId()].join('|');
  }

  function msgNode(key, m) {
    const sig = msgSig(key, m);
    const cached = S.msgNodes.get(key);
    if (cached && cached.sig === sig) return cached.node;
    const node = buildMsg(key, m);
    S.msgNodes.set(key, { sig, node });
    return node;
  }

  function roomHostId() { return S.conv && S.conv.type === 'room' && S.rooms[S.conv.id] ? S.rooms[S.conv.id].hostId : ''; }
  function canModerateConv() { return !!(S.conv && S.conv.type === 'room' && iHost(S.conv.id)); }

  function buildMsg(key, m) {
    if (m.kind === 'system') {
      return el('div', { class: 'msg system', 'data-id': key }, el('div', { class: 'msg-text' }, el('b', { text: nameOf(m.from) }), ' ' + (m.text || '')));
    }
    const mine = m.from === S.me.id;

    if (isBlocked(m.from) && !S.revealed.has(key)) {
      return el('div', { class: 'msg system blocked-msg', 'data-id': key },
        el('div', { class: 'msg-text' }, 'Message from someone you blocked. ', el('button', { class: 'link-btn', type: 'button', text: 'Show', onclick: () => { S.revealed.add(key); S.msgNodes.delete(key); scheduleRender(false); } })));
    }

    const myName = S.me.name.toLowerCase().replace(/\s+/g, '_');
    const mentioned = !mine && m.text && new RegExp('(^|[^\\w])@' + myName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'i').test(m.text);
    const node = el('div', { class: 'msg' + (m.kind === 'action' ? ' action' : '') + (mentioned ? ' mentioned' : ''), 'data-id': key });

    const av = avatar(m.from, 'lg');
    av.addEventListener('click', () => showProfile(m.from));
    av.style.cursor = 'pointer';
    node.append(av, el('div', { class: 'msg-gutter', text: fmtTime(m.ts) }));

    const body = el('div', { class: 'msg-body' });
    if (m.replyTo) {
      const r = m.replyTo;
      body.append(el('div', { class: 'msg-reply', onclick: () => jumpTo(r.id) }, '↳ ', el('b', { text: nameOf(r.from) }), el('span', { text: ' ' + (r.text || 'attachment') })));
    }
    body.append(el('div', { class: 'msg-head' },
      nameEl(m.from, 'msg-user', { onclick: () => showProfile(m.from) }),
      S.conv.type === 'room' && roomHostId() === m.from ? el('span', { class: 'badge', text: 'host' }) : null,
      el('span', { class: 'msg-time', title: new Date(m.ts).toLocaleString(), text: fmtTime(m.ts) })
    ));

    if (m.deleted) {
      body.append(el('div', { class: 'msg-deleted', text: 'Message deleted.' }));
    } else {
      if (S.editing === key) {
        body.append(editBox(key, m));
      } else if (m.text) {
        const t = el('div', { class: 'msg-text' }, formatText(m.text, m.emoji));
        if (isBigEmoji(m.text, m.emoji)) t.classList.add('big');
        if (m.kind === 'action') t.prepend(el('b', { text: nameOf(m.from) + ' ' }));
        if (m.edited) t.append(el('span', { class: 'msg-edited', text: '(edited)' }));
        body.append(look.text === 'blend' ? blendText(t) : t);
      }
      if (m.sticker) body.append(stickerView(key, m));
      const img = imageBlock(key, m);
      if (img) body.append(img);
    }

    if (mine && m.status === 'pending' && !m.deleted) body.append(el('div', { class: 'msg-status', text: 'Waiting to send: delivers when you’re both online' }));

    const reacts = reactionsByEmoji(m);
    if (reacts.length && !m.deleted) {
      body.append(el('div', { class: 'reactions' }, reacts.map(([emo, ids]) => el('button', {
        class: 'reaction' + (ids.includes(S.me.id) ? ' mine' : ''), type: 'button', title: ids.map(nameOf).join(', '),
        onclick: () => toggleReaction(key, emo)
      }, emo, el('b', { text: String(ids.length) })))));
    }
    node.append(body);

    if (!m.deleted) {
      node.append(el('div', { class: 'msg-tools' },
        toolBtn('😀', 'React', (e) => openReactPop(node, key, e)),
        toolBtn('↩', 'Reply', () => startReply(key, m)),
        mine && m.text && !m.kind ? toolBtn('✎', 'Edit', () => { S.editing = key; scheduleRender(false); }) : null,
        m.text ? toolBtn('⧉', 'Copy text', () => { navigator.clipboard && navigator.clipboard.writeText(m.text); toast('Copied.'); }) : null,
        mine || canModerateConv() ? toolBtn('🗑', 'Delete', () => deleteMessage(key, m)) : null,
        !mine ? toolBtn('⚑', 'Report', () => reportMessage(key, m)) : null
      ));
    }
    return node;
  }

  function toolBtn(label, title, onclick) {
    return el('button', { class: 'icon-btn', type: 'button', title, 'aria-label': title, text: label, onclick });
  }

  function jumpTo(id) {
    const n = $('messages').querySelector('[data-id="' + CSS.escape(id) + '"]');
    if (!n) { toast('That message is further back.'); return; }
    n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
  }

  function reactionsByEmoji(m) {
    const out = new Map();
    for (const [id, list] of Object.entries(m.reactions || {})) for (const e of list || []) { if (!out.has(e)) out.set(e, []); out.get(e).push(id); }
    return [...out.entries()];
  }
  // ---------- Text formatting ----------

  const INLINE_RULES = [
    { re: /\|\|([\s\S]+?)\|\|/, wrap: (kids) => { const s = el('span', { class: 'spoiler', title: 'Spoiler', onclick: () => s.classList.toggle('shown') }, kids); return s; } },
    { re: /\*\*([\s\S]+?)\*\*/, wrap: (kids) => el('strong', null, kids) },
    { re: /__([\s\S]+?)__/, wrap: (kids) => el('u', null, kids) },
    { re: /~~([\s\S]+?)~~/, wrap: (kids) => el('s', null, kids) },
    { re: /\*([^*\n]+?)\*/, wrap: (kids) => el('em', null, kids) },
    { re: /(?<![\w])_([^_\n]+?)_(?![\w])/, wrap: (kids) => el('em', null, kids) }
  ];
  const LEAF_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,:;'!?)\]])|@([A-Za-z0-9_]{3,20})|:([A-Za-z0-9_+-]{2,32}):/g;

  function formatText(text, emoji) {
    const frag = document.createDocumentFragment();
    text.split(/(`[^`\n]+`)/).forEach((part) => {
      if (/^`[^`\n]+`$/.test(part)) frag.append(el('code', { text: part.slice(1, -1) }));
      else if (part) frag.append(inline(part, emoji, 0));
    });
    return frag;
  }

  function inline(text, emoji, depth) {
    const frag = document.createDocumentFragment();
    let best = null;
    if (depth < 6) {
      for (const rule of INLINE_RULES) {
        const m = rule.re.exec(text);
        if (m && (!best || m.index < best.m.index)) best = { rule, m };
      }
    }
    if (!best) { frag.append(leaves(text, emoji)); return frag; }
    const { rule, m } = best;
    frag.append(leaves(text.slice(0, m.index), emoji));
    frag.append(rule.wrap(inline(m[1], emoji, depth + 1)));
    frag.append(inline(text.slice(m.index + m[0].length), emoji, depth));
    return frag;
  }

  function userByName(name) {
    const lower = name.toLowerCase();
    if (S.me.name.toLowerCase().replace(/\s+/g, '_') === lower) return S.me.id;
    for (const id in S.profiles) if ((S.profiles[id].name || '').toLowerCase().replace(/\s+/g, '_') === lower) return id;
    return null;
  }

  function leaves(text, emoji) {
    const frag = document.createDocumentFragment();
    let last = 0, m;
    LEAF_RE.lastIndex = 0;
    while ((m = LEAF_RE.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      if (m[1]) {
        frag.append(el('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer nofollow ugc', text: m[1] }));
      } else if (m[2]) {
        const uid = userByName(m[2]);
        if (uid) frag.append(el('span', { class: 'mention' + (uid === S.me.id ? ' me' : ''), text: '@' + nameOf(uid), onclick: () => showProfile(uid) }));
        else frag.append(m[0]);
      } else if (m[3]) {
        const custom = findCustomEmoji(emoji, m[3]);
        if (custom) frag.append(el('img', { class: 'custom-emoji', src: custom.data, alt: ':' + m[3] + ':', title: ':' + m[3] + ':' }));
        else if (SHORTCODES[m[3]]) frag.append(SHORTCODES[m[3]]);
        else frag.append(m[0]);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }

  function isBigEmoji(text, emoji) {
    let rest = text.replace(/:([A-Za-z0-9_+-]{2,32}):/g, (all, name) => (findCustomEmoji(emoji, name) || SHORTCODES[name] ? '⭐' : all)).replace(/\s+/g, '');
    if (!rest || rest.length > 40) return false;
    if (!/^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u.test(rest)) return false;
    const count = (rest.match(/\p{Extended_Pictographic}/gu) || []).length;
    return count > 0 && count <= 6;
  }


  // Custom emoji travel with the message; they show once the image filter has passed them.
  function findCustomEmoji(map, name) {
    const d = map && map[name];
    const src = d && safeSrc(d);
    return src ? { data: src } : null;
  }

  // ---------- Images and stickers in messages ----------
  // Nothing from another browser has been checked by a server, so every image is run through the
  // in-browser filter on *this* device before it's shown.

  function heldImage(key, data, what) {
    const k = imgKey(data);
    const v = S.nsfw[k];
    if (v === 'flagged') return el('div', { class: 'img-held' }, el('span', { text: 'Hidden by the image filter.' }));
    return el('div', { class: 'img-held' },
      el('span', { text: v === 'error' ? "This " + what + " couldn't be checked." : 'Checking ' + what + '…' }),
      v === 'error' ? el('button', { class: 'link-btn', type: 'button', text: 'Show anyway', onclick: () => { S.revealed.add(k); S.msgNodes.delete(key); scheduleRender(false); } }) : null);
  }

  function imageBlock(key, m) {
    if (!m.image) return null;
    if (m.image.startsWith('https://')) return imgEl(m.image, 'GIF');
    const src = m.from === S.me.id ? m.image : safeSrc(m.image);
    return src ? imgEl(src, 'Image') : heldImage(key, m.image, 'image');
  }

  function imgEl(src, alt) {
    const img = el('img', { class: 'msg-image', src, alt, loading: 'lazy', decoding: 'async' });
    img.addEventListener('click', () => openLightbox(img));
    img.addEventListener('load', () => { if (atBottom(img.naturalHeight + 160)) scrollToBottom(); }, { once: true });
    return img;
  }

  function stickerView(key, m) {
    if (typeof m.sticker === 'string') return el('div', { class: 'sticker-emoji', text: m.sticker });
    const src = m.from === S.me.id ? m.sticker.data : safeSrc(m.sticker.data);
    if (!src) return heldImage(key, m.sticker.data, 'sticker');
    const img = el('img', { class: 'sticker-img', src, alt: 'Sticker ' + m.sticker.name, title: m.sticker.name });
    img.addEventListener('click', () => openLightbox(img));
    return img;
  }

  // ---------- Conversation header, banner, typing ----------

  function renderConvHead() {
    const c = S.conv;
    if (!c) return;
    if (c.type === 'dm') {
      const ct = S.contacts[c.id] || {};
      $('convAvatar').replaceChildren(avatar(c.id, null, true));
      $('convTitle').replaceChildren(nameEl(c.id));
      const p = profileOf(c.id);
      const status = S.online[c.id] ? 'online' : ct.lastSeen ? 'last seen ' + fmtAgo(ct.lastSeen) : 'offline';
      $('convSub').replaceChildren(document.createTextNode(status), p && p.bio ? ' · ' + p.bio : '');
      $('membersBtn').classList.add('hidden');
    } else {
      const r = S.rooms[c.id] || {};
      $('convAvatar').replaceChildren(roomIcon(Object.assign({ code: c.id }, r)));
      $('convTitle').textContent = r.name || c.id;
      const online = Object.values(r.members || {}).filter((x) => x.online).length;
      const status = r.status === 'connected' ? online + ' online' : r.status === 'offline' ? 'offline' : 'connecting…';
      $('convSub').replaceChildren(el('span', { class: 'code-chip', title: 'Copy invite link', text: c.id, onclick: copyCode }), ' ' + status + (iHost(c.id) ? ' · you’re hosting' : ''));
      $('membersBtn').classList.remove('hidden');
      $('membersBtn').classList.toggle('active', S.showMembers);
    }
    const inThis = voice && voice.scope === c.type && voice.id === c.id;
    $('voiceBtn').classList.toggle('active', !!inThis);
    $('voiceBtn').title = inThis ? 'Leave voice' : c.type === 'dm' ? 'Call' : 'Join voice';
  }

  function renderConvBanner() {
    const c = S.conv;
    const b = $('convBanner');
    let text = '';
    const actions = [];
    if (c && c.type === 'dm') {
      const ct = S.contacts[c.id] || {};
      if (S.globalBlocks[c.id]) text = 'This account is blocked on this site.';
      else if (isBlocked(c.id)) { text = 'You blocked ' + nameOf(c.id) + '.'; actions.push(btn('Unblock', 'btn-sm btn-ghost', () => setBlocked(c.id, false))); }
      else if (ct.status === 'incoming') { text = nameOf(c.id) + ' wants to chat with you.'; actions.push(btn('Accept', 'btn-sm btn-primary', () => acceptContact(c.id)), btn('Decline', 'btn-sm btn-ghost', () => { declineContact(c.id); openHome(); })); }
      else if (ct.status === 'outgoing') text = ct.declined ? nameOf(c.id) + " hasn't accepted your request." : 'Request sent. You can chat once ' + nameOf(c.id) + ' accepts (you both need chat open).';
      else if (!S.online[c.id]) text = nameOf(c.id) + " is offline. Messages will send when you're both online.";
    } else if (c && c.type === 'room') {
      const r = S.rooms[c.id] || {};
      if (r.status === 'offline') { text = 'No one is hosting this room right now.'; actions.push(btn('Host it', 'btn-sm btn-primary', () => hostRoom(c.id, localRoomState(c.id)))); }
      else if (r.status !== 'connected') text = 'Connecting to the room…';
      else if (S.roomMuted[S.me.id]) text = 'The host has muted you in this room.';
    }
    b.replaceChildren(el('span', { text }), ...actions);
    b.classList.toggle('hidden', !text);
    const ct = c && c.type === 'dm' ? S.contacts[c.id] || {} : null;
    const locked = !c || (ct ? ct.status !== 'accepted' || isBlocked(c.id) : ((S.rooms[c.id] || {}).status !== 'connected' || !!S.roomMuted[S.me.id]));
    input.disabled = locked;
    input.placeholder = locked ? "You can't send messages here right now" : c.type === 'dm' ? 'Message ' + nameOf(c.id) : 'Message ' + roomName(c.id);
    ['sendBtn', 'attachBtn', 'gifBtn', 'stickerBtn', 'emojiBtn'].forEach((id) => { $(id).disabled = locked; });
  }

  function renderTyping() {
    const now = Date.now();
    const c = S.conv;
    if (!c) return;
    const ids = c.type === 'dm' ? [c.id] : Object.keys(S.typing);
    const who = ids.filter((id) => id !== S.me.id && now - (S.typing[id] || 0) < 6000 && !isBlocked(id)).map(nameOf);
    $('typing').textContent = !who.length ? '' : who.length === 1 ? who[0] + ' is typing…' : who.length < 4 ? who.join(', ') + ' are typing…' : 'Several people are typing…';
  }
  setInterval(() => { if (S.conv) renderTyping(); }, 3000);

  let typingSent = 0;
  function sendTyping() {
    const c = S.conv;
    if (!c || Date.now() - typingSent < 3000) return;
    typingSent = Date.now();
    if (c.type === 'dm') sendTo(c.id, { t: 'typing' }); else roomSend(c.id, { k: 'typing' });
  }
  function stopTyping() { typingSent = 0; }

  function copyCode() {
    const code = S.conv && S.conv.id;
    if (!code) return;
    const link = location.origin + location.pathname + '#join/' + code;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Invite link copied.'), () => toast('Room code: ' + code));
  }

  // ---------- Members panel and host tools ----------

  $('membersBtn').addEventListener('click', () => { S.showMembers = !S.showMembers; renderMembers(); renderConvHead(); });

  function renderMembers() {
    const pane = $('membersPane');
    const c = S.conv;
    if (!c || c.type !== 'room' || !S.showMembers) { pane.classList.add('hidden'); $('appView').classList.remove('with-members'); return; }
    pane.classList.remove('hidden'); $('appView').classList.add('with-members');
    const r = S.rooms[c.id] || {};
    const host = iHost(c.id);
    const H = hosts[c.id];
    const ids = Object.keys(r.members || {}).sort((a, b) => (b === r.hostId) - (a === r.hostId) || (r.members[b].online ? 1 : 0) - (r.members[a].online ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)));
    const row = (id) => {
      const online = r.members[id].online;
      const tags = [id === r.hostId ? 'host' : '', S.roomMuted[id] ? 'muted' : '', online ? '' : 'offline'].filter(Boolean).join(' · ');
      const actions = host && id !== S.me.id ? el('div', { class: 'member-actions' },
        toolBtn(S.roomMuted[id] ? '🔊' : '🔇', S.roomMuted[id] ? 'Unmute' : 'Mute', () => hostTool(c.id, S.roomMuted[id] ? 'unmute' : 'mute', id)),
        online ? toolBtn('👑', 'Make host', async () => { if (await confirmBox('Make ' + nameOf(id) + ' the host?', 'The room will move to their browser.', 'Transfer')) hostTool(c.id, 'transfer', id); }) : null,
        toolBtn('🚪', 'Kick', async () => { if (await confirmBox('Kick ' + nameOf(id) + '?', "They'll be removed and can't rejoin unless you allow them back.", 'Kick', true)) hostTool(c.id, 'kick', id); })) : null;
      return el('div', { class: 'member' + (online ? '' : ' offline') },
        el('button', { type: 'button', class: 'member-main', onclick: () => showProfile(id) }, avatar(id, 'sm', true),
          nameEl(id, 'member-name')),
        tags ? el('span', { class: 'member-tags', text: tags }) : null, actions);
    };
    const banned = Object.keys(S.roomBanned);
    const reports = H ? H.reports : [];
    pane.replaceChildren(
      el('div', { class: 'members-scroll' },
        el('p', { class: 'side-title', text: 'Members · ' + ids.length }), ids.map(row),
        host && reports.length ? [el('p', { class: 'side-title', text: 'Reports · ' + reports.length }), reports.map((rep) => reportCard(c.id, rep))] : null,
        host && banned.length ? [el('p', { class: 'side-title', text: 'Kicked' }), banned.map((id) => el('div', { class: 'member' }, avatar(id, 'sm'), el('span', { class: 'member-name', text: nameOf(id) }), toolBtn('↺', 'Allow back', () => hostTool(c.id, 'unban', id))))] : null),
      el('div', { class: 'members-foot' },
        btn('Copy invite link', 'btn-outline', copyCode),
        host ? btn('Room settings', 'btn-ghost', () => roomSettings(c.id)) : null,
        btn(host ? 'Leave or close room' : 'Leave room', 'btn-ghost', () => leaveRoom(c.id)))
    );
  }

  function reportCard(code, rep) {
    const reason = (REPORT_REASONS.find((r) => r[0] === rep.reason) || [0, rep.reason])[1];
    const H = hosts[code];
    const done = () => { H.reports = H.reports.filter((x) => x !== rep); renderMembers(); };
    return el('div', { class: 'mod-card' + (rep.reason === 'child_safety' ? ' priority' : '') },
      el('div', { class: 'mod-card-head' }, el('b', { text: reason }), el('span', { class: 'field-hint', text: ' · ' + fmtAgo(rep.ts) })),
      el('p', { class: 'field-hint', text: nameOf(rep.by) + ' reported ' + nameOf(rep.target) }),
      rep.note ? el('p', { class: 'mod-note', text: '“' + rep.note + '”' }) : null,
      rep.msg && rep.msg.text ? el('p', { class: 'mod-note', text: rep.msg.text.slice(0, 300) }) : null,
      rep.msg && rep.msg.image && !rep.msg.image.startsWith('https') ? el('p', { class: 'field-hint', text: '(includes an image)' }) : null,
      el('div', { class: 'mod-actions' },
        rep.msg && !rep.msg.deleted ? btn('Delete message', 'btn-sm btn-outline', () => { hostTool(code, 'delmsg', rep.msg.id); done(); }) : null,
        rep.target && rep.target !== S.me.id && H && H.members[rep.target] ? btn('Kick', 'btn-sm btn-accent', () => { hostTool(code, 'kick', rep.target); done(); }) : null,
        btn('Dismiss', 'btn-sm btn-ghost', done)));
  }

  $('convMenuBtn').addEventListener('click', () => {
    const c = S.conv;
    if (!c) return;
    const items = [];
    if (c.type === 'dm') {
      items.push(btn('View profile', 'btn-outline btn-block', () => { closeModal(); showProfile(c.id); }));
      items.push(btn(isBlocked(c.id) ? 'Unblock' : 'Block', 'btn-outline btn-block', () => { closeModal(); setBlocked(c.id, !isBlocked(c.id)); }));
      items.push(btn('Report', 'btn-outline btn-block', () => { closeModal(); reportUser(c.id); }));
      items.push(btn('Remove contact', 'btn-outline btn-block', async () => { closeModal(); if (await confirmBox('Remove ' + nameOf(c.id) + '?', 'You can add each other again later.', 'Remove', true)) removeContact(c.id); }));
    } else {
      items.push(btn('Copy invite link', 'btn-outline btn-block', () => { closeModal(); copyCode(); }));
      items.push(btn('Members', 'btn-outline btn-block', () => { closeModal(); S.showMembers = true; renderMembers(); renderConvHead(); }));
      items.push(btn(iHost(c.id) ? 'Leave or close room' : 'Leave room', 'btn-outline btn-block', () => { closeModal(); leaveRoom(c.id); }));
    }
    items.push(btn('Formatting help', 'btn-ghost btn-block', () => { closeModal(); showHelp(); }));
    openModal(c.type === 'dm' ? nameOf(c.id) : roomName(c.id), el('div', { class: 'stack' }, items), [btn('Close', 'btn-ghost', closeModal)]);
  });

  // ---------- Profiles, blocking, reports ----------

  // A profile card: banner, avatar overlapping it, gradient name, code, bio.
  function profileCard(id) {
    const p = profileOf(id) || {};
    const banner = el('div', { class: 'pc-banner' });
    const img = p.banner && (id === S.me.id ? p.banner : safeSrc(p.banner));
    if (img) banner.style.backgroundImage = 'url("' + img.replace(/"/g, '') + '")';
    else if (p.bannerGrad) banner.style.background = 'linear-gradient(135deg, ' + p.bannerGrad[0] + ', ' + p.bannerGrad[1] + ')';
    else banner.style.background = 'linear-gradient(135deg, ' + (p.color || '#9d00ff') + ', #0d0a12)';
    return el('div', { class: 'profile-card' },
      banner,
      el('div', { class: 'pc-body' },
        el('div', { class: 'pc-avatar' }, avatar(id, 'xl', true)),
        nameEl(id, 'profile-name'),
        el('p', { class: 'field-hint profile-code', text: fmtCode(id) }),
        el('div', { class: 'row pc-badges' },
          id === S.me.id ? el('span', { class: 'badge badge-mod', text: 'you' }) : null,
          S.globalBlocks[id] ? el('span', { class: 'badge badge-ban', text: 'blocked on this site' }) : null,
          S.blocks[id] ? el('span', { class: 'badge', text: 'blocked' }) : null,
          isContact(id) ? el('span', { class: 'badge badge-mod', text: 'contact' }) : null),
        p.bio ? el('div', { class: 'pc-section' }, el('p', { class: 'side-title', text: 'About' }), el('p', { class: 'profile-bio', text: p.bio })) : null));
  }

  let shownProfile = null;
  function showProfile(id) {
    shownProfile = id;
    const me = id === S.me.id;
    const ct = S.contacts[id];
    const body = profileCard(id);
    const actions = me
      ? [btn('Copy my link', 'btn-outline', copyMyCode), btn('Edit profile', 'btn-primary', () => { closeModal(); openSettings(); })]
      : [
          btn('Report', 'btn-ghost', () => { closeModal(); reportUser(id); }),
          btn(S.blocks[id] ? 'Unblock' : 'Block', 'btn-ghost', () => { closeModal(); setBlocked(id, !S.blocks[id]); }),
          isContact(id) ? btn('Message', 'btn-primary', () => { closeModal(); openDm(id); })
            : ct && ct.status === 'outgoing' ? btn('Request sent', 'btn-outline', () => { closeModal(); openDm(id); })
            : btn('Add contact', 'btn-primary', () => { closeModal(); addContact(id).catch((e) => toast(e.message)); })
        ];
    openModal('', body, actions, { card: true, onClose: () => { shownProfile = null; } });
  }

  async function setBlocked(id, on) {
    if (on && !(await confirmBox('Block ' + nameOf(id) + '?', "They won't be able to message or call you, and their room messages will be hidden for you.", 'Block', true))) return;
    if (on) {
      S.blocks[id] = true;
      if (voice && voice.calls && voice.calls.has(id)) closeCall(id);
      const link = net.links.get(id);
      if (link) { try { link.conn.send({ t: 'bye' }); } catch (e) { /* closed */ } setTimeout(() => link.conn.close(), 200); }
    } else delete S.blocks[id];
    persist('blocks');
    S.msgNodes.clear();
    toast(on ? nameOf(id) + ' is blocked.' : nameOf(id) + ' is unblocked.');
    if (!on && S.contacts[id]) connectTo(id);
    queueRerender();
  }

  function reportForm(title, intro, onSubmit) {
    let reason = null;
    const err = el('p', { class: 'form-error' });
    const note = el('textarea', { class: 'input', rows: 3, maxLength: 500, placeholder: 'Anything the host should know (optional)' });
    const list = el('div', { class: 'reason-list', role: 'radiogroup' }, REPORT_REASONS.map(([value, label]) =>
      el('label', { class: 'reason' + (value === 'child_safety' ? ' urgent' : '') },
        el('input', { type: 'radio', name: 'reason', value, onchange: () => { reason = value; err.textContent = ''; } }),
        el('span', null, label))));
    openModal(title, el('div', null,
      el('p', { class: 'modal-text', text: intro }), list, el('div', { class: 'field' }, note), err),
    [btn('Cancel', 'btn-ghost', closeModal), btn('Report', 'btn-accent', async () => {
      if (!reason) { err.textContent = 'Pick a reason.'; return; }
      closeModal();
      await onSubmit(reason, note.value.trim());
      afterReport(reason);
    })]);
  }

  // Serious reports: point to the people who can act on them.
  function afterReport(reason) {
    if (reason === 'child_safety' || reason === 'self_harm' || reason === 'violence') {
      openModal('Get help', el('div', { class: 'stack' },
        el('p', { class: 'modal-text', text: 'This chat has no central moderators. For anything illegal or dangerous, report it to the authorities. If someone is in immediate danger, call your local emergency number (000 in Australia).' }),
        reason === 'child_safety' ? el('a', { class: 'btn btn-outline btn-block', href: 'https://www.accce.gov.au/report', target: '_blank', rel: 'noopener', text: 'Australia: report to the ACCCE' }) : null,
        el('a', { class: 'btn btn-outline btn-block', href: 'https://www.esafety.gov.au/report', target: '_blank', rel: 'noopener', text: 'Australia: eSafety Commissioner' }),
        reason === 'child_safety' ? el('a', { class: 'btn btn-outline btn-block', href: 'https://report.cybertip.org', target: '_blank', rel: 'noopener', text: 'Elsewhere: NCMEC CyberTipline' }) : null,
        reason === 'self_harm' ? el('a', { class: 'btn btn-outline btn-block', href: 'https://www.lifeline.org.au', target: '_blank', rel: 'noopener', text: 'Lifeline (13 11 14)' }) : null),
      [btn('Close', 'btn-primary', closeModal)]);
    } else toast('Thanks for reporting.');
  }

  function reportMessage(key, m) {
    const c = S.conv;
    const inRoom = c.type === 'room';
    reportForm('Report message', inRoom ? 'The room host will see this report and the message. They can delete it or remove ' + nameOf(m.from) + '.'
      : 'Reporting blocks ' + nameOf(m.from) + ' and hides their messages. DMs have no host or moderator.', async (reason, note) => {
      if (inRoom) {
        if (iHost(c.id)) toast("You're the host: use the member list to act on it.");
        else roomSend(c.id, { k: 'report', id: key, reason, note });
      } else if (!S.blocks[m.from]) { S.blocks[m.from] = true; persist('blocks'); queueRerender(); }
    });
  }

  function reportUser(id) {
    const room = S.conv && S.conv.type === 'room' && !iHost(S.conv.id) ? S.conv.id : null;
    reportForm('Report ' + nameOf(id), room ? 'The host of this room will see your report, and ' + nameOf(id) + ' will be blocked for you.' : nameOf(id) + ' will be blocked for you.', async (reason, note) => {
      if (room) roomSend(room, { k: 'report', target: id, reason, note });
      S.blocks[id] = true; persist('blocks'); queueRerender();
    });
  }
  // ---------- Composer ----------

  const input = $('composerInput');

  function draftKey() { return S.conv ? 'chat.draft.' + S.conv.type + '.' + S.conv.id : null; }
  function loadDraft() { try { return (draftKey() && localStorage.getItem(draftKey())) || ''; } catch (e) { return ''; } }
  function saveDraft() { try { const k = draftKey(); if (!k) return; if (input.value) localStorage.setItem(k, input.value); else localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; }

  input.addEventListener('input', () => { autoGrow(); saveDraft(); if (input.value.trim()) sendTyping(); handleMentionInput(); });
  input.addEventListener('keydown', (e) => {
    if (mentionState && handleMentionKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'Escape') { if (S.reply) { S.reply = null; renderBars(); } closePopover(); }
    else if (e.key === 'ArrowUp' && !input.value) {
      const mine = sortedKeys().reverse().map((k) => [k, S.msgs.get(k)]).find(([, m]) => m.from === S.me.id && m.text && !m.deleted && !m.kind);
      if (mine) { e.preventDefault(); S.editing = mine[0]; scheduleRender(false); }
    }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData && e.clipboardData.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); files.forEach(addImageFile); }
  });
  $('sendBtn').addEventListener('click', send);
  $('attachBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => { [...e.target.files].forEach(addImageFile); e.target.value = ''; });

  const mainPane = $('mainPane');
  mainPane.addEventListener('dragover', (e) => { if (S.conv && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); mainPane.classList.add('dropping'); } });
  mainPane.addEventListener('dragleave', (e) => { if (e.target === mainPane || !mainPane.contains(e.relatedTarget)) mainPane.classList.remove('dropping'); });
  mainPane.addEventListener('drop', (e) => {
    mainPane.classList.remove('dropping');
    if (!S.conv) return;
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); files.forEach(addImageFile); }
  });

  function renderBars() {
    const bars = [];
    if (S.reply) {
      bars.push(el('div', { class: 'bar' },
        el('span', { class: 'bar-text' }, 'Replying to ', el('b', { text: nameOf(S.reply.from) }), ' ' + (S.reply.text || '')),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cancel reply', onclick: () => { S.reply = null; renderBars(); } }, icon('close'))));
    }
    S.pendingImages.forEach((p, i) => {
      bars.push(el('div', { class: 'bar' },
        el('img', { src: p.data, alt: '' }),
        el('span', { class: 'bar-text', text: p.status === 'checking' ? 'Checking image…' : p.name }),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove image', onclick: () => { S.pendingImages.splice(i, 1); renderBars(); } }, icon('close'))));
    });
    $('composerBars').replaceChildren(...bars);
  }

  function startReply(key, m) {
    S.reply = { id: key, from: m.from, text: preview(m).slice(0, 200) };
    renderBars();
    input.focus();
  }

  let lastSend = 0;
  async function send() {
    const c = S.conv;
    if (!c || input.disabled) return;
    let text = input.value.trim();
    const imgs = S.pendingImages.filter((p) => p.status === 'ready');
    if (S.pendingImages.some((p) => p.status === 'checking')) { toast('Still checking your image…'); return; }
    if (!text && !imgs.length) return;
    if (Date.now() - lastSend < 600) { toast('Slow down a little.'); return; }
    lastSend = Date.now();

    if (text.startsWith('/') && !text.startsWith('//')) {
      const r = await runCommand(text);
      const clear = () => { input.value = ''; saveDraft(); autoGrow(); };
      if (r === true) { clear(); return; }
      if (r && typeof r === 'object') { clear(); postMessage(r).catch((err) => fail(err, sendErrorText())); return; }
      text = r;
    }

    const reply = S.reply ? { id: S.reply.id, from: S.reply.from, text: S.reply.text } : null;
    const msgs = [];
    if (text) msgs.push({ text: text.slice(0, 2000) });
    imgs.forEach((p) => msgs.push({ image: p.data }));
    if (reply) msgs[0].replyTo = reply;

    input.value = ''; saveDraft(); autoGrow();
    S.reply = null; S.pendingImages = []; renderBars(); closePopover(); stopTyping();
    for (const m of msgs) {
      try { await postMessage(m); } catch (err) { fail(err, err.message || sendErrorText()); input.value = text || ''; autoGrow(); break; }
    }
  }

  function sendErrorText() {
    const c = S.conv;
    if (c && c.type === 'room' && S.roomMuted[S.me.id]) return "You're muted in this room.";
    return "Couldn't send that message.";
  }

  // Build a message, save it locally and hand it to the contact's outbox or the room host.
  function postMessage(fields) {
    const c = S.conv;
    const msg = Object.assign({ id: randomId(14), ts: Date.now() }, fields);
    const emoji = customEmojiIn(msg.text);
    if (emoji) msg.emoji = emoji;
    if (c.type === 'dm') {
      if (!isContact(c.id)) return Promise.reject(new Error('They need to accept your request first.'));
      const local = Object.assign({ conv: c.key, from: S.me.id, status: 'pending' }, msg);
      return DB.putMsg(local).then(() => {
        touchMeta(c.key, local);
        S.msgs.set(local.id, local);
        scheduleRender(true);
        return queueDmOp(c.id, { k: 'msg', msg });
      });
    }
    if (!roomSend(c.id, { k: 'msg', msg })) return Promise.reject(new Error("You're not connected to this room right now."));
    return Promise.resolve();
  }

  // Attach the images of my own custom emoji used in the text, so others can see them.
  function customEmojiIn(text) {
    if (!text) return null;
    const out = {};
    let n = 0;
    for (const [, name] of text.matchAll(/:([A-Za-z0-9_]{2,32}):/g)) {
      const item = Object.values(S.customs).find((it) => it.kind === 'emoji' && it.name === name);
      if (item && !out[name] && n < 12) { out[name] = item.data; n++; }
    }
    return n ? out : null;
  }

  async function runCommand(text) {
    const [cmd, ...rest] = text.slice(1).split(' ');
    const arg = rest.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case 'me': return arg ? { text: arg, kind: 'action' } : true;
      case 'shrug': return (arg ? arg + ' ' : '') + '¯\\_(ツ)_/¯';
      case 'tableflip': return (arg ? arg + ' ' : '') + '(╯°□°)╯︵ ┻━┻';
      case 'unflip': return (arg ? arg + ' ' : '') + '┬─┬ノ( º _ ºノ)';
      case 'lenny': return (arg ? arg + ' ' : '') + '( ͡° ͜ʖ ͡°)';
      case 'gif': openGifs(arg); return true;
      case 'help': showHelp(); return true;
      default: return text; // not a command, send as-is
    }
  }

  function showHelp() {
    const items = [
      ['**bold**', 'bold'], ['*italic*', 'italic'], ['__underline__', 'underline'], ['~~strike~~', 'strikethrough'], ['||spoiler||', 'spoiler'], ['`code`', 'inline code'],
      ['@name', 'mention someone'], [':name:', 'custom emoji'], ['/me waves', 'action message'], ['/shrug /tableflip /unflip /lenny', 'faces'], ['/gif cats', 'search GIFs'],
      ['↑', 'edit your last message'], ['Shift+Enter', 'new line'], ['Paste or drop', 'send an image']
    ];
    openModal('Chat help', el('ul', { class: 'help-list' }, items.map(([k, v]) => el('li', null, el('code', { text: k }), ' ' + v))), [btn('Close', 'btn-primary', closeModal)]);
  }

  // ---------- Edit / delete / reactions ----------

  function editBox(key, m) {
    const ta = el('textarea', { class: 'input edit-input', value: m.text, maxLength: 2000, rows: 2 });
    const save = async () => {
      const v = ta.value.trim();
      S.editing = null;
      if (!v) { scheduleRender(false); return deleteMessage(key, m); }
      if (v !== m.text) await changeMessage(m, { k: 'edit', id: key, text: v }).catch((err) => fail(err));
      scheduleRender(false);
      input.focus();
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      if (e.key === 'Escape') { S.editing = null; scheduleRender(false); input.focus(); }
    });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    return el('div', { class: 'edit-wrap' }, ta, el('small', { class: 'field-hint', text: 'Enter to save · Esc to cancel' }));
  }

  async function deleteMessage(key, m) {
    const mine = m.from === S.me.id;
    if (!(await confirmBox('Delete message?', mine ? "This can't be undone." : 'Delete this message from ' + nameOf(m.from) + ' for everyone in the room?', 'Delete', true))) return;
    changeMessage(m, { k: 'del', id: key }).catch((err) => fail(err));
  }

  function toggleReaction(key, emo) {
    const m = S.msgs.get(key);
    if (!m) return;
    const current = (m.reactions && m.reactions[S.me.id]) || [];
    const next = current.includes(emo) ? current.filter((e) => e !== emo) : current.concat(emo);
    if (next.length > 8) { toast('That’s enough reactions on one message.'); return; }
    changeMessage(m, { k: 'react', id: key, list: next }).catch((err) => fail(err));
  }

  // Edits, deletes and reactions: DMs apply locally and queue for the other side;
  // rooms go through the host, which echoes the change to everyone.
  async function changeMessage(m, op) {
    const c = S.conv;
    if (c.type === 'dm') {
      if (op.k === 'edit') { m.text = op.text.slice(0, 2000); m.edited = true; }
      else if (op.k === 'del') stripMsg(m);
      else setReaction(m, S.me.id, op.list);
      await DB.putMsg(m);
      msgUpdated(m);
      if (m.status === 'pending' && op.k !== 'react') {
        // Not delivered yet: rewrite the queued message instead of sending a separate op.
        const box = await outbox(c.id);
        const queued = box.find((o) => o.k === 'msg' && o.msg.id === m.id);
        if (queued) {
          if (op.k === 'del') box.splice(box.indexOf(queued), 1); else queued.msg.text = m.text;
          saveOutbox(c.id);
          if (op.k === 'del') { m.status = 'sent'; await DB.putMsg(m); }
          return;
        }
      }
      return queueDmOp(c.id, op);
    }
    if (!roomSend(c.id, op)) throw new Error("You're not connected to this room right now.");
  }

  function openReactPop(node, key, e) {
    document.querySelectorAll('.react-pop').forEach((p) => p.remove());
    const pop = el('div', { class: 'react-pop' },
      QUICK_REACTIONS.map((emo) => el('button', { type: 'button', text: emo, onclick: () => { pop.remove(); toggleReaction(key, emo); } })),
      el('button', { type: 'button', text: '＋', title: 'More', onclick: () => { pop.remove(); openEmojiPicker((emo) => toggleReaction(key, emo), true); } }));
    node.append(pop);
    const off = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
    e.stopPropagation();
  }

  // ---------- Popovers: emoji, stickers, GIFs, mentions ----------

  let popKind = null;
  function openPopover(kind, content) {
    popKind = kind;
    const p = $('popover');
    p.replaceChildren(content);
    p.classList.remove('hidden');
  }
  function closePopover() { popKind = null; mentionState = null; $('popover').classList.add('hidden'); $('popover').replaceChildren(); }
  document.addEventListener('mousedown', (e) => {
    if (!popKind) return;
    if ($('popover').contains(e.target) || e.target.closest('#emojiBtn, #stickerBtn, #gifBtn')) return;
    closePopover();
  });

  function insertAtCursor(text) {
    const s = input.selectionStart, e = input.selectionEnd;
    input.value = input.value.slice(0, s) + text + input.value.slice(e);
    input.selectionStart = input.selectionEnd = s + text.length;
    input.focus(); autoGrow(); saveDraft();
  }

  $('emojiBtn').addEventListener('click', () => { if (popKind === 'emoji') closePopover(); else openEmojiPicker((emo) => insertAtCursor(emo), false); });
  $('stickerBtn').addEventListener('click', () => { if (popKind === 'sticker') closePopover(); else openStickers(); });
  $('gifBtn').addEventListener('click', () => { closePopover(); openGifs(''); });

  let emojiPick = null, emojiForReaction = false;
  function openEmojiPicker(onPick, forReaction) {
    emojiPick = onPick; emojiForReaction = forReaction;
    const search = el('input', { class: 'input emoji-search', placeholder: 'Search emoji', spellcheck: false });
    const grid = el('div', { class: 'emoji-scroll' });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const sections = [];
      const mine = Object.entries(S.customs).filter(([, it]) => it.kind === 'emoji');
      if (!forReaction && mine.length) {
        const hits = mine.filter(([, it]) => !q || it.name.toLowerCase().includes(q));
        if (hits.length) sections.push(el('p', { class: 'emoji-cat', text: 'Yours' }), el('div', { class: 'emoji-grid' }, hits.map(([, it]) =>
          el('button', { type: 'button', title: ':' + it.name + ':', onclick: () => { emojiPick(':' + it.name + ':'); closePopover(); } }, el('img', { class: 'custom-emoji', src: it.data, alt: it.name })))));
      }
      if (q) {
        const hits = EMOJI_NAMES.filter(([, n]) => n.includes(q)).slice(0, 80);
        sections.push(el('div', { class: 'emoji-grid' }, hits.map(([e, n]) => emojiBtn(e, n))));
        if (!hits.length && sections.length === 0) sections.push(el('p', { class: 'side-empty', text: 'No matches.' }));
      } else {
        const recent = getRecentEmoji();
        if (recent.length) sections.push(el('p', { class: 'emoji-cat', text: 'Recent' }), el('div', { class: 'emoji-grid' }, recent.map((e) => emojiBtn(e))));
        for (const [cat, list] of EMOJI) sections.push(el('p', { class: 'emoji-cat', text: cat }), el('div', { class: 'emoji-grid' }, list.split(' ').map((e) => emojiBtn(e))));
      }
      grid.replaceChildren(...sections);
    };
    const emojiBtn = (e, n) => el('button', { type: 'button', text: e, title: n || '', onclick: () => { pushRecentEmoji(e); emojiPick(e); if (!forReaction) closePopover(); else closePopover(); } });
    search.addEventListener('input', draw);
    const manage = el('button', { class: 'link-btn', type: 'button', text: 'Add your own emoji', onclick: () => { closePopover(); openCustomsManager('emoji'); } });
    openPopover('emoji', el('div', null, el('div', { class: 'pop-head' }, search, forReaction ? null : manage), grid));
    draw();
    setTimeout(() => search.focus(), 0);
  }

  function getRecentEmoji() { try { return JSON.parse(localStorage.getItem('chat.recentEmoji') || '[]').slice(0, 16); } catch (e) { return []; } }
  function pushRecentEmoji(e) { try { const r = getRecentEmoji().filter((x) => x !== e); r.unshift(e); localStorage.setItem('chat.recentEmoji', JSON.stringify(r.slice(0, 16))); } catch (err) { /* ignore */ } }

  const DEFAULT_STICKERS = ['👋', '❤️', '😭', '👀', '🔥', '💀', '🙏', '💯', '😎', '🎉', '👍', '😅', '🤔', '💪', '😴', '🤝', '😳', '🥺', '🫡', '💜', '🦘', '🐨', '🥑', '🍕'];

  function openStickers() {
    const mine = Object.entries(S.customs).filter(([, it]) => it.kind === 'sticker');
    const sendSticker = (value) => { closePopover(); postMessage({ sticker: value }).catch((err) => fail(err, sendErrorText())); };
    openPopover('sticker', el('div', null,
      el('div', { class: 'pop-head' }, el('p', { class: 'emoji-cat', text: 'Stickers' }), el('button', { class: 'link-btn', type: 'button', text: 'Add your own sticker', onclick: () => { closePopover(); openCustomsManager('sticker'); } })),
      mine.length ? el('div', { class: 'sticker-grid' }, mine.map(([, it]) => el('button', { type: 'button', title: it.name, onclick: () => sendSticker({ name: it.name, data: it.data }) }, el('img', { src: it.data, alt: it.name })))) : null,
      el('div', { class: 'sticker-grid' }, DEFAULT_STICKERS.map((s) => el('button', { type: 'button', class: 'sticker-emoji-btn', text: s, onclick: () => sendSticker(s) })))
    ));
  }

  function refreshOpenPickers() {
    if (popKind === 'sticker') openStickers();
    else if (popKind === 'emoji' && emojiPick) openEmojiPicker(emojiPick, emojiForReaction);
  }

  function openGifs(initial) {
    const search = el('input', { class: 'input', placeholder: 'Search Giphy', value: initial || '' });
    const grid = el('div', { class: 'gif-grid' });
    const note = el('p', { class: 'field-hint', text: 'Powered by GIPHY' });
    let timer, seq = 0;
    const load = async () => {
      const q = search.value.trim();
      const my = ++seq;
      const url = q
        ? 'https://api.giphy.com/v1/gifs/search?api_key=' + GIPHY_KEY + '&q=' + encodeURIComponent(q) + '&limit=24&rating=pg-13'
        : 'https://api.giphy.com/v1/gifs/trending?api_key=' + GIPHY_KEY + '&limit=24&rating=pg-13';
      grid.replaceChildren(el('p', { class: 'side-empty', text: 'Loading…' }));
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (my !== seq) return;
        const list = (data.data || []).filter((g) => g.images && g.images.fixed_height && /^https:\/\/[a-z0-9]+\.giphy\.com\//.test(g.images.fixed_height.url));
        grid.replaceChildren(...(list.length ? list.map((g) => el('button', {
          type: 'button', title: g.title || 'GIF',
          onclick: () => {
            closeModal();
            const clean = g.images.fixed_height.url.replace(/[^A-Za-z0-9._\/?=&%:-]/g, '');
            const reply = S.reply ? { id: S.reply.id, from: S.reply.from, text: S.reply.text } : null;
            S.reply = null; renderBars();
            postMessage(Object.assign({ image: clean }, reply ? { replyTo: reply } : {})).catch((err) => fail(err, sendErrorText()));
          }
        }, el('img', { src: g.images.fixed_height_small ? g.images.fixed_height_small.url : g.images.fixed_height.url, alt: g.title || 'GIF', loading: 'lazy' }))) : [el('p', { class: 'side-empty', text: 'No GIFs found.' })]));
      } catch (err) {
        grid.replaceChildren(el('p', { class: 'side-empty', text: "Couldn't reach Giphy." }));
      }
    };
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 350); });
    openModal('GIFs', el('div', null, search, grid, note), [btn('Close', 'btn-ghost', closeModal)], { wide: true });
    load();
  }

  // @mention autocomplete
  let mentionState = null;
  function mentionCandidates() {
    const c = S.conv;
    if (!c) return [];
    const ids = c.type === 'dm' ? [c.id] : Object.keys(S.members).filter((u) => u !== S.me.id);
    return ids.filter((u) => profileOf(u));
  }
  function handleMentionInput() {
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos);
    const m = /(^|\s)@([A-Za-z0-9_]{0,20})$/.exec(before);
    if (!m) { if (popKind === 'mention') closePopover(); return; }
    const q = m[2].toLowerCase();
    const list = mentionCandidates().filter((u) => mentionName(u).toLowerCase().startsWith(q)).slice(0, 8);
    if (!list.length) { if (popKind === 'mention') closePopover(); return; }
    mentionState = { start: pos - m[2].length - 1, list, sel: 0 };
    drawMentions();
  }
  function drawMentions() {
    const st = mentionState;
    openPopover('mention', el('div', null, st.list.map((u, i) => el('button', {
      class: 'mention-item' + (i === st.sel ? ' selected' : ''), type: 'button',
      onmousedown: (e) => { e.preventDefault(); pickMention(u); }
    }, avatar(u, 'sm'), el('span', { text: nameOf(u) })))));
    mentionState = st;
  }
  function pickMention(uid) {
    const st = mentionState;
    const end = input.selectionStart;
    input.value = input.value.slice(0, st.start) + '@' + mentionName(uid) + ' ' + input.value.slice(end);
    input.selectionStart = input.selectionEnd = st.start + mentionName(uid).length + 2;
    closePopover(); input.focus(); saveDraft();
  }
  function handleMentionKey(e) {
    const st = mentionState;
    if (!st || popKind !== 'mention') return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); st.sel = (st.sel + (e.key === 'ArrowDown' ? 1 : st.list.length - 1)) % st.list.length; drawMentions(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(st.list[st.sel]); return true; }
    if (e.key === 'Escape') { closePopover(); return true; }
    return false;
  }


  const mentionName = (id) => nameOf(id).replace(/\s+/g, '_');
  // ---------- Image upload, compression and the local safety check ----------

  function readAsDataURL(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't an image we can read.")); i.src = src; });
  }

  // Resize to fit `max` px and re-encode until the data URL is under `budget` characters.
  async function compress(src, max, budget, square) {
    const img = await loadImage(src);
    let w = img.naturalWidth, h = img.naturalHeight, sx = 0, sy = 0, sw = w, sh = h;
    if (square) { const side = Math.min(w, h); sx = (w - side) / 2; sy = (h - side) / 2; sw = sh = side; w = h = side; }
    let scale = Math.min(1, max / Math.max(w, h));
    for (let attempt = 0; attempt < 6; attempt++) {
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
      for (const q of [0.86, 0.72, 0.58]) {
        let out = cv.toDataURL('image/webp', q);
        if (!out.startsWith('data:image/webp')) out = cv.toDataURL('image/jpeg', q);
        if (out.length < budget) return out;
      }
      scale *= 0.7;
    }
    throw new Error('That image is too large.');
  }

  async function addImageFile(file) {
    if (!S.conv || input.disabled) return;
    if (!file.type.startsWith('image/')) { toast('Only images can be uploaded.'); return; }
    if (file.size > 25 * 1024 * 1024) { toast('That image is too large.'); return; }
    if (S.pendingImages.length >= 4) { toast('Up to 4 images at a time.'); return; }
    const entry = { name: file.name || 'pasted image', data: '', status: 'checking' };
    try {
      const raw = await readAsDataURL(file);
      // Keep small GIFs animated; everything else gets resized.
      entry.data = file.type === 'image/gif' && raw.length < 900000 ? raw : await compress(raw, 1600, 900000);
    } catch (err) { toast(err.message || "Couldn't read that image."); return; }
    S.pendingImages.push(entry);
    renderBars();
    const verdict = await classify(entry.data);
    if (!S.pendingImages.includes(entry)) return;
    if (verdict === 'flagged') {
      S.pendingImages.splice(S.pendingImages.indexOf(entry), 1);
      renderBars();
      openModal("Image not sent", el('p', { class: 'modal-text', text: "The image filter thinks this image is explicit, so it wasn't sent. Nudity and sexual content aren't allowed here." }), [btn('OK', 'btn-primary', closeModal)]);
      return;
    }
    entry.status = 'ready';
    renderBars();
  }

  // NSFW.js (MIT, Infinite Red) runs in the browser; the model is hosted with the site in /chat-model.
  let nsfwModel = null, nsfwLoading = null;
  function loadNsfw() {
    if (nsfwModel) return Promise.resolve(nsfwModel);
    if (nsfwLoading) return nsfwLoading;
    nsfwLoading = new Promise((res, rej) => {
      if (window.nsfwjs) return res();
      const s = document.createElement('script');
      s.src = NSFW_LIB; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = () => rej(new Error('classifier failed to load'));
      document.head.append(s);
    }).then(() => window.nsfwjs.load(NSFW_MODEL)).then((m) => (nsfwModel = m)).catch((err) => { nsfwLoading = null; throw err; });
    return nsfwLoading;
  }

  let classifyChain = Promise.resolve();
  function classify(src) {
    const job = classifyChain.then(async () => {
      try {
        const model = await loadNsfw();
        const img = await loadImage(src);
        const preds = await model.classify(img);
        const p = Object.fromEntries(preds.map((x) => [x.className, x.probability]));
        const explicit = (p.Porn || 0) + (p.Hentai || 0);
        return explicit >= 0.5 || (p.Sexy || 0) >= 0.85 ? 'flagged' : 'ok';
      } catch (err) {
        console.warn('image check failed', err);
        return 'error';
      }
    });
    classifyChain = job.catch(() => {});
    return job;
  }

  function classifyLater(key, src) {
    if (S.nsfw[key]) return;
    S.nsfw[key] = 'checking';
    classify(src).then((v) => {
      S.nsfw[key] = v;
      S.msgNodes.clear();
      scheduleRender(false);
      queueRerender();
      // An open profile card waiting on this picture: redraw it.
      if (shownProfile && $('modal').classList.contains('visible') && $('modalCard').querySelector('.profile-card')) showProfile(shownProfile);
    });
  }

  // ---------- Image viewer ----------

  let lbList = [], lbIndex = 0;
  function openLightbox(img) {
    lbList = [...$('messages').querySelectorAll('img.msg-image, img.sticker-img')];
    lbIndex = Math.max(0, lbList.indexOf(img));
    showLightbox();
    $('lightbox').classList.add('visible');
    $('lbClose').focus();
  }
  function showLightbox() {
    const img = lbList[lbIndex];
    if (!img) return closeLightbox();
    const lb = $('lightboxImg');
    lb.src = img.src; lb.alt = img.alt;
    lb.classList.remove('zoomed');
    const ext = /^data:image\/(\w+)/.exec(img.src);
    $('lbDownload').href = img.src;
    $('lbDownload').download = 'baloneys-chat.' + (ext ? ext[1].replace('jpeg', 'jpg') : 'gif');
    $('lbPrev').disabled = lbIndex <= 0;
    $('lbNext').disabled = lbIndex >= lbList.length - 1;
  }
  function closeLightbox() { $('lightbox').classList.remove('visible'); $('lightboxImg').removeAttribute('src'); }
  $('lbClose').addEventListener('click', closeLightbox);
  $('lbPrev').addEventListener('click', () => { if (lbIndex > 0) { lbIndex--; showLightbox(); } });
  $('lbNext').addEventListener('click', () => { if (lbIndex < lbList.length - 1) { lbIndex++; showLightbox(); } });
  $('lbZoom').addEventListener('click', () => $('lightboxImg').classList.toggle('zoomed'));
  $('lightboxImg').addEventListener('click', () => $('lightboxImg').classList.toggle('zoomed'));
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if ($('lightbox').classList.contains('visible')) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') $('lbPrev').click();
      else if (e.key === 'ArrowRight') $('lbNext').click();
      return;
    }
    if (e.key === 'Escape' && $('modal').classList.contains('visible')) closeModal();
  });


  // ---------- Voice (peer-to-peer WebRTC audio) ----------
  // DMs: a direct call between two browsers. Rooms: everyone in voice calls everyone else (a mesh);
  // the room host only keeps the list of who's in voice.

  let voice = null;
  const roomVoice = {};     // code -> { id: { muted } } as announced by the host
  const rings = {};         // id -> incoming call waiting for an answer

  function getMic() {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  }

  async function voiceNotice() {
    let seen = false;
    try { seen = localStorage.getItem('chat.voiceNotice') === '1'; } catch (e) { /* ignore */ }
    if (seen) return true;
    const ok = await confirmBox('Voice chat', 'Voice connects you directly to the other people in the call, so they can see your IP address. Only call people you trust.', 'Continue');
    if (ok) try { localStorage.setItem('chat.voiceNotice', '1'); } catch (e) { /* ignore */ }
    return ok;
  }

  function newVoice(scope, id, stream) {
    return { scope, id, stream, calls: new Map(), muted: false, deafened: false, meters: {}, speaking: {}, startedAt: Date.now() };
  }

  $('voiceBtn').addEventListener('click', () => {
    const c = S.conv;
    if (!c) return;
    if (voice && voice.scope === c.type && voice.id === c.id) leaveVoice();
    else if (c.type === 'dm') startCall(c.id);
    else joinRoomVoice(c.id);
  });

  async function startCall(id) {
    if (!isContact(id) || isBlocked(id)) { toast('You can only call contacts.'); return; }
    if (!S.online[id]) { toast(nameOf(id) + ' is offline.'); return; }
    if (!window.RTCPeerConnection || !navigator.mediaDevices) { toast("This browser doesn't support voice chat."); return; }
    if (!(await voiceNotice())) return;
    if (voice) leaveVoice();
    let stream;
    try { stream = await getMic(); } catch (e) { toast('Allow microphone access to call.'); return; }
    voice = newVoice('dm', id, stream);
    const call = net.peer.call(PREFIX + id, stream, { metadata: { kind: 'dm' } });
    attachCall(id, call);
    voice.ringTimer = setTimeout(() => { if (voice && voice.scope === 'dm' && voice.id === id && !voice.connectedOnce) endCall('No answer.'); }, 45000);
    startMeters();
    queueRerender();
  }

  async function joinRoomVoice(code) {
    const r = S.rooms[code];
    if (!r || r.status !== 'connected') { toast('Connect to the room first.'); return; }
    if (S.roomMuted[S.me.id]) { toast("You're muted in this room."); return; }
    if (Object.keys(roomVoice[code] || {}).length >= MAX_VOICE) { toast('Voice is full (' + MAX_VOICE + ' people max).'); return; }
    if (!window.RTCPeerConnection || !navigator.mediaDevices) { toast("This browser doesn't support voice chat."); return; }
    if (!(await voiceNotice())) return;
    if (voice) leaveVoice();
    let stream;
    try { stream = await getMic(); } catch (e) { toast('Allow microphone access to join voice.'); return; }
    voice = newVoice('room', code, stream);
    roomSend(code, { k: 'voice', on: true, muted: false });
    startMeters();
    queueRerender();
  }

  function onIncomingCall(call) {
    const id = (call.peer || '').slice(PREFIX.length);
    const meta = call.metadata || {};
    if (!id || isBlocked(id)) { call.close(); return; }
    if (meta.kind === 'room') {
      const code = String(meta.code || '');
      if (voice && voice.scope === 'room' && voice.id === code && roomVoice[code] && roomVoice[code][id] && !voice.calls.has(id)) {
        call.answer(voice.stream);
        attachCall(id, call);
      } else call.close();
      return;
    }
    if (!isContact(id)) { call.close(); return; }
    if (voice && voice.scope === 'dm' && voice.id === id && !voice.connectedOnce) {
      // We called each other at the same moment: keep the call from the smaller id.
      if (S.me.id < id) { call.close(); return; }
      closeCall(id, true);
      call.answer(voice.stream);
      attachCall(id, call);
      return;
    }
    if (voice) { call.close(); sendTo(id, { t: 'hangup' }); return; }   // busy
    rings[id] = call;
    call.on('close', () => dismissRing(id));
    ping(); setTimeout(ping, 400);
    if (document.hidden) notify(nameOf(id), 'is calling you', '#dm/' + id);
    openModal('Incoming call', el('div', { class: 'call-box' }, avatar(id, 'xl', true), el('p', { class: 'profile-name', text: nameOf(id) }), el('p', { class: 'modal-text', text: 'is calling you.' })), [
      btn('Decline', 'btn-ghost', () => { closeModal(); declineRing(id); }),
      btn('Answer', 'btn-primary', () => { if (rings[id]) rings[id].answered = true; closeModal(); answerRing(id); })
    ], { onClose: () => { if (rings[id] && !rings[id].answered) declineRing(id); } });
    rings[id].modal = true;
  }

  function dismissRing(id) {
    const r = rings[id];
    if (!r) return;
    delete rings[id];
    if (r.modal && $('modal').classList.contains('visible') && $('modalCard').textContent.includes('Incoming call')) closeModal();
  }

  function declineRing(id) {
    const call = rings[id];
    delete rings[id];
    if (call) { try { call.close(); } catch (e) { /* gone */ } }
    sendTo(id, { t: 'hangup' });
  }

  async function answerRing(id) {
    const call = rings[id];
    if (!call) return;
    call.answered = true;
    delete rings[id];
    if (!(await voiceNotice())) { call.close(); sendTo(id, { t: 'hangup' }); return; }
    let stream;
    try { stream = await getMic(); } catch (e) { toast('Allow microphone access to answer.'); call.close(); sendTo(id, { t: 'hangup' }); return; }
    if (voice) leaveVoice();
    voice = newVoice('dm', id, stream);
    call.answer(stream);
    attachCall(id, call);
    startMeters();
    openDm(id);
    queueRerender();
  }

  function attachCall(id, call) {
    const v = voice;
    const entry = { call, audio: null, state: 'connecting' };
    v.calls.set(id, entry);
    call.on('stream', (remote) => {
      if (voice !== v || entry.audio) return;
      const a = el('audio', { autoplay: true });
      a.srcObject = remote;
      a.muted = v.deafened;
      $('voiceAudio').append(a);
      a.play().catch(() => toast('Tap anywhere to hear voice.'));
      entry.audio = a;
      entry.state = 'connected';
      v.connectedOnce = true;
      clearTimeout(v.ringTimer);
      watchSpeaking(v, id, remote);
      queueRerender();
    });
    call.on('close', () => {
      if (voice !== v) return;
      closeCall(id, true);
      if (v.scope === 'dm') endCall(v.connectedOnce ? 'Call ended.' : nameOf(id) + " didn't answer.");
    });
    call.on('error', (e) => console.warn('call error', e && e.type));
    const watchPc = () => {
      const pc = call.peerConnection;
      if (!pc) return setTimeout(watchPc, 200);
      pc.addEventListener('connectionstatechange', () => {
        entry.state = pc.connectionState;
        if (pc.connectionState === 'failed' && voice === v) { closeCall(id); if (v.scope === 'dm') endCall("Couldn't connect the call."); }
        queueRerender();
      });
    };
    watchPc();
  }

  function closeCall(id, already) {
    const v = voice;
    const entry = v && v.calls.get(id);
    if (!entry) return;
    v.calls.delete(id);
    if (!already) { try { entry.call.close(); } catch (e) { /* gone */ } }
    if (entry.audio) { entry.audio.srcObject = null; entry.audio.remove(); }
    if (v.meters[id]) { closeCtx(v.meters[id].ctx); delete v.meters[id]; }
    queueRerender();
  }

  function onRoomVoice(code, map) {
    const clean = {};
    for (const id of Object.keys(map).slice(0, MAX_VOICE + 2)) clean[id] = { muted: !!(map[id] && map[id].muted) };
    roomVoice[code] = clean;
    const v = voice;
    if (v && v.scope === 'room' && v.id === code) {
      if (clean[S.me.id]) v.acked = true;
      else if (v.acked) { leaveVoice(true); toast('You were removed from voice.'); return; }
      for (const id of [...v.calls.keys()]) if (!clean[id]) closeCall(id);
      for (const id in clean) {
        if (id === S.me.id || isBlocked(id) || v.calls.has(id)) continue;
        if (S.me.id < id && v.acked) attachCall(id, net.peer.call(PREFIX + id, v.stream, { metadata: { kind: 'room', code } }));
      }
    }
    queueRerender();
  }

  function endCall(reason) {
    if (!voice) return;
    leaveVoice(true);
    if (reason) toast(reason);
  }

  function leaveVoice(quiet) {
    const v = voice;
    if (!v) return;
    voice = null;
    clearTimeout(v.ringTimer);
    for (const id of [...v.calls.keys()]) {
      const e = v.calls.get(id);
      try { e.call.close(); } catch (err) { /* gone */ }
      if (e.audio) { e.audio.srcObject = null; e.audio.remove(); }
    }
    Object.values(v.meters).forEach((m) => { closeCtx(m.ctx); });
    v.stream.getTracks().forEach((t) => t.stop());
    if (v.scope === 'dm' && !quiet) sendTo(v.id, { t: 'hangup' });
    if (v.scope === 'room') roomSend(v.id, { k: 'voice', on: false });
    queueRerender();
  }

  function setMuted(on) {
    if (!voice) return;
    voice.muted = on;
    voice.stream.getAudioTracks().forEach((t) => { t.enabled = !on; });
    if (voice.scope === 'room') roomSend(voice.id, { k: 'voice', on: true, muted: on });
    queueRerender();
  }

  function setDeafened(on) {
    if (!voice) return;
    voice.deafened = on;
    voice.calls.forEach((e) => { if (e.audio) e.audio.muted = on; });
    if (on && !voice.muted) setMuted(true); else queueRerender();
  }

  let meterTimer = null;
  function startMeters() {
    if (voice) watchSpeaking(voice, S.me.id, voice.stream);
    clearInterval(meterTimer);
    meterTimer = setInterval(updateSpeaking, 150);
  }

  function closeCtx(ctx) { if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {}); }

  function watchSpeaking(v, id, stream) {
    if (v.meters[id]) closeCtx(v.meters[id].ctx);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      v.meters[id] = { ctx, an, buf: new Uint8Array(an.fftSize) };
    } catch (e) { /* no meter */ }
  }

  function updateSpeaking() {
    const v = voice;
    if (!v) { clearInterval(meterTimer); return; }
    let changed = false;
    for (const id in v.meters) {
      const m = v.meters[id];
      m.an.getByteTimeDomainData(m.buf);
      let sum = 0;
      for (let i = 0; i < m.buf.length; i++) { const x = (m.buf[i] - 128) / 128; sum += x * x; }
      const muted = id === S.me.id ? v.muted : v.scope === 'room' && roomVoice[v.id] && roomVoice[v.id][id] && roomVoice[v.id][id].muted;
      const on = !muted && Math.sqrt(sum / m.buf.length) > 0.04;
      if (on !== !!v.speaking[id]) { v.speaking[id] = on; changed = true; }
    }
    if (changed) document.querySelectorAll('[data-voice-uid]').forEach((n) => n.classList.toggle('speaking', !!v.speaking[n.dataset.voiceUid]));
  }

  function voiceControls() {
    return el('div', { class: 'voice-controls' },
      el('button', { class: 'icon-btn' + (voice.muted ? ' active danger' : ''), type: 'button', title: voice.muted ? 'Unmute' : 'Mute', 'aria-label': voice.muted ? 'Unmute' : 'Mute', onclick: () => setMuted(!voice.muted) }, icon(voice.muted ? 'mic-off' : 'mic')),
      el('button', { class: 'icon-btn' + (voice.deafened ? ' active danger' : ''), type: 'button', title: voice.deafened ? 'Undeafen' : 'Deafen', 'aria-label': voice.deafened ? 'Undeafen' : 'Deafen', onclick: () => setDeafened(!voice.deafened) }, icon('headphones')),
      el('button', { class: 'icon-btn hangup', type: 'button', title: 'Leave voice', 'aria-label': 'Leave voice', onclick: () => leaveVoice() }, icon('hangup')));
  }

  function voiceParticipants(scope, id) {
    if (scope === 'dm') {
      if (!voice || voice.scope !== 'dm' || voice.id !== id) return {};
      const out = { [S.me.id]: { muted: voice.muted } };
      if (voice.connectedOnce && voice.calls.has(id)) out[id] = {};
      return out;
    }
    return roomVoice[id] || {};
  }

  function renderVoice() {
    if (!S.me) return;
    const dock = $('voiceDock');
    if (voice) {
      const others = [...voice.calls.values()];
      const connected = others.filter((e) => e.state === 'connected').length;
      const expected = voice.scope === 'room' ? Object.keys(roomVoice[voice.id] || {}).filter((u) => u !== S.me.id).length : 1;
      dock.replaceChildren(
        el('button', { class: 'voice-dock-info', type: 'button', onclick: () => (voice.scope === 'dm' ? openDm(voice.id) : openRoom(voice.id)) },
          el('span', { class: 'voice-dock-state' + (expected && connected < expected ? ' connecting' : ''), text: voice.scope === 'dm' && !voice.connectedOnce ? 'Calling…' : !expected ? 'Waiting for others…' : connected < expected ? 'Connecting…' : 'Voice connected' }),
          el('span', { class: 'voice-dock-where', text: voice.scope === 'dm' ? nameOf(voice.id) : roomName(voice.id) })),
        voiceControls());
      dock.classList.remove('hidden');
    } else dock.classList.add('hidden');

    const bar = $('voiceBar');
    const c = S.conv;
    if (!c) { bar.classList.add('hidden'); return; }
    const parts = voiceParticipants(c.type, c.id);
    const inThis = voice && voice.scope === c.type && voice.id === c.id;
    const ids = Object.keys(parts).filter((u) => !isBlocked(u));
    if (!ids.length && !inThis) { bar.classList.add('hidden'); return; }
    bar.replaceChildren(
      el('span', { class: 'voice-bar-title', text: '🔊 Voice' }),
      el('div', { class: 'voice-people' }, ids.map((id) => {
        const entry = inThis && voice.calls.get(id);
        const state = id === S.me.id || !inThis ? '' : entry ? entry.state : 'connecting';
        return el('div', { class: 'voice-person' + (inThis && voice.speaking[id] ? ' speaking' : ''), 'data-voice-uid': id, title: nameOf(id) + (state && state !== 'connected' ? ' (' + state + ')' : '') },
          avatar(id, 'sm'), el('span', { text: nameOf(id) }), parts[id] && parts[id].muted ? icon('mic-off') : null, state && state !== 'connected' ? el('span', { class: 'voice-state', text: '…' }) : null);
      })),
      inThis ? voiceControls() : c.type === 'room' ? btn('Join voice', 'btn-sm btn-primary', () => joinRoomVoice(c.id)) : '');
    bar.classList.remove('hidden');
  }

  window.addEventListener('pagehide', () => { if (voice) leaveVoice(); });
  document.addEventListener('click', () => {
    if (voice) voice.calls.forEach((e) => { if (e.audio && e.audio.paused) e.audio.play().catch(() => {}); });
  });

  // ---------- Settings ----------

  $('settingsBtn').addEventListener('click', () => openSettings());

  function broadcastProfile() {
    for (const id of net.links.keys()) sendTo(id, { t: 'profile', profile: myProfile() });
    for (const code in S.rooms) roomSend(code, { k: 'profile', profile: myProfile() });
  }

  async function saveMe(patch) {
    Object.assign(S.me, patch);
    await DB.set('identity', S.me);
    S.msgNodes.clear();
    broadcastProfile();
    queueRerender();
  }

  function openSettings() { openStudio('profile'); }

  const toggleRow = (label, hint, checked, onchange) => el('label', { class: 'toggle-row' },
    el('span', null, label, hint ? el('small', { text: hint }) : null),
    el('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked, e.target) }));
  const svSec = (title, ...kids) => el('section', { class: 'studio-sec', id: 'sv-' + slug(title) }, el('h3', { class: 'studio-h', text: title }), ...kids);

  function sectionNotifications() {
    return el('div', null,
      svSec('Alerts',
        toggleRow('Sounds', 'A soft ping for new messages and calls.', S.settings.sounds, (on) => { S.settings.sounds = on; saveSettings(); }),
        toggleRow('Desktop alerts', 'While chat is open in a background tab.', S.settings.desktop, async (on) => {
          S.settings.desktop = on; saveSettings();
          if (on && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
        })),
      el('p', { class: 'field-hint', text: 'Chat is peer-to-peer, so there are no push notifications: nothing can reach you while chat is closed.' }));
  }

  function sectionEmoji() {
    const grid = (kind) => {
      const items = Object.values(S.customs).filter((it) => it.kind === kind);
      return items.length ? el('div', { class: 'customs-strip' }, items.slice(0, 18).map((it) => el('img', { src: it.data, alt: it.name, title: it.name })))
        : el('p', { class: 'field-hint', text: kind === 'emoji' ? 'No custom emoji yet.' : 'No custom stickers yet.' });
    };
    return el('div', null,
      svSec('Custom emoji', grid('emoji'), el('div', { class: 'row' }, btn('Manage emoji', 'btn-sm btn-primary', () => openCustomsManager('emoji')))),
      svSec('Custom stickers', grid('sticker'), el('div', { class: 'row' }, btn('Manage stickers', 'btn-sm btn-primary', () => openCustomsManager('sticker')))));
  }

  function sectionBlocked() {
    const ids = Object.keys(S.blocks);
    return el('div', null,
      svSec('Blocked people', ids.length ? el('div', null, ids.map((id) => el('div', { class: 'member' }, avatar(id, 'sm'), nameEl(id, 'member-name'),
        btn('Unblock', 'btn-sm btn-ghost', async () => { await setBlocked(id, false); drawStudio(); }))))
        : el('p', { class: 'field-hint', text: "You haven't blocked anyone." })),
      svSec('Privacy', el('p', { class: 'field-hint', text: 'Messages go directly between browsers and are saved only on your devices. People you connect to (contacts, room hosts and people in voice with you) can see your IP address.' })));
  }

  function sectionIdentity() {
    return el('div', null,
      svSec('Your friend code', el('div', { class: 'row' }, el('span', { class: 'big-code small', text: fmtCode(S.me.id) }), btn('Copy add-me link', 'btn-sm btn-outline', copyMyCode))),
      svSec('Backup',
        el('p', { class: 'field-hint', text: 'Your identity lives only in this browser. Back it up to keep it if you clear your browser data, or to use chat on another device. Keep the file private: anyone with it can be you.' }),
        el('div', { class: 'row' }, btn('Back up', 'btn-sm btn-primary', exportBackup), btn('Restore a backup', 'btn-sm btn-outline', () => $('importInput').click()), btn('Formatting help', 'btn-sm btn-ghost', showHelp))),
      svSec('Danger zone', el('div', { class: 'row' }, btn('Delete everything', 'btn-sm btn-accent', resetEverything))));
  }

  async function resetEverything() {
    if (!(await confirmBox('Delete everything?', 'This deletes your identity, contacts, rooms and message history from this browser. Unless you have a backup, you can’t get your friend code back.', 'Delete everything', true))) return;
    if (voice) leaveVoice();
    try { if (net.peer) net.peer.destroy(); } catch (e) { /* ignore */ }
    Object.values(hosts).forEach((H) => { try { H.peer.destroy(); } catch (e) { /* ignore */ } });
    if (DB.db) DB.db.close();
    indexedDB.deleteDatabase('baloneys-chat');
    try { Object.keys(localStorage).filter((k) => k.startsWith('chat.')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    setTimeout(() => location.replace(location.pathname), 300);
  }

  function openCustomsManager(kind) {
    const isEmoji = kind === 'emoji';
    const fileIn = el('input', { type: 'file', accept: 'image/png,image/gif,image/webp,image/jpeg', hidden: true });
    const grid = el('div', { class: 'customs-grid' });
    const draw = () => {
      const mine = Object.entries(S.customs).filter(([, it]) => it.kind === kind);
      grid.replaceChildren(...(mine.length ? mine.map(([id, it]) => el('div', { class: 'custom-item' },
        el('img', { src: it.data, alt: it.name }),
        el('span', { text: (isEmoji ? ':' + it.name + ':' : it.name) }),
        btn('Delete', 'btn-sm btn-ghost', () => { delete S.customs[id]; persist('customs'); draw(); })))
        : [el('p', { class: 'side-empty', text: isEmoji ? 'No custom emoji yet.' : 'No custom stickers yet.' })]));
    };
    fileIn.addEventListener('change', async () => {
      const files = [...fileIn.files]; fileIn.value = '';
      for (const f of files) {
        try {
          const base = (f.name || 'custom').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32);
          const name = await promptBox('Name it', isEmoji ? 'Emoji name (used as :name:)' : 'Sticker name', {
            max: 32, value: base.length >= 2 ? base : '', ok: 'Add',
            check: (v) => !/^[A-Za-z0-9_]{2,32}$/.test(v) ? '2 to 32 letters, numbers or underscores.'
              : isEmoji && Object.values(S.customs).some((it) => it.kind === 'emoji' && it.name === v) ? 'You already have an emoji with that name.' : null
          });
          if (!name) continue;
          const raw = await readAsDataURL(f);
          const limit = isEmoji ? 100000 : 300000;
          const data = f.type === 'image/gif' && raw.length < limit ? raw : await compress(raw, isEmoji ? 96 : 320, limit);
          if ((await classify(data)) === 'flagged') { toast("That image can't be used."); continue; }
          S.customs[randomId(10)] = { kind, name, data };
          persist('customs');
          refreshOpenPickers();
        } catch (err) { fail(err, err.message); }
      }
      openCustomsManager(kind);
    });
    openModal(isEmoji ? 'My emoji' : 'My stickers', el('div', null,
      el('p', { class: 'modal-text', text: isEmoji ? 'Upload small images to use as :name: emoji. The image travels with each message that uses it.' : 'Upload images to send as stickers from the sticker picker.' }),
      grid, fileIn),
    [btn('Close', 'btn-ghost', closeModal), btn(isEmoji ? 'Add emoji' : 'Add sticker', 'btn-primary', () => fileIn.click())]);
    draw();
  }

  // ---------- Appearance studio ----------
  // Your look for /chat only: background, panel transparency, text and accent colour. Saved on
  // this device. Profile settings (name style, banner, avatar) are shared with the people you talk to.

  const THEMES = [
    { id: 'baloneys', name: 'Baloneys', stops: ['#12001f', '#3b0764', '#e60065'], angle: 150 },
    { id: 'midnight', name: 'Midnight', stops: ['#050510', '#111133', '#1d1d5c'], angle: 180 },
    { id: 'aurora', name: 'Aurora', stops: ['#021b1a', '#0f766e', '#7c3aed'], angle: 135 },
    { id: 'sunset', name: 'Sunset', stops: ['#1a0612', '#9d174d', '#f59e0b'], angle: 160 },
    { id: 'ocean', name: 'Ocean', stops: ['#020617', '#0c4a6e', '#22d3ee'], angle: 200 },
    { id: 'neon', name: 'Neon', stops: ['#0a0014', '#ff00c8', '#00e5ff'], angle: 120 },
    { id: 'forest', name: 'Forest', stops: ['#030d06', '#14532d', '#84cc16'], angle: 170 },
    { id: 'candy', name: 'Candy', stops: ['#2a0a2e', '#f472b6', '#a5b4fc'], angle: 135 },
    { id: 'straya', name: 'Straya', stops: ['#06140a', '#15803d', '#facc15'], angle: 145 },
    { id: 'mono', name: 'Mono', stops: ['#050505', '#1f1f1f', '#3f3f46'], angle: 180 }
  ];
  const ACCENTS = ['#9d00ff', '#e60065', '#7c3aed', '#2563eb', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#a3a3a3'];
  const NAME_GRADS = [['#9d00ff', '#e60065'], ['#22d3ee', '#a78bfa'], ['#f59e0b', '#ef4444'], ['#34d399', '#3b82f6'], ['#f472b6', '#facc15'], ['#ffffff', '#a1a1aa']];
  const LOOK_DEFAULT = {
    bg: 'default', theme: 'baloneys', grad: { stops: ['#12001f', '#3b0764', '#e60065'], angle: 150, three: true },
    solid: '#0b0b12', imgBlur: 0, imgDim: 35, imgFit: 'cover',
    panel: 78, glassBlur: 16, text: 'default', textColor: '#ece6ff', accent: '#9d00ff', size: 15
  };

  let look = loadLook();
  let lookImage = null;
  function loadLook() {
    try { return Object.assign({}, LOOK_DEFAULT, JSON.parse(localStorage.getItem('chat.look') || '{}')); } catch (e) { return Object.assign({}, LOOK_DEFAULT); }
  }
  function saveLook() { try { localStorage.setItem('chat.look', JSON.stringify(look)); } catch (e) { /* private mode */ } }

  const gradCss = (g) => 'linear-gradient(' + g.angle + 'deg, ' + (g.three ? g.stops : g.stops.slice(0, 2)).join(', ') + ')';

  function applyLook() {
    const body = document.body;
    const bg = $('chatBg');
    const custom = look.bg !== 'default';
    body.classList.toggle('themed', custom || look.panel < 100);
    const glass = look.glassBlur == null ? 16 : look.glassBlur;
    body.classList.toggle('glass', glass > 0 && look.text !== 'blend');
    body.style.setProperty('--glass-blur', glass + 'px');
    bg.className = 'chat-bg' + (custom ? ' on' : '');
    bg.style.background = '';
    bg.style.setProperty('--img', 'none');
    if (look.bg === 'gradient') bg.style.background = gradCss(look.grad);
    else if (look.bg === 'solid') bg.style.background = look.solid;
    else if (look.bg === 'image' && lookImage) {
      bg.style.background = '#000';
      bg.style.setProperty('--img', 'url("' + lookImage + '")');
      bg.style.setProperty('--img-fit', look.imgFit === 'tile' ? 'auto' : look.imgFit);
      bg.style.setProperty('--img-repeat', look.imgFit === 'tile' ? 'repeat' : 'no-repeat');
      bg.style.setProperty('--img-blur', look.imgBlur + 'px');
      bg.style.setProperty('--img-dim', String(look.imgDim / 100));
      bg.classList.add('image');
    }
    body.style.setProperty('--panel-a', String(Math.max(0.08, look.panel / 100)));
    body.style.setProperty('--color-primary', look.accent);
    body.style.setProperty('--color-accent', look.accent === '#9d00ff' ? '#e60065' : look.accent);
    body.style.setProperty('--msg-size', look.size + 'px');
    body.style.setProperty('--msg-color', look.text === 'custom' ? look.textColor : '#ece6ff');
    body.classList.toggle('blend-text', look.text === 'blend');
    S.msgNodes.clear();
    if (S.conv) renderMessages(false);
  }

  DB.get('lookImage').then((img) => { lookImage = img || null; applyLook(); }).catch(() => applyLook());

  // Colour input with a hex label.
  function colorInput(value, onchange) {
    const inp = el('input', { type: 'color', class: 'color-pick', value });
    const label = el('span', { class: 'color-hex', text: value.toUpperCase() });
    inp.addEventListener('input', () => { label.textContent = inp.value.toUpperCase(); onchange(inp.value); });
    return el('label', { class: 'color-field' }, inp, label);
  }

  function slider(label, min, max, value, unit, onchange) {
    const out = el('span', { class: 'slider-val', text: value + unit });
    const inp = el('input', { type: 'range', min, max, value, class: 'slider' });
    inp.addEventListener('input', () => { out.textContent = inp.value + unit; onchange(Number(inp.value)); });
    return el('div', { class: 'slider-row' }, el('div', { class: 'slider-head' }, el('span', { text: label }), out), inp);
  }

  function choice(options, current, onpick) {
    const wrap = el('div', { class: 'seg' });
    const draw = (cur) => wrap.replaceChildren(...options.map(([v, label]) => el('button', { type: 'button', class: 'seg-btn' + (v === cur ? ' on' : ''), text: label, onclick: () => { onpick(v); draw(v); } })));
    draw(current);
    return wrap;
  }

  // One long, scrolling settings page. The left column is a set of shortcuts that follow your
  // scroll position; Appearance shows its own sub-sections while you're in it.
  const SV_PAGES = [
    { id: 'profile', group: 'User', label: 'My profile', build: () => studioProfile() },
    { id: 'identity', group: 'User', label: 'Identity & backup', build: () => sectionIdentity() },
    { id: 'appearance', group: 'Chat', label: 'Appearance', build: () => el('div', null, studioTheme(), studioText()),
      subs: [['presets', 'Themes'], ['custom-gradient', 'Gradient'], ['solid-colour', 'Solid colour'], ['your-own-image', 'Image'], ['glass-panels', 'Glass & panels'], ['message-text', 'Text colour'], ['accent-colour', 'Accent'], ['text-size', 'Text size']] },
    { id: 'notifications', group: 'Chat', label: 'Notifications', build: () => sectionNotifications() },
    { id: 'emoji', group: 'Chat', label: 'Emoji & stickers', build: () => sectionEmoji() },
    { id: 'privacy', group: 'Chat', label: 'Privacy & blocked', build: () => sectionBlocked() }
  ];
  const TAB_ALIAS = { theme: 'appearance', text: 'sv-message-text' };
  const slug = (t) => t.toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  let svActive = { page: 'profile', sub: null };
  function openStudio(tab) {
    closeModal();
    const view = $('studio');
    const wasOpen = view.classList.contains('open');
    view.classList.add('open');
    view.setAttribute('aria-hidden', 'false');
    if (!wasOpen || !view.querySelector('.studio-body')) drawStudio();
    const target = TAB_ALIAS[tab] || tab || 'profile';
    requestAnimationFrame(() => svJump(target.startsWith('sv-') ? target : 'svp-' + target, false));
  }
  function closeStudio() {
    const view = $('studio');
    view.classList.remove('open');
    view.setAttribute('aria-hidden', 'true');
    profileDraft = null;
  }
  $('studioBtn').addEventListener('click', () => ($('studio').classList.contains('open') ? closeStudio() : openStudio('appearance')));
  $('studio').addEventListener('mousedown', (e) => { if (e.target === $('studio')) closeStudio(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('studio').classList.contains('open') && !$('modal').classList.contains('visible')) closeStudio(); });

  function svJump(id, smooth) {
    const body = $('studio').querySelector('.studio-body');
    const target = body && body.querySelector('#' + CSS.escape(id));
    if (!target) return;
    body.scrollTo({ top: target.offsetTop - 12, behavior: smooth ? 'smooth' : 'instant' });
    svSpy();
  }

  // Which page (and Appearance sub-section) is at the top of the scroll area?
  function svSpy() {
    const body = $('studio').querySelector('.studio-body');
    if (!body) return;
    const y = body.scrollTop + 60;
    let page = SV_PAGES[0].id, sub = null;
    for (const p of SV_PAGES) { const n = body.querySelector('#svp-' + p.id); if (n && n.offsetTop <= y) page = p.id; }
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) page = SV_PAGES[SV_PAGES.length - 1].id;
    const ap = SV_PAGES.find((p) => p.id === 'appearance');
    if (page === 'appearance') for (const [id] of ap.subs) { const n = body.querySelector('#sv-' + id); if (n && n.offsetTop <= y + 40) sub = id; }
    if (page === svActive.page && sub === svActive.sub) return;
    svActive = { page, sub };
    $('studio').querySelectorAll('.sv-link').forEach((b) => {
      const on = b.dataset.page === page && (!b.dataset.sub || b.dataset.sub === sub);
      b.classList.toggle('on', b.dataset.sub ? b.dataset.sub === sub : b.dataset.page === page);
      if (!b.dataset.sub) b.setAttribute('aria-current', on ? 'true' : 'false');
    });
    $('studio').querySelectorAll('.sv-subs').forEach((g) => g.classList.toggle('open', g.dataset.page === page));
    const title = $('studio').querySelector('.studio-title');
    if (title) title.textContent = SV_PAGES.find((p) => p.id === page).label;
  }

  function profileDirty() {
    if (!profileDraft) return false;
    const m = S.me, d = profileDraft;
    return ['name', 'color', 'bio', 'avatar', 'banner'].some((k) => (d[k] || '') !== (m[k] || '')) || JSON.stringify(d.nameGrad || null) !== JSON.stringify(m.nameGrad || null) || JSON.stringify(d.bannerGrad || null) !== JSON.stringify(m.bannerGrad || null);
  }

  function updateUnsaved() {
    const bar = $('studio').querySelector('.sv-unsaved');
    if (bar) bar.classList.toggle('show', profileDirty());
  }

  function drawStudio() {
    const old = $('studio').querySelector('.studio-body');
    const scrollTop = old ? old.scrollTop : 0;
    const groups = [...new Set(SV_PAGES.map((p) => p.group))];
    const nav = el('nav', { class: 'sv-nav', 'aria-label': 'Settings sections' },
      el('div', { class: 'sv-me' }, avatar(S.me.id, 'sm', true), el('div', { class: 'sv-me-text' }, nameEl(S.me.id), el('small', { text: fmtCode(S.me.id) }))),
      groups.map((g) => el('div', { class: 'sv-group' },
        el('p', { class: 'sv-group-title', text: g }),
        SV_PAGES.filter((p) => p.group === g).map((p) => [
          el('button', { type: 'button', class: 'sv-link' + (svActive.page === p.id ? ' on' : ''), 'data-page': p.id, text: p.label, onclick: () => svJump('svp-' + p.id, true) }),
          p.subs ? el('div', { class: 'sv-subs' + (svActive.page === p.id ? ' open' : ''), 'data-page': p.id }, p.subs.map(([id, label]) => el('button', {
            type: 'button', class: 'sv-link sub' + (svActive.sub === id ? ' on' : ''), 'data-page': p.id, 'data-sub': id, text: label, onclick: () => svJump('sv-' + id, true)
          }))) : null
        ]))));
    const pages = SV_PAGES.map((p) => el('div', { class: 'sv-page', id: 'svp-' + p.id },
      el('div', { class: 'sv-page-head' }, el('h2', { class: 'sv-page-title', text: p.label }),
        p.id === 'appearance' ? btn('Reset appearance', 'btn-sm btn-ghost', () => { look = Object.assign({}, LOOK_DEFAULT); saveLook(); applyLook(); drawStudio(); }) : null,
        p.id === 'appearance' ? el('span', { class: 'studio-note', text: 'Only you see this, and only on /chat.' }) : null,
        p.id === 'profile' ? el('span', { class: 'studio-note', text: 'People you chat with see this.' }) : null),
      p.build()));
    const body = el('div', { class: 'studio-body' }, pages, el('div', { class: 'sv-end' }));
    body.addEventListener('scroll', svSpy, { passive: true });
    const dirty = profileDirty();
    $('studio').replaceChildren(el('div', { class: 'sv-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
      nav,
      el('div', { class: 'sv-main' },
        el('div', { class: 'studio-head' },
          el('div', null, el('p', { class: 'studio-kicker', text: 'Settings' }), el('h2', { class: 'studio-title', text: SV_PAGES.find((p) => p.id === svActive.page).label })),
          el('button', { class: 'sv-close', type: 'button', 'aria-label': 'Close settings', onclick: closeStudio }, icon('close'), el('small', { text: 'ESC' }))),
        body,
        el('div', { class: 'sv-unsaved' + (dirty ? ' show' : '') },
          el('span', { text: 'Careful, you have unsaved profile changes!' }),
          el('div', { class: 'row' }, btn('Reset', 'btn-sm btn-ghost', () => { profileDraft = null; drawStudio(); }), btn('Save changes', 'btn-sm btn-primary', saveProfileDraft))))));
    body.scrollTop = scrollTop;
    svSpy();
  }

  function setLook(patch) { Object.assign(look, patch); saveLook(); applyLook(); }

  function studioTheme() {
    const sec = svSec;
    const presets = el('div', { class: 'theme-grid' },
      el('button', { type: 'button', class: 'theme-tile' + (look.bg === 'default' ? ' on' : ''), onclick: () => { setLook({ bg: 'default' }); drawStudio(); } },
        el('span', { class: 'theme-swatch def' }), el('span', { text: 'Classic' })),
      THEMES.map((t) => el('button', {
        type: 'button', class: 'theme-tile' + (look.bg === 'gradient' && look.theme === t.id ? ' on' : ''),
        onclick: () => { setLook({ bg: 'gradient', theme: t.id, grad: { stops: t.stops.slice(), angle: t.angle, three: true } }); drawStudio(); }
      }, el('span', { class: 'theme-swatch', style: { background: gradCss({ stops: t.stops, angle: t.angle, three: true }) } }), el('span', { text: t.name }))));

    const g = look.grad;
    const setGrad = (patch) => setLook({ bg: 'gradient', theme: 'custom', grad: Object.assign({}, look.grad, patch) });
    const gradBar = el('div', { class: 'grad-bar', style: { background: gradCss(g) } });
    const redrawBar = () => { gradBar.style.background = gradCss(look.grad); };
    const stops = el('div', { class: 'grad-stops' },
      [0, 1, 2].map((i) => (i < 2 || g.three) ? colorInput(g.stops[i] || '#000000', (v) => { const st = look.grad.stops.slice(); st[i] = v; setGrad({ stops: st }); redrawBar(); }) : null),
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: g.three ? '− Stop' : '+ Stop', onclick: () => { const st = look.grad.stops.slice(); if (st.length < 3) st.push('#e60065'); setGrad({ three: !look.grad.three, stops: st }); drawStudio(); } }));

    const fileIn = el('input', { type: 'file', accept: 'image/*', hidden: true });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      try {
        const raw = await readAsDataURL(f);
        const data = f.type === 'image/gif' && raw.length < 3000000 ? raw : await compress(raw, 2400, 2500000);
        await DB.set('lookImage', data);
        lookImage = data;
        setLook({ bg: 'image' });
        drawStudio();
      } catch (e) { fail(e, e.message); }
    });

    return el('div', null,
      sec('Presets', presets),
      sec('Custom gradient', gradBar, stops,
        slider('Angle', 0, 360, g.angle, '°', (v) => { setGrad({ angle: v }); redrawBar(); }),
        look.bg !== 'gradient' || look.theme !== 'custom' ? btn('Use custom gradient', 'btn-sm btn-outline', () => { setGrad({}); drawStudio(); }) : null),
      sec('Solid colour', el('div', { class: 'row' }, colorInput(look.solid, (v) => setLook({ bg: 'solid', solid: v })),
        look.bg !== 'solid' ? btn('Use solid colour', 'btn-sm btn-outline', () => { setLook({ bg: 'solid' }); drawStudio(); }) : null)),
      sec('Your own image',
        el('div', { class: 'img-pick' + (lookImage ? ' has' : ''), style: lookImage ? { backgroundImage: 'url("' + lookImage + '")' } : {}, onclick: () => fileIn.click() },
          el('span', { text: lookImage ? 'Change image' : 'Upload an image or GIF' })),
        fileIn,
        lookImage ? el('div', { class: 'row' },
          look.bg !== 'image' ? btn('Use image', 'btn-sm btn-primary', () => { setLook({ bg: 'image' }); drawStudio(); }) : null,
          btn('Remove image', 'btn-sm btn-ghost', async () => { await DB.del('lookImage'); lookImage = null; if (look.bg === 'image') setLook({ bg: 'default' }); else applyLook(); drawStudio(); })) : null,
        lookImage ? choice([['cover', 'Fill'], ['contain', 'Fit'], ['tile', 'Tile']], look.imgFit, (v) => setLook({ imgFit: v })) : null,
        lookImage ? slider('Background blur', 0, 40, look.imgBlur, 'px', (v) => setLook({ imgBlur: v })) : null,
        lookImage ? slider('Darken', 0, 90, look.imgDim, '%', (v) => setLook({ imgDim: v })) : null),
      sec('Glass & panels',
        slider('Panel opacity', 10, 100, look.panel, '%', (v) => setLook({ panel: v })),
        slider('Glass blur', 0, 30, look.glassBlur == null ? 16 : look.glassBlur, 'px', (v) => setLook({ glassBlur: v })),
        el('p', { class: 'field-hint', text: 'Glass blur frosts the sidebars and top bar over your background. Lower the panel opacity to see more of it.' })));
  }

  function studioText() {
    const sec = svSec;
    const modes = [['default', 'Default', 'Soft white, easy to read.'], ['custom', 'Custom colour', 'Pick any colour.'], ['blend', 'Blend', 'Inverts what’s behind it, then goes greyscale so it melts into your background.']];
    return el('div', null,
      sec('Message text',
        el('div', { class: 'mode-cards' }, modes.map(([v, label, hint]) => el('button', {
          type: 'button', class: 'mode-card' + (look.text === v ? ' on' : '') + (v === 'blend' ? ' blend-demo' : ''),
          onclick: () => { setLook({ text: v }); drawStudio(); }
        }, el('b', { text: label }), el('small', { text: hint })))),
        look.text === 'custom' ? colorInput(look.textColor, (v) => setLook({ textColor: v })) : null,
        look.text === 'blend' && look.glassBlur ? el('p', { class: 'field-hint', text: 'Frosted glass is paused while Blend is on, so the text can see your background.' }) : null),
      sec('Accent colour',
        el('div', { class: 'swatches' }, ACCENTS.map((c) => el('button', { type: 'button', class: 'swatch' + (c === look.accent ? ' selected' : ''), style: { background: c }, 'aria-label': 'Accent ' + c, onclick: () => { setLook({ accent: c }); drawStudio(); } }))),
        colorInput(look.accent, (v) => setLook({ accent: v }))),
      sec('Text size', slider('Messages', 13, 19, look.size, 'px', (v) => setLook({ size: v }))),
      sec('Preview', el('div', { class: 'studio-preview' }, previewMsg('Seany', 'this looks sick 🔥'), previewMsg(S.me.name, 'right?? **bold** and ||spoilers|| too'))));
  }

  function previewMsg(name, text) {
    const t = el('div', { class: 'msg-text' }, formatText(text));
    return el('div', { class: 'msg pv' }, el('div', { class: 'avatar', style: { background: '#9d00ff' }, text: name[0] }),
      el('div', { class: 'msg-body' }, el('div', { class: 'msg-head' }, el('span', { class: 'msg-user', text: name })), look.text === 'blend' ? blendText(t) : t));
  }

  // Blend mode: the text is drawn twice. The first copy inverts the background (difference);
  // the second, stacked exactly on top, drains the colour out (saturation), leaving grey.
  function blendText(node) {
    const a = el('div', { class: 'blend-a' }, ...node.childNodes);
    const b = a.cloneNode(true);
    b.className = 'blend-b';
    b.setAttribute('aria-hidden', 'true');
    node.replaceChildren(a, b);
    node.classList.add('blend');
    return node;
  }

  // --- profile tab ---

  let profileDraft = null;
  function draft() {
    if (!profileDraft) {
      const m = S.me;
      profileDraft = { name: m.name, color: m.color, bio: m.bio || '', avatar: m.avatar || null, banner: m.banner || null, nameGrad: m.nameGrad ? m.nameGrad.slice() : null, bannerGrad: m.bannerGrad ? m.bannerGrad.slice() : null };
    }
    return profileDraft;
  }

  async function saveProfileDraft() {
    const d = draft();
    const n = d.name.trim();
    if (!/^[\p{L}\p{N}_ .'-]{2,24}$/u.test(n)) { toast('Names are 2 to 24 letters or numbers.'); return; }
    await saveMe({ name: n, color: d.color, bio: d.bio.trim().slice(0, 190), avatar: d.avatar, banner: d.banner, nameGrad: d.nameGrad, bannerGrad: d.bannerGrad });
    profileDraft = null;
    toast('Profile saved.');
    drawStudio();
  }

  function studioProfile() {
    const d = draft();
    const sec = svSec;
    // Preview uses the draft as if it were saved.
    const saved = Object.assign({}, S.me);
    Object.assign(S.me, d);
    const card = profileCard(S.me.id);
    Object.assign(S.me, saved);
    const redraw = () => drawStudio();

    const pick = (maxSide, budget, square, apply) => {
      const inp = el('input', { type: 'file', accept: 'image/*', hidden: true });
      inp.addEventListener('change', async () => {
        const f = inp.files[0]; inp.value = '';
        if (!f) return;
        try {
          const raw = await readAsDataURL(f);
          const data = square ? await compress(raw, maxSide, budget, true) : await compressBanner(raw);
          if ((await classify(data)) === 'flagged') { toast("That picture can't be used."); return; }
          apply(data); redraw();
        } catch (e) { fail(e, e.message); }
      });
      return inp;
    };
    const avIn = pick(128, 60000, true, (v) => { d.avatar = v; });
    const bnIn = pick(0, 0, false, (v) => { d.banner = v; });
    const nameIn = el('input', { class: 'input', maxLength: 24, value: d.name, oninput: (e) => { d.name = e.target.value; updateUnsaved(); } });
    const bio = el('textarea', { class: 'input', rows: 3, maxLength: 190, value: d.bio, placeholder: 'A little about you', oninput: (e) => { d.bio = e.target.value; updateUnsaved(); } });

    return el('div', null,
      el('div', { class: 'studio-card' }, card),
      el('p', { class: 'field-hint', text: 'People you chat with see your profile. Save to share changes.' }),
      sec('Name', nameIn),
      sec('Name style',
        choice([['solid', 'Solid'], ['gradient', 'Gradient + glow']], d.nameGrad ? 'gradient' : 'solid', (v) => { d.nameGrad = v === 'gradient' ? (d.nameGrad || NAME_GRADS[0].slice()) : null; redraw(); }),
        d.nameGrad
          ? el('div', null,
              el('div', { class: 'grad-presets' }, NAME_GRADS.map((pair) => el('button', { type: 'button', class: 'grad-chip' + (pair[0] === d.nameGrad[0] && pair[1] === d.nameGrad[1] ? ' on' : ''), style: { background: 'linear-gradient(90deg, ' + pair[0] + ', ' + pair[1] + ')' }, 'aria-label': 'Gradient', onclick: () => { d.nameGrad = pair.slice(); redraw(); } }))),
              el('div', { class: 'row' }, colorInput(d.nameGrad[0], (v) => { d.nameGrad[0] = v; updateUnsaved(); }), colorInput(d.nameGrad[1], (v) => { d.nameGrad[1] = v; updateUnsaved(); }), btn('Apply', 'btn-sm btn-ghost', redraw)))
          : el('div', null,
              el('div', { class: 'swatches' }, COLORS.map((c) => el('button', { type: 'button', class: 'swatch' + (c === d.color ? ' selected' : ''), style: { background: c }, 'aria-label': 'Colour ' + c, onclick: () => { d.color = c; redraw(); } }))),
              el('div', { class: 'row' }, colorInput(d.color, (v) => { d.color = v; updateUnsaved(); }), btn('Apply', 'btn-sm btn-ghost', redraw)))),
      sec('Avatar', el('div', { class: 'row' }, btn(d.avatar ? 'Change avatar' : 'Upload avatar', 'btn-sm btn-outline', () => avIn.click()), d.avatar ? btn('Remove', 'btn-sm btn-ghost', () => { d.avatar = null; redraw(); }) : null, avIn)),
      sec('Banner',
        choice([['none', 'Default'], ['gradient', 'Gradient'], ['image', 'Image']], d.banner ? 'image' : d.bannerGrad ? 'gradient' : 'none', (v) => {
          if (v === 'none') { d.banner = null; d.bannerGrad = null; redraw(); }
          else if (v === 'gradient') { d.banner = null; d.bannerGrad = d.bannerGrad || ['#9d00ff', '#e60065']; redraw(); }
          else bnIn.click();
        }), bnIn,
        d.bannerGrad && !d.banner ? el('div', { class: 'row' }, colorInput(d.bannerGrad[0], (v) => { d.bannerGrad[0] = v; updateUnsaved(); }), colorInput(d.bannerGrad[1], (v) => { d.bannerGrad[1] = v; updateUnsaved(); }), btn('Apply', 'btn-sm btn-ghost', redraw)) : null,
        d.banner ? el('div', { class: 'row' }, btn('Change image', 'btn-sm btn-outline', () => bnIn.click()), btn('Remove', 'btn-sm btn-ghost', () => { d.banner = null; redraw(); })) : null),
      sec('About me', bio));
  }

  // Banners: 680x240, cropped from the middle.
  async function compressBanner(src) {
    const img = await loadImage(src);
    const W = 680, H = 240;
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const sw = W / scale, sh = H / scale;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.getContext('2d').drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
    for (const q of [0.8, 0.65, 0.5, 0.35]) {
      let out = cv.toDataURL('image/webp', q);
      if (!out.startsWith('data:image/webp')) out = cv.toDataURL('image/jpeg', q);
      if (out.length < 160000) return out;
    }
    throw new Error('That banner is too large.');
  }

  // ---------- Add contact ----------

  async function askAddContact() {
    const code = await promptBox('Add a contact', 'Their friend code or add-me link', {
      max: 200, ok: 'Send request', placeholder: 'ABCD-EFGH-JKLM-NPQR',
      check: (v) => { const id = parseCode(v); return id.length !== 16 ? "That isn't a valid friend code." : id === S.me.id ? "That's your own code!" : null; }
    });
    if (code) addContact(code).catch((e) => toast(e.message));
  }
  // ---------- Emoji data ----------

  const EMOJI_SRC = [
    ['Smileys', '😀 grinning|😃 smiley|😄 smile|😁 grin|😆 laughing|😅 sweat_smile|🤣 rofl|😂 joy|🙂 slight_smile|🙃 upside_down|😉 wink|😊 blush|😇 innocent|🥰 smiling_hearts|😍 heart_eyes|🤩 star_struck|😘 kissing_heart|😗 kissing|😚 kissing_closed_eyes|😋 yum|😛 tongue|😜 winking_tongue|🤪 zany|😝 squinting_tongue|🤑 money_mouth|🤗 hug|🤭 hand_over_mouth|🤫 shush|🤔 thinking|🤐 zipper_mouth|🤨 raised_eyebrow|😐 neutral|😑 expressionless|😶 no_mouth|😏 smirk|😒 unamused|🙄 eye_roll|😬 grimace|😮‍💨 exhale|🤥 lying|😌 relieved|😔 pensive|😪 sleepy|🤤 drool|😴 sleeping|😷 mask|🤒 thermometer_face|🤕 bandage_face|🤢 nauseated|🤮 vomit|🤧 sneeze|🥵 hot|🥶 cold|🥴 woozy|😵 dizzy|🤯 exploding_head|🤠 cowboy|🥳 party|🥸 disguise|😎 sunglasses|🤓 nerd|🧐 monocle|😕 confused|😟 worried|🙁 slight_frown|😮 open_mouth|😯 hushed|😲 astonished|😳 flushed|🥺 pleading|😦 frowning|😧 anguished|😨 fearful|😰 anxious_sweat|😥 sad_relieved|😢 cry|😭 sob|😱 scream|😖 confounded|😣 persevere|😞 disappointed|😓 sweat|😩 weary|😫 tired|🥱 yawn|😤 triumph|😡 rage|😠 angry|🤬 swearing|😈 smiling_imp|👿 imp|💀 skull|☠️ skull_crossbones|💩 poop|🤡 clown|👹 ogre|👻 ghost|👽 alien|🤖 robot|😺 smiley_cat|😹 joy_cat|😻 heart_eyes_cat|🙀 scream_cat|😿 crying_cat'],
    ['People', '👋 wave|🤚 raised_back_hand|✋ hand|🖖 vulcan|👌 ok_hand|🤌 pinched|✌️ v|🤞 crossed_fingers|🤟 love_you|🤘 metal|🤙 call_me|👈 point_left|👉 point_right|👆 point_up|👇 point_down|👍 thumbsup|👎 thumbsdown|✊ fist|👊 punch|👏 clap|🙌 raised_hands|👐 open_hands|🤲 palms_up|🤝 handshake|🙏 pray|✍️ writing|💅 nail_polish|💪 muscle|🧠 brain|👀 eyes|👁️ eye|👅 tongue_out|👄 lips|🫡 salute|🫶 heart_hands|🫠 melting|🫣 peeking|🫥 dotted_face|🙋 raising_hand|🤷 shrug|🤦 facepalm|🙇 bow|💃 dancer|🕺 man_dancing|🧍 standing|🏃 runner|🚶 walking|🧑‍💻 technologist|🧙 mage|🧛 vampire|🧟 zombie|🥷 ninja|👑 crown|🎩 tophat|🧢 cap'],
    ['Nature', '🐶 dog|🐱 cat|🐭 mouse|🐹 hamster|🐰 rabbit|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey|🙈 see_no_evil|🙉 hear_no_evil|🙊 speak_no_evil|🐔 chicken|🐧 penguin|🐦 bird|🦆 duck|🦅 eagle|🦉 owl|🦇 bat|🐺 wolf|🐗 boar|🐴 horse|🦄 unicorn|🐝 bee|🐛 bug|🦋 butterfly|🐌 snail|🐞 ladybug|🐜 ant|🕷️ spider|🦂 scorpion|🐢 turtle|🐍 snake|🦎 lizard|🐙 octopus|🦑 squid|🦐 shrimp|🦀 crab|🐡 blowfish|🐠 tropical_fish|🐟 fish|🐬 dolphin|🐳 whale|🦈 shark|🐊 crocodile|🦘 kangaroo|🦒 giraffe|🐘 elephant|🦔 hedgehog|🌵 cactus|🌲 evergreen|🌴 palm_tree|🌱 seedling|🌿 herb|🍀 four_leaf_clover|🍁 maple_leaf|🍄 mushroom|🌷 tulip|🌹 rose|🌻 sunflower|🌸 cherry_blossom|🌞 sun_face|🌝 full_moon_face|🌚 new_moon_face|🌙 crescent_moon|⭐ star|🌟 star2|✨ sparkles|⚡ zap|🔥 fire|🌈 rainbow|☀️ sunny|⛅ partly_sunny|🌧️ rain|⛈️ storm|❄️ snowflake|☃️ snowman|🌊 ocean|💧 droplet'],
    ['Food', '🍏 green_apple|🍎 apple|🍐 pear|🍊 orange|🍋 lemon|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🫐 blueberries|🍒 cherries|🍑 peach|🥭 mango|🍍 pineapple|🥥 coconut|🥝 kiwi|🍅 tomato|🥑 avocado|🥦 broccoli|🥕 carrot|🌽 corn|🌶️ hot_pepper|🥔 potato|🥐 croissant|🍞 bread|🧀 cheese|🥚 egg|🍳 cooking|🥓 bacon|🥞 pancakes|🧇 waffle|🍗 poultry_leg|🍖 meat|🌭 hotdog|🍔 hamburger|🍟 fries|🍕 pizza|🥪 sandwich|🌮 taco|🌯 burrito|🥗 salad|🍝 spaghetti|🍜 ramen|🍣 sushi|🍤 fried_shrimp|🍙 rice_ball|🍚 rice|🥟 dumpling|🍦 icecream|🍩 doughnut|🍪 cookie|🎂 birthday|🍰 cake|🧁 cupcake|🍫 chocolate|🍬 candy|🍭 lollipop|🍿 popcorn|☕ coffee|🍵 tea|🧋 bubble_tea|🥤 cup_with_straw|🍺 beer|🍻 beers|🥂 champagne_glass|🍷 wine|🧃 juice|🧊 ice'],
    ['Activity', '⚽ soccer|🏀 basketball|🏈 football|⚾ baseball|🎾 tennis|🏐 volleyball|🏉 rugby|🎱 8ball|🏓 ping_pong|🏸 badminton|🥅 goal|🏒 hockey|🏏 cricket|⛳ golf|🏹 bow_and_arrow|🎣 fishing|🥊 boxing|🛹 skateboard|⛸️ ice_skate|🎿 ski|🏆 trophy|🥇 first_place|🥈 second_place|🥉 third_place|🏅 medal|🎮 video_game|🕹️ joystick|🎲 game_die|🧩 puzzle|♟️ chess|🎯 dart|🎳 bowling|🎰 slot_machine|🎨 art|🎬 clapper|🎤 microphone|🎧 headphones|🎼 score|🎹 piano|🥁 drum|🎷 saxophone|🎺 trumpet|🎸 guitar|🎻 violin|🎉 tada|🎊 confetti|🎈 balloon|🎁 gift|🎀 ribbon|🎃 jack_o_lantern|🎄 christmas_tree|🎆 fireworks'],
    ['Travel', '🚗 car|🚕 taxi|🚙 suv|🚌 bus|🏎️ racing_car|🚓 police_car|🚑 ambulance|🚒 fire_engine|🚚 truck|🚜 tractor|🛵 scooter|🏍️ motorcycle|🚲 bike|🚂 train|🚀 rocket|✈️ airplane|🛸 ufo|🚁 helicopter|⛵ sailboat|🚤 speedboat|🛳️ ship|⚓ anchor|🗺️ map|🗿 moai|🗽 statue_of_liberty|🗼 tokyo_tower|🏰 castle|🎡 ferris_wheel|🎢 roller_coaster|🏖️ beach|🏝️ island|🏜️ desert|🌋 volcano|⛰️ mountain|🏕️ camping|🏠 house|🏡 house_garden|🏢 office|🏥 hospital|🏫 school|⛪ church|🌃 night|🌆 city_dusk|🌅 sunrise|🌌 milky_way'],
    ['Objects', '⌚ watch|📱 phone|💻 laptop|⌨️ keyboard|🖥️ desktop|🖱️ mouse_computer|💾 floppy|💿 cd|📷 camera|📹 video_camera|🎥 movie_camera|📺 tv|📻 radio|⏰ alarm_clock|⌛ hourglass|💡 bulb|🔦 flashlight|🕯️ candle|💸 money_wings|💵 dollar|💰 moneybag|💳 credit_card|💎 gem|🔧 wrench|🔨 hammer|🛠️ tools|⚙️ gear|🔫 water_gun|💣 bomb|🔪 knife|🗡️ dagger|⚔️ swords|🛡️ shield|🔮 crystal_ball|💊 pill|💉 syringe|🧬 dna|🔭 telescope|🧹 broom|🧻 toilet_paper|🛁 bathtub|🔑 key|🚪 door|🛏️ bed|🧸 teddy_bear|📦 package|✉️ envelope|📝 memo|📚 books|📌 pushpin|📎 paperclip|✂️ scissors|🔒 lock|🔓 unlock'],
    ['Symbols', '❤️ heart|🧡 orange_heart|💛 yellow_heart|💚 green_heart|💙 blue_heart|💜 purple_heart|🖤 black_heart|🤍 white_heart|🤎 brown_heart|💔 broken_heart|❣️ heart_exclamation|💕 two_hearts|💞 revolving_hearts|💓 heartbeat|💗 heartpulse|💖 sparkling_heart|💘 cupid|💝 gift_heart|💯 100|💢 anger|💥 boom|💫 dizzy_star|💦 sweat_drops|💨 dash|🕳️ hole|💬 speech|💭 thought|💤 zzz|✅ white_check_mark|☑️ ballot_box_check|✔️ check|❌ x|❎ negative_x|➕ plus|➖ minus|➗ divide|❓ question|❗ exclamation|‼️ bangbang|⁉️ interrobang|⚠️ warning|🚫 no_entry|⛔ no_entry_sign|🔞 underage|♻️ recycle|🔱 trident|⚜️ fleur_de_lis|🔰 beginner|💠 diamond_dot|🌀 cyclone|🎵 musical_note|🎶 notes|🔔 bell|🔕 no_bell|🏳️‍🌈 rainbow_flag|🏳️‍⚧️ trans_flag|🏴‍☠️ pirate_flag|🇦🇺 flag_au|🇳🇿 flag_nz|🇬🇧 flag_gb|🇺🇸 flag_us|🇨🇦 flag_ca']
  ];
  const EMOJI = EMOJI_SRC.map(([cat, src]) => [cat, src.split('|').map((p) => p.split(' ')[0]).join(' ')]);
  const EMOJI_NAMES = EMOJI_SRC.flatMap(([, src]) => src.split('|').map((p) => { const i = p.indexOf(' '); return [p.slice(0, i), p.slice(i + 1)]; }));
  const SHORTCODES = Object.fromEntries(EMOJI_NAMES.map(([e, n]) => [n, e]));


  // ---------- Wiring ----------

  $('newDmBtn').addEventListener('click', askAddContact);
  $('createRoomBtn').addEventListener('click', createRoom);
  $('joinRoomBtn').addEventListener('click', askJoin);
  $('backBtn').addEventListener('click', () => openHome());
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    ({ 'new-dm': askAddContact, 'create-room': createRoom, 'join-room': askJoin, 'copy-code': copyMyCode })[b.dataset.act]();
  }));
  if (LOCAL && params.has('test')) window.__chatTest = { S, net, hosts, roomLinks, get voice() { return voice; }, DB, connectTo };
  boot();
})();
