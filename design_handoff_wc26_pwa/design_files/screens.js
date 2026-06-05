/* WC26 Tracker — screen builders (sample data; swap for your API) */
window.Screens = (function () {
  const ic = UI.ic;

  const fixtures = [
    { c: 'GROUP A', a: 'MEX', b: 'USA', when: 'LIVE', t: "67'", sc: '1 – 1', state: 'live', pick: 'MEX' },
    { c: 'GROUP B', a: 'BRA', b: 'POR', when: 'Today', t: '21:00', pick: 'BRA' },
    { c: 'GROUP C', a: 'ARG', b: 'FRA', when: 'Today', t: '18:00', pick: 'Draw' },
    { c: 'GROUP D', a: 'ESP', b: 'GER', when: 'Tomorrow', t: '21:00', pick: 'ESP' },
    { c: 'GROUP A', a: 'CAN', b: 'CRO', when: 'Tomorrow', t: '18:00' },
    { c: 'GROUP E', a: 'ENG', b: 'NED', when: 'Sat', t: '20:00', pick: 'ENG' },
  ];

  function matchRow(m) {
    const right = m.state === 'live'
      ? `<span class="pill live">● ${m.t}</span>`
      : `<div class="meta"><div class="t">${m.t}</div><div class="s">${m.when}</div></div>`;
    const pick = m.pick ? `<span class="pill">${m.pick}</span>` : '';
    return `<div class="matchrow" data-go="matches">
      <div class="mc">${m.a}</div>
      <div class="names">${m.a} <span class="v">v</span> ${m.b}</div>
      ${pick}${right}</div>`;
  }

  function home() {
    const f = fixtures[0];
    const feature = `<div class="feature">
      <div class="stripes"></div>
      <span class="tag live">Live · Group A</span>
      <div class="scoreline">
        <div class="team"><div class="crest">MEX</div><span>Mexico</span></div>
        <div class="score">1 – 1<small>${f.t} · Estadio Azteca</small></div>
        <div class="team"><div class="crest">USA</div><span>USA</span></div>
      </div>
      <button class="cta" data-go="matches">${ic('field')} Watch &amp; predict next goal</button>
    </div>`;
    const picks = `<div class="card">${fixtures.slice(1, 5).map(matchRow).join('')}</div>`;
    const standings = `<div class="card" style="padding:4px 14px"><table class="standtbl">
      <tr><th>Group A</th><th>P</th><th>GD</th><th>Pts</th></tr>
      <tr class="q"><td><span class="rk">1</span>Mexico</td><td>3</td><td>+4</td><td>7</td></tr>
      <tr class="q"><td><span class="rk">2</span>USA</td><td>3</td><td>+1</td><td>5</td></tr>
      <tr><td><span class="rk">3</span>Canada</td><td>3</td><td>−1</td><td>3</td></tr>
      <tr><td><span class="rk">4</span>Croatia</td><td>3</td><td>−4</td><td>1</td></tr>
    </table></div>`;
    return `<div class="wrap">
      <div class="pagehd"><div class="eyebrow">Matchday 3 · June 2026</div><h1>Good morning, Alex.</h1><p>You're 4th in <b>Casa Pell*</b> — two correct picks today moves you up.</p></div>
      <div class="home-grid">
        <div>${feature}
          <div class="sec-title"><h2>Your picks today</h2><a data-go="picks">See all</a></div>
          ${picks}</div>
        <div>
          <div class="sec-title"><h2>Standings</h2><a data-go="bracket">Bracket</a></div>
          ${standings}
          <button class="cta ghost" style="margin-top:14px" data-go="leaderboard">${ic('trophy')} Open leaderboard</button>
        </div>
      </div>
      <div style="height:10px"></div>
    </div>`;
  }

  function matches() {
    const groups = ['All', 'Live', 'Today', 'Group stage', 'Knockout'];
    return `<div class="wrap">
      <div class="pagehd"><div class="eyebrow">Fixtures</div><h1>Matches</h1></div>
      <div class="chips">${groups.map((g, i) => `<div class="chip${i === 0 ? ' on' : ''}">${g}</div>`).join('')}</div>
      <div class="card" style="margin-top:6px">${fixtures.map(matchRow).join('')}</div>
    </div>`;
  }

  function bracket() {
    const tie = (a, sa, b, sb, wa) => `<div class="btie">
      <div class="bteam ${wa ? 'w' : 'l'}">${a}<span class="sc">${sa}</span></div>
      <div class="bteam ${wa ? 'l' : 'w'}">${b}<span class="sc">${sb}</span></div></div>`;
    return `<div class="wrap">
      <div class="pagehd"><div class="eyebrow">Knockout stage</div><h1>Bracket</h1><p>Tap a tie to set your prediction.</p></div>
      <div class="bracket">
        <div class="bcol"><h4>Round of 16</h4>${tie('MEX', '2', 'CRO', '0', 1)}${tie('BRA', '1', 'KOR', '0', 1)}${tie('ARG', '3', 'AUS', '1', 1)}${tie('ESP', '2', 'JPN', '1', 1)}</div>
        <div class="bcol"><h4>Quarter-finals</h4>${tie('MEX', '1', 'BRA', '2', 0)}${tie('ARG', '2', 'ESP', '2', 1)}</div>
        <div class="bcol"><h4>Semi-finals</h4>${tie('BRA', '0', 'ARG', '1', 0)}</div>
        <div class="bcol"><h4>Final</h4>${tie('ARG', '—', '?', '—', 1)}</div>
      </div>
    </div>`;
  }

  function picks() {
    const rows = fixtures.filter((f) => f.pick).map((m) => `<div class="matchrow">
      <div class="mc">${m.a}</div><div class="names">${m.a} <span class="v">v</span> ${m.b}</div>
      <span class="pill">Pick: ${m.pick}</span>
      <div class="meta"><div class="t">+${m.state === 'live' ? '3' : '0'}</div><div class="s">pts</div></div></div>`).join('');
    return `<div class="wrap">
      <div class="pagehd"><div class="eyebrow">Predictions</div><h1>My Picks</h1><p>142 points · 64% hit rate this round.</p></div>
      <div class="statgrid">
        <div class="stat"><b>142</b><span>Points</span></div>
        <div class="stat"><b>18</b><span>Correct</span></div>
        <div class="stat"><b>4th</b><span>In group</span></div>
      </div>
      <div class="sec-title"><h2>This round</h2><a data-go="matches">Make more</a></div>
      <div class="card">${rows}</div>
    </div>`;
  }

  function leaderboard() {
    const data = [
      { r: 1, n: 'Sofía R.', s: 'Casa Pell*', p: 188 },
      { r: 2, n: 'Marcus T.', s: 'Casa Pell*', p: 171 },
      { r: 3, n: 'Diego L.', s: 'Casa Pell*', p: 159 },
      { r: 4, n: 'You (Alex)', s: 'Casa Pell*', p: 142, me: 1 },
      { r: 5, n: 'Priya N.', s: 'Casa Pell*', p: 138 },
      { r: 6, n: 'Tom W.', s: 'Casa Pell*', p: 121 },
    ];
    return `<div class="wrap">
      <div class="pagehd"><div class="eyebrow">Group · Casa Pell*</div><h1>Leaderboard</h1></div>
      <div class="chips"><div class="chip on">My group</div><div class="chip">Friends</div><div class="chip">Global</div></div>
      <div class="card" style="margin-top:6px">${data.map((d) => `<div class="leadrow ${d.me ? 'me' : ''} ${d.r <= 3 ? 'top' : ''}">
        <div class="rk">${d.r}</div><div class="av">${d.n[0]}</div>
        <div class="who"><b>${d.n}</b><span>${d.s}</span></div>
        <div class="pts">${d.p}<small>PTS</small></div></div>`).join('')}</div>
    </div>`;
  }

  function profile() {
    const set = (icon, label) => `<div class="setrow"><div class="si">${ic(icon)}</div><b>${label}</b><div class="ch">${ic('chev')}</div></div>`;
    return `<div class="wrap">
      <div class="pagehd"><div class="eyebrow">Account</div><h1>Profile</h1></div>
      <div class="profhd"><div class="av">A</div><div class="who"><b>Alex Moreno</b><span>@alexm · Joined May 2026</span></div></div>
      <div class="statgrid">
        <div class="stat"><b>142</b><span>Points</span></div>
        <div class="stat"><b>2</b><span>Groups</span></div>
        <div class="stat"><b>64%</b><span>Hit rate</span></div>
      </div>
      <div class="card setlist">
        ${set('bell', 'Notifications')}
        ${set('trophy', 'My groups & invites')}
        ${set('field', 'Favourite team')}
        ${set('share', 'Share my bracket')}
        ${set('clock', 'Reminders')}
        ${set('user', 'Account settings')}
      </div>
      <div style="height:8px"></div>
    </div>`;
  }

  return { home, matches, bracket, picks, leaderboard, profile };
})();
