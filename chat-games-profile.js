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
  async function load(identity) {
    if (!await ready()) return null;
    var result = await client.from('tetris_profiles').select('*').eq('id', uid).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) {
      var profile = result.data;
      if (profile.equipped && profile.equipped.chatCode === identity.id) return profile;
      result = await client.from('tetris_profiles').update({ equipped: Object.assign({}, profile.equipped || {}, { chatCode: identity.id }) }).eq('id', uid).select().single();
      if (result.error) throw result.error;
      localStorage.setItem('chat.game-profile-changed', String(Date.now()));
      return result.data;
    }
    var row = { id: uid, name: String(identity.name || 'Player').slice(0, 24), avatar: identity.avatar || null, equipped: { banner: 'dusk', chatCode: identity.id } };
    result = await client.from('tetris_profiles').insert(row).select().single();
    if (result.error) {
      // A game tab may have created the same anonymous profile during this request.
      result = await client.from('tetris_profiles').select('*').eq('id', uid).single();
      if (result.error) throw result.error;
      var merged = Object.assign({}, result.data.equipped || {}, { chatCode: identity.id });
      result = await client.from('tetris_profiles').update({ equipped: merged }).eq('id', uid).select().single();
      if (result.error) throw result.error;
      localStorage.setItem('chat.game-profile-changed', String(Date.now()));
    }
    return result.data;
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
  window.ChatGamesProfile = { load: load, save: save };
})();
