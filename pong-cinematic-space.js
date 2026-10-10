// Pong's live courts and site UI staged in the same CSS perspective space used by Tetris's cinematic.
(function () {
  'use strict';
  var DEG = Math.PI / 180;
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function span(t, a, b) { return clamp((t - a) / (b - a)); }
  function smooth(x) { x = clamp(x); return x * x * (3 - 2 * x); }
  function lerp(a, b, x) { return a + (b - a) * x; }
  function el(tag, cls, parent, value) {
    var n = document.createElement(tag); if (cls) n.className = cls;
    if (value != null) n.textContent = value;
    if (parent) parent.appendChild(n);
    return n;
  }
  function stripIds(node) {
    if (node.removeAttribute) node.removeAttribute('id');
    node.querySelectorAll('[id]').forEach(function (item) { item.removeAttribute('id'); });
    node.querySelectorAll('button, input, select, textarea, a').forEach(function (item) { item.tabIndex = -1; });
    return node;
  }

  window.PongCinematicSpace = function (root, courts) {
    var G = window.Games, SOC = window.GameSocial, ACH = window.PongAchievements, App = window.PongApp;
    var view = el('div', 'pong-cine-view', root), world = el('div', 'pong-cine-world', view);
    var impactFlash = el('div', 'pong-cine-impact-flash', view);
    var planes = [], courtPlanes = [], featurePlanes = [], me = null, profileBits = null;
    var courtBase = [
      [-500, -120, 0, 12], [420, 110, -1400, -13], [-460, 155, -2800, 15],
      [400, -150, -4200, -14], [0, 50, -5600, 5]
    ];
    function plane(node, w, h, x, y, z, ry) {
      node.classList.add('pong-cine-plane'); node.style.width = w + 'px'; node.style.height = h + 'px';
      world.appendChild(node);
      var p = { el: node, w: w, h: h, x: x, y: y, z: z, ry: ry || 0, rx: 0, rz: 0, scale: 1, opacity: 1 };
      planes.push(p); return p;
    }
    courts.forEach(function (court, i) {
      var node = el('div', 'pong-cine-court');
      var head = el('div', 'pong-cine-court-head', node);
      var names = el('span', '', head), score = el('span', '', head);
      var face = el('div', 'pong-cine-court-face', node); face.appendChild(court.canvas);
      el('div', 'pong-cine-court-gloss', face);
      var b = courtBase[i], p = plane(node, 800, 540, b[0], b[1], b[2], b[3]);
      p.names = names; p.score = score; courtPlanes.push(p);
      p.impact = el('div', 'pong-cine-landing', face);
      el('span', 'pong-cine-landing-ring', p.impact);
      for (var bit = 0; bit < 16; bit++) {
        var shard = el('i', '', p.impact);
        var angle = bit * Math.PI * 2 / 16;
        shard.style.setProperty('--bx', Math.cos(angle).toFixed(3));
        shard.style.setProperty('--by', Math.sin(angle).toFixed(3));
        shard.style.background = bit % 3 ? '#ff36c9' : '#28e8ff';
      }
    });
    // The travelling ball exists only between boards; playfield balls remain the game's own physics.
    var transitHead = plane(el('div', 'pong-cine-transit-head'), 58, 58, 0, 0, 0, 0);
    var selectedBall = document.querySelector('#skinRow .skin-btn.active > :first-child');
    var ballIcon = selectedBall ? selectedBall.cloneNode(true) : el('span', '', null);
    if (!selectedBall) ballIcon.style.cssText = 'background:#f3e6ff;border-radius:50%';
    ballIcon.removeAttribute('id');
    transitHead.el.appendChild(ballIcon);
    var transitTail = [];
    for (var spark = 0; spark < 28; spark++) {
      var ember = plane(el('div', 'pong-cine-transit-ember'), 14, 14, 0, 0, 0, 0);
      ember.el.style.setProperty('--flame', spark < 5 ? '#f9e9ff' : spark < 16 ? '#ff36c9' : '#7b5cff');
      transitTail.push(ember);
    }
    function panel(title, cls) {
      var n = el('div', 'cine-panel ' + cls + ' pong-cine-feature');
      el('div', 'cine-panel-title', n, title);
      return n;
    }
    var ach = panel('ACHIEVEMENTS', 'cine-ach');
    var achCount = el('div', 'cine-panel-sub', ach);
    var achGrid = el('div', 'cine-grid', ach);
    var achItems = [];
    (ACH && ACH.list ? ACH.list() : []).slice(0, 18).forEach(function (a) {
      var item = el('div', 'cine-card tier-' + a.tier, achGrid);
      item.appendChild(ACH.badge(a.id, 56, !a.unlocked));
      el('span', 'cine-card-name', item, a.secret && !a.unlocked ? '???' : a.name);
      achItems.push(item);
    });
    featurePlanes.push(plane(ach, 1500, 800, -250, 0, -7000, 5));

    var profile = panel('PROFILE', 'cine-profile');
    var profileMount = el('div', 'pong-cine-profile-mount', profile);
    var previewLabel = el('div', 'cine-panel-label', profile, 'STYLE PREVIEW');
    var swatches = el('div', 'cine-swatches', profile);
    var palette = ['#c77dff', '#a020ff', '#7c6cff', '#4cc9ff', '#3d8bff', '#ff2fa6', '#28e8ff'];
    var sw = palette.map(function (color) { var n = el('span', 'cine-sw', swatches); n.style.background = color; return n; });
    profileBits = { mount: profileMount, swatches: sw, label: previewLabel };
    featurePlanes.push(plane(profile, 1050, 760, 180, 30, -9000, -5));

    var chat = panel('MESSAGES', 'cine-chat');
    var chatHead = document.querySelector('.game-chat-head');
    if (chatHead) chat.insertBefore(stripIds(chatHead.cloneNode(true)), chat.firstChild);
    var chatAction = el('div', 'pong-cine-chat-action', chat);
    el('span', '', chatAction, 'Add contact');
    var publicRow = el('div', 'pong-cine-chat-public', chat);
    el('span', 'pong-cine-chat-public-icon', publicRow, '◎');
    el('strong', '', publicRow, 'balcade public chat');
    var chatList = el('div', 'pong-cine-chat-list', chat);
    featurePlanes.push(plane(chat, 900, 550, -180, -40, -10700, 5));

    var friends = panel('FRIENDS', 'cine-friends');
    var friendList = el('div', 'pong-cine-friends-list', friends);
    featurePlanes.push(plane(friends, 900, 420, 180, 35, -12200, -5));

    // As in Tetris, the mode shot uses a clone of the real game menu, not a redrawn card.
    var menu = document.getElementById('menuPanel');
    var modes = menu ? stripIds(menu.cloneNode(true)) : panel('PICK A MODE', 'cine-modes');
    modes.classList.remove('hidden'); modes.classList.add('pong-cine-real-menu');
    var skullWrap = modes.querySelector('.gskull-wrap');
    if (skullWrap) skullWrap.remove();
    var ballPicker = modes.querySelector('.ball-picker'); if (ballPicker) ballPicker.remove();
    var menuTools = modes.querySelector('.menu-tools'); if (menuTools) menuTools.remove();
    var modeCards = Array.prototype.slice.call(modes.querySelectorAll('.mode-card, .chip'));
    featurePlanes.push(plane(modes, 850, 480, -160, 0, -13800, 5));

    var skullSource = document.querySelector('#menuPanel .gskull-wrap');
    var skulls = panel('SKULLS', 'cine-skulls');
    if (skullSource) skulls.appendChild(stripIds(skullSource.cloneNode(true)));
    else el('div', 'cine-panel-sub', skulls, 'Pong modifiers');
    var skullCards = Array.prototype.slice.call(skulls.querySelectorAll('.gskull'));
    featurePlanes.push(plane(skulls, 1150, 550, 180, -30, -15400, -5));

    function refreshSocial() {
      var current = SOC && SOC.me && SOC.me();
      var local = G && G.Profile && G.Profile.get && G.Profile.get();
      current = current || local || { name: 'Player', xp: 0, equipped: {}, badges: [] };
      if (current !== me) {
        me = current;
        profileMount.textContent = '';
        var card = el('article', 'soc-card', profileMount), banner = el('div', 'soc-banner', card);
        if (SOC && SOC.ui && SOC.ui.bannerStyle) SOC.ui.bannerStyle(banner, me);
        var top = el('div', 'soc-card-top', card);
        top.appendChild(SOC && SOC.ui ? SOC.ui.avatarEl(me, 88) : G.Profile.avatar(me, 88));
        el('span', 'soc-lv-pill', top, 'LV ' + (SOC && SOC.levelOf ? SOC.levelOf(me.xp || 0) : 1));
        var body = el('div', 'soc-card-main', card), nameRow = el('div', 'soc-name-row', body);
        nameRow.appendChild(SOC && SOC.ui ? SOC.ui.nameSpan(me, 'big') : el('strong', '', null, me.name));
        (me.badges || []).slice(0, 3).forEach(function (id) {
          if (SOC && SOC.ui && SOC.ui.hasBadge(me, id)) nameRow.appendChild(SOC.ui.badgeChip(id));
        });
        el('div', 'soc-card-meta', body, me.status || 'Playing Pong');
        if (me.bio) el('p', 'soc-bio', body, me.bio);
        if (SOC && SOC.ui && SOC.ui.levelBar) body.appendChild(SOC.ui.levelBar(me));
        var feats = (Array.isArray(me.featured) ? me.featured : []).filter(function (key) { return key.indexOf('pong:') === 0; }).map(function (key) { return key.slice(5); });
        if (feats.length && ACH) {
          el('div', 'cine-panel-label', body, 'FEATURED ACHIEVEMENTS');
          feats.slice(0, 3).forEach(function (id) {
            var a = ACH.get(id); if (!a) return;
            var f = el('div', 'soc-feat tier-' + a.tier, body);
            f.appendChild(ACH.badge(id, 40, false)); el('strong', '', f, a.name);
          });
        }
      }
      var accepted = SOC && SOC.friends ? SOC.friends().filter(function (f) { return f.status === 'accepted'; }) : [];
      friendList.textContent = ''; chatList.textContent = '';
      if (!accepted.length) {
        var invitation = el('div', 'pong-cine-invite-card', friendList);
        if (SOC && SOC.ui) invitation.appendChild(SOC.ui.avatarEl(me, 76));
        var identity = el('div', 'pong-cine-invite-identity', invitation);
        if (SOC && SOC.ui) identity.appendChild(SOC.ui.nameSpan(me, 'big'));
        el('small', '', identity, 'Invite friends from your profile');
        el('span', 'pong-cine-invite-button', friendList, 'Copy profile link');
        el('p', 'soc-empty', chatList, 'CONTACTS · Add a friend to start a direct message.');
      } else accepted.slice(0, 5).forEach(function (friend) {
        var p = friend.profile || { name: 'Player', avatar: null, equipped: {} };
        var row = el('div', 'cine-friend', friendList);
        row.appendChild(SOC.ui.avatarEl(p, 56));
        var name = SOC.ui.nameSpan(p); name.classList.add('cine-friend-name'); row.appendChild(name);
        var presence = SOC.ui.presenceOf(p);
        el('span', 'cine-friend-st s' + (presence.on ? '0' : '2'), row, presence.text);
        var conversation = el('div', 'pong-cine-chat-contact', chatList);
        conversation.appendChild(SOC.ui.avatarEl(p, 48));
        conversation.appendChild(SOC.ui.nameSpan(p));
        el('span', '', conversation, presence.text);
      });
    }
    function layout(p) {
      p.el.style.transform = 'translate3d(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px,' + p.z.toFixed(1) + 'px) rotateY(' + p.ry.toFixed(2) + 'deg) rotateX(' + p.rx.toFixed(2) + 'deg) rotateZ(' + p.rz.toFixed(2) + 'deg) scale(' + p.scale.toFixed(3) + ') translate(' + (-p.w / 2) + 'px,' + (-p.h / 2) + 'px)';
      p.el.style.opacity = p.opacity.toFixed(3);
      p.el.style.visibility = p.opacity < .01 ? 'hidden' : '';
    }
    function camera(x, y, z, yaw, pitch, roll, fov) {
      var vw = innerWidth, vh = innerHeight, safeH = Math.min(vh, vw * 9 / 16);
      var P = (safeH / 2) / Math.tan(fov * DEG / 2);
      view.style.perspective = P.toFixed(1) + 'px';
      world.style.transform = 'translateZ(' + P.toFixed(1) + 'px) rotateZ(' + roll.toFixed(2) + 'deg) rotateX(' + pitch.toFixed(2) + 'deg) rotateY(' + yaw.toFixed(2) + 'deg) translate3d(' + (-x).toFixed(1) + 'px,' + (-y).toFixed(1) + 'px,' + (-z).toFixed(1) + 'px)';
    }
    var lastRefresh = -1;
    var pointBurst = el('div', 'pong-cine-point-burst', courtPlanes[3].el, 'POINT SCORED');
    var courtKeys = [
      { t: 25, x: -530, y: -120, z: 1350 }, { t: 28.5, x: -420, y: -90, z: 780 },
      { t: 30.857, x: 390, y: 90, z: -450 }, { t: 33.857, x: -420, y: 130, z: -1950 },
      { t: 36.857, x: 370, y: -120, z: -3300 }, { t: 38, x: 400, y: -150, z: -3300 }
    ];
    var featureTimes = [39.65, 44, 46, 47.5, 49, 51, 53];
    // Arrival frames fall on 140-BPM beats in the soundtrack.
    var jumps = [{ start: 28.357, end: 30.857, from: 0, to: 1 },
      { start: 31.357, end: 33.857, from: 1, to: 2 },
      { start: 34.357, end: 36.857, from: 2, to: 3 }];
    function ballPath(jump, u) {
      var a = courtBase[jump.from], b = courtBase[jump.to], e = smooth(u);
      return { x: lerp(a[0], b[0], e) + Math.sin(u * Math.PI) * 90,
        y: lerp(a[1], b[1], e) - Math.sin(u * Math.PI) * 60,
        z: lerp(a[2] + 90, b[2] + 90, e) };
    }
    function travel(t) {
      var jump = jumps.find(function (j) { return t >= j.start && t <= j.end; });
      if (jump) {
        var u = span(t, jump.start, jump.end), at = ballPath(jump, u);
        transitHead.x = at.x; transitHead.y = at.y; transitHead.z = at.z;
        transitHead.scale = 1 + Math.sin(u * Math.PI) * .55;
        transitHead.opacity = 1;
        transitTail.forEach(function (p, i) {
          var lag = (i + 1) * .003, behind = ballPath(jump, Math.max(0, u - lag));
          p.x = behind.x + Math.sin(t * 31 + i * 8.7) * (1 + i * .15);
          p.y = behind.y + Math.cos(t * 25 + i * 5.3) * (1 + i * .15);
          p.z = behind.z + 20 + i * 8;
          p.rz = 90;
          p.scale = Math.max(.25, 2.2 - i * .07);
          p.opacity = Math.min(1, u * 9) * (1 - i / transitTail.length) * (i % 3 ? .7 : 1);
        });
      } else if (t >= 53 && t < 54.5) {
        var returnU = span(t, 53, 54.5), fly = smooth(returnU);
        transitHead.x = lerp(180, 0, fly) + Math.sin(t * 24) * 24;
        transitHead.y = lerp(-30, 50, fly) - Math.sin(returnU * Math.PI) * 70;
        transitHead.z = lerp(-15000, -5510, fly);
        transitHead.scale = 1.2 + returnU * .7; transitHead.opacity = 1;
        transitTail.forEach(function (p, i) {
          var back = Math.max(0, returnU - (i + 1) * .003), b = smooth(back);
          p.x = lerp(180, 0, b) + Math.sin(t * 22 + i * 4.2) * (1 + i * .15);
          p.y = lerp(-30, 50, b) - Math.sin(back * Math.PI) * 70 + Math.cos(t * 19 + i) * (1 + i * .15);
          p.z = lerp(-15000, -5510, b) - i * 28;
          p.rz = -90;
          p.scale = Math.max(.25, 2.2 - i * .07);
          p.opacity = Math.min(1, returnU * 12) * (1 - i / transitTail.length);
        });
      } else { transitHead.opacity = 0; transitTail.forEach(function (p) { p.opacity = 0; }); }
      courtPlanes.forEach(function (p, i) {
        var landed = jumps.find(function (j) { return j.to === i && t >= j.end && t < j.end + .55; });
        var returnLand = i === 4 && t >= 54.5 && t < 55;
        var e = landed ? span(t, landed.end, landed.end + .55) : returnLand ? span(t, 54.5, 55) : 1;
        p.impact.style.opacity = landed || returnLand ? (1 - e).toFixed(3) : '0';
        if (landed || returnLand) {
          p.impact.firstChild.style.transform = 'scale(' + (.3 + e * 8).toFixed(2) + ')';
          Array.prototype.forEach.call(p.impact.querySelectorAll('i'), function (bit, index) {
            var angle = index * Math.PI * 2 / 16;
            bit.style.transform = 'translate(' + (Math.cos(angle) * e * 390).toFixed(1) + 'px,' + (Math.sin(angle) * e * 240).toFixed(1) + 'px) rotate(' + (e * 100).toFixed(1) + 'deg)';
          });
        }
      });
    }
    function track(keys, t) {
      var i = 0; while (i < keys.length - 2 && keys[i + 1].t < t) i++;
      var a = keys[i], b = keys[i + 1], u = smooth(span(t, a.t, b.t));
      return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) };
    }
    function draw(t) {
      var active = t >= 25 && t < 55 && !(t >= 38 && t < 38.82);
      view.style.display = active ? '' : 'none';
      if (!active) return;
      var portrait = innerWidth / innerHeight < .75;
      courtPlanes.forEach(function (p) { p.scale = portrait ? 1.35 : 1; });
      featurePlanes.forEach(function (p, index) {
        p.scale = portrait ? [1.08, 1.42, 1.45, 1.45, 1.5, 1.2][index] : 1;
      });
      impactFlash.style.opacity = t >= 54.5 ? (Math.exp(-(t - 54.5) * 17) * .56).toFixed(3) : '0';
      var i, p, u;
      if (t < 38) {
        var move = track(courtKeys, t);
        camera(move.x + Math.sin(t * 1.5) * 42, move.y + Math.cos(t * 1.2) * 28,
          move.z, Math.sin(t * 1.7) * 2, Math.sin(t * 1.3) * 1.5,
          Math.sin(t * 2.2) * 2.3, 59);
      } else if (t < 39.65) {
        u = span(t, 38.82, 39.65);
        camera(400 + Math.sin(u * 4) * 80, -150 + Math.cos(u * 5) * 35,
          -4200 + lerp(1050, 780, smooth(u)), -2, -1, Math.sin(u * 5) * 1.5, 55);
        var scored = courts[3].state.score[0] > 6;
        pointBurst.style.opacity = scored ? (1 - span(t, 39.27, 39.65)).toFixed(2) : '0';
        pointBurst.style.transform = 'translate(-50%,-50%) scale(' + (1 + span(t, 38.82, 39.65) * .22).toFixed(2) + ')';
      } else if (t < 53) {
        var current = 0;
        while (current < featurePlanes.length - 1 && t >= featureTimes[current + 1]) current++;
        var target = featurePlanes[current], previous = featurePlanes[Math.max(0, current - 1)];
        var sweep = current ? smooth(span(t, featureTimes[current], featureTimes[current] + .45)) : 1;
        var distance = [1250, 970, 900, 900, 840, 1150][current];
        var previousDistance = [1250, 970, 900, 900, 840, 1150][Math.max(0, current - 1)];
        camera(lerp(previous.x, target.x, sweep) + Math.sin(t * 2.4) * 26,
          lerp(previous.y, target.y, sweep) + Math.cos(t * 1.8) * 16,
          lerp(previous.z + previousDistance, target.z + distance, sweep) - span(t, featureTimes[current], featureTimes[current + 1]) * 90,
          Math.sin(t * 1.4) * 1.2, -.5, Math.sin(t * 2.1) * 1.2, 55);
        if (Math.floor(t) !== lastRefresh) { refreshSocial(); lastRefresh = Math.floor(t); }
        achItems.forEach(function (node, j) { node.classList.toggle('on', j < Math.floor(span(t, 39.65, 43.8) * achItems.length)); });
        achCount.textContent = (ACH && ACH.count ? ACH.count().unlocked : 0) + ' / ' + (ACH && ACH.count ? ACH.count().total : achItems.length) + ' unlocked';
        profileBits.swatches.forEach(function (node, j) { node.classList.toggle('on', j === Math.floor((t - 44) * 4) % node.parentNode.children.length); });
        modeCards.forEach(function (node, j) { node.classList.toggle('cine-hl', j === Math.floor((t - 49) * 3) % modeCards.length); });
        skullCards.forEach(function (node, j) { node.classList.toggle('on', j === Math.floor((t - 51) * 4) % skullCards.length); });
        featurePlanes.forEach(function (f, j) { f.opacity = j === current ? 1 : j === current + 1 || j === current - 1 ? .34 : 0; });
      } else {
        u = smooth(span(t, 53, 54.5));
        var shake = t >= 54.5 ? Math.exp(-(t - 54.5) * 11) : 0;
        camera(lerp(180, 0, u) + Math.sin(t * 4) * 20 + Math.sin(t * 97) * shake * 18,
          lerp(-30, 50, u) + Math.cos(t * 89) * shake * 13,
          lerp(-14340, -4800, u), Math.sin(t * 2) * 1.5, -.5, Math.sin(t * 3) * 2, 55);
        featurePlanes.forEach(function (f, j) { f.opacity = j === 5 ? 1 - span(t, 53, 53.35) : 0; });
      }
      for (i = 0; i < courtPlanes.length; i++) {
        p = courtPlanes[i];
        var b = courtBase[i];
        p.x = b[0] + Math.sin(t * 1.2 + i * 1.9) * 80;
        p.y = b[1] + Math.cos(t * 1.5 + i) * 60;
        p.ry = b[3] + Math.sin(t * 1.7 + i) * 9;
        p.rx = Math.cos(t * .8 + i) * 5;
        p.opacity = t >= 53 ? (i === 4 ? span(t, 54.05, 54.4) : 0) : t >= 39.65 ? 0 : t >= 38 ? (i === 3 ? 1 : .18) : (t < 31 && i > 1 ? 0 : 1);
        p.names.textContent = i === 0 ? ((me && me.name) || 'You') + ' / CPU' : 'MATCH ' + (i + 1) + ' / CPU';
        p.score.textContent = courts[i].state.score.join(' : ');
      }
      if (t < 39.65) featurePlanes.forEach(function (f) { f.opacity = 0; });
      travel(t);
      planes.forEach(layout);
    }
    return { draw: draw, dispose: function () { view.remove(); } };
  };
})();
