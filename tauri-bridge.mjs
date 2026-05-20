import { WebSocket } from 'ws';
const PORT = 43379;
const TOKEN = 'PsPitoBOaHKwrxXxqCUkZiMDylMUpfG5';
const CMD = process.argv[2];
const ARGS = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const ws = new WebSocket(`ws://127.0.0.1:${PORT}?token=${TOKEN}`);
let timer;
ws.on('open', () => {
  ws.send(JSON.stringify({ id: 'r1', command: CMD, args: ARGS }));
  timer = setTimeout(() => { console.error('timeout'); process.exit(2); }, 8000);
});
ws.on('message', (msg) => {
  const r = JSON.parse(msg.toString());
  if (r.id === 'r1' || r.command === CMD) {
    console.log(JSON.stringify(r, null, 2));
    clearTimeout(timer); ws.close(); process.exit(0);
  }
});
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(3); });
