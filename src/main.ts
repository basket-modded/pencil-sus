import './style.css';
import { World } from './render/world';
import { UI } from './ui';
import { Game } from './game';
import { LocalLink, WsLink, makeCode, type Link } from './net';
import { sfx } from './audio';

const stage = document.getElementById('stage')!;
const world = new World(stage);
const ui = new UI();
const game = new Game(world, ui);

let session = 0;
let activeLink: Link | null = null;

function teardown() {
  activeLink?.close();
  activeLink = null;
  game.detach();
}

function startRoom(code: string, name: string, color: string) {
  const id = ++session;
  teardown();
  ui.offlineNote = null;
  ui.setCode(code);
  ui.setStatus(`sharpening a pencil for room ${code}…`);
  ui.show('lobby');
  const ws = new WsLink(code, name, color);
  activeLink = ws;
  game.attach(ws);
  let everOnline = false;
  let settled = false;

  const fallback = (why: string) => {
    if (settled || id !== session) return;
    settled = true;
    if (!everOnline) {
      ui.setStatus(`${why} — playing this page offline with doodle bots`, 'info');
      startLocal(code, name, color, 4);
      ui.offlineNote = 'offline page mode — the crew is doodle bots';
    } else {
      ui.setStatus('connection lost. back to the menu.', 'bad');
      ui.show('menu');
      teardown();
    }
  };

  ws.onStatus((s) => {
    if (id !== session) return;
    if (s === 'online') {
      everOnline = true;
      ui.setStatus('');
    }
    if (s === 'offline') fallback('no game server here');
  });

  window.setTimeout(() => {
    if (!everOnline && !settled && id === session) fallback('no game server here');
  }, 3200);
}

function startLocal(code: string, name: string, color: string, bots = 3) {
  const id = ++session;
  teardown();
  ui.setCode(code);
  const link = new LocalLink(code, name, color, bots);
  activeLink = link;
  game.attach(link);
  link.onStatus(() => {
    if (id === session) ui.setStatus('offline page mode · doodle bots are the crew', 'info');
  });
  ui.show('lobby');
}

ui.actions = {
  createRoom: (name, color) => startRoom(makeCode(), name, color),
  joinRoom: (code, name, color) => startRoom(code, name, color),
  solo: (name, color) => {
    ui.setStatus('');
    startLocal(makeCode(), name, color, 4);
    ui.offlineNote = 'solo page — press ADD DOODLE BOT for more crew';
  },
  start: () => game.command({ t: 'start' }),
  addBot: () => game.command({ t: 'addBot' }),
  kickBot: () => game.command({ t: 'kickBot' }),
  leave: () => {
    session++;
    teardown();
    ui.show('menu');
    ui.setStatus('left the page.', 'info');
  },
  use: () => game.use(),
  sabotage: (kind) => game.command({ t: 'sabotage', kind }),
  vote: (id) => game.command({ t: 'vote', target: id }),
  restart: () => game.command({ t: 'restart' }),
  taskDone: () => {},
  mapToggle: () => {},
  emote: () => {},
};

// deep link: #ABCD
const hash = location.hash.replace('#', '').toUpperCase();
if (/^[A-Z0-9]{4}$/.test(hash)) {
  const input = document.getElementById('code-input') as HTMLInputElement;
  input.value = hash;
}

// resume audio on the first gesture
const wake = () => {
  sfx.click();
  window.removeEventListener('pointerdown', wake);
  window.removeEventListener('keydown', wake);
};
window.addEventListener('pointerdown', wake);
window.addEventListener('keydown', wake);

ui.show('menu');
ui.setStatus('');
