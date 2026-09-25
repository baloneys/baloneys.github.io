// chat.js: /chat. Accounts, DMs, rooms, voice, push and safety on Firebase (status-chat-12343).
// Firebase Authentication (email/password) + Cloud Firestore hold accounts and all chat data
// (rules: firebase/firestore.rules). Realtime Database only carries the live bits that need
// disconnect cleanup: online status, typing and voice-call setup (rules: firebase/database.rules.json).
// Voice audio itself is peer-to-peer WebRTC. Setup notes: firebase/SAFETY.md.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut as fbSignOut, EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocFromServer, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch, deleteField, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getDatabase, connectDatabaseEmulator, ref as rtRef, onValue, onChildAdded, onChildChanged, set as rtSet,
  remove as rtRemove, push as rtPush, onDisconnect, serverTimestamp as rtNow
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { getMessaging, getToken, deleteToken, onMessage, isSupported as messagingSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';

(function () {
  'use strict';

  // ---------- Config ----------

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBriW88c6W9_6pc0AFEj0Xs0vPb2hcbJnw',
    authDomain: 'status-chat-12343.firebaseapp.com',
    databaseURL: 'https://status-chat-12343-default-rtdb.firebaseio.com',
    projectId: 'status-chat-12343',
    storageBucket: 'status-chat-12343.firebasestorage.app',
    messagingSenderId: '309117531689',
    appId: '1:309117531689:web:3b35d21f6794f375e6ce38'
  };
  // Web Push certificate key from Firebase console > Project settings > Cloud Messaging.
  // Leave empty to use Firebase's default key.
  const VAPID_KEY = '';
  // true once the scanning Cloud Functions are deployed (firebase/SAFETY.md). Uploaded images stay
  // blurred for everyone else until the server has checked them.
  const SERVER_SCAN = true;
  const GIPHY_KEY = atob('R2xWR1lIa3IzV1NCbmxsY2E1NGlOdDB5RmJqejdMNjU=');
  const NSFW_LIB = 'https://cdn.jsdelivr.net/npm/nsfwjs@4.4.0/dist/browser/nsfwjs.min.js';
  const NSFW_MODEL = new URL('chat-model/model.json', location.href).href;
  // Add a TURN server here if people behind strict networks can't connect to voice.
  const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const EMAIL_DOMAIN = 'chat.kanaris-beans.com';
  const PAGE = 60;
  const COLORS = ['#9d00ff', '#e60065', '#c77dff', '#ff5fa2', '#4cc9f0', '#3ddc97', '#ffd166', '#ff8c42', '#7b61ff', '#f7f2ff'];
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
  const REPORT_REASONS = [
    ['child_safety', 'Child sexual abuse or exploitation', 'Hidden straight away until a moderator reviews it.'],
    ['sexual', 'Nudity or sexual content'],
    ['harassment', 'Harassment, hate or bullying'],
    ['violence', 'Violence, threats or gore'],
    ['self_harm', 'Self-harm or suicide'],
    ['spam', 'Spam or scams'],
    ['other', 'Something else']
  ];

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const fs = getFirestore(app);      // accounts, messages, rooms, moderation
  const rtdb = getDatabase(app);     // presence, typing, voice signalling
  const params = new URLSearchParams(location.search);
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && params.has('emu')) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(fs, '127.0.0.1', 8085);
    connectDatabaseEmulator(rtdb, '127.0.0.1', 9000);
    window.__chatTest = { auth, fs, rtdb, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, serverTimestamp, rtRef, rtSet, voice: () => voice };
  }
  const NOW = serverTimestamp;       // Firestore server time
  const R = (path) => rtRef(rtdb, path);

  // Firestore timestamps -> milliseconds (pending local writes use the estimate).
  function ms(v) { return v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : Date.now(); }
  function norm(snap) {
    const d = snap.data({ serverTimestamps: 'estimate' });
    if (!d) return null;
    for (const k of ['ts', 'createdAt', 'updatedAt', 'resolvedAt', 'at']) if (k in d) d[k] = ms(d[k]);
    if (d.evidence) { for (const k of ['ts', 'capturedAt']) if (d.evidence[k]) d.evidence[k] = ms(d.evidence[k]); }
    return d;
  }
  // Drop null/undefined fields: the rules treat optional fields as absent, never null.
  function clean(o) { for (const k of Object.keys(o)) if (o[k] == null) delete o[k]; return o; }

  // Fields written to delete a message (author, room host or moderator).
  const DELETION = () => ({ deleted: true, text: deleteField(), image: deleteField(), sticker: deleteField(), replyTo: deleteField(), reactions: deleteField() });
  const convKey = (c) => (c.type === 'dm' ? 'dm_' : 'room_') + c.id;
  const typingPath = (c) => (c.type === 'dm' ? 'typingDm/' : 'typingRoom/') + c.id;

  // ---------- State ----------

  const S = {
    me: null,               // firebase user
    profile: null,          // users/{me}
    users: {},              // uid -> profile
    userSubs: {},
    customs: {},            // uid -> { id: item }
    customSubs: {},
    mods: {},
    bans: {},
    blocks: {},
    dms: {},                // dmId -> { with, updatedAt, lastRead, meta }
    rooms: {},              // code -> { lastRead, meta }
    conv: null,             // { type: 'dm'|'room', id, other?, base }
    msgs: new Map(),
    msgNodes: new Map(),
    limit: PAGE,
    convSubs: [],
    listSubs: [],
    reply: null,
    editing: null,
    pendingImages: [],
    members: {},
    roomMuted: {},
    roomBanned: {},
    typing: {},
    showMembers: false,
    nsfw: {},               // key -> 'ok'|'flagged'|'error'|'checking'
    revealed: new Set(),
    seenMeta: {},
    read: {},               // convKey -> last read (ms)
    roomChecks: {},
    pushOn: false,
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
    for (const kid of kids.flat()) {
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
    const code = (err && err.code) || '';
    if (/PERMISSION_DENIED|permission/i.test(code + (err && err.message))) toast(fallback || "You can't do that here.");
    else toast(fallback || (err && err.message) || 'Something went wrong.');
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

  const dmIdFor = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  const otherOf = (dmId) => { const [a, b] = dmId.split('_'); return a === S.me.uid ? b : a; };
  const nameOf = (uid) => (S.users[uid] && S.users[uid].username) || '…';
  const isMod = (uid) => S.mods[uid] === true;
  const amMod = () => S.me && isMod(S.me.uid);
  const isBlocked = (uid) => !!S.blocks[uid];
  const amBanned = () => S.me && !!S.bans[S.me.uid];

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

  // ---------- Modal ----------

  let modalClose = null;
  function openModal(title, body, actions, opts) {
    const card = $('modalCard');
    card.className = 'modal-card' + (opts && opts.wide ? ' wide' : '');
    card.replaceChildren(
      el('h2', { class: 'modal-title', text: title }),
      body,
      actions && actions.length ? el('div', { class: 'modal-actions' }, actions) : null
    );
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

  // ---------- Avatars ----------

  function avatarUrl(u) {
    if (!u || !u.avatar) return null;
    if (u.avatarScan === 'ok' || !SERVER_SCAN || (S.me && u === S.profile)) return u.avatar;
    return null;
  }

  function avatar(uid, size, withPresence) {
    const u = S.users[uid];
    const a = el('div', { class: 'avatar' + (size ? ' ' + size : '') });
    const url = avatarUrl(u);
    const color = (u && u.color) || '#4a4060';
    if (url) a.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
    else { a.style.background = color; a.textContent = (u && u.username ? u.username[0] : '?'); }
    if (withPresence) {
      const p = el('span', { class: 'presence' });
      p.dataset.presence = uid;
      if (presence[uid]) p.classList.add('online');
      a.append(p);
    }
    return a;
  }

  // ---------- Users, customs, presence ----------

  const presence = {};
  const presenceSubs = {};
  let rerenderQueued = false;

  function queueRerender() {
    if (rerenderQueued) return;
    rerenderQueued = true;
    requestAnimationFrame(() => {
      rerenderQueued = false;
      renderSidebar();
      if (S.conv) { renderMessages(); renderConvHead(); if (S.showMembers) renderMembers(); }
      renderVoice();
    });
  }

  function watchUser(uid) {
    if (!uid || S.userSubs[uid]) return;
    S.userSubs[uid] = onSnapshot(doc(fs, 'users', uid), (s) => {
      const u = norm(s);
      if (u) S.users[uid] = u; else delete S.users[uid];
      if (S.me && uid === S.me.uid) { S.profile = u; renderMe(); }
      queueRerender();
    }, () => {});
    watchPresence(uid);
  }

  function watchPresence(uid) {
    if (presenceSubs[uid]) return;
    presenceSubs[uid] = onValue(R('status/' + uid + '/online'), (s) => {
      presence[uid] = s.val() === true;
      document.querySelectorAll('[data-presence="' + uid + '"]').forEach((p) => p.classList.toggle('online', presence[uid]));
    }, () => {});
  }

  function watchCustoms(uid) {
    if (!uid || S.customSubs[uid]) return;
    S.customSubs[uid] = onSnapshot(collection(fs, 'customs', uid, 'items'), (qs) => {
      const items = {};
      qs.forEach((d) => { items[d.id] = norm(d); });
      S.customs[uid] = items;
      queueRerender();
      if (uid === S.me.uid) refreshOpenPickers();
    }, () => {});
  }

  function customUsable(uid, item) {
    return item && (item.scan === 'ok' || !SERVER_SCAN || uid === S.me.uid);
  }
  function findCustomEmoji(uid, name) {
    const set = S.customs[uid] || {};
    for (const id in set) if (set[id].kind === 'emoji' && set[id].name === name && customUsable(uid, set[id])) return set[id];
    return null;
  }

  function setupPresence() {
    const ref = R('status/' + S.me.uid);
    S.listSubs.push(onValue(R('.info/connected'), (s) => {
      if (s.val() !== true) return;
      onDisconnect(ref).set({ online: false, lastChanged: rtNow() }).then(() => rtSet(ref, { online: true, lastChanged: rtNow() }));
    }));
  }

  // ---------- Auth ----------

  let authMode = 'in';
  let authColor = COLORS[Math.floor(Math.random() * COLORS.length)];

  function renderSwatches(host, current, onPick) {
    host.replaceChildren(...COLORS.map((c) => el('button', {
      type: 'button', class: 'swatch' + (c === current ? ' selected' : ''), style: { background: c }, 'aria-label': 'Colour ' + c,
      onclick: () => { onPick(c); renderSwatches(host, c, onPick); }
    })));
  }

  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll('[data-auth-tab]').forEach((t) => {
      const on = t.dataset.authTab === mode;
      t.classList.toggle('active', on); t.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('.up-only').forEach((n) => n.classList.toggle('hidden', mode !== 'up'));
    $('authSubmit').textContent = mode === 'up' ? 'Create account' : 'Sign in';
    $('authPass').autocomplete = mode === 'up' ? 'new-password' : 'current-password';
    $('authError').textContent = '';
  }

  document.querySelectorAll('[data-auth-tab]').forEach((t) => t.addEventListener('click', () => setAuthMode(t.dataset.authTab)));
  renderSwatches($('authSwatches'), authColor, (c) => { authColor = c; });

  const emailFor = (name) => name.toLowerCase() + '@' + EMAIL_DOMAIN;
  let signingUp = false;

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('authUser').value.trim();
    const pass = $('authPass').value;
    const errEl = $('authError');
    errEl.textContent = '';
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) { errEl.textContent = 'Usernames are 3 to 20 letters, numbers or underscores.'; return; }
    if (authMode === 'up') {
      if (pass.length < 8) { errEl.textContent = 'Use at least 8 characters for your password.'; return; }
      if (!$('authAgree').checked) { errEl.textContent = 'Please confirm you are 13 or older and agree to the rules.'; return; }
    }
    $('authSubmit').disabled = true;
    try {
      if (authMode === 'in') {
        await signInWithEmailAndPassword(auth, emailFor(name), pass);
      } else {
        signingUp = true;
        const cred = await createUserWithEmailAndPassword(auth, emailFor(name), pass);
        try {
          await claimUsername(cred.user.uid, name, authColor);
        } catch (err) {
          await cred.user.delete().catch(() => {});
          throw err;
        }
        signingUp = false;
        startApp(cred.user);
      }
    } catch (err) {
      signingUp = false;
      const c = err.code || '';
      errEl.textContent =
        c === 'auth/email-already-in-use' ? 'That username is taken.' :
        /auth\/(wrong-password|user-not-found|invalid-credential|invalid-login-credentials)/.test(c) ? 'Wrong username or password.' :
        c === 'auth/too-many-requests' ? 'Too many attempts. Wait a bit and try again.' :
        c === 'auth/operation-not-allowed' ? 'Sign-ups are switched off right now.' :
        c === 'auth/network-request-failed' ? "Can't reach the server. Check your connection." :
        /permission-denied|PERMISSION_DENIED/.test(c + err.message) ? 'That username is taken.' :
        (err.message || 'Something went wrong.');
    } finally {
      $('authSubmit').disabled = false;
    }
  });

  // One batch: the username claim and the profile are checked against each other by the rules.
  function claimUsername(uid, name, color) {
    const batch = writeBatch(fs);
    batch.set(doc(fs, 'usernames', name.toLowerCase()), { uid });
    batch.set(doc(fs, 'users', uid), { username: name, color, createdAt: NOW() });
    return batch.commit();
  }

  onAuthStateChanged(auth, async (user) => {
    $('boot').classList.add('hidden');
    if (!user) {
      stopApp();
      $('authView').classList.remove('hidden');
      $('appView').classList.add('hidden');
      return;
    }
    if (signingUp) return;
    // Recover accounts whose profile write failed during sign-up.
    const snap = await getDoc(doc(fs, 'users', user.uid)).catch(() => null);
    if (snap && !snap.exists()) {
      const name = (user.email || '').split('@')[0];
      try { await claimUsername(user.uid, name, authColor); } catch (err) { await fbSignOut(auth); $('authError').textContent = "Couldn't finish setting up your account."; return; }
    }
    startApp(user);
  });

  // ---------- App lifecycle ----------

  let started = false;

  // Realtime Database listener that is removed with the rest of `list`.
  function sub(list, ref, cb) {
    list.push(onValue(ref, cb, (err) => console.warn('listener', ref.toString(), err && err.code)));
  }

  function startApp(user) {
    if (started && S.me && S.me.uid === user.uid) return;
    stopApp();
    started = true;
    S.me = user;
    $('authView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    $('authForm').reset();

    watchUser(user.uid);
    watchCustoms(user.uid);
    setupPresence();

    const onErr = (what) => (err) => console.warn('listener', what, err && err.code);
    const docsMap = (qs) => { const o = {}; qs.forEach((d) => { o[d.id] = norm(d); }); return o; };
    S.listSubs.push(
      onSnapshot(collection(fs, 'mods'), (qs) => { S.mods = {}; qs.forEach((d) => { S.mods[d.id] = true; }); renderMe(); setupModWatch(); queueRerender(); }, onErr('mods')),
      onSnapshot(collection(fs, 'bans'), (qs) => { S.bans = docsMap(qs); renderMe(); queueRerender(); }, onErr('bans')),
      onSnapshot(collection(fs, 'blocks', user.uid, 'users'), (qs) => { S.blocks = {}; qs.forEach((d) => { S.blocks[d.id] = true; }); S.msgNodes.clear(); queueRerender(); }, onErr('blocks')),
      onSnapshot(collection(fs, 'readState', user.uid, 'convs'), (qs) => { S.read = {}; qs.forEach((d) => { S.read[d.id] = norm(d).at; }); queueRerender(); }, onErr('readState')),
      onSnapshot(query(collection(fs, 'dms'), where('members', 'array-contains', user.uid)), (qs) => syncDms(docsMap(qs)), onErr('dms')),
      onSnapshot(query(collection(fs, 'rooms'), where('memberIds', 'array-contains', user.uid)), (qs) => syncRooms(docsMap(qs)), onErr('rooms'))
    );

    initPush();
    route();
  }

  function stopApp() {
    if (!started) return;
    started = false;
    leaveVoice();
    closeConv();
    S.listSubs.forEach((f) => f()); S.listSubs = [];
    Object.values(S.userSubs).forEach((f) => f()); S.userSubs = {};
    Object.values(S.customSubs).forEach((f) => f()); S.customSubs = {};
    Object.values(presenceSubs).forEach((f) => f());
    for (const k in presenceSubs) delete presenceSubs[k];
    Object.values(dmSubs).forEach((f) => f());
    Object.values(roomSubs).forEach((f) => f());
    for (const k in dmSubs) delete dmSubs[k];
    for (const k in roomSubs) delete roomSubs[k];
    if (modSub) { modSub(); modSub = null; }
    Object.assign(S, { me: null, profile: null, users: {}, customs: {}, mods: {}, bans: {}, blocks: {}, dms: {}, rooms: {}, read: {}, seenMeta: {} });
    $('dmList').replaceChildren(); $('roomList').replaceChildren();
  }

  function renderMe() {
    if (!S.me) return;
    const p = S.profile;
    $('meAvatar').replaceChildren(avatar(S.me.uid, 'sm', true));
    $('meName').textContent = p ? p.username : '';
    $('welcomeName').textContent = p ? p.username : '';
    $('modBtn').classList.toggle('hidden', !amMod());
    renderConvBanner();
  }

  // ---------- Sidebar: DMs and rooms ----------

  const dmSubs = {};
  const roomSubs = {};
  const voiceWatch = {};   // 'dm:<id>' | 'room:<code>' -> { uid: participant }

  // dms/{id} documents where I'm a member (created with the first message).
  function syncDms(val) {
    for (const id in dmSubs) if (!val[id]) { dmSubs[id](); delete dmSubs[id]; delete S.dms[id]; }
    for (const id in val) {
      const other = otherOf(id);
      S.dms[id] = { key: 'dm_' + id, with: other, meta: val[id] };
      watchUser(other);
      onMetaChange('dm', id, val[id]);
      if (!dmSubs[id]) dmSubs[id] = onValue(R('voiceDm/' + id + '/participants'), (s) => { onVoicePresence('dm:' + id, s.val() || {}); }, () => {});
    }
    queueRerender();
  }

  // rooms/{code} documents where I'm in memberIds. Dropping out of the query means we left,
  // were kicked, or the room was deleted.
  function syncRooms(val) {
    for (const code in roomSubs) {
      if (val[code] || S.roomChecks[code]) continue;
      // Confirm with the server first: a rejected local write can make the room blink out of the query.
      S.roomChecks[code] = getDocFromServer(doc(fs, 'rooms', code)).then((snap) => snap.exists() && snap.data().memberIds.includes(S.me.uid)).catch(() => false).then((still) => {
        delete S.roomChecks[code];
        if (still || !roomSubs[code]) return;
        roomSubs[code](); delete roomSubs[code]; delete S.rooms[code];
        leaveVoiceIf('room', code);
        if (S.conv && S.conv.type === 'room' && S.conv.id === code) { toast('You are no longer in that room.'); openHome(); }
        queueRerender();
      });
    }
    for (const code in val) {
      S.rooms[code] = { key: 'room_' + code, meta: val[code] };
      val[code].memberIds.forEach(watchUser);
      onMetaChange('room', code, val[code]);
      if (S.conv && S.conv.type === 'room' && S.conv.id === code) applyRoomMeta(val[code]);
      if (!roomSubs[code]) roomSubs[code] = onValue(R('voiceRoom/' + code + '/participants'), (s) => { onVoicePresence('room:' + code, s.val() || {}); }, () => {});
    }
    queueRerender();
  }

  function lastReadOf(entry) { return (entry && S.read[entry.key]) || 0; }

  function isUnread(entry) {
    const meta = entry && entry.meta;
    if (!meta || !meta.updatedAt || !meta.last) return false;
    if (meta.last.from === S.me.uid) return false;
    if (isBlocked(meta.last.from)) return false;
    return meta.updatedAt > lastReadOf(entry);
  }

  function onMetaChange(type, id, meta) {
    const key = type + ':' + id;
    const prev = S.seenMeta[key];
    S.seenMeta[key] = meta && meta.updatedAt;
    if (!prev || !meta || !meta.last || meta.updatedAt <= prev) return;
    if (meta.last.from === S.me.uid || isBlocked(meta.last.from)) return;
    const viewing = S.conv && S.conv.type === type && S.conv.id === id && !document.hidden;
    if (viewing) return;
    const who = nameOf(meta.last.from);
    const where = type === 'room' ? ' in ' + meta.name : '';
    notify(who + where, meta.last.text || 'New message', type === 'dm' ? '#dm/' + otherOf(id) : '#room/' + id);
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
    const dms = Object.entries(S.dms)
      .sort((a, b) => ((b[1].meta && b[1].meta.updatedAt) || b[1].updatedAt || 0) - ((a[1].meta && a[1].meta.updatedAt) || a[1].updatedAt || 0));
    const dmNodes = dms.map(([id, d]) => {
      const other = d.with || otherOf(id);
      const last = d.meta && d.meta.last;
      const pv = isBlocked(other) ? 'Blocked' : last ? (last.from === S.me.uid ? 'You: ' : '') + last.text : 'Say hi';
      return convButton({
        icon: avatar(other, null, true), name: nameOf(other), preview: pv,
        active: S.conv && S.conv.type === 'dm' && S.conv.id === id,
        unread: isUnread(d), voice: voiceCount('dm:' + id, true) > 0,
        onclick: () => openDm(other)
      });
    });
    $('dmList').replaceChildren(...(dmNodes.length ? dmNodes : [el('p', { class: 'side-empty', text: 'No DMs yet.' })]));

    const rooms = Object.entries(S.rooms).filter(([, r]) => r.meta)
      .sort((a, b) => (b[1].meta.updatedAt || b[1].meta.createdAt || 0) - (a[1].meta.updatedAt || a[1].meta.createdAt || 0));
    const roomNodes = rooms.map(([code, r]) => {
      const last = r.meta.last;
      const sys = last && last.text.startsWith(nameOf(last.from) + ' ');
      const pv = !last ? code : sys ? last.text : (last.from === S.me.uid ? 'You' : nameOf(last.from)) + ': ' + last.text;
      if (last) watchUser(last.from);
      return convButton({
        icon: el('span', { class: 'room-icon', text: r.meta.name.slice(0, 1).toUpperCase() }), name: r.meta.name, preview: pv,
        active: S.conv && S.conv.type === 'room' && S.conv.id === code,
        unread: isUnread(r), voice: voiceCount('room:' + code) > 0,
        onclick: () => openRoom(code)
      });
    });
    $('roomList').replaceChildren(...(roomNodes.length ? roomNodes : [el('p', { class: 'side-empty', text: 'No rooms yet. Create one or join with a code.' })]));

    const unread = dms.filter(([, d]) => isUnread(d)).length + rooms.filter(([, r]) => isUnread(r)).length;
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
    // With push switched on, the service worker shows background notifications; don't double up.
    if (document.hidden && !S.pushOn && S.settings.desktop && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, icon: 'public/pw64s5dmavz539gvjm065tw71xp1.png', tag: hash });
        n.onclick = () => { window.focus(); location.hash = hash; n.close(); };
      } catch (e) { /* some browsers need the service worker */ }
    } else if (!document.hidden) {
      toast(title + ': ' + body.slice(0, 80));
    }
  }

  // ---------- Routing ----------

  function route() {
    if (!S.me) return;
    const h = decodeURIComponent(location.hash.slice(1));
    let m;
    if ((m = /^dm\/([A-Za-z0-9]+)$/.exec(h))) openDm(m[1], true);
    else if ((m = /^room\/([A-Z2-9]{6})$/.exec(h))) {
      if (S.rooms[m[1]]) openRoom(m[1], true);
      else joinRoom(m[1]);
    } else if ((m = /^join\/([A-Za-z2-9]{6})$/.exec(h))) joinRoom(m[1].toUpperCase());
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
    S.convSubs.forEach((f) => f()); S.convSubs = [];
    if (S.msgUnsub) S.msgUnsub();
    S.conv = null;
    S.msgs = new Map(); S.msgNodes = new Map();
    S.limit = PAGE; S.reply = null; S.editing = null; S.pendingImages = [];
    S.members = {}; S.roomMuted = {}; S.roomBanned = {}; S.typing = {};
    closePopover();
    renderBars();
  }

  async function openDm(uid, fromRoute) {
    if (!uid || uid === S.me.uid) return openHome();
    const id = dmIdFor(S.me.uid, uid);
    if (S.conv && S.conv.id === id) return;
    watchUser(uid);
    closeConv();
    S.conv = { type: 'dm', id, other: uid, base: 'dms/' + id };
    setHash('#dm/' + uid);
    enterConv();
    // Make sure the other person exists before showing a composer.
    const u = await getDoc(doc(fs, 'users', uid)).catch(() => null);
    if (!u || !u.exists()) { toast("That user doesn't exist."); return openHome(); }
  }

  function openRoom(code, fromRoute) {
    if (S.conv && S.conv.id === code) return;
    closeConv();
    S.conv = { type: 'room', id: code, base: 'rooms/' + code };
    setHash('#room/' + code);
    if (S.rooms[code]) applyRoomMeta(S.rooms[code].meta);
    enterConv();
  }

  // Members, mutes and kicks all live on the room document.
  function applyRoomMeta(meta) {
    S.members = {};
    meta.memberIds.forEach((u) => { S.members[u] = u === meta.owner ? 'owner' : 'member'; watchUser(u); watchCustoms(u); });
    S.roomMuted = Object.fromEntries(meta.muted.map((u) => [u, true]));
    S.roomBanned = Object.fromEntries(meta.banned.map((u) => [u, true]));
    renderConvBanner();
    if (S.showMembers) renderMembers();
  }

  function enterConv() {
    const c = S.conv;
    $('welcome').classList.add('hidden');
    $('convView').classList.remove('hidden');
    $('appView').classList.add('in-conv');
    $('messages').replaceChildren(el('div', { class: 'conv-loading', text: 'Loading…' }));
    $('composerInput').value = loadDraft();
    autoGrow();
    if (c.type === 'dm') watchCustoms(c.other);
    watchCustoms(S.me.uid);
    subscribeMessages();
    sub(S.convSubs, R(typingPath(c)), (s) => { S.typing = s.val() || {}; renderTyping(); });
    const tick = setInterval(renderTyping, 3000);
    S.convSubs.push(() => clearInterval(tick));
    S.showMembers = c.type === 'room' && window.innerWidth > 1100;
    renderConvHead();
    renderConvBanner();
    if (S.showMembers) renderMembers(); else { $('membersPane').classList.add('hidden'); $('appView').classList.remove('with-members'); }
    renderVoice();
    queueRerender();
    if (window.innerWidth > 760) setTimeout(() => $('composerInput').focus(), 0);
  }

  // Newest S.limit messages, live. Older pages widen the window.
  function subscribeMessages(onReady) {
    const c = S.conv;
    if (S.msgUnsub) S.msgUnsub();
    const q = query(collection(fs, c.base, 'messages'), orderBy('ts', 'desc'), limit(S.limit));
    let initial = true;
    const unsub = onSnapshot(q, (qs) => {
      if (S.conv !== c) return;
      let added = false;
      qs.docChanges().forEach((ch) => {
        if (ch.type === 'removed') { S.msgs.delete(ch.doc.id); S.msgNodes.delete(ch.doc.id); return; }
        const m = norm(ch.doc);
        S.msgs.set(ch.doc.id, m);
        watchUser(m.from); watchCustoms(m.from);
        if (ch.type === 'added') added = true;
      });
      if (initial) {
        initial = false;
        S.hasOlder = qs.size >= S.limit;
        if (onReady) onReady(); else { renderMessages(true); markRead(); }
      } else {
        scheduleRender(added);
      }
    }, (err) => { fail(err, "Couldn't load messages."); });
    S.msgUnsub = () => { unsub(); S.msgUnsub = null; };
  }

  function loadOlder() {
    const box = $('messages');
    const prevHeight = box.scrollHeight, prevTop = box.scrollTop;
    S.limit += PAGE;
    subscribeMessages(() => {
      renderMessages(false);
      box.scrollTop = box.scrollHeight - prevHeight + prevTop;
    });
  }

  let lastReadWrite = 0;
  function markRead() {
    const c = S.conv;
    if (!c || document.hidden || !atBottom()) return;
    const entry = c.type === 'dm' ? S.dms[c.id] : S.rooms[c.id];
    const meta = entry && entry.meta;
    if (!entry || !meta) return; // conversation not started yet
    if (lastReadOf(entry) >= (meta.updatedAt || 0)) return;
    if (Date.now() - lastReadWrite < 1500) { setTimeout(markRead, 1600); return; }
    lastReadWrite = Date.now();
    setDoc(doc(fs, 'readState', S.me.uid, 'convs', convKey(c)), { at: NOW() }).catch(() => {});
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

  // Messages in time order (ties broken by id).
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
    const newest = keys.length && S.msgs.get(keys[keys.length - 1]);
    if (toBottom || (wasBottom && newest && newest.from === S.me.uid)) scrollToBottom();
    else if (wasBottom) scrollToBottom();
    else if (newest && newest.from !== S.me.uid) $('jumpBtn').classList.remove('hidden');
    markRead();
  }

  function convStart() {
    const c = S.conv;
    if (c.type === 'dm') return el('div', { class: 'conv-start' }, el('strong', { text: nameOf(c.other) }), 'This is the start of your DMs with ' + nameOf(c.other) + '.');
    const meta = S.rooms[c.id] && S.rooms[c.id].meta;
    return el('div', { class: 'conv-start' }, el('strong', { text: meta ? meta.name : c.id }), 'Welcome to the room. Share code ', el('span', { class: 'code-chip', text: c.id, onclick: copyCode }), ' to invite people.');
  }

  function msgSig(key, m) {
    const u = S.users[m.from] || {};
    const cust = S.customs[m.from] ? Object.keys(S.customs[m.from]).length + JSON.stringify(Object.values(S.customs[m.from]).map((x) => x.scan)) : '';
    const late = m.ts && Date.now() - m.ts > 45000;
    return [JSON.stringify(m), u.username, u.color, avatarUrl(u) ? avatarUrl(u).length : 0, isBlocked(m.from), S.revealed.has(key), S.nsfw[key], cust, late, isMod(m.from), !!S.bans[m.from], S.profile && S.profile.username, S.reply && S.reply.id === key, S.editing === key, canModerateConv()].join('|');
  }

  function msgNode(key, m) {
    const sig = msgSig(key, m);
    const cached = S.msgNodes.get(key);
    if (cached && cached.sig === sig) return cached.node;
    const node = buildMsg(key, m);
    S.msgNodes.set(key, { sig, node });
    return node;
  }

  function canModerateConv() {
    const c = S.conv;
    if (!c) return false;
    if (amMod()) return true;
    return c.type === 'room' && S.rooms[c.id] && S.rooms[c.id].meta && S.rooms[c.id].meta.owner === S.me.uid;
  }

  function buildMsg(key, m) {
    if (m.kind === 'system') {
      return el('div', { class: 'msg system', 'data-id': key }, el('div', { class: 'msg-text' }, el('b', { text: nameOf(m.from) }), ' ' + (m.text || '')));
    }
    const mine = m.from === S.me.uid;
    const u = S.users[m.from];

    if (isBlocked(m.from) && !S.revealed.has(key)) {
      return el('div', { class: 'msg system blocked-msg', 'data-id': key },
        el('div', { class: 'msg-text' }, 'Message from someone you blocked. ', el('button', { class: 'link-btn', type: 'button', text: 'Show', onclick: () => { S.revealed.add(key); scheduleRender(false); } })));
    }

    const myName = S.profile && S.profile.username.toLowerCase();
    const mentioned = !mine && m.text && myName && new RegExp('(^|[^\\w])@' + myName + '(?![\\w])', 'i').test(m.text);
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
    const head = el('div', { class: 'msg-head' },
      el('span', { class: 'msg-user', style: { color: (u && u.color) || '#c9beeb' }, text: nameOf(m.from), onclick: () => showProfile(m.from) }),
      isMod(m.from) ? el('span', { class: 'badge badge-mod', text: 'mod' }) : null,
      S.conv.type === 'room' && S.rooms[S.conv.id] && S.rooms[S.conv.id].meta && S.rooms[S.conv.id].meta.owner === m.from ? el('span', { class: 'badge', text: 'host' }) : null,
      el('span', { class: 'msg-time', title: new Date(m.ts).toLocaleString(), text: fmtTime(m.ts) })
    );
    body.append(head);

    if (m.held) {
      body.append(el('div', { class: 'msg-deleted', text: 'Hidden while moderators review a report.' }));
    } else if (m.deleted) {
      body.append(el('div', { class: 'msg-deleted', text: 'Message deleted.' }));
    } else {
      if (S.editing === key) {
        body.append(editBox(key, m));
      } else if (m.text) {
        const t = el('div', { class: 'msg-text' }, formatText(m.text, m.from));
        if (isBigEmoji(m.text, m.from)) t.classList.add('big');
        if (m.kind === 'action') t.prepend(el('b', { text: nameOf(m.from) + ' ' }));
        if (m.edited) t.append(el('span', { class: 'msg-edited', text: '(edited)' }));
        body.append(t);
      }
      if (m.sticker) body.append(stickerView(m.sticker));
      const img = imageBlock(key, m);
      if (img) body.append(img);
      if (m.scan === 'blocked') body.append(el('div', { class: 'msg-deleted', text: 'Image removed by the automatic filter.' }));
    }

    const reacts = reactionsByEmoji(m);
    if (reacts.length && !m.deleted) {
      body.append(el('div', { class: 'reactions' }, reacts.map(([emo, uids]) => {
        return el('button', {
          class: 'reaction' + (uids.includes(S.me.uid) ? ' mine' : ''), type: 'button', title: uids.map(nameOf).join(', '),
          onclick: () => toggleReaction(key, emo)
        }, emo, el('b', { text: String(uids.length) }));
      })));
    }
    node.append(body);

    if (!m.deleted && !m.held) {
      const tools = el('div', { class: 'msg-tools' },
        toolBtn('😀', 'React', (e) => openReactPop(node, key, e)),
        toolBtn('↩', 'Reply', () => startReply(key, m)),
        mine && m.text && !m.kind ? toolBtn('✎', 'Edit', () => { S.editing = key; scheduleRender(false); }) : null,
        m.text ? toolBtn('⧉', 'Copy text', () => { navigator.clipboard && navigator.clipboard.writeText(m.text); toast('Copied.'); }) : null,
        mine || canModerateConv() ? toolBtn('🗑', 'Delete', () => deleteMessage(key, m)) : null,
        !mine ? toolBtn('⚑', 'Report', () => reportMessage(key, m)) : null
      );
      node.append(tools);
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

  function formatText(text, from) {
    const frag = document.createDocumentFragment();
    text.split(/(`[^`\n]+`)/).forEach((part) => {
      if (/^`[^`\n]+`$/.test(part)) frag.append(el('code', { text: part.slice(1, -1) }));
      else if (part) frag.append(inline(part, from, 0));
    });
    return frag;
  }

  function inline(text, from, depth) {
    const frag = document.createDocumentFragment();
    let best = null;
    if (depth < 6) {
      for (const rule of INLINE_RULES) {
        const m = rule.re.exec(text);
        if (m && (!best || m.index < best.m.index)) best = { rule, m };
      }
    }
    if (!best) { frag.append(leaves(text, from)); return frag; }
    const { rule, m } = best;
    frag.append(leaves(text.slice(0, m.index), from));
    frag.append(rule.wrap(inline(m[1], from, depth + 1)));
    frag.append(inline(text.slice(m.index + m[0].length), from, depth));
    return frag;
  }

  function userByName(name) {
    const lower = name.toLowerCase();
    for (const uid in S.users) if (S.users[uid].username && S.users[uid].username.toLowerCase() === lower) return uid;
    return null;
  }

  function leaves(text, from) {
    const frag = document.createDocumentFragment();
    let last = 0, m;
    LEAF_RE.lastIndex = 0;
    while ((m = LEAF_RE.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      if (m[1]) {
        frag.append(el('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer nofollow ugc', text: m[1] }));
      } else if (m[2]) {
        const uid = userByName(m[2]);
        if (uid) frag.append(el('span', { class: 'mention' + (uid === S.me.uid ? ' me' : ''), text: '@' + nameOf(uid), onclick: () => showProfile(uid) }));
        else frag.append(m[0]);
      } else if (m[3]) {
        const custom = findCustomEmoji(from, m[3]);
        if (custom) frag.append(el('img', { class: 'custom-emoji', src: custom.data, alt: ':' + m[3] + ':', title: ':' + m[3] + ':' }));
        else if (SHORTCODES[m[3]]) frag.append(SHORTCODES[m[3]]);
        else frag.append(m[0]);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }

  function isBigEmoji(text, from) {
    let rest = text.replace(/:([A-Za-z0-9_+-]{2,32}):/g, (all, name) => (findCustomEmoji(from, name) || SHORTCODES[name] ? '⭐' : all)).replace(/\s+/g, '');
    if (!rest || rest.length > 40) return false;
    if (!/^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u.test(rest)) return false;
    const count = (rest.match(/\p{Extended_Pictographic}/gu) || []).length;
    return count > 0 && count <= 6;
  }

  // ---------- Images and stickers in messages ----------

  function imageBlock(key, m) {
    if (!m.image) return null;
    const url = m.image;
    if (url.startsWith('https://')) return imgEl(url, 'GIF');
    const mine = m.from === S.me.uid;
    const late = Date.now() - m.ts > 45000;
    let show = mine || m.scan === 'ok' || S.revealed.has(key);
    if (!show) {
      const local = S.nsfw[key];
      if (!local) classifyLater(key, url);
      if (local === 'flagged') return el('div', { class: 'img-held' }, el('span', { text: 'Hidden by the image filter.' }));
      if (local === 'ok' && (!SERVER_SCAN || late)) show = true;
      if (!show && SERVER_SCAN && !late) setTimeout(() => scheduleRender(false), 45000 - (Date.now() - m.ts) + 50);
      if (!show) {
        const allowReveal = local === 'error' && (!SERVER_SCAN || late);
        return el('div', { class: 'img-held' },
          el('span', { text: local === 'error' ? "This image couldn't be checked." : 'Checking image…' }),
          allowReveal ? el('button', { class: 'link-btn', type: 'button', text: 'Show anyway', onclick: () => { S.revealed.add(key); scheduleRender(false); } }) : null);
      }
    }
    return imgEl(url, 'Image');
  }

  function imgEl(src, alt) {
    const img = el('img', { class: 'msg-image', src, alt, loading: 'lazy', decoding: 'async' });
    img.addEventListener('click', () => openLightbox(img));
    img.addEventListener('load', () => { if (atBottom(img.naturalHeight + 160)) scrollToBottom(); }, { once: true });
    return img;
  }

  function stickerView(sticker) {
    const m = /^([A-Za-z0-9]+)\/([A-Za-z0-9_-]+)$/.exec(sticker);
    if (m) {
      watchCustoms(m[1]);
      const item = S.customs[m[1]] && S.customs[m[1]][m[2]];
      if (item && customUsable(m[1], item)) return el('img', { class: 'sticker-img', src: item.data, alt: 'Sticker ' + item.name, title: item.name });
      return el('div', { class: 'msg-deleted', text: item ? 'Sticker is being checked…' : 'Sticker unavailable.' });
    }
    return el('div', { class: 'sticker-emoji', text: sticker });
  }

  // ---------- Conversation header, banner, typing ----------

  function renderConvHead() {
    const c = S.conv;
    if (!c) return;
    if (c.type === 'dm') {
      $('convAvatar').replaceChildren(avatar(c.other, null, true));
      $('convTitle').textContent = nameOf(c.other);
      const u = S.users[c.other];
      $('convSub').replaceChildren(document.createTextNode(presence[c.other] ? 'online' : 'offline'), u && u.bio ? ' · ' + u.bio : '');
      $('membersBtn').classList.add('hidden');
    } else {
      const meta = S.rooms[c.id] && S.rooms[c.id].meta;
      $('convAvatar').replaceChildren(el('span', { class: 'room-icon', text: meta ? meta.name[0].toUpperCase() : '#' }));
      $('convTitle').textContent = meta ? meta.name : c.id;
      const n = Object.keys(S.members).length;
      $('convSub').replaceChildren(el('span', { class: 'code-chip', title: 'Copy invite code', text: c.id, onclick: copyCode }), ' ' + n + (n === 1 ? ' member' : ' members'));
      $('membersBtn').classList.remove('hidden');
      $('membersBtn').classList.toggle('active', S.showMembers);
    }
    const inThis = voice && voice.scope === c.type && voice.id === c.id;
    $('voiceBtn').classList.toggle('active', !!inThis);
    $('voiceBtn').title = inThis ? 'Leave voice' : 'Join voice';
  }

  function renderConvBanner() {
    const c = S.conv;
    const b = $('convBanner');
    let text = '';
    let action = null;
    if (amBanned()) text = 'Your account is suspended' + (S.bans[S.me.uid].reason ? ': ' + S.bans[S.me.uid].reason : '.') + ' You can read but not post.';
    else if (c && c.type === 'dm' && isBlocked(c.other)) { text = 'You blocked ' + nameOf(c.other) + '.'; action = btn('Unblock', 'btn-sm btn-ghost', () => setBlocked(c.other, false)); }
    else if (c && c.type === 'room' && S.roomMuted[S.me.uid]) text = 'The host has muted you in this room.';
    b.replaceChildren(text, action || '');
    b.classList.toggle('hidden', !text);
    const locked = !!text;
    $('composerInput').disabled = locked;
    $('composerInput').placeholder = locked ? "You can't send messages here" : c ? (c.type === 'dm' ? 'Message ' + nameOf(c.other) : 'Message ' + ((S.rooms[c.id] && S.rooms[c.id].meta && S.rooms[c.id].meta.name) || '')) : 'Message';
    ['sendBtn', 'attachBtn', 'gifBtn', 'stickerBtn', 'emojiBtn'].forEach((id) => { $(id).disabled = locked; });
  }

  function renderTyping() {
    const now = Date.now();
    const who = Object.entries(S.typing).filter(([uid, ts]) => uid !== S.me.uid && now - ts < 6000 && !isBlocked(uid)).map(([uid]) => nameOf(uid));
    $('typing').textContent = !who.length ? '' : who.length === 1 ? who[0] + ' is typing…' : who.length < 4 ? who.join(', ') + ' are typing…' : 'Several people are typing…';
  }

  let typingSent = 0;
  function sendTyping() {
    if (!S.conv || Date.now() - typingSent < 3000) return;
    typingSent = Date.now();
    const ref = R(typingPath(S.conv) + '/' + S.me.uid);
    rtSet(ref, Date.now()).catch(() => {});
    onDisconnect(ref).remove();
  }
  function stopTyping() {
    if (!S.conv || !typingSent) return;
    typingSent = 0;
    rtRemove(R(typingPath(S.conv) + '/' + S.me.uid)).catch(() => {});
  }

  function copyCode() {
    const code = S.conv && S.conv.id;
    if (!code) return;
    const link = location.origin + location.pathname + '#join/' + code;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Invite link copied.'), () => toast('Room code: ' + code));
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
      const mine = sortedKeys().reverse().map((k) => [k, S.msgs.get(k)]).find(([, m]) => m.from === S.me.uid && m.text && !m.deleted && !m.kind);
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
    imgs.forEach((p) => msgs.push({ image: p.data, scan: 'pending' }));
    if (reply) msgs[0].replyTo = reply;

    input.value = ''; saveDraft(); autoGrow();
    S.reply = null; S.pendingImages = []; renderBars(); closePopover(); stopTyping();
    for (const m of msgs) {
      try { await postMessage(m); } catch (err) { fail(err, sendErrorText()); input.value = text || ''; autoGrow(); break; }
    }
  }

  function sendErrorText() {
    const c = S.conv;
    if (amBanned()) return 'Your account is suspended.';
    if (c && c.type === 'dm') return "Couldn't send. They may have blocked you.";
    if (c && c.type === 'room' && S.roomMuted[S.me.uid]) return "You're muted in this room.";
    return "Couldn't send that message.";
  }

  // One batch: the message, the conversation's "last message" summary and my read marker.
  function postMessage(fields) {
    const c = S.conv;
    const me = S.me.uid;
    const batch = writeBatch(fs);
    batch.set(doc(collection(fs, c.base, 'messages')), Object.assign({ from: me, ts: NOW() }, fields));
    const last = { from: me, text: (preview(fields) || '…').slice(0, 200) };
    if (c.type === 'dm') batch.set(doc(fs, 'dms', c.id), { members: c.id.split('_'), updatedAt: NOW(), last });
    else batch.update(doc(fs, 'rooms', c.id), { updatedAt: NOW(), last });
    batch.set(doc(fs, 'readState', me, 'convs', convKey(c)), { at: NOW() });
    return batch.commit();
  }

  function roomSystem(code, text) {
    const batch = writeBatch(fs);
    batch.set(doc(collection(fs, 'rooms', code, 'messages')), { from: S.me.uid, ts: NOW(), kind: 'system', text });
    batch.update(doc(fs, 'rooms', code), { updatedAt: NOW(), last: { from: S.me.uid, text: (nameOf(S.me.uid) + ' ' + text).slice(0, 200) } });
    return batch.commit();
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
      if (v !== m.text) await updateDoc(doc(fs, S.conv.base, 'messages', key), { text: v, edited: true }).catch((err) => fail(err));
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
    const mine = m.from === S.me.uid;
    if (!(await confirmBox('Delete message?', mine ? "This can't be undone." : 'Delete this message from ' + nameOf(m.from) + '?', 'Delete', true))) return;
    const c = S.conv;
    try {
      await updateDoc(doc(fs, c.base, 'messages', key), DELETION());
      if (!mine && amMod()) logMod('delete_message', { path: c.base + '/messages/' + key, uid: m.from });
    } catch (err) { fail(err); }
  }

  // reactions.{uid} is that person's list of emoji (up to 8) on the message.
  function toggleReaction(key, emo) {
    const m = S.msgs.get(key);
    const mine = ((m && m.reactions && m.reactions[S.me.uid]) || []).filter((e) => e !== emo);
    const next = mine.length === ((m && m.reactions && m.reactions[S.me.uid]) || []).length ? mine.concat(emo) : mine;
    if (next.length > 8) { toast('That’s enough reactions on one message.'); return; }
    updateDoc(doc(fs, S.conv.base, 'messages', key), { ['reactions.' + S.me.uid]: next.length ? next : deleteField() }).catch((err) => fail(err));
  }

  // Invert { uid: [emoji] } into [[emoji, [uid...]]] in first-seen order.
  function reactionsByEmoji(m) {
    const out = new Map();
    for (const [uid, list] of Object.entries(m.reactions || {})) for (const e of list || []) { if (!out.has(e)) out.set(e, []); out.get(e).push(uid); }
    return [...out.entries()];
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
      const mine = Object.entries(S.customs[S.me.uid] || {}).filter(([, it]) => it.kind === 'emoji');
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
    const mine = Object.entries(S.customs[S.me.uid] || {}).filter(([, it]) => it.kind === 'sticker');
    const sendSticker = (value) => { closePopover(); postMessage({ sticker: value }).catch((err) => fail(err, sendErrorText())); };
    openPopover('sticker', el('div', null,
      el('div', { class: 'pop-head' }, el('p', { class: 'emoji-cat', text: 'Stickers' }), el('button', { class: 'link-btn', type: 'button', text: 'Add your own sticker', onclick: () => { closePopover(); openCustomsManager('sticker'); } })),
      mine.length ? el('div', { class: 'sticker-grid' }, mine.map(([id, it]) => el('button', { type: 'button', title: it.name + (it.scan !== 'ok' && SERVER_SCAN ? ' (being checked)' : ''), onclick: () => sendSticker(S.me.uid + '/' + id) }, el('img', { src: it.data, alt: it.name })))) : null,
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
    const ids = c.type === 'dm' ? [c.other] : Object.keys(S.members).filter((u) => u !== S.me.uid);
    return ids.filter((u) => S.users[u]);
  }
  function handleMentionInput() {
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos);
    const m = /(^|\s)@([A-Za-z0-9_]{0,20})$/.exec(before);
    if (!m) { if (popKind === 'mention') closePopover(); return; }
    const q = m[2].toLowerCase();
    const list = mentionCandidates().filter((u) => nameOf(u).toLowerCase().startsWith(q)).slice(0, 8);
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
    input.value = input.value.slice(0, st.start) + '@' + nameOf(uid) + ' ' + input.value.slice(end);
    input.selectionStart = input.selectionEnd = st.start + nameOf(uid).length + 2;
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
    classify(src).then((v) => { S.nsfw[key] = v; scheduleRender(false); });
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

  // ---------- DMs and rooms: create, join, leave ----------

  async function newDm() {
    let target = null;
    const name = await promptBox('New DM', 'Username', {
      max: 20, ok: 'Open',
      check: async (v) => {
        if (!/^[A-Za-z0-9_]{3,20}$/.test(v)) return "That isn't a valid username.";
        const claim = await getDoc(doc(fs, 'usernames', v.toLowerCase()));
        const uid = claim.exists() ? claim.data().uid : null;
        if (!uid) return 'No one has that username.';
        if (uid === S.me.uid) return "That's you!";
        target = uid;
        return null;
      }
    });
    if (name && target) openDm(target);
  }

  function randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = new Uint32Array(6); crypto.getRandomValues(a);
    return [...a].map((n) => chars[n % chars.length]).join('');
  }

  async function createRoom() {
    if (amBanned()) { toast('Your account is suspended.'); return; }
    const name = await promptBox('Create a room', 'Room name', { max: 40, ok: 'Create', placeholder: 'the lounge' });
    if (!name) return;
    try {
      let code;
      for (let i = 0; i < 5; i++) {
        code = randomCode();
        if (!(await getDoc(doc(fs, 'rooms', code))).exists()) break;
      }
      await setDoc(doc(fs, 'rooms', code), {
        name: name.slice(0, 40), owner: S.me.uid, createdAt: NOW(), updatedAt: NOW(),
        memberIds: [S.me.uid], muted: [], banned: []
      });
      await roomSystem(code, 'created the room');
      openRoom(code);
      openModal('Room created', el('div', null,
        el('p', { class: 'modal-text', text: 'Share this code so people can join:' }),
        el('p', { class: 'big-code', text: code })),
      [btn('Copy invite link', 'btn-outline', () => { copyCode(); closeModal(); }), btn('Done', 'btn-primary', closeModal)]);
    } catch (err) { fail(err, "Couldn't create the room."); }
  }

  async function askJoin() {
    const code = await promptBox('Join a room', 'Room code', {
      max: 6, upper: true, ok: 'Join', placeholder: 'ABC234',
      check: (v) => (/^[A-Z2-9]{6}$/.test(v) ? null : 'Codes are 6 letters and numbers.')
    });
    if (code) joinRoom(code);
  }

  async function joinRoom(code) {
    code = String(code || '').toUpperCase();
    if (S.rooms[code]) return openRoom(code);
    if (amBanned()) { toast('Your account is suspended.'); return openHome(); }
    try {
      const snap = await getDoc(doc(fs, 'rooms', code));
      if (!snap.exists()) { toast('No room with code ' + code + '.'); return openHome(); }
      const meta = snap.data();
      if (meta.memberIds.includes(S.me.uid)) return openRoom(code);
      if (meta.banned.includes(S.me.uid)) { toast("You've been removed from that room."); return openHome(); }
      await updateDoc(doc(fs, 'rooms', code), { memberIds: arrayUnion(S.me.uid) });
      await roomSystem(code, 'joined').catch(() => {});
      openRoom(code);
    } catch (err) {
      fail(err, "You can't join that room.");
      openHome();
    }
  }

  async function leaveRoom(code) {
    const r = S.rooms[code];
    const meta = r && r.meta;
    const others = ((meta && meta.memberIds) || []).filter((u) => u !== S.me.uid);
    if (meta && meta.owner === S.me.uid && others.length) {
      openModal('Leave ' + meta.name + '?', el('p', { class: 'modal-text', text: "You're the host. Hand the room to someone else first, or delete it for everyone." }), [
        btn('Cancel', 'btn-ghost', closeModal),
        btn('Delete room', 'btn-accent', async () => { closeModal(); deleteRoom(code); }),
        btn('Transfer host', 'btn-primary', () => { closeModal(); S.showMembers = true; renderMembers(); toast('Pick a new host from the member list.'); })
      ]);
      return;
    }
    if (meta && meta.owner === S.me.uid) return deleteRoom(code);
    if (!(await confirmBox('Leave room?', 'You can rejoin later with the code ' + code + '.', 'Leave'))) return;
    try {
      leaveVoiceIf('room', code);
      await roomSystem(code, 'left').catch(() => {});
      await updateDoc(doc(fs, 'rooms', code), { memberIds: arrayRemove(S.me.uid) });
      openHome();
    } catch (err) { fail(err); }
  }

  async function deleteRoom(code, skipConfirm) {
    if (!skipConfirm && !(await confirmBox('Delete room?', 'This deletes the room and all its messages for everyone.', 'Delete room', true))) return;
    try {
      leaveVoiceIf('room', code);
      await rtRemove(R('voiceRoom/' + code + '/participants/' + S.me.uid)).catch(() => {});
      await deleteDoc(doc(fs, 'rooms', code));
      if (amMod() && !(S.rooms[code] && S.rooms[code].meta && S.rooms[code].meta.owner === S.me.uid)) logMod('delete_room', { room: code });
      openHome();
    } catch (err) { fail(err); }
  }

  // ---------- Members panel and host tools ----------

  $('membersBtn').addEventListener('click', () => { S.showMembers = !S.showMembers; renderMembers(); renderConvHead(); });

  function renderMembers() {
    const pane = $('membersPane');
    const c = S.conv;
    if (!c || c.type !== 'room' || !S.showMembers) {
      pane.classList.add('hidden'); $('appView').classList.remove('with-members'); return;
    }
    pane.classList.remove('hidden'); $('appView').classList.add('with-members');
    const meta = S.rooms[c.id] && S.rooms[c.id].meta;
    const iAmHost = meta && meta.owner === S.me.uid;
    const ids = Object.keys(S.members).sort((a, b) => (S.members[b] === 'owner') - (S.members[a] === 'owner') || (presence[b] ? 1 : 0) - (presence[a] ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)));
    const row = (uid) => {
      const tags = [S.members[uid] === 'owner' ? 'host' : '', S.roomMuted[uid] ? 'muted' : '', isMod(uid) ? 'mod' : ''].filter(Boolean).join(' · ');
      const actions = iAmHost && uid !== S.me.uid ? el('div', { class: 'member-actions' },
        toolBtn(S.roomMuted[uid] ? '🔊' : '🔇', S.roomMuted[uid] ? 'Unmute' : 'Mute', () => toggleMute(uid)),
        toolBtn('👑', 'Make host', () => transferHost(uid)),
        toolBtn('🚪', 'Kick', () => kickMember(uid))) : null;
      return el('div', { class: 'member' },
        el('button', { type: 'button', class: 'member-main', onclick: () => showProfile(uid) }, avatar(uid, 'sm', true),
          el('span', { class: 'member-name', style: { color: (S.users[uid] && S.users[uid].color) || '' }, text: nameOf(uid) })),
        tags ? el('span', { class: 'member-tags', text: tags }) : null, actions);
    };
    const banned = Object.keys(S.roomBanned).filter((u) => S.roomBanned[u]);
    banned.forEach(watchUser);
    pane.replaceChildren(
      el('div', { class: 'members-scroll' },
        el('p', { class: 'side-title', text: 'Members · ' + ids.length }), ids.map(row),
        iAmHost && banned.length ? [el('p', { class: 'side-title', text: 'Kicked' }), banned.map((uid) => el('div', { class: 'member' }, avatar(uid, 'sm'), el('span', { class: 'member-name', text: nameOf(uid) }), toolBtn('↺', 'Allow back', () => unbanFromRoom(uid))))] : null),
      el('div', { class: 'members-foot' },
        btn('Copy invite link', 'btn-outline', copyCode),
        iAmHost ? btn('Rename room', 'btn-ghost', renameRoom) : null,
        btn(iAmHost ? 'Leave or delete room' : 'Leave room', 'btn-ghost', () => leaveRoom(c.id)))
    );
  }

  async function toggleMute(uid) {
    const code = S.conv.id;
    const muted = !S.roomMuted[uid];
    try {
      await updateDoc(doc(fs, 'rooms', code), { muted: muted ? arrayUnion(uid) : arrayRemove(uid) });
      if (muted) await rtRemove(R('voiceRoom/' + code + '/participants/' + uid)).catch(() => {});
      await roomSystem(code, (muted ? 'muted ' : 'unmuted ') + nameOf(uid));
    } catch (err) { fail(err); }
  }

  async function kickMember(uid) {
    const code = S.conv.id;
    if (!(await confirmBox('Kick ' + nameOf(uid) + '?', "They'll be removed and can't rejoin unless you allow them back.", 'Kick', true))) return;
    try {
      await updateDoc(doc(fs, 'rooms', code), { memberIds: arrayRemove(uid), muted: arrayRemove(uid), banned: arrayUnion(uid) });
      await rtRemove(R('voiceRoom/' + code + '/participants/' + uid)).catch(() => {});
      await roomSystem(code, 'kicked ' + nameOf(uid));
    } catch (err) { fail(err); }
  }

  async function unbanFromRoom(uid) {
    try { await updateDoc(doc(fs, 'rooms', S.conv.id), { banned: arrayRemove(uid) }); toast(nameOf(uid) + ' can rejoin now.'); } catch (err) { fail(err); }
  }

  async function transferHost(uid) {
    const code = S.conv.id;
    if (!(await confirmBox('Make ' + nameOf(uid) + ' the host?', "You'll lose host controls for this room.", 'Transfer'))) return;
    try {
      await updateDoc(doc(fs, 'rooms', code), { owner: uid });
      await roomSystem(code, 'made ' + nameOf(uid) + ' the host');
    } catch (err) { fail(err); }
  }

  async function renameRoom() {
    const code = S.conv.id;
    const meta = S.rooms[code].meta;
    const name = await promptBox('Rename room', 'Room name', { max: 40, value: meta.name, ok: 'Save' });
    if (!name || name === meta.name) return;
    try { await updateDoc(doc(fs, 'rooms', code), { name }); await roomSystem(code, 'renamed the room to ' + name); } catch (err) { fail(err); }
  }

  $('convMenuBtn').addEventListener('click', () => {
    const c = S.conv;
    if (!c) return;
    const items = [];
    if (c.type === 'dm') {
      items.push(btn('View profile', 'btn-outline btn-block', () => { closeModal(); showProfile(c.other); }));
      items.push(btn(isBlocked(c.other) ? 'Unblock' : 'Block', 'btn-outline btn-block', () => { closeModal(); setBlocked(c.other, !isBlocked(c.other)); }));
      items.push(btn('Report user', 'btn-outline btn-block', () => { closeModal(); reportUser(c.other); }));
    } else {
      items.push(btn('Copy invite link', 'btn-outline btn-block', () => { closeModal(); copyCode(); }));
      items.push(btn('Members', 'btn-outline btn-block', () => { closeModal(); S.showMembers = true; renderMembers(); renderConvHead(); }));
      items.push(btn('Leave room', 'btn-outline btn-block', () => { closeModal(); leaveRoom(c.id); }));
      if (amMod()) items.push(btn('Delete room (moderator)', 'btn-accent btn-block', () => { closeModal(); deleteRoom(c.id); }));
    }
    items.push(btn('Formatting help', 'btn-ghost btn-block', () => { closeModal(); showHelp(); }));
    openModal(c.type === 'dm' ? nameOf(c.other) : (S.rooms[c.id] && S.rooms[c.id].meta ? S.rooms[c.id].meta.name : c.id), el('div', { class: 'stack' }, items), [btn('Close', 'btn-ghost', closeModal)]);
  });

  // ---------- Profiles, blocking, reports ----------

  function showProfile(uid) {
    watchUser(uid);
    const u = S.users[uid];
    if (!u) { toast('Loading profile…'); return; }
    const me = uid === S.me.uid;
    const badges = [isMod(uid) ? el('span', { class: 'badge badge-mod', text: 'moderator' }) : null, S.bans[uid] ? el('span', { class: 'badge badge-ban', text: 'suspended' }) : null, isBlocked(uid) ? el('span', { class: 'badge', text: 'blocked' }) : null];
    const body = el('div', { class: 'profile' },
      el('div', { class: 'row' }, avatar(uid, 'xl', true), el('div', null,
        el('p', { class: 'profile-name', style: { color: u.color }, text: u.username }), el('div', { class: 'row' }, badges),
        el('p', { class: 'field-hint', text: (presence[uid] ? 'Online' : 'Offline') + (u.createdAt ? ' · joined ' + new Date(u.createdAt).toLocaleDateString() : '') }))),
      u.bio ? el('p', { class: 'profile-bio', text: u.bio }) : null
    );
    const actions = me
      ? [btn('Edit profile', 'btn-primary', () => { closeModal(); openSettings(); })]
      : [
          btn('Report', 'btn-ghost', () => { closeModal(); reportUser(uid); }),
          btn(isBlocked(uid) ? 'Unblock' : 'Block', 'btn-ghost', () => { closeModal(); setBlocked(uid, !isBlocked(uid)); }),
          amMod() ? btn('Moderate', 'btn-outline', () => { closeModal(); openModPanel('users', u.username); }) : null,
          btn('Message', 'btn-primary', () => { closeModal(); openDm(uid); })
        ].filter(Boolean);
    openModal('Profile', body, actions);
  }

  async function setBlocked(uid, on) {
    if (on && !(await confirmBox('Block ' + nameOf(uid) + '?', "They won't be able to DM you or call you, and their room messages will be hidden for you.", 'Block', true))) return;
    try {
      const bref = doc(fs, 'blocks', S.me.uid, 'users', uid);
      await (on ? setDoc(bref, { createdAt: NOW() }) : deleteDoc(bref));
      if (on && voice && voice.peers.has(uid)) closePeer(uid);
      toast(on ? nameOf(uid) + ' is blocked.' : nameOf(uid) + ' is unblocked.');
      renderConvBanner();
    } catch (err) { fail(err); }
  }

  function reportForm(title, intro, onSubmit) {
    let reason = null;
    const err = el('p', { class: 'form-error' });
    const note = el('textarea', { class: 'input', rows: 3, maxLength: 500, placeholder: 'Anything moderators should know (optional)' });
    const list = el('div', { class: 'reason-list', role: 'radiogroup' }, REPORT_REASONS.map(([value, label, hint]) =>
      el('label', { class: 'reason' + (value === 'child_safety' ? ' urgent' : '') },
        el('input', { type: 'radio', name: 'reason', value, onchange: () => { reason = value; err.textContent = ''; } }),
        el('span', null, label, hint ? el('small', { text: hint }) : null))));
    openModal(title, el('div', null,
      el('p', { class: 'modal-text', text: intro }), list, el('div', { class: 'field' }, note), err,
      el('p', { class: 'field-hint', text: 'If someone is in immediate danger, contact your local emergency number. Reports are private: the person you report is not told who reported them.' })),
    [btn('Cancel', 'btn-ghost', closeModal), btn('Send report', 'btn-accent', async () => {
      if (!reason) { err.textContent = 'Pick a reason.'; return; }
      try {
        await onSubmit(reason, note.value.trim());
        closeModal();
        afterReport(reason);
      } catch (e) { err.textContent = "Couldn't send the report. Try again."; console.error(e); }
    })]);
  }

  function afterReport(reason) {
    toast('Thanks. Moderators will review it.');
  }

  function reportMessage(key, m) {
    const path = S.conv.base + '/messages/' + key;
    reportForm('Report message', 'Report this message from ' + nameOf(m.from) + '. Moderators will see a copy of it.', async (reason, note) => {
      const snapshot = { from: m.from };
      if (m.text) snapshot.text = m.text;
      if (m.image) snapshot.image = m.image;
      if (m.sticker) snapshot.sticker = m.sticker;
      await addDoc(collection(fs, 'reports'), clean({ by: S.me.uid, ts: NOW(), type: 'message', reason, note: note || null, target: m.from, path, snapshot, status: 'open' }));
      if (!isBlocked(m.from)) setTimeout(() => offerBlock(m.from), 400);
    });
  }

  function reportUser(uid) {
    reportForm('Report ' + nameOf(uid), 'Report this account. To report a specific message, use the ⚑ button on it instead.', async (reason, note) => {
      await addDoc(collection(fs, 'reports'), clean({ by: S.me.uid, ts: NOW(), type: 'user', reason, note: note || null, target: uid, status: 'open' }));
      if (!isBlocked(uid)) setTimeout(() => offerBlock(uid), 400);
    });
  }

  function offerBlock(uid) {
    openModal('Block ' + nameOf(uid) + ' too?', el('p', { class: 'modal-text', text: "Blocking stops them DMing or calling you and hides their messages in rooms." }), [
      btn('No thanks', 'btn-ghost', closeModal),
      btn('Block', 'btn-accent', async () => { closeModal(); await setDoc(doc(fs, 'blocks', S.me.uid, 'users', uid), { createdAt: NOW() }).catch((e) => fail(e)); toast(nameOf(uid) + ' is blocked.'); })
    ]);
  }

  // ---------- Moderator tools ----------

  let modSub = null;
  function setupModWatch() {
    if (!amMod()) { if (modSub) { modSub(); modSub = null; } $('modCount').classList.add('hidden'); return; }
    if (modSub) return;
    const counts = { reports: 0, flags: 0 };
    const draw = () => {
      const n = counts.reports + counts.flags;
      $('modCount').textContent = n > 99 ? '99+' : String(n);
      $('modCount').classList.toggle('hidden', !n);
    };
    const u1 = onSnapshot(query(collection(fs, 'reports'), where('status', '==', 'open')), (qs) => { counts.reports = qs.size; draw(); if (modTab === 'reports') drawModTab(); }, () => {});
    const u2 = onSnapshot(query(collection(fs, 'flags'), where('status', '==', 'open')), (qs) => { counts.flags = qs.size; draw(); if (modTab === 'flags') drawModTab(); }, () => {});
    modSub = () => { u1(); u2(); };
  }

  function logMod(action, details) {
    return addDoc(collection(fs, 'modLog'), clean(Object.assign({ by: S.me.uid, ts: NOW(), action }, details || {}))).catch(() => {});
  }

  let modTab = null, modBody = null, modQuery = '';
  const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map(([v, l]) => [v, l]));

  function openModPanel(tab, query) {
    if (!amMod()) return;
    modTab = tab || 'reports';
    modQuery = query || '';
    modBody = el('div', { class: 'mod-body' });
    const tabs = el('div', { class: 'tabs mod-tabs' }, [['reports', 'Reports'], ['flags', 'Auto-flags'], ['users', 'Users'], ['bans', 'Suspended'], ['log', 'Log']].map(([k, label]) =>
      el('button', { type: 'button', class: 'tab' + (k === modTab ? ' active' : ''), text: label, onclick: (e) => { modTab = k; tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === e.currentTarget)); drawModTab(); } })));
    openModal('Moderation', el('div', null, tabs, modBody), [btn('Close', 'btn-ghost', closeModal)], { wide: true, onClose: () => { modTab = null; modBody = null; } });
    drawModTab();
  }
  $('modBtn').addEventListener('click', () => openModPanel('reports'));

  async function drawModTab() {
    if (!modBody) return;
    const tab = modTab;
    modBody.replaceChildren(el('p', { class: 'side-empty', text: 'Loading…' }));
    try {
      if (tab === 'reports') {
        const qs = await getDocs(query(collection(fs, 'reports'), where('status', '==', 'open')));
        const list = qs.docs.map((d) => [d.id, norm(d)]);
        list.sort((a, b) => (b[1].priority ? 1 : 0) - (a[1].priority ? 1 : 0) || b[1].ts - a[1].ts);
        list.forEach(([, r]) => { watchUser(r.by); watchUser(r.target); });
        if (modTab !== tab) return;
        modBody.replaceChildren(...(list.length ? list.map(([id, r]) => reportCard(id, r)) : [el('p', { class: 'side-empty', text: 'No open reports. Nice.' })]));
      } else if (tab === 'flags') {
        const qs = await getDocs(query(collection(fs, 'flags'), where('status', '==', 'open')));
        const list = qs.docs.map((d) => [d.id, norm(d)]);
        list.sort((a, b) => b[1].ts - a[1].ts).forEach(([, f]) => watchUser(f.uid));
        if (modTab !== tab) return;
        modBody.replaceChildren(el('p', { class: 'field-hint', text: 'Images the server scanner removed or could not check. The images themselves are already gone.' }),
          ...(list.length ? list.map(([id, f]) => el('div', { class: 'mod-card' },
            el('div', { class: 'mod-card-head' }, el('b', { text: nameOf(f.uid) }), el('span', { class: 'field-hint', text: ' · ' + fmtAgo(f.ts) })),
            el('p', { class: 'modal-text', text: f.reason + (f.strikes ? ' · strike ' + f.strikes : '') }),
            el('p', { class: 'field-hint', text: f.where }),
            el('div', { class: 'mod-actions' },
              btn('View user', 'btn-sm btn-ghost', () => { modQuery = nameOf(f.uid); modTab = 'users'; openModPanel('users', modQuery); }),
              btn('Done', 'btn-sm btn-primary', async () => { await updateDoc(doc(fs, 'flags', id), { status: 'resolved' }).catch(fail); drawModTab(); }))))
            : [el('p', { class: 'side-empty', text: 'Nothing flagged.' })]));
      } else if (tab === 'users') {
        const inputEl = el('input', { class: 'input', placeholder: 'Username', value: modQuery });
        const out = el('div');
        const look = async () => {
          modQuery = inputEl.value.trim();
          if (!modQuery) return;
          const claim = await getDoc(doc(fs, 'usernames', modQuery.toLowerCase()));
          const uid = claim.exists() ? claim.data().uid : null;
          if (!uid) { out.replaceChildren(el('p', { class: 'side-empty', text: 'No such user.' })); return; }
          watchUser(uid); watchCustoms(uid);
          const [u, strikes, customs] = await Promise.all([getDoc(doc(fs, 'users', uid)), getDoc(doc(fs, 'strikes', uid)), getDocs(collection(fs, 'customs', uid, 'items'))]);
          const items = {};
          customs.forEach((d) => { items[d.id] = norm(d); });
          out.replaceChildren(userModCard(uid, norm(u) || {}, strikes.exists() ? strikes.data().count || 0 : 0, items));
        };
        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') look(); });
        modBody.replaceChildren(el('div', { class: 'row' }, inputEl, btn('Look up', 'btn-primary', look)), out);
        if (modQuery) look();
      } else if (tab === 'bans') {
        const ids = Object.keys(S.bans);
        ids.forEach(watchUser);
        modBody.replaceChildren(...(ids.length ? ids.map((uid) => el('div', { class: 'mod-card' },
          el('div', { class: 'mod-card-head' }, el('b', { text: nameOf(uid) }), el('span', { class: 'field-hint', text: ' · ' + fmtAgo(S.bans[uid].ts) + ' by ' + (S.bans[uid].by === 'auto' ? 'the image filter' : nameOf(S.bans[uid].by)) })),
          S.bans[uid].reason ? el('p', { class: 'modal-text', text: S.bans[uid].reason }) : null,
          el('div', { class: 'mod-actions' }, btn('Lift suspension', 'btn-sm btn-outline', () => setBan(uid, false)))))
          : [el('p', { class: 'side-empty', text: 'No one is suspended.' })]));
      } else if (tab === 'log') {
        const qs = await getDocs(query(collection(fs, 'modLog'), orderBy('ts', 'desc'), limit(60)));
        const list = qs.docs.map((d) => norm(d));
        list.forEach((l) => { watchUser(l.by); if (l.uid) watchUser(l.uid); });
        if (modTab !== tab) return;
        modBody.replaceChildren(...(list.length ? list.map((l) => el('p', { class: 'mod-log' },
          el('b', { text: nameOf(l.by) }), ' ' + l.action.replace(/_/g, ' ') + (l.uid ? ' · ' + nameOf(l.uid) : '') + (l.room ? ' · room ' + l.room : '') + (l.reason ? ' · ' + l.reason : ''),
          el('span', { class: 'field-hint', text: ' ' + fmtAgo(l.ts) })))
          : [el('p', { class: 'side-empty', text: 'Nothing yet.' })]));
      }
    } catch (err) {
      console.error(err);
      if (modBody) modBody.replaceChildren(el('p', { class: 'form-error', text: "Couldn't load this. " + (err.message || '') }));
    }
  }

  function evidenceView(ev, priority) {
    const box = el('div', { class: 'evidence' });
    if (ev.text) box.append(el('p', { class: 'msg-text', text: ev.text }));
    if (ev.sticker) box.append(el('p', { class: 'field-hint', text: 'Sticker: ' + ev.sticker }));
    if (ev.image) {
      const holder = el('div', { class: 'img-held' });
      const reveal = () => {
        if (priority && !window.confirm('This was reported as child sexual abuse material. Only view it if you must to make a decision. Do not download, copy or share it.')) return;
        holder.replaceWith(el('img', { class: 'msg-image', src: ev.image, alt: 'Reported image' }));
      };
      holder.append(el('span', { text: 'Reported image hidden.' }), el('button', { class: 'link-btn', type: 'button', text: 'Reveal', onclick: reveal }));
      box.append(holder);
    }
    return box;
  }

  function reportCard(id, r) {
    const ev = r.evidence && !r.evidence.missing ? r.evidence : null;
    const setStatus = async (status, action) => {
      try {
        await updateDoc(doc(fs, 'reports', id), { status, resolvedBy: S.me.uid, resolvedAt: NOW(), action: action || status });
        logMod(status === 'dismissed' ? 'dismiss_report' : 'resolve_report', { uid: r.target, reason: action || null });
        drawModTab();
      } catch (err) { fail(err); }
    };
    return el('div', { class: 'mod-card' + (r.priority ? ' priority' : '') },
      el('div', { class: 'mod-card-head' },
        r.priority ? el('span', { class: 'badge badge-ban', text: 'urgent' }) : null,
        el('b', { text: REASON_LABEL[r.reason] || r.reason }),
        el('span', { class: 'field-hint', text: ' · ' + r.type + ' · ' + fmtAgo(r.ts) })),
      el('p', { class: 'modal-text' }, 'Reported ', el('button', { class: 'link-btn', type: 'button', text: nameOf(r.target), onclick: () => openModPanel('users', nameOf(r.target)) }), ' · by ' + nameOf(r.by)),
      r.note ? el('p', { class: 'mod-note', text: '“' + r.note + '”' }) : null,
      r.type === 'message' ? (ev ? evidenceView(ev, r.priority) : el('div', null, el('p', { class: 'field-hint', text: r.evidence && r.evidence.missing ? 'The message was already gone when the report arrived. Reporter’s copy:' : 'Reporter’s copy (not yet verified by the server):' }), r.snapshot ? evidenceView(r.snapshot, r.priority) : null)) : null,
      r.priority ? el('p', { class: 'field-hint urgent-note', text: 'Suspected child abuse material: suspend the account, then report it to the authorities (see firebase/SAFETY.md). Keep the report; do not download or share the image.' }) : null,
      el('div', { class: 'mod-actions' },
        r.path ? btn('Delete message', 'btn-sm btn-outline', async () => {
          try { await updateDoc(doc(fs, r.path), DELETION()); logMod('delete_message', { path: r.path, uid: r.target }); toast('Message deleted.'); } catch (err) { fail(err, 'Message is already gone.'); }
        }) : null,
        S.bans[r.target] || r.target === S.me.uid ? null : btn('Suspend user', 'btn-sm btn-accent', () => setBan(r.target, true, REASON_LABEL[r.reason])),
        btn('Dismiss', 'btn-sm btn-ghost', () => setStatus('dismissed')),
        btn('Resolved', 'btn-sm btn-primary', () => setStatus('resolved', 'actioned')))
    );
  }

  function userModCard(uid, u, strikes, customs) {
    const items = Object.entries(customs);
    return el('div', { class: 'mod-card' },
      el('div', { class: 'row' }, avatar(uid, 'lg', true), el('div', null, el('b', { text: u.username || uid }), el('p', { class: 'field-hint', text: 'Strikes: ' + strikes + (S.bans[uid] ? ' · suspended' : '') + (isMod(uid) ? ' · moderator' : '') }))),
      u.bio ? el('p', { class: 'modal-text', text: u.bio }) : null,
      el('div', { class: 'mod-actions' },
        S.bans[uid] ? btn('Lift suspension', 'btn-sm btn-outline', () => setBan(uid, false)) : btn('Suspend', 'btn-sm btn-accent', () => setBan(uid, true)),
        u.avatar ? btn('Remove avatar', 'btn-sm btn-outline', async () => { await updateDoc(doc(fs, 'users', uid), { avatar: deleteField(), avatarScan: deleteField() }).catch(fail); logMod('remove_avatar', { uid }); drawModTab(); }) : null,
        strikes ? btn('Clear strikes', 'btn-sm btn-ghost', async () => { await deleteDoc(doc(fs, 'strikes', uid)).catch(fail); logMod('clear_strikes', { uid }); drawModTab(); }) : null,
        btn('Message', 'btn-sm btn-ghost', () => { closeModal(); openDm(uid); })),
      items.length ? el('div', null, el('p', { class: 'side-title', text: 'Custom emoji & stickers' }), el('div', { class: 'customs-grid' }, items.map(([id, it]) =>
        el('div', { class: 'custom-item' }, el('img', { src: it.data, alt: it.name }), el('span', { text: it.name + (it.scan !== 'ok' ? ' (' + it.scan + ')' : '') }),
          btn('Remove', 'btn-sm btn-ghost', async () => { await deleteDoc(doc(fs, 'customs', uid, 'items', id)).catch(fail); logMod('remove_custom', { uid }); drawModTab(); }))))) : null);
  }

  async function setBan(uid, on, suggested) {
    if (uid === S.me.uid) return;
    try {
      if (on) {
        const reason = await promptBox('Suspend ' + nameOf(uid), 'Reason (shown to them)', { max: 200, value: suggested || '', ok: 'Suspend' });
        if (!reason) return;
        await setDoc(doc(fs, 'bans', uid), { by: S.me.uid, ts: NOW(), reason });
        logMod('suspend', { uid, reason });
        toast(nameOf(uid) + ' is suspended.');
      } else {
        await deleteDoc(doc(fs, 'bans', uid));
        logMod('unsuspend', { uid });
        toast('Suspension lifted.');
      }
      if (modBody) drawModTab(); else openModPanel('bans');
    } catch (err) { fail(err); }
  }

  // ---------- Settings ----------

  $('settingsBtn').addEventListener('click', () => openSettings());

  function openSettings() {
    const p = S.profile || {};
    let color = p.color || COLORS[0];
    const bio = el('textarea', { class: 'input', rows: 2, maxLength: 190, value: p.bio || '', placeholder: 'A little about you' });
    const avHost = el('div');
    const drawAv = () => avHost.replaceChildren(avatar(S.me.uid, 'xl'));
    drawAv();
    const avInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
    avInput.addEventListener('change', async () => {
      const f = avInput.files[0]; avInput.value = '';
      if (!f) return;
      try {
        if (amBanned()) throw new Error('Your account is suspended.');
        const data = await compress(await readAsDataURL(f), 128, 58000, true);
        if ((await classify(data)) === 'flagged') { toast("That picture can't be used."); return; }
        await updateDoc(doc(fs, 'users', S.me.uid), { avatar: data, avatarScan: 'pending' });
        toast(SERVER_SCAN ? 'Avatar updated. Others see it once it has been checked.' : 'Avatar updated.');
        setTimeout(drawAv, 300);
      } catch (err) { fail(err, err.message); }
    });
    const sw = el('div', { class: 'swatches' });
    renderSwatches(sw, color, (c) => { color = c; });

    const toggle = (label, hint, checked, onchange) => el('label', { class: 'toggle-row' },
      el('span', null, label, hint ? el('small', { text: hint }) : null),
      el('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked, e.target) }));

    const pushSupported = 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
    const blockedIds = Object.keys(S.blocks);
    blockedIds.forEach(watchUser);

    const body = el('div', { class: 'settings' },
      el('p', { class: 'side-title', text: 'Profile' }),
      el('div', { class: 'row' }, avHost, el('div', { class: 'stack' },
        btn('Upload picture', 'btn-sm btn-outline', () => avInput.click()),
        p.avatar ? btn('Remove picture', 'btn-sm btn-ghost', async () => { await updateDoc(doc(fs, 'users', S.me.uid), { avatar: deleteField(), avatarScan: deleteField() }).catch(fail); setTimeout(drawAv, 300); }) : null,
        avInput)),
      el('div', { class: 'field' }, el('label', { text: 'Colour' }), sw),
      el('div', { class: 'field' }, el('label', { text: 'Bio' }), bio),
      btn('Save profile', 'btn-primary', async () => {
        try { await updateDoc(doc(fs, 'users', S.me.uid), { color, bio: bio.value.trim() || deleteField() }); toast('Profile saved.'); } catch (err) { fail(err); }
      }),

      el('p', { class: 'side-title', text: 'Notifications' }),
      pushSupported
        ? toggle('Push notifications', 'Get DMs, calls and @mentions on this device even when chat is closed.', S.pushOn, async (on, box) => {
            box.disabled = true;
            try { if (on) await enablePush(); else await disablePush(); } catch (err) { box.checked = S.pushOn; fail(err, err.message); }
            box.disabled = false;
          })
        : el('p', { class: 'field-hint', text: 'Push notifications aren’t supported in this browser. On iPhone, add this page to your home screen first.' }),
      toggle('Sounds', null, S.settings.sounds, (on) => { S.settings.sounds = on; saveSettings(); }),
      toggle('Desktop alerts while chat is open', null, S.settings.desktop, async (on) => {
        S.settings.desktop = on; saveSettings();
        if (on && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      }),

      el('p', { class: 'side-title', text: 'Emoji & stickers' }),
      el('div', { class: 'row' }, btn('My emoji', 'btn-sm btn-outline', () => openCustomsManager('emoji')), btn('My stickers', 'btn-sm btn-outline', () => openCustomsManager('sticker'))),

      el('p', { class: 'side-title', text: 'Blocked' }),
      blockedIds.length ? el('div', null, blockedIds.map((uid) => el('div', { class: 'member' }, avatar(uid, 'sm'), el('span', { class: 'member-name', text: nameOf(uid) }),
        btn('Unblock', 'btn-sm btn-ghost', async () => { await setBlocked(uid, false); openSettings(); }))))
        : el('p', { class: 'field-hint', text: "You haven't blocked anyone." }),

      el('p', { class: 'side-title', text: 'Account' }),
      el('p', { class: 'field-hint', text: 'Signed in as ' + (p.username || '') + '.' }),
      el('div', { class: 'row' }, btn('Change password', 'btn-sm btn-outline', changePassword), btn('Help', 'btn-sm btn-ghost', showHelp), btn('Sign out', 'btn-sm btn-accent', signOut))
    );
    openModal('Settings', body, [btn('Close', 'btn-ghost', closeModal)]);
  }

  function changePassword() {
    const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const next = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const err = el('p', { class: 'form-error' });
    openModal('Change password', el('div', null,
      el('div', { class: 'field' }, el('label', { text: 'Current password' }), cur),
      el('div', { class: 'field' }, el('label', { text: 'New password' }), next, el('p', { class: 'field-hint', text: 'At least 8 characters.' })), err),
    [btn('Cancel', 'btn-ghost', closeModal), btn('Change', 'btn-primary', async () => {
      if (next.value.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
      try {
        const cred = EmailAuthProvider.credential(S.me.email, cur.value);
        await reauthenticateWithCredential(S.me, cred);
        await updatePassword(S.me, next.value);
        closeModal(); toast('Password changed.');
      } catch (e) { err.textContent = /wrong-password|invalid-credential/.test(e.code || '') ? 'Current password is wrong.' : (e.message || 'Something went wrong.'); }
    })]);
  }

  async function signOut() {
    closeModal();
    await disablePush(true).catch(() => {});
    await rtSet(R('status/' + S.me.uid), { online: false, lastChanged: rtNow() }).catch(() => {});
    await fbSignOut(auth);
    setHash('');
  }

  function openCustomsManager(kind) {
    const isEmoji = kind === 'emoji';
    const fileIn = el('input', { type: 'file', accept: 'image/png,image/gif,image/webp,image/jpeg', hidden: true });
    const grid = el('div', { class: 'customs-grid' });
    const draw = () => {
      const mine = Object.entries(S.customs[S.me.uid] || {}).filter(([, it]) => it.kind === kind);
      grid.replaceChildren(...(mine.length ? mine.map(([id, it]) => el('div', { class: 'custom-item' },
        el('img', { src: it.data, alt: it.name }),
        el('span', { text: (isEmoji ? ':' + it.name + ':' : it.name) }),
        it.scan !== 'ok' && SERVER_SCAN ? el('small', { class: 'field-hint', text: 'being checked' }) : null,
        btn('Delete', 'btn-sm btn-ghost', () => deleteDoc(doc(fs, 'customs', S.me.uid, 'items', id)).then(draw).catch(fail))))
        : [el('p', { class: 'side-empty', text: isEmoji ? 'No custom emoji yet.' : 'No custom stickers yet.' })]));
    };
    fileIn.addEventListener('change', async () => {
      const files = [...fileIn.files]; fileIn.value = '';
      for (const f of files) {
        try {
          if (amBanned()) throw new Error('Your account is suspended.');
          const base = (f.name || 'custom').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32);
          const name = await promptBox('Name it', isEmoji ? 'Emoji name (used as :name:)' : 'Sticker name', {
            max: 32, value: base.length >= 2 ? base : '', ok: 'Add',
            check: (v) => !/^[A-Za-z0-9_]{2,32}$/.test(v) ? '2 to 32 letters, numbers or underscores.'
              : isEmoji && Object.values(S.customs[S.me.uid] || {}).some((it) => it.kind === 'emoji' && it.name === v) ? 'You already have an emoji with that name.' : null
          });
          if (!name) continue;
          const raw = await readAsDataURL(f);
          const data = f.type === 'image/gif' && raw.length < 290000 ? raw : await compress(raw, isEmoji ? 96 : 320, 290000);
          if ((await classify(data)) === 'flagged') { toast("That image can't be used."); continue; }
          await addDoc(collection(fs, 'customs', S.me.uid, 'items'), { kind, name, data, scan: 'pending', createdAt: NOW() });
        } catch (err) { fail(err, err.message); }
      }
      openCustomsManager(kind);
    });
    openModal(isEmoji ? 'My emoji' : 'My stickers', el('div', null,
      el('p', { class: 'modal-text', text: isEmoji ? 'Upload small images to use as :name: emoji. Anyone can see emoji you use in messages.' : 'Upload images to send as stickers from the sticker picker.' }),
      grid, fileIn),
    [btn('Close', 'btn-ghost', closeModal), btn(isEmoji ? 'Add emoji' : 'Add sticker', 'btn-primary', () => fileIn.click())]);
    draw();
  }

  // ---------- Push notifications (Firebase Cloud Messaging) ----------

  let messaging = null;
  async function pushMessaging() {
    if (messaging) return messaging;
    try { if (await messagingSupported()) messaging = getMessaging(app); } catch (e) { messaging = null; }
    return messaging;
  }

  async function initPush() {
    let saved = null;
    try { saved = localStorage.getItem('chat.push.' + S.me.uid); } catch (e) { /* ignore */ }
    if (!saved || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { await enablePush(true); } catch (e) { console.warn('push', e); }
  }

  async function enablePush(silent) {
    if (!('serviceWorker' in navigator)) throw new Error('This browser can’t do push notifications.');
    const perm = silent ? Notification.permission : await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings.');
    const m = await pushMessaging();
    if (!m) throw new Error('This browser can’t do push notifications.');
    const reg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
    const token = await getToken(m, Object.assign({ serviceWorkerRegistration: reg }, VAPID_KEY ? { vapidKey: VAPID_KEY } : {}));
    if (!token) throw new Error('Couldn’t turn on notifications.');
    await setDoc(doc(fs, 'fcmTokens', S.me.uid, 'tokens', token), { createdAt: NOW() });
    try { localStorage.setItem('chat.push.' + S.me.uid, token); } catch (e) { /* ignore */ }
    S.pushOn = true;
    if (!pushListening) {
      pushListening = true;
      onMessage(m, (payload) => {
        const n = payload.notification || {};
        const link = (payload.fcmOptions && payload.fcmOptions.link) || '';
        const hash = link.includes('#') ? link.slice(link.indexOf('#')) : '';
        const viewing = S.conv && hash && (hash === '#dm/' + S.conv.other || hash === '#room/' + S.conv.id);
        if (!viewing) { ping(); toast((n.title || 'chat') + ': ' + (n.body || '')); }
      });
    }
    if (!silent) toast('Push notifications are on.');
  }
  let pushListening = false;

  async function disablePush(quiet) {
    let token = null;
    try { token = localStorage.getItem('chat.push.' + S.me.uid); localStorage.removeItem('chat.push.' + S.me.uid); } catch (e) { /* ignore */ }
    S.pushOn = false;
    if (token) await deleteDoc(doc(fs, 'fcmTokens', S.me.uid, 'tokens', token)).catch(() => {});
    const m = await pushMessaging();
    if (m) await deleteToken(m).catch(() => {});
    if (!quiet) toast('Push notifications are off.');
  }

  // ---------- Voice (peer-to-peer WebRTC; Firebase only carries the handshake) ----------
  // Every pair of people in a call connects directly (a mesh), so it suits small groups.
  // The person with the smaller uid sends the offer; sessions change on every join so stale
  // handshakes from an earlier join are ignored.

  let voice = null;
  const MAX_VOICE = 8;

  function randomId() { const a = new Uint8Array(9); crypto.getRandomValues(a); return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16); }
  function voiceBase(scope, id) { return (scope === 'dm' ? 'voiceDm/' : 'voiceRoom/') + id; }

  function voiceCount(key, excludeMe) {
    const parts = voiceWatch[key] || {};
    return Object.keys(parts).filter((u) => !(excludeMe && u === S.me.uid)).length;
  }

  const ringed = {};
  function onVoicePresence(key, parts) {
    const prev = voiceWatch[key] || {};
    voiceWatch[key] = parts;
    if (key.startsWith('dm:') && S.me) {
      const id = key.slice(3);
      const other = otherOf(id);
      const p = parts[other];
      const inIt = voice && voice.scope === 'dm' && voice.id === id;
      if (p && !prev[other] && !inIt && !isBlocked(other) && Date.now() - (p.joinedAt || 0) < 60000 && ringed[id] !== p.session) {
        ringed[id] = p.session;
        incomingCall(other, id);
      }
    }
    queueRerender();
  }

  function incomingCall(uid, dmId) {
    ping(); setTimeout(ping, 400);
    if (document.hidden) notify(nameOf(uid), 'is calling you', '#dm/' + uid);
    openModal('Incoming call', el('div', { class: 'call-box' }, avatar(uid, 'xl', true), el('p', { class: 'profile-name', text: nameOf(uid) }), el('p', { class: 'modal-text', text: 'wants to voice chat.' })), [
      btn('Ignore', 'btn-ghost', closeModal),
      btn('Join call', 'btn-primary', () => { closeModal(); openDm(uid); joinVoice('dm', dmId); })
    ]);
  }

  $('voiceBtn').addEventListener('click', () => {
    const c = S.conv;
    if (!c) return;
    if (voice && voice.scope === c.type && voice.id === c.id) leaveVoice();
    else joinVoice(c.type, c.id);
  });

  async function joinVoice(scope, id) {
    if (voice && voice.scope === scope && voice.id === id) return;
    if (amBanned()) { toast('Your account is suspended.'); return; }
    if (scope === 'dm' && isBlocked(otherOf(id))) { toast('Unblock them to call.'); return; }
    if (scope === 'room' && S.roomMuted[S.me.uid] && S.conv && S.conv.id === id) { toast("You're muted in this room."); return; }
    if (voiceCount(scope + ':' + id) >= MAX_VOICE) { toast('Voice is full (' + MAX_VOICE + ' people max).'); return; }
    if (!navigator.mediaDevices || !window.RTCPeerConnection) { toast("This browser doesn't support voice chat."); return; }
    let seenNotice = false;
    try { seenNotice = localStorage.getItem('chat.voiceNotice') === '1'; } catch (e) { /* ignore */ }
    if (!seenNotice) {
      const go = await confirmBox('Voice chat', 'Voice connects you directly to the other people in the call, so they can see your IP address. Only join calls with people you trust.', 'Join voice');
      if (!go) return;
      try { localStorage.setItem('chat.voiceNotice', '1'); } catch (e) { /* ignore */ }
    }
    if (voice) await leaveVoice();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (err) {
      toast(err && err.name === 'NotAllowedError' ? 'Allow microphone access to join voice.' : "Couldn't find a microphone.");
      return;
    }
    const base = voiceBase(scope, id);
    const me = S.me.uid;
    const v = voice = { scope, id, base, session: randomId(), stream, peers: new Map(), muted: false, deafened: false, parts: {}, unsubs: [], seen: new Set(), chain: Promise.resolve(), meters: {}, speaking: {} };
    const myRef = R(base + '/participants/' + me);
    const inbox = R(base + '/signals/' + me);
    try {
      await rtRemove(inbox).catch(() => {});
      await onDisconnect(myRef).remove();
      await onDisconnect(inbox).remove();
      await rtSet(myRef, { joinedAt: rtNow(), session: v.session, muted: false });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      if (voice === v) voice = null;
      fail(err, "Couldn't join voice here.");
      renderVoice();
      return;
    }
    if (voice !== v) return;
    sub(v.unsubs, R(base + '/participants'), (s) => onParticipants(v, s.val() || {}));
    v.unsubs.push(onChildAdded(inbox, (s) => handleSignals(v, s)), onChildChanged(inbox, (s) => handleSignals(v, s)));
    watchSpeaking(v, me, stream);
    v.meterTimer = setInterval(() => updateSpeaking(v), 150);
    renderVoice(); renderConvHead(); queueRerender();
  }

  function leaveVoiceIf(scope, id) { if (voice && voice.scope === scope && voice.id === id) leaveVoice(); }

  async function leaveVoice() {
    const v = voice;
    if (!v) return;
    voice = null;
    v.unsubs.forEach((f) => f());
    [...v.peers.keys()].forEach((uid) => closePeer(uid, v));
    clearInterval(v.meterTimer);
    Object.values(v.meters).forEach((m) => { try { m.ctx.close(); } catch (e) { /* ignore */ } });
    v.stream.getTracks().forEach((t) => t.stop());
    if (S.me) {
      const myRef = R(v.base + '/participants/' + S.me.uid);
      const inbox = R(v.base + '/signals/' + S.me.uid);
      onDisconnect(myRef).cancel(); onDisconnect(inbox).cancel();
      await Promise.all([rtRemove(myRef).catch(() => {}), rtRemove(inbox).catch(() => {})]);
    }
    renderVoice(); renderConvHead(); queueRerender();
  }

  function onParticipants(v, parts) {
    if (voice !== v) return;
    const me = S.me.uid;
    if (!parts[me] || parts[me].session !== v.session) {
      // Removed by the host, or joined from another tab.
      toast(parts[me] ? 'You joined voice somewhere else.' : 'You were removed from voice.');
      leaveVoice();
      return;
    }
    v.parts = parts;
    for (const uid of [...v.peers.keys()]) if (!parts[uid] || parts[uid].session !== v.peers.get(uid).session) closePeer(uid, v);
    for (const uid in parts) {
      if (uid === me || isBlocked(uid) || v.peers.has(uid)) continue;
      watchUser(uid);
      if (me < uid) createPeer(v, uid, parts[uid].session, true);
    }
    renderVoice();
  }

  function sendSignal(v, to, data) {
    return rtPush(R(v.base + '/signals/' + to + '/' + S.me.uid), Object.assign({ session: v.session, ts: rtNow() }, data)).catch((err) => console.warn('signal', err));
  }

  function createPeer(v, uid, session, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { uid, session, pc, pendingIce: [], audio: null, state: 'connecting', initiator };
    v.peers.set(uid, peer);
    v.stream.getTracks().forEach((t) => pc.addTrack(t, v.stream));
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal(v, uid, { type: 'ice', candidate: JSON.stringify(e.candidate) }); };
    pc.ontrack = (e) => {
      if (peer.audio) return;
      const a = el('audio', { autoplay: true });
      a.srcObject = e.streams[0] || new MediaStream([e.track]);
      a.muted = v.deafened;
      $('voiceAudio').append(a);
      a.play().catch(() => toast('Tap anywhere to hear voice.'));
      peer.audio = a;
      watchSpeaking(v, uid, a.srcObject);
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === 'failed' && initiator && voice === v) {
        pc.restartIce();
        pc.createOffer({ iceRestart: true }).then((o) => pc.setLocalDescription(o)).then(() => sendSignal(v, uid, { type: 'offer', sdp: pc.localDescription.sdp })).catch(() => {});
      }
      renderVoice();
    };
    if (initiator) {
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => sendSignal(v, uid, { type: 'offer', sdp: pc.localDescription.sdp })).catch((err) => console.warn('offer', err));
    }
    return peer;
  }

  function closePeer(uid, v) {
    v = v || voice;
    if (!v) return;
    const p = v.peers.get(uid);
    if (!p) return;
    v.peers.delete(uid);
    try { p.pc.close(); } catch (e) { /* ignore */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    if (v.meters[uid]) { try { v.meters[uid].ctx.close(); } catch (e) { /* ignore */ } delete v.meters[uid]; }
    renderVoice();
  }

  function handleSignals(v, fromSnap) {
    const from = fromSnap.key;
    fromSnap.forEach((sigSnap) => {
      const key = from + '/' + sigSnap.key;
      if (v.seen.has(key)) return;
      v.seen.add(key);
      const sig = sigSnap.val();
      rtRemove(sigSnap.ref).catch(() => {});
      v.chain = v.chain.then(() => processSignal(v, from, sig)).catch((err) => console.warn('signal handling', err));
    });
  }

  async function processSignal(v, from, sig) {
    if (voice !== v || isBlocked(from)) return;
    let peer = v.peers.get(from);
    if (sig.type === 'bye') { closePeer(from, v); return; }
    if (sig.type === 'offer') {
      if (!peer || peer.session !== sig.session) {
        if (peer) closePeer(from, v);
        watchUser(from);
        peer = createPeer(v, from, sig.session, false);
      }
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
      for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await sendSignal(v, from, { type: 'answer', sdp: peer.pc.localDescription.sdp });
      return;
    }
    if (!peer || peer.session !== sig.session) return;
    if (sig.type === 'answer') {
      if (peer.pc.signalingState === 'have-local-offer') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
        for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
      }
    } else if (sig.type === 'ice') {
      let cand;
      try { cand = JSON.parse(sig.candidate); } catch (e) { return; }
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(cand).catch(() => {});
      else peer.pendingIce.push(cand);
    }
  }

  function watchSpeaking(v, uid, stream) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      v.meters[uid] = { ctx, an, buf: new Uint8Array(an.fftSize) };
    } catch (e) { /* no meter */ }
  }

  function updateSpeaking(v) {
    if (voice !== v) return;
    let changed = false;
    for (const uid in v.meters) {
      const m = v.meters[uid];
      m.an.getByteTimeDomainData(m.buf);
      let sum = 0;
      for (let i = 0; i < m.buf.length; i++) { const x = (m.buf[i] - 128) / 128; sum += x * x; }
      const muted = uid === S.me.uid ? v.muted : v.parts[uid] && v.parts[uid].muted;
      const on = !muted && Math.sqrt(sum / m.buf.length) > 0.04;
      if (on !== !!v.speaking[uid]) { v.speaking[uid] = on; changed = true; }
    }
    if (changed) document.querySelectorAll('[data-voice-uid]').forEach((n) => n.classList.toggle('speaking', !!v.speaking[n.dataset.voiceUid]));
  }

  function setMuted(on) {
    if (!voice) return;
    voice.muted = on;
    voice.stream.getAudioTracks().forEach((t) => { t.enabled = !on; });
    rtSet(R(voice.base + '/participants/' + S.me.uid + '/muted'), on).catch(() => {});
    renderVoice();
  }

  function setDeafened(on) {
    if (!voice) return;
    voice.deafened = on;
    voice.peers.forEach((p) => { if (p.audio) p.audio.muted = on; });
    if (on && !voice.muted) setMuted(true);
    else renderVoice();
  }

  function voiceControls() {
    return el('div', { class: 'voice-controls' },
      el('button', { class: 'icon-btn' + (voice.muted ? ' active danger' : ''), type: 'button', title: voice.muted ? 'Unmute' : 'Mute', 'aria-label': voice.muted ? 'Unmute' : 'Mute', onclick: () => setMuted(!voice.muted) }, icon(voice.muted ? 'mic-off' : 'mic')),
      el('button', { class: 'icon-btn' + (voice.deafened ? ' active danger' : ''), type: 'button', title: voice.deafened ? 'Undeafen' : 'Deafen', 'aria-label': voice.deafened ? 'Undeafen' : 'Deafen', onclick: () => setDeafened(!voice.deafened) }, icon('headphones')),
      el('button', { class: 'icon-btn hangup', type: 'button', title: 'Leave voice', 'aria-label': 'Leave voice', onclick: leaveVoice }, icon('hangup')));
  }

  function voiceLabel(scope, id) {
    if (scope === 'dm') return nameOf(otherOf(id));
    const r = S.rooms[id];
    return r && r.meta ? r.meta.name : id;
  }

  function renderVoice() {
    if (!S.me) return;
    const dock = $('voiceDock');
    if (voice) {
      const connected = [...voice.peers.values()].filter((p) => p.state === 'connected').length;
      const others = Object.keys(voice.parts).filter((u) => u !== S.me.uid).length;
      dock.replaceChildren(
        el('button', { class: 'voice-dock-info', type: 'button', onclick: () => (voice.scope === 'dm' ? openDm(otherOf(voice.id)) : openRoom(voice.id)) },
          el('span', { class: 'voice-dock-state' + (others && connected < others ? ' connecting' : ''), text: !others ? 'Waiting for others…' : connected < others ? 'Connecting…' : 'Voice connected' }),
          el('span', { class: 'voice-dock-where', text: voiceLabel(voice.scope, voice.id) })),
        voiceControls());
      dock.classList.remove('hidden');
    } else dock.classList.add('hidden');

    const bar = $('voiceBar');
    const c = S.conv;
    if (!c) { bar.classList.add('hidden'); return; }
    const parts = voiceWatch[c.type + ':' + c.id] || {};
    const inThis = voice && voice.scope === c.type && voice.id === c.id;
    const ids = Object.keys(parts).filter((u) => !isBlocked(u));
    if (!ids.length && !inThis) { bar.classList.add('hidden'); return; }
    ids.forEach(watchUser);
    bar.replaceChildren(
      el('span', { class: 'voice-bar-title', text: '🔊 Voice' }),
      el('div', { class: 'voice-people' }, ids.map((uid) => {
        const peer = inThis && voice.peers.get(uid);
        const state = uid === S.me.uid || !inThis ? '' : peer ? peer.state : 'connecting';
        const n = el('div', { class: 'voice-person' + (inThis && voice.speaking[uid] ? ' speaking' : ''), 'data-voice-uid': uid, title: nameOf(uid) + (state && state !== 'connected' ? ' (' + state + ')' : '') },
          avatar(uid, 'sm'), el('span', { text: nameOf(uid) }), parts[uid].muted ? icon('mic-off') : null, state && state !== 'connected' ? el('span', { class: 'voice-state', text: '…' }) : null);
        return n;
      })),
      inThis ? voiceControls() : btn('Join voice', 'btn-sm btn-primary', () => joinVoice(c.type, c.id)));
    bar.classList.remove('hidden');
  }

  window.addEventListener('pagehide', () => { if (voice) leaveVoice(); });
  document.addEventListener('click', () => {
    if (voice) voice.peers.forEach((p) => { if (p.audio && p.audio.paused) p.audio.play().catch(() => {}); });
  });

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

  $('newDmBtn').addEventListener('click', newDm);
  $('createRoomBtn').addEventListener('click', createRoom);
  $('joinRoomBtn').addEventListener('click', askJoin);
  $('backBtn').addEventListener('click', () => openHome());
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    ({ 'new-dm': newDm, 'create-room': createRoom, 'join-room': askJoin })[b.dataset.act]();
  }));
  setAuthMode('in');
})();
