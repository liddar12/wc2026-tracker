/* WC26 Tracker — app shell logic: routing, The Goal menu, install, SW */
(function () {
  const ic = UI.ic;
  const NAV = [
    { key: 'home', label: 'Home', sub: 'Today across the tournament', icon: 'home' },
    { key: 'matches', label: 'Matches', sub: 'Fixtures, live scores & results', icon: 'field' },
    { key: 'bracket', label: 'Bracket', sub: 'Knockout stage, your way', icon: 'bracket' },
    { key: 'picks', label: 'My Picks', sub: 'Predictions & points', icon: 'picks' },
    { key: 'leaderboard', label: 'Leaderboard', sub: 'You vs your group', icon: 'trophy' },
    { key: 'profile', label: 'Profile', sub: 'Account & settings', icon: 'user' },
  ];
  const TABS = ['home', 'matches', '_goal', 'bracket', 'picks'];
  const root = document.getElementById('app');

  function shell() {
    root.innerHTML = `
      <header class="topbar">
        <div class="brand" data-go="home"><div class="b">${UI.ball()}</div>
          <div class="wm"><b>WC26</b><s>TRACKER</s></div></div>
        <nav class="desk-nav">${NAV.slice(0, 5).map((n) => `<button data-go="${n.key}">${n.label}</button>`).join('')}</nav>
        <div class="right">
          <button class="iconbtn tb-bell" aria-label="Notifications">${ic('bell')}<span class="dot"></span></button>
          <button class="pill-cta" data-go="picks">${ic('plus')} Make picks</button>
          <button class="iconbtn goal" id="openMenu" aria-label="Open menu">${UI.goalIcon()}</button>
        </div>
      </header>

      <main class="main">
        ${NAV.map((n) => `<section class="screen" id="scr-${n.key}"></section>`).join('')}
      </main>

      <nav class="tabbar">${TABS.map((k) => {
        if (k === '_goal') return `<button class="tab center" id="openMenuTab" aria-label="Menu"><div class="goalbtn">${UI.goalIcon({ color: '#06351c', net: 'rgba(6,53,28,0.4)' })}</div><b>Menu</b></button>`;
        const n = NAV.find((x) => x.key === k);
        return `<button class="tab" data-go="${k}">${ic(n.icon)}<b>${n.label.split(' ').pop()}</b></button>`;
      }).join('')}</nav>

      <div class="goalmenu" id="goalMenu">
        <div class="field"></div><div class="stripeov"></div>
        <div class="gwrap">${UI.bigGoal(360, 150)}</div>
        <div class="mtop"><span class="lbl">Line-up</span>
          <button class="closebtn" data-close aria-label="Close">${ic('close')}</button></div>
        <div class="navlist">${NAV.map((n, i) => `<button class="navchip" data-go="${n.key}" style="transition-delay:${0.06 + i * 0.05}s">
            <span class="ni">${ic(n.icon)}</span>
            <span class="nt"><b>${n.label}</b><span>${n.sub}</span></span>
            <span class="ch">${ic('chev')}</span></button>`).join('')}</div>
        <div class="mfoot"><button class="ballbtn" data-close aria-label="Close menu">${UI.ball()}</button>
          <small>TAP THE BALL TO CLOSE</small></div>
      </div>

      <div class="sheet-scrim" id="iosScrim"></div>
      <div class="ios-sheet" id="iosSheet">
        <h3><span class="b">${UI.ball()}</span> Add WC26 to your Home Screen</h3>
        <p>Install the app for full-screen, offline-ready access — no App Store needed.</p>
        <div class="ios-step"><span class="n">1</span> Tap the <b>Share</b> button ${ic('share')}</div>
        <div class="ios-step"><span class="n">2</span> Choose <b>Add to Home Screen</b> ${ic('plus')}</div>
        <div class="ios-step"><span class="n">3</span> Tap <b>Add</b> — then open WC26 from your Home Screen</div>
      </div>

      <div class="toast" id="installToast">
        <div class="ti">${UI.ball()}</div>
        <div class="tt"><b>Install WC26 Tracker</b><span>Add to your Home Screen for the full experience</span></div>
        <button class="yes" id="installYes">Install</button>
        <button class="no" id="installNo">Later</button>
      </div>`;
  }

  // ---- routing ----
  let current = '';
  function go(key, push = true) {
    if (!NAV.find((n) => n.key === key)) key = 'home';
    if (key === current) { closeMenu(); return; }
    current = key;
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + key));
    const el = document.getElementById('scr-' + key);
    if (el && !el.dataset.built) { el.innerHTML = Screens[key](); el.dataset.built = '1'; }
    // active states
    document.querySelectorAll('.tab[data-go]').forEach((t) => t.classList.toggle('active', t.dataset.go === key));
    document.querySelectorAll('.desk-nav button').forEach((b) => b.classList.toggle('active', b.dataset.go === key));
    document.querySelectorAll('.navchip').forEach((c) => c.classList.toggle('active', c.dataset.go === key));
    if (push) history.replaceState({ key }, '', '#' + key);
    document.querySelector('.main').scrollTop = 0;
    window.scrollTo(0, 0);
    try { localStorage.setItem('wc26.screen', key); } catch (e) {}
  }

  // ---- menu ----
  const openMenu = () => document.body.classList.add('menu-open');
  const closeMenu = () => document.body.classList.remove('menu-open');

  function wire() {
    document.getElementById('openMenu').addEventListener('click', openMenu);
    document.getElementById('openMenuTab').addEventListener('click', openMenu);
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeMenu));
    // delegate go
    document.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-go]');
      if (!t) return;
      const inMenu = t.closest('.goalmenu');
      go(t.dataset.go);
      if (inMenu) setTimeout(closeMenu, 220); else closeMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('popstate', () => go((location.hash || '#home').slice(1), false));
  }

  // ---- install / iOS ----
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let deferred = null;

  function install() {
    const toast = document.getElementById('installToast');
    const scrim = document.getElementById('iosScrim');
    const sheet = document.getElementById('iosSheet');
    const dismissed = (() => { try { return localStorage.getItem('wc26.install') === 'no'; } catch (e) { return false; } })();
    const showIosSheet = () => { scrim.classList.add('show'); sheet.classList.add('show'); };
    const hideIosSheet = () => { scrim.classList.remove('show'); sheet.classList.remove('show'); };
    scrim.addEventListener('click', hideIosSheet);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferred = e;
      if (!dismissed && !standalone()) setTimeout(() => toast.classList.add('show'), 1600);
    });
    document.getElementById('installYes').addEventListener('click', async () => {
      toast.classList.remove('show');
      if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; }
      else if (isIOS()) showIosSheet();
    });
    document.getElementById('installNo').addEventListener('click', () => {
      toast.classList.remove('show');
      try { localStorage.setItem('wc26.install', 'no'); } catch (e) {}
    });
    // iOS gets no beforeinstallprompt — surface the sheet via the toast
    if (isIOS() && !standalone() && !dismissed) {
      const t = document.getElementById('installToast');
      t.querySelector('.tt span').textContent = 'Tap Install for a quick how-to';
      setTimeout(() => t.classList.add('show'), 1600);
    }
  }

  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  }

  // ---- boot ----
  shell();
  wire();
  install();
  registerSW();
  let start = 'home';
  try { start = (location.hash && location.hash.slice(1)) || localStorage.getItem('wc26.screen') || 'home'; } catch (e) {}
  go(start, true);
})();
