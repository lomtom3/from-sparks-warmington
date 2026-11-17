/*
  From Sparks Adventures - walk app.
  All words come from the files in /content. Progress and settings are kept on the player's phone.
  Colour code inside text: [[c:...]] cyan = not confirmed yet. Plain text = confirmed. ([[r:...]] is still read, and shown as cyan.)
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
    var s = { current: 0, arrived: {}, solved: {}, hints: {}, wallet: null, revealed: {}, layers: {}, review: true, setupDone: false, gps: false };
    walk.layers.forEach(function (l) { s.layers[l.key] = !!l.default_on; });
    if (saved && typeof saved === 'object') {
      if (typeof saved.current === 'number') s.current = saved.current;
      ['arrived', 'solved', 'hints', 'revealed'].forEach(function (k) {
        if (saved[k] && typeof saved[k] === 'object') s[k] = saved[k];
      });
      if (typeof saved.wallet === 'number') s.wallet = saved.wallet;
      if (typeof saved.review === 'boolean') s.review = saved.review;
      if (typeof saved.setupDone === 'boolean') s.setupDone = saved.setupDone;
      if (typeof saved.gps === 'boolean') s.gps = saved.gps;
      if (saved.layers) Object.keys(s.layers).forEach(function (k) {
        if (typeof saved.layers[k] === 'boolean') s.layers[k] = saved.layers[k];
      });
    }
    if (typeof s.wallet !== 'number') s.wallet = walk.coins.start_total;
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
      span.className = 'c';
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

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- map (markers are drawn here so they can change colour as you walk) ----------
  // Red = where we're talking about. Grey = already visited. Black = still to visit. Cyan = position not confirmed.
  function mapView(focus) {
    var NS = 'http://www.w3.org/2000/svg';
    var RED = '#c0281d', GREY = '#8a8578', GREYT = '#6f6a5c', BLACK = '#1e1a12', CYAN = '#00a5b8', CYANT = '#007f92';
    var wrap = el('div', { className: 'mapwrap' });
    var img = document.createElement('img');
    img.src = MAP.src;
    img.alt = 'Old-style map of Warmington showing the walk';
    wrap.appendChild(img);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', MAP.x0 + ' ' + MAP.y0 + ' ' + MAP.w + ' ' + MAP.h);
    svg.setAttribute('class', 'map-overlay');
    svg.setAttribute('aria-hidden', 'true');
    function add(tag, attrs, text) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text != null) n.textContent = text;
      svg.appendChild(n);
      return n;
    }
    var placed = walk.route.filter(function (r) { return r.map; });
    placed.forEach(function (r) {
      var twin = placed.filter(function (o) { return o.n !== r.n && o.map[0] === r.map[0] && o.map[1] === r.map[1]; })[0];
      if (twin && twin.n < r.n) return;                       // stops 1 and 20 share one marker
      var group = twin ? [r.n, twin.n] : [r.n];
      var isFocus = group.indexOf(focus) >= 0;
      var visited = group.every(function (n) { return !!state.arrived['stop-' + pad(n)]; });
      var unconfirmed = r.map[2] !== 'confirmed';
      var dot, txt;
      if (unconfirmed) { dot = CYAN; txt = CYANT; }
      else if (isFocus) { dot = RED; txt = RED; }
      else if (visited) { dot = GREY; txt = GREYT; }
      else { dot = BLACK; txt = BLACK; }
      var x = r.map[0], y = r.map[1];
      if (isFocus) {
        var ring = { cx: x, cy: y, r: 13, fill: 'none', stroke: RED, 'stroke-width': 3 };
        if (unconfirmed) ring['stroke-dasharray'] = '4 3';
        add('circle', ring);
      }
      add('circle', { cx: x, cy: y, r: 7, fill: dot, stroke: '#f3e7c9', 'stroke-width': 1.5 });
      add('text', { x: x, y: y + 3, 'text-anchor': 'middle', 'font-size': 8.5, 'font-weight': 700, fill: '#fff', 'font-family': 'system-ui,sans-serif' }, String(group[0]));
      var left = r.dir === 'l', up = r.dir === 'u', down = r.dir === 'd';
      add('text', {
        x: (up || down) ? x : (left ? x - 12 : x + 12), y: up ? y - 13 : (down ? y + 21 : y + 3.5), 'text-anchor': (up || down) ? 'middle' : (left ? 'end' : 'start'), 'font-size': 11.5,
        'font-family': 'Georgia,serif', 'font-weight': isFocus ? 700 : 400, fill: txt,
        stroke: '#ead9ab', 'stroke-width': 2.6, 'paint-order': 'stroke'
      }, r.label + (twin ? ' (start, finish)' : ''));
    });
    add('circle', { class: 'you-halo', cx: 0, cy: 0, r: 13, fill: 'rgba(43,108,255,.25)', style: 'display:none' });
    add('circle', { class: 'you-dot', cx: 0, cy: 0, r: 6, fill: '#2b6cff', stroke: '#fff', 'stroke-width': 2, style: 'display:none' });
    wrap.appendChild(svg);
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
    settingsEl.appendChild(el('p', { className: 'muted', text: "Choose what you'd like to see. We'll always keep your place on the walk." }));
    walk.layers.forEach(function (l) {
      settingsEl.appendChild(toggleRow(l.label, l.description, !!state.layers[l.key], function (v) {
        state.layers[l.key] = v; saveState(); route(true);
      }));
    });

    settingsEl.appendChild(el('h3', { text: 'Location' }));
    settingsEl.appendChild(toggleRow('Use my location', "[[c:Shows where you are on the map and tells you when you've reached a stop. It stays on your phone.]]", !!state.gps, function (v) {
      state.gps = v; saveState(); if (v) startGeo(); else stopGeo();
    }));

    settingsEl.appendChild(el('h3', { text: 'Coins' }));
    settingsEl.appendChild(el('p', { className: 'coins' }, [el('span', { className: 'coin-dot' }), document.createTextNode(' You have ' + coinWord(state.wallet) + ' in your purse.')]));
    settingsEl.appendChild(el('p', { className: 'muted', text: walk.coins.explain }));

    settingsEl.appendChild(el('h3', { text: 'Draft checking' }));
    settingsEl.appendChild(toggleRow('Show draft colours', 'Shows anything not confirmed yet in cyan.', !!state.review, function (v) {
      state.review = v; saveState(); document.body.classList.toggle('review', v); renderSettings();
    }));
    settingsEl.appendChild(el('p', {}, [
      el('span', { className: 'swatch-c', text: 'Cyan' }),
      document.createTextNode(' = not confirmed yet (a best guess or a new idea).')
    ]));
    settingsEl.appendChild(el('p', { className: 'muted', text: 'Plain text is confirmed.' }));

    settingsEl.appendChild(el('h3', { text: 'The walk' }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Getting to the start', onClick: function () { closeSettings(); location.hash = '#start'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Change my choices', onClick: function () { closeSettings(); location.hash = '#setup'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Route and map', onClick: function () { closeSettings(); location.hash = '#route'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Evidence notebook', onClick: function () { closeSettings(); location.hash = '#notebook'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Reset my progress', onClick: function () {
      if (window.confirm('Start the walk again from the beginning?')) {
        state.current = 0; state.arrived = {}; state.solved = {}; state.hints = {}; state.wallet = walk.coins.start_total; state.revealed = {}; saveState();
        closeSettings(); location.hash = '#welcome'; route(true);
      }
    } }));
    if (state.review) {
      var rec = loadRecce(), keys = Object.keys(rec).sort();
      settingsEl.appendChild(el('h3', { text: 'Recorded spots (admin)' }));
      if (!keys.length) settingsEl.appendChild(el('p', { className: 'muted', text: 'None yet. Use "Record this spot" on a stop while you are standing there.' }));
      else {
        var txt = keys.map(function (k) { return k + ': ' + rec[k].lat.toFixed(6) + ', ' + rec[k].lon.toFixed(6) + ' (+/-' + Math.round(rec[k].acc) + ' m)'; }).join('\n');
        settingsEl.appendChild(el('pre', { className: 'recce', text: txt }));
        settingsEl.appendChild(el('button', { className: 'secondary small', text: 'Copy these', onClick: function () { try { navigator.clipboard.writeText(txt); } catch (e) { /* ignore */ } } }));
      }
    }
    settingsEl.appendChild(el('p', { className: 'muted', text: 'Map data © OpenStreetMap contributors.' }));
  }


  // ---------- location (opt-in, stays on the phone) ----------
  var GEO = { lat0: 52.50988, lon0: -0.41583, x0: 433, y0: 635, mpp: 3.4 };
  var kLat = 111320 / GEO.mpp, kLon = kLat * Math.cos(GEO.lat0 * Math.PI / 180);
  function xyToLL(x, y) { return { lat: GEO.lat0 - (y - GEO.y0) / kLat, lon: GEO.lon0 + (x - GEO.x0) / kLon }; }
  function llToXY(lat, lon) { return { x: GEO.x0 + (lon - GEO.lon0) * kLon, y: GEO.y0 - (lat - GEO.lat0) * kLat }; }
  function distM(a, b) {
    var R = 6371000, p = Math.PI / 180, dLat = (b.lat - a.lat) * p, dLon = (b.lon - a.lon) * p;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  var RECCE_KEY = 'fromsparks:recce';
  function loadRecce() { try { return JSON.parse(localStorage.getItem(RECCE_KEY)) || {}; } catch (e) { return {}; } }
  function saveRecce(r) { try { localStorage.setItem(RECCE_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ } }
  function stopLL(stop) {
    var rec = loadRecce();
    if (rec[stop.id]) return { lat: rec[stop.id].lat, lon: rec[stop.id].lon, recorded: true };
    var r = walk.route.filter(function (n) { return n.n === stop.order; })[0];
    return r && r.map ? xyToLL(r.map[0], r.map[1]) : null;
  }
  var geo = { id: null, pos: null, err: null };
  function startGeo() {
    if (!state.gps || !navigator.geolocation || geo.id != null) return;
    geo.id = navigator.geolocation.watchPosition(function (p) {
      geo.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; geo.err = null; geoChanged();
    }, function (e) {
      geo.err = e && e.code === 1 ? 'denied' : 'unavailable'; geoChanged();
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }
  function stopGeo() {
    if (geo.id != null && navigator.geolocation) navigator.geolocation.clearWatch(geo.id);
    geo.id = null; geo.pos = null; geo.err = null; geoChanged();
  }
  function updateYouDots() {
    var dots = document.querySelectorAll('.you-dot');
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i], xy = geo.pos && state.gps ? llToXY(geo.pos.lat, geo.pos.lon) : null;
      if (xy && xy.x > MAP.x0 && xy.x < MAP.x0 + MAP.w && xy.y > MAP.y0 && xy.y < MAP.y0 + MAP.h) {
        d.setAttribute('cx', xy.x); d.setAttribute('cy', xy.y); d.style.display = '';
        var halo = d.previousSibling; if (halo) { halo.setAttribute('cx', xy.x); halo.setAttribute('cy', xy.y); halo.style.display = ''; }
      } else {
        d.style.display = 'none'; var h2 = d.previousSibling; if (h2) h2.style.display = 'none';
      }
    }
  }
  function updateArrivalNote() {
    var note = document.getElementById('geo-note'); if (!note) return;
    var stop = stops[state.current], btn = document.getElementById('here-btn');
    note.textContent = ''; note.className = 'geo-note muted';
    if (btn) btn.classList.remove('ready');
    if (!state.gps) return;
    var target = stopLL(stop);
    if (geo.err === 'denied') { note.appendChild(rich("[[c:Location is switched off for this site, so just tap the button when you get there.]]")); return; }
    if (geo.err) { note.appendChild(rich("[[c:We can't find your location right now. Just tap the button when you get there.]]")); return; }
    if (!geo.pos || !target) { note.appendChild(rich("[[c:Finding where you are...]]")); return; }
    var d = distM(geo.pos, target), near = Math.max(40, geo.pos.acc || 0);
    if (d <= near) {
      note.className = 'geo-note ready-note';
      note.appendChild(rich("[[c:You look like you've arrived. Tap the button when you're ready.]]"));
      if (btn) btn.classList.add('ready');
    } else {
      var m = d < 100 ? Math.round(d / 10) * 10 : Math.round(d / 50) * 50;
      var msg = "About " + m + " metres to go.";
      if (stop.map && stop.map[2] !== 'confirmed') msg += " This stop's spot is a best guess, so use the button if we don't spot you.";
      note.appendChild(rich("[[c:" + msg + "]]"));
    }
  }
  function geoChanged() { updateYouDots(); updateArrivalNote(); }
  function recordSpotCard(stop) {
    var out = el('p', { className: 'muted' });
    var rec = loadRecce();
    if (rec[stop.id]) out.textContent = 'Saved: ' + rec[stop.id].lat.toFixed(6) + ', ' + rec[stop.id].lon.toFixed(6) + ' (about ' + Math.round(rec[stop.id].acc) + ' m accuracy)';
    var btn = el('button', { className: 'secondary small', text: 'Record this spot', onClick: function () {
      if (!navigator.geolocation) { out.textContent = 'This phone cannot give a location.'; return; }
      out.textContent = 'Getting a good fix... stand still for a few seconds.';
      navigator.geolocation.getCurrentPosition(function (p) {
        var r = loadRecce(); r[stop.id] = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: new Date().toISOString() }; saveRecce(r);
        out.textContent = 'Saved: ' + p.coords.latitude.toFixed(6) + ', ' + p.coords.longitude.toFixed(6) + ' (about ' + Math.round(p.coords.accuracy) + ' m accuracy)';
      }, function () { out.textContent = 'Could not get a location. Check the location permission for this site.'; }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
    } });
    return el('section', { className: 'card admin' }, [el('p', { className: 'kicker', text: 'Admin (draft colours on)' }), el('p', { className: 'muted', text: 'Standing at this stop? Record the spot so the walk can use the real location.' }), btn, out]);
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
    var go = started ? goStop.bind(null, state.current) : function () { location.hash = state.setupDone ? '#story' : '#setup'; };
    show([
      logoHero(),
      el('p', { className: 'kicker', text: walk.subtitle }),
      el('h1', { text: walk.title }),
      el('p', { text: walk.welcome_text }),
      heroImage(),
      el('button', { className: 'wide copper', text: started ? 'Continue my walk' : "Let's get started", onClick: go }),
      el('button', { className: 'wide secondary', text: '[[c:Find the start (parking and directions)]]', onClick: function () { location.hash = '#start'; } }),
      el('button', { className: 'wide secondary', text: 'See the whole route', onClick: function () { location.hash = '#route'; } })
    ]);
  }

  function setupScreen() {
    function step(n, title, rows) {
      return el('section', { className: 'card' }, [el('p', { className: 'kicker', text: 'Step ' + n + ' of 3' }), el('h2', { text: title })].concat(rows));
    }
    show([
      el('p', { className: 'kicker', text: walk.subtitle }),
      el('h1', { text: '[[c:How would you like your walk?]]' }),
      el('p', { className: 'muted', text: "[[c:Nothing here is fixed. You can change any of it later from the menu at the top right.]]" }),
      step(1, '[[c:How much history?]]', [
        toggleRow('Essential history', '[[c:Short, true facts about each stop.]]', !!state.layers.essential_history, function (v) { state.layers.essential_history = v; saveState(); }),
        toggleRow('Deeper history', '[[c:More for the curious. Fewer people want this, so it starts switched off.]]', !!state.layers.deeper_history, function (v) { state.layers.deeper_history = v; saveState(); })
      ]),
      step(2, '[[c:Do you want the mystery?]]', [
        toggleRow('Mystery story and puzzles', "[[c:Switch it off for a history-only walk. Your place is always kept.]]", !!state.layers.mystery, function (v) { state.layers.mystery = v; saveState(); })
      ]),
      step(3, '[[c:Help finding your way?]]', [
        toggleRow('Use my location', "[[c:We'll show where you are on the map and tell you when you've reached a stop. It stays on your phone and isn't sent anywhere. It only works while the app is open.]]", !!state.gps, function (v) {
          state.gps = v; saveState(); if (v) startGeo(); else stopGeo();
        })
      ]),
      el('button', { className: 'wide copper', text: '[[c:Next: the story]]', onClick: function () { state.setupDone = true; saveState(); location.hash = '#story'; } }),
      el('button', { className: 'wide secondary', text: '[[c:Find the start (parking and directions)]]', onClick: function () { location.hash = '#start'; } }),
      el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back', onClick: function () { location.hash = '#welcome'; } })])
    ]);
  }

  function storyScreen() {
    var nodes = [el('p', { className: 'kicker', text: 'The story so far' }), el('h1', { text: walk.title })];
    walk.story.forEach(function (p) { nodes.push(el('p', { className: 'story', text: p })); });
    nodes.push(
      el('button', { className: 'wide copper', text: '[[c:Find the start]]', onClick: function () { location.hash = '#start'; } }),
      el('button', { className: 'wide secondary', text: "[[c:I'm at the Red Lion: begin the walk]]", onClick: function () { var s1 = stops[0]; state.arrived[s1.id] = true; state.current = 0; saveState(); goStop(0); } }),
      el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back', onClick: function () { location.hash = '#setup'; } })])
    );
    show(nodes);
  }

  function startScreen() {
    var sp = walk.start_page;
    var nodes = [el('p', { className: 'kicker', text: 'Before you set off' }), el('h1', { text: sp.title }), el('p', { text: sp.intro })];
    if (stops[0].photo) nodes.push(photoFigure(stops[0]));
    sp.parking.forEach(function (p) { nodes.push(el('p', { text: p })); });
    nodes.push(
      el('section', { className: 'card support' }, [el('p', { text: sp.support })]),
      el('a', { className: 'btn-link wide', text: sp.map_label, attrs: { href: sp.map_url, target: '_blank', rel: 'noopener' } }),
      mapView(1),
      el('button', { className: 'wide copper', text: "[[c:I'm at the Red Lion: begin the walk]]", onClick: function () { var s1 = stops[0]; state.arrived[s1.id] = true; state.current = 0; saveState(); goStop(0); } }),
      el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back', onClick: function () { history.length > 1 ? history.back() : (location.hash = '#welcome'); } })])
    );
    show(nodes);
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
      mapView(state.current + 1),
      el('p', { className: 'mapcap', text: "Stops without a dot aren't on the map yet." }),
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
    if (!items.length) nodes.push(el('p', { className: 'muted', text: 'Nothing yet. Solve puzzles as you walk and your clues will turn up here.' }));
    items.forEach(function (it) {
      nodes.push(el('section', { className: 'card mystery' }, [el('p', { className: 'kicker', text: it.stop }), el('p', { text: it.text })]));
    });
    nodes.push(el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back to the walk', onClick: function () { goStop(state.current); } })]));
    show(nodes);
  }

  // Coins: one purse for the whole walk. Hints are free. Showing the answer costs more the fewer hints you used.
  function coinsLeft() { return state.wallet; }
  function coinWord(n) { return n + (n === 1 ? ' coin' : ' coins'); }

  function helpers(stop, pz, box, onReveal) {
    var hintsShown = state.hints[stop.id] || 0;
    var coinLine = el('p', { className: 'coins' });
    var hintBox = el('div');
    var hintBtn, showBtn;
    function cost() { return walk.coins.cost_by_hints_used[String(Math.min(hintsShown, 3))]; }
    function refresh() {
      var left = coinsLeft(), c = cost();
      coinLine.textContent = '';
      coinLine.appendChild(el('span', { className: 'coin-dot' }));
      coinLine.appendChild(document.createTextNode(' Coins in your purse: ' + left));
      if (left < c) coinLine.appendChild(el('span', { className: 'c muted', text: left === 0 ? "  You're out of coins. Top-ups are coming soon, and hints are still free." : '  Not enough coins for the answer yet. Each hint you read lowers the price.' }));
      hintBox.innerHTML = '';
      for (var i = 0; i < hintsShown; i++) hintBox.appendChild(el('p', { className: 'card', text: 'Hint ' + (i + 1) + ': ' + pz.hints[i] }));
      hintBtn.disabled = hintsShown >= pz.hints.length;
      showBtn.textContent = 'Show the answer (' + coinWord(c) + ')';
      showBtn.disabled = left < c;
    }
    hintBtn = el('button', { className: 'secondary small', text: 'Give me a hint (free)', onClick: function () {
      if (hintsShown < pz.hints.length) { hintsShown++; state.hints[stop.id] = hintsShown; saveState(); refresh(); }
    } });
    showBtn = el('button', { className: 'secondary small', onClick: function () {
      var c = cost(), left = coinsLeft();
      if (left < c) return;
      state.wallet = left - c; state.revealed[stop.id] = true; state.solved[stop.id] = true; saveState(); onReveal();
    } });
    box.appendChild(coinLine);
    box.appendChild(el('div', { className: 'nav' }, [hintBtn, showBtn]));
    box.appendChild(hintBox);
    refresh();
  }

  function accuseBlock(stop) {
    var pz = stop.puzzle;
    var solved = !!state.solved[stop.id];
    var box = el('section', { className: 'card puzzle' }, [
      el('p', { className: 'kicker', text: 'The big finish' }), el('h2', { text: pz.title }), el('p', { text: pz.intro }),
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
        if (empty) { feedback.className = 'feedback no'; feedback.textContent = 'Pick an answer for each question first.'; return; }
        if (right === pz.fields.length) { state.solved[stop.id] = true; saveState(); route(true); }
        else { feedback.className = 'feedback no'; feedback.textContent = 'Not quite: ' + right + ' of ' + pz.fields.length + ' are right. Have a look through your notebook and try again.'; }
      } }));
      box.appendChild(feedback);
      helpers(stop, pz, box, function () { route(true); });
      if (pz.fallback) box.appendChild(el('p', { className: 'muted', text: pz.fallback }));
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
          feedback.textContent = 'Not quite. Have another go, or take a hint.';
        }
      }
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
      box.appendChild(el('div', { className: 'answer-row' }, [input, el('button', { text: 'Check', onClick: check })]));
      box.appendChild(feedback);
      helpers(stop, pz, box, function () { route(true); });
      if (pz.fallback) box.appendChild(el('p', { className: 'muted', text: pz.fallback }));
    } else {
      box.appendChild(el('p', { className: 'feedback ok', text: 'Answer: ' + plain(pz.answer) }));
      box.appendChild(el('p', { className: 'feedback ok', text: pz.reveal }));
      box.appendChild(el('p', { className: 'coins' }, [el('span', { className: 'coin-dot' }), document.createTextNode(' Coins left in your purse: ' + coinsLeft())]));
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
        el('h2', { text: 'How to get there' }),
        el('p', { text: how }),
        index > 0 && stops[index - 1].on_the_way ? el('p', { className: 'card', text: stops[index - 1].on_the_way }) : null,
        mapView(stop.order),
        el('p', { className: 'mapcap', text: !stop.map ? "[[c:This stop isn't on the map yet.]]" : stop.map[2] !== 'confirmed' ? "[[c:We're still checking exactly where this stop is, so its circle is dashed.]]" : "The red circle is where you're heading." }),
        el('p', { className: 'geo-note muted', attrs: { id: 'geo-note' } }),
        el('button', { className: 'wide copper', text: "I'm here", attrs: { id: 'here-btn' }, onClick: function () { state.arrived[stop.id] = true; saveState(); route(); } })
      );
    } else {
      nodes.push(photoFigure(stop));
      if (stop.private_note) nodes.push(el('p', { className: 'notice', text: stop.private_note }));
      if (stop.credit) nodes.push(el('p', { className: 'muted', text: stop.credit }));
      if (stop.support) nodes.push(el('section', { className: 'card support' }, [el('p', { text: stop.support })]));
      var anyOn = false;
      walk.layers.forEach(function (l) {
        if (!state.layers[l.key]) return;
        var text = stop.layers && stop.layers[l.key];
        if (!text) return;
        anyOn = true;
        nodes.push(el('section', { className: 'card' + (l.key === 'mystery' ? ' mystery' : '') }, [el('h2', { text: l.label }), el('p', { text: text })]));
      });
      if (!anyOn) nodes.push(el('p', { className: 'muted', text: "Everything's switched off at the moment. Open the menu to turn something back on." }));
      if (stop.puzzle && state.layers.mystery) nodes.push(stop.puzzle.type === 'accuse' ? accuseBlock(stop) : puzzleBlock(stop));
      if (!stop.puzzle && stop.puzzle_note && state.layers.mystery) nodes.push(el('p', { className: 'muted', text: stop.puzzle_note }));
      if (stop.evidence && stop.evidence.length && state.layers.mystery && (!stop.puzzle || state.solved[stop.id])) {
        var ev = el('section', { className: 'card mystery' }, [el('h2', { text: 'Added to your notebook' })]);
        stop.evidence.forEach(function (e) { ev.appendChild(el('p', { text: e })); });
        nodes.push(ev);
      }
      if (index < stops.length - 1) {
        nodes.push(el('section', { className: 'card' }, [el('h2', { text: 'On to the next stop' }), el('p', { text: stop.directions_to_next })].concat(stop.on_the_way ? [el('p', { text: stop.on_the_way })] : [])));
        nodes.push(mapView(stops[index + 1].order));
      } else {
        nodes.push(el('section', { className: 'card' }, [
          el('h2', { text: 'The end' }),
          el('p', { text: stop.directions_to_next }),
        ]));
      }
    }

    if (stop.sources && stop.sources.length && state.review) {
      var srcBox = el('section', { className: 'card' }, [el('p', { className: 'kicker', text: 'Sources (draft checking only)' })]);
      stop.sources.forEach(function (x) { srcBox.appendChild(el('p', { className: 'muted' }, [el('a', { text: x.title, attrs: { href: x.url, target: '_blank', rel: 'noopener' } })])); });
      nodes.push(srcBox);
    }
    if (state.review) nodes.push(recordSpotCard(stop));
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
    else if (id === 'setup') setupScreen();
    else if (id === 'story') storyScreen();
    else if (id === 'start') startScreen();
    else if (id === 'notebook') notebookScreen();
    else {
      var index = -1;
      stops.forEach(function (s, i) { if (s.id === id) index = i; });
      if (index >= 0) stopScreen(index); else welcomeScreen();
    }
    if (keepScroll === true) window.scrollTo(0, lastScroll);
    if (state.gps) startGeo();
    geoChanged();
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
