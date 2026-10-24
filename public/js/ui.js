import * as THREE from 'three';
import { audio } from './audio.js';

export class UIManager {
  constructor() {
    this.initElements();
    this.setupListeners();
    this.scoreboardData = new Map();
  }

  initElements() {
    // Lobby elements
    this.lobbyOverlay = document.getElementById('lobby-overlay');
    this.usernameInput = document.getElementById('username-input');
    this.roomInput = document.getElementById('room-input');
    this.playBtn = document.getElementById('play-btn');
    this.weaponCards = document.querySelectorAll('.weapon-select-card');
    this.selectedWeaponClass = 'assault';

    // HUD elements
    this.hudOverlay = document.getElementById('hud-overlay');
    this.healthValue = document.getElementById('health-val');
    this.healthFill = document.getElementById('health-fill');
    this.ammoCurrent = document.getElementById('ammo-current');
    this.ammoMax = document.getElementById('ammo-max');
    this.reloadPrompt = document.getElementById('reload-prompt');
    this.reloadProgress = document.getElementById('reload-progress-bar');
    this.weaponName = document.getElementById('hud-weapon-name');
    this.weaponType = document.getElementById('hud-weapon-type');
    this.crosshair = document.getElementById('crosshair');
    this.sniperScope = document.getElementById('sniper-scope');
    this.hitmarker = document.getElementById('hitmarker');
    this.damageFlash = document.getElementById('damage-flash');
    this.killFeed = document.getElementById('kill-feed');
    this.killBanner = document.getElementById('kill-banner');
    this.floatingDamageContainer = document.getElementById('floating-damage-container');

    // Scoreboard
    this.scoreboard = document.getElementById('scoreboard-overlay');
    this.scoreboardBody = document.getElementById('scoreboard-table-body');

    // Elimination overlay
    this.eliminationOverlay = document.getElementById('elimination-overlay');
    this.elimKillerName = document.getElementById('elim-killer-name');
    this.elimHeadshotBadge = document.getElementById('elim-headshot-badge');
    this.elimCountdown = document.getElementById('elim-countdown');

    // Audio toggle
    this.audioToggleBtn = document.getElementById('audio-toggle-btn');
  }

