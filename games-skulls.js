// games-skulls.js: skull modifiers for Pong, Battleships and Chess (Tetris has its own, richer skull system).
// Each game lists its skulls; this draws the picker (toggle cards under the CPU difficulty), remembers the
// choice, and answers has(id). Skulls apply to games against the CPU (and Pong's local mode); online games
// are always played straight so both players see the same rules.
//
// GameSkulls.mount({ after: element, list: [{ id, name, desc, kind: 'harder'|'easier'|'chaos', sym }], storeKey, title })
//   -> { has(id), active() -> [ids], count(), set(ids) }
(function () {
  'use strict';
  var G = window.Games;

  function mount(opts) {
    var list = opts.list, ids = list.map(function (s) { return s.id; });
    var on = (G.Store.get(opts.storeKey, []) || []).filter(function (id) { return ids.indexOf(id) !== -1; });
    var wrap = document.createElement('div');
    wrap.className = 'gskull-wrap';
    var head = document.createElement('div');
    head.className = 'option-row gskull-head';
    var label = document.createElement('span');
    label.className = 'option-label';
    head.appendChild(label);
    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'gskull-clear';
    clear.textContent = 'Clear';
    head.appendChild(clear);
    var grid = document.createElement('div');
    grid.className = 'gskull-grid';
    wrap.appendChild(head);
    wrap.appendChild(grid);
    opts.after.parentNode.insertBefore(wrap, opts.after.nextSibling);

    function save() { G.Store.set(opts.storeKey, on); paint(); if (opts.onChange) opts.onChange(on.slice()); }
    function paint() {
      label.textContent = (opts.title || 'Skulls · vs CPU') + (on.length ? ' · ' + on.length + ' on' : '');
      clear.hidden = !on.length;
      grid.textContent = '';
      list.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gskull ' + s.kind + (on.indexOf(s.id) !== -1 ? ' on' : '');
        b.setAttribute('aria-pressed', on.indexOf(s.id) !== -1 ? 'true' : 'false');
        b.title = s.desc;
        var sym = document.createElement('i');
        sym.textContent = s.sym || '☠';
        var text = document.createElement('span');
        var nm = document.createElement('strong');
        nm.textContent = s.name;
        var ds = document.createElement('small');
        ds.textContent = s.desc;
        text.appendChild(nm);
        text.appendChild(ds);
        var tag = document.createElement('em');
        tag.textContent = s.kind === 'easier' ? 'Easier' : s.kind === 'chaos' ? 'Chaos' : 'Harder';
        b.appendChild(sym);
        b.appendChild(text);
        b.appendChild(tag);
        b.addEventListener('click', function () {
          var at = on.indexOf(s.id);
          if (at === -1) on.push(s.id); else on.splice(at, 1);
          save();
        });
        grid.appendChild(b);
      });
    }
    clear.addEventListener('click', function () { on = []; save(); });
    paint();
    return {
      has: function (id) { return on.indexOf(id) !== -1; },
      active: function () { return on.slice(); },
      count: function () { return on.length; },
      set: function (list2) { on = (list2 || []).filter(function (id) { return ids.indexOf(id) !== -1; }); save(); }
    };
  }

  window.GameSkulls = { mount: mount };
})();
