// Shared, per-game keyboard settings. Game code reads the same maps that this panel edits.
(function () {
  'use strict';
  function key(e) { return e.key === ' ' ? ' ' : String(e.key || '').toLowerCase(); }
  function label(k) {
    return ({ ' ': 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', escape: 'Esc', enter: 'Enter', control: 'Ctrl', shift: 'Shift', '/': '/' })[k] || (k ? k.toUpperCase() : 'Unbound');
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag); n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function mount(config) {
    var G = window.Games, defaults = clone(config.groups), saved = G.Store.get('keybinds_' + config.game, {});
    var groups = clone(defaults), current = 0, waiting = null, lastFocus = null;
    groups.forEach(function (group) {
      var from = saved && saved[group.id];
      if (!from || typeof from !== 'object') return;
      group.actions.forEach(function (action) {
        var value = from[action.id];
        if (Array.isArray(value) && value.length === action.keys.length && value.every(function (k) { return typeof k === 'string' && k.length < 40; })) action.keys = value.slice();
      });
    });
    function persist() {
      var out = {};
      groups.forEach(function (group) {
        out[group.id] = {};
        group.actions.forEach(function (action) { out[group.id][action.id] = action.keys.slice(); });
      });
      G.Store.set('keybinds_' + config.game, out);
      if (config.onChange) config.onChange(api);
    }
    var button = el('button', 'gkb-launch', '⚙ Settings');
    button.type = 'button'; button.setAttribute('aria-label', config.title + ' settings and keybinds');
    if (config.music) button.classList.add('beside-music');
    document.body.appendChild(button);
    var soundButton = document.getElementById('soundBtn');
    if (soundButton) {
      var hudButton = el('button', 'btn btn-sm btn-outline', 'Settings');
      hudButton.type = 'button'; hudButton.setAttribute('aria-label', config.title + ' settings and keybinds');
      soundButton.insertAdjacentElement('afterend', hudButton);
      hudButton.addEventListener('click', open);
    }
    var shade = el('div', 'gkb-shade'); shade.hidden = true;
    var dialog = el('section', 'gkb-dialog');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', config.title + ' settings');
    var header = el('div', 'gkb-head');
    var heading = el('div', 'gkb-heading'); heading.appendChild(el('span', 'gkb-eyebrow', 'BALCADE / SETTINGS'));
    heading.appendChild(el('h2', '', config.title + ' controls'));
    header.appendChild(heading);
    var close = el('button', 'gkb-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close settings'); header.appendChild(close);
    dialog.appendChild(header);
    var intro = el('p', 'gkb-intro', 'Choose a key, then press its replacement. Changes save on this device.'); dialog.appendChild(intro);
    var tabs = el('div', 'gkb-tabs'); tabs.setAttribute('role', 'tablist'); dialog.appendChild(tabs);
    var rows = el('div', 'gkb-rows'); dialog.appendChild(rows);
    var foot = el('div', 'gkb-foot');
    var note = el('p', 'gkb-note', 'Keys already used in this section swap places.'); foot.appendChild(note);
    var reset = el('button', 'gkb-reset', 'Reset section'); reset.type = 'button'; foot.appendChild(reset);
    dialog.appendChild(foot); shade.appendChild(dialog); document.body.appendChild(shade);
    function paint() {
      tabs.textContent = ''; rows.textContent = '';
      groups.forEach(function (group, i) {
        var tab = el('button', 'gkb-tab' + (i === current ? ' active' : ''), group.title);
        tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(i === current));
        tab.addEventListener('click', function () { current = i; waiting = null; paint(); }); tabs.appendChild(tab);
      });
      groups[current].actions.forEach(function (action) {
        var row = el('div', 'gkb-row'); row.appendChild(el('span', 'gkb-action', action.label));
        var keys = el('div', 'gkb-keys');
        action.keys.forEach(function (binding, slot) {
          var b = el('button', 'gkb-key' + (waiting && waiting.action === action && waiting.slot === slot ? ' listening' : ''), waiting && waiting.action === action && waiting.slot === slot ? 'Press a key…' : label(binding));
          b.type = 'button'; b.setAttribute('aria-label', 'Change ' + action.label + ' ' + (slot + 1) + ', currently ' + label(binding));
          b.addEventListener('click', function () { waiting = { action: action, slot: slot }; paint(); }); keys.appendChild(b);
        });
        row.appendChild(keys); rows.appendChild(row);
      });
    }
    function open() {
      lastFocus = document.activeElement; shade.hidden = false; document.documentElement.classList.add('gkb-open');
      if (config.onOpen) config.onOpen(); paint(); close.focus();
    }
    function shut() {
      shade.hidden = true; waiting = null; document.documentElement.classList.remove('gkb-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    button.addEventListener('click', open); close.addEventListener('click', shut);
    shade.addEventListener('click', function (e) { if (e.target === shade) shut(); });
    reset.addEventListener('click', function () {
      groups[current].actions.forEach(function (action, i) { action.keys = defaults[current].actions[i].keys.slice(); });
      waiting = null; persist(); paint();
    });
    document.addEventListener('keydown', function (e) {
      if (shade.hidden) return;
      if (!waiting && key(e) === 'tab') return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!waiting) { if (key(e) === 'escape') shut(); return; }
      var next = key(e);
      if (next === 'escape') { waiting = null; paint(); return; }
      if (next === 'tab' || next === 'meta' || next === 'alt' || next === 'dead' || e.repeat) return;
      var action = waiting.action, slot = waiting.slot, old = action.keys[slot];
      groups[current].actions.forEach(function (other) {
        other.keys.forEach(function (k, i) { if (k === next && !(other === action && i === slot)) other.keys[i] = old; });
      });
      action.keys[slot] = next; waiting = null; persist(); paint();
    }, true);
    document.addEventListener('keyup', function (e) { if (!shade.hidden) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    var api = {
      groups: groups, open: open, isOpen: function () { return !shade.hidden; },
      keys: function (groupId, actionId) {
        var group = groups.filter(function (g) { return g.id === groupId; })[0];
        var action = group && group.actions.filter(function (a) { return a.id === actionId; })[0];
        return action ? action.keys : [];
      },
      matches: function (e, groupId, actionId) { return api.keys(groupId, actionId).indexOf(key(e)) !== -1; }
    };
    if (config.onChange) config.onChange(api);
    paint();
    return api;
  }
  window.GameKeybinds = { mount: mount, key: key, label: label };
})();
