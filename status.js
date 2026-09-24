// status.js: live service status for serv_status.html.
// Everything here uses free public data that a browser can read directly:
//   - Statuspage JSON feeds (Discord, VRChat)
//   - reachability checks for services without a public status API (Steam, Destiny 2, Minecraft)
//   - RDAP, the official registry lookup, for the domain check
(function () {
  'use strict';

  var CONFIG = {
    refreshMs: 60000,
    timeoutMs: 8000,
    // Optional: a free key from https://www.bungie.net/en/Application (set its origin to
    // https://kanaris-beans.com) adds Bungie's official Destiny 2 alerts to the card.
    bungieApiKey: '326a059da8264fd5988a116868b1ab4d',
    domain: 'jabbawackasunitedfansorangetown61.com'
  };

  var SERVICES = [
    {
      id: 'discord',
      name: 'Discord',
      statuspage: 'https://discordstatus.com',
      link: { href: 'https://discordstatus.com', label: 'discordstatus.com' },
      pings: [
        { name: 'Website', url: 'https://discord.com/favicon.ico' }
      ]
    },
    {
      id: 'vrchat',
      name: 'VRChat',
      statuspage: 'https://status.vrchat.com',
      link: { href: 'https://status.vrchat.com', label: 'status.vrchat.com' },
      pings: [
        { name: 'Website', url: 'https://vrchat.com/favicon.ico' },
        { name: 'API', url: 'https://api.vrchat.cloud/api/1/config' }
      ]
    },
    {
      id: 'steam',
      name: 'Steam',
      note: 'Valve has no public status API, so this checks whether Steam\'s servers respond.',
      link: { href: 'https://steamstat.us', label: 'steamstat.us' },
      pings: [
        { name: 'Store', url: 'https://store.steampowered.com/favicon.ico' },
        { name: 'Community', url: 'https://steamcommunity.com/favicon.ico' },
        { name: 'Web API', url: 'https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/' }
      ]
    },
    {
      id: 'destiny',
      name: 'Destiny 2',
      note: 'Checks whether Bungie\'s servers respond.',
      link: { href: 'https://x.com/BungieHelp', label: '@BungieHelp' },
      bungieAlerts: true,
      pings: [
        { name: 'Bungie.net', url: 'https://www.bungie.net/favicon.ico' },
        { name: 'Bungie API', url: 'https://www.bungie.net/Platform/Settings/' }
      ]
    },
    {
      id: 'minecraft',
      name: 'Minecraft',
      note: 'Mojang has no public status API, so this checks whether their servers respond.',
      link: { href: 'https://x.com/MojangSupport', label: '@MojangSupport' },
      pings: [
        { name: 'Website', url: 'https://www.minecraft.net/favicon.ico' },
        { name: 'Login / sessions', url: 'https://sessionserver.mojang.com/session/minecraft/profile/069a79f444e94726a5befca90e38aaf5' },
        { name: 'Account API', url: 'https://api.mojang.com/users/profiles/minecraft/Notch' }
      ]
    }
  ];

  var LEVELS = {
    operational: { label: 'Operational', icon: '✓', rank: 0 },
    maintenance: { label: 'Maintenance', icon: '⚙', rank: 1 },
    degraded: { label: 'Degraded', icon: '!', rank: 2 },
    outage: { label: 'Outage', icon: '×', rank: 3 },
    unknown: { label: 'Unknown', icon: '?', rank: -1 },
    checking: { label: 'Checking', icon: '…', rank: -2 }
  };

  var state = { results: {}, domain: null, lastUpdated: 0, loading: false };

  /* ---------- helpers ---------- */

  function $(sel) { return document.querySelector(sel); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function getJSON(url, headers) {
    return withTimeout(fetch(url, { cache: 'no-store', headers: headers || {} }), CONFIG.timeoutMs)
      .then(function (r) {
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return r.json();
      });
  }

  // A no-cors request resolves if the server answered at all, and rejects on network failure.
  function ping(url) {
    var t0 = performance.now();
    var bust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
    return withTimeout(fetch(bust, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }), CONFIG.timeoutMs)
      .then(function () { return { up: true, ms: Math.round(performance.now() - t0) }; },
            function () { return { up: false }; });
  }

  function timeAgo(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function fmtDate(iso) {
    var t = Date.parse(iso);
    return t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  }

  function stripHtml(html) {
    var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* ---------- checks ---------- */

  function levelFromIndicator(summary) {
    var ind = summary && summary.status && summary.status.indicator;
    var maint = summary && (summary.scheduled_maintenances || []).some(function (m) { return m.status === 'in_progress'; });
    if (ind === 'none') return maint ? 'maintenance' : 'operational';
    if (ind === 'minor') return 'degraded';
    if (ind === 'major' || ind === 'critical') return 'outage';
    if (ind === 'maintenance') return 'maintenance';
    return 'unknown';
  }

  function checkService(svc) {
    var statuspage = svc.statuspage
      ? getJSON(svc.statuspage + '/api/v2/summary.json').catch(function () { return null; })
      : Promise.resolve(null);

    return statuspage.then(function (summary) {
      if (summary) {
        var components = (summary.components || []).filter(function (c) {
          return !c.group && c.status && c.status !== 'operational';
        });
        var incidents = (summary.incidents || []).filter(function (i) {
          return i.status !== 'resolved' && i.status !== 'postmortem';
        });
        return {
          source: 'statuspage',
          level: levelFromIndicator(summary),
          description: summary.status.description,
          issues: incidents.map(function (i) { return { text: i.name, href: i.shortlink }; })
            .concat(components.map(function (c) { return { text: c.name + ' · ' + c.status.replace(/_/g, ' ') }; })),
          updated: summary.page && summary.page.updated_at
        };
      }

      // No status feed: fall back to reachability checks.
      return Promise.all(svc.pings.map(function (p) { return ping(p.url); })).then(function (res) {
        var up = res.filter(function (r) { return r.up; }).length;
        var level = up === res.length ? 'operational' : up === 0 ? 'outage' : 'degraded';
        var desc = up === res.length ? 'All checked servers are responding'
          : up === 0 ? 'None of the checked servers responded. They may be down, or blocked on your network.'
          : (res.length - up) + ' of ' + res.length + ' servers aren\'t responding';
        return {
          source: 'ping',
          level: level,
          description: desc,
          pings: svc.pings.map(function (p, i) { return { name: p.name, up: res[i].up, ms: res[i].ms }; }),
          issues: []
        };
      });
    }).then(function (result) {
      if (!svc.bungieAlerts || !CONFIG.bungieApiKey) return result;
      return getJSON('https://www.bungie.net/Platform/GlobalAlerts/', { 'X-API-Key': CONFIG.bungieApiKey })
        .then(function (data) {
          var alerts = (data && data.Response) || [];
          alerts.forEach(function (a) {
            result.issues.push({ text: stripHtml(a.AlertHtml), href: /^https:\/\//.test(a.AlertLink || '') ? a.AlertLink : null });
          });
          if (alerts.length && result.level === 'operational') {
            result.level = 'degraded';
            result.description = 'Bungie has posted ' + alerts.length + ' alert' + (alerts.length > 1 ? 's' : '');
          }
          return result;
        })
        .catch(function () { return result; });
    });
  }

  function checkDomain(name) {
    function parse(data) {
      var events = data.events || [];
      function ev(action) {
        var e = events.filter(function (x) { return x.eventAction === action; })[0];
        return e && e.eventDate;
      }
      var registrar = '';
      (data.entities || []).forEach(function (ent) {
        if ((ent.roles || []).indexOf('registrar') === -1 || !ent.vcardArray) return;
        (ent.vcardArray[1] || []).forEach(function (f) { if (f[0] === 'fn') registrar = f[3]; });
      });
      return {
        taken: true,
        registered: ev('registration'),
        expires: ev('expiration'),
        registrar: registrar
      };
    }

    function lookup(url) {
      return withTimeout(fetch(url, { cache: 'no-store', headers: { Accept: 'application/rdap+json' } }), CONFIG.timeoutMs)
        .then(function (r) {
          if (r.status === 404) return { taken: false };
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json().then(parse);
        });
    }

    var tld = name.split('.').pop();
    var primary = tld === 'com' ? 'https://rdap.verisign.com/com/v1/domain/' + encodeURIComponent(name) : 'https://rdap.org/domain/' + encodeURIComponent(name);
    return lookup(primary)
      .catch(function () { return lookup('https://rdap.org/domain/' + encodeURIComponent(name)); })
      .catch(function () { return { error: true }; });
  }

  /* ---------- rendering ---------- */

  function badge(level) {
    var l = LEVELS[level] || LEVELS.unknown;
    var b = el('span', 'badge ' + level);
    b.appendChild(el('span', null, l.icon));
    b.appendChild(document.createTextNode(l.label));
    return b;
  }

  function cardShell(name, badgeNode) {
    var card = el('article', 'status-card');
    var head = el('div', 'status-card-head');
    head.appendChild(el('h3', 'status-card-name', name));
    head.appendChild(badgeNode);
    card.appendChild(head);
    return card;
  }

  function footer(left, link) {
    var foot = el('div', 'status-card-foot');
    foot.appendChild(el('span', null, left));
    if (link) {
      var a = el('a', null, link.label + ' ↗');
      a.href = link.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      foot.appendChild(a);
    }
    return foot;
  }

  function renderServices() {
    var grid = $('#serviceGrid');
    grid.textContent = '';
    SERVICES.forEach(function (svc) {
      var r = state.results[svc.id];
      var card = cardShell(svc.name, badge(r ? r.level : 'checking'));

      if (!r) {
        card.appendChild(el('div', 'skeleton'));
        var s2 = el('div', 'skeleton');
        s2.style.width = '60%';
        card.appendChild(s2);
        card.appendChild(footer('checking…', svc.link));
        grid.appendChild(card);
        return;
      }

      card.appendChild(el('p', 'status-card-desc', r.description || LEVELS[r.level].label));

      if (r.pings) {
        var ul = el('ul', 'checks');
        r.pings.forEach(function (p) {
          var li = el('li', 'check');
          li.appendChild(el('span', 'check-name', p.name));
          var st = el('span', 'check-state ' + (p.up ? 'up' : 'down'), p.up ? '✓ responding' : '× no response');
          if (p.up && p.ms != null) st.appendChild(el('span', 'ms', ' · ' + p.ms + 'ms'));
          li.appendChild(st);
          ul.appendChild(li);
        });
        card.appendChild(ul);
      }

      if (r.issues && r.issues.length) {
        var issues = el('ul', 'issues');
        r.issues.slice(0, 4).forEach(function (i) {
          var li = el('li');
          if (i.href && /^https:\/\//.test(i.href)) {
            var a = el('a', null, i.text);
            a.href = i.href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            li.appendChild(a);
          } else {
            li.textContent = i.text;
          }
          issues.appendChild(li);
        });
        card.appendChild(issues);
      }

      if (r.source === 'ping' && svc.note) card.appendChild(el('p', 'status-card-desc', svc.note));

      var left = r.source === 'statuspage'
        ? 'official status' + (r.updated ? ' · ' + timeAgo(Date.parse(r.updated)) : '')
        : 'reachability check';
      card.appendChild(footer(left, svc.link));
      grid.appendChild(card);
    });
  }

  function renderSite() {
    var grid = $('#siteGrid');
    grid.textContent = '';

    var site = cardShell('kanaris-beans.com', badge('operational'));
    site.appendChild(el('p', 'status-card-desc', 'Online. If you can read this, the site is up.'));
    site.appendChild(footer('static check', { href: '/', label: 'home' }));
    grid.appendChild(site);

    var gh = cardShell('GitHub Pages', badge('operational'));
    gh.appendChild(el('p', 'status-card-desc', 'Online. This site is hosted on GitHub Pages, so it\'s serving right now.'));
    gh.appendChild(footer('static check', { href: 'https://www.githubstatus.com', label: 'githubstatus.com' }));
    grid.appendChild(gh);
  }

  function renderDomain() {
    var grid = $('#domainGrid');
    grid.textContent = '';
    var d = state.domain;
    var b = !d ? badge('checking')
      : d.error ? badge('unknown')
      : (function () {
          var n = el('span', 'badge ' + (d.taken ? 'taken' : 'available'));
          n.appendChild(el('span', null, d.taken ? '●' : '✓'));
          n.appendChild(document.createTextNode(d.taken ? 'Taken' : 'Available'));
          return n;
        })();

    var card = cardShell('Domain check', b);
    card.appendChild(el('div', 'domain-name', CONFIG.domain));

    if (!d) {
      card.appendChild(el('div', 'skeleton'));
    } else if (d.error) {
      card.appendChild(el('p', 'status-card-desc', 'Couldn\'t reach the registry lookup right now.'));
    } else if (!d.taken) {
      card.appendChild(el('p', 'status-card-desc', 'Not registered. It\'s up for grabs.'));
    } else {
      var dl = el('dl', 'detail-list');
      [['Registered', fmtDate(d.registered)], ['Expires', fmtDate(d.expires)], ['Registrar', d.registrar || '—']].forEach(function (row) {
        dl.appendChild(el('dt', null, row[0]));
        dl.appendChild(el('dd', null, row[1]));
      });
      card.appendChild(dl);
    }
    card.appendChild(footer('RDAP registry lookup', { href: 'https://lookup.icann.org/en/lookup?name=' + encodeURIComponent(CONFIG.domain), label: 'ICANN lookup' }));
    grid.appendChild(card);
  }

  function renderOverall() {
    var box = $('#overall');
    var done = SERVICES.map(function (s) { return state.results[s.id]; }).filter(Boolean);
    var known = done.filter(function (r) { return r.level !== 'unknown'; });
    var issues = SERVICES.filter(function (s) {
      var r = state.results[s.id];
      return r && LEVELS[r.level].rank >= 2;
    });
    var worst = known.reduce(function (w, r) { return LEVELS[r.level].rank > LEVELS[w].rank ? r.level : w; }, 'operational');

    var cls, icon, title, sub;
    if (done.length < SERVICES.length) {
      cls = 'checking'; icon = '…'; title = 'Checking services…'; sub = 'Pulling live data';
    } else if (!issues.length) {
      cls = 'operational'; icon = '✓'; title = 'All systems operational';
      sub = SERVICES.length + ' services checked' + (worst === 'maintenance' ? ' · maintenance in progress' : '');
    } else {
      cls = worst === 'outage' ? 'outage' : 'degraded';
      icon = LEVELS[cls].icon;
      title = issues.length + ' service' + (issues.length > 1 ? 's' : '') + ' having issues';
      sub = issues.map(function (s) { return s.name; }).join(', ');
    }
    box.className = 'overall ' + cls;
    $('#overallIcon').textContent = icon;
    $('#overallTitle').textContent = title;
    $('#overallSub').textContent = sub;
  }

  function renderUpdated() {
    $('#lastUpdated').textContent = state.lastUpdated ? 'updated ' + timeAgo(state.lastUpdated) : 'checking…';
  }

  function renderAll() {
    renderOverall();
    renderServices();
    renderSite();
    renderDomain();
    renderUpdated();
  }

  /* ---------- refresh loop ---------- */

  function refresh() {
    if (state.loading) return;
    state.loading = true;
    $('#refreshBtn').disabled = true;

    var jobs = SERVICES.map(function (svc) {
      return checkService(svc)
        .catch(function () { return { level: 'unknown', description: 'Check failed', issues: [] }; })
        .then(function (r) { state.results[svc.id] = r; renderOverall(); renderServices(); });
    });
    jobs.push(checkDomain(CONFIG.domain).then(function (d) { state.domain = d; renderDomain(); }));

    Promise.all(jobs).then(function () {
      state.lastUpdated = Date.now();
      renderAll();
    }).finally(function () {
      state.loading = false;
      $('#refreshBtn').disabled = false;
    });
  }

  renderAll();
  refresh();
  $('#refreshBtn').addEventListener('click', refresh);
  setInterval(function () { if (!document.hidden) refresh(); }, CONFIG.refreshMs);
  setInterval(renderUpdated, 15000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - state.lastUpdated > CONFIG.refreshMs) refresh();
  });
})();
