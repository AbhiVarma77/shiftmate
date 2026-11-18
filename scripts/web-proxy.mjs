// Local web preview proxy.
// expo-sqlite on web needs SharedArrayBuffer, which browsers only enable on
// cross-origin-isolated pages. Expo's dev server doesn't send the required
// headers on the HTML document, so this proxy adds them to every response
// (including the hot-reload WebSocket) in front of Metro.
//
// Usage: npm run web:local   → open http://localhost:8082
import http from 'node:http';
import net from 'node:net';

const TARGET_PORT = Number(process.env.METRO_PORT ?? 8081);
const PORT = Number(process.env.PROXY_PORT ?? 8082);
const ISOLATION = {
  'cross-origin-embedder-policy': 'credentialless',
  'cross-origin-opener-policy': 'same-origin',
};

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: '127.0.0.1', port: TARGET_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${TARGET_PORT}` } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...ISOLATION });
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Metro is not running on port ${TARGET_PORT}. Start it with: npx expo start --web`);
  });
  req.pipe(upstream);
});

// Pass WebSocket upgrades (hot reload) straight through.
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(TARGET_PORT, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, () => console.log(`ShiftMate web preview → http://localhost:${PORT} (proxying Metro on ${TARGET_PORT})`));
