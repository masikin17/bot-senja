// Pasar Senja — the HUD: every number and menu the player sees.
//
// The HUD is plain DOM over the canvas (cheap, crisp, and it shows in the
// screenshots exactly as the player sees it). One createHud() owns all the
// elements by id; the game calls small setters, never touching the DOM
// itself. The buy menu is the economy made visible: four weapons with
// prices and stats, armour and a grenade, each with a hotkey.
//
// Elements (all defined in index.html): health bar + number, armour,
// ammo, timer, score, money, alive counts, kill feed, bomb status,
// compass strip, minimap canvas, crosshair, hitmarker, damage vignette
// and direction arc, round banner, buy menu, start/pause/round-end
// overlays, weapon name, grenade count, round label.

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    healthFill: $('health-fill'), healthNum: $('health-num'), armourNum: $('armour-num'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    timer: $('timer'), scoreSenja: $('score-senja'), scoreMalam: $('score-malam'),
    roundLabel: $('round-label'), money: $('money'), aliveSenja: $('alive-senja'),
    aliveMalam: $('alive-malam'), killfeed: $('killfeed'), bombStatus: $('bomb-status'),
    grenades: $('grenades'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    damageVignette: $('damage-vignette'), damageDir: $('damage-dir'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    playButton: $('play'), buyMenu: $('buy-menu'), buyList: $('buy-list'),
    compass: $('compass'), minimap: $('minimap'),
    bombBar: $('bomb-bar'), bombBarFill: $('bomb-bar-fill'), bombBarLabel: $('bomb-bar-label'),
  };
  const minimapCtx = els.minimap ? els.minimap.getContext('2d') : null;
  let hitTimer = 0;
  let bannerTimer = 0;

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(health, armour) {
      els.healthFill.style.width = `${Math.max(0, health)}%`;
      els.healthFill.classList.toggle('low', health <= 30);
      els.healthNum.textContent = String(Math.ceil(health));
      els.armourNum.textContent = armour > 0 ? `🛡 ${armour}` : '';
    },
    setAmmo(mag, reserve, reloading) {
      els.ammoMag.textContent = String(mag);
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.ammoMag.parentElement.classList.toggle('reloading', Boolean(reloading));
    },
    setWeapon(name, grenades) {
      els.weaponName.textContent = name;
      els.grenades.textContent = grenades > 0 ? `◉ ${grenades} granat` : '';
    },
    setTimer(seconds, phase) {
      els.timer.textContent = formatTime(seconds);
      els.timer.classList.toggle('urgent', phase === 'live' && seconds <= 15);
      els.timer.classList.toggle('freeze', phase === 'freeze');
    },
    setScore(senja, malam, round) {
      els.scoreSenja.textContent = String(senja);
      els.scoreMalam.textContent = String(malam);
      els.roundLabel.textContent = `RONDE ${round}`;
    },
    setMoney(money) {
      els.money.textContent = `$${money.toLocaleString('en-US')}`;
    },
    setAlive(senja, malam) {
      els.aliveSenja.textContent = '●'.repeat(Math.max(0, senja));
      els.aliveMalam.textContent = '●'.repeat(Math.max(0, malam));
    },
    setBomb(state, secondsLeft) {
      if (state === 'planted') {
        els.bombStatus.textContent = `💣 BOM MELEDAK ${Math.ceil(secondsLeft)} dtk — DEFUSE!`;
        els.bombStatus.className = 'bomb-planted';
      } else if (state === 'carried') {
        els.bombStatus.textContent = '💣 Kamu bawa bom — tanam di SITE A (tahan E)';
        els.bombStatus.className = 'bomb-carried';
      } else if (state === 'exploded') {
        els.bombStatus.textContent = '💥 BOM MELEDAK';
        els.bombStatus.className = 'bomb-planted';
      } else {
        els.bombStatus.textContent = '';
        els.bombStatus.className = '';
      }
    },
    setBombProgress(label, fraction) {
      if (!label) {
        els.bombBar.hidden = true;
        return;
      }
      els.bombBar.hidden = false;
      els.bombBarLabel.textContent = label;
      els.bombBarFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    killfeedAdd(text, team) {
      const item = document.createElement('div');
      item.className = `feed-item ${team ?? ''}`;
      item.textContent = text;
      els.killfeed.prepend(item);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      window.setTimeout(() => { item.classList.add('fade'); }, 4200);
      window.setTimeout(() => { item.remove(); }, 5000);
    },
    hitMarker(kill) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', Boolean(kill));
      window.clearTimeout(hitTimer);
      hitTimer = window.setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), kill ? 260 : 120);
    },
    setCrosshairSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    damageFrom(angleDeg) {
      els.damageVignette.classList.add('on');
      els.damageDir.style.setProperty('--rot', `${angleDeg}deg`);
      els.damageDir.classList.add('on');
      window.setTimeout(() => {
        els.damageVignette.classList.remove('on');
        els.damageDir.classList.remove('on');
      }, 450);
    },
    banner(title, sub, ms = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.hidden = false;
      window.clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => { els.banner.hidden = true; }, ms);
    },
    showOverlay(mode, data = {}) {
      const copy = {
        start: ['PASAR SENJA', 'Pasar malam, dua tim, satu bom. Menangkan 7 ronde sebelum Malam menguasainya. Klik untuk bermain.'],
        paused: ['JEDA', 'Klik untuk lanjut bermain.'],
        roundWin: [`RONDE ${data.round ?? ''} — SENJA MENANG`, data.reason ?? ''],
        roundLose: [`RONDE ${data.round ?? ''} — MALAM MENANG`, data.reason ?? ''],
        matchWin: ['SENJA MENANG!', `Skor akhir ${data.senja ?? 0} – ${data.malam ?? 0}. Pasar malam tetap milik Senja.`],
        matchLose: ['MALAM MENANG', `Skor akhir ${data.senja ?? 0} – ${data.malam ?? 0}. Pasar malam jatuh ke tangan Malam.`],
        end: ['PERMAINAN SELESAI', data.reason ?? ''],
      };
      const [title, text] = copy[mode] ?? copy.start;
      els.overlayTitle.textContent = title;
      els.overlayCopy.textContent = text;
      els.playButton.textContent = mode === 'start' ? 'Klik untuk bermain' : 'Lanjutkan';
      els.overlay.hidden = false;
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    onPlay(handler) {
      els.playButton.addEventListener('click', handler);
    },
    // The buy menu: rebuilt whenever money or phase changes while open.
    showBuy(weapons, money, armour, grenades) {
      els.buyMenu.hidden = false;
      els.buyList.innerHTML = '';
      const rows = [
        ...Object.values(weapons).map((w) => ({
          key: w.id === 'pistol' ? '1' : w.id === 'smg' ? '2' : w.id === 'rifle' ? '3' : '4',
          name: w.name, sub: `${w.kind} · ${w.damage} dmg · ${w.mag} peluru`,
          price: w.price, id: w.id,
        })),
        { key: '5', name: 'Rompi Baja', sub: 'Armor 100 — menyerap separuh damage', price: 650, id: 'armour' },
        { key: '6', name: 'Granat', sub: 'Ledakan area, 85 dmg', price: 300, id: 'grenade' },
      ];
      for (const row of rows) {
        const div = document.createElement('div');
        div.className = 'buy-row';
        div.dataset.buy = row.id;
        const afford = money >= row.price;
        div.innerHTML = `<span class="buy-key">${row.key}</span><span class="buy-name">${row.name}<small>${row.sub}</small></span><span class="buy-price ${afford ? '' : 'poor'}">$${row.price}</span>`;
        if (!afford) div.classList.add('cant');
        els.buyList.appendChild(div);
      }
      const foot = document.createElement('div');
      foot.className = 'buy-foot';
      foot.textContent = `Uangmu $${money} · Rompi: ${armour} · Granat: ${grenades} · Tutup dengan B`;
      els.buyList.appendChild(foot);
    },
    hideBuy() {
      els.buyMenu.hidden = true;
    },
    isBuyOpen() {
      return !els.buyMenu.hidden;
    },
    onBuy(handler) {
      els.buyList.addEventListener('click', (event) => {
        const row = event.target.closest('[data-buy]');
        if (row) handler(row.dataset.buy);
      });
    },
    // Compass: cardinal ticks + a marker for Site A, rotated by the
    // player's yaw so the strip always reads like a real compass.
    setCompass(yaw, siteAngle, siteDistance) {
      if (!els.compass) return;
      const deg = ((-yaw * 180) / Math.PI + 360) % 360;
      const marks = [];
      const dirs = [[0, 'U'], [45, 'TL'], [90, 'T'], [135, 'TG'], [180, 'S'], [225, 'BD'], [270, 'B'], [315, 'BL']];
      for (const [angle, label] of dirs) {
        let rel = ((angle - deg + 540) % 360) - 180;
        if (Math.abs(rel) < 55) marks.push(`<span style="left:${50 + rel * 0.9}%">${label}</span>`);
      }
      let siteRel = ((siteAngle - deg + 540) % 360) - 180;
      if (Math.abs(siteRel) < 55) {
        marks.push(`<span class="site-mark" style="left:${50 + siteRel * 0.9}%">◆ A ${Math.round(siteDistance)}m</span>`);
      }
      els.compass.innerHTML = `<span class="compass-centre">▲</span>${marks.join('')}`;
    },
    // Minimap: the yard from above — walls, crates, containers, stalls,
    // Site A, teammates (orange), enemies seen recently (red), the player
    // (white arrow). Drawn on a 148 px canvas, north up.
    drawMinimap(world, actors, player, seenEnemies) {
      if (!minimapCtx) return;
      const ctx = minimapCtx;
      const size = 148;
      const scale = size / 48;
      const toX = (x) => (x + 24) * scale;
      const toZ = (z) => (z + 20) * scale;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(20,24,38,0.88)';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#3a3630';
      ctx.fillRect(toX(-22), toZ(-18), 44 * scale, 36 * scale);
      for (const box of world.colliders) {
        if (box.height > 2.6) ctx.fillStyle = '#5d6b7a';
        else if (box.height > 1.4) ctx.fillStyle = '#7a5a38';
        else ctx.fillStyle = '#8a6f4d';
        ctx.fillRect(toX(box.minX), toZ(box.minZ), (box.maxX - box.minX) * scale, (box.maxZ - box.minZ) * scale);
      }
      ctx.strokeStyle = '#f0a830';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(toX(world.site.center.x), toZ(world.site.center.z), world.site.radius * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f0a830';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillText('A', toX(world.site.center.x) - 3, toZ(world.site.center.z) + 3);
      for (const actor of actors) {
        if (!actor.alive || actor.isPlayer) continue;
        const isSeen = actor.team === 'senja' || seenEnemies.has(actor.id);
        if (!isSeen) continue;
        ctx.fillStyle = actor.team === 'senja' ? '#f0a830' : '#ff5d5d';
        ctx.beginPath();
        ctx.arc(toX(actor.position.x), toZ(actor.position.z), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (player) {
        ctx.save();
        ctx.translate(toX(player.position.x), toZ(player.position.z));
        ctx.rotate(Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) + Math.PI / 2);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4.5, 5);
        ctx.lineTo(-4.5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },
  };
}
