// Bridges the existing game social profile into the browser-only P2P chat identity.
// Supabase stores game profile cosmetics and achievements; it never carries chat messages.
(function () {
  'use strict';
  var client = null, uid = null, pending = null;
  var cfg = window.GAMES_SUPABASE || {};
  function ready() {
    if (pending) return pending;
    pending = (async function () {
      if (!window.supabase || !cfg.url || !cfg.anonKey) return null;
      client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tetris-auth' } });
      var result = await client.auth.getSession();
      if (result.error) throw result.error;
      var session = result.data.session;
      if (!session) {
        result = await client.auth.signInAnonymously();
        if (result.error) throw result.error;
        session = result.data.session;
      }
      uid = session.user.id;
      // a device linked to another account acts as that account (the device-links migration)
      try { var me = await client.rpc('tetris_me'); if (!me.error && me.data) uid = me.data; } catch (e) { /* not migrated yet */ }
      return uid;
    })().catch(function (error) { console.warn('[chat games profile]', error); return null; });
    return pending;
  }
  async function peek() {
    if (!await ready()) throw new Error('Profile service is unavailable.');
    var result = await client.from('tetris_profiles').select('*').eq('id', uid).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }
  async function create(name) {
    if (!await ready()) throw new Error('Profile service is unavailable.');
    var row = { id: uid, name: String(name || 'Player').slice(0, 24), equipped: { banner: 'dusk' } };
    var result = await client.from('tetris_profiles').insert(row).select().single();
    if (result.error) {
      var existing = await peek();
      if (!existing) throw result.error;
      return existing;
    }
    localStorage.setItem('chat.game-profile-changed', String(Date.now()));
    window.dispatchEvent(new Event('chat:profile-created'));
    return result.data;
  }
  // A short name for this device, shown when friends pick which of your devices to message.
  // The player's own nickname for this device wins (chat › Devices & sync); otherwise one made from the browser.
  function deviceLabel() {
    try { var nick = (localStorage.getItem('chat.deviceName') || '').trim(); if (nick) return nick.slice(0, 40); } catch (e) { /* blocked */ }
    var ua = navigator.userAgent || '';
    var kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
      : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet') : /Windows/.test(ua) ? 'Windows PC'
      : /Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux PC' : 'Device';
    var browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return kind + (browser ? ' · ' + browser : '');
  }

  // Every device keeps its own chat code; the profile lists them all (equipped.chatDevices) so friends can reach any
  // of them. chatCode stays the most recent device, for older pages.
  async function load(identity) {
    var profile = await peek();
    if (profile) {
      var eq = profile.equipped || {}, list = Array.isArray(eq.chatDevices) ? eq.chatDevices.filter(function (d) { return d && d.c; }) : [];
      var mine = list.filter(function (d) { return d.c === identity.id; })[0];
      var fresh = mine && mine.at && mine.l === deviceLabel() && Date.now() - new Date(mine.at).getTime() < 6 * 3600000;
      if (eq.chatCode === identity.id && fresh) return profile;
      list = list.filter(function (d) { return d.c !== identity.id; });
      list.unshift({ c: identity.id, l: deviceLabel(), at: new Date().toISOString() });
      var result = await client.from('tetris_profiles').update({ equipped: Object.assign({}, eq, { chatCode: identity.id, chatDevices: list.slice(0, 8) }) }).eq('id', uid).select().single();
      if (result.error) throw result.error;
      localStorage.setItem('chat.game-profile-changed', String(Date.now()));
      return result.data;
    }
    return null;
  }
  async function save(patch) {
    if (!await ready()) return null;
    var clean = {};
    if (patch.name != null) clean.name = String(patch.name).slice(0, 24);
    if (patch.bio != null) clean.bio = String(patch.bio).slice(0, 190);
    if (patch.avatar === null || (typeof patch.avatar === 'string' && patch.avatar.length < 70000 && /^data:image\/(png|jpeg|webp);base64,/.test(patch.avatar))) clean.avatar = patch.avatar;
    if (patch.banner === null || (typeof patch.banner === 'string' && patch.banner.length < 120000 && /^data:image\/(jpeg|webp);base64,/.test(patch.banner))) clean.banner = patch.banner;
    if (!Object.keys(clean).length) return null;
    var result = await client.from('tetris_profiles').update(clean).eq('id', uid).select().single();
    if (result.error) throw result.error;
    localStorage.setItem('chat.game-profile-changed', String(Date.now()));
    return result.data;
  }
  // Rename this device: remembered here and written to the profile's device list straight away.
  async function renameDevice(identity, name) {
    name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    try { if (name) localStorage.setItem('chat.deviceName', name); else localStorage.removeItem('chat.deviceName'); } catch (e) { /* blocked */ }
    return load(identity);
  }
  window.ChatGamesProfile = { peek: peek, create: create, load: load, save: save, deviceLabel: deviceLabel, renameDevice: renameDevice };
})();
