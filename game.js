(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const W = 960;
  const H = 600;
  const TAU = Math.PI * 2;
  const BENCH_Y = 542;
  const CATCH_Y = 378;
  const CATCH_HALF = 40;
  const PLAYER_MIN = 80;
  const PLAYER_MAX = W - 80;
  const MAX_LIVES = 3;
  const BREW_MAX = 12;
  const RUSH_TIME = 6.5;
  const BEST_KEY = 'lobsterLab.best';
  const MUTE_KEY = 'lobsterLab.muted';
  const FONT = 'ui-rounded, "Avenir Next", "Trebuchet MS", "Segoe UI", sans-serif';
  const REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const DROP_INFO = {
    shrimp: { points: 10, brew: 1, color: '#ff7a5c', glow: 'rgba(255, 122, 92, 0.55)' },
    kelp: { points: 15, brew: 1, color: '#62e6a8', glow: 'rgba(98, 230, 168, 0.5)' },
    pearl: { points: 50, brew: 2, color: '#a8ecff', glow: 'rgba(168, 236, 255, 0.7)' },
    sludge: { points: 0, brew: 0, color: '#b06bff', glow: 'rgba(176, 107, 255, 0.6)' },
  };

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const menuScreen = document.getElementById('menuScreen');
  const pauseScreen = document.getElementById('pauseScreen');
  const overScreen = document.getElementById('overScreen');
  const screens = [menuScreen, pauseScreen, overScreen];

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const levelEl = document.getElementById('level');
  const livesEl = document.getElementById('lives');
  const lifeEls = Array.from(document.querySelectorAll('.life'));
  const brewBar = document.getElementById('brewBar');
  const brewTrack = document.getElementById('brewTrack');
  const brewFill = document.getElementById('brewFill');
  const brewLabel = document.getElementById('brewLabel');
  const comboEl = document.getElementById('combo');
  const pauseBtn = document.getElementById('pauseBtn');
  const soundBtn = document.getElementById('soundBtn');
  const statusLive = document.getElementById('statusLive');

  const startBtn = document.getElementById('startBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const pauseRestartBtn = document.getElementById('pauseRestartBtn');
  const againBtn = document.getElementById('againBtn');
  const menuBtn = document.getElementById('menuBtn');
  const leftBtn = document.getElementById('leftBtn');
  const rightBtn = document.getElementById('rightBtn');

  const finalScoreEl = document.getElementById('finalScore');
  const finalBestEl = document.getElementById('finalBest');
  const finalCaughtEl = document.getElementById('finalCaught');
  const finalLevelEl = document.getElementById('finalLevel');
  const newBestEl = document.getElementById('newBest');

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------

  function readStore(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (error) {
      /* Storage can be unavailable in private modes. The game still works. */
    }
  }

  function loadBest() {
    const value = Number.parseInt(readStore(BEST_KEY, '0'), 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function loadMuted() {
    return readStore(MUTE_KEY, '0') === '1';
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    mode: 'menu', // menu | playing | paused | gameover
    score: 0,
    best: loadBest(),
    lives: MAX_LIVES,
    brew: 0,
    streak: 0,
    caught: 0,
    elapsed: 0,
    level: 1,
    rush: 0,
    drops: [],
    particles: [],
    toasts: [],
    bubbles: [],
    spawnTimer: 0.9,
    shake: 0,
    flash: 0,
    flashColor: 'rgba(255, 209, 102,',
    time: 0,
    player: { x: W / 2, targetX: W / 2, tilt: 0 },
    muted: loadMuted(),
  };

  const keys = { left: false, right: false };

  let dpr = 1;
  let lastFrame = performance.now();

  // ---------------------------------------------------------------------------
  // Tiny WebAudio synth (no assets, no autoplay)
  // ---------------------------------------------------------------------------

  const Sound = (() => {
    let audio = null;
    let enabled = !state.muted;

    function ensure() {
      if (!enabled) return null;
      if (!audio) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return null;
        audio = new AudioCtor();
      }
      if (audio.state === 'suspended') {
        audio.resume().catch(() => {});
      }
      return audio;
    }

    function tone(frequency, duration, type, volume, slideTo, delay) {
      const ac = ensure();
      if (!ac) return;
      const start = ac.currentTime + (delay || 0);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(frequency, start);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(ac.destination);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    }

    return {
      init() {
        ensure();
      },
      setEnabled(value) {
        enabled = value;
        if (enabled) ensure();
      },
      click() {
        tone(460, 0.07, 'triangle', 0.028, 660);
      },
      catchIngredient(type) {
        if (type === 'pearl') {
          tone(880, 0.13, 'sine', 0.05);
          tone(1320, 0.2, 'sine', 0.032, null, 0.07);
        } else if (type === 'kelp') {
          tone(520, 0.09, 'triangle', 0.04, 720);
        } else {
          tone(660, 0.08, 'triangle', 0.04, 900);
        }
      },
      damage() {
        tone(165, 0.26, 'sawtooth', 0.055, 58);
        tone(92, 0.3, 'square', 0.026, 44, 0.02);
      },
      rush() {
        [523, 659, 784, 1047].forEach((frequency, index) => {
          tone(frequency, 0.2, 'triangle', 0.045, null, index * 0.075);
        });
      },
      level() {
        tone(720, 0.1, 'sine', 0.03, 940);
      },
      gameOver() {
        [392, 330, 262, 196].forEach((frequency, index) => {
          tone(frequency, 0.28, 'triangle', 0.045, null, index * 0.13);
        });
      },
      miss() {
        tone(220, 0.06, 'sine', 0.012, 170);
      },
    };
  })();

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function setText(element, text) {
    if (element && element.textContent !== text) {
      element.textContent = text;
    }
  }

  function announce(message) {
    if (statusLive) statusLive.textContent = message;
  }

  function makeBubble(anywhere) {
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + 10 + Math.random() * 40,
      r: 1.5 + Math.random() * 4.5,
      speed: 12 + Math.random() * 34,
      drift: 3 + Math.random() * 10,
      driftSpeed: 0.5 + Math.random() * 1.4,
      phase: Math.random() * TAU,
      alpha: 0.06 + Math.random() * 0.2,
    };
  }

  for (let i = 0; i < 26; i += 1) {
    state.bubbles.push(makeBubble(true));
  }

  // ---------------------------------------------------------------------------
  // HUD + screens
  // ---------------------------------------------------------------------------

  function comboMultiplier() {
    return 1 + Math.min(3, Math.floor(state.streak / 4));
  }

  function syncHud() {
    setText(scoreEl, state.score.toLocaleString('en-US'));
    setText(bestEl, state.best.toLocaleString('en-US'));
    setText(levelEl, String(state.level));

    const totalMultiplier = comboMultiplier() * (state.rush > 0 ? 2 : 1);
    setText(comboEl, '×' + totalMultiplier);
    comboEl.classList.toggle('hot', totalMultiplier > 1);

    const rushActive = state.rush > 0;
    const progress = rushActive ? state.rush / RUSH_TIME : state.brew / BREW_MAX;
    brewFill.style.width = clamp(progress, 0, 1) * 100 + '%';
    brewBar.classList.toggle('rush', rushActive);
    setText(brewLabel, rushActive ? 'Bubble rush' : 'Brew');
    if (brewTrack) {
      brewTrack.setAttribute('aria-valuenow', String(Math.round(clamp(progress, 0, 1) * BREW_MAX)));
    }

    lifeEls.forEach((element, index) => {
      element.classList.toggle('lost', index >= state.lives);
    });
    livesEl.setAttribute('aria-label', state.lives + ' beaker' + (state.lives === 1 ? '' : 's') + ' left');
  }

  function syncModeUi() {
    const canPause = state.mode === 'playing' || state.mode === 'paused';
    pauseBtn.disabled = !canPause;
    setText(pauseBtn, state.mode === 'paused' ? 'Resume' : 'Pause');
    setText(soundBtn, state.muted ? 'Sound: off' : 'Sound: on');
    soundBtn.setAttribute('aria-pressed', String(!state.muted));
    soundBtn.setAttribute('aria-label', state.muted ? 'Sound is off. Turn sound on' : 'Sound is on. Mute sound');
  }

  function showScreen(screen) {
    overlay.classList.remove('is-hidden');
    screens.forEach((item) => item.classList.toggle('is-hidden', item !== screen));
  }

  function hideOverlay() {
    overlay.classList.add('is-hidden');
  }

  function blurFocus() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------

  function resetRun() {
    state.score = 0;
    state.lives = MAX_LIVES;
    state.brew = 0;
    state.streak = 0;
    state.caught = 0;
    state.elapsed = 0;
    state.level = 1;
    state.rush = 0;
    state.drops.length = 0;
    state.particles.length = 0;
    state.toasts.length = 0;
    state.spawnTimer = 0.9;
    state.shake = 0;
    state.flash = 0;
    state.player.x = W / 2;
    state.player.targetX = W / 2;
    state.player.tilt = 0;
    keys.left = false;
    keys.right = false;
    leftBtn.classList.remove('active');
    rightBtn.classList.remove('active');
  }

  function startGame() {
    resetRun();
    state.mode = 'playing';
    hideOverlay();
    syncModeUi();
    syncHud();
    Sound.init();
    Sound.click();
    blurFocus();
    announce('Experiment started. Move the lobster with the arrow keys or pointer.');
  }

  function showMenu() {
    resetRun();
    state.mode = 'menu';
    showScreen(menuScreen);
    syncModeUi();
    syncHud();
    Sound.click();
    announce('Lobster Lab title screen. Press start brewing to play.');
  }

  function pauseGame() {
    if (state.mode !== 'playing') return;
    state.mode = 'paused';
    keys.left = false;
    keys.right = false;
    showScreen(pauseScreen);
    syncModeUi();
    announce('Experiment paused.');
    requestAnimationFrame(() => resumeBtn.focus({ preventScroll: true }));
  }

  function resumeGame() {
    if (state.mode !== 'paused') return;
    state.mode = 'playing';
    hideOverlay();
    syncModeUi();
    blurFocus();
    lastFrame = performance.now();
    announce('Experiment resumed.');
  }

  function togglePause() {
    if (state.mode === 'playing') pauseGame();
    else if (state.mode === 'paused') resumeGame();
  }

  function endGame() {
    if (state.mode === 'gameover') return;
    state.mode = 'gameover';
    state.rush = 0;
    state.brew = 0;
    state.shake = 0;
    state.flash = 0;
    keys.left = false;
    keys.right = false;
    leftBtn.classList.remove('active');
    rightBtn.classList.remove('active');

    const isNewBest = state.score > state.best;
    if (isNewBest) {
      state.best = state.score;
      writeStore(BEST_KEY, state.best);
    }

    setText(finalScoreEl, state.score.toLocaleString('en-US'));
    setText(finalBestEl, state.best.toLocaleString('en-US'));
    setText(finalCaughtEl, String(state.caught));
    setText(finalLevelEl, String(state.level));
    newBestEl.classList.toggle('is-hidden', !isNewBest);

    showScreen(overScreen);
    syncModeUi();
    syncHud();
    Sound.gameOver();
    announce(
      'Experiment over. Score ' + state.score + '. Best ' + state.best + '. Level ' + state.level + '.'
    );
    requestAnimationFrame(() => againBtn.focus({ preventScroll: true }));
  }

  function toggleSound() {
    state.muted = !state.muted;
    writeStore(MUTE_KEY, state.muted ? '1' : '0');
    Sound.setEnabled(!state.muted);
    if (!state.muted) Sound.click();
    syncModeUi();
    announce(state.muted ? 'Sound off.' : 'Sound on.');
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  function pointerToX(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return W / 2;
    return ((event.clientX - rect.left) / rect.width) * W;
  }

  canvas.addEventListener('pointermove', (event) => {
    if (state.mode !== 'playing') return;
    state.player.targetX = clamp(pointerToX(event), PLAYER_MIN, PLAYER_MAX);
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (state.mode !== 'playing') return;
    event.preventDefault();
    state.player.targetX = clamp(pointerToX(event), PLAYER_MIN, PLAYER_MAX);
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
    }
  });

  window.addEventListener('keydown', (event) => {
    const key = event.key;
    const targetTag = event.target && event.target.tagName ? event.target.tagName : '';
    const onControl = targetTag === 'BUTTON' || targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT';

    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === ' ' || key === 'Spacebar') {
      if (!onControl) event.preventDefault();
    }

    if (key === 'ArrowLeft' || key === 'a' || key === 'A') keys.left = true;
    if (key === 'ArrowRight' || key === 'd' || key === 'D') keys.right = true;

    if (onControl && (key === ' ' || key === 'Enter')) return;

    if ((key === 'p' || key === 'P' || key === 'Escape') && !event.repeat) {
      togglePause();
    }
    if ((key === 'm' || key === 'M') && !event.repeat) {
      toggleSound();
    }
    if ((key === ' ' || key === 'Enter') && !event.repeat) {
      if (state.mode === 'menu' || state.mode === 'gameover') startGame();
      else if (state.mode === 'paused') resumeGame();
    }
  });

  window.addEventListener('keyup', (event) => {
    const key = event.key;
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') keys.left = false;
    if (key === 'ArrowRight' || key === 'd' || key === 'D') keys.right = false;
  });

  window.addEventListener('blur', () => {
    keys.left = false;
    keys.right = false;
    if (state.mode === 'playing') pauseGame();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') pauseGame();
  });

  startBtn.addEventListener('click', startGame);
  againBtn.addEventListener('click', startGame);
  pauseRestartBtn.addEventListener('click', startGame);
  resumeBtn.addEventListener('click', resumeGame);
  pauseBtn.addEventListener('click', togglePause);
  soundBtn.addEventListener('click', toggleSound);
  menuBtn.addEventListener('click', showMenu);

  function bindHoldButton(button, direction) {
    const press = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      keys[direction] = true;
      button.classList.add('active');
      if (button.setPointerCapture) {
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          /* ignore */
        }
      }
    };
    const release = () => {
      keys[direction] = false;
      button.classList.remove('active');
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  bindHoldButton(leftBtn, 'left');
  bindHoldButton(rightBtn, 'right');

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  function updateBubbles(dt) {
    const boost = state.rush > 0 ? 2.1 : 1;
    for (let i = 0; i < state.bubbles.length; i += 1) {
      const bubble = state.bubbles[i];
      bubble.y -= bubble.speed * boost * dt;
      bubble.x += Math.sin(state.time * bubble.driftSpeed + bubble.phase) * bubble.drift * dt;
      if (bubble.y + bubble.r < -12) {
        state.bubbles[i] = makeBubble(false);
      }
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      particle.vy += 620 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
  }

  function updateToasts(dt) {
    for (let i = state.toasts.length - 1; i >= 0; i -= 1) {
      const toast = state.toasts[i];
      toast.life -= dt;
      toast.y += toast.vy * dt;
      toast.vy *= 1 - Math.min(1, dt * 2.4);
      if (toast.life <= 0) {
        state.toasts.splice(i, 1);
      }
    }
  }

  function updatePlayer(dt) {
    const player = state.player;
    const direction = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);

    if (direction !== 0) {
      player.targetX = clamp(player.targetX + direction * 820 * dt, PLAYER_MIN, PLAYER_MAX);
    }

    player.x += (player.targetX - player.x) * Math.min(1, dt * 20);
    player.x = clamp(player.x, PLAYER_MIN, PLAYER_MAX);
    player.tilt += ((player.targetX - player.x) * 0.0028 - player.tilt) * Math.min(1, dt * 12);
  }

  function pickType() {
    const roll = Math.random();

    if (state.elapsed < 5) {
      return roll < 0.6 ? 'shrimp' : 'kelp';
    }

    if (state.rush > 0) {
      if (roll < 0.16) return 'pearl';
      return roll < 0.58 ? 'shrimp' : 'kelp';
    }

    if (roll < 0.06) return 'pearl';
    if (roll < 0.24) return 'sludge';
    return roll < 0.62 ? 'shrimp' : 'kelp';
  }

  function spawnDrop(forceType, forceX, forceY) {
    const type = forceType || pickType();
    const x = forceX === undefined ? 58 + Math.random() * (W - 116) : clamp(forceX, 40, W - 40);
    const y = forceY === undefined ? -34 : forceY;
    const base = state.rush > 0 ? 238 : 166;
    const ramp = Math.min(175, state.elapsed * 2.1);

    state.drops.push({
      type,
      x,
      y,
      prevY: y,
      vy: base + ramp + Math.random() * 52,
      vx: (Math.random() - 0.5) * 18,
      sway: 10 + Math.random() * 18,
      phase: Math.random() * TAU,
      rot: Math.random() * TAU,
      spin: (Math.random() - 0.5) * 1.3,
      r: type === 'sludge' ? 19 : type === 'pearl' ? 16 : 18,
    });
  }

  function nextSpawnDelay() {
    const levelBoost = Math.min(0.26, (state.level - 1) * 0.035);
    const base = state.rush > 0 ? 0.4 : 0.8;
    const minimum = state.rush > 0 ? 0.24 : 0.32;
    return Math.max(minimum, base - levelBoost) * (0.78 + Math.random() * 0.55);
  }

  function burst(x, y, color, count, power) {
    const amount = Math.max(2, Math.round(count * (REDUCE_MOTION ? 0.4 : 1)));
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * TAU;
      const speed = power * (0.35 + Math.random() * 0.75);
      const life = 0.35 + Math.random() * 0.5;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        r: 1.5 + Math.random() * 3.2,
        color,
        life,
        maxLife: life,
      });
    }
  }

  function addToast(x, y, text, color, life, size) {
    state.toasts.push({
      x,
      y,
      text,
      color,
      life: life || 1,
      maxLife: life || 1,
      size: size || 20,
      vy: -32,
    });
  }

  function comboText() {
    const multiplier = comboMultiplier();
    return multiplier > 1 ? 'COMBO ×' + multiplier : '';
  }

  function startRush() {
    state.rush = RUSH_TIME;
    state.brew = 0;
    state.flash = 0.55;
    state.flashColor = 'rgba(255, 209, 102,';
    state.shake = 6;

    for (let i = state.drops.length - 1; i >= 0; i -= 1) {
      const drop = state.drops[i];
      if (drop.type === 'sludge') {
        burst(drop.x, drop.y, '#b06bff', 10, 170);
        state.drops.splice(i, 1);
      }
    }

    addToast(W / 2, 286, 'BUBBLE RUSH!', '#ffd166', 1.7, 34);
    const combo = comboText();
    if (combo) addToast(W / 2, 252, combo, '#ffd166', 1.2, 17);
    Sound.rush();
    announce('Bubble Rush! Double points for a few seconds.');
    syncHud();
  }

  function catchDrop(drop, index) {
    state.drops.splice(index, 1);

    if (drop.type === 'sludge') {
      damage(drop);
      return;
    }

    const info = DROP_INFO[drop.type];
    state.caught += 1;
    state.streak += 1;

    const multiplier = comboMultiplier() * (state.rush > 0 ? 2 : 1);
    const points = info.points * multiplier;
    state.score += points;

    if (state.rush <= 0) {
      state.brew = Math.min(BREW_MAX, state.brew + info.brew);
    }

    burst(drop.x, CATCH_Y + 8, info.color, drop.type === 'pearl' ? 16 : 10, drop.type === 'pearl' ? 230 : 170);
    addToast(drop.x, CATCH_Y - 18, '+' + points, info.color, 0.9, drop.type === 'pearl' ? 28 : 20);

    if (drop.type === 'pearl') {
      addToast(drop.x, CATCH_Y - 52, 'PEARL!', '#ffffff', 1.05, 15);
    }

    Sound.catchIngredient(drop.type);

    if (state.brew >= BREW_MAX && state.rush <= 0) {
      startRush();
    }

    syncHud();
  }

  function damage(drop) {
    state.lives -= 1;
    state.streak = 0;
    state.shake = 16;
    state.flash = 0.55;
    state.flashColor = 'rgba(176, 107, 255,';
    burst(drop.x, CATCH_Y + 4, '#b06bff', 18, 240);
    addToast(drop.x, 330, 'CONTAMINATED!', '#d8a4ff', 1.2, 20);
    Sound.damage();

    if (state.lives <= 0) {
      endGame();
    } else {
      announce('Toxic sludge! ' + state.lives + ' beaker' + (state.lives === 1 ? '' : 's') + ' left.');
    }

    syncHud();
  }

  function missDrop(drop, index) {
    state.drops.splice(index, 1);

    if (drop.type === 'sludge') {
      burst(drop.x, BENCH_Y, 'rgba(176, 107, 255, 0.55)', 4, 70);
      return;
    }

    const hadStreak = state.streak >= 4;
    state.streak = 0;
    burst(drop.x, BENCH_Y - 2, DROP_INFO[drop.type].color, 6, 90);

    if (hadStreak) {
      addToast(drop.x, BENCH_Y - 34, 'STREAK LOST', 'rgba(160, 200, 195, 0.9)', 0.8, 14);
    }

    Sound.miss();
    syncHud();
  }

  function updateDrops(dt) {
    for (let i = state.drops.length - 1; i >= 0; i -= 1) {
      const drop = state.drops[i];
      drop.prevY = drop.y;
      drop.y += drop.vy * dt;
      drop.x += (Math.sin(state.time * 2.1 + drop.phase) * drop.sway + drop.vx) * dt;
      drop.x = clamp(drop.x, 40, W - 40);
      drop.rot += drop.spin * dt;

      const aligned = Math.abs(drop.x - state.player.x) < CATCH_HALF + drop.r * 0.25;
      const crossedMouth = drop.prevY + drop.r < CATCH_Y && drop.y + drop.r >= CATCH_Y;

      if (aligned && crossedMouth) {
        catchDrop(drop, i);
        continue;
      }

      if (drop.y - drop.r > BENCH_Y + 4) {
        missDrop(drop, i);
      }
    }
  }

  function update(dt) {
    state.time += dt;
    updateBubbles(dt);
    updateParticles(dt);
    updateToasts(dt);
    state.shake = Math.max(0, state.shake - dt * 36);
    state.flash = Math.max(0, state.flash - dt * 2.4);

    if (state.mode !== 'playing') return;

    state.elapsed += dt;

    const nextLevel = 1 + Math.floor(state.elapsed / 22);
    if (nextLevel !== state.level) {
      state.level = nextLevel;
      addToast(W / 2, 274, 'LEVEL ' + state.level, '#6ef3c5', 1.2, 24);
      Sound.level();
    }

    if (state.rush > 0) {
      state.rush -= dt;
      if (state.rush <= 0) {
        state.rush = 0;
        state.brew = 0;
        addToast(W / 2, 300, 'Rush complete', '#ffd166', 1.1, 21);
      }
    }

    updatePlayer(dt);

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnDrop();
      state.spawnTimer = nextSpawnDelay();
    }

    updateDrops(dt);

    if (state.mode !== 'playing') return;
    syncHud();
  }

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  function roundedPath(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawPipes() {
    ctx.save();
    ctx.lineCap = 'round';

    ctx.strokeStyle = '#0b3437';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(-10, 30);
    ctx.lineTo(W + 10, 30);
    ctx.stroke();

    ctx.strokeStyle = '#145256';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-10, 23);
    ctx.lineTo(W + 10, 23);
    ctx.stroke();

    [130, 470, 825].forEach((x) => {
      ctx.fillStyle = '#0d3d40';
      ctx.beginPath();
      ctx.arc(x, 30, 14, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(110, 243, 197, 0.14)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#2b6b6a';
      ctx.beginPath();
      ctx.arc(x, 30, 4, 0, TAU);
      ctx.fill();
    });

    ctx.strokeStyle = '#0b3437';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(130, 30);
    ctx.lineTo(130, 100);
    ctx.stroke();

    ctx.strokeStyle = '#145256';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(123, 30);
    ctx.lineTo(123, 98);
    ctx.stroke();

    ctx.strokeStyle = '#1f5e5f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(130, 108, 15, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(130, 93);
    ctx.lineTo(130, 123);
    ctx.moveTo(115, 108);
    ctx.lineTo(145, 108);
    ctx.stroke();

    ctx.restore();
  }

  function drawShelf() {
    ctx.save();
    ctx.fillStyle = '#0a2a2c';
    roundedPath(44, 124, 148, 8, 3);
    ctx.fill();

    ctx.fillStyle = '#092325';
    ctx.fillRect(52, 132, 8, 18);
    ctx.fillRect(176, 132, 8, 18);

    const jars = [
      { x: 62, y: 84, w: 30, h: 40, color: 'rgba(110, 243, 197, 0.55)' },
      { x: 103, y: 72, w: 34, h: 52, color: 'rgba(255, 209, 102, 0.5)' },
      { x: 148, y: 90, w: 28, h: 34, color: 'rgba(255, 118, 87, 0.5)' },
    ];

    jars.forEach((jar) => {
      ctx.fillStyle = 'rgba(160, 255, 230, 0.07)';
      roundedPath(jar.x, jar.y, jar.w, jar.h, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(160, 255, 230, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.save();
      roundedPath(jar.x + 2, jar.y + 2, jar.w - 4, jar.h - 4, 4);
      ctx.clip();
      ctx.fillStyle = jar.color;
      ctx.fillRect(jar.x, jar.y + jar.h * 0.35, jar.w, jar.h * 0.65);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.arc(jar.x + jar.w * 0.35, jar.y + jar.h * 0.62, 2, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(jar.x + jar.w * 0.65, jar.y + jar.h * 0.78, 1.5, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#1c5a57';
      ctx.fillRect(jar.x - 2, jar.y - 4, jar.w + 4, 5);
    });

    ctx.restore();
  }

  function drawPoster() {
    ctx.save();
    ctx.translate(815, 86);
    ctx.rotate(-0.025);

    roundedPath(0, 0, 112, 136, 8);
    ctx.fillStyle = '#0a2d2f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(110, 243, 197, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(110, 243, 197, 0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(7, 7, 98, 122);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd166';
    ctx.font = '900 38px ' + FONT;
    ctx.fillText('Lb', 56, 58);

    ctx.fillStyle = '#6ef3c5';
    ctx.font = '800 9px ' + FONT;
    ctx.fillText('LOBSTERIUM', 56, 88);

    ctx.fillStyle = 'rgba(160, 220, 210, 0.55)';
    ctx.font = '700 7px ' + FONT;
    ctx.fillText('CRUSTACEAN DIVISION', 56, 104);

    ctx.fillStyle = 'rgba(160, 220, 210, 0.25)';
    for (let i = 0; i < 12; i += 1) {
      ctx.fillRect(20 + i * 6, 116, 2 + (i % 3), 8);
    }

    ctx.restore();
  }

  function drawBubbles() {
    for (let i = 0; i < state.bubbles.length; i += 1) {
      const bubble = state.bubbles[i];
      ctx.save();
      ctx.globalAlpha = bubble.alpha;
      ctx.strokeStyle = '#a4f5df';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, bubble.r, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(180, 255, 235, 0.12)';
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.arc(bubble.x - bubble.r * 0.3, bubble.y - bubble.r * 0.35, Math.max(0.8, bubble.r * 0.2), 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#0a3033');
    gradient.addColorStop(0.5, '#072124');
    gradient.addColorStop(1, '#041113');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    const light = ctx.createRadialGradient(W * 0.5, 210, 20, W * 0.5, 210, 520);
    light.addColorStop(0, 'rgba(70, 220, 190, 0.1)');
    light.addColorStop(1, 'rgba(70, 220, 190, 0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, W, H);

    if (state.rush > 0) {
      const pulse = 0.1 + Math.sin(state.time * 7) * 0.025;
      const rushGlow = ctx.createRadialGradient(W / 2, 430, 40, W / 2, 430, 500);
      rushGlow.addColorStop(0, 'rgba(255, 209, 102, ' + pulse + ')');
      rushGlow.addColorStop(0.55, 'rgba(255, 118, 87, ' + pulse * 0.4 + ')');
      rushGlow.addColorStop(1, 'rgba(255, 118, 87, 0)');
      ctx.fillStyle = rushGlow;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.strokeStyle = 'rgba(110, 243, 197, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 64) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
    }
    for (let y = 0; y <= H; y += 64) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(110, 243, 197, 0.05)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-40, 90, 190, -0.4, 1.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W + 30, 280, 230, 2.2, 3.9);
    ctx.stroke();

    drawPipes();
    drawShelf();
    drawPoster();
    drawBubbles();
  }

  function drawBench() {
    const gradient = ctx.createLinearGradient(0, BENCH_Y - 10, 0, H);
    gradient.addColorStop(0, '#164a49');
    gradient.addColorStop(0.15, '#0d3335');
    gradient.addColorStop(1, '#06181a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, BENCH_Y - 8, W, H - BENCH_Y + 8);

    ctx.fillStyle = 'rgba(140, 255, 220, 0.28)';
    ctx.fillRect(0, BENCH_Y - 8, W, 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, BENCH_Y - 6, W, 3);

    ctx.strokeStyle = 'rgba(110, 243, 197, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 80; x < W; x += 160) {
      ctx.beginPath();
      ctx.moveTo(x, BENCH_Y);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(110, 243, 197, 0.12)';
    for (let x = 40; x < W; x += 80) {
      ctx.beginPath();
      ctx.arc(x, BENCH_Y + 8, 1.5, 0, TAU);
      ctx.fill();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, BENCH_Y + 10, 92, 10);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 209, 102, 0.16)';
    ctx.fillRect(0, BENCH_Y + 10, 92, 10);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    for (let i = -10; i < 100; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, BENCH_Y + 20);
      ctx.lineTo(i + 8, BENCH_Y + 10);
      ctx.lineTo(i + 14, BENCH_Y + 10);
      ctx.lineTo(i + 6, BENCH_Y + 20);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function getLookTarget(x) {
    let target = null;
    let bestDistance = Infinity;
    for (let i = 0; i < state.drops.length; i += 1) {
      const drop = state.drops[i];
      if (drop.y > 520) continue;
      const dx = drop.x - x;
      const dy = drop.y - 470;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        target = drop;
      }
    }
    if (!target) return { x: 0, y: 0.3 };
    return {
      x: clamp((target.x - x) / 160, -1, 1),
      y: clamp((target.y - 470) / 180, -1, 1),
    };
  }

  function drawClaw(cx, cy, side) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(side * 0.16);

    const gradient = ctx.createLinearGradient(-16, -30, 16, 20);
    gradient.addColorStop(0, '#ffa47e');
    gradient.addColorStop(0.5, '#f26045');
    gradient.addColorStop(1, '#b62f2a');
    ctx.fillStyle = gradient;
    ctx.strokeStyle = '#8f241f';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.ellipse(0, 4, 16, 21, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-12, -10);
    ctx.quadraticCurveTo(-23, -28, -16, -36);
    ctx.quadraticCurveTo(-7, -28, -3, -14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(12, -10);
    ctx.quadraticCurveTo(23, -28, 16, -36);
    ctx.quadraticCurveTo(7, -28, 3, -14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(-6, -2, 5, 10, -0.3, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(140, 30, 25, 0.35)';
    ctx.beginPath();
    ctx.arc(7, 6, 2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-5, 10, 1.6, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function drawFlask(x, bob) {
    const top = 366;
    const bottom = 438;
    const level = state.rush > 0 ? clamp(state.rush / RUSH_TIME, 0, 1) : clamp(state.brew / BREW_MAX, 0, 1);
    const nearFull = level > 0.82 || state.rush > 0;

    if (nearFull) {
      const aura = ctx.createRadialGradient(x, 404, 10, x, 404, 96);
      const alpha = state.rush > 0 ? 0.34 : 0.2;
      aura.addColorStop(0, state.rush > 0 ? 'rgba(255, 209, 102, ' + alpha + ')' : 'rgba(110, 243, 197, ' + alpha + ')');
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(x, 404, 96, 0, TAU);
      ctx.fill();
    }

    const path = new Path2D();
    path.moveTo(x - 34, top);
    path.lineTo(x + 34, top);
    path.lineTo(x + 34, top + 7);
    path.lineTo(x + 19, 388);
    path.lineTo(x + 48, 426);
    path.quadraticCurveTo(x + 48, bottom, x + 36, bottom);
    path.lineTo(x - 36, bottom);
    path.quadraticCurveTo(x - 48, bottom, x - 48, 426);
    path.lineTo(x - 19, 388);
    path.lineTo(x - 34, top + 7);
    path.closePath();

    ctx.save();
    ctx.fillStyle = 'rgba(180, 255, 238, 0.055)';
    ctx.fill(path);

    if (level > 0.005) {
      ctx.save();
      ctx.clip(path);
      const liquidTop = bottom - 4 - level * 46;
      const liquid = ctx.createLinearGradient(0, liquidTop, 0, bottom);
      if (state.rush > 0) {
        liquid.addColorStop(0, '#ffe08a');
        liquid.addColorStop(1, '#ff8a4c');
      } else {
        liquid.addColorStop(0, '#a9ffe1');
        liquid.addColorStop(1, '#27c895');
      }
      ctx.fillStyle = liquid;
      ctx.fillRect(x - 50, liquidTop, 100, bottom - liquidTop + 2);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.ellipse(x, liquidTop, 28, 4, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      for (let i = 0; i < 4; i += 1) {
        const bx = x + Math.sin(state.time * 2 + i * 2.1) * 22;
        const by = bottom - 6 - ((state.time * 22 + i * 17) % Math.max(8, level * 42));
        ctx.beginPath();
        ctx.arc(bx, by, 1.5 + (i % 2), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(205, 255, 244, 0.75)';
    ctx.lineWidth = 2.5;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke(path);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 26, 402);
    ctx.quadraticCurveTo(x - 37, 420, x - 28, 432);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(205, 255, 244, 0.4)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i <= 3; i += 1) {
      const ty = bottom - 10 - i * 10;
      ctx.beginPath();
      ctx.moveTo(x + 32 - i * 1.2, ty);
      ctx.lineTo(x + 38 - i * 1.4, ty);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = '#071d1e';
    ctx.beginPath();
    ctx.ellipse(x, top, 34, 8, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(205, 255, 244, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(x, top, 34, 8, 0, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x, top - 1.5, 26, 4.5, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    if (nearFull) {
      ctx.fillStyle = 'rgba(255, 209, 102, 0.8)';
      ctx.beginPath();
      ctx.arc(x, top, 2.5, 0, TAU);
      ctx.fill();
    }
  }

  function drawPlayer() {
    const player = state.player;
    const x = player.x;
    const time = state.time;
    const bob = Math.sin(time * 2.4) * 2 + (state.rush > 0 ? Math.sin(time * 9) * 1.4 : 0);
    const tilt = clamp(player.tilt, -0.1, 0.1);

    ctx.save();
    ctx.translate(x, BENCH_Y - 1);
    ctx.scale(1, 0.28);
    const shadow = ctx.createRadialGradient(0, 0, 4, 0, 0, 72);
    shadow.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
    shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 72, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#a52e29';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i += 1) {
        const hipX = x + side * 22;
        const hipY = 510 + i * 8;
        const kneeX = x + side * (48 + i * 7);
        const kneeY = 520 + i * 7;
        const footX = x + side * (62 + i * 8);
        const footY = BENCH_Y - 2 - i * 2;
        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(x, BENCH_Y - 8);
    ctx.fillStyle = '#b73a30';
    for (const angle of [-0.5, -0.18, 0.18, 0.5]) {
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 4, 11, 17, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(x, 506 + bob);
    ctx.rotate(tilt);
    const bodyGradient = ctx.createLinearGradient(0, -34, 0, 34);
    bodyGradient.addColorStop(0, '#ff9a74');
    bodyGradient.addColorStop(0.45, '#f26045');
    bodyGradient.addColorStop(1, '#b62f2a');
    ctx.fillStyle = bodyGradient;
    ctx.strokeStyle = '#8f241f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 43, 35, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(120, 25, 22, 0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(0, -8 + i * 11, 38 - i * 3, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.ellipse(-15, -14, 10, 16, -0.45, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, 472 + bob);
    ctx.rotate(tilt);
    const headGradient = ctx.createLinearGradient(0, -26, 0, 26);
    headGradient.addColorStop(0, '#ffa47e');
    headGradient.addColorStop(1, '#d84132');
    ctx.fillStyle = headGradient;
    ctx.strokeStyle = '#8f241f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 31, 25, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ff9a74';
    const spikes = [
      [-18, -18, 5, 12],
      [-9, -23, 5, 14],
      [0, -25, 5, 15],
      [9, -23, 5, 14],
      [18, -18, 5, 12],
    ];
    spikes.forEach(([sx, sy, sw, sh]) => {
      ctx.beginPath();
      ctx.moveTo(sx - 2, sy + sh);
      ctx.lineTo(sx, sy);
      ctx.lineTo(sx + 2, sy + sh);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    const look = getLookTarget(x);
    const blink = (time + 0.6) % 4.8 > 4.6;
    for (const side of [-1, 1]) {
      const eyeX = x + side * 16 + tilt * 30;
      const eyeY = 451 + bob;
      ctx.strokeStyle = '#c53a2e';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + side * 11, 460 + bob);
      ctx.quadraticCurveTo(x + side * 15, 452 + bob, eyeX, eyeY);
      ctx.stroke();

      ctx.fillStyle = '#fff8ee';
      ctx.strokeStyle = '#8f241f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, 9, 0, TAU);
      ctx.fill();
      ctx.stroke();

      if (blink) {
        ctx.strokeStyle = '#8f241f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(eyeX - 7, eyeY);
        ctx.quadraticCurveTo(eyeX, eyeY + 3, eyeX + 7, eyeY);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#17201f';
        ctx.beginPath();
        ctx.arc(eyeX + look.x * 3, eyeY + look.y * 2.6, 4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(eyeX + look.x * 3 - 1.2, eyeY + look.y * 2.6 - 1.2, 1.2, 0, TAU);
        ctx.fill();
      }
    }

    for (const side of [-1, 1]) {
      const wave = Math.sin(time * 1.8 + side) * 7;
      ctx.strokeStyle = '#e0553f';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + side * 10, 458 + bob);
      ctx.quadraticCurveTo(x + side * 58, 420 + wave, x + side * 78, 400 + wave * 0.6);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 180, 150, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.strokeStyle = '#b62f2a';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * 30, 492 + bob);
      ctx.quadraticCurveTo(x + side * 56, 462 + bob, x + side * 61, 432);
      ctx.stroke();
    }

    drawFlask(x, bob);

    for (const side of [-1, 1]) {
      drawClaw(x + side * 62, 418 + bob * 0.2, side);
    }
  }

  function drawShrimp() {
    ctx.save();
    ctx.rotate(-0.15);
    ctx.fillStyle = '#ff7a5c';
    ctx.strokeStyle = '#a9332c';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 8, -0.5, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ff9a74';
    ctx.beginPath();
    ctx.moveTo(-8, 5);
    ctx.lineTo(-18, 12);
    ctx.lineTo(-12, 2);
    ctx.lineTo(-19, -1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(169, 51, 44, 0.55)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-3 + i * 5, -7);
      ctx.lineTo(-7 + i * 5, 7);
      ctx.stroke();
    }

    ctx.fillStyle = '#17201f';
    ctx.beginPath();
    ctx.arc(7, -2, 1.8, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = '#ff9a74';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(10, -4);
    ctx.quadraticCurveTo(16, -12, 20, -10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(9, -5);
    ctx.quadraticCurveTo(14, -16, 18, -17);
    ctx.stroke();
    ctx.restore();
  }

  function drawKelp() {
    ctx.save();
    ctx.strokeStyle = '#2ebc87';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.quadraticCurveTo(-4, 4, 1, -3);
    ctx.quadraticCurveTo(5, -10, 0, -16);
    ctx.stroke();

    const leaves = [
      [-7, -2, -0.8, 7, 11],
      [7, 2, 0.9, 7, 10],
      [-4, 8, -1.1, 6, 8],
    ];
    leaves.forEach(([lx, ly, rotation, rx, ry]) => {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(rotation);
      const gradient = ctx.createLinearGradient(0, -ry, 0, ry);
      gradient.addColorStop(0, '#9affcb');
      gradient.addColorStop(1, '#2ebc87');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    });

    ctx.strokeStyle = 'rgba(10, 80, 55, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, -13);
    ctx.stroke();
    ctx.restore();
  }

  function drawPearl() {
    const gradient = ctx.createRadialGradient(-5, -6, 1, 0, 0, 15);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.45, '#c8f6ff');
    gradient.addColorStop(1, '#5ac8e8');
    ctx.fillStyle = gradient;
    ctx.strokeStyle = 'rgba(220, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 16.5, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(10, -10);
    ctx.lineTo(15, -15);
    ctx.moveTo(12.5, -15);
    ctx.lineTo(15, -15);
    ctx.lineTo(15, -12.5);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(-5, -5, 2, 0, TAU);
    ctx.fill();
  }

  function drawSludge() {
    ctx.save();
    ctx.fillStyle = '#a45cff';
    ctx.strokeStyle = '#5d239d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const points = 9;
    for (let i = 0; i < points; i += 1) {
      const angle = (i / points) * TAU;
      const radius = 14 + Math.sin(i * 2.7) * 2.5 + Math.cos(i * 1.3) * 1.5;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#8d45e8';
    ctx.beginPath();
    ctx.ellipse(-8, 13, 3, 5, 0.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(9, 12, 2.4, 4, -0.2, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = '#2b0c4d';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    [-5, 5].forEach((eyeX) => {
      ctx.beginPath();
      ctx.moveTo(eyeX - 2.5, -4);
      ctx.lineTo(eyeX + 2.5, 1);
      ctx.moveTo(eyeX + 2.5, -4);
      ctx.lineTo(eyeX - 2.5, 1);
      ctx.stroke();
    });

    ctx.fillStyle = 'rgba(230, 200, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(-3, 7, 1.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(4, -8, 1.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawDrops() {
    for (let i = 0; i < state.drops.length; i += 1) {
      const drop = state.drops[i];
      const bobRotation = Math.sin(state.time * 2 + drop.phase) * 0.12;
      ctx.save();
      ctx.translate(drop.x, drop.y);
      ctx.rotate(bobRotation + drop.rot * 0.25);

      const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, drop.r * 2.3);
      halo.addColorStop(0, DROP_INFO[drop.type].glow);
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, drop.r * 2.3, 0, TAU);
      ctx.fill();

      if (drop.type === 'shrimp') drawShrimp();
      else if (drop.type === 'kelp') drawKelp();
      else if (drop.type === 'pearl') drawPearl();
      else drawSludge();

      ctx.restore();
    }
  }

  function drawParticles() {
    for (let i = 0; i < state.particles.length; i += 1) {
      const particle = state.particles[i];
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.r * (0.5 + alpha * 0.5), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawToasts() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < state.toasts.length; i += 1) {
      const toast = state.toasts[i];
      const alpha = clamp(toast.life / toast.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.font = '900 ' + toast.size + 'px ' + FONT;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(3, 14, 15, 0.85)';
      ctx.strokeText(toast.text, toast.x, toast.y);
      ctx.fillStyle = toast.color;
      ctx.fillText(toast.text, toast.x, toast.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function drawVignette() {
    const vignette = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.82);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    const topFade = ctx.createLinearGradient(0, 0, 0, 90);
    topFade.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
    topFade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = topFade;
    ctx.fillRect(0, 0, W, 90);
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    }

    drawBackground();
    drawBench();
    drawDrops();
    drawPlayer();
    drawParticles();
    drawToasts();

    ctx.restore();

    drawVignette();

    if (state.flash > 0) {
      ctx.fillStyle = state.flashColor + Math.min(0.34, state.flash * 0.55) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);

  resize();
  showScreen(menuScreen);
  syncModeUi();
  syncHud();
  requestAnimationFrame(frame);

  // A small hook for automated smoke tests and curious tinkerers.
  window.LobsterLab = {
    getState() {
      return {
        mode: state.mode,
        score: state.score,
        best: state.best,
        lives: state.lives,
        brew: state.brew,
        streak: state.streak,
        level: state.level,
        rush: Number(state.rush.toFixed(2)),
        caught: state.caught,
        drops: state.drops.length,
        playerX: Math.round(state.player.x),
        muted: state.muted,
      };
    },
    start: startGame,
    pause: togglePause,
    moveTo(x) {
      state.player.targetX = clamp(Number(x) || W / 2, PLAYER_MIN, PLAYER_MAX);
    },
    spawn(type, x, y) {
      if (state.mode !== 'playing') return false;
      const safeType = DROP_INFO[type] ? type : 'shrimp';
      const spawnX = x === undefined ? state.player.x : clamp(Number(x) || state.player.x, 40, W - 40);
      const spawnY = y === undefined ? 80 : Number(y) || 80;
      spawnDrop(safeType, spawnX, spawnY);
      return true;
    },
    clearDrops() {
      state.drops.length = 0;
    },
    version: '1.0.0',
  };
})();
