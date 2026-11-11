import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createIngestService } from '../src/services/ingestService.js';

describe('Alerts Routes and Sensor-Data Ingest Integration', () => {
  describe('GET /alerts', () => {
    it('returns 200 with alert list on happy path', async () => {
      const mockAlerts = [
        {
          id: 'alert1',
          deviceId: 'esp32_1',
          type: 'temp_high',
          value: 32.5,
          threshold: 30,
          message: 'Temperatura alta: 32.5 C (limite 30 C)',
          createdAt: '2026-11-11T12:00:00.000Z'
        }
      ];

      const fakeAlertsRepo = {
        findRecent: vi.fn().mockResolvedValue(mockAlerts)
      };

      const app = createApp({ alertsRepo: fakeAlertsRepo });

      const res = await request(app).get('/alerts?deviceId=esp32_1&limit=10');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        data: mockAlerts
      });
      expect(fakeAlertsRepo.findRecent).toHaveBeenCalledWith({
        deviceId: 'esp32_1',
        limit: 10
      });
    });

    it('returns 200 with default limit 20 and no deviceId filter when no query params are provided', async () => {
      const fakeAlertsRepo = {
        findRecent: vi.fn().mockResolvedValue([])
      };

      const app = createApp({ alertsRepo: fakeAlertsRepo });

      const res = await request(app).get('/alerts');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        data: []
      });
      expect(fakeAlertsRepo.findRecent).toHaveBeenCalledWith({
        limit: 20
      });
    });

    it('returns 400 when deviceId is invalid (empty string or too long)', async () => {
      const fakeAlertsRepo = {
        findRecent: vi.fn()
      };
      const app = createApp({ alertsRepo: fakeAlertsRepo });

      const resEmpty = await request(app).get('/alerts?deviceId=   ');
      expect(resEmpty.status).toBe(400);
      expect(resEmpty.body.ok).toBe(false);
      expect(resEmpty.body.errors[0].field).toBe('deviceId');

      const tooLongId = 'a'.repeat(65);
      const resTooLong = await request(app).get(`/alerts?deviceId=${tooLongId}`);
      expect(resTooLong.status).toBe(400);
      expect(resTooLong.body.ok).toBe(false);
      expect(resTooLong.body.errors[0].field).toBe('deviceId');

      expect(fakeAlertsRepo.findRecent).not.toHaveBeenCalled();
    });

    it('returns 400 when limit is invalid (non-integer, <=0, >100)', async () => {
      const fakeAlertsRepo = {
        findRecent: vi.fn()
      };
      const app = createApp({ alertsRepo: fakeAlertsRepo });

      const resNonInt = await request(app).get('/alerts?limit=abc');
      expect(resNonInt.status).toBe(400);
      expect(resNonInt.body.ok).toBe(false);
      expect(resNonInt.body.errors[0].field).toBe('limit');

      const resZero = await request(app).get('/alerts?limit=0');
      expect(resZero.status).toBe(400);
      expect(resZero.body.ok).toBe(false);
      expect(resZero.body.errors[0].field).toBe('limit');

      const resTooHigh = await request(app).get('/alerts?limit=101');
      expect(resTooHigh.status).toBe(400);
      expect(resTooHigh.body.ok).toBe(false);
      expect(resTooHigh.body.errors[0].field).toBe('limit');

      expect(fakeAlertsRepo.findRecent).not.toHaveBeenCalled();
    });

    it('returns 500 internal_error when alerts repository throws', async () => {
      const fakeAlertsRepo = {
        findRecent: vi.fn().mockRejectedValue(new Error('Mongo connection down'))
      };
      const app = createApp({ alertsRepo: fakeAlertsRepo });

      const res = await request(app).get('/alerts');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        ok: false,
        error: 'internal_error'
      });
    });

    it('returns 500 internal_error when alerts repository is missing', async () => {
      const app = createApp({});

      const res = await request(app).get('/alerts');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        ok: false,
        error: 'internal_error'
      });
    });
  });

  describe('POST /sensor-data with alerts integration', () => {
    it('creates an alert when thresholds are crossed and returns 201', async () => {
      const fakeReadingsRepo = {
        insertReading: vi.fn().mockResolvedValue('reading-id-123')
      };
      const fakeLiveState = {
        saveReading: vi.fn().mockResolvedValue(undefined)
      };
      const fakeAlertService = {
        process: vi.fn().mockResolvedValue([
          {
            id: 'alert-id-999',
            deviceId: 'esp32_1',
            type: 'temp_high',
            value: 35.0,
            threshold: 30,
            message: 'Temperatura alta: 35 C (limite 30 C)'
          }
        ])
      };

      const ingestService = createIngestService({
        readingsRepo: fakeReadingsRepo,
        liveState: fakeLiveState,
        alertService: fakeAlertService
      });

      const app = createApp({ ingestService });

      const res = await request(app)
        .post('/sensor-data')
        .send({
          deviceId: 'esp32_1',
          temperatura: 35.0,
          humedad: 55.0,
          nivelAgua: 2
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        ok: true,
        id: 'reading-id-123'
      });

      expect(fakeAlertService.process).toHaveBeenCalledTimes(1);
      const [processedReading] = fakeAlertService.process.mock.calls[0];
      expect(processedReading.deviceId).toBe('esp32_1');
      expect(processedReading.temperatura).toBe(35.0);
      expect(processedReading.receivedAt).toBeInstanceOf(Date);
    });

    it('still returns 201 when alertService throws (best-effort alerts)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const fakeReadingsRepo = {
        insertReading: vi.fn().mockResolvedValue('reading-id-456')
      };
      const fakeLiveState = {
        saveReading: vi.fn().mockResolvedValue(undefined)
      };
      const failingAlertService = {
        process: vi.fn().mockRejectedValue(new Error('Alert processing crash'))
      };

      const ingestService = createIngestService({
        readingsRepo: fakeReadingsRepo,
        liveState: fakeLiveState,
        alertService: failingAlertService
      });

      const app = createApp({ ingestService });

      const res = await request(app)
        .post('/sensor-data')
        .send({
          deviceId: 'esp32_1',
          temperatura: 38.0,
          humedad: 50.0,
          nivelAgua: 2
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        ok: true,
        id: 'reading-id-456'
      });
      expect(failingAlertService.process).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to process alerts:',
        'Alert processing crash'
      );

      warnSpy.mockRestore();
    });
  });
});
