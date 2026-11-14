import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app.js';
import {
  parseArgs,
  createPayloadGenerator,
  formatPayload
} from '../scripts/simulatorCore.js';
import { runSimulator } from '../scripts/simulator.js';

function createSeededRng(seed = 12345) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('simulatorCore.parseArgs', () => {
  it('returns defaults when no flags or env are provided', () => {
    expect(parseArgs([], {})).toEqual({
      baseUrl: 'http://localhost:3000',
      deviceId: 'esp32_1',
      intervalMs: 10000,
      mode: 'fixed',
      count: 0,
      numbers: false
    });
  });

  it('uses env variables when no flags are provided', () => {
    const opts = parseArgs([], {
      BASE_URL: 'http://example.com:4000',
      DEVICE_ID: 'esp32_lab',
      INTERVAL_MS: '2500',
      MODE: 'alert',
      COUNT: '5'
    });

    expect(opts).toEqual({
      baseUrl: 'http://example.com:4000',
      deviceId: 'esp32_lab',
      intervalMs: 2500,
      mode: 'alert',
      count: 5,
      numbers: false
    });
  });

  it('flags override env variables', () => {
    const opts = parseArgs(
      [
        '--url',
        'http://127.0.0.1:5000',
        '--device=esp32_override',
        '--interval',
        '500',
        '--mode',
        'random',
        '--count',
        '10',
        '--numbers'
      ],
      {
        BASE_URL: 'http://example.com:4000',
        DEVICE_ID: 'esp32_lab',
        INTERVAL_MS: '2500',
        MODE: 'alert',
        COUNT: '5'
      }
    );

    expect(opts).toEqual({
      baseUrl: 'http://127.0.0.1:5000',
      deviceId: 'esp32_override',
      intervalMs: 500,
      mode: 'random',
      count: 10,
      numbers: true
    });
  });

  it('throws on every invalid case', () => {
    expect(() => parseArgs(['--interval', '99'], {})).toThrow();
    expect(() => parseArgs([], { INTERVAL_MS: '50' })).toThrow();
    expect(() => parseArgs(['--count', '-1'], {})).toThrow();
    expect(() => parseArgs([], { COUNT: '-2' })).toThrow();
    expect(() => parseArgs(['--mode', 'invalid'], {})).toThrow();
    expect(() => parseArgs([], { MODE: 'invalid' })).toThrow();
    expect(() => parseArgs(['--interval', 'abc'], {})).toThrow();
    expect(() => parseArgs(['--count', '1.5'], {})).toThrow();
    expect(() => parseArgs([], { INTERVAL_MS: '' })).toThrow();
    expect(() => parseArgs(['--unknown'], {})).toThrow();
    expect(() => parseArgs(['--url'], {})).toThrow();
    expect(() => parseArgs(['--url', '   '], {})).toThrow();
    expect(() => parseArgs(['--device', ''], {})).toThrow();
  });
});

describe('simulatorCore.createPayloadGenerator', () => {
  it('fixed mode always returns constant values', () => {
    const gen = createPayloadGenerator('fixed');
    for (let i = 0; i < 5; i += 1) {
      expect(gen.next()).toEqual({
        temperatura: 24.5,
        humedad: 60,
        nivelAgua: 2
      });
    }
  });

  it('random mode stays within ranges and step limits over 500 steps', () => {
    const gen = createPayloadGenerator('random', { rng: createSeededRng(42) });
    let prev = gen.next();

    for (let i = 1; i < 500; i += 1) {
      const curr = gen.next();
      expect(curr.temperatura).toBeGreaterThanOrEqual(15);
      expect(curr.temperatura).toBeLessThanOrEqual(40);
      expect(curr.humedad).toBeGreaterThanOrEqual(30);
      expect(curr.humedad).toBeLessThanOrEqual(90);
      expect(Number.isInteger(curr.nivelAgua)).toBe(true);
      expect(curr.nivelAgua).toBeGreaterThanOrEqual(0);
      expect(curr.nivelAgua).toBeLessThanOrEqual(4);

      expect(Math.abs(curr.temperatura - prev.temperatura)).toBeLessThanOrEqual(0.8 + 1e-9);
      expect(Math.abs(curr.humedad - prev.humedad)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(curr.nivelAgua - prev.nivelAgua)).toBeLessThanOrEqual(1);

      expect(Number(curr.temperatura.toFixed(2))).toBe(curr.temperatura);
      expect(Number(curr.humedad.toFixed(2))).toBe(curr.humedad);

      prev = curr;
    }
  });

  it('alert mode cycles in order and crosses thresholds at the right steps', () => {
    const gen = createPayloadGenerator('alert');
    const steps = Array.from({ length: 5 }, () => gen.next());

    expect(steps[0]).toEqual({ temperatura: 24.5, humedad: 60, nivelAgua: 3 });
    expect(steps[0].temperatura).toBeLessThanOrEqual(30);
    expect(steps[0].nivelAgua).toBeGreaterThan(1);

    expect(steps[1]).toEqual({ temperatura: 35.2, humedad: 55, nivelAgua: 3 });
    expect(steps[1].temperatura).toBeGreaterThan(30);
    expect(steps[1].nivelAgua).toBeGreaterThan(1);

    expect(steps[2]).toEqual({ temperatura: 25, humedad: 58, nivelAgua: 0 });
    expect(steps[2].temperatura).toBeLessThanOrEqual(30);
    expect(steps[2].nivelAgua).toBeLessThanOrEqual(1);

    expect(steps[3]).toEqual({ temperatura: 36, humedad: 50, nivelAgua: 1 });
    expect(steps[3].temperatura).toBeGreaterThan(30);
    expect(steps[3].nivelAgua).toBeLessThanOrEqual(1);

    expect(steps[4]).toEqual(steps[0]);
  });

  it('throws on unknown mode', () => {
    expect(() => createPayloadGenerator('unknown')).toThrow();
  });
});

