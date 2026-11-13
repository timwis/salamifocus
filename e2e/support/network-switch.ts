import http from 'node:http';
import type { Socket } from 'node:net';
import { parseArgs } from 'node:util';

// A pass-through HTTP proxy that tests can switch "offline", which drops open
// connections (including sync streams) and refuses new ones until switched
// back. It stands between a client and the app server, so the client stays
// running and keeps its local data while the server becomes unreachable.
// With --only, just requests under those path prefixes are cut off, so a web
// page can still load from the dev server while the app server is away.
const { values } = parseArgs({
  options: {
    listen: { type: 'string' },
    control: { type: 'string' },
    target: { type: 'string' },
    only: { type: 'string' },
  },
});
const prefixes = values.only ? values.only.split(',') : ['/'];
const switched = (url: string | undefined) => prefixes.some((prefix) => (url ?? '/').startsWith(prefix));
const listenPort = Number(values.listen);
const controlPort = Number(values.control);
const target = new URL(values.target ?? 'http://127.0.0.1:3100');

let online = true;
const sockets = new Set<Socket>();

const proxy = http.createServer((req, res) => {
  if (!switched(req.url)) return forward(req, res);
  if (!online) return req.socket.destroy();
  const socket = req.socket;
  if (!sockets.has(socket)) {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  }
  forward(req, res);
});

function forward(req: http.IncomingMessage, res: http.ServerResponse) {
  const upstream = http.request(
    { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => res.destroy());
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

const control = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/offline') {
    online = false;
    for (const socket of sockets) socket.destroy();
  } else if (req.method === 'POST' && req.url === '/online') {
    online = true;
  } else if (req.url !== '/') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ online }));
});

proxy.listen(listenPort, '0.0.0.0');
control.listen(controlPort, '0.0.0.0', () => {
  console.log(`network switch: :${listenPort} -> ${target.origin}, control on :${controlPort}`);
});
