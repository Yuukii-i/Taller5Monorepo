/**
 * Evaluates whether a sensor reading exceeds alert thresholds.
 * Pure function: does not perform I/O.
 *
 * @param {Object} reading - Sensor reading { temperatura, nivelAgua, nivelAguaPct, ... }
 * @param {Object} [thresholds]
 * @param {number} [thresholds.tempMax=30]
 * @param {number} [thresholds.waterMinLevel=1]
 * @returns {Array<{ type: string, value: number, threshold: number, message: string }>}
 */
export function evaluateAlerts(reading, { tempMax = 30, waterMinLevel = 1 } = {}) {
  const alerts = [];

  // temp_high: temperatura > ALERT_TEMP_MAX (equal does NOT alert)
  if (typeof reading?.temperatura === 'number' && reading.temperatura > tempMax) {
    alerts.push({
      type: 'temp_high',
      value: reading.temperatura,
      threshold: tempMax,
      message: `Temperatura alta: ${reading.temperatura} C (limite ${tempMax} C)`
    });
  }

  // water_low: nivelAgua <= ALERT_WATER_MIN_LEVEL (0 and 1 alert, 2 does not)
  if (typeof reading?.nivelAgua === 'number' && reading.nivelAgua <= waterMinLevel) {
    const pct =
      reading.nivelAguaPct !== undefined
        ? `${reading.nivelAguaPct}%`
        : `${reading.nivelAgua * 25}%`;
    alerts.push({
      type: 'water_low',
      value: reading.nivelAgua,
      threshold: waterMinLevel,
      message: `Nivel de agua bajo: ${reading.nivelAgua} (${pct}) (minimo ${waterMinLevel})`
    });
  }

  return alerts;
}

/**
 * Creates the alert service managing evaluation, cooldown, persistence, and live notification.
 *
 * @param {Object} params
 * @param {Object} [params.alertsRepo]
 * @param {Object} [params.liveState]
 * @param {Object} [params.thresholds]
 * @param {number} [params.cooldownSeconds=60]
 * @param {Function} [params.now=()=>Date.now()]
 */
export function createAlertService({
  alertsRepo,
  liveState,
  thresholds = {},
  cooldownSeconds = 60,
  now = () => Date.now()
} = {}) {
  const memoryCooldowns = new Map();

  async function checkCooldown(deviceId, type) {
    if (liveState && typeof liveState.acquireCooldown === 'function') {
      try {
        return await liveState.acquireCooldown(deviceId, type, cooldownSeconds);
      } catch {
        // Fall back to in-memory Map on liveState error
      }
    }

    const key = `${deviceId}:${type}`;
    const currentTime = now();
    const expiry = memoryCooldowns.get(key);
    if (expiry !== undefined && expiry > currentTime) {
      return false;
    }
    memoryCooldowns.set(key, currentTime + cooldownSeconds * 1000);
    return true;
  }

  /**
   * Processes a sensor reading, emitting alerts if thresholds are exceeded and cooldown allows.
   *
   * @param {Object} reading - Sensor reading
   * @returns {Promise<Array<Object>>} Created alerts
   */
  async function process(reading) {
    const tempMax =
      thresholds.tempMax !== undefined ? thresholds.tempMax : 30;
    const waterMinLevel =
      thresholds.waterMinLevel !== undefined ? thresholds.waterMinLevel : 1;

    const triggered = evaluateAlerts(reading, { tempMax, waterMinLevel });
    const createdAlerts = [];

    for (const alert of triggered) {
      const allowed = await checkCooldown(reading.deviceId, alert.type);
      if (!allowed) {
        continue;
      }

      const alertDoc = {
        deviceId: reading.deviceId,
        type: alert.type,
        value: alert.value,
        threshold: alert.threshold,
        message: alert.message,
        createdAt: new Date(now())
      };

      let id;
      if (alertsRepo && typeof alertsRepo.insertAlert === 'function') {
        id = await alertsRepo.insertAlert(alertDoc);
      }

      const storedAlert = {
        ...(id ? { id } : {}),
        ...alertDoc
      };

      if (liveState && typeof liveState.publishAlert === 'function') {
        try {
          await liveState.publishAlert(storedAlert);
        } catch {
          // Swallow publish failure so alert creation is unaffected
        }
      }

      createdAlerts.push(storedAlert);
    }

    return createdAlerts;
  }

  return {
    evaluateAlerts,
    process
  };
}
