import { describe, it, expect } from 'vitest';
import { validateSensorData } from '../src/validation/sensorData.js';

describe('validateSensorData', () => {
  it('validates a correct payload with exact values', () => {
    const payload = {
      deviceId: 'esp32_1',
      temperatura: 24.5,
      humedad: 60.2,
      nivelAgua: 2
    };

    const result = validateSensorData(payload);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      deviceId: 'esp32_1',
      temperatura: 24.5,
      humedad: 60.2,
      nivelAgua: 2,
      nivelAguaPct: 50
    });
  });

  it('accepts numeric strings and trims deviceId', () => {
    const payload = {
      deviceId: '  esp32_node_01  ',
      temperatura: '24.50',
      humedad: '60.00',
      nivelAgua: '3'
    };

    const result = validateSensorData(payload);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      deviceId: 'esp32_node_01',
      temperatura: 24.5,
      humedad: 60,
      nivelAgua: 3,
      nivelAguaPct: 75
    });
  });

  it('rounds float numbers to 2 decimal places (e.g. 24.555 -> 24.56)', () => {
    const payload = {
      deviceId: 'esp32_1',
      temperatura: 24.555,
      humedad: 60.123,
      nivelAgua: 1
    };

    const result = validateSensorData(payload);
    expect(result.ok).toBe(true);
    expect(result.value.temperatura).toBe(24.56);
    expect(result.value.humedad).toBe(60.12);
    expect(result.value.nivelAguaPct).toBe(25);
  });

  it('reports missing required fields individually', () => {
    const base = {
      deviceId: 'esp32_1',
      temperatura: 20,
      humedad: 50,
      nivelAgua: 2
    };

    const withoutDeviceId = { ...base };
    delete withoutDeviceId.deviceId;
    const r1 = validateSensorData(withoutDeviceId);
    expect(r1.ok).toBe(false);
    expect(r1.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'deviceId' })])
    );

    const withoutTemp = { ...base };
    delete withoutTemp.temperatura;
    const r2 = validateSensorData(withoutTemp);
    expect(r2.ok).toBe(false);
    expect(r2.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'temperatura' })])
    );

    const withoutHumedad = { ...base };
    delete withoutHumedad.humedad;
    const r3 = validateSensorData(withoutHumedad);
    expect(r3.ok).toBe(false);
    expect(r3.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'humedad' })])
    );

    const withoutNivel = { ...base };
    delete withoutNivel.nivelAgua;
    const r4 = validateSensorData(withoutNivel);
    expect(r4.ok).toBe(false);
    expect(r4.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'nivelAgua' })])
    );
  });

  it('rejects wrong types (boolean, null, objects, NaN, Infinity, empty strings)', () => {
    const r1 = validateSensorData({
      deviceId: 12345,
      temperatura: 'not-a-number',
      humedad: null,
      nivelAgua: true
    });

    expect(r1.ok).toBe(false);
    const fields = r1.errors.map(e => e.field);
    expect(fields).toContain('deviceId');
    expect(fields).toContain('temperatura');
    expect(fields).toContain('humedad');
    expect(fields).toContain('nivelAgua');

    const r2 = validateSensorData({
      deviceId: '   ',
      temperatura: NaN,
      humedad: Infinity,
      nivelAgua: {}
    });
    expect(r2.ok).toBe(false);
    const fields2 = r2.errors.map(e => e.field);
    expect(fields2).toContain('deviceId');
    expect(fields2).toContain('temperatura');
    expect(fields2).toContain('humedad');
    expect(fields2).toContain('nivelAgua');
  });

  it('rejects invalid nivelAgua values (-1, 5, 2.5, "abc", null)', () => {
    for (const badNivel of [-1, 5, 2.5, 'abc', null]) {
      const res = validateSensorData({
        deviceId: 'esp32_1',
        temperatura: 25,
        humedad: 50,
        nivelAgua: badNivel
      });
      expect(res.ok).toBe(false);
      expect(res.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'nivelAgua' })])
      );
    }
  });

  it('accepts nivelAgua boundaries 0 and 4 with correct percentages', () => {
    const res0 = validateSensorData({
      deviceId: 'esp32_1',
      temperatura: 20,
      humedad: 50,
      nivelAgua: 0
    });
    expect(res0.ok).toBe(true);
    expect(res0.value.nivelAgua).toBe(0);
    expect(res0.value.nivelAguaPct).toBe(0);

    const res4 = validateSensorData({
      deviceId: 'esp32_1',
      temperatura: 20,
      humedad: 50,
      nivelAgua: 4
    });
    expect(res4.ok).toBe(true);
    expect(res4.value.nivelAgua).toBe(4);
    expect(res4.value.nivelAguaPct).toBe(100);
  });

  it('validates humedad range 0..100 and rejects out of bounds (101, -1)', () => {
    const at0 = validateSensorData({ deviceId: 'esp32_1', temperatura: 20, humedad: 0, nivelAgua: 1 });
    expect(at0.ok).toBe(true);

    const at100 = validateSensorData({ deviceId: 'esp32_1', temperatura: 20, humedad: 100, nivelAgua: 1 });
    expect(at100.ok).toBe(true);

    const over100 = validateSensorData({ deviceId: 'esp32_1', temperatura: 20, humedad: 101, nivelAgua: 1 });
    expect(over100.ok).toBe(false);
    expect(over100.errors[0].field).toBe('humedad');

    const under0 = validateSensorData({ deviceId: 'esp32_1', temperatura: 20, humedad: -1, nivelAgua: 1 });
    expect(under0.ok).toBe(false);
    expect(under0.errors[0].field).toBe('humedad');
  });

  it('drops unknown extra fields', () => {
    const payload = {
      deviceId: 'esp32_1',
      temperatura: 22.4,
      humedad: 45.0,
      nivelAgua: 2,
      extraField: 'should_be_ignored',
      nested: { a: 1 },
      token: 'secret'
    };

    const result = validateSensorData(payload);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      deviceId: 'esp32_1',
      temperatura: 22.4,
      humedad: 45,
      nivelAgua: 2,
      nivelAguaPct: 50
    });
    expect(result.value.extraField).toBeUndefined();
    expect(result.value.nested).toBeUndefined();
    expect(result.value.token).toBeUndefined();
  });

  it('rejects bodies that are not plain objects (null, arrays, primitives)', () => {
    for (const badBody of [null, undefined, [], [1, 2], 'string', 123, true]) {
      const res = validateSensorData(badBody);
      expect(res.ok).toBe(false);
      expect(res.errors).toEqual([{ field: 'body', message: 'body must be a plain object' }]);
    }
  });

  it('collects multiple errors at once when multiple fields are invalid', () => {
    const res = validateSensorData({});
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBe(4);
    const fields = res.errors.map(e => e.field);
    expect(fields).toEqual(['deviceId', 'temperatura', 'humedad', 'nivelAgua']);
  });

  it('handles exponent-form and small numbers correctly for temperatura and normalizes -0 to 0', () => {
    const testCases = [
      { input: 1e-7, expected: 0 },
      { input: 5e-7, expected: 0 },
      { input: -0.001, expected: 0 },
      { input: 1.005, expected: 1.01 },
      { input: 24.555, expected: 24.56 }
    ];

    for (const { input, expected } of testCases) {
      const res = validateSensorData({
        deviceId: 'esp32_1',
        temperatura: input,
        humedad: 50,
        nivelAgua: 1
      });
      expect(res.ok).toBe(true);
      expect(res.value.temperatura).toBe(expected);
      if (expected === 0) {
        expect(Object.is(res.value.temperatura, 0)).toBe(true);
      }
    }
  });

  it('handles exponent-form and small numbers correctly for humedad and normalizes -0 to 0', () => {
    const testCases = [
      { input: 1e-7, expected: 0 },
      { input: 5e-7, expected: 0 },
      { input: -0.001, expected: 0 },
      { input: 1.005, expected: 1.01 },
      { input: 24.555, expected: 24.56 }
    ];

    for (const { input, expected } of testCases) {
      const res = validateSensorData({
        deviceId: 'esp32_1',
        temperatura: 25,
        humedad: input,
        nivelAgua: 1
      });
      expect(res.ok).toBe(true);
      expect(res.value.humedad).toBe(expected);
      if (expected === 0) {
        expect(Object.is(res.value.humedad, 0)).toBe(true);
      }
    }
  });

  it('rejects out of range numbers in exponent form (1e21)', () => {
    const resTemp = validateSensorData({
      deviceId: 'esp32_1',
      temperatura: 1e21,
      humedad: 50,
      nivelAgua: 1
    });
    expect(resTemp.ok).toBe(false);
    expect(resTemp.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'temperatura' })])
    );

    const resHum = validateSensorData({
      deviceId: 'esp32_1',
      temperatura: 25,
      humedad: 1e21,
      nivelAgua: 1
    });
    expect(resHum.ok).toBe(false);
    expect(resHum.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'humedad' })])
    );
  });

  it('rejects exponent-form strings ("1e-7") as invalid numeric strings', () => {
    const resTemp = validateSensorData({
      deviceId: 'esp32_1',
      temperatura: '1e-7',
      humedad: 50,
      nivelAgua: 1
    });
    expect(resTemp.ok).toBe(false);
    expect(resTemp.errors).toEqual([
      { field: 'temperatura', message: 'temperatura must be a valid number' }
    ]);

    const resHum = validateSensorData({
      deviceId: 'esp32_1',
      temperatura: 25,
      humedad: '1e-7',
      nivelAgua: 1
    });
    expect(resHum.ok).toBe(false);
    expect(resHum.errors).toEqual([
      { field: 'humedad', message: 'humedad must be a valid number' }
    ]);
  });
});
