import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { createLiveStateRepository, KEYS } from '../src/repositories/liveStateRepository.js';

describe('liveStateRepository', () => {
  let client;
  let repo;

  beforeEach(async () => {
    client = new RedisMock();
    await client.flushall();
    repo = createLiveStateRepository(client, { recentMax: 10, onlineTtlSeconds: 30 });
  });

  afterEach(async () => {
    if (client) {
      await client.flushall();
      client.disconnect();
    }
  });

  it('caps recent readings at 10 after 15 inserts, ordering newest first', async () => {
    for (let i = 1; i <= 15; i++) {
      await repo.saveReading({
        deviceId: 'esp32_1',
        temperatura: 20 + i,
        humedad: 50,
        nivelAgua: 2,
        nivelAguaPct: 50,
        receivedAt: new Date(1700000000000 + i * 1000).toISOString()
      });
    }

    const recent = await repo.getRecent('esp32_1');
    expect(recent).toHaveLength(10);
    // Newest first: the first item should be the 15th reading
    expect(recent[0].temperatura).toBe(35);
    // The 10th item should be the 6th reading (1 to 5 trimmed off)
    expect(recent[9].temperatura).toBe(26);
  });

  it('overwrites latest reading with subsequent writes', async () => {
    await repo.saveReading({
      deviceId: 'esp32_1',
      temperatura: 21.0,
      humedad: 50.0,
      nivelAgua: 1,
      nivelAguaPct: 25,
      receivedAt: '2026-11-10T10:00:00.000Z'
    });

    await repo.saveReading({
      deviceId: 'esp32_1',
      temperatura: 29.5,
      humedad: 75.0,
      nivelAgua: 3,
      nivelAguaPct: 75,
      receivedAt: '2026-11-10T10:01:00.000Z'
    });

    const latest = await repo.getLatest('esp32_1');
    expect(latest).not.toBeNull();
    expect(latest.temperatura).toBe(29.5);
    expect(latest.humedad).toBe(75.0);
    expect(latest.nivelAgua).toBe(3);
    expect(latest.nivelAguaPct).toBe(75);
    expect(latest.receivedAt).toBe('2026-11-10T10:01:00.000Z');
  });

  it('restores numbers from hash storage as real numbers', async () => {
    await repo.saveReading({
      deviceId: 'esp32_1',
      temperatura: 24.55,
      humedad: 61.2,
      nivelAgua: 2,
      nivelAguaPct: 50,
      receivedAt: '2026-11-10T12:00:00.000Z'
    });

    const latest = await repo.getLatest('esp32_1');
    expect(typeof latest.temperatura).toBe('number');
    expect(latest.temperatura).toBe(24.55);
    expect(typeof latest.humedad).toBe('number');
    expect(latest.humedad).toBe(61.2);
    expect(typeof latest.nivelAgua).toBe('number');
    expect(latest.nivelAgua).toBe(2);
    expect(typeof latest.nivelAguaPct).toBe('number');
    expect(latest.nivelAguaPct).toBe(50);
    expect(typeof latest.deviceId).toBe('string');
    expect(latest.deviceId).toBe('esp32_1');
    expect(typeof latest.receivedAt).toBe('string');
  });

  it('returns null for getLatest on unknown device', async () => {
    const latest = await repo.getLatest('unknown');
    expect(latest).toBeNull();
  });

  it('checks online state: true + TTL > 0 when active, false for unknown', async () => {
    await repo.saveReading({
      deviceId: 'esp32_online',
      temperatura: 20.0,
      humedad: 50.0,
      nivelAgua: 1,
      nivelAguaPct: 25,
      receivedAt: new Date().toISOString()
    });

    expect(await repo.isOnline('esp32_online')).toBe(true);
    const ttl = await client.ttl(KEYS.online('esp32_online'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);

    expect(await repo.isOnline('unknown_device')).toBe(false);
  });

  it('maintains a deduped and sorted list of devices', async () => {
    await repo.saveReading({
      deviceId: 'device_c',
      temperatura: 20,
      humedad: 50,
      nivelAgua: 1,
      nivelAguaPct: 25,
      receivedAt: new Date().toISOString()
    });
    await repo.saveReading({
      deviceId: 'device_a',
      temperatura: 22,
      humedad: 55,
      nivelAgua: 2,
      nivelAguaPct: 50,
      receivedAt: new Date().toISOString()
    });
    // Duplicate insertion for device_a
    await repo.saveReading({
      deviceId: 'device_a',
      temperatura: 23,
      humedad: 56,
      nivelAgua: 2,
      nivelAguaPct: 50,
      receivedAt: new Date().toISOString()
    });
    await repo.saveReading({
      deviceId: 'device_b',
      temperatura: 21,
      humedad: 52,
      nivelAgua: 1,
      nivelAguaPct: 25,
      receivedAt: new Date().toISOString()
    });

    const devices = await repo.listDevices();
    expect(devices).toEqual(['device_a', 'device_b', 'device_c']);
  });

  it('ensures per-device data isolation', async () => {
    await repo.saveReading({
      deviceId: 'dev_1',
      temperatura: 15.0,
      humedad: 40.0,
      nivelAgua: 0,
      nivelAguaPct: 0,
      receivedAt: new Date().toISOString()
    });
    await repo.saveReading({
      deviceId: 'dev_2',
      temperatura: 30.0,
      humedad: 80.0,
      nivelAgua: 4,
      nivelAguaPct: 100,
      receivedAt: new Date().toISOString()
    });

    const dev1Latest = await repo.getLatest('dev_1');
    const dev2Latest = await repo.getLatest('dev_2');
    expect(dev1Latest.temperatura).toBe(15.0);
    expect(dev2Latest.temperatura).toBe(30.0);

    const dev1Recent = await repo.getRecent('dev_1');
    const dev2Recent = await repo.getRecent('dev_2');
    expect(dev1Recent).toHaveLength(1);
    expect(dev2Recent).toHaveLength(1);
    expect(dev1Recent[0].deviceId).toBe('dev_1');
    expect(dev2Recent[0].deviceId).toBe('dev_2');
  });

  it('publishes JSON reading to subscriber via second mock connection', async () => {
    const subscriber = new RedisMock();
    const receivedMessages = [];

    await subscriber.subscribe(KEYS.readings);
    subscriber.on('message', (channel, message) => {
      receivedMessages.push({ channel, data: JSON.parse(message) });
    });

    const readingPayload = {
      deviceId: 'esp32_pub',
      temperatura: 25.4,
      humedad: 58.0,
      nivelAgua: 2,
      nivelAguaPct: 50,
      receivedAt: '2026-11-10T15:30:00.000Z'
    };

    await repo.saveReading(readingPayload);

    // Give microtasks / event-loop tick a moment if needed
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].channel).toBe('readings');
    expect(receivedMessages[0].data).toEqual({
      type: 'reading',
      data: readingPayload
    });

    subscriber.disconnect();
  });
});
