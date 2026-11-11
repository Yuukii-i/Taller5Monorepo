import { describe, it, expect } from 'vitest';
import { evaluateAlerts } from '../src/services/alertService.js';

describe('evaluateAlerts', () => {
  it('does NOT trigger temp_high alert when temperatura is at threshold (30.00)', () => {
    const alerts = evaluateAlerts({ temperatura: 30.0, nivelAgua: 3 });
    expect(alerts.find((a) => a.type === 'temp_high')).toBeUndefined();
  });

  it('triggers temp_high alert when temperatura exceeds threshold (30.01)', () => {
    const alerts = evaluateAlerts({ temperatura: 30.01, nivelAgua: 3 });
    const tempAlert = alerts.find((a) => a.type === 'temp_high');
    expect(tempAlert).toBeDefined();
    expect(tempAlert).toMatchObject({
      type: 'temp_high',
      value: 30.01,
      threshold: 30
    });
    expect(tempAlert.message).toContain('30.01');
    expect(tempAlert.message).toContain('30');
  });

  it('does NOT trigger water_low alert when nivelAgua is above threshold (2)', () => {
    const alerts = evaluateAlerts({ temperatura: 25.0, nivelAgua: 2 });
    expect(alerts.find((a) => a.type === 'water_low')).toBeUndefined();
  });

  it('triggers water_low alert when nivelAgua is at threshold (1)', () => {
    const alerts = evaluateAlerts({ temperatura: 25.0, nivelAgua: 1, nivelAguaPct: 25 });
    const waterAlert = alerts.find((a) => a.type === 'water_low');
    expect(waterAlert).toBeDefined();
    expect(waterAlert).toMatchObject({
      type: 'water_low',
      value: 1,
      threshold: 1
    });
    expect(waterAlert.message).toContain('1');
    expect(waterAlert.message).toContain('25%');
  });

  it('triggers water_low alert when nivelAgua is 0 (empty)', () => {
    const alerts = evaluateAlerts({ temperatura: 25.0, nivelAgua: 0, nivelAguaPct: 0 });
    const waterAlert = alerts.find((a) => a.type === 'water_low');
    expect(waterAlert).toBeDefined();
    expect(waterAlert).toMatchObject({
      type: 'water_low',
      value: 0,
      threshold: 1
    });
    expect(waterAlert.message).toContain('0');
  });

  it('triggers both alerts simultaneously when both thresholds are crossed', () => {
    const reading = {
      temperatura: 32.5,
      nivelAgua: 1,
      nivelAguaPct: 25
    };
    const alerts = evaluateAlerts(reading);
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.type)).toEqual(['temp_high', 'water_low']);
  });

  it('respects custom thresholds for both temperature and water level', () => {
    const customThresholds = { tempMax: 28, waterMinLevel: 2 };

    const noAlertReading = { temperatura: 28.0, nivelAgua: 3 };
    expect(evaluateAlerts(noAlertReading, customThresholds)).toEqual([]);

    const alertReading = { temperatura: 28.5, nivelAgua: 2, nivelAguaPct: 50 };
    const alerts = evaluateAlerts(alertReading, customThresholds);
    expect(alerts).toHaveLength(2);

    expect(alerts[0]).toMatchObject({
      type: 'temp_high',
      value: 28.5,
      threshold: 28
    });
    expect(alerts[0].message).toContain('28.5');

    expect(alerts[1]).toMatchObject({
      type: 'water_low',
      value: 2,
      threshold: 2
    });
    expect(alerts[1].message).toContain('2');
  });

  it('returns an empty array when readings are normal or empty', () => {
    expect(evaluateAlerts({ temperatura: 22, nivelAgua: 4 })).toEqual([]);
    expect(evaluateAlerts({})).toEqual([]);
    expect(evaluateAlerts(null)).toEqual([]);
  });
});
