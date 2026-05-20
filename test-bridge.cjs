const WebSocket = require('/home/marsh-office/papercupai-workspace/papercup/node_modules/ws');
const TOKEN = 'PsPitoBOaHKwrxXxqCUkZiMDylMUpfG5';
const PORT = 43379;
const tries = [
  `ws://127.0.0.1:${PORT}/`,
  `ws://127.0.0.1:${PORT}/?token=${TOKEN}`,
  `ws://127.0.0.1:${PORT}/ws`,
  `ws://127.0.0.1:${PORT}/ws?token=${TOKEN}`,
  `ws://127.0.0.1:${PORT}/mcp`,
  `ws://127.0.0.1:${PORT}/mcp?token=${TOKEN}`,
];
(async () => {
  for (const url of tries) {
    await new Promise((res) => {
      const ws = new WebSocket(url, { headers: { 'authorization': `Bearer ${TOKEN}` } });
      const t = setTimeout(() => { console.log(url, 'TIMEOUT'); ws.terminate(); res(); }, 1500);
      ws.on('open', () => { console.log(url, 'OPEN'); clearTimeout(t); ws.close(); res(); });
      ws.on('error', (e) => { console.log(url, 'ERR', e.message); clearTimeout(t); res(); });
    });
  }
})();
