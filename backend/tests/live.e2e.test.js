import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis-mock';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { createIngestService } from '../src/services/ingestService.js';
import { createLiveStateRepository } from '../src/repositories/liveStateRepository.js';
import { createAlertService } from '../src/services/alertService.js';
import { createLiveHub } from '../src/realtime/liveHub.js';
import { createValkeyBridge } from '../src/realtime/valkeyBridge.js';

describe('live WebSocket end-to-end', () => {
  let publisher;
  let subscriber;
  let server;
  let hub;
  let bridge;
  let ws;

  beforeEach(async () => {
    publisher = new Redis();
    subscriber = new Redis();
    await publisher.flushall();
  });

  afterEach(async () => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.terminate();
      ws = null;
    }
    if (bridge) {
      await bridge.stop();
      bridge = null;
    }
    if (hub) {
      await hub.close();
      hub = null;
    }
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    }
    if (subscriber) {
      subscriber.disconnect();
      subscriber = null;
    }
    if (publisher) {
      await publisher.flushall();
      publisher.disconnect();
      publisher = null;
    }
    vi.restoreAllMocks();
  });

  it('delivers both reading and alert messages over WebSocket after POST /sensor-data', async () => {
    const fakeReadingsRepo = {
      insertReading: vi.fn().mockResolvedValue('reading-id-1')
    };
    const fakeAlertsRepo = {
      insertAlert: vi.fn().mockResolvedValue('alert-id-1')
    };
    const liveState = createLiveStateRepository(publisher);
    const alertService = createAlertService({
      alertsRepo: fakeAlertsRepo,
      liveState
    });
    const ingestService = createIngestService({
      readingsRepo: fakeReadingsRepo,
      liveState,
      alertService
    });

    const app = createApp({ ingestService, liveState });
    server = http.createServer(app);
    hub = createLiveHub({ server, path: '/live' });
    bridge = createValkeyBridge({ subscriber, hub });
    await bridge.start();

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();

    const received = [];
    let settled = false;

    const bothReceived = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!settled) {
          reject(new Error(`Timed out; received types: ${received.map((m) => m.type).join(', ')}`));
        }
      }, 2000);

      ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        received.push(msg);
        const hasReading = received.some((m) => m.type === 'reading');
        const hasAlert = received.some((m) => m.type === 'alert');
        if (hasReading && hasAlert) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    await new Promise((resolve) => ws.once('open', resolve));

    const res = await fetch(`http://127.0.0.1:${port}/sensor-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'esp32_1',
        temperatura: 35,
        humedad: 50,
        nivelAgua: 3,
        nivelAguaPct: 75
      })
    });

    expect(res.status).toBe(201);
    await bothReceived;

    const readingMsg = received.find((m) => m.type === 'reading');
    const alertMsg = received.find((m) => m.type === 'alert');

    expect(readingMsg.data.deviceId).toBe('esp32_1');
    expect(readingMsg.data.temperatura).toBe(35);
    expect(alertMsg.data.type).toBe('temp_high');
    expect(alertMsg.data.deviceId).toBe('esp32_1');
  });
});
