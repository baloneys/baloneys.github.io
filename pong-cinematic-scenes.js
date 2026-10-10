// Visual scenes for the 60-second Pong opening. Audio and playback live in pong-cinematic.js.
// Courts are drawn by Pong's own renderer and updated by its real ball physics.
(function () {
  'use strict';
  var W = 1280, H = 720, CYAN = '#28e8ff', PINK = '#ff36c9', LILAC = '#c78aff';
  var TAU = Math.PI * 2;
  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function span(t, a, b) { return clamp((t - a) / (b - a)); }
  function ease(t) { t = clamp(t); return t * t * (3 - 2 * t); }
  function beatPulse(t) { return Math.pow(1 - ((t / (60 / 140)) % 1), 5); }
  function cuePulse(t, cue) { return t < cue ? 0 : Math.exp(-(t - cue) * 12); }
  function hash(n) { var v = Math.sin(n * 127.13 + 78.23) * 43758.5453; return v - Math.floor(v); }

  window.PongCinematicScenes = function (canvas, kit) {
    var ctx = canvas.getContext('2d', { alpha: false });
    var courts = [1, 2, 3, 4, 5].map(kit.make);
    var space = window.PongCinematicSpace && window.PongCinematicSpace(canvas.parentNode, courts);
    var bg = document.querySelector('.pong-bg');
    var cabinetShader = window.PongCabinet && window.PongCabinet();
    var flash = 0;
    var finalBoosted = false;
    var matchSetup = false;
    var fired = {};
    function impact(name, t, cue, amount) {
      if (t >= cue && !fired[name]) { flash = Math.max(flash, amount); fired[name] = true; }
    }

    function text(s, x, y, size, color, align) {
      ctx.save(); ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + size + 'px "JetBrains Mono", monospace';
      ctx.shadowColor = color || PINK; ctx.shadowBlur = size * 0.35;
      ctx.fillStyle = color || '#fff'; ctx.fillText(s, x, y); ctx.restore();
    }
    function line(x1, y1, x2, y2, color, width, glow) {
      ctx.save(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = color; ctx.lineWidth = width || 2;
      ctx.shadowColor = color; ctx.shadowBlur = glow || 0; ctx.stroke(); ctx.restore();
    }
    function orb(x, y, r, alpha) {
      ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha;
      var g = ctx.createRadialGradient(x, y, 1, x, y, r * 4);
      g.addColorStop(0, '#fff'); g.addColorStop(0.15, '#fbe1ff');
      g.addColorStop(0.36, PINK); g.addColorStop(0.65, 'rgba(144,42,255,.38)');
      g.addColorStop(1, 'rgba(144,42,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 0.65, 0, TAU); ctx.fill(); ctx.restore();
    }
    function hex(x, y, r, alpha) {
      ctx.save(); ctx.globalAlpha = alpha; ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = TAU * i / 6 + Math.PI / 6;
        if (!i) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath(); ctx.strokeStyle = LILAC; ctx.lineWidth = 2;
      ctx.shadowColor = PINK; ctx.shadowBlur = 20; ctx.stroke(); ctx.restore();
    }
    function backdrop(t, intensity) {
      ctx.fillStyle = '#06040d'; ctx.fillRect(0, 0, W, H);
      if (bg && bg.width && bg.height) {
        try { ctx.globalAlpha = 0.54 + intensity * 0.15; ctx.drawImage(bg, 0, 0, W, H); }
        catch (e) { /* WebGL snapshots vary by browser; the grid below is the fallback. */ }
        ctx.globalAlpha = 1;
      }
      var haze = ctx.createRadialGradient(640, 330, 60, 640, 330, 820);
      haze.addColorStop(0, 'rgba(75,17,120,.12)'); haze.addColorStop(1, 'rgba(0,0,8,.84)');
      ctx.fillStyle = haze; ctx.fillRect(0, 0, W, H);
      for (var i = 0; i < 32; i++) {
        var x = hash(i * 7) * W, y = (hash(i * 3 + 1) * H + t * (8 + hash(i) * 15)) % H;
        ctx.fillStyle = i % 3 ? 'rgba(180,90,255,.42)' : 'rgba(40,232,255,.52)';
        ctx.fillRect(x, y, 2 + hash(i + 11) * 3, 2 + hash(i + 24) * 3);
      }
      // Court-like perspective lines live in the same violet shader space.
      ctx.save(); ctx.globalAlpha = .14 + intensity * .13;
      for (var k = -10; k <= 10; k++) line(640 + k * 42, 430, 640 + k * 172, 720, k % 2 ? PINK : CYAN, 1);
      for (var y2 = 460; y2 < 750; y2 += Math.max(9, (y2 - 420) * .13)) line(0, y2, W, y2, '#9663ff', 1);
      ctx.restore();
      for (var h = 0; h < 7; h++) hex(110 + h * 185 + Math.sin(t * .3 + h) * 30, 110 + hash(h) * 310, 35 + h % 3 * 18, .07 + intensity * .07);
    }
    function frameCourt(index, x, y, w, h, angle, alpha, label) {
      var c = courts[index % courts.length];
      ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(angle || 0);
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.shadowColor = index % 2 ? PINK : CYAN; ctx.shadowBlur = 42;
      ctx.fillStyle = 'rgba(5,3,15,.92)'; ctx.fillRect(-w / 2 - 12, -h / 2 - 36, w + 24, h + 48);
      ctx.strokeStyle = index % 2 ? PINK : CYAN; ctx.lineWidth = 3;
      ctx.strokeRect(-w / 2 - 12, -h / 2 - 36, w + 24, h + 48);
      ctx.shadowBlur = 0;
      ctx.drawImage(c.canvas, -w / 2, -h / 2, w, h);
      // The highlight belongs to the ball simulated by Pong, never a second scripted ball.
      var ballX = -w / 2 + c.state.ball.x / kit.width * w;
      var ballY = -h / 2 + c.state.ball.y / kit.height * h;
      var glow = ctx.createRadialGradient(ballX, ballY, 2, ballX, ballY, Math.max(35, w * .075));
      glow.addColorStop(0, 'rgba(255,255,255,.54)');
      glow.addColorStop(.16, 'rgba(255,78,220,.24)');
      glow.addColorStop(1, 'rgba(255,78,220,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ballX, ballY, Math.max(35, w * .075), 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(7,3,18,.9)'; ctx.fillRect(-w / 2, -h / 2 - 30, w, 25);
      ctx.font = '700 ' + Math.max(12, Math.min(23, w / 28)) + 'px "JetBrains Mono",monospace';
      ctx.textBaseline = 'middle'; ctx.fillStyle = '#f8efff';
      ctx.fillText(label || 'YOU  /  RIVAL', -w / 2 + 8, -h / 2 - 17);
      ctx.textAlign = 'right'; ctx.fillText(c.state.score.join(' : '), w / 2 - 8, -h / 2 - 17);
      ctx.restore();
    }
    function speedBall(t, x, y, dx, dy, size) {
      for (var i = 12; i >= 0; i--) {
        var q = i / 12;
        orb(x - dx * i * 13, y - dy * i * 13, size * (1 - q * .55), (1 - q) * .35);
      }
      orb(x, y, size, 1);
    }
    function cabinet(t, level) {
      if (cabinetShader) {
        var approach = span(t, 0, 3.9);
        var beat = beatPulse(t), accent = Math.max(cuePulse(t, 1.7), cuePulse(t, 3.43), cuePulse(t, 4), cuePulse(t, 5.55));
        var dist = 15 - 14.1 * (1 - Math.pow(1 - approach, 3)) - beat * .18 * (1 - approach);
        var env = t < 7.4 ? ease(span(t, 0, 1.2)) : 1 - ease(span(t, 7.4, 9.4));
        if (cabinetShader.draw(ctx, t, dist, env, beat * .8 + (level || 0) * .5, accent * .12)) {
          if (t >= 4) {
            var fade = 1 - span(t, 8.8, 9.8);
            ctx.globalAlpha = fade * span(t, 4, 4.35);
            var pop = 1 + cuePulse(t, 4) * .34 + beat * .035;
            ctx.save(); ctx.translate(640, 290); ctx.scale(pop, pop);
            text('pong', 0, 0, 100, '#ff8afd'); ctx.restore();
            ctx.globalAlpha = fade * span(t, 5.5, 6.5);
            text('first to the target wins', 640, 365, 19, '#f1d3ff');
            ctx.globalAlpha = 1;
          }
          if (t < 7) {
            var scan = Math.max(cuePulse(t, 1.7), cuePulse(t, 3.43), cuePulse(t, 4));
            ctx.fillStyle = 'rgba(211,143,255,' + (scan * .24).toFixed(3) + ')';
            ctx.fillRect(0, 327 + Math.sin(t * 20) * 30, W, 5 + scan * 12);
          }
          return true;
        }
      }
      var zoom = .51 + ease(span(t, 0, 3.2)) * .62;
      ctx.save(); ctx.translate(640, 390); ctx.scale(zoom, zoom); ctx.translate(-640, -390);
      // Warehouse: shelving, crates, sparse light bars. Cabinet stays head-on.
      for (var s = 0; s < 2; s++) {
        var x = s ? 1050 : 45;
        ctx.fillStyle = 'rgba(4,3,12,.82)'; ctx.fillRect(x, 150, 180, 540);
        for (var j = 0; j < 4; j++) {
          line(x, 210 + j * 125, x + 180, 210 + j * 125, '#663389', 5, 5);
          ctx.fillStyle = '#140d23'; ctx.fillRect(x + 20, 172 + j * 125, 76, 36);
          ctx.fillRect(x + 102, 158 + j * 125, 56, 48);
        }
      }
      var g = ctx.createLinearGradient(435, 0, 845, 0);
      g.addColorStop(0, '#10091e'); g.addColorStop(.2, '#2c1645'); g.addColorStop(.8, '#140b28'); g.addColorStop(1, '#080711');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(490, 86); ctx.lineTo(790, 86);
      ctx.lineTo(842, 648); ctx.lineTo(438, 648); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ff37d6'; ctx.lineWidth = 6; ctx.shadowBlur = 22; ctx.shadowColor = PINK; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#120820'; ctx.fillRect(510, 102, 260, 70); text('BALCADE', 640, 138, 33, '#f2b8ff');
      for (var v = 0; v < 16; v++) { ctx.fillStyle = '#51336b'; ctx.fillRect(530 + v * 14, 180, 5, 3); }
      ctx.fillStyle = '#02030d'; ctx.fillRect(493, 205, 294, 272);
      ctx.strokeStyle = CYAN; ctx.lineWidth = 4; ctx.shadowColor = CYAN; ctx.shadowBlur = 15; ctx.strokeRect(499, 211, 282, 260); ctx.shadowBlur = 0;
      var crt = ctx.createRadialGradient(640, 335, 20, 640, 335, 260);
      crt.addColorStop(0, '#17072b'); crt.addColorStop(1, '#02030b');
      ctx.fillStyle = crt; ctx.fillRect(506, 218, 268, 246);
      for (var q = 0; q < 12; q++) { ctx.fillStyle = 'rgba(50,28,80,.17)'; ctx.fillRect(506, 220 + q * 20, 268, 2); }
      if (t > 3.2) {
        var flicker = t < 3.7 && Math.sin(t * 87) > .4 ? .25 : 1;
        ctx.globalAlpha = flicker * span(t, 3.2, 4.2);
        text('pong', 640, 316, 72, '#ff8afd');
        ctx.globalAlpha = span(t, 5.3, 6.6) * flicker;
        text('first to the target wins', 640, 382, 17, '#f1d3ff');
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#261137'; ctx.beginPath(); ctx.moveTo(483, 484); ctx.lineTo(796, 484);
      ctx.lineTo(843, 559); ctx.lineTo(440, 559); ctx.closePath(); ctx.fill();
      line(447, 555, 835, 555, PINK, 5, 18);
      line(558, 511, 558, 550, CYAN, 7, 17); orb(558, 505, 10, 1);
      for (var b = 0; b < 5; b++) orb(620 + b * 34, 522 + (b % 2) * 15, 5, .78);
      ctx.fillStyle = '#0b0713'; ctx.fillRect(537, 575, 205, 62);
      ctx.strokeStyle = '#5d407a'; ctx.strokeRect(537, 575, 205, 62);
      ctx.fillStyle = '#9a6dbb'; ctx.fillRect(600, 587, 80, 4);
      ctx.restore();
      return false;
    }
    function interfacePanel(title, rows, t, accent) {
      var drift = Math.sin(t * 1.7) * 9;
      ctx.save(); ctx.translate(640, 360 + drift); ctx.rotate(Math.sin(t * .9) * .023);
      ctx.shadowColor = accent || PINK; ctx.shadowBlur = 50;
      var grad = ctx.createLinearGradient(-350, -240, 350, 240);
      grad.addColorStop(0, 'rgba(35,12,70,.96)'); grad.addColorStop(1, 'rgba(7,5,20,.96)');
      ctx.fillStyle = grad; ctx.fillRect(-385, -240, 770, 480);
      ctx.strokeStyle = accent || PINK; ctx.lineWidth = 3; ctx.strokeRect(-385, -240, 770, 480);
      ctx.shadowBlur = 0; text(title, 0, -192, 38, accent || PINK);
      rows.forEach(function (row, i) {
        var y = -130 + i * 70;
        ctx.fillStyle = i === Math.floor((t * 2) % rows.length) ? 'rgba(255,54,201,.2)' : 'rgba(255,255,255,.045)';
        ctx.fillRect(-335, y - 25, 670, 55);
        ctx.strokeStyle = 'rgba(200,150,255,.35)'; ctx.strokeRect(-335, y - 25, 670, 55);
        text(row, -305, y + 2, 23, i === Math.floor((t * 2) % rows.length) ? '#fff' : LILAC, 'left');
      });
      ctx.restore();
    }
    function card(x, y, w, h, accent) {
      ctx.save();
      ctx.shadowColor = accent || PINK; ctx.shadowBlur = 30;
      ctx.fillStyle = 'rgba(17,11,38,.94)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = accent || PINK; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
    function badge(label, x, y, color) {
      ctx.save(); ctx.fillStyle = color || PINK; ctx.shadowColor = color || PINK; ctx.shadowBlur = 13;
      ctx.fillRect(x, y, 104, 35); ctx.restore(); text(label, x + 52, y + 18, 16, '#fff');
    }
    function profileShot(t) {
      var drift = Math.sin(t * 3) * 12;
      card(280 + drift, 94, 720, 536, PINK);
      var grad = ctx.createLinearGradient(300, 125, 960, 265);
      grad.addColorStop(0, '#571cad'); grad.addColorStop(1, '#f13cdb');
      ctx.fillStyle = grad; ctx.fillRect(304 + drift, 120, 672, 162);
      orb(385 + drift, 280, 26, 1); text('P', 385 + drift, 280, 42, '#fff');
      text('PLAYER', 490 + drift, 320, 38, '#fff', 'left'); badge('LV 1', 846 + drift, 304, PINK);
      text('Playing Pong', 490 + drift, 358, 17, CYAN, 'left');
      card(322 + drift, 404, 634, 58, '#6b4f9b');
      text('PROFILE   ·   COLOUR   ·   SHOWCASE', 348 + drift, 432, 20, '#f8edff', 'left');
      [CYAN, PINK, LILAC, '#a44aff'].forEach(function (color, i) {
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.arc(366 + drift + i * 58, 518, 19, 0, TAU); ctx.fill();
      }); ctx.shadowBlur = 0;
      text('Your identity across balcade', 322 + drift, 585, 18, '#d4b8f2', 'left');
    }
    function messagesShot(t) {
      card(245, 87, 790, 548, LILAC);
      ctx.fillStyle = 'rgba(101,39,145,.72)'; ctx.fillRect(245, 87, 790, 82);
      text('◉  MESSAGES', 282, 129, 29, '#fff', 'left');
      var entries = [
        ['RAZOR', 'nice shot!', CYAN], ['PIXELFOX', 'that angle 👀', PINK],
        ['YOU', 'gg!', LILAC], ['CLOVER', 'rematch?', CYAN]
      ];
      entries.forEach(function (entry, i) {
        if (t < 46.1 + i * .26) return;
        var y = 197 + i * 92;
        card(284 + (i % 2) * 70, y, 630 - (i % 2) * 70, 73, '#71488f');
        text(entry[0], 305 + (i % 2) * 70, y + 22, 15, entry[2], 'left');
        text(entry[1], 305 + (i % 2) * 70, y + 49, 20, '#fff', 'left');
      });
    }
    function friendsShot(t) {
      card(255, 93, 770, 535, CYAN);
      text('FRIENDS', 302, 139, 35, '#fff', 'left');
      [['Razor', 'Online', CYAN], ['PixelFox', 'In game', PINK], ['Clover', 'In menu', LILAC]].forEach(function (f, i) {
        var y = 188 + i * 88; card(291, y, 698, 72, '#674586');
        orb(336, y + 36, 10, .85); text(f[0], 375, y + 36, 22, '#fff', 'left');
        text(f[1], 949, y + 36, 18, f[2], 'right');
      });
      if (t > 48) {
        card(486, 455, 470, 136, PINK);
        text('Razor invited you to play', 515, 491, 19, '#fff', 'left');
        badge('ACCEPT', 570, 531, PINK); badge('DECLINE', 719, 531, '#65348f');
      }
    }
    function modeShot(t) {
      card(266, 101, 748, 518, PINK);
      text('PICK A MODE', 640, 152, 35, '#fff');
      [['vs CPU', 'One player'], ['Local', 'Two players'], ['Online', 'Play a friend']].forEach(function (m, i) {
        var x = 304 + i * 226, chosen = Math.floor((t - 49) * 2.5) % 3 === i;
        card(x, 208, 210, 188, chosen ? PINK : '#70528f');
        text(m[0], x + 105, 270, 23, chosen ? '#fff' : '#d6b9f2');
        text(m[1], x + 105, 331, 14, CYAN);
      });
      text('First to 5      7      11      Endless', 640, 475, 20, '#e5ccff');
      text('Choose your match', 640, 558, 16, LILAC);
    }
    function skullShot(t) {
      card(245, 105, 790, 510, CYAN);
      text('SKULLS  /  MODIFIERS', 640, 154, 33, '#fff');
      [['⚡', 'HYPERBALL'], ['◌', 'GHOST BALL'], ['↶', 'CURVEBALL'], ['▇', 'BIG PADDLE']].forEach(function (m, i) {
        var x = 280 + i * 190, hot = Math.floor((t - 51) * 5) % 4 === i;
        card(x, 218, 174, 252, hot ? PINK : '#654584');
        text(m[0], x + 87, 298, 68, hot ? PINK : CYAN);
        text(m[1], x + 87, 400, 16, '#fff');
      });
      text('Make every rally your own', 640, 545, 19, '#d9baf5');
    }
    function opening(t, level) {
      if (t < 9) {
        var shaderUsed = cabinet(t, level);
        if (!shaderUsed && t > 6.7) {
          ctx.fillStyle = 'rgba(0,0,0,' + ease(span(t, 6.7, 8.8)) + ')'; ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1 - span(t, 8.8, 9.8);
          text('pong', 640, 320, 90, '#ff88ec');
          text('first to the target wins', 640, 390, 21, '#dfb8ff');
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        if (t < 9.8) {
          ctx.globalAlpha = 1 - span(t, 9, 9.8);
          text('pong', 640, 290, 100, '#ff8afd');
          text('first to the target wins', 640, 365, 19, '#f1d3ff');
          ctx.globalAlpha = 1;
        }
        var p = span(t, 10.8, 12), radius = 2 + ease(p) * 28;
        if (t > 10.2) {
          var x = 640 + ease(p) * 280;
          speedBall(t, x, 360, 1, 0, radius);
          impact('launch', t, 11.82, .34);
          var hit = cuePulse(t, 11.82);
          if (hit) {
            ctx.fillStyle = 'rgba(255,255,255,' + (hit * .56).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H);
            for (var ray = 0; ray < 22; ray++) {
              var a = ray * TAU / 22, length = 140 + hit * 700;
              line(920 + Math.cos(a) * 60, 360 + Math.sin(a) * 60,
                920 + Math.cos(a) * length, 360 + Math.sin(a) * length, ray % 2 ? PINK : CYAN, 2 + hit * 4, 14);
            }
          }
        }
      }
    }
    function serveScene(t) {
      var p = span(t, 12, 18), swing = Math.sin((t - 12) * 2.9);
      frameCourt(0, 95 - p * 45, 85 + Math.sin(t * 2) * 12, 1090 + p * 130, 560 + p * 42, swing * .022, 1, 'YOU  /  RIVAL');
      impact('serve-hit-1', t, 13.35, .2);
      impact('serve-hit-2', t, 15.1, .2);
      impact('serve-hit-3', t, 16.75, .2);
    }
    function closeups(t) {
      var p = span(t, 18, 25), ball = courts[1].state.ball;
      var w = 1420 + p * 210, h = 710 + p * 55;
      var x = 640 - ball.x / kit.width * w + Math.sin(t * 2.4) * 135;
      var y = 360 - ball.y / kit.height * h + Math.cos(t * 2.1) * 55;
      frameCourt(1, x, y, w, h, Math.sin(t * 2.9) * .05, 1, 'RALLY  /  SPEED');
      // Keep this as a rally closeup; the scored point has its own shot below.
    }
    function competitive(t) {
      var p = span(t, 25, 31), spread = ease(p) * 210;
      frameCourt(0, 240 - spread, 150 - spread * .28, 650, 410, -.05 - p * .15, 1, 'YOU / CPU');
      frameCourt(2, 730 + spread * .55, 115 + spread * .4, 475, 297, .07 + p * .16, 1, 'RAZOR / PIXELFOX');
      text('03  :  02', 640, 84, 55, '#fff');
      if (t < 27) { ctx.globalAlpha = 1 - span(t, 25.3, 27); text('SCORE!', 640, 365, 120, PINK); ctx.globalAlpha = 1; }
    }
    function multiplayer(t) {
      var p = span(t, 31, 38), turn = Math.sin((t - 31) * .75);
      frameCourt(0, 46 + turn * 55, 90 + p * 12, 470, 300, -.2 + p * .1, 1, 'YOU / RAZOR');
      frameCourt(1, 685 - turn * 45, 44, 410, 257, .14 - p * .1, .9, 'PIXELFOX / NOVA');
      frameCourt(2, 96 - p * 100, 438, 340, 212, .08 + p * .09, .7, 'CLOVER / CPU');
      frameCourt(3, 834 + p * 45, 354, 390, 244, -.12, .86, 'GRIDLOCK / TESS');
      if (t > 35) { var x = 850 + Math.sin(t * 10) * 210; speedBall(t, x, 365, 1, -.2, 12); }
    }
    function matchPoint(t) {
      var p = span(t, 38, 41);
      frameCourt(3, 164 - p * 90, 80 - p * 25, 970 + p * 240, 565 + p * 140, -.04, 1, 'MATCH POINT / RAZOR');
      text(p < .64 ? '06 : 06' : '07 : 06', 640, 94, 65, '#fff');
      if (p > .55) { impact('match-point', t, 39.65, .56); text('YOU WIN!', 640, 360, 115, PINK); }
      if (p > .8) for (var i = 0; i < 65; i++) {
        var x = 640 + (hash(i) - .5) * (p - .8) * 4100, y = 360 + (hash(i + 31) - .5) * (p - .8) * 2400;
        ctx.fillStyle = i % 2 ? PINK : CYAN; ctx.fillRect(x, y, 3 + hash(i + 18) * 11, 3 + hash(i + 18) * 11);
      }
    }
    function scoringCloseup(t) {
      var ball = courts[3].state.ball;
      var w = 1880, h = 1020;
      var x = 640 - ball.x / kit.width * w - 190;
      var y = 360 - ball.y / kit.height * h + 130;
      frameCourt(3, x, y, w, h, 0, 1, 'MATCH POINT');
    }
    function features(t) {
      if (t < 44) interfacePanel('MATCH RESULTS', ['You                         07', 'Razor                       06', 'ACHIEVEMENT UNLOCKED: First Win', 'BEST RALLY                  25'], t, CYAN);
      else if (t < 46) profileShot(t);
      else if (t < 47.5) messagesShot(t);
      else if (t < 49) friendsShot(t);
      else if (t < 51) modeShot(t);
      else skullShot(t);
    }
    function finale(t) {
      var p = span(t, 55, 57);
      var ball = courts[4].state.ball, w = 1380 + p * 320, h = 720 + p * 130;
      frameCourt(4, 640 - ball.x / kit.width * w + Math.sin(t * 5) * 95,
        360 - ball.y / kit.height * h + Math.cos(t * 3) * 45,
        w, h, Math.sin(t * 8) * .045, 1, 'FINAL RALLY');
      impact('final-point', t, 56.8, .58);
    }
    function menuReturn(t) {
      var p = span(t, 57, 60);
      ctx.fillStyle = 'rgba(0,0,5,' + (1 - ease(p)) * .75 + ')'; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1 - span(t, 58.4, 59.8);
      text('pong', 640, 302, 110, '#ff86ed');
      text('first to the target wins', 640, 395, 24, '#efd2ff');
      ctx.globalAlpha = 1;
    }
    function draw(t, dt, level) {
      var realW = canvas.clientWidth || innerWidth, realH = canvas.clientHeight || innerHeight;
      var dpr = Math.min(devicePixelRatio || 1, 1.5);
      var pw = Math.round(realW * dpr), ph = Math.round(realH * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05030b'; ctx.fillRect(0, 0, pw, ph);
      // Portrait screens use a closer crop: the cabinet, ball and feature cards
      // stay readable instead of shrinking to a thin landscape strip.
      var portrait = realW / realH < .85;
      var scale = Math.min(pw / (portrait ? W * .55 : W), ph / H);
      ctx.translate((pw - W * scale) / 2, (ph - H * scale) / 2); ctx.scale(scale, scale);
      backdrop(t, level || 0);
      if (t >= 53 && !finalBoosted) {
        // Accelerate the same simulated ball for the final rally; keep Pong's collision physics.
        var b = courts[4].state.ball, v = Math.hypot(b.dx, b.dy) || 1;
        b.dx = b.dx / v * 870; b.dy = b.dy / v * 870; b.speed = 870;
        finalBoosted = true;
      }
      if (t >= 12 && t < 57) {
        if (t >= 38 && !matchSetup) {
          var match = courts[3];
          match.state.score = [6, 6];
          match.state.ball.x = 115; match.state.ball.y = 82;
          match.state.ball.dx = 650; match.state.ball.dy = 0;
          match.state.ball.speed = 650; match.state.serveTimer = 0;
          match.state.p2.y = kit.height - 28; match.state.p2.h = 28;
          match.state.trail = [];
          match.cinematicMiss = true;
          // Scrub previews can open directly on the board cut without simulating the lead-in.
          if (t >= 38.82) { match.state.score = [7, 6]; match.state.serveTimer = .55; }
          matchSetup = true;
        }
        // Multiple actual matches keep their own balls and scores, even while off camera.
        courts.forEach(function (court) { kit.advance(court, Math.min(.03, Math.max(.001, (dt || .016) * 1.45))); });
      }
      if (t < 12) opening(t, level);
      else if (t < 18) serveScene(t);
      else if (t < 25) closeups(t);
      else if (t >= 38 && t < 38.82) scoringCloseup(t);
      else if (t < 55) { /* the courts and real site UI are on 3D planes above this canvas */ }
      else if (t < 57) finale(t);
      else menuReturn(t);
      if (space) space.draw(t);
      if (flash > .002) {
        ctx.fillStyle = 'rgba(255,219,255,' + Math.min(.58, flash) + ')'; ctx.fillRect(0, 0, W, H);
        flash *= Math.exp(-Math.max(.016, dt || .016) * 10);
      }
      // Fine analog noise is intentionally behind the CSS VHS layer.
      ctx.globalAlpha = .07;
      for (var z = 0; z < 35; z++) { ctx.fillStyle = z % 2 ? CYAN : PINK; ctx.fillRect(hash(z + t * 71) * W, hash(z * 3 + t * 31) * H, 2, 2); }
      ctx.globalAlpha = 1;
    }
    return { draw: draw, dispose: function () { if (space) space.dispose(); } };
  };
})();
