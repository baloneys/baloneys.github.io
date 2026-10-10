// games-skulls.js: skull modifiers for Pong, Battleships and Chess (Tetris has its own, richer skull system).
// Each game lists its skulls; this draws them the way Tetris does: on the menu, a compact row of the skulls that are
// on with a "Choose skulls" button; the button opens a skulls page with the cards grouped (Harder, Easier, Chaos),
// a detail panel for the one you're pointing at, Clear all and Done. It remembers the choice and answers has(id).
// Skulls apply to games against the CPU (and Pong's local mode); online games are always played straight so both
// players see the same rules.
//
// GameSkulls.mount({ after: element, list: [{ id, name, desc, kind: 'harder'|'easier'|'chaos', sym }], storeKey, title })
//   -> { has(id), active() -> [ids], count(), set(ids), open() }
(function () {
  'use strict';
  var G = window.Games;
  var GROUPS = [['harder', 'Harder'], ['easier', 'Easier'], ['chaos', 'Chaos']];
  var KIND_NAME = { harder: 'Harder', easier: 'Easier', chaos: 'Chaos' };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // The skull's symbol in a square, like Tetris's pixel skull icons.
  function icon(s, size) {
    var i = el('span', 'gsk-icon ' + (s.kind || 'harder'), s.sym || '☠');
    if (size) { i.style.width = i.style.height = size + 'px'; i.style.fontSize = Math.round(size * 0.5) + 'px'; }
    i.setAttribute('aria-hidden', 'true');
    return i;
  }

  function mount(opts) {
    var list = opts.list, ids = list.map(function (s) { return s.id; });
    var on = (G.Store.get(opts.storeKey, []) || []).filter(function (id) { return ids.indexOf(id) !== -1; });
    var title = opts.title || 'Skulls · vs CPU';
    var selected = 0;

    /* ---------- on the menu: what's on, and the button ---------- */
    var wrap = el('div', 'gskull-wrap');
    var head = el('div', 'option-row gskull-head');
    var label = el('span', 'option-label', title);
    head.appendChild(label);
    var summary = el('div', 'gsk-summary');
    var row = el('div', 'chip-row gsk-buttons');
    var chooseBtn = el('button', 'btn btn-sm btn-outline', 'Choose skulls');
    chooseBtn.type = 'button';
    row.appendChild(chooseBtn);
    wrap.appendChild(head); wrap.appendChild(summary); wrap.appendChild(row);
    opts.after.parentNode.insertBefore(wrap, opts.after.nextSibling);

    /* ---------- the skulls page ---------- */
    var modal = el('div', 'gsk-modal hidden');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Skulls');
    var panel = el('section', 'panel gskull-panel');
    panel.appendChild(el('h2', 'panel-title', 'Skulls'));
    panel.appendChild(el('p', 'type-note gsk-note', 'Harder skulls make the game tougher, easier ones help you out, and chaos ones just make it weird. ' +
      (/local/i.test(title) ? 'They apply against the CPU and in local games.' : 'They apply against the CPU.') + ' Online games are always played straight.'));
    var layout = el('div', 'gsk-layout');
    var groupsBox = el('div');
    var detail = el('aside', 'gsk-detail');
    detail.setAttribute('aria-live', 'polite');
    layout.appendChild(groupsBox); layout.appendChild(detail);
    panel.appendChild(layout);
    var actions = el('div', 'actions');
    var countEl = el('span', 'gsk-count');
    var clearBtn = el('button', 'btn btn-outline', 'Clear all'); clearBtn.type = 'button';
    var doneBtn = el('button', 'btn btn-primary', 'Done'); doneBtn.type = 'button';
    actions.appendChild(countEl); actions.appendChild(clearBtn); actions.appendChild(doneBtn);
    panel.appendChild(actions);
    modal.appendChild(panel);
    document.body.appendChild(modal);

    function save() { G.Store.set(opts.storeKey, on); paint(); if (opts.onChange) opts.onChange(on.slice()); }

    function paintSummary() {
      label.textContent = title + (on.length ? ' · ' + on.length + ' on' : '');
      summary.textContent = '';
      if (!on.length) { summary.appendChild(el('span', 'type-note', 'No skulls · classic rules')); return; }
      list.forEach(function (s) { if (on.indexOf(s.id) !== -1) { var i = icon(s, 30); i.title = s.name; summary.appendChild(i); } });
    }

    function paintDetail() {
      var s = list[selected], isOn = on.indexOf(s.id) !== -1;
      detail.textContent = '';
      detail.appendChild(icon(s, 96));
      detail.appendChild(el('div', 'cat ' + (s.kind || 'harder'), KIND_NAME[s.kind] || 'Harder'));
      detail.appendChild(el('h3', null, s.name));
      detail.appendChild(el('p', null, s.desc));
      detail.appendChild(el('div', 'eff' + (isOn ? ' on' : ''), isOn ? 'ON' : 'OFF'));
    }

    function paintPage() {
      groupsBox.textContent = '';
      GROUPS.forEach(function (gr) {
        var items = list.filter(function (s) { return (s.kind || 'harder') === gr[0]; });
        if (!items.length) return;
        groupsBox.appendChild(el('h3', 'skull-group-title', gr[1]));
        var grid = el('div', 'gsk-grid');
        items.forEach(function (s) {
          var i = list.indexOf(s), isOn = on.indexOf(s.id) !== -1;
          var b = el('button', 'gsk-card ' + (s.kind || 'harder') + (isOn ? ' on' : ''));
          b.type = 'button';
          b.dataset.id = s.id;
          b.setAttribute('aria-pressed', isOn ? 'true' : 'false');
          b.appendChild(icon(s));
          b.appendChild(el('span', 'gsk-name', s.name));
          b.appendChild(el('span', 'gsk-kind', KIND_NAME[s.kind] || 'Harder'));
          b.addEventListener('mouseenter', function () { selected = i; paintDetail(); });
          b.addEventListener('focus', function () { selected = i; paintDetail(); });
          b.addEventListener('click', function () {
            selected = i;
            var at = on.indexOf(s.id);
            if (at === -1) on.push(s.id); else on.splice(at, 1);
            save();
            var again = groupsBox.querySelector('[data-id="' + s.id + '"]');
            if (again) again.focus({ preventScroll: true });
          });
          grid.appendChild(b);
        });
        groupsBox.appendChild(grid);
      });
      paintDetail();
      countEl.textContent = on.length ? on.length + ' skull' + (on.length > 1 ? 's' : '') + ' on' : 'No skulls · classic rules';
      clearBtn.disabled = !on.length;
    }

    function paint() { paintSummary(); paintPage(); }

    var returnFocus = null;
    function open() {
      returnFocus = document.activeElement;
      paintPage();
      modal.classList.remove('hidden');
      document.documentElement.classList.add('gsk-open');
      var first = groupsBox.querySelector('.gsk-card');
      if (first) first.focus({ preventScroll: true });
    }
    function close() {
      modal.classList.add('hidden');
      document.documentElement.classList.remove('gsk-open');
      if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    }
    chooseBtn.addEventListener('click', open);
    doneBtn.addEventListener('click', close);
    clearBtn.addEventListener('click', function () { on = []; save(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
    paint();   // the page is filled in up front, so the opening cinematics can show the real thing
    return {
      has: function (id) { return on.indexOf(id) !== -1; },
      active: function () { return on.slice(); },
      count: function () { return on.length; },
      set: function (list2) { on = (list2 || []).filter(function (id) { return ids.indexOf(id) !== -1; }); save(); },
      open: open
    };
  }

  window.GameSkulls = { mount: mount };
})();
