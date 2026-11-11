import { describe, it, expect } from 'vitest';
import { getConfig, config } from '../src/config.js';

describe('config', () => {
  it('should use default values when env is empty', () => {
    const cfg = getConfig({});
    expect(cfg.PORT).toBe(3000);
    expect(cfg.MONGO_URI).toBe('mongodb://localhost:27017/taller5');
    expect(cfg.VALKEY_URL).toBe('redis://localhost:6379');
    expect(cfg.ONLINE_TTL_SECONDS).toBe(30);
    expect(cfg.ALERT_TEMP_MAX).toBe(30);
    expect(cfg.ALERT_WATER_MIN_LEVEL).toBe(1);
    expect(cfg.ALERT_COOLDOWN_SECONDS).toBe(60);
  });

  it('should override values with provided env', () => {
    const customEnv = {
      PORT: '8080',
      MONGO_URI: 'mongodb://remote:27017/prod',
      VALKEY_URL: 'redis://remote:6379',
      ONLINE_TTL_SECONDS: '45',
      ALERT_TEMP_MAX: '35',
      ALERT_WATER_MIN_LEVEL: '2',
      ALERT_COOLDOWN_SECONDS: '120',
    };
    const cfg = getConfig(customEnv);
    expect(cfg.PORT).toBe(8080);
    expect(cfg.MONGO_URI).toBe('mongodb://remote:27017/prod');
    expect(cfg.VALKEY_URL).toBe('redis://remote:6379');
    expect(cfg.ONLINE_TTL_SECONDS).toBe(45);
    expect(cfg.ALERT_TEMP_MAX).toBe(35);
    expect(cfg.ALERT_WATER_MIN_LEVEL).toBe(2);
    expect(cfg.ALERT_COOLDOWN_SECONDS).toBe(120);
  });

  it('should export singleton config object', () => {
    expect(config).toBeDefined();
    expect(typeof config.PORT).toBe('number');
    expect(typeof config.ONLINE_TTL_SECONDS).toBe('number');
  });
});
