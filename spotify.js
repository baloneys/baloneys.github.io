// spotify.js: homepage music dock.
// Everyone gets Spotify's official embedded player for the playlist.
// Visitors with Spotify Premium can "Connect Spotify" for the custom baloneys player
// (Web Playback SDK), which starts at 30% volume.
(function () {
  'use strict';

  var CONFIG = {
    playlistId: '1TvmUKdRCv9QvYrCp8p64o',
    // From https://developer.spotify.com/dashboard. Leave empty to show only the official player.
    clientId: '1a28896a59e84cc4b9a700c6030f4158',
    redirectUri: location.origin + '/',
    startVolume: 0.3,
    scopes: 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state'
  };

  var PLAYLIST_URI = 'spotify:playlist:' + CONFIG.playlistId;
  var $ = function (s) { return document.getElementById(s); };
  var dock = $('musicDock'), bubble = $('mdBubble');
  if (!dock) return;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem('md_' + k); if (v === null) localStorage.removeItem('md_' + k); else localStorage.setItem('md_' + k, v); } catch (e) { return null; } }

  /* =================================================================
     Dock chrome: minimise, expand, first-interaction start
     ================================================================= */

  var interacted = false;
  var onFirstInteraction = [];

  function whenInteracted(fn) { if (interacted) fn(); else onFirstInteraction.push(fn); }

  function firstInteraction() {
    if (interacted) return;
    interacted = true;
    $('mdHint').classList.add('hidden');
    onFirstInteraction.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) {
    document.addEventListener(ev, firstInteraction, { once: false, capture: true, passive: true });
  });

  function setMinimised(min) {
    dock.classList.toggle('hidden', min);
    bubble.classList.toggle('hidden', !min);
    store('min', min ? '1' : null);
  }

  $('mdMin').addEventListener('click', function () { setMinimised(true); });
  bubble.addEventListener('click', function () { setMinimised(false); });
  var savedMin = store('min');
  setMinimised(savedMin === '1' || (savedMin === null && window.innerWidth < 600));

  var expanded = false;
  $('mdExpand').addEventListener('click', function () {
    expanded = !expanded;
    var frame = $('mdEmbedWrap').querySelector('iframe');
    if (frame) frame.style.height = (expanded ? 352 : 152) + 'px';
    $('mdExpand').setAttribute('aria-label', expanded ? 'Hide tracklist' : 'Show tracklist');
  });

  /* =================================================================
     Official embed (everyone)
     ================================================================= */

  var embed = null;

  window.onSpotifyIframeApiReady = function (IFrameAPI) {
    IFrameAPI.createController($('mdEmbed'), { uri: PLAYLIST_URI, width: '100%', height: 152 }, function (controller) {
      embed = controller;
      controller.addListener('playback_update', function (e) {
        bubble.classList.toggle('playing', !!(e && e.data && !e.data.isPaused));
      });
      // Browsers block sound until the visitor interacts, so start on their first click / tap / key.
      whenInteracted(function () { if (!custom.active) controller.play(); });
    });
  };

  function loadScript(src) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    document.head.appendChild(s);
  }

  /* =================================================================
     Custom player (Spotify Premium via Web Playback SDK)
     ================================================================= */

  var custom = { active: false, player: null, deviceId: null, state: null, stateAt: 0, seeking: false, started: false };

  function b64url(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString(n) {
    var a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return b64url(a).slice(0, n);
  }

  function login() {
    var verifier = randomString(64), state = randomString(16);
    store('verifier', verifier);
    store('state', state);
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (hash) {
      var q = new URLSearchParams({
        client_id: CONFIG.clientId,
        response_type: 'code',
        redirect_uri: CONFIG.redirectUri,
        scope: CONFIG.scopes,
        code_challenge_method: 'S256',
        code_challenge: b64url(hash),
        state: state
      });
      location.href = 'https://accounts.spotify.com/authorize?' + q.toString();
    });
  }

  function saveTokens(t) {
    if (t.access_token) store('access', t.access_token);
    if (t.refresh_token) store('refresh', t.refresh_token);
    if (t.expires_in) store('expires', String(Date.now() + (t.expires_in - 60) * 1000));
  }

  function clearTokens() { ['access', 'refresh', 'expires', 'verifier', 'state'].forEach(function (k) { store(k, null); }); }

  function tokenRequest(body) {
    return fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body)
    }).then(function (r) { if (!r.ok) throw new Error('token ' + r.status); return r.json(); });
  }

  // Finish the login redirect (?code=…) if there is one.
  function handleRedirect() {
    var q = new URLSearchParams(location.search);
    var code = q.get('code'), error = q.get('error');
    if (!code && !error) return Promise.resolve();
    var clean = location.pathname + location.hash;
    history.replaceState(null, '', clean);
    if (error || q.get('state') !== store('state')) { showError('Spotify connection was cancelled.'); return Promise.resolve(); }
    return tokenRequest({
      client_id: CONFIG.clientId,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: CONFIG.redirectUri,
      code_verifier: store('verifier')
    }).then(saveTokens).catch(function () { showError('Couldn\'t connect to Spotify. Try again.'); });
  }

  function getToken() {
    var access = store('access'), expires = +store('expires') || 0, refresh = store('refresh');
    if (access && Date.now() < expires) return Promise.resolve(access);
    if (!refresh) return Promise.reject(new Error('not connected'));
    return tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, client_id: CONFIG.clientId })
      .then(function (t) { saveTokens(t); return t.access_token; });
  }

  function api(method, path, body) {
    return getToken().then(function (token) {
      return fetch('https://api.spotify.com/v1' + path, {
        method: method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
    });
  }

  function showError(msg) {
    var e = $('mdError');
    e.textContent = msg;
    e.classList.toggle('hidden', !msg);
  }

  function useCustom(on) {
    custom.active = on;
    $('mdCustom').classList.toggle('hidden', !on);
    $('mdEmbedWrap').classList.toggle('hidden', on);
    $('mdExpand').classList.toggle('hidden', on);
    $('mdConnect').classList.toggle('hidden', on || !CONFIG.clientId);
    if (on && embed) { try { embed.pause(); } catch (e) {} }
  }

  function startCustom() {
    if (!store('refresh')) return;
    window.onSpotifyWebPlaybackSDKReady = function () {
      var player = new Spotify.Player({
        name: 'baloneys · kanaris-beans.com',
        getOAuthToken: function (cb) { getToken().then(cb, function () { disconnect('Please reconnect Spotify.'); }); },
        volume: +store('volume') || CONFIG.startVolume
      });
      custom.player = player;

      player.addListener('ready', function (e) {
        custom.deviceId = e.device_id;
        useCustom(true);
        showError('');
        whenInteracted(playPlaylist);
      });
      player.addListener('not_ready', function () { custom.deviceId = null; });
      player.addListener('player_state_changed', function (s) {
        custom.state = s;
        custom.stateAt = performance.now();
        render();
      });
      player.addListener('account_error', function () { disconnect('The custom player needs Spotify Premium. Showing the standard player instead.'); });
      player.addListener('authentication_error', function () { disconnect('Please reconnect Spotify.'); });
      player.addListener('initialization_error', function () { disconnect('This browser can\'t run the Spotify player. Showing the standard player instead.'); });
      player.addListener('autoplay_failed', function () { showError('Press play to start the music.'); });
      player.connect();
    };
    loadScript('https://sdk.scdn.co/spotify-player.js');
  }

  function playPlaylist() {
    if (!custom.player || !custom.deviceId || custom.started) return;
    custom.started = true;
    try { custom.player.activateElement(); } catch (e) {}
    api('PUT', '/me/player/play?device_id=' + encodeURIComponent(custom.deviceId), { context_uri: PLAYLIST_URI })
      .then(function (r) { if (!r.ok && r.status !== 204) throw new Error(r.status); })
      .catch(function () { custom.started = false; showError('Couldn\'t start the playlist. Press play to try again.'); });
  }

  function disconnect(msg) {
    if (custom.player) { try { custom.player.disconnect(); } catch (e) {} }
    custom.player = null;
    custom.deviceId = null;
    custom.state = null;
    custom.started = false;
    clearTokens();
    useCustom(false);
    showError(msg || '');
  }

  /* ---------- custom UI ---------- */

  function fmt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zm8 0h4v16h-4z" fill="currentColor"/></svg>';

  function position() {
    var s = custom.state;
    if (!s) return 0;
    return s.paused ? s.position : Math.min(s.duration, s.position + (performance.now() - custom.stateAt));
  }

  function render() {
    var s = custom.state;
    if (!s || !s.track_window || !s.track_window.current_track) return;
    var t = s.track_window.current_track;
    var imgs = (t.album && t.album.images) || [];
    var art = imgs.length ? imgs.slice().sort(function (a, b) { return (b.width || 0) - (a.width || 0); })[0].url : '';
    var safeArt = /^https:\/\/[a-z0-9.-]*scdn\.co\//i.test(art) ? art : '';
    $('mdArt').style.backgroundImage = safeArt ? 'url("' + safeArt + '")' : '';
    $('mdBackdrop').style.backgroundImage = safeArt ? 'url("' + safeArt + '")' : '';
    bubble.style.backgroundImage = safeArt ? 'url("' + safeArt + '")' : '';
    var song = $('mdSong');
    song.textContent = t.name || 'Unknown track';
    song.href = t.id ? 'https://open.spotify.com/track/' + encodeURIComponent(t.id) : 'https://open.spotify.com/playlist/' + CONFIG.playlistId;
    $('mdArtist').textContent = (t.artists || []).map(function (a) { return a.name; }).join(', ');
    $('mdPlay').innerHTML = s.paused ? PLAY : PAUSE;
    $('mdPlay').setAttribute('aria-label', s.paused ? 'Play' : 'Pause');
    $('mdDuration').textContent = fmt(s.duration);
    bubble.classList.toggle('playing', !s.paused);
    if (s.paused || !s.duration) showError('');
  }

  function tick() {
    var s = custom.state;
    if (s && !custom.seeking) {
      var pos = position();
      var seek = $('mdSeek');
      seek.max = s.duration || 1;
      seek.value = pos;
      seek.style.setProperty('--fill', (s.duration ? pos / s.duration * 100 : 0) + '%');
      $('mdPos').textContent = fmt(pos);
    }
    requestAnimationFrame(tick);
  }

  function paintVolume(v) {
    var vol = $('mdVolume');
    vol.value = Math.round(v * 100);
    vol.style.setProperty('--fill', Math.round(v * 100) + '%');
  }

  $('mdPlay').addEventListener('click', function () {
    if (!custom.player) return;
    if (!custom.started) return playPlaylist();
    custom.player.togglePlay();
  });
  $('mdPrev').addEventListener('click', function () { if (custom.player) custom.player.previousTrack(); });
  $('mdNext').addEventListener('click', function () { if (custom.player) custom.player.nextTrack(); });
  $('mdSeek').addEventListener('input', function (e) {
    custom.seeking = true;
    var v = +e.target.value;
    e.target.style.setProperty('--fill', (v / (+e.target.max || 1) * 100) + '%');
    $('mdPos').textContent = fmt(v);
  });
  $('mdSeek').addEventListener('change', function (e) {
    custom.seeking = false;
    if (custom.player) custom.player.seek(+e.target.value);
  });
  $('mdVolume').addEventListener('input', function (e) {
    var v = +e.target.value / 100;
    paintVolume(v);
    store('volume', String(v));
    if (custom.player) custom.player.setVolume(v);
  });
  $('mdConnect').addEventListener('click', login);
  $('mdDisconnect').addEventListener('click', function () { disconnect(''); });

  /* =================================================================
     Boot
     ================================================================= */

  $('mdConnect').classList.toggle('hidden', !CONFIG.clientId);
  paintVolume(+store('volume') || CONFIG.startVolume);
  $('mdPlay').innerHTML = PLAY;
  requestAnimationFrame(tick);
  loadScript('https://open.spotify.com/embed/iframe-api/v1');

  if (CONFIG.clientId) {
    handleRedirect().then(function () { if (store('refresh')) startCustom(); });
  }
})();
