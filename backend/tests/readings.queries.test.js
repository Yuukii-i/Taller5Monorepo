import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { createReadingsRepository } from '../src/repositories/readingsRepository.js';

describe('readingsRepository queries with mongodb-memory-server', () => {
  let mongod;
  let client;
  let db;
  let repo;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    const connection = await connectMongo(uri);
    client = connection.client;
    db = connection.db;
    repo = createReadingsRepository(db);
  }, 60000);

  afterAll(async () => {
    if (client) {
      await closeMongo(client);
    }
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(async () => {
    await db.collection('readings').deleteMany({});
  });

  describe('findLatest', () => {
    it('returns null if device has no readings', async () => {
      const result = await repo.findLatest('esp32_none');
      expect(result).toBeNull();
    });

    it('returns the latest reading with normalized shape and ensures per-device isolation', async () => {
      const older = new Date('2026-11-11T10:00:00.000Z');
      const newer = new Date('2026-11-11T11:00:00.000Z');
      const devBTime = new Date('2026-11-11T12:00:00.000Z');

      await repo.insertReading({
        deviceId: 'dev_A',
        temperatura: 20.5,
        humedad: 50.0,
        nivelAgua: 2,
        nivelAguaPct: 50
      }, older);

      await repo.insertReading({
        deviceId: 'dev_A',
        temperatura: 25.5,
        humedad: 60.0,
        nivelAgua: 4,
        nivelAguaPct: 100
      }, newer);

      await repo.insertReading({
        deviceId: 'dev_B',
        temperatura: 30.0,
        humedad: 70.0,
        nivelAgua: 1,
        nivelAguaPct: 25
      }, devBTime);

      const latestA = await repo.findLatest('dev_A');
      expect(latestA).toEqual({
        deviceId: 'dev_A',
        temperatura: 25.5,
        humedad: 60.0,
        nivelAgua: 4,
        nivelAguaPct: 100,
        receivedAt: newer.toISOString()
      });

      const latestB = await repo.findLatest('dev_B');
      expect(latestB).toEqual({
        deviceId: 'dev_B',
        temperatura: 30.0,
        humedad: 70.0,
        nivelAgua: 1,
        nivelAguaPct: 25,
        receivedAt: devBTime.toISOString()
      });
    });
  });

  describe('findRecent', () => {
    it('returns readings ordered newest first respecting limit and per-device isolation', async () => {
      const t1 = new Date('2026-11-11T09:00:00.000Z');
      const t2 = new Date('2026-11-11T10:00:00.000Z');
      const t3 = new Date('2026-11-11T11:00:00.000Z');
      const tOther = new Date('2026-11-11T10:30:00.000Z');

      await repo.insertReading({ deviceId: 'dev_A', temperatura: 10, humedad: 40, nivelAgua: 1, nivelAguaPct: 25 }, t1);
      await repo.insertReading({ deviceId: 'dev_A', temperatura: 20, humedad: 50, nivelAgua: 2, nivelAguaPct: 50 }, t2);
      await repo.insertReading({ deviceId: 'dev_A', temperatura: 30, humedad: 60, nivelAgua: 3, nivelAguaPct: 75 }, t3);
      await repo.insertReading({ deviceId: 'dev_B', temperatura: 99, humedad: 99, nivelAgua: 4, nivelAguaPct: 100 }, tOther);

      const recentA = await repo.findRecent('dev_A', 2);
      expect(recentA).toHaveLength(2);
      expect(recentA[0].receivedAt).toBe(t3.toISOString());
      expect(recentA[0].temperatura).toBe(30);
      expect(recentA[1].receivedAt).toBe(t2.toISOString());
      expect(recentA[1].temperatura).toBe(20);
      expect(recentA[0]).not.toHaveProperty('_id');
    });

    it('returns empty array if device has no readings', async () => {
      const recent = await repo.findRecent('unknown_dev', 5);
      expect(recent).toEqual([]);
    });
  });

  describe('hourlyStats', () => {
    it('aggregates across 3 different hours with correct count/min/max/avg, rounded to 2 decimals, excludes out-of-window rows', async () => {
      const now = new Date('2026-11-11T15:30:00.000Z');

      // Hour 1: 14:00 - 14:59 (within window) -> 2 readings
      const r1a = new Date('2026-11-11T14:10:00.000Z');
      const r1b = new Date('2026-11-11T14:40:00.000Z');
      await repo.insertReading({ deviceId: 'dev_stats', temperatura: 20.0, humedad: 50.0, nivelAgua: 2, nivelAguaPct: 50 }, r1a);
      await repo.insertReading({ deviceId: 'dev_stats', temperatura: 25.55, humedad: 55.45, nivelAgua: 4, nivelAguaPct: 100 }, r1b);

      // Hour 2: 13:00 - 13:59 (within window) -> 1 reading
      const r2 = new Date('2026-11-11T13:20:00.000Z');
      await repo.insertReading({ deviceId: 'dev_stats', temperatura: 15.0, humedad: 40.0, nivelAgua: 1, nivelAguaPct: 25 }, r2);

      // Hour 3: 12:00 - 12:59 (within window for hours = 4) -> 1 reading
      const r3 = new Date('2026-11-11T12:05:00.000Z');
      await repo.insertReading({ deviceId: 'dev_stats', temperatura: 10.0, humedad: 30.0, nivelAgua: 0, nivelAguaPct: 0 }, r3);

      // Excluded: out-of-window (older than 4 hours, e.g. 10:00:00)
      const rOld = new Date('2026-11-11T10:00:00.000Z');
      await repo.insertReading({ deviceId: 'dev_stats', temperatura: 99.0, humedad: 99.0, nivelAgua: 4, nivelAguaPct: 100 }, rOld);

      // Excluded: different device
      const rOtherDev = new Date('2026-11-11T14:15:00.000Z');
      await repo.insertReading({ deviceId: 'dev_other', temperatura: 88.0, humedad: 88.0, nivelAgua: 4, nivelAguaPct: 100 }, rOtherDev);

      const stats = await repo.hourlyStats('dev_stats', 4, now);

      expect(stats).toHaveLength(3);
      // Sorted ascending by hour
      expect(stats[0].hour).toBe('2026-11-11T12:00:00.000Z');
      expect(stats[0].count).toBe(1);
      expect(stats[0].temperatura).toEqual({ avg: 10, min: 10, max: 10 });
      expect(stats[0].humedad).toEqual({ avg: 30, min: 30, max: 30 });
      expect(stats[0].nivelAguaAvg).toBe(0);

      expect(stats[1].hour).toBe('2026-11-11T13:00:00.000Z');
      expect(stats[1].count).toBe(1);
      expect(stats[1].temperatura).toEqual({ avg: 15, min: 15, max: 15 });
      expect(stats[1].humedad).toEqual({ avg: 40, min: 40, max: 40 });
      expect(stats[1].nivelAguaAvg).toBe(1);

      expect(stats[2].hour).toBe('2026-11-11T14:00:00.000Z');
      expect(stats[2].count).toBe(2);
      // avg temp: (20.0 + 25.55)/2 = 22.775 -> 22.78
      expect(stats[2].temperatura.avg).toBe(22.78);
      expect(stats[2].temperatura.min).toBe(20.0);
      expect(stats[2].temperatura.max).toBe(25.55);
      // avg hum: (50.0 + 55.45)/2 = 52.725 -> 52.73
      expect(stats[2].humedad.avg).toBe(52.73);
      expect(stats[2].humedad.min).toBe(50.0);
      expect(stats[2].humedad.max).toBe(55.45);
      // avg water: (2 + 4)/2 = 3
      expect(stats[2].nivelAguaAvg).toBe(3);
    });
  });

  describe('listDeviceIds', () => {
    it('returns sorted unique device IDs', async () => {
      await repo.insertReading({ deviceId: 'zebra', temperatura: 20, humedad: 50, nivelAgua: 1, nivelAguaPct: 25 });
      await repo.insertReading({ deviceId: 'alpha', temperatura: 22, humedad: 52, nivelAgua: 2, nivelAguaPct: 50 });
      await repo.insertReading({ deviceId: 'zebra', temperatura: 21, humedad: 51, nivelAgua: 1, nivelAguaPct: 25 });
      await repo.insertReading({ deviceId: 'beta', temperatura: 23, humedad: 53, nivelAgua: 3, nivelAguaPct: 75 });

      const devices = await repo.listDeviceIds();
      expect(devices).toEqual(['alpha', 'beta', 'zebra']);
    });
  });
});
