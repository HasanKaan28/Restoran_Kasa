/* Restoran Kasa site: the theme switch and the live demos (the hero's register, phone and
   kitchen; the story's bill; the outage). Plain JavaScript, no dependencies, no build step.
   Everything here works with a mouse, a finger or a keyboard; with reduced motion nothing
   plays by itself and nothing flies. */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = function () {
    return motion.matches;
  };
  var money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
  var tl = function (n) {
    return money.format(n);
  };
  var $ = function (sel, scope) {
    return (scope || doc).querySelector(sel);
  };
  var $$ = function (sel, scope) {
    return Array.prototype.slice.call((scope || doc).querySelectorAll(sel));
  };
  function el(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(cls, text) {
    var b = el('button', cls, text);
    b.type = 'button';
    return b;
  }
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
  function bump(node) {
    if (reduced() || !node) return;
    node.classList.remove('is-bump');
    void node.offsetWidth;
    node.classList.add('is-bump');
  }
  function shown(node) {
    return !!node && node.offsetParent !== null;
  }

  /* A slip flying from one place to another along a short arc: the order leaving the phone. */
  function fly(from, to, html, duration) {
    if (reduced()) return Promise.resolve();
    var node = el('div', 'fly');
    node.innerHTML = html;
    doc.body.appendChild(node);
    var w = node.offsetWidth;
    var h = node.offsetHeight;
    var x0 = from.left + from.width / 2 - w / 2;
    var y0 = from.top + from.height / 2 - h / 2;
    var x1 = to.left + Math.min(to.width, w) / 2 - w / 2 + Math.max(0, (to.width - w) / 2);
    var y1 = to.top + Math.min(to.height, 64) / 2 - h / 2;
    var cx = (x0 + x1) / 2;
    var cy = Math.min(y0, y1) - Math.max(60, Math.abs(x1 - x0) * 0.25);
    var frames = [];
    for (var i = 0; i <= 12; i++) {
      var t = i / 12;
      var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      var x = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * cx + e * e * x1;
      var y = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * cy + e * e * y1;
      var s = 1 + Math.sin(Math.PI * t) * 0.06;
      frames.push({
        transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(3) + ') rotate(' + (Math.sin(Math.PI * t) * -3).toFixed(2) + 'deg)',
        opacity: t < 0.08 ? t / 0.08 : t > 0.94 ? (1 - t) / 0.06 : 1,
      });
    }
    var anim = node.animate(frames, { duration: duration || 820, easing: 'linear' });
    var done = function () {
      node.remove();
    };
    // A hidden tab may hold animations back; the slip lands on time regardless.
    return Promise.race([anim.finished, sleep((duration || 820) + 300)]).then(done, done);
  }

  /* ---------------------------------------------------------------------------------------
     Theme switch. Pressed means dark. Choosing what the system already shows forgets the saved
     choice, so the page follows the system again. The new theme opens as a circle from the
     button where View Transitions exist.
     --------------------------------------------------------------------------------------- */
  function initTheme() {
    var toggle = $('.theme');
    if (!toggle) return;
    var system = window.matchMedia('(prefers-color-scheme: dark)');
    var metas = $$('meta[name="theme-color"]');
    function current() {
      return root.getAttribute('data-theme') || (system.matches ? 'dark' : 'light');
    }
    function sync() {
      var dark = current() === 'dark';
      toggle.setAttribute('aria-pressed', String(dark));
      toggle.title = dark ? 'Açık temaya geç' : 'Koyu temaya geç';
      metas.forEach(function (m) {
        m.content = dark ? '#1C1815' : '#F6ECDC';
      });
    }
    function apply(next) {
      var followsSystem = next === (system.matches ? 'dark' : 'light');
      if (followsSystem) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', next);
      try {
        if (followsSystem) localStorage.removeItem('rk.site.theme');
        else localStorage.setItem('rk.site.theme', next);
      } catch (e) {}
      sync();
    }
    toggle.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      if (!doc.startViewTransition || reduced()) {
        apply(next);
        return;
      }
      var r = toggle.getBoundingClientRect();
      var x = r.left + r.width / 2;
      var y = r.top + r.height / 2;
      var radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      var transition = doc.startViewTransition(function () {
        apply(next);
      });
      transition.ready
        .then(function () {
          root.animate(
            { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
            { duration: 520, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', pseudoElement: '::view-transition-new(root)' }
          );
        })
        .catch(function () {});
    });
    if (system.addEventListener) system.addEventListener('change', sync);
    toggle.hidden = false;
    sync();
  }

  /* ---------------------------------------------------------------------------------------
     The hero's live POS. One state, drawn into the register's floor, the phone and the
     kitchen tablet. Demo time runs fast (a minute every 6 s) so the timers visibly move.
     --------------------------------------------------------------------------------------- */
  function initPos() {
    var pos = $('[data-pos]');
    if (!pos) return;

    var MINUTE_MS = 6000;
    var LATE = 15;
    var SLOW = 10;
    var t0 = performance.now();
    var now = function () {
      return (performance.now() - t0) / MINUTE_MS;
    };

    // Dishes, prices and choices follow the app's own demo restaurant (src/demo/seedRestaurant.ts).
    var CATS = [
      { id: 'izgara', name: 'Izgara', items: [
        { id: 'adana', name: 'Adana kebap', price: 450, st: 'm', notes: ['acısız', 'acılı'] },
        { id: 'urfa', name: 'Urfa kebap', price: 450, st: 'm', notes: [] },
        { id: 'kuzu', name: 'Kuzu şiş', price: 520, st: 'm', notes: ['az pişmiş', 'orta', 'iyi pişmiş'] },
        { id: 'kofte', name: 'Izgara köfte', price: 380, st: 'm', notes: ['az pişmiş', 'orta', 'iyi pişmiş'] },
      ] },
      { id: 'pide', name: 'Pide', items: [
        { id: 'lahmacun', name: 'Lahmacun', price: 120, st: 'm', notes: ['acısız', 'acılı'] },
        { id: 'kiymali', name: 'Kıymalı pide', price: 280, st: 'm', notes: [] },
        { id: 'kasarli', name: 'Kaşarlı pide', price: 260, st: 'm', notes: [] },
        { id: 'karisik', name: 'Karışık pide', price: 320, st: 'm', notes: [] },
      ] },
      { id: 'meze', name: 'Meze', items: [
        { id: 'ezme', name: 'Ezme', price: 110, st: 'm', notes: [] },
        { id: 'haydari', name: 'Haydari', price: 120, st: 'm', notes: [] },
        { id: 'humus', name: 'Humus', price: 130, st: 'm', notes: [] },
        { id: 'coban', name: 'Çoban salata', price: 140, st: 'm', notes: [] },
      ] },
      { id: 'icecek', name: 'İçecek', items: [
        { id: 'ayran', name: 'Ayran', price: 50, st: 'b', notes: [] },
        { id: 'salgam', name: 'Şalgam', price: 60, st: 'b', notes: ['acılı', 'acısız'] },
        { id: 'raki', name: 'Rakı 35 cl', price: 850, st: 'b', notes: [] },
        // Not prepared anywhere: counts as ready the moment it is sent, as in the app.
        { id: 'su', name: 'Su', price: 20, st: null, notes: [] },
      ] },
      { id: 'tatli', name: 'Tatlı', items: [
        { id: 'kunefe', name: 'Künefe', price: 180, st: 'm', notes: [] },
        { id: 'sutlac', name: 'Fırın sütlaç', price: 120, st: 'm', notes: [] },
        { id: 'cay', name: 'Çay', price: 25, st: 'b', notes: [] },
        { id: 'kahve', name: 'Türk kahvesi', price: 70, st: 'b', notes: ['sade', 'orta', 'şekerli'] },
      ] },
    ];
    var ITEMS = {};
    CATS.forEach(function (c) {
      c.items.forEach(function (it) {
        ITEMS[it.id] = it;
      });
    });
    var AREAS = [
      { id: 'salon', name: 'Salon' },
      { id: 'bahce', name: 'Bahçe' },
      { id: 'paket', name: 'Paket' },
    ];
    var STATIONS = [
      { id: 'm', name: 'Mutfak' },
      { id: 'b', name: 'Bar' },
    ];
    var STATE_TEXT = { new: 'Gönderilmedi', sent: 'Hazırlanıyor', ready: 'Hazır', served: '' };

    var lineSeq = 0;
    var ticketSeq = 0;
    var tabs;
    var byId;
    var tickets;

    function line(item, qty, st, note) {
      return { key: 'l' + ++lineSeq, item: item, qty: qty, st: st, note: note || '' };
    }
    function seed() {
      var at = now();
      tabs = [
        { id: '1', area: 'salon', name: '1', title: 'Masa 1', opened: at - 42, sentAgo: 11, lines: [line('adana', 2, 'sent', 'acısız'), line('ezme', 1, 'sent'), line('ayran', 2, 'served'), line('salgam', 1, 'served')] },
        { id: '2', area: 'salon', name: '2', title: 'Masa 2', opened: null, lines: [] },
        { id: '3', area: 'salon', name: '3', title: 'Masa 3', opened: at - 12, lines: [line('lahmacun', 3, 'ready'), line('ayran', 3, 'served')] },
        { id: '4', area: 'salon', name: '4', title: 'Masa 4', opened: null, lines: [] },
        { id: '5', area: 'salon', name: '5', title: 'Masa 5', opened: at - 27, sentAgo: 5, lines: [line('kuzu', 2, 'sent', 'az pişmiş'), line('haydari', 1, 'served'), line('salgam', 2, 'served')] },
        { id: '6', area: 'salon', name: '6', title: 'Masa 6', opened: null, lines: [] },
        { id: '7', area: 'salon', name: '7', title: 'Masa 7', opened: at - 5, sentAgo: 4, lines: [line('raki', 1, 'sent'), line('ezme', 1, 'served')] },
        { id: '8', area: 'salon', name: '8', title: 'Masa 8', opened: null, lines: [] },
        { id: 'B1', area: 'bahce', name: 'B1', title: 'Bahçe 1', opened: at - 31, sentAgo: 4, lines: [line('adana', 1, 'served'), line('kunefe', 2, 'sent'), line('salgam', 2, 'sent', 'acılı')] },
        { id: 'B2', area: 'bahce', name: 'B2', title: 'Bahçe 2', opened: null, lines: [] },
        { id: 'B3', area: 'bahce', name: 'B3', title: 'Bahçe 3', opened: null, lines: [] },
        { id: 'B4', area: 'bahce', name: 'B4', title: 'Bahçe 4', opened: at - 14, lines: [line('lahmacun', 4, 'served'), line('ayran', 4, 'served')] },
        { id: 'P1', area: 'paket', name: 'Paket 1', title: 'Paket 1', opened: at - 9, sentAgo: 7, lines: [line('lahmacun', 6, 'sent', "2'si acısız")] },
        { id: 'P2', area: 'paket', name: 'Paket 2', title: 'Paket 2', opened: at - 16, lines: [line('kiymali', 2, 'ready')] },
      ];
      byId = {};
      tabs.forEach(function (t) {
        byId[t.id] = t;
      });
      tickets = [];
      tabs.forEach(function (t) {
        ['m', 'b'].forEach(function (s, i) {
          var keys = t.lines
            .filter(function (l) {
              return l.st === 'sent' && ITEMS[l.item].st === s;
            })
            .map(function (l) {
              return l.key;
            });
          if (keys.length) tickets.push({ id: 'k' + ++ticketSeq, tab: t.id, station: s, keys: keys, sent: at - t.sentAgo + i });
        });
      });
    }
    seed();

    var area = 'salon';
    var cat = 'izgara';
    var station = 'm';
    var openId = null;

    var floors = $$('[data-floor]', pos);
    var areaGroups = $$('[data-areas]', pos);
    var stationGroup = $('[data-stations]', pos);
    var stationTitle = $('[data-station-title]', pos);
    var orderEl = $('[data-order]', pos);
    var emptyEl = $('[data-order-empty]', pos);
    var titleEl = $('[data-order-title]', pos);
    var metaEl = $('[data-order-meta]', pos);
    var catsEl = $('[data-cats]', pos);
    var menuEl = $('[data-menu]', pos);
    var linesEl = $('[data-lines]', pos);
    var totalEl = $('[data-total]', pos);
    var sendBtn = $('[data-send]', pos);
    var ticketsEl = $('[data-tickets]', pos);
    var ticketsEmpty = $('[data-tickets-empty]', pos);
    var statusEl = $('[data-status]', pos);
    var playBtn = $('[data-play]', pos);
    var playLabel = $('[data-play-label]', pos);
    var finger = $('[data-finger]', pos);

    function sum(t) {
      return t.lines.reduce(function (a, l) {
        return a + l.qty * ITEMS[l.item].price;
      }, 0);
    }
    function readyCount(t) {
      return t.lines.reduce(function (a, l) {
        return a + (l.st === 'ready' ? l.qty : 0);
      }, 0);
    }
    function lineByKey(t, key) {
      for (var i = 0; i < t.lines.length; i++) if (t.lines[i].key === key) return t.lines[i];
      return null;
    }
    function areaName(id) {
      for (var i = 0; i < AREAS.length; i++) if (AREAS[i].id === id) return AREAS[i].name;
      return '';
    }
    function say(text) {
      statusEl.textContent = text;
    }

    /* Areas and the floor. */
    function buildAreas() {
      areaGroups.forEach(function (group) {
        AREAS.forEach(function (a) {
          var b = button('seg-app__btn', a.name);
          b.dataset.area = a.id;
          group.appendChild(b);
        });
      });
      syncAreas();
    }
    function syncAreas() {
      $$('[data-area]', pos).forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.area === area));
      });
    }
    function buildFloor() {
      floors.forEach(function (list) {
        list.textContent = '';
        tabs.forEach(function (t) {
          if (t.area !== area) return;
          var li = el('li');
          var b = button('t' + (t.area === 'paket' ? ' t--pkg' : ''));
          b.dataset.tab = t.id;
          b.appendChild(el('span', 't__name', t.name));
          b.appendChild(el('span', 't__info'));
          li.appendChild(b);
          list.appendChild(li);
        });
      });
      updateFloor();
    }
    function updateFloor() {
      var m = now();
      $$('.t', pos).forEach(function (b) {
        var t = byId[b.dataset.tab];
        if (!t) return;
        var busy = t.opened !== null && t.lines.length > 0;
        var ready = readyCount(t);
        var total = sum(t);
        var state = !busy ? 'empty' : ready > 0 ? 'ready' : 'open';
        var was = b.dataset.state;
        if (was !== state) {
          b.dataset.state = state;
          if (state === 'ready' && was && !reduced()) {
            b.classList.remove('is-ping');
            void b.offsetWidth;
            b.classList.add('is-ping');
          }
        }
        b.classList.toggle('is-selected', t.id === openId);
        var mins = busy ? Math.max(0, Math.floor(m - t.opened)) : 0;
        var sig = state + '|' + total + '|' + mins + '|' + ready;
        if (b._sig === sig) return;
        b._sig = sig;
        var info = b.querySelector('.t__info');
        info.textContent = '';
        if (busy) {
          info.appendChild(el('span', 't__sum', tl(total)));
          info.appendChild(el('span', 't__min', mins + ' dk'));
          if (ready) info.appendChild(el('span', 't__ready', ready + ' hazır'));
        } else {
          info.appendChild(el('span', 't__empty', 'Boş'));
        }
        b.setAttribute(
          'aria-label',
          t.title + ', ' + (busy ? 'dolu, ' + tl(total) + ', ' + mins + ' dakika' + (ready ? ', ' + ready + ' hazır' : '') : 'boş')
        );
      });
    }

    /* The phone: the open tab. */
    function buildCats() {
      catsEl.textContent = '';
      CATS.forEach(function (c) {
        var b = button('chip-app', c.name);
        b.dataset.cat = c.id;
        b.setAttribute('aria-pressed', String(c.id === cat));
        catsEl.appendChild(b);
      });
    }
    function buildMenu() {
      menuEl.textContent = '';
      var c = CATS.filter(function (x) {
        return x.id === cat;
      })[0];
      c.items.forEach(function (it) {
        var b = button('dish');
        b.dataset.dish = it.id;
        b.setAttribute('aria-label', it.name + ' ekle, ' + tl(it.price));
        b.appendChild(el('span', null, it.name));
        b.appendChild(el('span', 'dish__price', tl(it.price)));
        var q = el('span', 'dish__qty');
        q.hidden = true;
        q.setAttribute('aria-hidden', 'true');
        b.appendChild(q);
        menuEl.appendChild(b);
      });
      updateDishQty();
    }
    function updateDishQty(bumpId) {
      var t = openId ? byId[openId] : null;
      $$('.dish', menuEl).forEach(function (b) {
        var n = 0;
        if (t) {
          t.lines.forEach(function (l) {
            if (l.st === 'new' && l.item === b.dataset.dish) n += l.qty;
          });
        }
        var q = b.querySelector('.dish__qty');
        q.hidden = n === 0;
        q.textContent = n;
        if (bumpId === b.dataset.dish) bump(q);
      });
    }
    function renderLines(freshKey) {
      var t = byId[openId];
      if (!t) return;
      var active = doc.activeElement;
      var focusKey = active && active.dataset && active.dataset.note ? active.dataset.note : null;
      linesEl.textContent = '';
      if (!t.lines.length) {
        linesEl.appendChild(el('li', 'order__lines-empty', 'Menüden yemek seçin.'));
      }
      t.lines.forEach(function (l) {
        var it = ITEMS[l.item];
        var li = el('li', 'line');
        li.dataset.st = l.st;
        if (l.key === freshKey && !reduced()) li.classList.add('is-in');
        var main = el('span', 'line__main');
        main.appendChild(el('b', null, l.qty + ' × ' + it.name));
        if (l.st === 'new' && it.notes.length) {
          var x = button('line__extra' + (l.note ? ' has-value' : ''), l.note || '+ not');
          x.dataset.note = l.key;
          x.setAttribute('aria-label', it.name + ' notu: ' + (l.note || 'yok') + '. Değiştir');
          main.appendChild(x);
        } else if (l.note) {
          main.appendChild(el('span', 'line__note', l.note));
        }
        var side = el('span', 'line__side');
        side.appendChild(el('span', 'line__sum', tl(l.qty * it.price)));
        if (STATE_TEXT[l.st]) side.appendChild(el('span', 'line__state', STATE_TEXT[l.st]));
        li.appendChild(main);
        li.appendChild(side);
        linesEl.appendChild(li);
      });
      if (focusKey) {
        var again = linesEl.querySelector('[data-note="' + focusKey + '"]');
        if (again) again.focus();
      }
      if (freshKey) linesEl.scrollTop = linesEl.scrollHeight;
    }
    function updateFoot() {
      var t = byId[openId];
      if (!t) return;
      var fresh = t.lines.filter(function (l) {
        return l.st === 'new';
      }).length;
      totalEl.textContent = tl(sum(t));
      sendBtn.textContent = fresh ? 'Mutfağa gönder (' + fresh + ')' : 'Mutfağa gönder';
      sendBtn.disabled = fresh === 0;
    }
    function updateMeta() {
      var t = openId ? byId[openId] : null;
      if (!t) return;
      var busy = t.opened !== null && t.lines.length > 0;
      metaEl.textContent = areaName(t.area) + ' · ' + (busy ? Math.max(0, Math.floor(now() - t.opened)) + ' dk' : 'yeni adisyon');
    }
    function renderOrder() {
      var t = openId ? byId[openId] : null;
      pos.dataset.view = t ? 'order' : 'floor';
      orderEl.hidden = !t;
      emptyEl.hidden = !!t;
      if (!t) return;
      titleEl.textContent = t.title;
      updateMeta();
      renderLines();
      updateDishQty();
      updateFoot();
    }
    function slideIn(node, dir) {
      if (reduced() || window.innerWidth >= 760 || !node.animate) return;
      node.animate(
        [
          { opacity: 0, transform: 'translateX(' + dir * 24 + 'px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
      );
    }
    function openTab(id) {
      var t = byId[id];
      if (!t) return;
      openId = id;
      renderOrder();
      updateFloor();
      slideIn(orderEl, 1);
      say(t.title + ' açıldı. Menüden yemek seçin.');
    }
    function closeView() {
      openId = null;
      renderOrder();
      updateFloor();
      slideIn($('.phone__floor', pos), -1);
      say('Masalar.');
    }
    function addItem(itemId) {
      var t = byId[openId];
      var it = ITEMS[itemId];
      if (!t || !it) return;
      if (t.opened === null) t.opened = now();
      var target = null;
      for (var i = t.lines.length - 1; i >= 0; i--) {
        if (t.lines[i].st === 'new' && t.lines[i].item === itemId) {
          target = t.lines[i];
          break;
        }
      }
      if (target) target.qty++;
      else {
        target = line(itemId, 1, 'new');
        t.lines.push(target);
      }
      renderLines(target.qty === 1 ? target.key : null);
      updateDishQty(itemId);
      updateFoot();
      updateMeta();
      updateFloor();
      say(it.name + ' eklendi, ' + target.qty + ' adet. Toplam ' + tl(sum(t)) + '.');
    }
    function cycleNote(key) {
      var t = byId[openId];
      var l = t && lineByKey(t, key);
      if (!l) return;
      var notes = ITEMS[l.item].notes;
      var i = notes.indexOf(l.note);
      l.note = i + 1 < notes.length ? notes[i + 1] : '';
      renderLines();
      say(l.note ? ITEMS[l.item].name + ' notu: ' + l.note + '.' : 'Not kaldırıldı.');
    }
    function send() {
      var t = byId[openId];
      if (!t) return;
      var fresh = t.lines.filter(function (l) {
        return l.st === 'new';
      });
      if (!fresh.length) return;
      var groups = { m: [], b: [] };
      var count = 0;
      fresh.forEach(function (l) {
        count += l.qty;
        var st = ITEMS[l.item].st;
        if (!st) l.st = 'ready';
        else {
          l.st = 'sent';
          groups[st].push(l.key);
        }
      });
      var at = now();
      var made = [];
      ['m', 'b'].forEach(function (s) {
        if (groups[s].length) {
          var tk = { id: 'k' + ++ticketSeq, tab: t.id, station: s, keys: groups[s], sent: at, flying: true };
          tickets.push(tk);
          made.push(tk);
        }
      });
      var from = sendBtn.getBoundingClientRect();
      renderLines();
      updateFoot();
      updateDishQty();
      updateFloor();
      updateStations();
      updateTickets();
      var where = groups.m.length && groups.b.length ? 'mutfağa ve bara' : groups.b.length ? 'bara' : groups.m.length ? 'mutfağa' : '';
      say(t.title + ': ' + count + ' kalem ' + (where ? where + ' gönderildi.' : 'gönderildi, hazır.'));
      made.reduce(function (chain, tk) {
        return chain.then(function () {
          var node = ticketNodes[tk.id];
          var target;
          if (tk.station === station && node) {
            scrollTicketIntoView(node);
            target = node.getBoundingClientRect();
          } else {
            target = stationButton(tk.station).getBoundingClientRect();
          }
          var label = t.title + '<small>' + (tk.station === 'm' ? 'Mutfağa' : 'Bara') + ', ' + tk.keys.length + ' kalem</small>';
          var flight = shown(sendBtn) || shown(node) ? fly(from, target, label) : Promise.resolve();
          return flight.then(function () {
            tk.flying = false;
            updateTickets(tk.id);
          });
        });
      }, Promise.resolve());
    }
    function serveAndClose(id) {
      var t = byId[id];
      if (!t) return;
      t.lines = [];
      t.opened = null;
      tickets = tickets.filter(function (k) {
        return k.tab !== id;
      });
      if (openId === id) {
        openId = null;
        renderOrder();
      }
      updateFloor();
      updateStations();
      updateTickets();
    }

    /* The kitchen tablet. */
    var ticketNodes = {};
    function stationButton(id) {
      return stationGroup.querySelector('[data-station="' + id + '"]');
    }
    function buildStations() {
      stationGroup.textContent = '';
      STATIONS.forEach(function (s) {
        var b = button('seg-app__btn');
        b.dataset.station = s.id;
        b.appendChild(el('span', null, s.name));
        b.appendChild(el('span', 'seg-app__count', '0'));
        stationGroup.appendChild(b);
      });
      updateStations();
    }
    function updateStations() {
      STATIONS.forEach(function (s) {
        var b = stationButton(s.id);
        var n = tickets.filter(function (k) {
          return k.station === s.id && !k.leaving;
        }).length;
        b.setAttribute('aria-pressed', String(s.id === station));
        b.setAttribute('aria-label', s.name + ', ' + n + ' sipariş');
        b.lastChild.textContent = n;
        b.lastChild.hidden = n === 0;
      });
      stationTitle.textContent = station === 'm' ? 'Mutfak' : 'Bar';
    }
    function ticketNode(tk) {
      var t = byId[tk.tab];
      var li = el('li', 'tk');
      li.dataset.id = tk.id;
      li.setAttribute('aria-label', t.title);
      var head = el('div', 'tk__head');
      head.appendChild(el('span', 'tk__title', t.title));
      head.appendChild(el('span', 'tk__min'));
      li.appendChild(head);
      li.appendChild(el('ul', 'tk__items'));
      var all = button('btn-app btn-app--primary tk__all', 'Hepsi hazır');
      all.dataset.all = tk.id;
      all.setAttribute('aria-label', 'Hepsi hazır: ' + t.title);
      li.appendChild(all);
      return li;
    }
    function fillTicket(node, tk) {
      var t = byId[tk.tab];
      var sig = tk.keys.join(',');
      if (node._sig === sig) return;
      node._sig = sig;
      var list = node.querySelector('.tk__items');
      list.textContent = '';
      tk.keys.forEach(function (key) {
        var l = lineByKey(t, key);
        if (!l) return;
        var it = ITEMS[l.item];
        var li = el('li');
        var b = button('tk__item');
        b.dataset.item = key;
        b.dataset.tk = tk.id;
        b.setAttribute('aria-label', 'Hazır: ' + l.qty + ' × ' + it.name + (l.note ? ', ' + l.note : ''));
        b.appendChild(el('span', null, l.qty + ' × ' + it.name));
        if (l.note) b.appendChild(el('span', 'tk__note', l.note));
        li.appendChild(b);
        list.appendChild(li);
      });
    }
    function updateTickets(arrivedId) {
      var m = now();
      var list = tickets
        .filter(function (k) {
          return k.station === station;
        })
        .sort(function (a, b) {
          return a.sent - b.sent;
        });
      var keep = {};
      list.forEach(function (tk, i) {
        keep[tk.id] = true;
        var node = ticketNodes[tk.id];
        if (!node) {
          node = ticketNodes[tk.id] = ticketNode(tk);
        }
        if (ticketsEl.children[i] !== node) ticketsEl.insertBefore(node, ticketsEl.children[i] || null);
        fillTicket(node, tk);
        var mins = Math.max(0, Math.floor(m - tk.sent));
        node.classList.toggle('tk--late', mins >= LATE);
        node.classList.toggle('tk--slow', mins >= SLOW && mins < LATE);
        node.querySelector('.tk__min').textContent = mins + ' dk';
        node.style.visibility = tk.flying ? 'hidden' : '';
        if (tk.id === arrivedId && !reduced()) {
          node.classList.remove('is-new');
          void node.offsetWidth;
          node.classList.add('is-new');
        }
      });
      Object.keys(ticketNodes).forEach(function (id) {
        if (!keep[id]) {
          ticketNodes[id].remove();
          delete ticketNodes[id];
        }
      });
      ticketsEmpty.hidden = list.length > 0;
    }
    function scrollTicketIntoView(node) {
      var left = node.offsetLeft - ticketsEl.offsetLeft - 12;
      var max = ticketsEl.scrollWidth - ticketsEl.clientWidth;
      var target = Math.max(0, Math.min(left, max));
      if (Math.abs(ticketsEl.scrollLeft - target) > 2) ticketsEl.scrollLeft = target;
    }
    function markReady(tkId, keys) {
      var tk = tickets.filter(function (k) {
        return k.id === tkId;
      })[0];
      if (!tk || tk.leaving) return;
      var t = byId[tk.tab];
      var done = keys || tk.keys.slice();
      var n = 0;
      done.forEach(function (key) {
        var l = lineByKey(t, key);
        if (l && l.st === 'sent') {
          l.st = 'ready';
          n += l.qty;
        }
      });
      tk.keys = tk.keys.filter(function (k) {
        return done.indexOf(k) < 0;
      });
      var node = ticketNodes[tk.id];
      var hadFocus = node && node.contains(doc.activeElement);
      if (!tk.keys.length) {
        tk.leaving = true;
        var finish = function () {
          tickets = tickets.filter(function (k) {
            return k !== tk;
          });
          updateTickets();
          updateStations();
          if (hadFocus) {
            var next = ticketsEl.querySelector('.tk__all') || stationButton(station);
            next.focus();
          }
        };
        if (node && !reduced()) {
          node.classList.add('is-leaving');
          setTimeout(finish, 300);
        } else finish();
      } else {
        updateTickets();
        if (hadFocus) {
          var again = node.querySelector('.tk__item') || node.querySelector('.tk__all');
          again.focus();
        }
      }
      updateStations();
      updateFloor();
      if (openId === t.id) renderLines();
      say(t.title + ': ' + n + ' kalem hazır, garsonun ekranına düştü.');
    }

    /* Clicks: one delegated handler for every control in the stage. */
    pos.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !pos.contains(b)) return;
      if (b.dataset.area) {
        area = b.dataset.area;
        syncAreas();
        buildFloor();
        say(areaName(area) + ': ' + tabs.filter(function (t) {
          return t.area === area && t.opened !== null && t.lines.length;
        }).length + ' dolu masa.');
      } else if (b.dataset.tab) openTab(b.dataset.tab);
      else if (b.hasAttribute('data-back')) closeView();
      else if (b.dataset.cat) {
        cat = b.dataset.cat;
        $$('.chip-app', catsEl).forEach(function (c) {
          c.setAttribute('aria-pressed', String(c.dataset.cat === cat));
        });
        var start = b.offsetLeft - catsEl.offsetLeft;
        if (start < catsEl.scrollLeft || start + b.offsetWidth > catsEl.scrollLeft + catsEl.clientWidth) {
          catsEl.scrollLeft = Math.max(0, start - 12);
        }
        buildMenu();
      } else if (b.dataset.dish) addItem(b.dataset.dish);
      else if (b.dataset.note) cycleNote(b.dataset.note);
      else if (b === sendBtn) send();
      else if (b.dataset.station) {
        station = b.dataset.station;
        updateStations();
        updateTickets();
        ticketsEl.scrollLeft = 0;
      } else if (b.dataset.all) markReady(b.dataset.all);
      else if (b.dataset.item) markReady(b.dataset.tk, [b.dataset.item]);
    });

    /* The self-playing loop: a waiter opens an empty table, takes an order, sends it; the
       kitchen clears it, the table turns olive, then the bill is paid and the table frees up.
       It stops for good the moment the visitor touches, clicks or tabs into the stage. */
    var CANCEL = {};
    var playing = false;
    var userStopped = false;
    var token = 0;
    var inView = false;
    var resumers = [];
    var cycle = 0;
    var suspended = function () {
      return !inView || doc.hidden;
    };
    function wait(ms, my) {
      return new Promise(function (resolve, reject) {
        var left = ms;
        var last = performance.now();
        (function step() {
          if (my !== token) return reject(CANCEL);
          if (suspended()) {
            resumers.push(function () {
              last = performance.now();
              step();
            });
            return;
          }
          var at = performance.now();
          left -= at - last;
          last = at;
          if (left <= 0) return resolve();
          setTimeout(step, Math.min(left, 150));
        })();
      });
    }
    function resume() {
      var list = resumers;
      resumers = [];
      list.forEach(function (fn) {
        fn();
      });
    }
    function visibleOne(sel) {
      return $$(sel, pos).filter(shown)[0] || null;
    }
    function tap(target, my) {
      if (!target) return wait(200, my);
      // A chip or ticket scrolled out of its row comes back into view before the finger goes there.
      var row = target.closest('.order__cats, .tickets');
      if (row) {
        var start = target.offsetLeft - row.offsetLeft;
        if (start < row.scrollLeft || start + target.offsetWidth > row.scrollLeft + row.clientWidth) {
          row.scrollLeft = Math.max(0, start - 12);
        }
      }
      var pr = pos.getBoundingClientRect();
      var r = target.getBoundingClientRect();
      finger.style.transform = 'translate(' + (r.left - pr.left + r.width / 2).toFixed(1) + 'px,' + (r.top - pr.top + r.height / 2).toFixed(1) + 'px)';
      finger.classList.add('is-on');
      return wait(560, my)
        .then(function () {
          finger.classList.remove('is-press');
          void finger.offsetWidth;
          finger.classList.add('is-press');
          return wait(150, my);
        })
        .then(function () {
          target.click();
          return wait(260, my);
        });
    }
    var PLAN = [
      ['izgara', 'adana'],
      ['izgara', 'adana'],
      ['note', 'adana'],
      ['pide', 'lahmacun'],
      ['icecek', 'ayran'],
      ['icecek', 'ayran'],
    ];
    var TARGETS = ['4', '6', '8', '2'];
    async function loop(my) {
      // A moment to read the headline before the waiter starts.
      await wait(2200, my);
      for (;;) {
        // On a phone the floor is behind the open tab; on the counter it is always in view.
        if (openId && window.innerWidth < 760) await tap(visibleOne('[data-back]'), my);
        if (area !== 'salon') await tap(visibleOne('[data-areas] [data-area="salon"]'), my);
        var id = null;
        for (var i = 0; i < TARGETS.length; i++) {
          var cand = TARGETS[(cycle + i) % TARGETS.length];
          if (byId[cand].opened === null) {
            id = cand;
            break;
          }
        }
        if (!id) {
          seed();
          buildFloor();
          updateStations();
          updateTickets();
          continue;
        }
        cycle++;
        var title = byId[id].title;
        await tap(visibleOne('.t[data-tab="' + id + '"]'), my);
        say(title + ': garson siparişi alıyor.');
        await wait(350, my);
        for (var p = 0; p < PLAN.length; p++) {
          var step = PLAN[p];
          if (step[0] === 'note') {
            var t = byId[id];
            var l = t.lines.filter(function (x) {
              return x.item === step[1] && x.st === 'new';
            })[0];
            if (l) await tap(linesEl.querySelector('[data-note="' + l.key + '"]'), my);
            continue;
          }
          if (cat !== step[0]) await tap(catsEl.querySelector('[data-cat="' + step[0] + '"]'), my);
          await tap(menuEl.querySelector('[data-dish="' + step[1] + '"]'), my);
        }
        await wait(300, my);
        await tap(sendBtn, my);
        say(title + ': sipariş mutfağa ve bara gitti.');
        await wait(1700, my);
        var kitchenTicket = tickets.filter(function (k) {
          return k.tab === id && k.station === 'm';
        })[0];
        if (station !== 'm') await tap(stationButton('m'), my);
        if (kitchenTicket && ticketNodes[kitchenTicket.id]) {
          scrollTicketIntoView(ticketNodes[kitchenTicket.id]);
          await wait(250, my);
          await tap(ticketNodes[kitchenTicket.id].querySelector('.tk__all'), my);
          say('Mutfak: ' + title + ' hazır. Masa yeşil çerçevelendi.');
        }
        await wait(900, my);
        var barTicket = tickets.filter(function (k) {
          return k.tab === id && k.station === 'b';
        })[0];
        if (barTicket) {
          await tap(stationButton('b'), my);
          await wait(250, my);
          if (ticketNodes[barTicket.id]) {
            scrollTicketIntoView(ticketNodes[barTicket.id]);
            await tap(ticketNodes[barTicket.id].querySelector('.tk__all'), my);
          }
          await wait(500, my);
          await tap(stationButton('m'), my);
        }
        var backlog = tickets
          .filter(function (k) {
            return k.station === 'm' && k.tab !== id && !k.leaving && now() - k.sent >= SLOW;
          })
          .sort(function (a, b) {
            return a.sent - b.sent;
          })[0];
        if (backlog && ticketNodes[backlog.id]) {
          await wait(500, my);
          scrollTicketIntoView(ticketNodes[backlog.id]);
          await tap(ticketNodes[backlog.id].querySelector('.tk__all'), my);
          say('Mutfak: ' + byId[backlog.tab].title + ' de hazır.');
        }
        finger.classList.remove('is-on');
        await wait(2600, my);
        serveAndClose(id);
        say(title + ': hesap alındı, masa kapatıldı.');
        await wait(2400, my);
      }
    }
    function setPlayUi() {
      playBtn.hidden = false;
      playBtn.dataset.playing = String(playing);
      playLabel.textContent = playing ? 'Demoyu durdur' : 'Demoyu oynat';
      statusEl.setAttribute('aria-live', playing ? 'off' : 'polite');
    }
    function play() {
      if (playing) return;
      playing = true;
      var my = ++token;
      setPlayUi();
      loop(my).catch(function (err) {
        if (err !== CANCEL) throw err;
      });
    }
    function stop(byVisitor) {
      if (!playing) return;
      playing = false;
      token++;
      finger.classList.remove('is-on');
      resume();
      if (byVisitor) {
        userStopped = true;
        say('Demo sizde. Bir masaya dokunun, menüden seçin, Mutfağa gönder.');
      }
      setPlayUi();
    }
    playBtn.addEventListener('click', function () {
      if (playing) {
        stop(true);
        say('Demo durdu. Bir masaya dokunun ve deneyin.');
      } else {
        userStopped = false;
        play();
      }
    });
    function takeOver(e) {
      if (!e.isTrusted || !playing) return;
      if (playBtn.contains(e.target)) return;
      stop(true);
    }
    pos.addEventListener('pointerdown', takeOver);
    pos.addEventListener('keydown', takeOver);
    pos.addEventListener('focusin', takeOver);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        function (entries) {
          inView = entries[0].intersectionRatio >= 0.25;
          if (!suspended()) resume();
          if (inView && !playing && !userStopped && !reduced()) play();
        },
        { threshold: [0, 0.25, 0.5] }
      ).observe(pos);
    }
    doc.addEventListener('visibilitychange', function () {
      if (!suspended()) resume();
    });
    motion.addEventListener &&
      motion.addEventListener('change', function () {
        if (reduced()) stop(false);
      });

    /* The clock: timers tick while the stage is on screen. */
    setInterval(function () {
      if (!inView || doc.hidden) return;
      updateFloor();
      updateTickets();
      updateMeta();
    }, 1000);

    /* A little depth under a mouse: the devices lean toward the pointer, each by its own amount. */
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      var devices = $$('[data-tilt]', pos);
      var tx = 0;
      var ty = 0;
      var raf = 0;
      var lean = function () {
        raf = 0;
        devices.forEach(function (d) {
          var depth = +d.dataset.tilt;
          var mag = Math.hypot(tx, ty);
          d.style.rotate = mag < 0.001 ? 'none' : (-ty).toFixed(3) + ' ' + tx.toFixed(3) + ' 0 ' + (mag * 4).toFixed(2) + 'deg';
          d.style.translate = (tx * depth * 4).toFixed(1) + 'px ' + (ty * depth * 4).toFixed(1) + 'px';
        });
      };
      pos.addEventListener('pointermove', function (e) {
        if (reduced() || window.innerWidth < 760 || e.pointerType !== 'mouse') return;
        var r = pos.getBoundingClientRect();
        tx = (e.clientX - r.left) / r.width - 0.5;
        ty = (e.clientY - r.top) / r.height - 0.5;
        if (!raf) raf = requestAnimationFrame(lean);
      });
      pos.addEventListener('pointerleave', function () {
        tx = 0;
        ty = 0;
        if (!raf) raf = requestAnimationFrame(lean);
      });
    }

    if (window.innerWidth >= 760) openId = '1';
    buildAreas();
    buildFloor();
    buildCats();
    buildMenu();
    buildStations();
    updateTickets();
    renderOrder();
    setPlayUi();
  }

  /* ---------------------------------------------------------------------------------------
     The story: the step in the middle of the screen picks the device. Stacked (phones, reduced
     motion), each device plays its step as it scrolls into view.
     --------------------------------------------------------------------------------------- */
  function initStory() {
    var story = $('[data-story]');
    if (!story || !('IntersectionObserver' in window)) return;
    var steps = $$('[data-step]', story);
    var frames = $$('[data-frame]', story);
    var sticky = window.matchMedia('(min-width: 900px) and (prefers-reduced-motion: no-preference)');
    var active = 0;
    var reached = false;
    function setActive(i) {
      active = i;
      reached = true;
      steps.forEach(function (s, j) {
        s.classList.toggle('is-active', j === i);
      });
      frames.forEach(function (f, j) {
        f.classList.toggle('is-active', j === i);
      });
    }
    var stepWatch = new IntersectionObserver(
      function (entries) {
        if (!sticky.matches) return;
        entries.forEach(function (e) {
          if (e.isIntersecting) setActive(+e.target.dataset.step);
        });
      },
      { rootMargin: '-45% 0px -45% 0px' }
    );
    var frameWatch = new IntersectionObserver(
      function (entries) {
        if (sticky.matches) return;
        entries.forEach(function (e) {
          e.target.classList.toggle('is-active', e.isIntersecting && !reduced());
        });
      },
      { threshold: 0.4 }
    );
    function arm() {
      stepWatch.disconnect();
      frameWatch.disconnect();
      steps.forEach(function (s) {
        s.classList.remove('is-active');
      });
      frames.forEach(function (f) {
        f.classList.remove('is-active');
      });
      if (sticky.matches) {
        if (reached) setActive(active);
        steps.forEach(function (s) {
          stepWatch.observe(s);
        });
      } else {
        frames.forEach(function (f) {
          frameWatch.observe(f);
        });
      }
    }
    if (sticky.addEventListener) sticky.addEventListener('change', arm);
    arm();
    // Until a step reaches the middle, the device column shows the first step once the story is
    // well into view, so the column is never empty.
    new IntersectionObserver(
      function (entries, watch) {
        if (!entries[0].isIntersecting) return;
        watch.disconnect();
        if (sticky.matches && !reached) setActive(0);
      },
      { rootMargin: '0px 0px -35% 0px' }
    ).observe(story);
    var live = $('.story__frame--live', story);
    if (live) {
      live.addEventListener('focusin', function () {
        if (!sticky.matches || active === 2) return;
        setActive(2);
        steps[2].scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
      });
    }
  }

  /* ---------------------------------------------------------------------------------------
     The bill: tick what one person ate and take their payment, or split it evenly and take
     one share at a time. What is left stays open, as in the app's pay window.
     --------------------------------------------------------------------------------------- */
  function initBill() {
    var bill = $('[data-bill]');
    if (!bill) return;
    var LINES = [
      { name: '1 × Adana kebap', amount: 450 },
      { name: '1 × Adana kebap', amount: 450 },
      { name: '1 × Kuzu şiş', amount: 520 },
      { name: '1 × Ezme', amount: 110 },
      { name: '3 × Ayran', amount: 150 },
      { name: '1 × Künefe', amount: 180 },
    ];
    var TOTAL = LINES.reduce(function (a, l) {
      return a + l.amount;
    }, 0);
    var listEl = $('[data-bill-lines]', bill);
    var dueEl = $('[data-due]', bill);
    var leftEl = $('[data-left]', bill);
    var leftRow = $('.bill__left', bill);
    var payBtn = $('[data-pay]', bill);
    var eachEl = $('[data-each]', bill);
    var headsEl = $('[data-heads-value]', bill);
    var sharesEl = $('[data-shares]', bill);
    var statusEl = $('[data-bill-status]', bill);
    var panels = $$('[data-panel]', bill);
    var mode = 'items';
    var heads = 3;
    var paid; // index -> method, for the items mode
    var shares; // methods of paid shares, for the equal mode
    var payments;
    var boxes = [];

    LINES.forEach(function (l, i) {
      var li = el('li', 'bill__line');
      var label = el('label');
      var box = el('input');
      box.type = 'checkbox';
      box.dataset.i = i;
      label.appendChild(box);
      label.appendChild(el('span', 'bill__name', l.name));
      var tag = el('span', 'bill__tag');
      tag.hidden = true;
      label.appendChild(tag);
      label.appendChild(el('span', 'bill__amount', tl(l.amount)));
      li.appendChild(label);
      listEl.appendChild(li);
      boxes.push(box);
    });

    function paidSum() {
      return payments.reduce(function (a, p) {
        return a + p;
      }, 0);
    }
    function share() {
      return Math.ceil(TOTAL / heads);
    }
    function due() {
      if (mode === 'items') {
        return boxes.reduce(function (a, b, i) {
          return a + (b.checked && !paid[i] ? LINES[i].amount : 0);
        }, 0);
      }
      if (shares.length >= heads) return 0;
      return shares.length === heads - 1 ? TOTAL - paidSum() : share();
    }
    function method() {
      var m = bill.querySelector('input[name="bill-method"]:checked');
      return m ? m.value : 'Nakit';
    }
    function reset() {
      paid = {};
      shares = [];
      payments = [];
      boxes.forEach(function (b) {
        b.checked = false;
      });
      render();
    }
    function render() {
      panels.forEach(function (p) {
        p.hidden = p.dataset.panel !== mode;
      });
      boxes.forEach(function (b, i) {
        var li = b.closest('.bill__line');
        var m = paid[i];
        b.disabled = !!m;
        if (m) b.checked = true;
        li.classList.toggle('is-paid', !!m);
        var tag = li.querySelector('.bill__tag');
        tag.hidden = !m;
        tag.textContent = m ? 'Ödendi, ' + m.toLowerCase() : '';
      });
      headsEl.textContent = heads;
      eachEl.textContent = tl(share());
      $$('[data-heads]', bill).forEach(function (b) {
        var d = +b.dataset.heads;
        b.disabled = shares.length > 0 || (d < 0 ? heads <= 2 : heads >= 8);
      });
      sharesEl.textContent = '';
      for (var i = 0; i < heads; i++) {
        var amount = i === heads - 1 ? TOTAL - share() * (heads - 1) : share();
        var li = el('li', 'share' + (shares[i] ? ' is-paid' : ''), (i + 1) + '. kişi ' + tl(amount) + (shares[i] ? ', ' + shares[i].toLowerCase() : ''));
        sharesEl.appendChild(li);
      }
      var d = due();
      if (dueEl.textContent !== tl(d)) {
        dueEl.textContent = tl(d);
        bump(dueEl);
      }
      var left = TOTAL - paidSum();
      leftEl.textContent = left > 0 ? tl(left) : 'Masa kapatıldı';
      leftRow.classList.toggle('is-done', left <= 0);
      payBtn.disabled = d <= 0;
    }
    bill.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'bill-mode') {
        mode = t.value;
        var had = payments.length > 0;
        reset();
        statusEl.textContent = (mode === 'items' ? 'Kalem kalem bölünüyor.' : 'Eşit bölünüyor, kişi başı ' + tl(share()) + '.') + (had ? ' Hesap baştan alındı.' : '');
      } else if (t.type === 'checkbox') {
        render();
        statusEl.textContent = 'Ödenecek ' + tl(due()) + '.';
      } else if (t.name === 'bill-method') {
        render();
      }
    });
    bill.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.heads) {
        heads = Math.max(2, Math.min(8, heads + +b.dataset.heads));
        render();
        statusEl.textContent = heads + ' kişi, kişi başı ' + tl(share()) + '.';
      } else if (b === payBtn) {
        var d = due();
        if (d <= 0) return;
        var m = method();
        if (mode === 'items') {
          boxes.forEach(function (box, i) {
            if (box.checked && !paid[i]) paid[i] = m;
          });
        } else {
          shares.push(m);
        }
        payments.push(d);
        render();
        var left = TOTAL - paidSum();
        statusEl.textContent = tl(d) + ' ' + m.toLowerCase() + ' alındı. ' + (left > 0 ? 'Kalan ' + tl(left) + '.' : 'Hesap kapandı, masa kapatıldı.');
        if (left > 0 && mode === 'items') {
          var next = boxes.filter(function (x) {
            return !x.disabled;
          })[0];
          if (next && doc.activeElement === payBtn) next.focus();
        }
      } else if (b.hasAttribute('data-bill-reset')) {
        reset();
        statusEl.textContent = 'Hesap baştan alındı.';
      }
    });
    reset();
  }

  /* ---------------------------------------------------------------------------------------
     The outage: switch the line off and orders queue on the phone; switch it on and they go
     to the register and the kitchen one after another.
     --------------------------------------------------------------------------------------- */
  function initOutage() {
    var flow = $('[data-flow]');
    if (!flow) return;
    var sw = $('[data-net]');
    var swLabel = $('[data-net-label]');
    var addBtn = $('[data-add-order]');
    var queueEl = $('[data-queue]');
    var countEl = $('[data-queue-count]');
    var wordEl = $('[data-queue-word]');
    var arrivedEl = $('[data-arrived]');
    var arrivedCount = $('[data-arrived-count]');
    var syncEl = $('[data-flow-sync]');
    var syncText = $('[data-flow-sync-text]');
    var kitchenSync = $('[data-kitchen-sync]');
    var statusEl = $('[data-net-status]');
    var emptyEl = $('[data-queue-empty]');
    var ORDERS = [
      ['Masa 2', '2 × Adana kebap'],
      ['Bahçe 3', 'Lahmacun, 2 × Ayran'],
      ['Paket 2', '4 × Lahmacun'],
      ['Masa 6', '2 × Künefe'],
      ['Masa 8', 'Rakı 35 cl, Su'],
      ['Bahçe 2', 'Kuzu şiş, Ezme'],
      ['Masa 4', '3 × Şalgam'],
      ['Paket 3', '2 × Kıymalı pide'],
    ];
    var MAX_QUEUE = 9;
    var online = true;
    var queue = [];
    var arrived = +arrivedCount.textContent;
    var next = 0;
    var flushing = false;
    var visible = false;

    function chip(cls, order) {
      var li = el('li', cls);
      li.appendChild(el('span', null, order[0]));
      li.appendChild(el('span', null, order[1]));
      return li;
    }
    function counts() {
      countEl.textContent = queue.length;
      wordEl.textContent = queue.length ? 'sipariş sırada' : 'sırada sipariş yok';
      addBtn.disabled = queue.length >= MAX_QUEUE;
      emptyEl.hidden = queue.length > 0 || queueEl.children.length > 0;
      emptyEl.textContent = online ? 'Alınan sipariş hemen kasaya ve mutfağa gider.' : 'İnternet yok. Alınan siparişler burada bekler.';
    }
    function setSync() {
      syncEl.classList.toggle('is-off', !online);
      syncEl.classList.toggle('is-busy', online && flushing);
      syncText.textContent = !online ? 'Çevrimdışı' : flushing ? 'Gönderiyor' : 'Çevrimiçi';
      kitchenSync.textContent = !online ? 'Bekliyor' : flushing ? 'Eşitleniyor' : 'Eşit';
      kitchenSync.classList.toggle('is-wait', !online || flushing);
    }
    function takeOrder() {
      if (queue.length >= MAX_QUEUE) return;
      var order = ORDERS[next++ % ORDERS.length];
      var li = chip('queue__item', order);
      if (!reduced()) li.classList.add('is-in');
      queueEl.appendChild(li);
      queue.push({ order: order, li: li });
      bump(countEl);
      counts();
      if (online) flush();
      else statusEl.textContent = order[0] + ' siparişi telefonda sıraya girdi. Sırada ' + queue.length + '.';
    }
    function arrive(order) {
      var a = chip('arrived__item', order);
      if (!reduced()) a.classList.add('is-in');
      arrivedEl.insertBefore(a, arrivedEl.firstChild);
      while (arrivedEl.children.length > 4) arrivedEl.lastElementChild.remove();
      arrived++;
      arrivedCount.textContent = arrived;
      bump(arrivedCount);
    }
    // Everything waiting leaves in a quick cascade, oldest first; the counter runs down with it.
    function flush() {
      if (flushing || !queue.length) return;
      flushing = true;
      setSync();
      var animate = visible && !reduced();
      var total = queue.length;
      var jobs = [];
      for (var i = 0; i < total; i++) {
        jobs.push(
          sleep(animate ? i * 170 : 0).then(function () {
            var item = queue.shift();
            if (!item) return;
            counts();
            bump(countEl);
            var from = item.li.getBoundingClientRect();
            var to = (arrivedEl.firstElementChild || arrivedEl).getBoundingClientRect();
            item.li.classList.add('is-gone');
            var flight = animate ? fly(from, to, item.order[0] + '<small>' + item.order[1] + '</small>', 640) : Promise.resolve();
            return flight.then(function () {
              item.li.remove();
              arrive(item.order);
              counts();
            });
          })
        );
      }
      Promise.all(jobs).then(function () {
        flushing = false;
        setSync();
        statusEl.textContent = total > 1 ? 'Eşitlendi: ' + total + ' sipariş kasaya ve mutfağa gönderildi.' : 'Sipariş kasaya ve mutfağa gitti.';
        if (queue.length && online) flush();
      });
    }
    sw.addEventListener('click', function () {
      online = !online;
      sw.setAttribute('aria-checked', String(online));
      swLabel.textContent = online ? 'açık' : 'kapalı';
      flow.dataset.online = String(online);
      setSync();
      counts();
      if (online) {
        statusEl.textContent = queue.length ? 'İnternet geldi. Sıradaki ' + queue.length + ' sipariş gönderiliyor.' : 'İnternet geldi.';
        flush();
      } else {
        statusEl.textContent = 'İnternet kapandı. Telefon sipariş almayı sürdürüyor; siparişler sıraya giriyor.';
        if (!reduced() && !queue.length) setTimeout(function () {
          if (!online) takeOrder();
        }, 700);
      }
    });
    addBtn.addEventListener('click', takeOrder);
    // While the line is down a waiter keeps taking orders, so the queue grows by itself.
    setInterval(function () {
      if (!online && visible && !doc.hidden && !reduced() && queue.length < 6) takeOrder();
    }, 2600);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        function (entries) {
          visible = entries[0].isIntersecting;
        },
        { threshold: 0 }
      ).observe(flow);
    }
    counts();
    setSync();
  }

  /* The QR menu's phone: the guest page's sticky category tabs and its search, over the sample
     menu written in the page. Nothing is fetched. */
  function initGuestMenu() {
    var box = $('[data-guest-menu]');
    if (!box) return;
    var scroller = $('[data-gm-scroll]', box);
    var tabRow = $('[data-gm-tabs]', box);
    var tabs = $$('[data-gm-tab]', box);
    var sections = $$('[data-gm-section]', box);
    var search = $('[data-gm-search]', box);
    var status = $('[data-gm-status]', box);
    var folded = { ı: 'i', ç: 'c', ğ: 'g', ö: 'o', ş: 's', ü: 'u' };
    var fold = function (text) {
      return text
        .trim()
        .toLocaleLowerCase('tr')
        .replace(/[ıçğöşü]/g, function (letter) {
          return folded[letter];
        });
    };
    var active = 'corba';
    var settling = 0;

    function mark(id) {
      if (id === active) return;
      active = id;
      tabs.forEach(function (tab) {
        var on = tab.getAttribute('data-gm-tab') === id;
        if (on) {
          tab.setAttribute('aria-current', 'true');
          tabRow.scrollTo({
            left: tab.offsetLeft - (tabRow.clientWidth - tab.offsetWidth) / 2,
            behavior: reduced() ? 'auto' : 'smooth',
          });
        } else {
          tab.removeAttribute('aria-current');
        }
      });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var id = tab.getAttribute('data-gm-tab');
        var section = $('[data-gm-section="' + id + '"]', box);
        mark(id);
        clearTimeout(settling);
        settling = setTimeout(function () {
          settling = 0;
        }, 700);
        scroller.scrollTo({
          top: section.offsetTop - tabRow.offsetHeight,
          behavior: reduced() ? 'auto' : 'smooth',
        });
      });
    });

    // The tab of the section under the sticky row is marked as the menu scrolls.
    scroller.addEventListener(
      'scroll',
      function () {
        if (settling || box.classList.contains('is-searching')) return;
        var line = scroller.scrollTop + tabRow.offsetHeight + 8;
        var current = sections[0];
        sections.forEach(function (section) {
          if (section.offsetTop <= line) current = section;
        });
        mark(current.getAttribute('data-gm-section'));
      },
      { passive: true }
    );

    search.addEventListener('input', function () {
      var needle = fold(search.value);
      var found = 0;
      box.classList.toggle('is-searching', needle !== '');
      sections.forEach(function (section) {
        var any = false;
        $$('.gm__dish', section).forEach(function (dish) {
          var desc = $('.gm__desc', dish);
          var text = $('b', dish).textContent + ' ' + (desc ? desc.textContent : '');
          var hit = needle === '' || fold(text).indexOf(needle) !== -1;
          dish.hidden = !hit;
          if (hit) {
            any = true;
            found++;
          }
        });
        section.hidden = !any;
      });
      status.textContent =
        needle === '' ? '' : found ? found + ' yemek bulundu' : '“' + search.value.trim() + '” menüde yok.';
    });
  }

  // The setup code comes from the seller: a WhatsApp chat with the message written in, once the
  // number is set in config.js. Without one, the line under it says to get in touch instead.
  function initContact() {
    var config = window.RK_SITE || {};
    var number = String(config.whatsapp || '').replace(/\D/g, '');
    if (number.length < 10) return;
    var text = 'Merhaba, Restoran Kasa için kurulum kodu almak istiyorum.';
    $$('[data-whatsapp]').forEach(function (link) {
      link.href = 'https://wa.me/' + number + '?text=' + encodeURIComponent(text);
      link.hidden = false;
    });
    $$('[data-contact-fallback]').forEach(function (line) {
      line.hidden = true;
    });
  }

  function start() {
    initTheme();
    initContact();
    initPos();
    initStory();
    initBill();
    initOutage();
    initGuestMenu();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})();
