// Quick room-server check over real WebSockets: create, join, start, ghost ball, results.
// Usage: node scripts/wssmoke.mjs [ws-url]
import WebSocket from 'ws';

const url = process.argv[2] ?? 'ws://localhost:8787/ws';

function client(name) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    inbox.push(m);
    for (const w of [...waiters]) if (w.test(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m));
  });
  const ready = new Promise((r) => ws.on('open', r));
  return {
    ws,
    async send(m) {
      await ready;
      ws.send(JSON.stringify(m));
    },
    wait(test, label) {
      const hit = inbox.find(test);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        waiters.push({ test, resolve });
        setTimeout(() => reject(new Error(`${name}: timed out waiting for ${label}`)), 8000);
      });
    },
    hello: () => ({ t: 'hello', profile: { name, color: '#ff3d7f', avatar: '🦄' } }),
  };
}

const mia = client('Mia');
const zoe = client('Zoe');
await mia.send(mia.hello());
await mia.send({ t: 'create' });
const { room } = await mia.wait((m) => m.t === 'room', 'room');
console.log('created room', room.code);
await zoe.send(zoe.hello());
await zoe.send({ t: 'join', code: room.code });
await mia.wait((m) => m.t === 'room' && m.room.players.length === 2, 'friend in room');
console.log('friend joined');
await mia.send({ t: 'start', stageId: 'moon' });
const [a, b] = await Promise.all([mia.wait((m) => m.t === 'start', 'start'), zoe.wait((m) => m.t === 'start', 'start')]);
console.log('both started, same seed:', a.seed === b.seed);
await zoe.send({ t: 'ball', p: [1, 2, 3] });
await mia.wait((m) => m.t === 'ball' && m.id, 'ghost ball');
console.log('ghost ball relayed');
await mia.send({ t: 'ping' });
await mia.send({ t: 'finish', score: 30, made: 9, shots: 10, stars: 3 });
await zoe.send({ t: 'finish', score: 22, made: 7, shots: 10, stars: 2 });
const res = await zoe.wait((m) => m.t === 'results', 'results');
console.log('results:', res.ranking.map((r) => `${r.name} ${r.score}`).join(', '));
mia.ws.close();
zoe.ws.close();
