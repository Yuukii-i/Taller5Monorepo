/**
 * Key naming scheme for Valkey/Redis live state layer.
 */
export const KEYS = {
  latest: (id) => `latest:${id}`,
  recent: (id) => `recent:${id}`,
  online: (id) => `online:${id}`,
  alertCooldown: (id, type) => `alertcd:${id}:${type}`,
  alertsChannel: 'alerts',
  devices: 'devices',
  channel: 'readings',
  readings: 'readings'
};

/**
 * Creates the live state repository backed by Valkey.
 *
 * @param {Object} client - ioredis client
 * @param {Object} [options]
 * @param {number} [options.recentMax=10]
 * @param {number} [options.onlineTtlSeconds=30]
 */
export function createLiveStateRepository(client, { recentMax = 10, onlineTtlSeconds = 30 } = {}) {
  /**
   * Saves a sensor reading to the live state layer via pipeline.
   *
   * @param {Object} reading - Validated sensor reading including receivedAt ISO string.
   */
  async function saveReading(reading) {
    const { deviceId } = reading;
    const pipeline = client.pipeline();

    pipeline.hset(KEYS.latest(deviceId), reading);
    pipeline.lpush(KEYS.recent(deviceId), JSON.stringify(reading));
    pipeline.ltrim(KEYS.recent(deviceId), 0, recentMax - 1);
    pipeline.set(KEYS.online(deviceId), '1', 'EX', onlineTtlSeconds);
    pipeline.sadd(KEYS.devices, deviceId);
    pipeline.publish(KEYS.readings, JSON.stringify({ type: 'reading', data: reading }));

    const results = await pipeline.exec();
    if (results) {
      for (const [err] of results) {
        if (err) throw err;
      }
    }
  }

  /**
   * Retrieves the latest reading for a device, restoring numeric values.
   *
   * @param {string} id - Device ID
   * @returns {Promise<Object|null>}
   */
  async function getLatest(id) {
    const data = await client.hgetall(KEYS.latest(id));
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    const restored = { ...data };
    const numericFields = ['temperatura', 'humedad', 'nivelAgua', 'nivelAguaPct'];
    for (const field of numericFields) {
      if (restored[field] !== undefined) {
        restored[field] = Number(restored[field]);
      }
    }
    return restored;
  }

  /**
   * Retrieves the recent readings list for a device (newest first).
   *
   * @param {string} id - Device ID
   * @returns {Promise<Array<Object>>}
   */
  async function getRecent(id) {
    const items = await client.lrange(KEYS.recent(id), 0, -1);
    return items.map((item) => JSON.parse(item));
  }

  /**
   * Checks if a device is considered online (key exists within TTL).
   *
   * @param {string} id - Device ID
   * @returns {Promise<boolean>}
   */
  async function isOnline(id) {
    const val = await client.get(KEYS.online(id));
    return val !== null;
  }

  /**
   * Retrieves a sorted list of all active device IDs.
   *
   * @returns {Promise<Array<string>>}
   */
  async function listDevices() {
    const devices = await client.smembers(KEYS.devices);
    return (devices || []).slice().sort();
  }

  /**
   * Checks Valkey connectivity. Never throws; returns boolean.
   *
   * @returns {Promise<boolean>}
   */
  async function ping() {
    try {
      if (!client || typeof client.ping !== 'function') {
        return false;
      }
      const res = await client.ping();
      return res === 'PONG' || res === true;
    } catch {
      return false;
    }
  }

  /**
   * Acquires a cooldown lock for an alert type on a device using Redis SET EX NX.
   * Returns true if lock was acquired ('OK'), false otherwise.
   *
   * @param {string} deviceId
   * @param {string} type
   * @param {number} seconds
   * @returns {Promise<boolean>}
   */
  async function acquireCooldown(deviceId, type, seconds) {
    const res = await client.set(KEYS.alertCooldown(deviceId, type), '1', 'EX', seconds, 'NX');
    return res === 'OK';
  }

  /**
   * Publishes an alert event to the alerts channel.
   *
   * @param {Object} alert
   * @returns {Promise<void>}
   */
  async function publishAlert(alert) {
    await client.publish(
      KEYS.alertsChannel,
      JSON.stringify({ type: 'alert', data: alert })
    );
  }

  return {
    saveReading,
    getLatest,
    getRecent,
    isOnline,
    listDevices,
    ping,
    acquireCooldown,
    publishAlert
  };
}