  setupListeners() {
    // Generate fun default name
    const defaultNames = ['CyberGhost', 'NeonViper', 'ShadowX', 'BlazeRogue', 'ApexHunter', 'Valkyrie'];
    if (this.usernameInput && !this.usernameInput.value) {
      this.usernameInput.value = defaultNames[Math.floor(Math.random() * defaultNames.length)];
    }

    // Weapon select card click
    this.weaponCards.forEach(card => {
      card.addEventListener('click', () => {
        this.weaponCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedWeaponClass = card.getAttribute('data-weapon');
        audio.playReload();
      });
    });

    // Scoreboard toggle with Tab key
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.scoreboard.classList.remove('hidden');
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.scoreboard.classList.add('hidden');
      }
    });

    // Audio toggle button
    if (this.audioToggleBtn) {
      this.audioToggleBtn.addEventListener('click', () => {
        const isMuted = audio.toggleMute();
        this.audioToggleBtn.textContent = isMuted ? '🔇 Audio: OFF' : '🔊 Audio: ON';
      });
    }
  }

  onPlayClicked(callback) {
    this.playBtn.addEventListener('click', () => {
      const username = this.usernameInput.value.trim() || 'Operative';
      const rawRoom = this.roomInput ? this.roomInput.value.trim() : '';
      const roomId = (rawRoom || 'GLOBAL-ARENA').toUpperCase();
      audio.init();
      audio.ensureContext();
      this.lobbyOverlay.classList.add('hidden');
      this.hudOverlay.classList.remove('hidden');
      callback({
        username,
        weaponClass: this.selectedWeaponClass,
        roomId
      });
    });
  }

  updateHealth(current, max = 100, isRegenerating = false) {
    const targetVal = Math.max(0, Math.min(max, Math.round(current)));
    const pct = Math.max(0, Math.min(100, (targetVal / max) * 100));
    this.healthFill.style.width = `${pct}%`;

    // Smooth numerical count-up/down animation
    if (this.currentDisplayHealth === undefined) {
      this.currentDisplayHealth = targetVal;
    }

    if (this.healthNumberInterval) {
      clearInterval(this.healthNumberInterval);
    }

    this.healthNumberInterval = setInterval(() => {
      if (this.currentDisplayHealth < targetVal) {
        this.currentDisplayHealth += Math.ceil((targetVal - this.currentDisplayHealth) / 2);
        if (this.currentDisplayHealth > targetVal) this.currentDisplayHealth = targetVal;
      } else if (this.currentDisplayHealth > targetVal) {
        this.currentDisplayHealth -= Math.ceil((this.currentDisplayHealth - targetVal) / 2);
        if (this.currentDisplayHealth < targetVal) this.currentDisplayHealth = targetVal;
      }
      this.healthValue.textContent = this.currentDisplayHealth;
      if (this.currentDisplayHealth === targetVal) {
        clearInterval(this.healthNumberInterval);
        this.healthNumberInterval = null;
      }
    }, 30);

    // Subtle glowing cyan/green healing pulse effect on the health bar while regenerating
    if (isRegenerating && targetVal < max) {
      this.healthFill.classList.add('healing');
      this.healthValue.classList.add('healing');
    } else {
      this.healthFill.classList.remove('healing');
      this.healthValue.classList.remove('healing');
    }

    if (pct < 30) {
      this.healthFill.classList.add('danger');
      this.healthValue.classList.add('pulse');
    } else {
      this.healthFill.classList.remove('danger');
      this.healthValue.classList.remove('pulse');
    }
  }

  updateAmmo(current, max) {
    this.ammoCurrent.textContent = current;
    this.ammoMax.textContent = max;

    if (current <= 0) {
      this.reloadPrompt.classList.remove('hidden');
    } else {
      this.reloadPrompt.classList.add('hidden');
    }
  }

  updateWeaponCard(stats) {
    if (this.weaponName) this.weaponName.textContent = stats.name;
    if (this.weaponType) this.weaponType.textContent = stats.type;
  }

  startReloadAnimation(durationMs) {
    this.reloadPrompt.classList.remove('hidden');
    this.reloadPrompt.textContent = 'RELOADING...';
    this.reloadProgress.style.transition = `width ${durationMs}ms linear`;
    this.reloadProgress.style.width = '100%';

    setTimeout(() => {
      this.reloadPrompt.classList.add('hidden');
      this.reloadPrompt.textContent = 'PRESS [R] TO RELOAD';
      this.reloadProgress.style.transition = 'none';
      this.reloadProgress.style.width = '0%';
    }, durationMs);
  }

  setAds(isADS, hasScopeOverlay) {
    if (isADS && hasScopeOverlay) {
      this.sniperScope.classList.remove('hidden');
      this.crosshair.classList.add('hidden');
    } else {
      this.sniperScope.classList.add('hidden');
      this.crosshair.classList.remove('hidden');
      if (isADS) {
        this.crosshair.classList.add('ads-tight');
      } else {
        this.crosshair.classList.remove('ads-tight');
      }
    }
  }

  triggerCrosshairRecoil() {
    this.crosshair.classList.add('expanded');
    clearTimeout(this.crosshairRecoilTimeout);
    this.crosshairRecoilTimeout = setTimeout(() => {
      this.crosshair.classList.remove('expanded');
    }, 110);
  }

  showHitmarker(isHeadshot = false) {
    this.hitmarker.classList.remove('hidden', 'hit-headshot', 'hit-body');
    this.hitmarker.classList.add(isHeadshot ? 'hit-headshot' : 'hit-body');

    // Quick burst animation
    clearTimeout(this.hitmarkerTimeout);
    this.hitmarkerTimeout = setTimeout(() => {
      this.hitmarker.classList.add('hidden');
    }, 160);
  }

  triggerDamageFlash() {
    this.damageFlash.classList.remove('hidden');
    this.damageFlash.style.opacity = '1';
    setTimeout(() => {
      this.damageFlash.style.opacity = '0';
      setTimeout(() => {
        this.damageFlash.classList.add('hidden');
      }, 200);
    }, 60);
  }

  showKillBanner(victimName, isHeadshot) {
    this.killBanner.textContent = isHeadshot ? `🎯 HEADSHOT ELIMINATION: ${victimName}` : `ELIMINATED ${victimName}`;
    this.killBanner.className = isHeadshot ? 'kill-banner headshot' : 'kill-banner';
    this.killBanner.classList.remove('hidden');

    clearTimeout(this.killBannerTimeout);
    this.killBannerTimeout = setTimeout(() => {
      this.killBanner.classList.add('hidden');
    }, 2500);
  }

  addKillFeedKill(killer, victim, weaponClass, isHeadshot) {
    const item = document.createElement('div');
    item.className = 'kill-feed-item';

    const weaponIcon = isHeadshot ? '🎯' : (weaponClass === 'sniper' ? '⚡' : '💥');
    item.innerHTML = `
      <span class="kf-killer">${escapeHTML(killer)}</span>
      <span class="kf-icon">${weaponIcon}</span>
      <span class="kf-victim">${escapeHTML(victim)}</span>
      ${isHeadshot ? '<span class="kf-badge">HEADSHOT</span>' : ''}
    `;

    this.killFeed.prepend(item);
    setTimeout(() => {
      item.classList.add('fade-out');
      setTimeout(() => item.remove(), 600);
    }, 4500);
  }

  addKillFeedMessage(msg, type = 'info') {
    const item = document.createElement('div');
    item.className = `kill-feed-item system-msg ${type}`;
    item.textContent = msg;
    this.killFeed.prepend(item);
    setTimeout(() => {
      item.classList.add('fade-out');
      setTimeout(() => item.remove(), 600);
    }, 4000);
  }

  spawnFloatingDamage(hitPointWorld, damage, isHeadshot, camera) {
    const wp = new THREE.Vector3(hitPointWorld.x, hitPointWorld.y, hitPointWorld.z);
    wp.project(camera);

    // If point is behind camera, don't show
    if (wp.z > 1) return;

    const screenX = (wp.x * 0.5 + 0.5) * window.innerWidth;
    const screenY = (-wp.y * 0.5 + 0.5) * window.innerHeight;

    const el = document.createElement('div');
    el.className = isHeadshot ? 'floating-dmg crit' : 'floating-dmg';
    el.textContent = isHeadshot ? `-${damage} CRIT!` : `-${damage}`;
    el.style.left = `${screenX + (Math.random() - 0.5) * 20}px`;
    el.style.top = `${screenY + (Math.random() - 0.5) * 20}px`;

    this.floatingDamageContainer.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  showEliminationScreen(killerName, isHeadshot, respawnDelayMs) {
    this.eliminationOverlay.classList.remove('hidden');
    this.elimKillerName.textContent = killerName;

    if (isHeadshot) {
      this.elimHeadshotBadge.classList.remove('hidden');
    } else {
      this.elimHeadshotBadge.classList.add('hidden');
    }

    let timeLeft = Math.ceil(respawnDelayMs / 1000);
    this.elimCountdown.textContent = timeLeft;

    const interval = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        clearInterval(interval);
      } else {
        this.elimCountdown.textContent = timeLeft;
      }
    }, 1000);
  }

  hideEliminationScreen() {
    this.eliminationOverlay.classList.add('hidden');
  }

  updateScoreboardEntry(player) {
    this.scoreboardData.set(player.id, player);
    this.renderScoreboard();
  }

  removeScoreboardEntry(id) {
    this.scoreboardData.delete(id);
    this.renderScoreboard();
  }

  renderScoreboard() {
    if (!this.scoreboardBody) return;
    const sorted = Array.from(this.scoreboardData.values()).sort((a, b) => (b.score || 0) - (a.score || 0));

    this.scoreboardBody.innerHTML = '';
    sorted.forEach((p, idx) => {
      const row = document.createElement('tr');
      const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(1) : p.kills;
      row.innerHTML = `
        <td>#${idx + 1}</td>
        <td style="color: ${p.color || '#00f0ff'}; font-weight: bold;">${escapeHTML(p.username)}</td>
        <td>${p.kills || 0}</td>
        <td>${p.deaths || 0}</td>
        <td>${kd}</td>
        <td style="color: #f59e0b; font-weight: bold;">${p.score || 0}</td>
      `;
      this.scoreboardBody.appendChild(row);
    });
  }

  addChatMessage(sender, color, text) {
    const chatContainer = document.getElementById('chat-messages');
    if (!chatContainer) return;
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg';
    msgEl.innerHTML = `<span style="color: ${color || '#00f0ff'}; font-weight: bold;">${escapeHTML(sender)}:</span> ${escapeHTML(text)}`;
    chatContainer.appendChild(msgEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    setTimeout(() => {
      msgEl.classList.add('fade');
    }, 7000);
  }
}

function escapeHTML(str) {
  return (str || '').replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