describe('simulatorCore.formatPayload', () => {
  it('formats temperatura and humedad as 2-decimal strings by default and nivelAgua as integer', () => {
    const payload = formatPayload('esp32_1', {
      temperatura: 24.5,
      humedad: 60,
      nivelAgua: 2
    });

    expect(payload).toEqual({
      deviceId: 'esp32_1',
      temperatura: '24.50',
      humedad: '60.00',
      nivelAgua: 2
    });
    expect(typeof payload.temperatura).toBe('string');
    expect(typeof payload.humedad).toBe('string');
    expect(Number.isInteger(payload.nivelAgua)).toBe(true);
  });

  it('formats temperatura and humedad as numbers when numbers option is true', () => {
    const payload = formatPayload(
      'esp32_2',
      { temperatura: 24.5, humedad: 60, nivelAgua: 3 },
      { numbers: true }
    );

    expect(payload).toEqual({
      deviceId: 'esp32_2',
      temperatura: 24.5,
      humedad: 60,
      nivelAgua: 3
    });
    expect(typeof payload.temperatura).toBe('number');
    expect(typeof payload.humedad).toBe('number');
    expect(Number.isInteger(payload.nivelAgua)).toBe(true);
  });
});

describe('simulator.runSimulator', () => {
  it('sends exactly 3 POST requests to <url>/sensor-data with JSON body and Content-Type header', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    const logs = [];
    const instantSleep = vi.fn().mockResolvedValue();

    const result = await runSimulator(
      {
        baseUrl: 'http://localhost:3000/',
        deviceId: 'esp32_1',
        intervalMs: 100,
        mode: 'fixed',
        count: 3,
        numbers: false
      },
      {
        fetchImpl: fakeFetch,
        log: (line) => logs.push(line),
        sleep: instantSleep
      }
    );

    expect(result).toEqual({ sent: 3, ok: 3, failed: 0 });
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    expect(instantSleep).toHaveBeenCalledTimes(2);

    for (const [url, init] of fakeFetch.mock.calls) {
      expect(url).toBe('http://localhost:3000/sensor-data');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        deviceId: 'esp32_1',
        temperatura: '24.50',
        humedad: '60.00',
        nivelAgua: 2
      });
    }
    expect(logs.at(-1)).toContain('3 enviadas / 3 ok / 0 fallidas');
  });

  it('continues when fetch rejects and counts failures in summary', async () => {
    const fakeFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockRejectedValueOnce(new Error('network down'));
    const logs = [];

    const result = await runSimulator(
      {
        baseUrl: 'http://localhost:3000',
        deviceId: 'esp32_1',
        intervalMs: 100,
        mode: 'fixed',
        count: 3,
        numbers: false
      },
      {
        fetchImpl: fakeFetch,
        log: (line) => logs.push(line),
        sleep: async () => {}
      }
    );

    expect(result).toEqual({ sent: 3, ok: 1, failed: 2 });
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    expect(logs[0]).toContain('connect ECONNREFUSED');
    expect(logs.at(-1)).toContain('3 enviadas / 1 ok / 2 fallidas');
  });

  it('counts HTTP 400 responses as failed', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const logs = [];

    const result = await runSimulator(
      {
        baseUrl: 'http://localhost:3000',
        deviceId: 'esp32_1',
        intervalMs: 100,
        mode: 'fixed',
        count: 2,
        numbers: false
      },
      {
        fetchImpl: fakeFetch,
        log: (line) => logs.push(line),
        sleep: async () => {}
      }
    );

    expect(result).toEqual({ sent: 2, ok: 0, failed: 2 });
    expect(logs.at(-1)).toContain('2 enviadas / 0 ok / 2 fallidas');
  });

  it('integrates with real createApp on port 0 and delivers valid bodies', async () => {
    const fakeIngestService = {
      ingest: vi.fn().mockResolvedValue({ id: 'sim-id-1' })
    };
    const app = createApp({ ingestService: fakeIngestService });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const { port } = server.address();
      const logs = [];
      const result = await runSimulator(
        {
          baseUrl: `http://127.0.0.1:${port}`,
          deviceId: 'esp32_sim',
          intervalMs: 100,
          mode: 'fixed',
          count: 2,
          numbers: false
        },
        {
          log: (line) => logs.push(line),
          sleep: async () => {}
        }
      );

      expect(result).toEqual({ sent: 2, ok: 2, failed: 0 });
      expect(logs[0]).toContain('HTTP 201');
      expect(logs[1]).toContain('HTTP 201');
      expect(fakeIngestService.ingest).toHaveBeenCalledTimes(2);
      expect(fakeIngestService.ingest).toHaveBeenNthCalledWith(1, {
        deviceId: 'esp32_sim',
        temperatura: 24.5,
        humedad: 60,
        nivelAgua: 2,
        nivelAguaPct: 50
      });
      expect(fakeIngestService.ingest).toHaveBeenNthCalledWith(2, {
        deviceId: 'esp32_sim',
        temperatura: 24.5,
        humedad: 60,
        nivelAgua: 2,
        nivelAguaPct: 50
      });
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
