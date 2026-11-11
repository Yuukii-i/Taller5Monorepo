import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Query Routes (GET endpoints)', () => {
  const sampleReading = {
    deviceId: 'esp32_mock',
    temperatura: 24.5,
    humedad: 60.2,
    nivelAgua: 2,
    nivelAguaPct: 50,
    receivedAt: '2026-11-11T12:00:00.000Z'
  };

  describe('GET /devices', () => {
    it('returns devices with online status from Valkey on happy path', async () => {
      const liveState = {
        listDevices: vi.fn().mockResolvedValue(['dev1', 'dev2']),
        isOnline: vi.fn().mockImplementation((id) => Promise.resolve(id === 'dev1'))
      };
      const readingsRepo = {
        listDeviceIds: vi.fn()
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/devices');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        devices: [
          { deviceId: 'dev1', online: true },
          { deviceId: 'dev2', online: false }
        ]
      });
      expect(readingsRepo.listDeviceIds).not.toHaveBeenCalled();
    });

    it('falls back to Mongo listDeviceIds when Valkey returns empty list', async () => {
      const liveState = {
        listDevices: vi.fn().mockResolvedValue([]),
        isOnline: vi.fn().mockResolvedValue(false)
      };
      const readingsRepo = {
        listDeviceIds: vi.fn().mockResolvedValue(['dev_mongo'])
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/devices');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        devices: [{ deviceId: 'dev_mongo', online: false }]
      });
      expect(readingsRepo.listDeviceIds).toHaveBeenCalled();
    });

    it('falls back to Mongo listDeviceIds when Valkey throws, online is false', async () => {
      const liveState = {
        listDevices: vi.fn().mockRejectedValue(new Error('Valkey unreachable')),
        isOnline: vi.fn().mockRejectedValue(new Error('Valkey unreachable'))
      };
      const readingsRepo = {
        listDeviceIds: vi.fn().mockResolvedValue(['dev_fallback'])
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/devices');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        devices: [{ deviceId: 'dev_fallback', online: false }]
      });
    });

    it('returns 500 internal_error when readingsRepo throws on fallback', async () => {
      const liveState = {
        listDevices: vi.fn().mockRejectedValue(new Error('Valkey down'))
      };
      const readingsRepo = {
        listDeviceIds: vi.fn().mockRejectedValue(new Error('Mongo fatal query failure'))
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/devices');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ ok: false, error: 'internal_error' });
      expect(JSON.stringify(res.body)).not.toContain('Mongo fatal query failure');
    });
  });

  describe('GET /readings/latest', () => {
    it('returns 200 with source: valkey when Valkey has the latest reading', async () => {
      const liveState = {
        getLatest: vi.fn().mockResolvedValue(sampleReading)
      };
      const readingsRepo = {
        findLatest: vi.fn()
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/latest?deviceId=esp32_mock');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        source: 'valkey',
        data: sampleReading
      });
      expect(readingsRepo.findLatest).not.toHaveBeenCalled();
    });

    it('falls back to Mongo when Valkey returns null (cache miss)', async () => {
      const liveState = {
        getLatest: vi.fn().mockResolvedValue(null)
      };
      const readingsRepo = {
        findLatest: vi.fn().mockResolvedValue(sampleReading)
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/latest?deviceId=esp32_mock');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        source: 'mongo',
        data: sampleReading
      });
      expect(readingsRepo.findLatest).toHaveBeenCalledWith('esp32_mock');
    });

    it('falls back to Mongo when Valkey throws', async () => {
      const liveState = {
        getLatest: vi.fn().mockRejectedValue(new Error('Valkey conn reset'))
      };
      const readingsRepo = {
        findLatest: vi.fn().mockResolvedValue(sampleReading)
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/latest?deviceId=esp32_mock');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        source: 'mongo',
        data: sampleReading
      });
    });

    it('returns 404 not_found when both Valkey and Mongo have no reading', async () => {
      const liveState = {
        getLatest: vi.fn().mockResolvedValue(null)
      };
      const readingsRepo = {
        findLatest: vi.fn().mockResolvedValue(null)
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/latest?deviceId=esp32_mock');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ ok: false, error: 'not_found' });
    });

    it('returns 400 when deviceId query parameter is missing', async () => {
      const app = createApp({});
      const res = await request(app).get('/readings/latest');

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'deviceId' })
        ])
      );
    });

    it('returns 400 when deviceId is whitespace or exceeds 64 characters', async () => {
      const app = createApp({});
      const resBlank = await request(app).get('/readings/latest?deviceId=%20%20');
      expect(resBlank.status).toBe(400);
      expect(resBlank.body.errors[0].field).toBe('deviceId');

      const longId = 'a'.repeat(65);
      const resLong = await request(app).get(`/readings/latest?deviceId=${longId}`);
      expect(resLong.status).toBe(400);
      expect(resLong.body.errors[0].field).toBe('deviceId');
    });

    it('returns 500 internal_error when readingsRepo throws', async () => {
      const liveState = {
        getLatest: vi.fn().mockResolvedValue(null)
      };
      const readingsRepo = {
        findLatest: vi.fn().mockRejectedValue(new Error('Mongo network timeout'))
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/latest?deviceId=esp32_mock');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ ok: false, error: 'internal_error' });
    });
  });

  describe('GET /readings/recent', () => {
    it('returns 200 with source: valkey when limit <= 10 and Valkey has records', async () => {
      const liveState = {
        getRecent: vi.fn().mockResolvedValue([sampleReading])
      };
      const readingsRepo = {
        findRecent: vi.fn()
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/recent?deviceId=esp32_mock&limit=5');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        source: 'valkey',
        data: [sampleReading]
      });
      expect(readingsRepo.findRecent).not.toHaveBeenCalled();
    });

    it('falls back to Mongo when limit <= 10 but Valkey returns empty list', async () => {
      const liveState = {
        getRecent: vi.fn().mockResolvedValue([])
      };
      const readingsRepo = {
        findRecent: vi.fn().mockResolvedValue([sampleReading])
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/recent?deviceId=esp32_mock&limit=5');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        source: 'mongo',
        data: [sampleReading]
      });
      expect(readingsRepo.findRecent).toHaveBeenCalledWith('esp32_mock', 5);
    });

    it('falls back to Mongo when limit <= 10 and Valkey throws', async () => {
      const liveState = {
        getRecent: vi.fn().mockRejectedValue(new Error('Valkey error'))
      };
      const readingsRepo = {
        findRecent: vi.fn().mockResolvedValue([sampleReading])
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/recent?deviceId=esp32_mock');

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('mongo');
    });

    it('queries Mongo directly when limit > 10', async () => {
      const liveState = {
        getRecent: vi.fn()
      };
      const readingsRepo = {
        findRecent: vi.fn().mockResolvedValue([sampleReading])
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/recent?deviceId=esp32_mock&limit=15');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        source: 'mongo',
        data: [sampleReading]
      });
      expect(liveState.getRecent).not.toHaveBeenCalled();
      expect(readingsRepo.findRecent).toHaveBeenCalledWith('esp32_mock', 15);
    });

    it('returns empty array when Mongo returns no readings (200 OK)', async () => {
      const liveState = {
        getRecent: vi.fn().mockResolvedValue([])
      };
      const readingsRepo = {
        findRecent: vi.fn().mockResolvedValue([])
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/recent?deviceId=esp32_mock');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        source: 'mongo',
        data: []
      });
    });

    it('returns 400 for bad limit values (0, 101, abc)', async () => {
      const app = createApp({});

      const res0 = await request(app).get('/readings/recent?deviceId=esp32_mock&limit=0');
      expect(res0.status).toBe(400);
      expect(res0.body.errors[0].field).toBe('limit');

      const res101 = await request(app).get('/readings/recent?deviceId=esp32_mock&limit=101');
      expect(res101.status).toBe(400);
      expect(res101.body.errors[0].field).toBe('limit');

      const resAbc = await request(app).get('/readings/recent?deviceId=esp32_mock&limit=abc');
      expect(resAbc.status).toBe(400);
      expect(resAbc.body.errors[0].field).toBe('limit');
    });

    it('returns 500 when readingsRepo throws', async () => {
      const liveState = {
        getRecent: vi.fn().mockResolvedValue([])
      };
      const readingsRepo = {
        findRecent: vi.fn().mockRejectedValue(new Error('DB failure'))
      };

      const app = createApp({ liveState, readingsRepo });
      const res = await request(app).get('/readings/recent?deviceId=esp32_mock');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ ok: false, error: 'internal_error' });
    });
  });

  describe('GET /stats/hourly', () => {
    it('returns hourly stats on happy path using default hours = 24', async () => {
      const statsData = [
        {
          hour: '2026-11-11T10:00:00.000Z',
          count: 5,
          temperatura: { avg: 22.5, min: 20, max: 25 },
          humedad: { avg: 50.0, min: 45, max: 55 },
          nivelAguaAvg: 2.4
        }
      ];
      const readingsRepo = {
        hourlyStats: vi.fn().mockResolvedValue(statsData)
      };

      const app = createApp({ readingsRepo });
      const res = await request(app).get('/stats/hourly?deviceId=esp32_mock');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        data: statsData
      });
      expect(readingsRepo.hourlyStats).toHaveBeenCalledWith('esp32_mock', 24);
    });

    it('passes custom hours when valid', async () => {
      const readingsRepo = {
        hourlyStats: vi.fn().mockResolvedValue([])
      };

      const app = createApp({ readingsRepo });
      const res = await request(app).get('/stats/hourly?deviceId=esp32_mock&hours=48');

      expect(res.status).toBe(200);
      expect(readingsRepo.hourlyStats).toHaveBeenCalledWith('esp32_mock', 48);
    });

    it('returns 400 for bad hours values (0, 169, abc)', async () => {
      const app = createApp({});

      const res0 = await request(app).get('/stats/hourly?deviceId=esp32_mock&hours=0');
      expect(res0.status).toBe(400);
      expect(res0.body.errors[0].field).toBe('hours');

      const res169 = await request(app).get('/stats/hourly?deviceId=esp32_mock&hours=169');
      expect(res169.status).toBe(400);
      expect(res169.body.errors[0].field).toBe('hours');

      const resAbc = await request(app).get('/stats/hourly?deviceId=esp32_mock&hours=abc');
      expect(resAbc.status).toBe(400);
      expect(resAbc.body.errors[0].field).toBe('hours');
    });

    it('returns 500 when readingsRepo throws', async () => {
      const readingsRepo = {
        hourlyStats: vi.fn().mockRejectedValue(new Error('Aggregation error'))
      };

      const app = createApp({ readingsRepo });
      const res = await request(app).get('/stats/hourly?deviceId=esp32_mock');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ ok: false, error: 'internal_error' });
    });
  });

  describe('GET /health', () => {
    it('returns 200 ok when mongo and valkey are up', async () => {
      const health = {
        mongo: vi.fn().mockResolvedValue(true),
        valkey: vi.fn().mockResolvedValue(true)
      };

      const app = createApp({ health });
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'ok',
        mongo: 'up',
        valkey: 'up'
      });
    });

    it('returns 200 degraded when mongo is up but valkey is down', async () => {
      const health = {
        mongo: vi.fn().mockResolvedValue(true),
        valkey: vi.fn().mockResolvedValue(false)
      };

      const app = createApp({ health });
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'degraded',
        mongo: 'up',
        valkey: 'down'
      });
    });

    it('returns 503 down when mongo is down (even if valkey is up)', async () => {
      const health = {
        mongo: vi.fn().mockResolvedValue(false),
        valkey: vi.fn().mockResolvedValue(true)
      };

      const app = createApp({ health });
      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        status: 'down',
        mongo: 'down',
        valkey: 'up'
      });
    });

    it('returns 503 down when both mongo and valkey are down', async () => {
      const health = {
        mongo: vi.fn().mockResolvedValue(false),
        valkey: vi.fn().mockResolvedValue(false)
      };

      const app = createApp({ health });
      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        status: 'down',
        mongo: 'down',
        valkey: 'down'
      });
    });
  });
});
