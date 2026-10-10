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
  async function load(identity) {
    var profile = await peek();
    if (profile) {
      if (profile.equipped && profile.equipped.chatCode === identity.id) return profile;
      var result = await client.from('tetris_profiles').update({ equipped: Object.assign({}, profile.equipped || {}, { chatCode: identity.id }) }).eq('id', uid).select().single();
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
  window.ChatGamesProfile = { peek: peek, create: create, load: load, save: save };
})();
