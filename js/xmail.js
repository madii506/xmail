/* Xmail: the inbox elon can't read. Everything here reads the real API; nothing is seeded. Unofficial, not affiliated with X Corp. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null || v === '' ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } },
    json(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } },
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes) { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = '1' + s; else break; } return s; }
  const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
  const say = t => { $('#live').textContent = t; };
  const FLOOR_NO = { eng: '12', grok: '11', ads: '10', payments: '09', product: '08', design: '07', 'trust-safety': '06', sales: '05', other: '01', 'ex-x': 'EXIT' };
  const FLOOR_NAME = { eng: 'Eng', grok: 'Grok', ads: 'Ads', payments: 'Payments', product: 'Product', design: 'Design', 'trust-safety': 'T&S', sales: 'Sales', 'ex-x': 'Ex-X', other: 'Other' };
  const FOLDER_NAME = { inbox: 'Inbox', hot: 'Hot', boss: 'To: Elon', starred: 'Starred', sent: 'Sent', drafts: 'Drafts' };
  const fname = f => FLOOR_NAME[f] || 'Other';

  const S = {
    cfg: {}, tok: store.get('xm:tok'), code: store.get('xm:code'), floor: store.get('xm:floor'),
    folder: 'inbox', fl: null, q: '', threads: [], loaded: false, open: null, thread: null, msgs: [], sig: '', req: 0,
    floors: null, totals: null, seen: store.json('xm:seen', {}), drafts: store.json('xm:drafts', []),
  };

  async function api(p, body) {
    const h = { 'content-type': 'application/json' }; if (S.tok) h.authorization = 'Bearer ' + S.tok;
    const r = await fetch('/api/' + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) { }
    if (r.status === 401 && S.tok && !/^(login|nonce)/.test(p)) signOut(true);
    if (!r.ok) { const e = new Error(j.error || 'Something went wrong (' + r.status + ').'); e.status = r.status; throw e; }
    return j;
  }

  /* ---------------- small things ---------------- */
  function toast(t) {
    $$('.toast').forEach(x => x.remove());
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); say(t);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 320); }, 2400);
  }
  const pad = n => String(n).padStart(2, '0');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function when(t) {
    const d = new Date(t), n = new Date();
    if (d.toDateString() === n.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (n - d < 6 * 864e5) return DAY[d.getDay()];
    return MON[d.getMonth()] + ' ' + d.getDate();
  }
  const full = t => { const d = new Date(t); return `${DAY[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const ago = t => { if (!t) return '—'; const s = Math.max(0, (Date.now() - new Date(t)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const idcCache = new Map();
  function idc(name) {
    name = String(name || '?'); if (idcCache.has(name)) return idcCache.get(name);
    let h = 2166136261; for (const ch of name) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    const col = ['#e7e9ea', '#a9adb2', '#71767b'][h % 3]; let bits = (h >>> 2) | 0x2000, r = '';
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) { if (bits & 1) { r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; if (x < 2) r += `<rect x="${4 - x}" y="${y}" width="1" height="1"/>`; } bits >>>= 1; }
    const svg = `<svg viewBox="-1 -1 7 7" shape-rendering="crispEdges" fill="${col}" aria-hidden="true">${r}</svg>`;
    idcCache.set(name, svg); return svg;
  }
  const idcEl = n => `<i class="idc">${idc(n)}</i>`;
  const chip = f => `<span class="chip">${esc(fname(f))}</span>`;
  const saveSeen = () => { const k = Object.keys(S.seen); if (k.length > 600) k.slice(0, k.length - 600).forEach(x => delete S.seen[x]); store.set('xm:seen', JSON.stringify(S.seen)); };
  const unread = t => !t.mine && (S.seen[t.id] == null || t.replies > S.seen[t.id]);

  /* ---------------- smooth scroll, reveal, typed headings, nav ---------------- */
  let lenis = null;
  if (!reduce && window.Lenis) { lenis = new Lenis({ lerp: .085, smoothWheel: true, wheelMultiplier: .9 }); const raf = t => { lenis.raf(t); requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
  const goTo = (el, off = 70) => { if (!el) return; const y = el.getBoundingClientRect().top + scrollY - off; lenis ? lenis.scrollTo(Math.max(0, y), { duration: 1.2 }) : scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' }); };
  function typeH2(h) {
    if (h.dataset.done) return; h.dataset.done = 1;
    const sp = h.querySelector('span'), fullT = h.dataset.type || sp.textContent;
    if (reduce) { sp.textContent = fullT; return; }
    sp.textContent = ''; let i = 0;
    const step = () => { sp.textContent = fullT.slice(0, ++i); if (i < fullT.length) setTimeout(step, 40 + Math.random() * 45); };
    setTimeout(step, 150);
  }
  $$('.h2').forEach(h => { h.dataset.type = h.querySelector('span').textContent; if (!reduce) h.querySelector('span').textContent = ''; });
  const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; const el = e.target; el.classList.contains('h2') ? typeH2(el) : el.classList.add('vis'); io.unobserve(el); }), { rootMargin: '0px 0px -8% 0px' });
  $$('.rv, .h2').forEach(el => io.observe(el));
  const nav = $('#nav'), navState = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', navState, { passive: true }); navState();
  const navLinks = $$('#links a'), ind = $('#ind'), secs = navLinks.map(a => $('#' + a.dataset.s));
  function moveInd(a) { navLinks.forEach(x => x.classList.toggle('on', x === a)); if (!a) { ind.style.opacity = 0; return; } ind.style.opacity = 1; ind.style.width = a.offsetWidth + 'px'; ind.style.transform = `translateX(${a.offsetLeft - 4}px)`; }
  function spy() { let cur = -1; secs.forEach((s, i) => { if (s && s.getBoundingClientRect().top < innerHeight * .45) cur = i; }); moveInd(navLinks[cur]); }
  addEventListener('scroll', spy, { passive: true }); addEventListener('resize', spy); spy();
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-s], a[data-go]'); if (!a) return; e.preventDefault();
    goTo($('#' + (a.dataset.s || a.dataset.go)), a.dataset.s === 'inbox' || a.dataset.go === 'inbox' ? 76 : 70);
  });

  /* the hook types itself */
  (function hook() {
    const el = $('#hook'); if (reduce) return;
    const parts = [['the inbox elon ', false], ["can't read.", true]]; el.innerHTML = '';
    let pi = 0, ci = 0; const a = document.createElement('span'), b = document.createElement('em'); el.append(a, b);
    const step = () => { const [t, em] = parts[pi]; (em ? b : a).textContent = t.slice(0, ++ci); if (ci >= t.length) { pi++; ci = 0; } if (pi < parts.length) setTimeout(step, 38 + Math.random() * 50); };
    setTimeout(step, 1100);
  })();

  /* ---------------- live background: a slow rain of mail-ish characters ---------------- */
  (function field() {
    const c = $('#bg'), x = c.getContext('2d'); if (!x) return;
    const CW = 14, CH = 22, SET = 'xXx.:+/\\-=@*', MX = { x: -999, y: -999 };
    let W, H, dpr, cols, rows, lit, chars, drops = [], dots, last = 0, raf;
    function size() {
      dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
      c.width = W * dpr; c.height = H * dpr; cols = Math.ceil(W / CW); rows = Math.ceil(H / CH);
      lit = new Float32Array(cols * rows); chars = Array.from({ length: cols * rows }, () => SET[Math.random() * SET.length | 0]);
      const n = Math.round(cols * (W < 700 ? .12 : .16)); drops = Array.from({ length: n }, () => ({ c: Math.random() * cols | 0, y: Math.random() * rows, v: 2 + Math.random() * 5 }));
      dots = document.createElement('canvas'); dots.width = c.width; dots.height = c.height; const d = dots.getContext('2d');
      d.scale(dpr, dpr); d.fillStyle = 'rgba(231,233,234,.07)';
      for (let r = 0; r < rows; r += 2) for (let k = 0; k < cols; k += 3) d.fillRect(k * CW + CW / 2, r * CH + CH / 2, 1, 1);
    }
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (document.hidden || ts - last < 33) return; const dt = Math.min(.1, (ts - last) / 1000); last = ts;
      const k = Math.pow(.9, dt * 30); for (let i = 0; i < lit.length; i++) if (lit[i] > .01) lit[i] *= k; else lit[i] = 0;
      for (const d of drops) {
        d.y += d.v * dt; const r = d.y | 0;
        if (r >= 0 && r < rows) { const i = r * cols + d.c; if (lit[i] < .9) chars[i] = SET[Math.random() * SET.length | 0]; lit[i] = 1; }
        if (d.y > rows + 4) { d.y = -Math.random() * 20; d.c = Math.random() * cols | 0; d.v = 2 + Math.random() * 5; }
      }
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.drawImage(dots, 0, 0);
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.font = '500 12px M, monospace'; x.textBaseline = 'middle'; x.textAlign = 'center';
      const mc = MX.x / CW | 0, mr = MX.y / CH | 0, R = 7;
      for (let r = 0; r < rows; r++) for (let k2 = 0; k2 < cols; k2++) {
        const i = r * cols + k2; let a = lit[i] * .17;
        const dx = k2 - mc, dy = (r - mr) * 1.6; if (dx > -R && dx < R && dy > -R && dy < R) { const dd = Math.sqrt(dx * dx + dy * dy); if (dd < R) a = Math.max(a, (1 - dd / R) * .22); }
        if (a < .012) continue;
        x.fillStyle = `rgba(231,233,234,${a.toFixed(3)})`; x.fillText(chars[i], k2 * CW + CW / 2, r * CH + CH / 2);
      }
    }
    size(); addEventListener('resize', () => { clearTimeout(size.t); size.t = setTimeout(size, 150); });
    addEventListener('pointermove', e => { MX.x = e.clientX; MX.y = e.clientY; }, { passive: true });
    addEventListener('pointerleave', () => { MX.x = MX.y = -999; });
    if (reduce) { x.drawImage(dots, 0, 0); return; }
    raf = requestAnimationFrame(frame);
  })();

  /* ---------------- the envelope, drawn in characters ---------------- */
  function asciiEnv(c, { cw = 9, ch = 15, font = 13, sweep = true } = {}) {
    const x = c.getContext('2d'); if (!x) return;
    let W, H, cols, rows, cov, glitch = new Map(), t0 = performance.now(), on = true, raf, MX = { x: -999, y: -999 };
    function build() {
      const dpr = Math.min(2, devicePixelRatio || 1), rc = c.getBoundingClientRect(); W = rc.width; H = rc.height; if (!W || !H) return false;
      c.width = W * dpr; c.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(W / cw); rows = Math.floor(H / ch);
      const m = document.createElement('canvas'); m.width = cols * cw; m.height = rows * ch; const g = m.getContext('2d');
      const ew = Math.min(m.width * .9, m.height / .7 * .9), eh = ew * .7, s = ew * .076, ox = (m.width - ew) / 2, oy = (m.height - eh) / 2;
      g.strokeStyle = '#fff'; g.lineWidth = s; g.lineJoin = 'miter';
      g.strokeRect(ox + s / 2, oy + s / 2, ew - s, eh - s);
      g.beginPath(); g.moveTo(ox + s * .9, oy + s * .9); g.lineTo(ox + ew - s * .9, oy + eh - s * .9); g.moveTo(ox + ew - s * .9, oy + s * .9); g.lineTo(ox + s * .9, oy + eh - s * .9); g.stroke();
      const d = g.getImageData(0, 0, m.width, m.height).data; cov = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        let sum = 0, n = 0; for (let yy = r * ch; yy < r * ch + ch; yy += 2) for (let xx = k * cw; xx < k * cw + cw; xx += 2) { sum += d[(yy * m.width + xx) * 4]; n++; }
        cov[r * cols + k] = sum / (n * 255);
      }
      return true;
    }
    const GL = 'Xx+/\\:.*=';
    function draw(ts) {
      const t = (ts - t0) / 1000; x.clearRect(0, 0, W, H); x.font = `500 ${font}px M, monospace`; x.textBaseline = 'top';
      const ox = (W - cols * cw) / 2, oy = (H - rows * ch) / 2, mc = (MX.x - ox) / cw, mr = (MX.y - oy) / ch;
      if (!reduce && Math.random() < .5) { const i = Math.random() * cov.length | 0; if (cov[i] > .24) glitch.set(i, { ch: GL[Math.random() * GL.length | 0], until: ts + 120 + Math.random() * 300 }); }
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        const i = r * cols + k, v = cov[i]; let chr, a;
        if (v >= .5) { chr = 'X'; a = .95; } else if (v >= .24) { chr = 'x'; a = .5; } else { if (((k * 7 + r * 13) % 23) === 0) { chr = '.'; a = .12; } else continue; }
        if (sweep && !reduce) { const p = (k + r * 1.7) * .09 - t * 1.6; const w = Math.pow(Math.max(0, Math.sin(p)), 14); a = Math.min(1, a * (.62 + .38 * w) + w * .2); }
        const g = glitch.get(i); if (g) { if (g.until < ts) glitch.delete(i); else chr = g.ch; }
        const dx = k - mc, dy = (r - mr) * 1.6, dd = dx * dx + dy * dy; if (dd < 30 && v >= .24) { chr = GL[(Math.random() * GL.length) | 0]; a = 1; }
        x.fillStyle = `rgba(231,233,234,${a.toFixed(3)})`; x.fillText(chr, ox + k * cw, oy + r * ch);
      }
    }
    function loop(ts) { raf = requestAnimationFrame(loop); if (!on || document.hidden) return; if (loop.l && ts - loop.l < 40) return; loop.l = ts; draw(ts); }
    const start = () => { if (!build()) return setTimeout(start, 200); if (reduce) draw(performance.now()); else raf = requestAnimationFrame(loop); };
    new IntersectionObserver(es => { on = es[0].isIntersecting; }).observe(c);
    c.addEventListener('pointermove', e => { const r = c.getBoundingClientRect(); MX.x = e.clientX - r.left; MX.y = e.clientY - r.top; });
    c.addEventListener('pointerleave', () => { MX.x = MX.y = -999; });
    addEventListener('resize', () => { clearTimeout(c.rt); c.rt = setTimeout(() => { build(); if (reduce) draw(performance.now()); }, 160); });
    document.fonts && document.fonts.ready.then(start); if (!document.fonts) start();
    return { stop: () => cancelAnimationFrame(raf) };
  }
  asciiEnv($('#henv'), { cw: innerWidth < 700 ? 6 : 9, ch: innerWidth < 700 ? 10 : 15, font: innerWidth < 700 ? 9 : 13 });

  /* ---------------- dialogs ---------------- */
  function modal({ title, html, buttons = [], wide = false, onBuild, onClose }) {
    const layer = $('#layer'), shade = document.createElement('div'); shade.className = 'shade';
    const d = document.createElement('div'); d.className = 'dlg' + (wide ? ' wide' : ''); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.dataset.lenisPrevent = '';
    d.innerHTML = `<div class="dh"><span>${esc(title)}</span><button type="button" aria-label="Close" data-x>&times;</button></div><div class="db">${html || ''}</div>${buttons.length ? `<div class="df">${buttons.map((b, i) => `<button class="btn sm${b.pri ? ' pri' : ''}" type="button" data-i="${i}">${esc(b.t)}</button>`).join('')}</div>` : ''}`;
    layer.append(shade, d); if (lenis) lenis.stop();
    let closed = false;
    const close = () => {
      if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true); if (onClose) onClose(); if (lenis && !$('.dlg ~ .dlg') && $$('.dlg').length <= 1) lenis.start();
      if (reduce || !d.animate) { d.remove(); shade.remove(); return; }
      d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).onfinish = () => d.remove();
      shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).onfinish = () => shade.remove();
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true); shade.addEventListener('click', close);
    d.addEventListener('click', e => { if (e.target.closest('[data-x]')) return close(); const b = e.target.closest('.df [data-i]'); if (!b) return; const bt = buttons[+b.dataset.i]; if (!bt.fn || bt.fn(d, close) !== false) close(); });
    if (onBuild) onBuild(d, close);
    return { el: d, close };
  }
  const confirmBox = (title, text, yes, fn) => modal({ title, html: `<p>${text}</p>`, buttons: [{ t: 'Cancel' }, { t: yes, pri: true, fn: () => { fn(); } }] });

  /* ---------------- config + coin ---------------- */
  async function loadCfg() {
    try { S.cfg = await api('config'); } catch (e) { S.cfg = {}; }
    const c = S.cfg, box = $('#caBox'), xh = c.x ? String(c.x).replace(/^@/, '') : '';
    const xBtn = xh ? `<a class="btn sm" href="https://x.com/${esc(xh)}" target="_blank" rel="noopener">X</a>` : '';
    if (c.ca) box.innerHTML = `<span class="addr"><b>$XMAIL</b>${esc(c.ca)}</span><button class="btn sm" type="button" data-copy="${esc(c.ca)}">copy</button><a class="btn sm" href="https://dexscreener.com/solana/${esc(c.ca)}" target="_blank" rel="noopener">chart</a>${xBtn}`;
    else box.innerHTML = xBtn;
    box.hidden = !box.innerHTML;
  }
  document.addEventListener('click', async e => {
    const c = e.target.closest('[data-copy]'); if (!c) return;
    try { await navigator.clipboard.writeText(c.dataset.copy); const t = c.textContent; c.textContent = 'copied'; setTimeout(() => c.textContent = t, 1300); } catch (_) { toast('Copy failed.'); }
  });

  /* ---------------- wallet sign-in: one signed message, never a transaction ---------------- */
  const W = { list: [] };
  function addWallet(w) { try { if (!w || !w.features || !w.name) return; const ok = (w.chains || []).some(c => String(c).startsWith('solana:')) && w.features['standard:connect'] && w.features['solana:signMessage']; if (ok && !W.list.some(x => x.name === w.name)) W.list.push(w); } catch (e) { } }
  const wapi = Object.freeze({ register: (...ws) => { ws.forEach(addWallet); return () => { }; } });
  addEventListener('wallet-standard:register-wallet', e => { try { e.detail(wapi); } catch (_) { } });
  try { dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: wapi })); } catch (_) { }
  function legacy() {
    const out = [], ph = window.phantom && window.phantom.solana, sf = window.solflare;
    if (ph && ph.signMessage && !W.list.some(w => /phantom/i.test(w.name))) out.push({ name: 'Phantom', legacy: ph });
    if (sf && sf.signMessage && !W.list.some(w => /solflare/i.test(w.name))) out.push({ name: 'Solflare', legacy: sf });
    return out;
  }
  const mobile = /iphone|ipad|android/i.test(navigator.userAgent);
  function needAuth(then) { if (S.tok) return then && then(); signInDialog(then); }
  function signInDialog(then) {
    const list = W.list.concat(legacy()), here = encodeURIComponent(location.href), ref = encodeURIComponent(location.origin);
    const body = list.length
      ? `<div class="wl">${list.map((w, i) => `<button class="btn" type="button" data-w="${i}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}${esc(w.name)}</button>`).join('')}</div>`
      : mobile ? `<div class="wl"><a class="btn" href="https://phantom.app/ul/browse/${here}?ref=${ref}">Open in Phantom</a><a class="btn" href="https://solflare.com/ul/v1/browse/${here}?ref=${ref}">Open in Solflare</a></div>`
        : `<p>No Solana wallet found in this browser.</p><div class="wl"><a class="btn" href="https://phantom.com/download" target="_blank" rel="noopener">Get Phantom</a><a class="btn" href="https://solflare.com/download" target="_blank" rel="noopener">Get Solflare</a></div>`;
    modal({
      title: 'Connect wallet',
      html: `<p><b>Sign one free message.</b> Not a transaction. Your wallet is never shown — only your codename.</p>${body}<p class="err" data-err style="margin-top:12px"></p>`,
      onBuild: (d, close) => d.addEventListener('click', async e => {
        const b = e.target.closest('[data-w]'); if (!b) return; const err = $('[data-err]', d); err.textContent = '';
        $$('[data-w]', d).forEach(x => x.disabled = true); const label = b.innerHTML; b.textContent = 'Check your wallet…';
        try { const j = await signIn(list[+b.dataset.w]); close(); if (j.fresh) setTimeout(() => profileDialog(true, then), 260); else if (then) setTimeout(then, 200); }
        catch (x) { err.textContent = /reject|cancel|declin|denied/i.test(x.message) ? 'Cancelled.' : x.message; $$('[data-w]', d).forEach(y => y.disabled = false); b.innerHTML = label; }
      }),
    });
  }
  async function signIn(w) {
    let address, sign;
    if (w.legacy) {
      const r = await w.legacy.connect(); address = String((r && r.publicKey) || w.legacy.publicKey);
      sign = async bytes => { const o = await w.legacy.signMessage(bytes, 'utf8'); return { sig: o.signature || o, msg: bytes }; };
    } else {
      const r = await w.features['standard:connect'].connect(); const acct = (r && r.accounts && r.accounts[0]) || (w.accounts && w.accounts[0]);
      if (!acct) throw new Error('The wallet did not share an account.');
      address = acct.address;
      sign = async bytes => { const [o] = await w.features['solana:signMessage'].signMessage({ account: acct, message: bytes }); return { sig: o.signature, msg: o.signedMessage || bytes }; };
    }
    const n = await api('nonce?wallet=' + encodeURIComponent(address));
    const o = await sign(new TextEncoder().encode(n.message));
    const j = await api('login', { wallet: address, nonce: n.nonce, sig: b58(new Uint8Array(o.sig)), msg: b64(new Uint8Array(o.msg)) });
    S.tok = j.token; setMe(j.codename, j.floor);
    store.set('xm:tok', S.tok);
    loadList(true); if (S.open) refreshThread(true); else renderRead();
    if (!j.fresh) toast('Signed in as ' + j.codename);
    return j;
  }
  function setMe(code, floor) {
    S.code = code; S.floor = floor; store.set('xm:code', code || ''); store.set('xm:floor', floor || ''); renderMe();
  }
  function signOut(expired) {
    S.tok = null; ['tok', 'code', 'floor'].forEach(k => store.set('xm:' + k, '')); S.code = S.floor = null;
    renderMe(); renderRead(); if (S.folder === 'starred' || S.folder === 'sent') setFolder('inbox'); else loadList(true);
    if (expired) toast('Your sign-in expired. Connect again.');
  }
  function renderMe() {
    const on = !!S.tok && !!S.code;
    $('#meBtn').classList.toggle('on', on); $('#meLabel').textContent = on ? S.code : innerWidth < 760 ? 'Connect' : 'Connect wallet';
    $('#meIdc').innerHTML = on ? idc(S.code) : '';
    $('#whoChip').textContent = on ? `[ ${S.code} · ${fname(S.floor).toLowerCase()} ]` : '[ anon ]';
  }
  function profileDialog(fresh, after) {
    let floor = S.floor || 'other';
    const floors = Object.keys(FLOOR_NAME);
    modal({
      title: fresh ? "You're in" : 'Profile',
      html: `${fresh ? `<p style="margin-bottom:16px">Your codename is <b>${esc(S.code)}</b>. Keep it or pick your own, then pick your floor.</p>` : ''}
        <label class="lab" for="pfC">CODENAME</label><input class="field" id="pfC" maxlength="16" spellcheck="false" autocomplete="off" value="${esc(S.code || '')}">
        <span class="lab">FLOOR</span><div class="fla">${floors.map(f => `<button type="button" data-fl="${f}" class="${f === floor ? 'on' : ''}">${esc(FLOOR_NAME[f])}</button>`).join('')}</div>
        <p class="err" data-err style="margin-top:12px"></p>`,
      buttons: [{ t: fresh ? 'Later' : 'Cancel' }, { t: 'Save', pri: true, fn: (d, close) => { save(d, close); return false; } }],
      onClose: after ? () => setTimeout(after, 180) : null,
      onBuild: (d, close) => {
        d.addEventListener('click', e => { const b = e.target.closest('[data-fl]'); if (!b) return; floor = b.dataset.fl; $$('[data-fl]', d).forEach(x => x.classList.toggle('on', x === b)); });
        const i = $('#pfC', d); setTimeout(() => i.focus(), 60); i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(d, close); } });
      },
    });
    async function save(d, close) {
      const err = $('[data-err]', d); err.textContent = '';
      try { const j = await api('profile', { codename: $('#pfC', d).value.trim().toLowerCase(), floor }); setMe(j.codename, j.floor); close(); toast('Saved. You are ' + j.codename + ' on ' + fname(j.floor) + '.'); loadFloors(); }
      catch (e) { err.textContent = e.message; }
    }
  }
  async function meDialog() {
    const m = modal({
      title: 'You',
      html: `<div class="mecard">${idcEl(S.code)}<div><b>${esc(S.code)}</b><span>${esc(fname(S.floor))} floor · wallet hidden</span></div></div><div class="stats" id="meStats">reading…</div>`,
      buttons: [{ t: 'Disconnect', fn: () => { signOut(); toast('Disconnected.'); } }, { t: 'Sent', fn: () => { setFolder('sent'); goTo($('#inbox'), 76); } }, { t: 'Edit profile', pri: true, fn: () => { setTimeout(() => profileDialog(false), 180); } }],
    });
    try { const j = await api('me'); setMe(j.codename, j.floor); const st = $('#meStats', m.el); if (st) st.innerHTML = `<span><b>${j.threads}</b> mails</span><span><b>${j.replies}</b> replies</span><span><b>${j.votes}</b> +1s received</span>`; }
    catch (e) { const st = $('#meStats', m.el); if (st) st.textContent = e.message; }
  }
  $('#meBtn').addEventListener('click', () => S.tok ? meDialog() : signInDialog());
  $('#whoChip').addEventListener('click', () => S.tok ? meDialog() : signInDialog());

  /* ---------------- the list ---------------- */
  const client = $('#client'), rowsEl = $('#rows');
  function setFolder(f, fl = null) {
    S.folder = f; S.fl = fl; if (f !== 'inbox' || fl) { S.q = ''; $('#q').value = ''; }
    $$('#folders [data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === f && !fl));
    $$('#sideFloors [data-fl]').forEach(b => b.classList.toggle('on', b.dataset.fl === fl));
    client.classList.remove('side-on'); S.threads = []; S.loaded = false;
    loadList();
  }
  function skeleton() { rowsEl.innerHTML = Array.from({ length: 6 }, () => `<div class="skel"><i class="a"></i><i style="width:46%"></i><i style="width:82%"></i><i style="width:64%"></i></div>`).join(''); }
  async function loadList(quiet) {
    const title = S.fl ? 'FL ' + FLOOR_NO[S.fl] + ' · ' + fname(S.fl) : S.q ? 'Search' : FOLDER_NAME[S.folder];
    $('#lTitle').textContent = title;
    if (S.folder === 'drafts') return renderDrafts();
    const id = ++S.req; if (!quiet && !S.loaded) skeleton();
    const p = new URLSearchParams({ folder: S.folder }); if (S.fl) p.set('floor', S.fl); if (S.q) p.set('q', S.q);
    try {
      const j = await api('threads?' + p); if (id !== S.req) return;
      S.threads = j.threads || []; S.loaded = true; S.need = j.need;
      if (S.folder === 'inbox' && !S.fl && !S.q) { S.inbox = S.threads; renderTape(); }
      renderRows();
    } catch (e) {
      if (id !== S.req) return; if (quiet && S.loaded) return;
      rowsEl.innerHTML = `<div class="empty"><b>Couldn't load mail.</b><span>${esc(e.message)}</span><button class="btn sm" type="button" data-retry>try again</button></div>`;
      $('#lCount').textContent = '';
    }
  }
  function renderRows() {
    const T = S.threads, n = T.length;
    $('#lCount').textContent = n ? plural(n, 'mail') : '';
    if (S.folder === 'inbox' && !S.fl && !S.q) { const u = T.filter(unread).length; const em = $('#cInbox'); em.textContent = u || ''; em.classList.toggle('n', !!u); }
    if (!n) {
      const msg = S.need === 'login' ? `<b>Connect a wallet</b><span>to see your ${S.folder} mail.</span><button class="btn sm pri" type="button" data-do="signin">Connect wallet</button>`
        : S.q ? `<b>Nothing matches “${esc(S.q)}”.</b>`
          : S.folder === 'starred' ? `<b>No stars yet.</b><span>Star a mail to keep it here.</span>`
            : S.folder === 'sent' ? `<b>You haven't sent anything.</b><button class="btn sm pri" type="button" data-do="compose">[ compose ]</button>`
              : S.folder === 'boss' ? `<b>Nobody has written to elon yet.</b><button class="btn sm pri" type="button" data-do="compose" data-to="elon">[ write to elon ]</button>`
                : S.folder === 'hot' ? `<b>Nothing is hot this week.</b><span>Mail with replies and +1s rises here.</span>`
                  : S.fl ? `<b>${esc(fname(S.fl))} is quiet.</b><span>Be the first on this floor.</span><button class="btn sm pri" type="button" data-do="compose">[ compose ]</button>`
                    : `<pre>${ENV_SMALL}</pre><b>Inbox zero.</b><span>Nobody has written yet. Be the first.</span><button class="btn sm pri" type="button" data-do="compose">[ compose ]</button>`;
      rowsEl.innerHTML = `<div class="empty">${msg}</div>`; return;
    }
    const prev = new Set($$('.row', rowsEl).map(r => r.dataset.id));
    rowsEl.innerHTML = T.map((t, i) => `<button type="button" class="row${unread(t) ? ' un' : ''}${t.id === S.open ? ' sel' : ''}" data-id="${t.id}" style="--i:${prev.has(String(t.id)) ? 0 : Math.min(i, 14)};${prev.has(String(t.id)) ? 'animation:none' : ''}">
      ${idcEl(t.codename)}<span class="r1"><span class="cn">${esc(t.codename)}</span>${chip(t.floor)}</span><span class="t">${when(t.last)}</span>
      <span class="r2"><span class="to">to: ${esc(t.to)} · </span>${esc(t.subject)}</span>
      <span class="r3"><span class="pv">${esc(t.preview)}</span>${t.replies ? `<span class="c">↩ ${t.replies}</span>` : ''}${t.votes ? `<span class="c">+${t.votes}</span>` : ''}${t.starred ? '<span class="c">★</span>' : ''}</span></button>`).join('');
  }
  const ENV_SMALL = [
    'XXXXXXXXXXXXXXXXXXXXX',
    'XXx             xXX',
    'X  xXx       xXx  X',
    'X     xXx xXx     X',
    'X       xXXx      X',
    'X     xXx xXx     X',
    'X  xXx       xXx  X',
    'XXx             xXX',
    'XXXXXXXXXXXXXXXXXXXXX'].map(l => l.padEnd(21)).join('\n');
  rowsEl.addEventListener('click', e => {
    if (e.target.closest('[data-retry]')) return loadList();
    const r = e.target.closest('.row[data-id]'); if (r) openThread(+r.dataset.id);
    const d = e.target.closest('.row[data-draft]'); if (d) openCompose(S.drafts.find(x => x.id === d.dataset.draft));
  });
  $('#folders').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) setFolder(b.dataset.f); });
  $('#sideFloors').addEventListener('click', e => { const b = e.target.closest('[data-fl]'); if (b) setFolder('inbox', b.dataset.fl === S.fl ? null : b.dataset.fl); });
  $('#refresh').addEventListener('click', e => { const b = e.currentTarget; b.classList.add('spin'); setTimeout(() => b.classList.remove('spin'), 450); loadList(true); loadFloors(); if (S.open) refreshThread(); });
  $('#ham').addEventListener('click', () => client.classList.toggle('side-on'));
  let qT; $('#q').addEventListener('input', e => {
    clearTimeout(qT); qT = setTimeout(() => {
      S.q = e.target.value.trim().slice(0, 60);
      if (S.folder !== 'inbox' || S.fl) { S.folder = 'inbox'; S.fl = null; $$('#folders [data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === 'inbox')); $$('#sideFloors [data-fl]').forEach(b => b.classList.remove('on')); }
      S.loaded = false; loadList();
    }, 280);
  });

  /* drafts live only in this browser */
  const saveDrafts = () => { store.set('xm:drafts', JSON.stringify(S.drafts.slice(0, 40))); $('#cDrafts').textContent = S.drafts.length || ''; };
  function renderDrafts() {
    S.req++; $('#lCount').textContent = S.drafts.length ? plural(S.drafts.length, 'draft') : '';
    if (!S.drafts.length) { rowsEl.innerHTML = `<div class="empty"><b>No drafts.</b><span>Drafts stay in this browser only.</span></div>`; return; }
    rowsEl.innerHTML = S.drafts.map((d, i) => `<button type="button" class="row" data-draft="${esc(d.id)}" style="--i:${i}">${idcEl(S.code || 'you')}<span class="r1"><span class="cn">draft</span></span><span class="t">${when(d.at)}</span><span class="r2"><span class="to">to: ${esc(d.to || 'everyone')} · </span>${esc(d.subject || '(no subject)')}</span><span class="r3"><span class="pv">${esc((d.body || '').slice(0, 140))}</span></span></button>`).join('');
  }

  /* ---------------- the reading pane ---------------- */
  const read = $('#read');
  function renderRead() {
    if (!S.open || !S.thread) {
      read.innerHTML = `<div class="rempty"><canvas id="renv"></canvas><span>Pick a mail.</span><span class="k"><span><kbd>c</kbd> compose</span><span><kbd>/</kbd> search</span><span><kbd>j</kbd> <kbd>k</kbd> move</span></span></div>`;
      asciiEnv($('#renv'), { cw: 5, ch: 8, font: 7.5, sweep: true }); return;
    }
    const t = S.thread;
    read.innerHTML = `<div class="rtools"><button class="tool back" type="button" data-a="back">← back</button>
      <button class="tool${t.voted ? ' on' : ''}" type="button" data-a="vote" title="+1">+1 <b>${t.votes}</b></button>
      <button class="tool${t.starred ? ' on' : ''}" type="button" data-a="star">${t.starred ? '★' : '☆'} star</button><span class="sp"></span>
      <button class="tool" type="button" data-a="link">link</button>${t.mine ? '<button class="tool" type="button" data-a="del">delete</button>' : '<button class="tool" type="button" data-a="report">report</button>'}</div>
      <div class="mail"><h3 class="subj">${esc(t.subject)}</h3>
      <div class="mhd">${idcEl(t.codename)}<div class="who"><b>${esc(t.codename)}${chip(t.floor)}</b><span>to: ${esc(t.to)}</span></div><time>${full(t.at)}</time></div>
      <div class="body">${esc(t.body)}</div></div>
      <div class="msgs" id="msgs">${S.msgs.map(msgHtml).join('')}</div>
      <div class="reply" id="replyBox"></div>`;
    renderReply();
  }
  function msgHtml(m) {
    return `<div class="msg${m.mine ? ' mine' : ''}" data-mid="${m.id}">${idcEl(m.codename)}<div><div class="mh"><span class="cn">${esc(m.codename)}</span>${chip(m.floor)}<time>${when(m.at)}</time></div>
      ${m.hidden ? '<div class="mb gone">[removed]</div>' : `<div class="mb">${esc(m.body)}</div><div class="ma"><button class="tool${m.voted ? ' on' : ''}" type="button" data-m="vote">+1${m.votes ? ` <b>${m.votes}</b>` : ''}</button>${m.mine ? '<button class="tool" type="button" data-m="del">delete</button>' : '<button class="tool" type="button" data-m="report">report</button>'}</div>`}</div></div>`;
  }
  function renderReply() {
    const box = $('#replyBox'); if (!box) return;
    if (!S.tok) { box.innerHTML = `<div class="signhint"><span>Connect a wallet to reply all.</span><button class="btn sm pri" type="button" data-do="signin">Connect wallet</button></div>`; return; }
    const keep = S.replyDraft && S.replyDraft.id === S.open ? S.replyDraft.text : '';
    box.innerHTML = `<form class="rbox" id="rForm"><textarea id="rIn" maxlength="3000" placeholder="reply all as ${esc(S.code)}…" aria-label="Reply">${esc(keep)}</textarea><div class="rbar"><span><span class="err" id="rErr"></span></span><span id="rCnt" style="flex:none"></span><button class="btn sm pri" type="submit">send ⏎</button></div></form>`;
    const ta = $('#rIn'), grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(220, ta.scrollHeight) + 'px'; $('#rCnt').textContent = ta.value.length > 2500 ? 3000 - ta.value.length : ''; S.replyDraft = { id: S.open, text: ta.value }; };
    ta.addEventListener('input', grow); ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } });
    $('#rForm').addEventListener('submit', e => { e.preventDefault(); sendReply(); }); if (keep) grow();
  }
  async function sendReply() {
    const ta = $('#rIn'), err = $('#rErr'), btn = $('#rForm button[type=submit]'); if (!ta || !ta.value.trim()) return;
    err.textContent = ''; btn.disabled = true;
    try {
      await api('reply', { thread: S.open, body: ta.value }); S.replyDraft = null; ta.value = ''; ta.style.height = '';
      await refreshThread(true); S.seen[S.open] = S.thread ? S.thread.replies : 0; saveSeen();
      read.scrollTo({ top: read.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }); loadList(true); loadFloors();
    } catch (e) { err.textContent = e.message; } finally { if ($('#rForm button[type=submit]')) $('#rForm button[type=submit]').disabled = false; }
  }
  async function openThread(id, fromLink) {
    if (!id) return; S.open = id; S.replyDraft = S.replyDraft && S.replyDraft.id === id ? S.replyDraft : null;
    $$('.row', rowsEl).forEach(r => r.classList.toggle('sel', +r.dataset.id === id));
    client.dataset.pane = 'read'; read.scrollTop = 0;
    try { history.replaceState(null, '', '?m=' + id + location.hash); } catch (e) { }
    const cached = S.threads.find(t => t.id === id);
    if (!S.thread || S.thread.id !== id) read.innerHTML = `<div class="mail"><h3 class="subj">${esc(cached ? cached.subject : '…')}</h3><div class="skel" style="padding:0;border:0;margin-top:20px"><i class="a"></i><i style="width:40%"></i><i style="width:90%"></i><i style="width:70%"></i></div></div>`;
    await refreshThread(true);
    if (S.thread && S.thread.id === id) { S.seen[id] = S.thread.replies; saveSeen(); const r = $(`.row[data-id="${id}"]`, rowsEl); if (r) r.classList.remove('un'); renderRows(); }
    if (fromLink) goTo($('#inbox'), 76);
  }
  async function refreshThread(force) {
    const id = S.open; if (!id) return;
    try {
      const j = await api('thread?id=' + id); if (S.open !== id) return;
      const sig = JSON.stringify(j); if (!force && sig === S.sig) return;
      const before = new Set(S.msgs.map(m => m.id)), had = S.thread && S.thread.id === id;
      S.sig = sig; S.thread = j.thread; S.msgs = j.msgs;
      const ta = $('#rIn'), focus = ta && document.activeElement === ta, st = read.scrollTop;
      renderRead(); read.scrollTop = st;
      if (had) $$('.msg', read).forEach(el => { if (!before.has(+el.dataset.mid)) el.classList.add('new'); });
      if (focus && $('#rIn')) { const t = $('#rIn'); t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); }
    } catch (e) {
      if (S.open !== id) return;
      if (e.status === 404) { S.thread = null; read.innerHTML = `<div class="rempty"><b style="color:var(--tx)">That mail is gone.</b><span>Deleted, or hidden after reports.</span><button class="btn sm" type="button" data-a="back">back</button></div>`; }
      else if (force) read.innerHTML = `<div class="rempty"><b style="color:var(--tx)">Couldn't open it.</b><span>${esc(e.message)}</span></div>`;
    }
  }
  function closeRead() {
    client.dataset.pane = 'list'; S.open = null; S.thread = null; S.sig = ''; $$('.row.sel', rowsEl).forEach(r => r.classList.remove('sel'));
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { }
    setTimeout(renderRead, innerWidth <= 1180 ? 420 : 0);
  }
  read.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'), m = e.target.closest('[data-m]');
    if (a) {
      const t = S.thread, act = a.dataset.a;
      if (act === 'back') return closeRead();
      if (!t) return;
      if (act === 'link') { try { await navigator.clipboard.writeText(location.origin + '/?m=' + t.id); toast('Link copied.'); } catch (_) { toast(location.origin + '/?m=' + t.id); } return; }
      needAuth(async () => {
        try {
          if (act === 'vote') { const j = await api('vote', { kind: 't', id: t.id }); t.voted = j.voted; t.votes += j.voted ? 1 : -1; renderRead(); loadList(true); }
          if (act === 'star') { const j = await api('star', { thread: t.id }); t.starred = j.starred; renderRead(); toast(j.starred ? 'Starred.' : 'Unstarred.'); loadList(true); }
          if (act === 'report') confirmBox('Report', 'Report this mail? Three reports from different people hide it.', 'Report', async () => { try { await api('report', { kind: 't', id: t.id }); toast('Reported. Thanks.'); refreshThread(true); loadList(true); } catch (x) { toast(x.message); } });
          if (act === 'del') confirmBox('Delete', 'Delete this mail and hide its replies? This cannot be undone.', 'Delete', async () => { try { await api('delete', { kind: 't', id: t.id }); toast('Deleted.'); closeRead(); loadList(true); loadFloors(); } catch (x) { toast(x.message); } });
        } catch (x) { toast(x.message); }
      });
    }
    if (m) {
      const el = m.closest('[data-mid]'), id = +el.dataset.mid, msg = S.msgs.find(x => x.id === id); if (!msg) return;
      needAuth(async () => {
        try {
          if (m.dataset.m === 'vote') { const j = await api('vote', { kind: 'm', id }); msg.voted = j.voted; msg.votes += j.voted ? 1 : -1; el.outerHTML = msgHtml(msg); }
          if (m.dataset.m === 'report') confirmBox('Report', 'Report this reply? Three reports from different people hide it.', 'Report', async () => { try { await api('report', { kind: 'm', id }); toast('Reported. Thanks.'); refreshThread(true); } catch (x) { toast(x.message); } });
          if (m.dataset.m === 'del') confirmBox('Delete', 'Delete this reply? This cannot be undone.', 'Delete', async () => { try { await api('delete', { kind: 'm', id }); toast('Deleted.'); refreshThread(true); } catch (x) { toast(x.message); } });
        } catch (x) { toast(x.message); }
      });
    }
  });

  /* ---------------- compose ---------------- */
  let cmp = null;
  const TO = ['everyone', 'elon', 'my manager', 'hr', 'the floor', 'grok', 'the next hire'];
  function openCompose(draft, to) {
    if (cmp) { cmp.el.classList.remove('min'); $('[data-c=subject]', cmp.el).focus(); return; }
    const d = Object.assign({ id: 'd' + Date.now().toString(36), to: to || '', subject: '', body: '' }, draft || {});
    const el = document.createElement('div'); el.className = 'cmp'; el.setAttribute('role', 'dialog'); el.dataset.lenisPrevent = '';
    const gate = S.cfg && S.cfg.gate ? ` · needs ${S.cfg.gate}% of $XMAIL` : '';
    el.innerHTML = `<div class="dh"><span>New message</span><span><button type="button" data-cm="min" aria-label="Minimize">_</button><button type="button" data-cm="close" aria-label="Close">&times;</button></span></div>
      <div class="cf"><label for="cTo">to</label><input id="cTo" data-c="to" maxlength="40" placeholder="everyone" autocomplete="off" spellcheck="false" value="${esc(d.to)}"></div>
      <div class="tos">${TO.map(t => `<button type="button" data-to="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="cf"><label for="cSub">subject</label><input id="cSub" data-c="subject" maxlength="120" autocomplete="off" value="${esc(d.subject)}"></div>
      <textarea data-c="body" maxlength="4000" placeholder="Write it like nobody's reading. Emails and phone numbers get redacted." aria-label="Message">${esc(d.body)}</textarea>
      <div class="cbar"><span class="note" data-note>as ${esc(S.code || 'you')} · ${esc(fname(S.floor).toLowerCase())}${gate}</span><button class="btn sm" type="button" data-cm="discard">discard</button><button class="btn sm" type="button" data-cm="draft">save draft</button><button class="btn sm pri" type="button" data-cm="send">send</button></div>`;
    $('#layer').appendChild(el); cmp = { el, d };
    const f = k => $(`[data-c=${k}]`, el), val = () => ({ ...d, to: f('to').value.trim(), subject: f('subject').value.trim(), body: f('body').value, at: Date.now() });
    const markTo = () => $$('.tos button', el).forEach(b => b.classList.toggle('on', b.dataset.to === f('to').value.trim().toLowerCase()));
    markTo(); f('to').addEventListener('input', markTo);
    const keepDraft = () => { const v = val(); if (!v.subject && !v.body.trim()) return false; S.drafts = [v, ...S.drafts.filter(x => x.id !== v.id)]; saveDrafts(); if (S.folder === 'drafts') renderDrafts(); return true; };
    const dropDraft = () => { S.drafts = S.drafts.filter(x => x.id !== d.id); saveDrafts(); if (S.folder === 'drafts') renderDrafts(); };
    const close = () => { cmp = null; if (reduce || !el.animate) return el.remove(); el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(20px)' }], { duration: 200, easing: 'ease-in' }).onfinish = () => el.remove(); };
    async function send() {
      const v = val(), note = $('[data-note]', el), btn = $('[data-cm=send]', el);
      if (!S.tok) return needAuth(() => { note.textContent = 'as ' + S.code; send(); });
      btn.disabled = true; btn.textContent = 'sending…';
      try {
        const j = await api('compose', { to: v.to || 'everyone', subject: v.subject, body: v.body });
        dropDraft(); close(); toast('Sent.'); S.seen[j.id] = 0; saveSeen();
        S.folder = 'inbox'; S.fl = null; S.q = ''; $('#q').value = ''; $$('#folders [data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === 'inbox')); $$('#sideFloors [data-fl]').forEach(b => b.classList.remove('on'));
        await loadList(true); openThread(j.id); loadFloors(); goTo($('#inbox'), 76);
      } catch (e) { note.innerHTML = `<span class="err">${esc(e.message)}</span>`; btn.disabled = false; btn.textContent = 'send'; }
    }
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-to]'); if (t) { f('to').value = t.dataset.to; markTo(); f('subject').focus(); return; }
      const b = e.target.closest('[data-cm]'); if (!b) return; const k = b.dataset.cm;
      if (k === 'min') el.classList.toggle('min');
      if (k === 'close') { if (keepDraft()) toast('Saved to drafts.'); close(); }
      if (k === 'draft') { if (keepDraft()) toast('Saved to drafts.'); close(); }
      if (k === 'discard') { dropDraft(); close(); }
      if (k === 'send') send();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); if (keepDraft()) toast('Saved to drafts.'); close(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    });
    setTimeout(() => (d.to ? f('subject') : f('to')).focus(), 60);
  }

  /* any [data-do] anywhere */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    if (b.dataset.do === 'compose') { const to = b.dataset.to; needAuth(() => openCompose(null, to)); }
    if (b.dataset.do === 'signin') signInDialog();
  });

  /* ---------------- floors, online, tape ---------------- */
  async function loadFloors() {
    try { const j = await api('floors'); S.floors = j.floors; S.totals = j.totals; } catch (e) { if (!S.floors) { $('#board').innerHTML = `<div class="empty"><b>Directory offline.</b><span>${esc(e.message)}</span></div>`; renderSideFloors(); } return; }
    renderSideFloors(); renderBoard();
    const t = S.totals || {}; $('#online').innerHTML = t.people ? `<i></i>${t.online} online · ${plural(t.people, 'person')}`.replace('persons', 'people') : '';
  }
  function renderSideFloors() {
    const list = S.floors || Object.keys(FLOOR_NAME).map(id => ({ id, name: FLOOR_NAME[id], threads: 0, today: 0 }));
    $('#sideFloors').innerHTML = list.map(f => `<button type="button" data-fl="${f.id}" class="${S.fl === f.id ? 'on' : ''}${f.today ? ' live' : ''}"><i></i><span>${esc(f.name)}</span><em>${f.threads || ''}</em></button>`).join('');
  }
  function renderBoard() {
    const order = ['eng', 'grok', 'ads', 'payments', 'product', 'design', 'trust-safety', 'sales', 'other', 'ex-x'];
    const by = Object.fromEntries((S.floors || []).map(f => [f.id, f]));
    $('#board').innerHTML = order.map(id => { const f = by[id] || { id, name: FLOOR_NAME[id], threads: 0, today: 0, people: 0 }; return `<button type="button" class="fl" data-board="${id}"><span class="no">${FLOOR_NO[id] === 'EXIT' ? 'EXIT' : 'FL ' + FLOOR_NO[id]}</span><span class="nm">${esc(f.name)}</span><span class="v"><b>${f.threads}</b> mails</span><span class="v d"><b>${f.today}</b> today</span><span class="v p"><b>${f.people}</b> ${f.people === 1 ? 'person' : 'people'}</span><span class="lt">${f.last ? ago(f.last) : 'no mail yet'}</span><span class="go">→</span></button>`; }).join('');
  }
  $('#board').addEventListener('click', e => { const b = e.target.closest('[data-board]'); if (!b) return; setFolder('inbox', b.dataset.board); goTo($('#inbox'), 76); });
  function renderTape() {
    const T = (S.inbox || []).slice(0, 14), tape = $('#tape');
    if (!T.length) { tape.hidden = true; return; }
    const one = T.map(t => `<button type="button" data-tape="${t.id}"><span class="to">to: ${esc(t.to)}</span><b>${esc(t.subject)}</b><span>${esc(t.codename)} · ${esc(fname(t.floor))}</span></button>`).join('');
    const sig = T.map(t => t.id + ':' + t.subject).join('|'); if (tape.dataset.sig === sig) return; tape.dataset.sig = sig;
    let html = one; while (html.length < one.length * 4 && T.length < 6) html += one;
    $('#tapeIn').innerHTML = html + html; $('#tapeIn').style.animationDuration = Math.max(30, T.length * 7) + 's'; tape.hidden = false;
  }
  $('#tape').addEventListener('click', e => { const b = e.target.closest('[data-tape]'); if (b) openThread(+b.dataset.tape, true); });

  /* ---------------- keyboard ---------------- */
  addEventListener('keydown', e => {
    const tg = e.target, typing = tg.closest && tg.closest('input, textarea, select, [contenteditable]');
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (typing) { if (e.key === 'Escape' && tg.id === 'q') { tg.blur(); } return; }
    if ($('.dlg')) return;
    const k = e.key;
    if (k === 'c') { e.preventDefault(); needAuth(() => openCompose()); }
    else if (k === '/') { e.preventDefault(); goTo($('#inbox'), 76); setTimeout(() => $('#q').focus({ preventScroll: true }), 400); }
    else if (k === 'j' || k === 'k') {
      const rows = $$('.row[data-id]', rowsEl); if (!rows.length) return; e.preventDefault();
      let i = rows.findIndex(r => +r.dataset.id === S.open); i = i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + (k === 'j' ? 1 : -1)));
      openThread(+rows[i].dataset.id); rows[i].scrollIntoView({ block: 'nearest' });
    }
    else if (k === 'r' && S.open) { e.preventDefault(); const t = $('#rIn'); if (t) t.focus(); else needAuth(); }
    else if (k === 's' && S.open) { const b = $('[data-a=star]', read); if (b) b.click(); }
    else if (k === 'Escape' && S.open) closeRead();
  });

  /* ---------------- start ---------------- */
  renderMe(); saveDrafts(); renderSideFloors(); renderRead();
  loadCfg(); loadFloors(); loadList();
  const deep = parseInt(new URLSearchParams(location.search).get('m'), 10); if (deep) setTimeout(() => openThread(deep, true), 500);
  setInterval(() => { if (document.hidden) return; if (S.folder !== 'drafts') loadList(true); if (S.open) refreshThread(); }, 8000);
  setInterval(() => { if (!document.hidden) loadFloors(); }, 30000);
  setInterval(() => { if (!document.hidden && S.tok) api('me').then(j => setMe(j.codename, j.floor)).catch(() => { }); }, 60000);
  if (S.tok) api('me').then(j => setMe(j.codename, j.floor)).catch(() => { });
})();
