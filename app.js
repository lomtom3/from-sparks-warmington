/*
  From Sparks Adventures - walk app (Milestone 1: skeleton).
  All words shown to players come from the files in /content.
  Progress (current stop, layer switches, arrived stops) is kept on the player's phone.
*/
(function () {
  'use strict';

  var CONTENT = 'content/';
  var app = document.getElementById('app');
  var walk = null;
  var stops = [];
  var state = null;

  // ---------- saving on the phone (never fails if storage is blocked) ----------
  function storageKey() { return 'fromsparks:' + walk.id; }

  function loadState() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey())); } catch (e) { saved = null; }
    var s = { current: 0, arrived: {}, layers: {} };
    walk.layers.forEach(function (l) { s.layers[l.key] = !!l.default_on; });
    if (saved && typeof saved === 'object') {
      if (typeof saved.current === 'number') s.current = saved.current;
      if (saved.arrived && typeof saved.arrived === 'object') s.arrived = saved.arrived;
      if (saved.layers && typeof saved.layers === 'object') {
        Object.keys(s.layers).forEach(function (k) {
          if (typeof saved.layers[k] === 'boolean') s.layers[k] = saved.layers[k];
        });
      }
    }
    s.current = Math.max(0, Math.min(s.current, stops.length - 1));
    return s;
  }

  function saveState() {
    try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------- small helpers for building the page ----------
  function el(tag, opts, children) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.text != null) node.textContent = opts.text;
    if (opts.className) node.className = opts.className;
    if (opts.onClick) node.addEventListener('click', opts.onClick);
    if (opts.disabled) node.disabled = true;
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function show(nodes) {
    app.innerHTML = '';
    nodes.forEach(function (n) { if (n) app.appendChild(n); });
    window.scrollTo(0, 0);
  }

  function fetchJson(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' (' + r.status + ')');
      return r.json();
    });
  }

  // ---------- screens ----------
  function layerToggles() {
    var box = el('fieldset', {}, [el('legend', { text: 'Layers' })]);
    walk.layers.forEach(function (l) {
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!state.layers[l.key];
      input.addEventListener('change', function () {
        state.layers[l.key] = input.checked;
        saveState();
        route();
      });
      var label = el('label', { className: 'toggle' }, [input, el('span', { text: l.label })]);
      box.appendChild(label);
    });
    return box;
  }

  function welcomeScreen() {
    var started = Object.keys(state.arrived).length > 0 || state.current > 0;
    var layerList = el('ul');
    walk.layers.forEach(function (l) {
      layerList.appendChild(el('li', {}, [
        el('strong', { text: l.label + ': ' }),
        document.createTextNode(l.description)
      ]));
    });
    show([
      el('h1', { text: walk.title }),
      el('p', { text: walk.welcome_text }),
      el('h2', { text: 'Layers' }),
      layerList,
      el('p', { className: 'muted', text: 'You can switch layers on or off at any stop. Your place on the route is kept.' }),
      el('button', {
        className: 'wide',
        text: started ? 'Continue walk' : 'Start walk',
        onClick: function () { goStop(state.current); }
      })
    ]);
  }

  function stopScreen(index) {
    var stop = stops[index];
    state.current = index;
    saveState();

    var arrived = !!state.arrived[stop.id];
    var nodes = [
      el('p', { className: 'muted', text: 'Stop ' + (index + 1) + ' of ' + stops.length }),
      el('h1', { text: stop.name })
    ];

    if (!arrived) {
      // Before arriving: how to get here, then the "I'm here" button.
      var howToGetHere = index === 0 ? walk.start_text : stops[index - 1].directions_to_next;
      nodes.push(
        el('h2', { text: 'Getting here' }),
        el('p', { text: howToGetHere }),
        el('button', {
          className: 'wide',
          text: "I'm here",
          onClick: function () {
            state.arrived[stop.id] = true;
            saveState();
            route();
          }
        })
      );
    } else {
      nodes.push(layerToggles());
      var anyOn = false;
      walk.layers.forEach(function (l) {
        if (!state.layers[l.key]) return;
        var text = stop.layers && stop.layers[l.key];
        if (!text) return;
        anyOn = true;
        nodes.push(el('section', {}, [el('h2', { text: l.label }), el('p', { text: text })]));
      });
      if (!anyOn) {
        nodes.push(el('p', { className: 'muted', text: 'All layers are switched off.' }));
      }
      if (stop.puzzle) {
        nodes.push(el('section', {}, [
          el('h2', { text: 'Puzzle' }),
          el('p', { className: 'muted', text: 'Puzzle coming in Milestone 2.' })
        ]));
      }
      if (index < stops.length - 1) {
        nodes.push(el('section', {}, [
          el('h2', { text: 'To the next stop' }),
          el('p', { text: stop.directions_to_next })
        ]));
      }
    }

    var isLast = index === stops.length - 1;
    nodes.push(el('div', { className: 'nav' }, [
      el('button', {
        className: 'secondary',
        text: index === 0 ? 'Welcome' : 'Previous',
        onClick: function () { if (index === 0) location.hash = '#welcome'; else goStop(index - 1); }
      }),
      el('button', {
        text: 'Next',
        disabled: isLast,
        onClick: function () { goStop(index + 1); }
      })
    ]));
    if (isLast) {
      nodes.push(el('p', { className: 'muted', text: 'No more stops are available yet.' }));
    }
    show(nodes);
  }

  // ---------- simple page addresses (#welcome, #stop-01 ...) so Back and refresh work ----------
  function goStop(index) { location.hash = '#' + stops[index].id; }

  function route() {
    var id = location.hash.replace('#', '');
    var index = -1;
    for (var i = 0; i < stops.length; i++) { if (stops[i].id === id) index = i; }
    if (index >= 0) stopScreen(index); else welcomeScreen();
  }

  function showError(err) {
    show([
      el('h1', { text: 'Could not load the walk' }),
      el('p', { text: 'The content files could not be read. If you opened index.html directly from your computer, this is expected: it must be opened from its web address.' }),
      el('p', { className: 'muted', text: String(err && err.message || err) })
    ]);
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
      window.addEventListener('hashchange', route);
      route();
    })
    .catch(showError);
})();
