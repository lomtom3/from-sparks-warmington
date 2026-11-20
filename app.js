/*
  From Sparks Adventures - walk app.
  All words come from the files in /content. Progress and settings are kept on the player's phone.
  Colour code inside text: [[c:...]] cyan = not confirmed yet. Plain text = confirmed. ([[r:...]] is still read, and shown as cyan.)
*/
(function () {
  'use strict';

  var ROOT_CONTENT = 'villages/';
  var CONTENT = 'villages/warmington/';       // set to the chosen village's folder when a walk loads
  var MAP = { src: 'villages/warmington/map.svg', x0: 215, y0: 470, w: 490, h: 430 };
  var VILLAGE_KEY = 'fromsparks:village';
  var villages = [], villageId = null, allStops = [], ROUTE = [], booted = false;
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
    var s = { current: 0, arrived: {}, solved: {}, hints: {}, wallet: null, revealed: {}, layers: {}, review: true, setupDone: false, gps: false, furthest: 0, access: false, length: null };
    walk.layers.forEach(function (l) { s.layers[l.key] = !!l.default_on; });
    if (saved && typeof saved === 'object') {
      if (typeof saved.current === 'number') s.current = saved.current;
      if (typeof saved.furthest === 'number') s.furthest = saved.furthest;
      ['arrived', 'solved', 'hints', 'revealed'].forEach(function (k) {
        if (saved[k] && typeof saved[k] === 'object') s[k] = saved[k];
      });
      if (typeof saved.wallet === 'number') s.wallet = saved.wallet;
      if (typeof saved.review === 'boolean') s.review = saved.review;
      if (typeof saved.setupDone === 'boolean') s.setupDone = saved.setupDone;
      if (typeof saved.gps === 'boolean') s.gps = saved.gps;
      if (typeof saved.access === 'boolean') s.access = saved.access;
      if (typeof saved.length === 'string') s.length = saved.length;
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

  function reviewGuess() {
    try { var s = JSON.parse(localStorage.getItem('fromsparks:warmington-medium')); return !s || s.review !== false; } catch (e) { return true; }
  }
  function show(nodes) {
    if (typeof hideCompass === 'function') hideCompass();
    app.innerHTML = '';
    nodes.forEach(function (n) { if (n) app.appendChild(n); });
    document.body.classList.toggle('review', state ? !!state.review : reviewGuess());
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
  function legPoints(a, b) {
    var L = walk.legs && (walk.legs[a.n + '-' + b.n]);
    if (!L) return [[a.map[0], a.map[1]], [b.map[0], b.map[1]]];
    return L[1].split(' ').map(function (p) { return p.split(',').map(Number); });
  }
  function idOfOrder(n) { var s = allStops.filter(function (x) { return x.order === n; })[0]; return s ? s.id : ''; }
  function lengthStops(len) { return walk.route.filter(function (r) { return len.stops === 'all' || len.stops.indexOf(r.n) >= 0; }); }
  function lengthKm(len) {
    var rs = lengthStops(len).filter(function (r) { return r.map; }), m = 0;
    for (var i = 0; i < rs.length - 1; i++) { var L = walk.legs && walk.legs[rs[i].n + '-' + rs[i + 1].n]; if (L) m += L[0]; else return null; }
    return Math.round(m / 100) / 10;
  }
  // Directions between two stops on the chosen route. Uses the written directions when the next stop is the very next one,
  // otherwise (a shorter route skipping stops) builds them from the map.
  function dirsBetween(a, b) {
    if (!a || !b) return '';
    if (b.order === a.order + 1 || !a.directions_to_next) return a.directions_to_next || '';
    var ra = walk.route.filter(function (r) { return r.n === a.order; })[0], rb = walk.route.filter(function (r) { return r.n === b.order; })[0];
    var L = walk.legs && walk.legs[a.order + '-' + b.order];
    var name = b.name.replace(/\[\[c:|\]\]/g, '');
    if (!ra || !rb || !ra.map || !rb.map) return '[[c:Next, head to ' + name + '. Follow the route line on the map.]]';
    var la = xyToLL(ra.map[0], ra.map[1]), lb = xyToLL(rb.map[0], rb.map[1]);
    var m = L ? L[0] : distM(la, lb);
    m = m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50;
    return '[[c:Next, head ' + compassWord(bearingTo(la, lb)) + ' to ' + name + ', about ' + m + ' metres along the route. Follow the coloured line on the map. Keep to pavements and public paths.]]';
  }
  function mapView(focus, opts) {
    opts = opts || {};
    var NS = 'http://www.w3.org/2000/svg';
    var RED = '#c0281d', GREY = '#8a8578', GREYT = '#6f6a5c', BLACK = '#1e1a12', CYAN = '#00a5b8', CYANT = '#007f92';
    var K = MAP.scale || 1;
    var wrap = el('div', { className: 'mapwrap' });
    var img = document.createElement('img');
    img.src = MAP.src;
    img.alt = 'Old-style map of the village showing the walk';
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
    var placed = (opts.preview ? walk.route : ROUTE).filter(function (r) { return r.map; });
    function poly(pts, attrs) { attrs.points = pts.map(function (p) { return p.join(','); }).join(' '); attrs.fill = 'none'; attrs['stroke-linecap'] = 'round'; attrs['stroke-linejoin'] = 'round'; return add('polyline', attrs); }
    if (opts.preview) {
      // Every route in its own colour: long underneath, short on top.
      lengths().slice().reverse().forEach(function (len) {
        var rs = lengthStops(len).filter(function (r) { return r.map; });
        for (var j = 0; j < rs.length - 1; j++) poly(legPoints(rs[j], rs[j + 1]), { stroke: len.colour || '#a8592a', 'stroke-opacity': 0.9, 'stroke-width': (len.key === 'short' ? 3 : 4.2) * K });
      });
    } else {
      // Route line along the real roads and paths: faint half-tone grey ahead, darker where you've walked.
      var far = Math.max(state.furthest || 0, state.current || 0);      // index of the furthest stop opened
      for (var li = 0; li < placed.length - 1; li++) {
        var pa = placed[li], pb = placed[li + 1];
        if (pa.map[0] === pb.map[0] && pa.map[1] === pb.map[1]) continue;
        var walked = far >= li + 1;
        poly(legPoints(pa, pb), walked
          ? { stroke: '#1e1a12', 'stroke-opacity': 0.55, 'stroke-width': 2.4 * K }
          : { stroke: '#8a8578', 'stroke-opacity': 0.35, 'stroke-width': 2 * K, 'stroke-dasharray': (5 * K) + ' ' + (4 * K) });
      }
    }
    placed.forEach(function (r) {
      var twin = placed.filter(function (o) { return o.n !== r.n && o.map[0] === r.map[0] && o.map[1] === r.map[1]; })[0];
      if (twin && twin.n < r.n) return;                       // stops 1 and 20 share one marker
      var group = twin ? [r.n, twin.n] : [r.n];
      var isFocus = !opts.preview && group.indexOf(focus) >= 0;
      var visited = !opts.preview && group.every(function (n) { return !!state.arrived[idOfOrder(n)]; });
      var unconfirmed = r.map[2] !== 'confirmed';
      var dot, txt;
      if (unconfirmed) { dot = CYAN; txt = CYANT; }
      else if (isFocus) { dot = RED; txt = RED; }
      else if (visited) { dot = GREY; txt = GREYT; }
      else { dot = BLACK; txt = BLACK; }
      var x = r.map[0], y = r.map[1];
      if (isFocus) {
        var ring = { cx: x, cy: y, r: 13 * K, fill: 'none', stroke: RED, 'stroke-width': 3 * K };
        if (unconfirmed) ring['stroke-dasharray'] = (4 * K) + ' ' + (3 * K);
        add('circle', ring);
      }
      var fade = (visited && !isFocus && !unconfirmed) ? 0.5 : 1;
      add('circle', { cx: x, cy: y, r: 7 * K, fill: dot, stroke: '#f3e7c9', 'stroke-width': 1.5 * K, opacity: fade });
      add('text', { x: x, y: y + 3 * K, 'text-anchor': 'middle', 'font-size': 8.5 * K, 'font-weight': 700, fill: '#fff', 'font-family': 'system-ui,sans-serif' }, String(group[0]));
      var left = r.dir === 'l', up = r.dir === 'u', down = r.dir === 'd';
      add('text', {
        x: (up || down) ? x : (left ? x - 12 * K : x + 12 * K), y: up ? y - 13 * K : (down ? y + 21 * K : y + 3.5 * K), 'text-anchor': (up || down) ? 'middle' : (left ? 'end' : 'start'), 'font-size': 11.5 * K,
        'font-family': 'Georgia,serif', 'font-weight': isFocus ? 700 : 400, fill: txt, opacity: fade,
        stroke: '#ead9ab', 'stroke-width': 2.6 * K, 'paint-order': 'stroke'
      }, r.label + (twin ? ' (start, finish)' : ''));
    });
    add('text', { x: MAP.x0 + MAP.w - 5 * K, y: MAP.y0 + MAP.h - 5 * K, 'text-anchor': 'end', 'font-size': 7.5 * K, fill: '#3b2a14', stroke: '#ead9ab', 'stroke-width': 2 * K, 'paint-order': 'stroke', 'font-family': 'system-ui,sans-serif' }, '© OpenStreetMap contributors');
    add('circle', { class: 'you-halo', cx: 0, cy: 0, r: 13 * K, fill: 'rgba(43,108,255,.25)', style: 'display:none' });
    add('circle', { class: 'you-dot', cx: 0, cy: 0, r: 6 * K, fill: '#2b6cff', stroke: '#fff', 'stroke-width': 2 * K, style: 'display:none' });
    wrap.appendChild(svg);
    return wrap;
  }

  function routeLegend() {
    var box = el('div', { className: 'route-legend' });
    lengths().forEach(function (len) {
      var km = lengthKm(len), n = lengthStops(len).length;
      box.appendChild(el('p', {}, [el('span', { className: 'swatch', attrs: { style: 'background:' + (len.colour || '#a8592a') } }), el('strong', { text: len.label }), el('span', { className: 'muted', text: '  ' + n + ' stops' + (km ? ', about ' + km + ' km' : '') })]));
    });
    return box;
  }

  // ---------- direction compass ----------
  var compass = { el: null, target: null, heading: null, listening: false };
  function compassFace() {
    var t = ['N', 'E', 'S', 'W'].map(function (l, i) { var a = i * 90 * Math.PI / 180; return '<text x="' + (50 + 33 * Math.sin(a)).toFixed(1) + '" y="' + (53 - 33 * Math.cos(a)).toFixed(1) + '" text-anchor="middle" font-size="10" font-family="Georgia,serif" fill="' + (l === 'N' ? '#a8592a' : '#3b2a14') + '">' + l + '</text>'; }).join('');
    return '<svg viewBox="0 0 100 100" class="compass-svg"><circle cx="50" cy="50" r="47" fill="#ead9ab" stroke="#3b2a14" stroke-width="3"/><circle cx="50" cy="50" r="41" fill="none" stroke="#3b2a14" stroke-width="1"/>' +
      '<g class="rose" opacity=".35"><path d="M50 14 L54 50 L50 86 L46 50Z M14 50 L50 46 L86 50 L50 54Z" fill="#3b2a14"/></g>' + t +
      '<g class="needle"><path d="M50 12 L57 52 L50 46 L43 52Z" fill="#a8592a" stroke="#3b2a14" stroke-width="1"/><path d="M50 88 L56 52 L50 56 L44 52Z" fill="#f3e7c9" stroke="#3b2a14" stroke-width="1"/><circle cx="50" cy="50" r="4" fill="#3b2a14"/></g></svg>';
  }
  function bearingTo(a, b) {
    var p = Math.PI / 180, y = Math.sin((b.lon - a.lon) * p) * Math.cos(b.lat * p);
    var x = Math.cos(a.lat * p) * Math.sin(b.lat * p) - Math.sin(a.lat * p) * Math.cos(b.lat * p) * Math.cos((b.lon - a.lon) * p);
    return (Math.atan2(y, x) / p + 360) % 360;
  }
  function compassWord(deg) { return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8]; }
  function onOrient(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
    if (h != null) { compass.heading = h; updateCompass(); }
  }
  function listenHeading() {
    if (compass.listening) return; compass.listening = true;
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
  }
  function askHeading() {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function (r) { if (r === 'granted') listenHeading(); updateCompass(); }).catch(function () { updateCompass(); });
    } else listenHeading();
  }
  function showCompass(target, label, container) {
    hideCompass();
    if (!target) return null;
    var box = el('div', { className: container ? 'compass inline' : 'compass floating', attrs: { role: 'status' } });
    var face = el('div', { className: 'compass-face' }); face.innerHTML = compassFace();
    var txt = el('div', { className: 'compass-text' });
    box.appendChild(face); box.appendChild(txt);
    compass.el = box; compass.target = target; compass.label = label;
    if (!(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function')) listenHeading();
    (container || document.body).appendChild(box);
    if (state.gps) startGeo();
    updateCompass();
    return box;
  }
  function hideCompass() { if (compass.el && compass.el.parentNode) compass.el.parentNode.removeChild(compass.el); compass.el = null; compass.target = null; }
  function updateCompass() {
    var box = compass.el; if (!box) return;
    var txt = box.querySelector('.compass-text'), needle = box.querySelector('.needle'), rose = box.querySelector('.rose');
    txt.innerHTML = '';
    if (!state.gps) {
      txt.appendChild(el('span', { text: 'Compass to ' + compass.label }));
      txt.appendChild(el('button', { className: 'small', text: 'Use my location', onClick: function () { state.gps = true; saveState(); startGeo(); askHeading(); updateCompass(); } }));
      needle.setAttribute('transform', 'rotate(0 50 50)'); return;
    }
    if (geo.err) { txt.appendChild(el('span', { text: 'Location unavailable. Follow the directions on the page.' })); return; }
    if (!geo.pos) { txt.appendChild(el('span', { text: 'Finding where you are...' })); return; }
    var d = distM(geo.pos, compass.target), b = bearingTo(geo.pos, compass.target);
    var near = Math.max(40, geo.pos.acc || 0);
    var m = d < 100 ? Math.round(d / 10) * 10 : (d < 1000 ? Math.round(d / 50) * 50 : Math.round(d / 100) * 100);
    if (compass.heading != null) {
      needle.setAttribute('transform', 'rotate(' + (b - compass.heading).toFixed(1) + ' 50 50)');
      rose.setAttribute('transform', 'rotate(' + (-compass.heading).toFixed(1) + ' 50 50)');
    } else {
      needle.setAttribute('transform', 'rotate(' + b.toFixed(1) + ' 50 50)'); rose.removeAttribute('transform');
    }
    if (d <= near) { txt.appendChild(el('strong', { text: "You're about there!" })); return; }
    txt.appendChild(el('strong', { text: (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m') }));
    txt.appendChild(el('span', { text: ' ' + compassWord(b) + ' to ' + compass.label }));
    if (compass.heading == null && window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      txt.appendChild(el('button', { className: 'small', text: 'Turn on compass', onClick: askHeading }));
    } else if (compass.heading == null) {
      txt.appendChild(el('span', { className: 'muted', text: ' (needle points as if the top of your phone faces north)' }));
    }
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

    settingsEl.appendChild(el('h3', { text: 'Go back to a stop' }));
    var done = reachedIndex();
    if (done < 0) settingsEl.appendChild(el('p', { className: 'muted', text: "Nothing yet. The stops you reach will be listed here." }));
    else {
      var ul = el('ul', { className: 'route-list' });
      for (var si = 0; si <= done; si++) {
        (function (st) {
          ul.appendChild(el('li', {}, [el('span', { className: 'num', text: String(st.order) }), el('a', { text: st.name + (stops[state.current] === st ? ' (you are here)' : ''), attrs: { href: '#' + st.id }, onClick: function () { closeSettings(); } })]));
        })(stops[si]);
      }
      settingsEl.appendChild(ul);
    }
    if (accessOn() && !state.access) settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Enter access code', onClick: function () { closeSettings(); location.hash = '#unlock'; } }));
    if (lengths().length > 1) {
      settingsEl.appendChild(el('h3', { text: 'Walk length' }));
      lengthRows().forEach(function (r) { r.querySelector('input').addEventListener('change', function () { route(true); }); settingsEl.appendChild(r); });
    }
    var offOut = el('p', { className: 'muted' });
    settingsEl.appendChild(el('h3', { text: 'No signal on the walk?' }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Save this walk to my phone', onClick: function () { saveOffline(offOut); } }));
    settingsEl.appendChild(offOut);
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'About, safety and privacy', onClick: function () { closeSettings(); location.hash = '#about'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Choose a different village', onClick: function () { closeSettings(); location.hash = '#villages'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Welcome page', onClick: function () { closeSettings(); location.hash = '#welcome'; } }));
    settingsEl.appendChild(el('h3', { text: 'The walk' }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Getting to the start', onClick: function () { closeSettings(); location.hash = '#start'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Change my choices', onClick: function () { closeSettings(); location.hash = '#setup'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Route and map', onClick: function () { closeSettings(); location.hash = '#route'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Evidence notebook', onClick: function () { closeSettings(); location.hash = '#notebook'; } }));
    settingsEl.appendChild(el('button', { className: 'secondary wide', text: 'Reset my progress', onClick: function () {
      if (window.confirm('Start the walk again from the beginning?')) {
        state.current = 0; state.furthest = 0; state.arrived = {}; state.solved = {}; state.hints = {}; state.wallet = walk.coins.start_total; state.revealed = {}; saveState();
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



  // ---------- characters (pictures from the owner's artwork) ----------
  var CHARS = [];   // set from the walk's "cast" list when a walk loads
  function charFor(text) {
    var t = String(text).replace(/\[\[[rc]:|\]\]/g, '').trim().toUpperCase();
    for (var i = 0; i < CHARS.length; i++) if (t.indexOf(CHARS[i].key) === 0) return CHARS[i];
    return null;
  }
  function avatar(c) {
    var img = document.createElement('img');
    img.className = 'avatar'; img.src = c.img; img.alt = c.name; img.loading = 'lazy';
    img.addEventListener('error', function () { img.remove(); });
    return img;
  }
  function suspectsGrid(heading) {
    var grid = el('div', { className: 'suspects' });
    CHARS.forEach(function (c) {
      var fig = el('figure', { className: 'suspect' });
      var img = document.createElement('img');
      img.src = c.img; img.alt = c.name; img.loading = 'lazy';
      img.addEventListener('error', function () { img.remove(); fig.classList.add('no-pic'); });
      fig.appendChild(img);
      fig.appendChild(el('figcaption', {}, [el('strong', { text: c.name }), document.createElement('br'), document.createTextNode(c.role)]));
      grid.appendChild(fig);
    });
    return el('section', {}, [heading ? el('h2', { text: heading }) : null, grid]);
  }
  function sceneFigure(art) {
    if (!art) return null;
    var fig = el('figure', { className: 'stop-photo char-scene' });
    var img = document.createElement('img');
    img.src = art.src; img.alt = plain(art.caption || ''); img.loading = 'lazy';
    img.addEventListener('error', function () { fig.remove(); });
    fig.appendChild(img);
    if (art.caption) fig.appendChild(el('figcaption', { text: art.caption }));
    return fig;
  }

  // ---------- location (opt-in, stays on the phone) ----------
  var GEO = { lat0: 52.50988, lon0: -0.41583, x0: 433, y0: 635, mpp: 3.4 };
  var kLat = 111320 / GEO.mpp, kLon = kLat * Math.cos(GEO.lat0 * Math.PI / 180);
  function setGeo(g) { if (!g) return; GEO = g; kLat = 111320 / GEO.mpp; kLon = kLat * Math.cos(GEO.lat0 * Math.PI / 180); }
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
    var r = ROUTE.filter(function (n) { return n.n === stop.order; })[0];
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
  function geoChanged() { updateYouDots(); updateArrivalNote(); updateCompass(); }
  function recordSpotCard(stop) {
    var out = el('p', { className: 'muted' });
    var rec = loadRecce();
    if (rec[stop.id]) out.textContent = 'Saved: ' + rec[stop.id].lat.toFixed(6) + ', ' + rec[stop.id].lon.toFixed(6) + ' (about ' + Math.round(rec[stop.id].acc) + ' m accuracy)';
    var live = el('p', { className: 'geo-note', text: 'Checking your location accuracy...' });
    if (navigator.geolocation) {
      var wid = navigator.geolocation.watchPosition(function (p) {
        var a = Math.round(p.coords.accuracy);
        live.textContent = 'Accuracy right now: about ' + a + ' m. ' + (a <= 15 ? 'Good enough, tap Record.' : 'Wait a few seconds, it improves outdoors.');
        live.className = 'geo-note' + (a <= 15 ? ' ready-note' : '');
      }, function () { live.textContent = 'No location yet. Check the location permission for this site.'; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
      var stopWatch = function () { navigator.geolocation.clearWatch(wid); };
      window.addEventListener('hashchange', stopWatch, { once: true });
      setTimeout(stopWatch, 180000);
    }
    var btn = el('button', { className: 'secondary small', text: 'Record this spot', onClick: function () {
      if (!navigator.geolocation) { out.textContent = 'This phone cannot give a location.'; return; }
      out.textContent = 'Getting a good fix... stand still for a few seconds.';
      navigator.geolocation.getCurrentPosition(function (p) {
        var r = loadRecce(); r[stop.id] = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: new Date().toISOString() }; saveRecce(r);
        out.textContent = 'Saved: ' + p.coords.latitude.toFixed(6) + ', ' + p.coords.longitude.toFixed(6) + ' (about ' + Math.round(p.coords.accuracy) + ' m accuracy)';
      }, function () { out.textContent = 'Could not get a location. Check the location permission for this site.'; }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
    } });
    return el('section', { className: 'card admin' }, [el('p', { className: 'kicker', text: 'Admin (draft colours on)' }), el('p', { className: 'muted', text: 'Standing at this stop? Record the spot so the walk can use the real location.' }), live, btn, out]);
  }

  // ---------- screens ----------
  // Character picture (DRAFT, not final). Hidden safely if the file is missing.
  function heroImage() {
    var fig = el('figure', { className: 'stop-photo hero' });
    var img = document.createElement('img');
    if (!walk.hero_image) return null;
    img.src = walk.hero_image.src; img.alt = walk.hero_image.alt || '';
    img.addEventListener('error', function () { fig.remove(); });
    fig.appendChild(img);
    if (walk.hero_image.caption) fig.appendChild(el('figcaption', { text: walk.hero_image.caption }));
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
      el('h2', { text: lengths().length > 1 ? 'The routes' : 'The route' }),
      mapView(0, { preview: true }),
      routeLegend(),
      el('button', { className: 'wide copper', text: started ? 'Continue my walk' : "Let's get started", onClick: go }),
      el('button', { className: 'wide secondary', text: '[[c:Find the start (parking and directions)]]', onClick: function () { location.hash = '#start'; } }),
      el('button', { className: 'wide secondary', text: 'See the whole route', onClick: function () { location.hash = '#route'; } }),
      el('button', { className: 'wide secondary', text: 'Choose a different village', onClick: function () { location.hash = '#villages'; } })
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
      lengths().length > 1 ? el('section', { className: 'card' }, [el('h2', { text: '[[c:How long a walk?]]' })].concat(lengthRows())) : null,
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
    if (walk.story_image) {
      var sealed = el('figure', { className: 'stop-photo hero' }), simg = document.createElement('img');
      simg.src = walk.story_image.src; simg.alt = walk.story_image.alt || '';
      simg.addEventListener('error', function () { sealed.remove(); });
      sealed.appendChild(simg); if (walk.story_image.caption) sealed.appendChild(el('figcaption', { text: walk.story_image.caption }));
      nodes.push(sealed);
    }
    walk.story.forEach(function (p) { nodes.push(el('p', { className: 'story', text: p })); });
    if (CHARS.length) nodes.push(suspectsGrid('Who you\'ll meet'));
    nodes.push(
      el('button', { className: 'wide copper', text: '[[c:Find the start]]', onClick: function () { location.hash = '#start'; } }),
      el('button', { className: 'wide secondary', text: walk.start_page.begin_label, onClick: function () { var s1 = stops[0]; state.arrived[s1.id] = true; state.current = 0; saveState(); goStop(0); } }),
      el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back', onClick: function () { location.hash = '#setup'; } })])
    );
    show(nodes);
  }

  // ---------- walk length (shorter / longer). Choice shows once walk.json has 2+ lengths ----------
  function lengths() { return walk.lengths && walk.lengths.length ? walk.lengths : [{ key: 'standard', stops: 'all' }]; }
  function currentLength() {
    var L = lengths(), k = state.length;
    return L.filter(function (l) { return l.key === k; })[0] || L.filter(function (l) { return l.default; })[0] || L[0];
  }
  function applyLength() {
    var len = currentLength(), keepId = stops[state.current] && stops[state.current].id;
    var ok = function (n) { return len.stops === 'all' || len.stops.indexOf(n) >= 0; };
    stops = allStops.filter(function (s) { return ok(s.order); });
    ROUTE = walk.route.filter(function (r) { return ok(r.n); });
    if (keepId) { var i = stops.map(function (s) { return s.id; }).indexOf(keepId); if (i >= 0) state.current = i; }
    state.current = Math.max(0, Math.min(state.current, stops.length - 1));
  }
  function lengthRows() {
    return lengths().map(function (l) {
      var input = document.createElement('input');
      input.type = 'radio'; input.name = 'walk-length'; input.checked = currentLength().key === l.key;
      input.addEventListener('change', function () { state.length = l.key; applyLength(); saveState(); });
      var km = lengthKm(l);
      return el('label', { className: 'toggle' }, [input, el('span', {}, [el('span', { className: 'label' }, [el('span', { className: 'swatch', attrs: { style: 'background:' + (l.colour || '#a8592a') } }), document.createTextNode(' '), rich(l.label)]), el('span', { className: 'desc', text: (l.description || '') + (km ? ' About ' + km + ' km.' : '') })])]);
    });
  }

  // ---------- about, safety and privacy ----------
  var aboutInfo = null;
  function aboutScreen() {
    var nodes = [el('p', { className: 'kicker', text: 'From Sparks Adventures' }), el('h1', { text: aboutInfo ? aboutInfo.title : 'About' })];
    if (aboutInfo) aboutInfo.sections.forEach(function (s) {
      nodes.push(el('section', { className: 'card' }, [el('h2', { text: s.heading })].concat(s.text.map(function (t) { return el('p', { text: t }); }))));
    });
    nodes.push(el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back', onClick: function () { history.length > 1 ? history.back() : (location.hash = walk ? '#welcome' : '#villages'); } })]));
    show(nodes);
  }

  // ---------- save the walk for use without signal ----------
  function offlineUrls() {
    var urls = [CONTENT + 'walk.json', MAP.src];
    if (walk.story_image) urls.push(walk.story_image.src);
    if (walk.hero_image) urls.push(walk.hero_image.src);
    walk.stops.forEach(function (f) { urls.push(CONTENT + f); });
    allStops.forEach(function (s) { if (s.photo) urls.push(s.photo); if (s.character_art && s.character_art.src) urls.push(s.character_art.src); });
    CHARS.forEach(function (c) { urls.push(c.img); });
    return urls.filter(function (u, i) { return urls.indexOf(u) === i; });
  }
  function saveOffline(out) {
    if (!('serviceWorker' in navigator)) { out.textContent = 'This browser cannot save the walk for offline use.'; return; }
    var urls = offlineUrls(), done = 0, failed = 0;
    out.textContent = 'Saving 0 of ' + urls.length + '...';
    urls.reduce(function (p, u) {
      return p.then(function () { return fetch(u, { cache: 'reload' }).then(function (r) { if (!r.ok) failed++; }).catch(function () { failed++; }); })
        .then(function () { done++; out.textContent = 'Saving ' + done + ' of ' + urls.length + '...'; });
    }, Promise.resolve()).then(function () {
      out.textContent = failed ? 'Saved, but ' + failed + ' item(s) could not be fetched. Try again with a better signal.' : 'Done. The walk will work even with no signal.';
    });
  }

  // ---------- village chooser ----------
  function villagesScreen() {
    menuButton.hidden = !walk;
    var sl = document.querySelector('.startlink'); if (sl) sl.hidden = !walk;
    var nodes = [logoHero(), el('p', { className: 'kicker', text: 'From Sparks Adventures' }), el('h1', { text: '[[c:Where would you like to walk?]]' }),
      el('p', { className: 'muted', text: '[[c:Choose a village to start. More walks are on the way.]]' })];
    var grid = el('div', { className: 'villages' });
    var showDrafts = state ? !!state.review : reviewGuess();
    villages.forEach(function (v) {
      if (v.status === 'draft' && !showDrafts) return;
      var ready = v.status === 'ready' || v.status === 'draft';
      var kids = [];
      if (v.status === 'suggest') {
        var box = document.createElement('input'); box.type = 'text'; box.placeholder = 'Village or town name'; box.className = 'suggest-input';
        grid.appendChild(el('section', { className: 'card village suggest' }, [el('h2', { text: v.name }), el('p', { text: v.teaser }), box,
          el('button', { className: 'wide secondary', text: 'Send my suggestion', onClick: function () {
            var place = box.value.trim();
            location.href = 'mailto:' + v.email + '?subject=' + encodeURIComponent('Walk suggestion: ' + (place || 'a village')) + '&body=' + encodeURIComponent('I would love a From Sparks walk in: ' + place + '\n\nWhy it would be a good one:\n');
          } })]));
        return;
      }
      if (v.image) {
        var im = document.createElement('img'); im.src = v.image; im.alt = v.image_alt || v.name; im.className = 'village-img';
        im.addEventListener('error', function () { im.remove(); });
        kids.push(im);
      }
      kids.push(el('h2', { text: ready ? v.walk_title : v.name }));
      if (v.status === 'draft') kids.push(el('p', { className: 'badge-draft', text: 'Draft: only you can see this' }));
      if (ready && v.story) kids.push(el('p', { className: 'kicker', text: v.story }));
      if (v.teaser) kids.push(el('p', { text: v.teaser }));
      if (v.details) kids.push(el('p', { className: 'muted', text: v.details }));
      kids.push(ready
        ? el('button', { className: 'wide copper', text: villageId === v.id && walk ? 'Carry on with this walk' : 'Choose this walk', onClick: function () { chooseVillage(v); } })
        : el('p', { className: 'badge-soon', text: 'Coming soon' }));
      grid.appendChild(el('section', { className: 'card village' + (ready ? '' : ' soon') }, kids));
    });
    nodes.push(grid);
    nodes.push(el('p', { className: 'muted center' }, [el('a', { text: 'About, safety and privacy', attrs: { href: '#about' } })]));
    show(nodes);
  }
  function chooseVillage(v) {
    try { localStorage.setItem(VILLAGE_KEY, v.id); } catch (e) { /* ignore */ }
    if (walk && villageId === v.id) { location.hash = '#welcome'; return; }
    if (walk) { location.hash = '#welcome'; location.reload(); return; }
    location.hash = '#welcome';
    loadWalk(v);
  }

  // ---------- access codes (off until walk.json access.enabled is true) ----------
  function accessOn() { return !!(walk.access && walk.access.enabled); }
  function accessLocked(i) { return accessOn() && !state.access && i >= walk.access.free_stops; }
  function sha256Hex(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  function checkCode(raw) {
    var code = String(raw || '').toUpperCase().replace(/\s+/g, '');
    if (!code) return Promise.resolve(false);
    if (walk.access.verify_url) {
      return fetch(walk.access.verify_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) })
        .then(function (r) { return r.json(); }).then(function (j) { return !!(j && j.ok); });
    }
    return fetchJson(CONTENT + 'access-codes.json').then(function (c) {
      return sha256Hex(c.salt + ':' + code).then(function (h) { return c.hashes.indexOf(h) >= 0; });
    });
  }
  function unlockScreen() {
    if (!accessOn() || state.access) { goStop(state.current); return; }
    var ac = walk.access, msg = el('p', { className: 'muted' });
    var input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'Access code'; input.autocomplete = 'off'; input.autocapitalize = 'characters'; input.id = 'access-input';
    function submit() {
      msg.textContent = 'Checking...';
      checkCode(input.value).then(function (ok) {
        if (ok) { state.access = true; saveState(); location.hash = '#' + stops[Math.min(ac.free_stops, stops.length - 1)].id; route(); }
        else msg.textContent = 'That code did not work. Check it and try again.';
      }).catch(function () { msg.textContent = 'Could not check the code just now. Check your signal and try again.'; });
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    var nodes = [el('p', { className: 'kicker', text: walk.subtitle }), el('h1', { text: ac.title }), el('p', { text: ac.text }), input,
      el('button', { className: 'wide copper', text: 'Unlock', onClick: submit, attrs: { id: 'access-btn' } }), msg];
    if (ac.buy_url) nodes.push(el('a', { className: 'btn-link wide', text: ac.buy_text, attrs: { href: ac.buy_url, target: '_blank', rel: 'noopener' } }));
    nodes.push(el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back to the walk', onClick: function () { goStop(Math.min(state.current, ac.free_stops - 1)); } })]));
    show(nodes);
  }

  function startScreen() {
    var sp = walk.start_page;
    var nodes = [el('p', { className: 'kicker', text: 'Before you set off' }), el('h1', { text: sp.title }), el('p', { text: sp.intro })];
    if (sp.address && sp.address.length) {
      var adr = el('address', { className: 'addr' });
      sp.address.forEach(function (line, i) { if (i) adr.appendChild(document.createElement('br')); adr.appendChild(document.createTextNode(line)); });
      nodes.push(el('section', { className: 'card address' }, [el('h2', { text: 'Address' }), adr]));
    }
    if (stops[0].photo) nodes.push(photoFigure(stops[0]));
    sp.parking.forEach(function (p) { nodes.push(el('p', { text: p })); });
    (sp.parking_photos || []).forEach(function (ph) {
      var fig = el('figure', { className: 'stop-photo' }), im = document.createElement('img');
      im.src = ph.src; im.alt = ph.caption || ''; im.addEventListener('error', function () { fig.remove(); });
      fig.appendChild(im); if (ph.caption) fig.appendChild(el('figcaption', { text: ph.caption })); nodes.push(fig);
    });
    if (sp.directions) {
      var dir = sp.directions, btns = el('div', { className: 'dir-buttons' });
      dir.buttons.forEach(function (b) {
        btns.appendChild(el('a', { className: 'btn-link', text: b.label, attrs: { target: '_blank', rel: 'noopener',
          href: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dir.destination) + '&travelmode=' + b.mode } }));
      });
      nodes.push(el('section', { className: 'card directions' }, [el('h2', { text: dir.heading }), el('p', { text: dir.text }), btns]));
    }
    nodes.push(
      el('section', { className: 'card support' }, [el('p', { text: sp.support })]),
      el('a', { className: 'btn-link wide', text: sp.map_label, attrs: { href: sp.map_url, target: '_blank', rel: 'noopener' } }),
      mapView(1),
      el('button', { className: 'wide copper', text: walk.start_page.begin_label, onClick: function () { var s1 = stops[0]; state.arrived[s1.id] = true; state.current = 0; saveState(); goStop(0); } }),
      el('div', { className: 'nav' }, [el('button', { className: 'secondary', text: 'Back', onClick: function () { history.length > 1 ? history.back() : (location.hash = '#welcome'); } })])
    );
    show(nodes);
    var cbox = el('section', { className: 'card compass-card' }, [el('h2', { text: 'Compass to the start' })]);
    var main = document.querySelector('main') || document.body; var sup = main.querySelector('.card.support');
    if (sup) sup.parentNode.insertBefore(cbox, sup); else main.appendChild(cbox);
    showCompass(stopLL(stops[0]), 'the start', cbox);
  }

  function routeScreen() {
    var list = el('ul', { className: 'route-list' });
    ROUTE.forEach(function (r) {
      var idx = -1;
      stops.forEach(function (s, i) { if (s.order === r.n) idx = i; });
      var name = idx >= 0 && idx <= maxOpen()
        ? el('a', { text: r.name, attrs: { href: '#' + stops[idx].id } })
        : el('span', { className: 'soon', text: r.name + (idx >= 0 ? (accessLocked(idx) ? ' (unlock with a code)' : ' (opens as you walk)') : ' (coming soon)') });
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
    var onRoute = {}; stops.forEach(function (s) { onRoute[s.id] = true; });
    allStops.forEach(function (s) {
      if (!s.evidence) return;
      if (onRoute[s.id]) {
        if (state.solved[s.id] || (!s.puzzle && state.arrived[s.id])) s.evidence.forEach(function (e) { items.push({ stop: s.name, text: e }); });
      } else {
        s.evidence.forEach(function (e) { items.push({ stop: s.name + ' (a clue from the longer walk, given to you)', text: e }); });
      }
    });
    return items;
  }

  function notebookScreen() {
    var items = collectEvidence();
    var nodes = [el('p', { className: 'kicker', text: 'Your notes' }), el('h1', { text: 'Evidence notebook' }), (CHARS.length ? suspectsGrid('The suspects') : null)];
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
      suspectsGrid(null),
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
      if (pz.solved_art) box.appendChild(sceneFigure(pz.solved_art));
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
      pz.material.forEach(function (m) {
        var c = charFor(m);
        if (c) mat.appendChild(el('div', { className: 'said' }, [avatar(c), el('p', { text: m })]));
        else mat.appendChild(el('p', { text: m }));
      });
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
    state.current = index; state.furthest = Math.max(state.furthest || 0, index); saveState();
    var arrived = !!state.arrived[stop.id];
    var nodes = [
      el('p', { className: 'kicker', text: 'Stop ' + (index + 1) + ' of ' + stops.length }),
      el('h1', { text: stop.name })
    ];

    if (!arrived) {
      var how = index === 0 ? walk.start_text : dirsBetween(stops[index - 1], stop);
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
      if (stop.character_art) nodes.push(sceneFigure(stop.character_art));
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
        nodes.push(el('section', { className: 'card' }, [el('h2', { text: 'On to the next stop' }), el('p', { text: index < stops.length - 1 ? dirsBetween(stop, stops[index + 1]) : stop.directions_to_next })].concat(stop.on_the_way ? [el('p', { text: stop.on_the_way })] : [])));
        nodes.push(mapView(stops[index + 1].order));
      } else {
        nodes.push(el('section', { className: 'card' }, [
          el('h2', { text: 'The end' }),
          el('p', { text: index < stops.length - 1 ? dirsBetween(stop, stops[index + 1]) : stop.directions_to_next }),
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
    if (arrived && !isLast) {
      nodes.push(el('div', { className: 'nav' }, [el('button', { text: 'On to the next stop', onClick: function () { goStop(index + 1); } })]));
    }
    show(nodes);
    if (!arrived && index > 0) showCompass(stopLL(stop), stop.name.replace(/\[\[c:|\]\]/g, ''));
  }

  // ---------- page addresses ----------
  function goStop(i) { location.hash = '#' + stops[i].id; }
  // You can look back at any stop you've reached, and ahead only to the next one.
  function reachedIndex() { var r = -1; stops.forEach(function (s, i) { if (state.arrived[s.id]) r = i; }); return r; }
  function maxOpen() { return Math.min(reachedIndex() + 1, stops.length - 1); }

  var lastScroll = 0;
  function route(keepScroll) {
    if (keepScroll === true) lastScroll = window.scrollY;
    hideCompass();
    var id = location.hash.replace('#', '');
    if (id === 'villages') { villagesScreen(); return; }
    if (id === 'about') { aboutScreen(); return; }
    if (id === 'route') routeScreen();
    else if (id === 'setup') setupScreen();
    else if (id === 'story') storyScreen();
    else if (id === 'start') startScreen();
    else if (id === 'notebook') notebookScreen();
    else if (id === 'unlock') unlockScreen();
    else {
      var index = -1;
      stops.forEach(function (s, i) { if (s.id === id) index = i; });
      if (index >= 0 && accessLocked(index)) { location.replace('#unlock'); return; }
      if (index > maxOpen()) { location.replace('#' + stops[maxOpen()].id); return; }
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
  function loadWalk(v) {
    villageId = v.id; CONTENT = v.folder;
    return fetchJson(CONTENT + 'walk.json')
      .then(function (w) {
        walk = w;
        if (w.map) MAP = w.map;
        setGeo(w.geo); CHARS = w.cast || [];
        return Promise.all(w.stops.map(function (f) { return fetchJson(CONTENT + f); }));
      })
      .then(function (loaded) {
        allStops = loaded; stops = loaded;
        state = loadState();
        applyLength();
        menuButton.hidden = false;
        var sl = document.querySelector('.startlink'); if (sl) sl.hidden = false;
        if (!booted) {
          booted = true;
          menuButton.addEventListener('click', function () { if (settingsEl.hidden) openSettings(); else closeSettings(); });
          scrim.addEventListener('click', closeSettings);
          document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !settingsEl.hidden) closeSettings(); });
        }
        route();
      })
      .catch(showError);
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
  loadLogo();
  window.addEventListener('hashchange', function () { if (location.hash === '#about') aboutScreen(); else if (walk) route(); else villagesScreen(); });
  fetchJson(ROOT_CONTENT + 'walks.json')
    .then(function (idx) {
      villages = idx.villages; aboutInfo = idx.about || null;
      var saved = null;
      try { saved = localStorage.getItem(VILLAGE_KEY); } catch (e) { saved = null; }
      var v = villages.filter(function (x) { return x.id === saved && (x.status === 'ready' || x.status === 'draft'); })[0];
      if (location.hash === '#about' && !v) { aboutScreen(); return; }
      if (!v || location.hash === '#villages') { villagesScreen(); if (v) loadWalkQuiet(v); return; }
      loadWalk(v);
    })
    .catch(showError);

  // Load the saved walk in the background while the chooser shows, so the menu works there too.
  function loadWalkQuiet(v) {
    villageId = v.id; CONTENT = v.folder;
    fetchJson(CONTENT + 'walk.json').then(function (w) {
      return Promise.all(w.stops.map(function (f) { return fetchJson(CONTENT + f); })).then(function (loaded) {
        walk = w; if (w.map) MAP = w.map; setGeo(w.geo); CHARS = w.cast || []; allStops = loaded; stops = loaded; state = loadState(); applyLength();
        if (!booted) {
          booted = true;
          menuButton.addEventListener('click', function () { if (settingsEl.hidden) openSettings(); else closeSettings(); });
          scrim.addEventListener('click', closeSettings);
          document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !settingsEl.hidden) closeSettings(); });
        }
        if (location.hash === '#villages' || !location.hash) villagesScreen();
      });
    }).catch(function () { /* chooser still works */ });
  }
})();
