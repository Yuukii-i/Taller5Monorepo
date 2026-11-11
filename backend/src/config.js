import dotenv from 'dotenv';

dotenv.config();

export function getConfig(env = process.env) {
  return {
    PORT: env.PORT ? Number(env.PORT) : 3000,
    MONGO_URI: env.MONGO_URI || 'mongodb://localhost:27017/taller5',
    VALKEY_URL: env.VALKEY_URL || 'redis://localhost:6379',
    ONLINE_TTL_SECONDS: env.ONLINE_TTL_SECONDS !== undefined ? Number(env.ONLINE_TTL_SECONDS) : 30,
    ALERT_TEMP_MAX: env.ALERT_TEMP_MAX !== undefined ? Number(env.ALERT_TEMP_MAX) : 30,
    ALERT_WATER_MIN_LEVEL: env.ALERT_WATER_MIN_LEVEL !== undefined ? Number(env.ALERT_WATER_MIN_LEVEL) : 1,
    ALERT_COOLDOWN_SECONDS: env.ALERT_COOLDOWN_SECONDS !== undefined ? Number(env.ALERT_COOLDOWN_SECONDS) : 60,
  };
}

export const config = getConfig();
