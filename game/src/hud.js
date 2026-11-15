// hud.js — the DOM HUD. One job: mirror the sim state onto the page.
// Everything here is cheap DOM text/style writes; the crosshair gap, the
// plant ring and the damage arc are the only per-frame style changes.
const $ = (id) => document.getElementById(id);

export function initHud() {
  return {
    hpFill: $('hp-fill'), hpNum: $('hp-num'), armorFill: $('armor-fill'),
    money: $('money'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
    weaponName: $('weapon-name'), timer: $('timer'),
    scoreV: $('score-v'), scoreS: $('score-s'),
    aliveV: $('alive-v'), aliveS: $('alive-s'),
    feed: $('feed'), banner: $('banner'), bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'), cross: $('crosshair'),
    hitmark: $('hitmarker'), dmgVig: $('dmg-vig'), dmgDir: $('dmg-dir'),
    plantRing: $('plant-ring'), plantWrap: $('plant-wrap'),
    bombBar: $('bomb-bar'), bombFill: $('bomb-fill'),
    buy: $('buy'), buyList: $('buy-list'), buyMoney: $('buy-money'),
    overlay: $('overlay'), pause: $('pause'), end: $('end'),
    endTitle: $('end-title'), endStats: $('end-stats'),
    spectate: $('spectate'), chargeHint: $('charge-hint'),
    roundInfo: $('round-info'),
  };
}

// Per-frame mirror. G carries everything the HUD needs.
export function updateHud(H, G, dt) {
  const p = G.playerBot;
  const hp = Math.max(0, Math.ceil(p.hp));
  H.hpFill.style.width = `${hp}%`;
  H.hpFill.classList.toggle('low', hp <= 30);
  H.hpNum.textContent = hp;
  H.armorFill.style.width = `${Math.min(100, p.armor * 2)}%`;
  H.money.textContent = `$${G.money}`;
  const w = G.weapons[G.playerWeapon];
  const a = G.playerAmmo[G.playerWeapon];
  H.ammoMag.textContent = a ? a.mag : '—';
  H.ammoRes.textContent = a ? `/ ${a.reserve}` : '';
  H.weaponName.textContent = w.name;
  const m = G.match;
  const t = Math.max(0, Math.ceil(m.phase === 'freeze' ? m.phaseT : m.phase === 'planted' ? m.bombT : m.phaseT));
  H.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  H.timer.classList.toggle('urgent', t <= 10 && m.phase !== 'freeze');
  H.scoreV.textContent = m.scoreV; H.scoreS.textContent = m.scoreS;
  const vAlive = G.bots.filter((b) => b.team === 'V' && b.alive).length + (p.alive ? 1 : 0);
  const sAlive = G.bots.filter((b) => b.team === 'S' && b.alive).length;
  H.aliveV.textContent = vAlive; H.aliveS.textContent = sAlive;
  H.roundInfo.textContent = m.phase === 'freeze' ? `ROUND ${m.round} — BUY PHASE` : `ROUND ${m.round} · ${m.site === 'A' ? 'RELAY A' : 'RELAY B'}`;
  // Dynamic crosshair: gap grows with live spread.
  const gap = 4 + G.liveSpread * 900;
  H.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  // Plant progress ring (player planting) or bomb bar (planted).
  if (G.playerPlanting > 0) {
    H.plantWrap.hidden = false;
    H.plantRing.style.setProperty('--p', `${(G.playerPlanting / 3.5) * 100}`);
  } else H.plantWrap.hidden = true;
  if (m.planted && !m.over) {
    H.bombBar.hidden = false;
    H.bombFill.style.width = `${(m.bombT / 40) * 100}%`;
  } else H.bombBar.hidden = true;
  // Charge hint: carrier bot or the player holds it.
  const carrier = G.carrier && G.carrier.alive ? G.carrier : null;
  H.chargeHint.textContent = G.playerHasCharge
    ? 'You carry the charge — hold E inside a relay site to plant'
    : carrier ? `${carrier.name} carries the charge` : 'Charge on the ground — walk over it to pick it up';
  // Damage vignette fades on its own.
  const vig = parseFloat(H.dmgVig.style.opacity || 0);
  if (vig > 0) H.dmgVig.style.opacity = Math.max(0, vig - dt * 1.6);
  const dir = parseFloat(H.dmgDir.style.opacity || 0);
  if (dir > 0) H.dmgDir.style.opacity = Math.max(0, dir - dt * 1.2);
}

export function killfeed(H, killer, victim, headshot) {
  const el = document.createElement('div');
  el.className = 'feed-row';
  el.innerHTML = `<b class="${killer.team === 'V' ? 'tv' : 'ts'}">${esc(killer.name)}</b> ` +
    `<span class="hs">${headshot ? '◉' : '✕'}</span> ` +
    `<b class="${victim.team === 'V' ? 'tv' : 'ts'}">${esc(victim.name)}</b>`;
  H.feed.prepend(el);
  while (H.feed.children.length > 5) H.feed.lastChild.remove();
  if (window.__shotMode) return; // screenshot stills keep their feed
  setTimeout(() => el.classList.add('fade'), 4200);
  setTimeout(() => el.remove(), 5200);
}
function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export function banner(H, title, sub, kind) {
  clearTimeout(banner._t); // a stale hide-timer must never kill a later banner
  if (!title) { H.banner.hidden = true; return; }
  H.banner.hidden = false;
  H.bannerTitle.textContent = title;
  H.bannerSub.textContent = sub || '';
  H.banner.className = `banner ${kind || ''}`;
  if (window.__shotMode) return; // screenshot stills keep the banner up
  banner._t = setTimeout(() => { H.banner.hidden = true; }, 3200);
}

export function hitmarker(H, headshot, kill) {
  H.hitmark.classList.remove('on', 'kill', 'head');
  void H.hitmark.offsetWidth; // restart the CSS transition
  H.hitmark.classList.add('on', kill ? 'kill' : headshot ? 'head' : '');
  clearTimeout(hitmarker._t);
  hitmarker._t = setTimeout(() => H.hitmark.classList.remove('on'), 180);
}

export function damageFlash(H, fromPos, player) {
  H.dmgVig.style.opacity = 0.75;
  // Directional arc: angle of the attacker relative to the player's yaw.
  const dx = fromPos.x - player.pos.x, dz = fromPos.z - player.pos.z;
  const ang = Math.atan2(-dx, -dz) - player.yaw;
  H.dmgDir.style.transform = `translate(-50%,-50%) rotate(${(-ang * 180) / Math.PI}deg)`;
  H.dmgDir.style.opacity = 1;
}

export function renderBuy(H, G, items, msg) {
  H.buyList.innerHTML = items.map((it, i) => `
    <button class="buy-card ${it.owned ? 'owned' : ''} ${!it.afford && !it.owned ? 'poor' : ''}" data-w="${it.wid}">
      <span class="buy-key">${i + 1}</span>
      <span class="buy-name">${it.name}</span>
      <span class="buy-desc">${it.desc}</span>
      <span class="buy-price">${it.owned ? 'OWNED' : '$' + it.price}</span>
    </button>`).join('');
  H.buyMoney.textContent = `$${G.money}`;
  if (msg) {
    const m = document.createElement('div');
    m.className = 'buy-msg'; m.textContent = msg;
    H.buyList.appendChild(m);
  }
  H.buyList.querySelectorAll('.buy-card').forEach((el) => {
    el.addEventListener('click', () => G.buyItem(el.dataset.w));
  });
}

export function matchEnd(H, winner, scoreV, scoreS, kills, deaths, earned) {
  H.end.hidden = false;
  H.endTitle.textContent = winner === 'V' ? 'VANGUARD WINS THE MATCH' : 'SENTINEL WINS THE MATCH';
  H.endTitle.className = winner === 'V' ? 'tv' : 'ts';
  H.endStats.innerHTML =
    `Final score — Vanguard ${scoreV} : ${scoreS} Sentinel<br>` +
    `You: ${kills} kills · ${deaths} deaths · $${earned} earned<br>` +
    `<span class="muted">Press R to play again</span>`;
}
