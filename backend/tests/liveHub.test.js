import http from 'node:http';
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createLiveHub } from '../src/realtime/liveHub.js';

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function connectClient(url, options) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    const messages = [];

    ws.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
    });

    ws.once('open', () => resolve({ ws, messages }));
    ws.once('error', (err) => reject(err));
  });
}

function waitForMessage(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    function onMessage(raw) {
      const parsed = JSON.parse(raw.toString());
      if (predicate(parsed)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(parsed);
      }
    }

    ws.on('message', onMessage);
  });
}

function waitForClose(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for WebSocket close'));
    }, timeoutMs);

    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitUntil(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('liveHub', () => {
  const servers = [];
  const hubs = [];
  const clients = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.terminate();
      }
    }
    for (const hub of hubs.splice(0)) {
      await hub.close();
    }
    for (const server of servers.splice(0)) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  });

  it('sends a hello message on connect', async () => {
    const { server, port } = await startServer();
    servers.push(server);
    const hub = createLiveHub({ server });
    hubs.push(hub);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
    clients.push(ws);

    const hello = await waitForMessage(ws, (msg) => msg.type === 'hello');
    expect(hello.type).toBe('hello');
    expect(typeof hello.data?.serverTime).toBe('string');
    expect(Number.isNaN(Date.parse(hello.data.serverTime))).toBe(false);
  });

  it('broadcasts messages to multiple open clients', async () => {
    const { server, port } = await startServer();
    servers.push(server);
    const hub = createLiveHub({ server });
    hubs.push(hub);

    const c1 = await connectClient(`ws://127.0.0.1:${port}/live`);
    const c2 = await connectClient(`ws://127.0.0.1:${port}/live`);
    clients.push(c1.ws, c2.ws);

    const p1 = waitForMessage(c1.ws, (msg) => msg.type === 'reading');
    const p2 = waitForMessage(c2.ws, (msg) => msg.type === 'reading');

    hub.broadcast({ type: 'reading', data: { temperatura: 25.4 } });

    const [m1, m2] = await Promise.all([p1, p2]);
    expect(m1).toEqual({ type: 'reading', data: { temperatura: 25.4 } });
    expect(m2).toEqual({ type: 'reading', data: { temperatura: 25.4 } });
  });

  it('does not break broadcast when one client is closed', async () => {
    const { server, port } = await startServer();
    servers.push(server);
    const hub = createLiveHub({ server });
    hubs.push(hub);

    const c1 = await connectClient(`ws://127.0.0.1:${port}/live`);
    const c2 = await connectClient(`ws://127.0.0.1:${port}/live`);
    clients.push(c1.ws, c2.ws);

    c1.ws.close();
    await waitForClose(c1.ws);

    const p2 = waitForMessage(c2.ws, (msg) => msg.type === 'alert');
    expect(() => hub.broadcast({ type: 'alert', data: { type: 'temp_high' } })).not.toThrow();

    const m2 = await p2;
    expect(m2).toEqual({ type: 'alert', data: { type: 'temp_high' } });
  });

  it('ignores garbage messages sent by clients', async () => {
    const { server, port } = await startServer();
    servers.push(server);
    const hub = createLiveHub({ server });
    hubs.push(hub);

    const { ws } = await connectClient(`ws://127.0.0.1:${port}/live`);
    clients.push(ws);

    ws.send('not-valid-json{{{');
    ws.send(Buffer.from([0x00, 0xff, 0x10]));

    const p = waitForMessage(ws, (msg) => msg.type === 'reading');
    hub.broadcast({ type: 'reading', data: { ok: true } });
    const msg = await p;
    expect(msg).toEqual({ type: 'reading', data: { ok: true } });
  });

  it('rejects WebSocket upgrade requests on other paths', async () => {
    const { server, port } = await startServer();
    servers.push(server);
    const hub = createLiveHub({ server, path: '/live' });
    hubs.push(hub);

    await expect(connectClient(`ws://127.0.0.1:${port}/other`)).rejects.toThrow();
    expect(hub.clientCount()).toBe(0);
  });

  it('tracks clientCount accurately and closes all clients on close()', async () => {
    const { server, port } = await startServer();
    servers.push(server);
    const hub = createLiveHub({ server });
    hubs.push(hub);

    expect(hub.clientCount()).toBe(0);

    const c1 = await connectClient(`ws://127.0.0.1:${port}/live`);
    const c2 = await connectClient(`ws://127.0.0.1:${port}/live`);
    clients.push(c1.ws, c2.ws);

    expect(hub.clientCount()).toBe(2);

    const closePromises = [waitForClose(c1.ws), waitForClose(c2.ws)];
    await hub.close();
    await Promise.all(closePromises);

    await waitUntil(() => hub.clientCount() === 0, 2000);
    expect(hub.clientCount()).toBe(0);
  });

  it('terminates clients that do not respond to heartbeat pings', async () => {
    const { server, port } = await startServer();
    servers.push(server);
    const hub = createLiveHub({ server, heartbeatMs: 250 });
    hubs.push(hub);

    const responsive = await connectClient(`ws://127.0.0.1:${port}/live`);
    const silent = await connectClient(`ws://127.0.0.1:${port}/live`, { autoPong: false });
    clients.push(responsive.ws, silent.ws);

    await waitForClose(silent.ws, 5000);
    await waitUntil(() => hub.clientCount() === 1, 2000);
    expect(silent.ws.readyState).toBe(WebSocket.CLOSED);
    expect(responsive.ws.readyState).toBe(WebSocket.OPEN);
    expect(hub.clientCount()).toBe(1);
  }, 10000);
});
