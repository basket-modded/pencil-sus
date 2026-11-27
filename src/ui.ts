import { PLAYER_COLORS, STATIONS } from './shared/map';
import type { Snapshot, TaskInfo, VoteResult } from './shared/protocol';
import { drawMinimap } from './render/textures';
import { createTaskGame, type TaskGame } from './tasks';
import { sfx } from './audio';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UIActions {
  createRoom(name: string, color: string): void;
  joinRoom(code: string, name: string, color: string): void;
  solo(name: string, color: string): void;
  start(): void;
  addBot(): void;
  kickBot(): void;
  leave(): void;
  use(): void;
  sabotage(kind: 'lights' | 'reactor'): void;
  vote(id: string): void;
  restart(): void;
  taskDone(id: string): void;
  mapToggle(open: boolean): void;
  emote(): void;
  chat(text: string): void;
}

type Screen = 'menu' | 'lobby' | 'hud';

export class UI {
  actions: UIActions | null = null;
  name = 'Doodle';
  color = PLAYER_COLORS[0];
  code = '';
  offlineNote: string | null = null;
  private taskGame: TaskGame | null = null;
  private taskEl: TaskInfo | null = null;
  private keys = new Map<string, string>();
  private minimapCtx: CanvasRenderingContext2D;
  private mapOpen = false;
  current: Screen = 'menu';

