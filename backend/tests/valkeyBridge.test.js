import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis-mock';
import { createValkeyBridge } from '../src/realtime/valkeyBridge.js';

function waitTicks(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('valkeyBridge', () => {
  let publisher;
  let subscriber;
  let bridge;

  beforeEach(async () => {
    publisher = new Redis();
    subscriber = new Redis();
    await publisher.flushall();
  });

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
      bridge = null;
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

  it('forwards reading and alert messages to hub.broadcast', async () => {
    const hub = { broadcast: vi.fn() };
    bridge = createValkeyBridge({ subscriber, hub });
    await bridge.start();

    const readingMsg = { type: 'reading', data: { deviceId: 'esp32_1', temperatura: 24.5 } };
    const alertMsg = { type: 'alert', data: { deviceId: 'esp32_1', type: 'temp_high' } };

    await publisher.publish('readings', JSON.stringify(readingMsg));
    await publisher.publish('alerts', JSON.stringify(alertMsg));
    await waitTicks();

    expect(hub.broadcast).toHaveBeenCalledTimes(2);
    expect(hub.broadcast).toHaveBeenNthCalledWith(1, readingMsg);
    expect(hub.broadcast).toHaveBeenNthCalledWith(2, alertMsg);
  });

  it('ignores invalid JSON and objects without a string type', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hub = { broadcast: vi.fn() };
    bridge = createValkeyBridge({ subscriber, hub });
    await bridge.start();

    await publisher.publish('readings', 'not-json{');
    await publisher.publish('readings', JSON.stringify({ data: { temperatura: 20 } }));
    await publisher.publish('alerts', JSON.stringify({ type: 123, data: {} }));
    await publisher.publish('alerts', JSON.stringify(['array-not-object']));
    await waitTicks();

    expect(hub.broadcast).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(4);
  });

  it('stops forwarding messages after stop()', async () => {
    const hub = { broadcast: vi.fn() };
    bridge = createValkeyBridge({ subscriber, hub });
    await bridge.start();

    await publisher.publish('readings', JSON.stringify({ type: 'reading', data: { n: 1 } }));
    await waitTicks();
    expect(hub.broadcast).toHaveBeenCalledTimes(1);

    await bridge.stop();

    await publisher.publish('readings', JSON.stringify({ type: 'reading', data: { n: 2 } }));
    await publisher.publish('alerts', JSON.stringify({ type: 'alert', data: { n: 3 } }));
    await waitTicks();

    expect(hub.broadcast).toHaveBeenCalledTimes(1);
  });
});
