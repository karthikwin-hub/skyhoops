import * as THREE from 'three';
import { AVATARS, BALL_COLORS, REACTIONS, type PlayerSnapshot, type Profile, type Ranking, type RoomSnapshot } from '@shared/protocol';
import type { Game, RoundResult, ScoreEvent } from '../game/game';
import { STAGES, stageById } from '../stages';
import type { StageDef } from '../stages/stageTypes';
import { loadProfile, progress, saveProfile } from '../game/progress';
import { audio } from '../audio/audio';
import { sfx } from '../audio/sfx';
import { net } from '../net/client';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

type ScreenId = 'loading' | 'title' | 'profile' | 'map' | 'intro' | 'results' | 'friends' | 'lobby' | 'waiting' | 'podium' | 'none';

export class App {
  private profile: Profile | null = loadProfile();
  private current: ScreenId = 'loading';
  private stage: StageDef = STAGES[0];
  private inRound = false;
  private multiplayer = false;
  private afterProfile: (() => void) | null = null;
  private hintTimer = 0;
  private ringAt = { x: 0, y: 0 };
  private shotMarks: ('made' | 'miss')[] = [];
  private lobbyStage = 'rooftop';
  private pendingJoin: string | null = new URLSearchParams(location.search).get('room');

  constructor(private game: Game) {
    this.bindButtons();
    this.bindGame();
    this.bindNet();
    this.buildProfilePickers();
    this.buildReactions();
    this.renderProfileChip();
    this.syncToggles();
    this.game.renderer.canvas.addEventListener('pointerdown', (e) => {
      this.ringAt = { x: e.clientX, y: e.clientY };
      audio.unlock();
    });
    window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
    requestAnimationFrame(this.hudLoop);

    setTimeout(() => {
      this.game.startAttract(STAGES[0]);
      this.show('title');
      if (this.pendingJoin) this.openFriends();
    }, 200);
  }

  // ------------------------------------------------------------ screens

  private show(id: ScreenId): void {
    this.current = id;
    $$('.screen').forEach((s) => s.classList.toggle('show', s.id === id));
  }

  private showHud(on: boolean): void {
    $('#hud').classList.toggle('show', on);
    $('#reactions').classList.toggle('show', on && this.multiplayer);
    $('#scoreboard').style.display = on && this.multiplayer ? 'flex' : 'none';
  }