  constructor() {
    this.name = localStorage.getItem('ps-name') || pickName();
    this.color = localStorage.getItem('ps-color') || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
    this.bindMenu();
    this.minimapCtx = ($('minimap') as HTMLCanvasElement).getContext('2d')!;
    this.buildColors();
    ($('name-input') as HTMLInputElement).value = this.name;
    ($('btn-map') as HTMLElement).onclick = () => this.setMap(!this.mapOpen);
    ($('btn-copy') as HTMLElement).onclick = () => {
      const url = `${location.origin}${location.pathname}#${this.code}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      this.flash($('lobby-hint'), 'invite link copied!');
    };
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'm' && !this.isTyping()) {
        this.setMap(!this.mapOpen);
        sfx.click();
      }
      if (e.key === 'Escape') {
        if (this.mapOpen) this.setMap(false);
        else if (this.taskGame) this.closeTask();
      }
    });
  }

  private isTyping() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  private buildColors() {
    const wrap = $('colors');
    wrap.innerHTML = '';
    for (const c of PLAYER_COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch' + (c === this.color ? ' active' : '');
      b.style.background = c;
      b.setAttribute('aria-label', `colour ${c}`);
      b.onclick = () => {
        this.color = c;
        localStorage.setItem('ps-color', c);
        wrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
        b.classList.add('active');
        sfx.click();
      };
      wrap.appendChild(b);
    }
  }

  private bindMenu() {
    const nameInput = $('name-input') as HTMLInputElement;
    const codeInput = $('code-input') as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      this.name = nameInput.value.trim() || 'Doodle';
      localStorage.setItem('ps-name', this.name);
    });
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });
    $('btn-create').onclick = () => {
      sfx.click();
      this.actions?.createRoom(this.name, this.color);
    };
    $('btn-join').onclick = () => {
      const code = (codeInput.value || '').toUpperCase();
      if (code.length < 4) {
        this.setStatus('Room codes are 4 characters, doodler.', 'bad');
        sfx.error();
        return;
      }
      sfx.click();
      this.actions?.joinRoom(code, this.name, this.color);
    };
    $('btn-solo').onclick = () => {
      sfx.click();
      this.actions?.solo(this.name, this.color);
    };
    $('btn-bot').onclick = () => {
      sfx.click();
      this.actions?.addBot();
    };
    $('btn-start').onclick = () => {
      sfx.click();
      this.actions?.start();
    };
    $('btn-leave').onclick = () => {
      sfx.click();
      this.actions?.leave();
    };
    $('task-close').onclick = () => {
      sfx.click();
      this.closeTask();
    };
    $('btn-use').onclick = () => {
      sfx.click();
      this.actions?.use();
    };
    $('btn-sabo').onclick = () => {
      sfx.click();
      $('sabo-menu').classList.toggle('hidden');
    };
    $('sabo-lights').onclick = () => {
      sfx.click();
      $('sabo-menu').classList.add('hidden');
      this.actions?.sabotage('lights');
    };
    $('sabo-reactor').onclick = () => {
      sfx.click();
      $('sabo-menu').classList.add('hidden');
      this.actions?.sabotage('reactor');
    };
    $('btn-over-again').onclick = () => {
      sfx.click();
      this.actions?.restart();
    };
    $('btn-over-leave').onclick = () => {
      sfx.click();
      this.actions?.leave();
    };
    const chatInput = $('chat-input') as HTMLInputElement;
    const say = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      this.actions?.chat(text);
      chatInput.value = '';
      chatInput.blur();
      sfx.click();
    };
    $('chat-say').onclick = say;
    chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') say();
    });
    const quick = $('chat-quick');
    for (const phrase of ['where were you?', 'I saw them vent', 'sus', 'skip, no proof']) {
      const b = document.createElement('button');
      b.textContent = phrase;
      b.onclick = () => {
        this.actions?.chat(phrase);
        sfx.click();
      };
      quick.appendChild(b);
    }
    // typing in the room code + enter joins
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ($('btn-join') as HTMLElement).click();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ($('btn-create') as HTMLElement).click();
    });
  }

  setStatus(text: string, tone: 'info' | 'bad' | 'good' = 'info') {
    const el = $('menu-status');
    el.textContent = text;
    el.className = `status ${tone}`;
  }

  show(screen: Screen) {
    this.current = screen;
    $('menu').classList.toggle('hidden', screen !== 'menu');
    $('lobby').classList.toggle('hidden', screen !== 'lobby');
    $('hud').classList.toggle('hidden', screen !== 'hud');
    if (screen !== 'hud') this.setMap(false);
  }

  private introTimer = 0;

  showIntro(title: string, sub: string, tone: 'crew' | 'impostor' | 'info' = 'info', ms = 3400) {
    const el = $('intro');
    $('intro-title').textContent = title;
    $('intro-sub').textContent = sub;
    el.className = `intro ${tone}`;
    window.clearTimeout(this.introTimer);
    this.introTimer = window.setTimeout(() => el.classList.add('hidden'), ms);
  }

  setCode(code: string) {
    this.code = code;
    $('lobby-code').textContent = code;
  }

  flash(el: HTMLElement, text: string) {
    const prev = el.textContent;
    el.textContent = text;
    window.setTimeout(() => {
      if (el.textContent === text) el.textContent = prev ?? '';
    }, 1200);
  }

  setMap(open: boolean) {
    this.mapOpen = open;
    $('mapwrap').classList.toggle('hidden', !open);
    $('btn-map').classList.toggle('active', open);
    this.actions?.mapToggle(open);
  }

  get isMapOpen() {
    return this.mapOpen;
  }

  // -------------------------------------------------------------------------
  // lobby
  // -------------------------------------------------------------------------

  renderLobby(snap: Snapshot, youId: string) {
    const list = $('lobby-players');
    const key = snap.players.map((p) => `${p.id}:${p.name}:${p.color}:${p.host}`).join('|') + snap.phase;
    if (this.keys.get('lobby') !== key) {
      this.keys.set('lobby', key);
      list.innerHTML = '';
      for (const p of snap.players) {
        const li = document.createElement('li');
        li.innerHTML = `<i style="background:${p.color}"></i><span>${escapeHtml(p.name)}</span>${
          p.host ? '<em>host</em>' : ''
        }${p.bot ? '<b>bot</b>' : ''}${p.id === youId ? '<u>you</u>' : ''}`;
        list.appendChild(li);
      }
    }
    const isHost = snap.hostId === youId;
    ($('btn-start') as HTMLButtonElement).disabled = !isHost || snap.players.length < 2;
    ($('btn-bot') as HTMLButtonElement).disabled = !isHost || snap.players.length >= 10;
    if (this.offlineNote) {
      ($('lobby-hint') as HTMLElement).textContent = this.offlineNote;
      return;
    }
    ($('lobby-hint') as HTMLElement).textContent = isHost
      ? snap.players.length < 2
        ? 'add at least one doodle bot, or invite a friend with the room code'
        : `${snap.players.length} doodles on the page — start when ready`
      : 'waiting for the host to start scribbling…';
  }

  // -------------------------------------------------------------------------
  // hud
  // -------------------------------------------------------------------------

  renderHud(snap: Snapshot, youId: string, prompt: { label: string; enabled: boolean } | null) {
    $('hud').classList.remove('hidden');
    const me = snap.players.find((p) => p.id === youId);
    // task progress
    const fill = $('taskbar-fill');
    fill.style.width = `${Math.round(snap.taskProgress * 100)}%`;
    $('taskbar-label').textContent = `TASKS ${Math.round(snap.taskProgress * 100)}%`;
    $('taskbar').classList.toggle('done', snap.taskProgress >= 1);

    // role chip
    const chip = $('rolechip');
    const crew = snap.players.filter((p) => p.alive && p.role !== 'impostor' && !snap.impostors.includes(p.id)).length;
    void crew;
    if (snap.phase !== 'lobby') {
      chip.classList.remove('hidden');
      chip.className = `rolechip ${snap.youRole}`;
      if (snap.youRole === 'impostor') {
        const cd = snap.killCooldown > 0.05 ? `erase ready in ${Math.ceil(snap.killCooldown)}s` : 'ERASE READY · E';
        chip.innerHTML = `<b>ERASER</b><span>${cd} · ${Math.max(1, snap.players.filter((p) => p.alive).length - snap.impostors.length)} drawings left</span>`;
      } else if (me && !me.alive) {
        chip.innerHTML = `<b>GHOST</b><span>you can still fly around and watch</span>`;
      } else {
        chip.innerHTML = `<b>DRAWING</b><span>finish ${snap.tasks.filter((t) => !t.done).length} tasks · find the eraser</span>`;
      }
    } else {
      chip.classList.add('hidden');
    }

    // task list
    const tl = $('tasks-list');
    const tkey = snap.tasks.map((t) => `${t.id}${t.done ? '1' : '0'}`).join(',');
    if (this.keys.get('tasks') !== tkey) {
      this.keys.set('tasks', tkey);
      tl.innerHTML = '';
      if (snap.tasks.length) {
        const h = document.createElement('h4');
        h.textContent = 'TASK LIST';
        tl.appendChild(h);
        for (const t of snap.tasks) {
          const row = document.createElement('div');
          row.className = 'task' + (t.done ? ' done' : '');
          row.innerHTML = `<i>${t.done ? '✓' : '○'}</i><span>${escapeHtml(t.name)}</span><em>${escapeHtml(
            STATIONS.find((s) => s.id === t.id)?.room.toUpperCase() ?? '',
          )}</em>`;
          tl.appendChild(row);
        }
      }
    }

    // feed
    const feed = $('feed');
    const fkey = snap.feed.map((f) => f.id).join(',');
    if (this.keys.get('feed') !== fkey) {
      this.keys.set('feed', fkey);
      feed.innerHTML = '';
      for (const f of snap.feed.slice(-5)) {
        const d = document.createElement('div');
        d.className = `line ${f.tone}`;
        d.textContent = f.text;
        feed.appendChild(d);
      }
    }

    // sabotage banner
    const sab = $('sabotage');
    if (snap.sabotage) {
      sab.classList.remove('hidden');
      const fixing = snap.sabotage.total - snap.sabotage.fixed;
      sab.className = `sabotage ${snap.sabotage.kind}`;
      sab.innerHTML = `<b>${snap.sabotage.kind === 'reactor' ? 'REACTOR MELTDOWN' : 'LIGHTS OUT'}</b>
        <span>${snap.sabotage.timer.toFixed(1)}s · ${fixing} ${
          snap.sabotage.kind === 'reactor' ? 'panels' : 'breakers'
        } left</span>`;
    } else sab.classList.add('hidden');

    // actions
    const isImp = snap.youRole === 'impostor';
    $('btn-sabo').classList.toggle('hidden', !isImp || !me?.alive || snap.phase !== 'play');
    const saboBusy = snap.sabotageCooldown > 0.2 || !!snap.sabotage;
    $('btn-sabo').classList.toggle('disabled', saboBusy);
    $('btn-sabo').textContent = snap.sabotageCooldown > 0.2 ? `${Math.ceil(snap.sabotageCooldown)}` : '!';
    const canKill = isImp && (snap.killCooldown ?? 0) <= 0.01 && me?.alive;
    $('btn-use').classList.toggle('killmode', !!canKill && !!prompt && prompt.label.startsWith('ERASE'));
    const useBtn = $('btn-use');
    useBtn.classList.toggle('hidden', !prompt || !prompt.enabled || snap.phase !== 'play');
    if (prompt && prompt.enabled) useBtn.querySelector('span')!.textContent = prompt.label;
    // show the kill cooldown on the button rim
    if (isImp) {
      useBtn.style.setProperty('--cd', `${Math.min(1, snap.killCooldown / snap.settings.killCooldown)}`);
    } else {
      useBtn.style.setProperty('--cd', '0');
    }

    // meeting overlay
    this.renderMeeting(snap, youId);
    this.renderOver(snap, youId);

    // keyboard prompt element
    const promptEl = $('prompt');
    if (prompt && prompt.enabled && snap.phase === 'play') {
      promptEl.classList.remove('hidden');
      promptEl.innerHTML = `<kbd>E</kbd> ${escapeHtml(prompt.label)}`;
    } else promptEl.classList.add('hidden');
  }

  private renderChat(snap: Snapshot, youId: string, visible: boolean) {
    const wrap = $('chat');
    wrap.classList.toggle('hidden', !visible);
    if (!visible) return;
    const log = $('chat-log');
    const msgs = snap.feed.filter((f) => f.tone === 'chat');
    const key = msgs.map((m) => m.id).join(',');
    if (this.keys.get('chat') !== key) {
      this.keys.set('chat', key);
      log.innerHTML = msgs.length
        ? msgs
            .slice(-30)
            .map((m) => {
              const idx = m.text.indexOf(':');
              const who = idx > 0 ? m.text.slice(0, idx) : '';
              const body = idx > 0 ? m.text.slice(idx + 1) : m.text;
              return `<div class="msg"><b>${escapeHtml(who)}</b>${escapeHtml(body.trim())}</div>`;
            })
            .join('')
        : '<div class="empty">nobody is talking. be the first to point a pencil.</div>';
      log.scrollTop = log.scrollHeight;
    }
    const me = snap.players.find((p) => p.id === youId);
    const canTalk = !!me?.alive && (snap.phase === 'meeting' || snap.phase === 'vote');
    ($('chat-input') as HTMLInputElement).disabled = !canTalk;
    ($('chat-say') as HTMLButtonElement).disabled = !canTalk;
  }

  private renderMeeting(snap: Snapshot, youId: string) {
    const show = snap.phase === 'meeting' || snap.phase === 'vote' || snap.phase === 'reveal' || snap.phase === 'eject';
    const el = $('meeting');
    el.classList.toggle('hidden', !show);
    if (!show) {
      this.keys.delete('meeting');
      return;
    }
    const me = snap.players.find((p) => p.id === youId);
    const voting = snap.phase === 'vote';
    this.renderChat(snap, youId, snap.phase === 'meeting' || snap.phase === 'vote');
    const myVote = snap.votes?.[youId];
    const key = [
      snap.phase,
      snap.meeting?.reason,
      snap.meeting?.reporterId,
      voting && myVote,
      snap.votes ? Object.keys(snap.votes).length : 0,
      snap.result?.ejectedId,
      Math.ceil(snap.timer),
      snap.players.map((p) => p.alive).join(''),
    ].join('|');
    if (this.keys.get('meeting') === key) return;
    this.keys.set('meeting', key);

    const body = $('meeting-body');
    const title = $('meeting-title');
    const sub = $('meeting-sub');
    if (snap.phase === 'reveal' || snap.phase === 'eject') {
      this.renderChat(snap, youId, false);
      const r = snap.result;
      title.textContent = r?.ejectedName ? 'EJECTED' : 'NOBODY EJECTED';
      sub.textContent = '';
      body.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'verdict';
      if (r?.ejectedName) {
        card.innerHTML = `<div class="ball" style="--c:${
          snap.players.find((p) => p.id === r.ejectedId)?.color ?? '#ccc'
        }"></div>
          <b>${escapeHtml(r.ejectedName)}</b>
          <p>${r.ejectedRole === 'impostor' ? 'was the ERASER.' : 'was not the eraser.'}</p>`;
      } else {
        card.innerHTML = `<div class="ball none"></div><b>no one</b><p>${
          r?.tie ? 'the vote was a scribble.' : 'the page stays as it is.'
        }</p>`;
      }
      body.appendChild(card);
      const tally = document.createElement('div');
      tally.className = 'tally';
      const rows = Object.entries(r?.tally ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => {
          const p = snap.players.find((x) => x.id === id);
          return `<div><i style="background:${p?.color ?? '#999'}"></i>${escapeHtml(p?.name ?? '?')}<em>${n}</em></div>`;
        })
        .join('');
      tally.innerHTML = rows + `<div class="skip"><i></i>skip<em>${r?.skipped ?? 0}</em></div>`;
      body.appendChild(tally);
      $('meeting-timer').style.width = '100%';
      return;
    }
    title.textContent = snap.phase === 'vote' ? 'WHO HELD THE ERASER?' : 'EMERGENCY MEETING';
    sub.textContent = snap.meeting
      ? snap.meeting.reason === 'body'
        ? `${snap.meeting.reporterName} found a body. everybody, look sharp.`
        : `${snap.meeting.reporterName} slammed the big red button.`
      : '';
    body.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'vote-grid';
    for (const p of snap.players) {
      const btn = document.createElement('button');
      btn.className = 'vote-card' + (p.alive ? '' : ' dead') + (myVote === p.id ? ' voted' : '');
      btn.disabled = !voting || !me?.alive || !!myVote || !p.alive;
      btn.innerHTML = `<i style="background:${p.color}"></i>
        <span>${escapeHtml(p.name)}</span>
        ${p.id === youId ? '<u>you</u>' : ''}
        ${p.role === 'impostor' ? '<b class="imp">eraser</b>' : ''}
        ${
          snap.votes?.[p.id]
            ? `<em>${snap.votes[p.id] === 'skip' ? 'skipped' : 'voted'}</em>`
            : ''
        }`;
      btn.onclick = () => {
        if (!voting) return;
        sfx.click();
        this.actions?.vote(p.id);
      };
      grid.appendChild(btn);
    }
    const skip = document.createElement('button');
    skip.className = 'vote-card skip' + (myVote === 'skip' ? ' voted' : '');
    skip.disabled = !voting || !me?.alive || !!myVote;
    skip.innerHTML = `<i class="empty"></i><span>SKIP</span>`;
    skip.onclick = () => {
      sfx.click();
      this.actions?.vote('skip');
    };
    grid.appendChild(skip);
    body.appendChild(grid);
    const vt = document.createElement('p');
    vt.className = 'vote-note';
    vt.textContent = !me?.alive
      ? 'ghosts cannot vote. enjoy the show.'
      : myVote
        ? 'vote locked in. hold tight.'
        : voting
          ? 'click a drawing to crumple it up'
          : 'look at each other…';
    body.appendChild(vt);
    const pct = snap.phase === 'vote' ? Math.max(0, Math.min(1, snap.timer / 20)) : 1;
    $('meeting-timer').style.width = `${pct * 100}%`;
  }

  private renderOver(snap: Snapshot, youId: string) {
    const el = $('over');
    const show = snap.phase === 'over';
    el.classList.toggle('hidden', !show);
    if (!show) {
      this.keys.delete('over');
      return;
    }
    const key = `${snap.winner}|${snap.players.length}|${snap.players.map((p) => p.alive).join('')}`;
    if (this.keys.get('over') === key) return;
    this.keys.set('over', key);
    const win = snap.winner === 'crew';
    $('over-title').textContent = win ? 'DRAWINGS WIN' : 'ERASERS WIN';
    $('over-title').className = `logo ${win ? 'good' : 'bad'}`;
    $('over-sub').textContent = snap.winReason;
    const list = $('over-list');
    list.innerHTML = '';
    for (const p of snap.players) {
      const row = document.createElement('div');
      row.className = 'over-row' + (p.alive ? '' : ' out');
      row.innerHTML = `<i style="background:${p.color}"></i><span>${escapeHtml(p.name)}</span>${
        p.id === youId ? '<u>you</u>' : ''
      }<b class="${p.role === 'impostor' ? 'imp' : ''}">${p.role === 'impostor' ? 'ERASER' : 'drawing'}</b>`;
      list.appendChild(row);
    }
    const host = snap.hostId === youId;
    ($('btn-over-again') as HTMLButtonElement).disabled = !host;
    ($('btn-over-again') as HTMLElement).textContent = host ? 'BACK TO LOBBY' : 'waiting for host…';
  }

  // -------------------------------------------------------------------------
  // task modal
  // -------------------------------------------------------------------------

  openTask(task: TaskInfo, onComplete: (id: string) => void) {
    this.closeTask();
    this.taskEl = task;
    $('taskmodal').classList.remove('hidden');
    $('task-title').textContent = task.name;
    const body = $('task-body');
    body.innerHTML = '';
    const game = createTaskGame(task.kind, task.name, () => {
      onComplete(task.id);
      this.closeTask();
    });
    this.taskGame = game;
    body.appendChild(game.canvas);
    sfx.click();
  }

  closeTask() {
    if (this.taskGame) {
      this.taskGame.stop();
      this.taskGame = null;
    }
    if ($('taskmodal')) $('taskmodal').classList.add('hidden');
    if ($('task-body')) $('task-body').innerHTML = '';
    this.taskEl = null;
  }

  get taskOpen() {
    return !!this.taskGame;
  }

  // -------------------------------------------------------------------------
  // minimap
  // -------------------------------------------------------------------------

  drawMap(snap: Snapshot, youId: string) {
    if (!this.mapOpen) return;
    const canvas = $('minimap') as HTMLCanvasElement;
    drawMinimap(
      this.minimapCtx,
      canvas.width,
      canvas.height,
      snap.players.map((p) => ({
        x: p.x,
        z: p.z,
        color: p.color,
        alive: p.alive,
        you: p.id === youId,
      })),
      snap.bodies.map((b) => ({ x: b.x, z: b.z })),
    );
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const NAMES = [
  'Doodler', 'Sketchy', 'Nib', 'Smudge', 'Ballpoint', 'Eraser', 'Hatch', 'Scribble', 'Papyrus', 'No.2 Pencil',
];
function pickName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

export type { VoteResult };
