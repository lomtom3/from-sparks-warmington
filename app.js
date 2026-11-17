/*
  From Sparks Adventures - walk app.
  All words come from the files in /content. Progress and settings are kept on the player's phone.
  Colour code inside text: [[r:...]] red = best guess, unconfirmed; [[c:...]] cyan = new suggestion.
*/
(function () {
  'use strict';

  var CONTENT = 'content/';
  var MAP = { src: 'map/warmington-map.svg', x0: 215, y0: 470, w: 490, h: 430 };
  var app = document.getElementById('app');
  var settingsEl = document.getElementById('settings');
  var scrim = document.getElementById('scrim');
  var menuButton = document.getElementById('menu-button');
  var walk = null, stops = [], state = null;

  // ---------- saving on the phone ----------
  function storageKey() { return 'fromsparks:' + walk.id; }
  function loadState() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey())); } catch (e) { saved = null; }
    var s = { current: 0, arrived: {}, solved: {}, hints: {}, layers: {}, review: true };
    walk.layers.forEach(function (l) { s.layers[l.key] = !!l.default_on; });
    if (saved && typeof saved === 'object') {
      if (typeof saved.current === 'number') s.current = saved.current;
      ['arrived', 'solved', 'hints'].forEach(function (k) {
        if (saved[k] && typeof saved[k] === 'object') s[k] = saved[k];
      });
      if (typeof saved.review === 'boolean') s.review = saved.review;
      if (saved.layers) Object.keys(s.layers).forEach(function (k) {
        if (typeof saved.layers[k] === 'boolean') s.layers[k] = saved.layers[k];
      });
    }
    s.current = Math.max(0, Math.min(s.current, stops.length - 1));
    return s;
  }
  function saveState() { try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch (e) { /* ignore */ } }

  // ---------- helpers ----------
  function el(tag, opts, children) {
    var n = document.createElement(tag);
    opts = opts || {};
    if (opts.text != null) n.appendChild(rich(opts.text));
    if (opts.className) n.className = opts.className;
    if (opts.onClick) n.addEventListener('click', opts.onClick);
    if (opts.disabled) n.disabled = true;
    if (opts.attrs) Object.keys(opts.attrs).forEach(function (k) { n.setAttribute(k, opts.attrs[k]); });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  // Turns "[[r:text]]" and "[[c:text]]" into coloured spans (safe: only text nodes are created).
  function rich(text) {
    var frag = document.createDocumentFragment();
    var re = /\[\[([rc]):([\s\S]*?)\]\]/g, last = 0, m;
    text = String(text);
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var span = document.createElement('span');
      span.className = m[1];
      span.textContent = m[2];
      frag.appendChild(span);
      last = re.lastIndex;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  function plain(text) { return String(text).replace(/\[\[[rc]:([\s\S]*?)\]\]/g, '$1'); }

  function show(nodes) {
    app.innerHTML = '';
    nodes.forEach(function (n) { if (n) app.appendChild(n); });
    document.body.classList.toggle('review', !!state && state.review);
    window.scrollTo(0, 0);
  }

  function fetchJson(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' (' + r.status + ')');
      return r.json();
    });
  }

  function pct(x, y) {
    return { l: ((x - MAP.x0) / MAP.w * 100) + '%', t: ((y - MAP.y0) / MAP.h * 100) + '%' };
  }

  // ---------- map ----------
  function mapView(opts) {
    var wrap = el('div', { className: 'mapwrap' });
    var img = document.createElement('img');
    img.src = MAP.src;
    img.alt = 'Old-style map of Warmington showing the walk';
    wrap.appendChild(img);
    if (opts.dots) {
      walk.route.forEach(function (r) {
        if (!r.map) return;
        var p = pct(r.map[0], r.map[1]);
        var d = el('div', { className: 'dot' + (r.map[2] === 'guess' ? ' guess' : r.map[2] === 'cyan' ? ' cyan' : '') + (opts.current === r.n ? ' current' : '') });
        d.textContent = r.n;
        d.style.left = p.l; d.style.top = p.t;
        wrap.appendChild(d);
      });
    }
    if (opts.pin) {
      var q = pct(opts.pin[0], opts.pin[1]);
      var pin = el('div', { className: 'pin' + (opts.pin[2] !== 'confirmed' ? ' guess' : '') });
      pin.style.left = q.l; pin.style.top = q.t;
      wrap.appendChild(pin);
    }
    return wrap;
  }

  // ---------- settings (burger menu) ----------
  function openSettings() {
    renderSettings();
    settingsEl.hidden = false; scrim.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
    var first = settingsEl.querySelector('input,button');
    if (first) first.focus();
  }
  function closeSettings() {
    settingsEl.hidden = true; scrim.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.focus();
  }

  function toggleRow(label, desc, checked, onChange) {
    var input = document.createElement('input');
    input.type = 'checkbox'; input.checked = checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    var text = el('span', {}, [el('span', { className: 'label', text: label }), el('span', { className: 'desc', text: desc })]);
    return el('label', { className: 'toggle' }, [input, text]);
  }

  function renderSettings() {
    settingsEl.innerHTML = '';
    var close = el('button', { className: 'secondary small close-x', text: 'Close', onClick: closeSettings });
    settingsEl.appendChild(close);
    settingsEl.appendChild(el('h2', { text: 'Settings' }));

    settingsEl.appendChild(el('h3', { text: 'Layers' }));
    settingsEl.appendChild(el('p', { className: 'muted', text: 'Switch parts of the walk on or off. Your place on the route is always kept.' }));
    walk.layers.forEach(function (l) {
      settingsEl.appendChild(toggleRow(l.label, l.description, !!state.layers[l.key], function (v) {
        state.layers[l.key] = v; saveState(); route(true);
      }));
    });

    settingsEl.appendChild(el('h3', { text: 'Checking draft' }));
    settingsEl.appendChild(toggleRow('Show draft colours', 'Highlights text that is not final yet, for the owner to check.', !!state.review, function (v) {
      state.review = v; saveState(); document.body.classList.toggle('review', v); renderSettings();
    }));
    settingsEl.appendChild(el('p', {}, [
      el('span', { className: 'swatch-r', text: 'Red' }),
      document.createTextNode(' = best guess, not yet confirmed.')
    ]));
    settingsEl.appendChild(el('p', {}, [
      el('span', { className: 'swatch-c', text: 'Cyan' }),
      document.createTextNode(' = a new idea or puzzle suggested, for approval.')
    ]));
    settingsEl.appendChild(el('p', { className: 'muted', text: 'Plain text is confirmed.' }));

    settingsEl.appendChild(el('h3', { text: 'The walk' }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Route and map', onClick: function () { closeSettings(); location.hash = '#route'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Evidence notebook', onClick: function () { closeSettings(); location.hash = '#notebook'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Reset my progress', onClick: function () {
      if (window.confirm('Start the walk again from the beginning?')) {
        state.current = 0; state.arrived = {}; state.solved = {}; state.hints = {}; saveState();
        closeSettings(); location.hash = '#welcome'; route(true);
      }
    } }));
    settingsEl.appendChild(el('p', { className: 'muted', text: 'Map data © OpenStreetMap contributors.' }));
  }

  // ---------- screens ----------
  // Character picture (DRAFT, not final). Hidden safely if the file is missing.
  function heroImage() {
    var fig = el('figure', { className: 'stop-photo hero' });
    var img = document.createElement('img');
    img.src = 'images/characters.jpg'; img.alt = 'First concept of the characters in the story (draft)';
    img.addEventListener('error', function () { fig.remove(); });
    fig.appendChild(img);
    fig.appendChild(el('figcaption', { text: 'The characters: first concept (draft).' }));
    return fig;
  }

  function logoHero() {
    var fig = el('figure', { className: 'logo-hero' });
    var img = document.createElement('img');
    img.src = 'images/logo-full.jpg'; img.alt = 'From Sparks Adventures (draft logo)';
    img.addEventListener('error', function () { fig.remove(); });
    fig.appendChild(img);
    return fig;
  }

  // Logo (DRAFT, not final): swaps in images/logo.png if it exists.
  function loadLogo() {
    var probe = new Image();
    probe.onload = function () {
      var mark = document.querySelector('.brand-mark');
      if (!mark) return;
      probe.className = 'brand-logo'; probe.alt = 'From Sparks Adventures';
      mark.replaceWith(probe);
    };
    probe.src = 'images/logo.png';
  }

  function welcomeScreen() {
    var started = Object.keys(state.arrived).length > 0 || state.current > 0;
    show([
      logoHero(),
      el('p', { className: 'kicker', text: walk.subtitle }),
      el('h1', { text: walk.title }),
      el('p', { text: walk.welcome_text }),
      heroImage(),
      mapView({ dots: true }),
      el('p', { className: 'mapcap', text: walk.map_note }),
      el('div', { className: 'card' }, [
        el('h2', { text: 'Three layers' }),
        el('p', { className: 'muted', text: 'Open the menu (top right) at any time to switch them on or off.' })
      ].concat(walk.layers.map(function (l) {
        return el('p', {}, [el('strong', { text: l.label + ': ' }), rich(l.description)]);
      }))),
      el('p', { text: walk.start_text }),
      el('button', { className: 'wide copper', text: started ? 'Continue walk' : 'Start walk', onClick: function () { goStop(state.current); } }),
      el('button', { className: 'wide secondary', text: 'See the whole route', onClick: function () { location.hash = '#route'; } })
    ]);
  }

  function routeScreen() {
    var list = el('ul', { className: 'route-list' });
    walk.route.forEach(function (r) {
      var idx = -1;
      stops.forEach(function (s, i) { if (s.order === r.n) idx = i; });
      var name = idx >= 0
        ? el('a', { text: r.name, attrs: { href: '#' + stops[idx].id } })
        : el('span', { className: 'soon', text: r.name + ' (coming soon)' });
      list.appendChild(el('li', {}, [el('span', { className: 'num', text: String(r.n) }), name]));
    });
    show([
      el('p', { className: 'kicker', text: walk.subtitle }),
      el('h1', { text: 'The route' }),
      mapView({ dots: true }),
      el('p', { className: 'mapcap', text: 'Green numbers are confirmed positions. Red numbers are best guesses. Blue numbers are unknown positions, suggested only. Stops without a number are not placed yet.' }),
      list,
      el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back to start', onClick: function () { location.hash = '#welcome'; } })])
    ]);
  }

  function collectEvidence() {
    var items = [];
    stops.forEach(function (s) {
      if (state.solved[s.id] && s.evidence) s.evidence.forEach(function (e) { items.push({ stop: s.name, text: e }); });
    });
    return items;
  }

  function notebookScreen() {
    var items = collectEvidence();
    var nodes = [el('p', { className: 'kicker', text: 'Your notes' }), el('h1', { text: 'Evidence notebook' })];
    if (!items.length) nodes.push(el('p', { className: 'muted', text: 'Nothing yet. Solve puzzles along the walk and the clues are added here.' }));
    items.forEach(function (it) {
      nodes.push(el('section', { className: 'card mystery' }, [el('p', { className: 'kicker', text: it.stop }), el('p', { text: it.text })]));
    });
    nodes.push(el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back to the walk', onClick: function () { goStop(state.current); } })]));
    show(nodes);
  }

  function accuseBlock(stop) {
    var pz = stop.puzzle;
    var solved = !!state.solved[stop.id];
    var box = el('section', { className: 'card puzzle' }, [
      el('p', { className: 'kicker', text: 'Finale' }), el('h2', { text: pz.title }), el('p', { text: pz.intro }),
      el('button', { className: 'secondary small', text: 'Open my evidence notebook', onClick: function () { location.hash = '#notebook'; } }),
      el('p', { text: pz.question })
    ]);
    var feedback = el('p', { className: 'feedback', attrs: { 'aria-live': 'polite' } });
    var selects = {};
    pz.fields.forEach(function (f) {
      var sel = document.createElement('select');
      sel.setAttribute('aria-label', f.label);
      var ph = document.createElement('option'); ph.value = ''; ph.textContent = 'Choose...'; sel.appendChild(ph);
      f.options.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; sel.appendChild(op); });
      if (solved) { sel.value = f.answer; sel.disabled = true; }
      selects[f.key] = sel;
      box.appendChild(el('label', { className: 'field' }, [el('span', { className: 'label', text: f.label }), sel]));
    });
    if (!solved) {
      box.appendChild(el('button', { className: 'wide copper', text: 'Make my accusation', onClick: function () {
        var right = 0, empty = false;
        pz.fields.forEach(function (f) { var v = selects[f.key].value; if (!v) empty = true; else if (v === f.answer) right++; });
        if (empty) { feedback.className = 'feedback no'; feedback.textContent = 'Choose an answer for each question first.'; return; }
        if (right === pz.fields.length) { state.solved[stop.id] = true; saveState(); route(true); }
        else { feedback.className = 'feedback no'; feedback.textContent = 'Not quite: ' + right + ' of ' + pz.fields.length + ' are right. Check your notebook and try again.'; }
      } }));
      box.appendChild(feedback);
    } else {
      box.appendChild(el('p', { className: 'feedback ok', text: pz.reveal }));
    }
    return box;
  }

  function photoFigure(stop) {
    if (!stop.photo) return null;
    var fig = el('figure', { className: 'stop-photo' });
    var img = document.createElement('img');
    img.src = stop.photo; img.alt = stop.photo_caption || stop.name; img.loading = 'lazy';
    img.addEventListener('error', function () { fig.remove(); });
    fig.appendChild(img);
    if (stop.photo_caption) fig.appendChild(el('figcaption', { text: stop.photo_caption }));
    return fig;
  }

  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9£ ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  function puzzleBlock(stop) {
    var pz = stop.puzzle;
    var box = el('section', { className: 'card puzzle' }, [
      el('p', { className: 'kicker', text: 'Puzzle' }),
      el('h2', { text: pz.title }),
      pz.intro ? el('p', { text: pz.intro }) : null
    ]);
    if (pz.material && pz.material.length) {
      var mat = el('div', { className: 'puzzle-material' });
      pz.material.forEach(function (m) { mat.appendChild(el('p', { text: m })); });
      box.appendChild(mat);
    }
    box.appendChild(el('p', { text: pz.question }));

    var solved = !!state.solved[stop.id];
    var feedback = el('p', { className: 'feedback', attrs: { 'aria-live': 'polite' } });
    var hintsShown = state.hints[stop.id] || 0;
    var hintBox = el('div');

    function renderHints() {
      hintBox.innerHTML = '';
      for (var i = 0; i < hintsShown; i++) hintBox.appendChild(el('p', { className: 'card', text: 'Hint ' + (i + 1) + ': ' + pz.hints[i] }));
    }
    function reveal() {
      feedback.className = 'feedback ok';
      feedback.textContent = '';
      feedback.appendChild(rich(pz.reveal));
    }

    if (!solved) {
      var input = document.createElement('input');
      input.type = 'text'; input.autocomplete = 'off'; input.autocapitalize = 'off';
      input.setAttribute('aria-label', 'Your answer');
      function check() {
        var guess = norm(input.value);
        if (!guess) return;
        var ok = [pz.answer].concat(pz.accepted_variants || []).some(function (a) { return norm(a) === guess; });
        if (ok) {
          state.solved[stop.id] = true; saveState();
          route(true);
        } else {
          feedback.className = 'feedback no';
          feedback.textContent = 'Not quite. Try again, or ask for a hint.';
        }
      }
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
      box.appendChild(el('div', { className: 'answer-row' }, [input, el('button', { text: 'Check', onClick: check })]));
      var hintBtn = el('button', { className: 'secondary small', text: 'Give me a hint', onClick: function () {
        if (hintsShown < pz.hints.length) { hintsShown++; state.hints[stop.id] = hintsShown; saveState(); renderHints(); }
        if (hintsShown >= pz.hints.length) hintBtn.disabled = true;
      } });
      if (hintsShown >= pz.hints.length) hintBtn.disabled = true;
      var showBtn = el('button', { className: 'secondary small', text: 'Show the answer', onClick: function () {
        state.solved[stop.id] = true; saveState(); route(true);
      } });
      box.appendChild(el('div', { className: 'nav' }, [hintBtn, showBtn]));
      box.appendChild(hintBox);
      renderHints();
      box.appendChild(feedback);
      if (pz.fallback) box.appendChild(el('p', { className: 'muted', text: pz.fallback }));
    } else {
      box.appendChild(el('p', { className: 'feedback ok', text: 'Answer: ' + plain(pz.answer) }));
      box.appendChild(feedback);
      reveal();
    }
    return box;
  }

  function stopScreen(index) {
    var stop = stops[index];
    state.current = index; saveState();
    var arrived = !!state.arrived[stop.id];
    var nodes = [
      el('p', { className: 'kicker', text: 'Stop ' + stop.order + ' of ' + walk.route.length }),
      el('h1', { text: stop.name })
    ];

    if (!arrived) {
      var how = index === 0 ? walk.start_text : stops[index - 1].directions_to_next;
      nodes.push(
        el('h2', { text: 'Getting here' }),
        el('p', { text: how }),
        mapView({ pin: stop.map }),
        el('p', { className: 'mapcap', text: stop.map && stop.map[2] !== 'confirmed' ? 'Dashed red circle: approximate position, not yet confirmed.' : 'Red circle: where you are heading.' }),
        el('button', { className: 'wide copper', text: "I'm here", onClick: function () { state.arrived[stop.id] = true; saveState(); route(); } })
      );
    } else {
      nodes.push(photoFigure(stop));
      if (stop.private_note) nodes.push(el('p', { className: 'notice', text: stop.private_note }));
      var anyOn = false;
      walk.layers.forEach(function (l) {
        if (!state.layers[l.key]) return;
        var text = stop.layers && stop.layers[l.key];
        if (!text) return;
        anyOn = true;
        nodes.push(el('section', { className: 'card' + (l.key === 'mystery' ? ' mystery' : '') }, [el('h2', { text: l.label }), el('p', { text: text })]));
      });
      if (!anyOn) nodes.push(el('p', { className: 'muted', text: 'All layers are switched off. Open the menu to switch one on.' }));
      if (stop.puzzle && state.layers.mystery) nodes.push(stop.puzzle.type === 'accuse' ? accuseBlock(stop) : puzzleBlock(stop));
      if (!stop.puzzle && stop.puzzle_note && state.layers.mystery) nodes.push(el('p', { className: 'muted', text: stop.puzzle_note }));
      if (stop.evidence && stop.evidence.length && state.layers.mystery && (!stop.puzzle || state.solved[stop.id])) {
        var ev = el('section', { className: 'card mystery' }, [el('h2', { text: 'Added to your notebook' })]);
        stop.evidence.forEach(function (e) { ev.appendChild(el('p', { text: e })); });
        nodes.push(ev);
      }
      if (index < stops.length - 1) {
        nodes.push(el('section', { className: 'card' }, [el('h2', { text: 'To the next stop' }), el('p', { text: stop.directions_to_next })]));
        nodes.push(mapView({ pin: stops[index + 1].map }));
      } else {
        nodes.push(el('section', { className: 'card' }, [
          el('h2', { text: 'Next' }),
          el('p', { text: stop.directions_to_next }),
        ]));
      }
    }

    var isLast = index === stops.length - 1;
    nodes.push(el('div', { className: 'nav' }, [
      el('button', { className: 'secondary', text: index === 0 ? 'Welcome' : 'Previous', onClick: function () { if (index === 0) location.hash = '#welcome'; else goStop(index - 1); } }),
      el('button', { text: 'Next stop', disabled: isLast, onClick: function () { goStop(index + 1); } })
    ]));
    show(nodes);
  }

  // ---------- page addresses ----------
  function goStop(i) { location.hash = '#' + stops[i].id; }

  var lastScroll = 0;
  function route(keepScroll) {
    if (keepScroll === true) lastScroll = window.scrollY;
    var id = location.hash.replace('#', '');
    if (id === 'route') routeScreen();
    else if (id === 'notebook') notebookScreen();
    else {
      var index = -1;
      stops.forEach(function (s, i) { if (s.id === id) index = i; });
      if (index >= 0) stopScreen(index); else welcomeScreen();
    }
    if (keepScroll === true) window.scrollTo(0, lastScroll);
  }

  function showError(err) {
    app.innerHTML = '';
    app.appendChild(el('h1', { text: 'Could not load the walk' }));
    app.appendChild(el('p', { text: 'The content files could not be read. If you opened index.html straight from your computer this is expected: it must be opened from its web address.' }));
    app.appendChild(el('p', { className: 'muted', text: String(err && err.message || err) }));
  }

  // ---------- start ----------
  fetchJson(CONTENT + 'walk.json')
    .then(function (w) {
      walk = w;
      return Promise.all(w.stops.map(function (f) { return fetchJson(CONTENT + f); }));
    })
    .then(function (loaded) {
      stops = loaded;
      state = loadState();
      loadLogo();
      menuButton.addEventListener('click', function () { if (settingsEl.hidden) openSettings(); else closeSettings(); });
      scrim.addEventListener('click', closeSettings);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !settingsEl.hidden) closeSettings(); });
      window.addEventListener('hashchange', function () { route(); });
      route();
    })
    .catch(showError);
})();
