import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis-mock';
import { createAlertService } from '../src/services/alertService.js';
import { createLiveStateRepository, KEYS } from '../src/repositories/liveStateRepository.js';

describe('alertService', () => {
  let redisClient;
  let liveState;
  let alertsRepo;

  beforeEach(async () => {
    redisClient = new Redis();
    await redisClient.flushall();
    liveState = createLiveStateRepository(redisClient);
    let idCounter = 1;
    alertsRepo = {
      insertAlert: vi.fn().mockImplementation(async () => `alert-id-${idCounter++}`)
    };
  });

  afterEach(async () => {
    if (redisClient) {
      await redisClient.flushall();
      redisClient.disconnect();
    }
  });

  it('fires once then suppresses subsequent alerts during cooldown', async () => {
    const service = createAlertService({
      alertsRepo,
      liveState,
      cooldownSeconds: 60
    });

    const highTempReading = {
      deviceId: 'esp32_1',
      temperatura: 35.0,
      nivelAgua: 3
    };

    const firstRun = await service.process(highTempReading);
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0].type).toBe('temp_high');
    expect(firstRun[0].id).toBe('alert-id-1');
    expect(alertsRepo.insertAlert).toHaveBeenCalledTimes(1);

    const secondRun = await service.process(highTempReading);
    expect(secondRun).toHaveLength(0);
    expect(alertsRepo.insertAlert).toHaveBeenCalledTimes(1);
  });

  it('handles different alert types and different devices independently', async () => {
    const service = createAlertService({
      alertsRepo,
      liveState,
      cooldownSeconds: 60
    });

    // Alert temp_high on device_1
    const device1Temp = await service.process({
      deviceId: 'esp32_1',
      temperatura: 35.0,
      nivelAgua: 3
    });
    expect(device1Temp).toHaveLength(1);
    expect(device1Temp[0].type).toBe('temp_high');

    // Alert water_low on device_1 (different type -> allowed)
    const device1Water = await service.process({
      deviceId: 'esp32_1',
      temperatura: 25.0,
      nivelAgua: 1,
      nivelAguaPct: 25
    });
    expect(device1Water).toHaveLength(1);
    expect(device1Water[0].type).toBe('water_low');

    // Alert temp_high on device_2 (different device -> allowed)
    const device2Temp = await service.process({
      deviceId: 'esp32_2',
      temperatura: 35.0,
      nivelAgua: 3
    });
    expect(device2Temp).toHaveLength(1);
    expect(device2Temp[0].type).toBe('temp_high');
    expect(device2Temp[0].deviceId).toBe('esp32_2');

    expect(alertsRepo.insertAlert).toHaveBeenCalledTimes(3);
  });

  it('allows alert again after cooldown key is deleted', async () => {
    const service = createAlertService({
      alertsRepo,
      liveState,
      cooldownSeconds: 60
    });

    const reading = {
      deviceId: 'esp32_1',
      temperatura: 35.0,
      nivelAgua: 3
    };

    const first = await service.process(reading);
    expect(first).toHaveLength(1);

    // Suppressed while key exists
    const second = await service.process(reading);
    expect(second).toHaveLength(0);

    // Remove the cooldown key from Redis
    await redisClient.del(KEYS.alertCooldown('esp32_1', 'temp_high'));

    // Now it should be allowed again
    const third = await service.process(reading);
    expect(third).toHaveLength(1);
    expect(alertsRepo.insertAlert).toHaveBeenCalledTimes(2);
  });

  it('falls back to in-memory cooldown with expiry by injected now when liveState throws or fails', async () => {
    let mockTime = 100000;
    const now = () => mockTime;

    const failingLiveState = {
      acquireCooldown: vi.fn().mockRejectedValue(new Error('Redis connection down')),
      publishAlert: vi.fn().mockResolvedValue(undefined)
    };

    const service = createAlertService({
      alertsRepo,
      liveState: failingLiveState,
      cooldownSeconds: 60,
      now
    });

    const reading = {
      deviceId: 'esp32_fallback',
      temperatura: 34.0,
      nivelAgua: 3
    };

    // First trigger: allowed via in-memory fallback
    const first = await service.process(reading);
    expect(first).toHaveLength(1);
    expect(failingLiveState.acquireCooldown).toHaveBeenCalledTimes(1);

    // Second trigger at 30 seconds later: suppressed by in-memory cooldown
    mockTime += 30 * 1000;
    const second = await service.process(reading);
    expect(second).toHaveLength(0);

    // Third trigger at 61 seconds after start: expired, allowed again
    mockTime += 31 * 1000;
    const third = await service.process(reading);
    expect(third).toHaveLength(1);
    expect(alertsRepo.insertAlert).toHaveBeenCalledTimes(2);
  });

  it('publishes alert to alerts channel and is received by subscriber', async () => {
    const sub = redisClient.duplicate();
    await sub.subscribe(KEYS.alertsChannel);

    const receivedMessagePromise = new Promise((resolve) => {
      sub.on('message', (channel, message) => {
        if (channel === KEYS.alertsChannel) {
          resolve(JSON.parse(message));
        }
      });
    });

    const service = createAlertService({
      alertsRepo,
      liveState,
      cooldownSeconds: 60
    });

    const reading = {
      deviceId: 'esp32_pub',
      temperatura: 36.0,
      nivelAgua: 3
    };

    const created = await service.process(reading);
    expect(created).toHaveLength(1);

    const published = await receivedMessagePromise;
    expect(published).toEqual({
      type: 'alert',
      data: {
        id: created[0].id,
        deviceId: 'esp32_pub',
        type: 'temp_high',
        value: 36.0,
        threshold: 30,
        message: created[0].message,
        createdAt: created[0].createdAt.toISOString()
      }
    });

    await sub.unsubscribe(KEYS.alertsChannel);
    sub.disconnect();
  });

  it('still stores alert and returns created alerts when liveState.publishAlert fails', async () => {
    const liveStateWithFailingPublish = {
      acquireCooldown: vi.fn().mockResolvedValue(true),
      publishAlert: vi.fn().mockRejectedValue(new Error('Publish failed'))
    };

    const service = createAlertService({
      alertsRepo,
      liveState: liveStateWithFailingPublish,
      cooldownSeconds: 60
    });

    const reading = {
      deviceId: 'esp32_pubfail',
      temperatura: 33.0,
      nivelAgua: 3
    };

    const created = await service.process(reading);
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('temp_high');
    expect(alertsRepo.insertAlert).toHaveBeenCalledTimes(1);
  });
});