  private toast(msg: string, ms = 2600): void {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout((t as unknown as { _t: number })._t);
    (t as unknown as { _t: number })._t = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  private bindButtons(): void {
    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!el) return;
      audio.unlock();
      sfx.click();
      const a = el.dataset.action!;
      switch (a) {
        case 'tour':
          return this.requireProfile(() => this.openMap());
        case 'friends':
          return this.requireProfile(() => this.openFriends());
        case 'profile':
          return this.openProfile();
        case 'profile-save':
          return this.saveProfileForm();
        case 'home':
          return this.goHome();
        case 'map':
          return this.openMap();
        case 'intro-play':
          return this.playSolo(this.stage);
        case 'retry':
          return this.playSolo(this.stage);
        case 'next': {
          const next = STAGES[this.stage.index + 1];
          if (next && progress.unlocked(next.index)) return this.openIntro(next);
          return this.openMap();
        }
        case 'quit':
          return this.quit();
        case 'toggle-sfx':
          audio.setSfx(!audio.sfxOn);
          return this.syncToggles();
        case 'toggle-music':
          audio.setMusic(!audio.musicOn);
          return this.syncToggles();
        case 'toggle-quality': {
          const high = localStorage.getItem('skyhoops.quality') !== 'low' && this.game.renderer.quality.high;
          localStorage.setItem('skyhoops.quality', high ? 'low' : 'high');
          this.toast(high ? 'Switching to fast graphics…' : 'Switching to fancy graphics…');
          setTimeout(() => location.reload(), 900);
          return;
        }
        case 'room-create':
          return this.createRoom();
        case 'room-join':
          return this.joinRoom(($('#join-code') as HTMLInputElement).value);
        case 'room-leave':
          net.send({ t: 'leave' });
          this.multiplayer = false;
          this.game.ghosts.clear();
          return this.goHome();
        case 'room-start':
          return net.send({ t: 'start', stageId: this.lobbyStage });
        case 'room-lobby':
          return net.send({ t: 'lobby' });
        case 'copy-link': {
          const url = `${location.origin}${location.pathname}?room=${net.room?.code ?? ''}`;
          void navigator.clipboard?.writeText(url).then(
            () => this.toast('Invite link copied! Send it to your friends.'),
            () => this.toast(url, 5000),
          );
          return;
        }
      }
    });
    ($('#join-code') as HTMLInputElement).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinRoom((e.target as HTMLInputElement).value);
    });
    ($('#profile-name') as HTMLInputElement).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveProfileForm();
    });
  }

  private syncToggles(): void {
    $('[data-action="toggle-sfx"]').classList.toggle('off', !audio.sfxOn);
    $('[data-action="toggle-music"]').classList.toggle('off', !audio.musicOn);
    $('[data-action="toggle-quality"]').classList.toggle('off', !this.game.renderer.quality.high);
  }

  private goHome(): void {
    this.inRound = false;
    this.showHud(false);
    this.game.stopRound();
    this.game.startAttract(STAGES[0]);
    this.show('title');
  }

  private quit(): void {
    if (this.multiplayer) {
      net.send({ t: 'leave' });
      this.multiplayer = false;
      this.game.ghosts.clear();
      return this.goHome();
    }
    this.inRound = false;
    this.showHud(false);
    this.game.stopRound();
    this.openMap();
  }

  // ------------------------------------------------------------ profile

  private requireProfile(then: () => void): void {
    if (this.profile) return then();
    this.afterProfile = then;
    this.openProfile();
  }

  private buildProfilePickers(): void {
    const colors = $('#profile-colors');
    for (const c of BALL_COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c;
      b.dataset.color = c;
      b.onclick = () => {
        colors.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s === b));
        this.game.ball.setColor(c);
      };
      colors.appendChild(b);
    }
    const avatars = $('#profile-avatars');
    for (const a of AVATARS) {
      const b = document.createElement('button');
      b.className = 'avatar-pick';
      b.textContent = a;
      b.dataset.avatar = a;
      b.onclick = () => avatars.querySelectorAll('.avatar-pick').forEach((s) => s.classList.toggle('sel', s === b));
      avatars.appendChild(b);
    }
  }

  private openProfile(): void {
    const p = this.profile ?? { name: '', color: BALL_COLORS[0], avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)] };
    ($('#profile-name') as HTMLInputElement).value = p.name;
    $$('#profile-colors .swatch').forEach((s) => s.classList.toggle('sel', s.dataset.color === p.color));
    $$('#profile-avatars .avatar-pick').forEach((s) => s.classList.toggle('sel', s.dataset.avatar === p.avatar));
    this.show('profile');
    setTimeout(() => ($('#profile-name') as HTMLInputElement).focus(), 350);
  }

  private saveProfileForm(): void {
    const name = ($('#profile-name') as HTMLInputElement).value.replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 14);
    if (!name) {
      this.toast('Type your name first!');
      return;
    }
    const color = $('#profile-colors .swatch.sel')?.dataset.color ?? BALL_COLORS[0];
    const avatar = $('#profile-avatars .avatar-pick.sel')?.dataset.avatar ?? AVATARS[0];
    this.profile = { name, color, avatar };
    saveProfile(this.profile);
    this.game.ball.setColor(color);
    this.renderProfileChip();
    if (net.status !== 'offline') net.connect(this.profile);
    const then = this.afterProfile;
    this.afterProfile = null;
    if (then) then();
    else this.show('title');
  }

  private renderProfileChip(): void {
    const chip = $('.profile-chip');
    chip.style.display = this.profile ? 'flex' : 'none';
    if (!this.profile) return;
    chip.querySelector('.avatar')!.textContent = this.profile.avatar;
    chip.querySelector('.name')!.textContent = this.profile.name;
    this.game.ball.setColor(this.profile.color);
  }

  // ------------------------------------------------------------ solo flow

  private openMap(): void {
    this.inRound = false;
    this.showHud(false);
    const track = $('#stage-track');
    track.innerHTML = '';
    $('#star-total').textContent = String(progress.totalStars());
    let focus: HTMLElement | null = null;
    for (const s of STAGES) {
      const rec = progress.get(s.id);
      const open = progress.unlocked(s.index);
      const card = document.createElement('button');
      card.className = 'stage-card' + (open ? '' : ' locked');
      card.style.background = s.card;
      card.innerHTML = `
        <span class="num">World ${s.index + 1}</span>
        <div class="emblem">${s.emblem}</div>
        <h3>${s.name}</h3>
        <p>${open ? s.skill : 'Earn a star in the world before to unlock.'}</p>
        <div class="stars">${[0, 1, 2].map((i) => `<span class="${i < rec.stars ? 'on' : ''}">★</span>`).join('')}</div>
        <div class="best">${rec.best ? `Best: ${rec.best}` : '&nbsp;'}</div>
        ${open ? '<span class="play">▶</span>' : ''}`;
      card.onclick = () => {
        if (!open) {
          this.toast('Locked! Get at least one star in the world before it.');
          return;
        }
        this.openIntro(s);
      };
      if (open) focus = card;
      track.appendChild(card);
    }
    this.show('map');
    requestAnimationFrame(() => focus?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' }));
  }

  private openIntro(s: StageDef): void {
    this.stage = s;
    this.game.stopRound();
    this.game.startAttract(s);
    $('.intro-emblem').textContent = s.emblem;
    $('.intro-num').textContent = `World ${s.index + 1} of ${STAGES.length}`;
    $('.intro-name').textContent = s.name;
    $('.intro-skill').textContent = s.skill;
    const rounds = s.timeLimit ? `${s.timeLimit} seconds` : `${s.shots} balls`;
    $('.intro-stars').innerHTML =
      `<div>🏀 ${rounds}</div>` + s.stars.map((t, i) => `<div><b>${'★'.repeat(i + 1)}</b> ${t} pts</div>`).join('');
    this.show('intro');
  }

  private playSolo(s: StageDef): void {
    this.multiplayer = false;
    this.stage = s;
    this.beginRound(s, Math.floor(Math.random() * 1e9));
  }

  private beginRound(s: StageDef, seed: number): void {
    this.show('none');
    this.inRound = true;
    this.shotMarks = [];
    this.game.ghosts.clear();
    this.game.startRound(s, seed, this.multiplayer);
    this.renderBalls();
    $('#hud-score').textContent = '0';
    $('#hud-timer').style.display = s.timeLimit ? 'block' : 'none';
    $('#hud-balls').style.display = s.timeLimit ? 'none' : 'flex';
    this.updateStreak(0);
    this.showHud(true);
    if (this.multiplayer) this.renderScoreboard();
  }

  private renderBalls(): void {
    const el = $('#hud-balls');
    if (this.stage.timeLimit) return;
    el.innerHTML = '';
    for (let i = 0; i < this.stage.shots; i++) {
      const b = document.createElement('i');
      const m = this.shotMarks[i];
      if (m) b.className = m === 'made' ? 'made' : 'used';
      el.appendChild(b);
    }
  }

  private updateStreak(n: number): void {
    const el = $('#hud-streak');
    el.classList.toggle('show', n >= 2);
    el.classList.toggle('fire', n >= 3);
    $('#hud-streak-n').textContent = String(n);
  }

  private popup(text: string, cls = ''): void {
    const p = document.createElement('div');
    p.className = 'popup ' + cls;
    p.textContent = text;
    $('#popups').appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }

  private hint(text: string | undefined, ms = 3200): void {
    const h = $('#hint');
    if (!text) return;
    h.textContent = text;
    h.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => h.classList.remove('show'), ms);
  }

  private bindGame(): void {
    this.game.events = {
      onShotReady: (setup) => {
        if (setup.hint) this.hint(setup.hint, 4200);
      },
      onAim: (power) => {
        const ring = $('#power-ring');
        if (power === null) {
          ring.classList.remove('show');
          return;
        }
        $('#hint').classList.remove('show');
        ring.classList.add('show');
        ring.style.left = this.ringAt.x + 'px';
        ring.style.top = this.ringAt.y + 'px';
        const fill = ring.querySelector('.fill') as SVGCircleElement;
        fill.style.strokeDashoffset = String(264 * (1 - Math.min(1, power)));
        fill.style.stroke = power > 1 ? '#ff5a8a' : '#ffd23a';
        ring.querySelector('span')!.textContent = `${Math.round(power * 100)}%`;
      },
      onScore: (e) => this.onScore(e),
      onMiss: (lost) => {
        this.shotMarks.push('miss');
        this.renderBalls();
        this.updateStreak(0);
        this.popup(lost >= 3 ? 'Streak over!' : ['So close!', 'Almost!', 'Try again!', 'Nearly!'][Math.floor(Math.random() * 4)], 'miss');
        this.sendProgress();
      },
      onShotEnd: (made) => {
        if (this.multiplayer) net.send({ t: 'ballEnd', made });
      },
      onBall: (p) => net.send({ t: 'ball', p }),
      onTooSoft: () => this.hint('Swipe up further to shoot!', 1800),
      onRoundEnd: (r) => this.onRoundEnd(r),
    };
  }

  private onScore(e: ScoreEvent): void {
    this.shotMarks.push('made');
    this.renderBalls();
    const score = $('#hud-score');
    score.textContent = String(e.total);
    score.classList.remove('bump');
    void score.offsetWidth;
    score.classList.add('bump');
    this.updateStreak(e.streak);
    this.popup(`+${e.points}`, 'points');
    const words = e.labels.filter((l) => l !== 'BUCKET!');
    if (words.length) setTimeout(() => this.popup(words.join(' · '), 'small ' + (e.swish ? 'swish' : '') + (e.onFire ? ' fire' : '')), 140);
    if (e.firstFire) setTimeout(() => this.popup("YOU'RE ON FIRE!", 'fire'), 500);
    this.sendProgress(`${e.labels[0] === 'THREE!' ? 'hit a three' : 'scored'}${e.swish ? ' (swish!)' : ''} +${e.points}`);
  }

  private onRoundEnd(r: RoundResult): void {
    this.inRound = false;
    this.showHud(false);
    if (this.multiplayer) {
      net.send({ t: 'finish', score: r.score, made: r.made, shots: r.shots, stars: r.stars });
      if (net.room?.state === 'playing') {
        this.renderPlayers($('#waiting-players'), net.room);
        this.show('waiting');
      }
      return;
    }
    setTimeout(() => this.showResults(r), 900);
  }

  private showResults(r: RoundResult): void {
    $('.results-stage').textContent = r.stage.name;
    $('#results-score').textContent = String(r.score);
    const badges: string[] = [];
    if (r.newBest && r.score > 0) badges.push('New best!');
    if (r.unlockedNext) badges.push(`${STAGES[r.stage.index + 1]?.name ?? ''} unlocked!`);
    $('#results-badges').innerHTML = badges.map((b) => `<span>${b}</span>`).join('');
    $('#results-stats').innerHTML = `
      <div><b>${r.made}/${r.shots}</b>baskets</div>
      <div><b>${r.bestStreak}</b>best streak</div>
      <div><b>${r.swishes}</b>swishes</div>`;
    const stars = $$('.bstar');
    stars.forEach((s) => s.classList.remove('on'));
    const next = STAGES[r.stage.index + 1];
    ($('[data-action="next"]') as HTMLButtonElement).style.display = next && progress.unlocked(next.index) ? '' : 'none';
    this.show('results');
    for (let i = 0; i < r.stars; i++) {
      setTimeout(() => {
        stars[i].classList.add('on');
        sfx.star(i);
        navigator.vibrate?.(30);
      }, 500 + i * 450);
    }
    if (r.stars === 3) setTimeout(() => sfx.fanfare(72), 500 + 3 * 450);
  }

  // ------------------------------------------------------------ HUD loop

  private hudLoop = (): void => {
    requestAnimationFrame(this.hudLoop);
    if (!this.inRound) return;
    const h = this.game.hud;
    if (h.timeLeft !== null) {
      const t = $('#hud-timer');
      const secs = Math.ceil(h.timeLeft);
      if (t.textContent !== String(secs)) {
        t.textContent = String(secs);
        if (secs <= 10 && secs > 0) sfx.beep(false);
      }
      t.classList.toggle('urgent', secs <= 10);
    }
    const w = h.wind.length();
    const wind = $('#hud-wind');
    wind.classList.toggle('show', w > 0.05);
    if (w > 0.05) {
      $('#wind-arrow').style.transform = `rotate(${h.windScreenAngle}rad)`;
      $('#wind-speed').textContent = `${Math.round(w * 10) / 10}`;
    }
  };

  // ------------------------------------------------------------ multiplayer

  private bindNet(): void {
    net.onStatus = (s) => {
      $('#net-status').textContent = s === 'connecting' ? 'Connecting to the game server…' : s === 'offline' && this.current === 'friends' ? 'Game server not reachable. Is it running?' : '';
    };
    net.on('error', (m) => {
      this.toast(m.message);
      $('#net-status').textContent = m.message;
    });
    net.on('room', (m) => this.onRoom(m.room));
    net.on('left', () => {
      if (this.multiplayer || ['lobby', 'waiting', 'podium'].includes(this.current)) {
        this.multiplayer = false;
        this.game.ghosts.clear();
        if (this.inRound) {
          this.inRound = false;
          this.showHud(false);
          this.game.stopRound();
        }
        this.toast('You left the room.');
        this.game.startAttract(STAGES[0]);
        this.show('title');
      }
    });
    net.on('start', (m) => {
      this.multiplayer = true;
      const s = stageById(m.stageId);
      this.stage = s;
      this.show('none');
      this.game.stopRound();
      this.game.loadStage(s);
      this.game.showcase();
      this.countdown(m.startIn, () => this.beginRound(s, m.seed));
    });
    net.on('ball', (m) => {
      const p = net.room?.players.find((x) => x.id === m.id);
      if (p && this.inRound) this.game.ghosts.update(m.id, p.name, p.avatar, p.color, m.p);
    });
    net.on('ballEnd', (m) => this.game.ghosts.end(m.id, m.made));
    net.on('react', (m) => this.floatReaction(m.id, m.emoji));
    net.on('feed', (m) => {
      const p = net.room?.players.find((x) => x.id === m.id);
      if (!p) return;
      const d = document.createElement('div');
      d.textContent = `${p.avatar} ${p.name} ${m.label}`;
      $('#feed').appendChild(d);
      setTimeout(() => d.remove(), 4100);
    });
    net.on('results', (m) => this.showPodium(m.ranking));
  }

  private openFriends(): void {
    this.show('friends');
    if (this.profile) net.connect(this.profile);
    if (this.pendingJoin) {
      ($('#join-code') as HTMLInputElement).value = this.pendingJoin;
      const code = this.pendingJoin;
      this.pendingJoin = null;
      history.replaceState(null, '', location.pathname);
      this.requireProfile(() => this.joinRoom(code));
    }
  }

  private createRoom(): void {
    if (!this.profile) return this.openProfile();
    net.connect(this.profile);
    net.send({ t: 'create' });
  }

  private joinRoom(code: string): void {
    code = code.trim().toUpperCase();
    if (code.length !== 4) {
      this.toast('Room codes have 4 letters.');
      return;
    }
    if (!this.profile) return this.openProfile();
    net.connect(this.profile);
    net.send({ t: 'join', code });
  }

  private onRoom(room: RoomSnapshot): void {
    if (room.state === 'lobby') {
      if (['friends', 'lobby', 'podium', 'waiting', 'title'].includes(this.current) || this.current === 'none') {
        if (this.inRound) return;
        this.multiplayer = true;
        this.renderLobby(room);
        if (this.current !== 'lobby') {
          this.game.stopRound();
          this.game.startAttract(stageById(this.lobbyStage));
          this.show('lobby');
        }
      }
      return;
    }
    if (room.state === 'playing') {
      const me = room.players.find((p) => p.id === net.id);
      if (me && !me.inRound && this.current !== 'lobby') {
        this.renderLobby(room);
        this.show('lobby');
      } else if (this.current === 'lobby') this.renderLobby(room);
      if (this.inRound) this.renderScoreboard();
      if (this.current === 'waiting') this.renderPlayers($('#waiting-players'), room);
      return;
    }
    if (this.current === 'podium') {
      const again = $('#podium-again') as HTMLButtonElement;
      again.disabled = !net.isHost;
      again.textContent = net.isHost ? 'Play again' : 'Host picks next…';
    }
  }

  private renderPlayers(el: HTMLElement, room: RoomSnapshot): void {
    el.innerHTML = room.players
      .map(
        (p) => `<div class="lp"><span class="av" style="border-color:${p.color}">${p.avatar}</span><span class="nm">${escapeHtml(p.name)}${p.id === net.id ? ' (you)' : ''}</span>${
          p.id === room.hostId ? '<span class="tag">host</span>' : ''
        }${room.state === 'playing' && p.inRound ? `<b>${p.score}${p.finished ? ' ✓' : ''}</b>` : ''}</div>`,
      )
      .join('');
  }

  private renderLobby(room: RoomSnapshot): void {
    $('#room-code').textContent = room.code;
    this.renderPlayers($('#lobby-players'), room);
    const host = room.hostId === net.id;
    if (!host) this.lobbyStage = room.stageId;
    const chips = $('#stage-chips');
    chips.classList.toggle('readonly', !host);
    chips.innerHTML = '';
    for (const s of STAGES) {
      const b = document.createElement('button');
      b.textContent = `${s.emblem} ${s.name}`;
      b.classList.toggle('sel', s.id === this.lobbyStage);
      b.onclick = () => {
        this.lobbyStage = s.id;
        chips.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
        this.game.startAttract(s);
      };
      chips.appendChild(b);
    }
    $('#lobby-stage-label').textContent = host ? 'Pick a world' : 'World';
    $('#room-start').style.display = host ? '' : 'none';
    $('#lobby-wait').style.display = host ? 'none' : '';
    $('#lobby-wait').textContent = room.state === 'playing' ? 'A round is in progress. You will join the next one!' : 'Waiting for the host to start…';
    ($('#room-start') as HTMLButtonElement).textContent = room.players.length > 1 ? 'Start!' : 'Start (solo)';
  }

  private renderScoreboard(): void {
    const room = net.room;
    const el = $('#scoreboard');
    if (!room) return;
    const players = [...room.players].filter((p) => p.inRound).sort((a, b) => b.score - a.score);
    const prev = new Map([...el.querySelectorAll<HTMLElement>('.sb-row')].map((r) => [r.dataset.id!, Number(r.dataset.score)]));
    el.innerHTML = '';
    for (const p of players) el.appendChild(this.sbRow(p, prev.get(p.id)));
  }

  private sbRow(p: PlayerSnapshot, prevScore?: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sb-row' + (p.id === net.id ? ' me' : '') + (p.finished ? ' done' : '');
    if (prevScore !== undefined && prevScore !== p.score) row.classList.add('flash');
    row.dataset.id = p.id;
    row.dataset.score = String(p.score);
    row.innerHTML = `<span class="av" style="border-color:${p.color}">${p.avatar}</span><span class="nm">${escapeHtml(p.name)}</span><span class="sc">${p.score}</span>`;
    return row;
  }

  private sendProgress(label?: string): void {
    if (!this.multiplayer) return;
    const h = this.game.hud;
    net.send({ t: 'progress', score: h.score, made: this.shotMarks.filter((m) => m === 'made').length, shots: this.shotMarks.length, streak: h.streak, label });
  }

  private buildReactions(): void {
    const bar = $('#reactions');
    for (const r of REACTIONS) {
      const b = document.createElement('button');
      b.textContent = r;
      b.onclick = (e) => {
        e.stopPropagation();
        net.send({ t: 'react', emoji: r });
        sfx.pop();
      };
      bar.appendChild(b);
    }
  }

  private floatReaction(id: string, emoji: string): void {
    const p = net.room?.players.find((x) => x.id === id);
    const d = document.createElement('div');
    d.className = 'float-react';
    d.style.left = `${10 + Math.random() * 80}%`;
    d.innerHTML = `${emoji}<small>${escapeHtml(p?.name ?? '')}</small>`;
    $('#floating-reacts').appendChild(d);
    setTimeout(() => d.remove(), 2700);
  }

  private countdown(ms: number, then: () => void): void {
    const el = $('#countdown');
    const steps = ['3', '2', '1', 'GO!'];
    const start = Math.max(0, ms - steps.length * 800);
    steps.forEach((s, i) => {
      setTimeout(() => {
        el.innerHTML = `<span>${s}</span>`;
        sfx.beep(i === steps.length - 1);
      }, start + i * 800);
    });
    setTimeout(() => {
      el.innerHTML = '';
      then();
    }, start + (steps.length - 1) * 800 + 300);
  }

  private showPodium(ranking: Ranking[]): void {
    this.inRound = false;
    this.showHud(false);
    this.game.stopRound();
    this.game.ghosts.clear();
    this.game.showcase();
    const order = [1, 0, 2];
    $('#podium-stands').innerHTML = order
      .filter((i) => ranking[i])
      .map((i) => {
        const r = ranking[i];
        return `<div class="stand p${i + 1}"><div class="av" style="border-color:${r.color}">${r.avatar}</div><div class="nm">${escapeHtml(r.name)}</div><div class="block"><b>${i + 1}</b>${r.score} pts</div></div>`;
      })
      .join('');
    $('#podium-rest').innerHTML = ranking
      .slice(3)
      .map((r, i) => `<div class="sb-row"><span class="av" style="border-color:${r.color}">${r.avatar}</span><span class="nm">${i + 4}. ${escapeHtml(r.name)}</span><span class="sc">${r.score}</span></div>`)
      .join('');
    const again = $('#podium-again') as HTMLButtonElement;
    again.disabled = !net.isHost;
    again.textContent = net.isHost ? 'Play again' : 'Host picks next…';
    this.show('podium');
    const palette = ['#ff5a8a', '#ffd23a', '#5ae8ff', '#8aff7a', '#b07aff'].map((c) => new THREE.Color(c));
    this.game.confetti.burst(this.game.hoop.rimCenter.clone().add(new THREE.Vector3(0, 1.5, 0)), 260, palette, 1.4);
    sfx.fanfare(72);
    sfx.cheer(1);
    if (ranking[0]?.id === net.id) setTimeout(() => this.toast('You won! 🏆'), 1600);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
