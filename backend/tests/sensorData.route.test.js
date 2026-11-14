import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createIngestService } from '../src/services/ingestService.js';

describe('POST /sensor-data', () => {
  it('returns 201 and generated id on valid payload', async () => {
    const fakeIngestService = {
      ingest: vi.fn().mockResolvedValue({ id: 'mongo-id-12345' })
    };
    const app = createApp({ ingestService: fakeIngestService });

    const payload = {
      deviceId: 'esp32_1',
      temperatura: 24.5,
      humedad: 60.0,
      nivelAgua: 2
    };

    const res = await request(app)
      .post('/sensor-data')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      id: 'mongo-id-12345'
    });
    expect(fakeIngestService.ingest).toHaveBeenCalledWith({
      deviceId: 'esp32_1',
      temperatura: 24.5,
      humedad: 60,
      nivelAgua: 2,
      nivelAguaPct: 50
    });
  });

  it('returns 400 and validation errors on invalid payload', async () => {
    const fakeIngestService = {
      ingest: vi.fn()
    };
    const app = createApp({ ingestService: fakeIngestService });

    const res = await request(app)
      .post('/sensor-data')
      .send({
        deviceId: '',
        temperatura: 200, // out of range
        humedad: 'abc',
        nivelAgua: 99
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(4);
    expect(fakeIngestService.ingest).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON body', async () => {
    const fakeIngestService = {
      ingest: vi.fn()
    };
    const app = createApp({ ingestService: fakeIngestService });

    const res = await request(app)
      .post('/sensor-data')
      .set('Content-Type', 'application/json')
      .send('{ "deviceId": "esp32_1", "temperatura": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      errors: [{ field: 'body', message: 'invalid JSON' }]
    });
    expect(fakeIngestService.ingest).not.toHaveBeenCalled();
  });

  it('returns 500 internal_error without leaking details when repo throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failingIngestService = {
      ingest: vi.fn().mockRejectedValue(new Error('Sensitive Mongo connection error stack'))
    };
    const app = createApp({ ingestService: failingIngestService });

    const res = await request(app)
      .post('/sensor-data')
      .send({
        deviceId: 'esp32_1',
        temperatura: 25.0,
        humedad: 50.0,
        nivelAgua: 1
      });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      ok: false,
      error: 'internal_error'
    });
    // Check that stack or internal error message is NOT leaked in the response
    expect(JSON.stringify(res.body)).not.toContain('Sensitive');
    expect(JSON.stringify(res.body)).not.toContain('stack');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('returns 201 when liveState throws (Valkey down)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeReadingsRepo = {
      insertReading: vi.fn().mockResolvedValue('mongo-id-saved')
    };
    const failingLiveState = {
      saveReading: vi.fn().mockRejectedValue(new Error('Valkey connection refused'))
    };
    const ingestService = createIngestService({
      readingsRepo: fakeReadingsRepo,
      liveState: failingLiveState
    });
    const app = createApp({ ingestService });

    const res = await request(app)
      .post('/sensor-data')
      .send({
        deviceId: 'esp32_1',
        temperatura: 22.0,
        humedad: 45.0,
        nivelAgua: 3
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      id: 'mongo-id-saved'
    });
    expect(fakeReadingsRepo.insertReading).toHaveBeenCalled();
    expect(failingLiveState.saveReading).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  describe('lenient JSON parsing', () => {
    const validRawPayload = JSON.stringify({
      deviceId: 'esp32_1',
      temperatura: '24.50',
      humedad: '60.00',
      nivelAgua: 2
    });

    const createTestApp = () => {
      const fakeIngestService = {
        ingest: vi.fn().mockResolvedValue({ id: 'sensor-id-123' })
      };
      const app = createApp({
        ingestService: fakeIngestService,
        health: { isHealthy: () => true }
      });
      return { app, fakeIngestService };
    };

    it.each([
      ['application/json', 'application/json'],
      ['application/json; charset=utf-8', 'application/json; charset=utf-8'],
      ['text/plain', 'text/plain'],
      ['text/plain; charset=utf-8', 'text/plain; charset=utf-8'],
      ['application/x-www-form-urlencoded', 'application/x-www-form-urlencoded']
    ])('accepts valid JSON with Content-Type "%s"', async (_, contentType) => {
      const { app, fakeIngestService } = createTestApp();
      const res = await request(app)
        .post('/sensor-data')
        .set('Content-Type', contentType)
        .send(validRawPayload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true, id: 'sensor-id-123' });
      expect(fakeIngestService.ingest).toHaveBeenCalledWith({
        deviceId: 'esp32_1',
        temperatura: 24.5,
        humedad: 60,
        nivelAgua: 2,
        nivelAguaPct: 50
      });
    });

    it('accepts valid JSON when Content-Type is explicitly absent', async () => {
      const { app, fakeIngestService } = createTestApp();
      const res = await request(app)
        .post('/sensor-data')
        .unset('Content-Type')
        .send(validRawPayload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true, id: 'sensor-id-123' });
      expect(fakeIngestService.ingest).toHaveBeenCalled();
    });

    it('accepts valid JSON with leading UTF-8 BOM', async () => {
      const { app, fakeIngestService } = createTestApp();
      const res = await request(app)
        .post('/sensor-data')
        .set('Content-Type', 'text/plain')
        .send('\uFEFF' + validRawPayload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true, id: 'sensor-id-123' });
      expect(fakeIngestService.ingest).toHaveBeenCalled();
    });

    it.each([
      ['empty body', ''],
      ['whitespace body', '   \n  \t '],
      ['malformed JSON', '{bad'],
      ['array JSON', '[]'],
      ['null JSON', 'null'],
      ['primitive string JSON', '"text"']
    ])('returns 400 for invalid body: %s', async (_, body) => {
      const { app, fakeIngestService } = createTestApp();
      const res = await request(app)
        .post('/sensor-data')
        .set('Content-Type', 'text/plain')
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(fakeIngestService.ingest).not.toHaveBeenCalled();
    });

    it('returns 413 when payload exceeds limit (150 KB)', async () => {
      const { app, fakeIngestService } = createTestApp();
      const hugePayload = JSON.stringify({
        deviceId: 'esp32_1',
        temperatura: 20,
        humedad: 50,
        nivelAgua: 1,
        padding: 'x'.repeat(150 * 1024)
      });

      const res = await request(app)
        .post('/sensor-data')
        .set('Content-Type', 'application/json')
        .send(hugePayload);

      expect(res.status).toBe(413);
      expect(res.body).toEqual({
        ok: false,
        errors: [{ field: 'body', message: 'payload too large' }]
      });
      expect(fakeIngestService.ingest).not.toHaveBeenCalled();
    });

    it('GET /health still works after removing global express.json', async () => {
      const { app } = createTestApp();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
