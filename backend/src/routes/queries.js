import { Router } from 'express';

function normalizeReading(doc) {
  if (!doc) return null;
  return {
    deviceId: doc.deviceId,
    temperatura: doc.temperatura,
    humedad: doc.humedad,
    nivelAgua: doc.nivelAgua,
    nivelAguaPct: doc.nivelAguaPct,
    receivedAt:
      doc.receivedAt instanceof Date
        ? doc.receivedAt.toISOString()
        : new Date(doc.receivedAt).toISOString()
  };
}

export function createQueryRouter({ readingsRepo, liveState, health } = {}) {
  const router = Router();

  // 1. GET /devices
  router.get('/devices', async (req, res) => {
    try {
      let deviceIds = [];
      let usedValkey = false;

      if (liveState && typeof liveState.listDevices === 'function') {
        try {
          const list = await liveState.listDevices();
          if (Array.isArray(list) && list.length > 0) {
            deviceIds = list;
            usedValkey = true;
          }
        } catch {
          // Valkey failed, fallback to Mongo
        }
      }

      if (!usedValkey) {
        if (!readingsRepo || typeof readingsRepo.listDeviceIds !== 'function') {
          throw new Error('readingsRepo unavailable');
        }
        deviceIds = await readingsRepo.listDeviceIds();
      }

      const devices = await Promise.all(
        (deviceIds || []).map(async (deviceId) => {
          let online = false;
          if (liveState && typeof liveState.isOnline === 'function') {
            try {
              online = Boolean(await liveState.isOnline(deviceId));
            } catch {
              online = false;
            }
          }
          return { deviceId, online };
        })
      );

      return res.status(200).json({ ok: true, devices });
    } catch {
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  // 2. GET /readings/latest?deviceId=
  router.get('/readings/latest', async (req, res) => {
    const rawDeviceId = req.query.deviceId;
    if (
      typeof rawDeviceId !== 'string' ||
      rawDeviceId.trim().length === 0 ||
      rawDeviceId.trim().length > 64
    ) {
      return res.status(400).json({
        ok: false,
        errors: [{ field: 'deviceId', message: 'deviceId is required and must be between 1 and 64 characters' }]
      });
    }

    const deviceId = rawDeviceId.trim();

    try {
      let reading = null;
      let source = null;

      if (liveState && typeof liveState.getLatest === 'function') {
        try {
          reading = await liveState.getLatest(deviceId);
          if (reading) {
            source = 'valkey';
          }
        } catch {
          reading = null;
        }
      }

      if (!reading) {
        if (!readingsRepo || typeof readingsRepo.findLatest !== 'function') {
          throw new Error('readingsRepo unavailable');
        }
        reading = await readingsRepo.findLatest(deviceId);
        if (reading) {
          source = 'mongo';
        }
      }

      if (!reading) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      return res.status(200).json({
        ok: true,
        source,
        data: normalizeReading(reading)
      });
    } catch {
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  // 3. GET /readings/recent?deviceId=&limit=
  router.get('/readings/recent', async (req, res) => {
    const errors = [];
    const rawDeviceId = req.query.deviceId;
    if (
      typeof rawDeviceId !== 'string' ||
      rawDeviceId.trim().length === 0 ||
      rawDeviceId.trim().length > 64
    ) {
      errors.push({ field: 'deviceId', message: 'deviceId is required and must be between 1 and 64 characters' });
    }

    let limit = 10;
    if (req.query.limit !== undefined) {
      const rawLimit = String(req.query.limit).trim();
      if (!/^\d+$/.test(rawLimit)) {
        errors.push({ field: 'limit', message: 'limit must be an integer between 1 and 100' });
      } else {
        const parsedLimit = parseInt(rawLimit, 10);
        if (parsedLimit < 1 || parsedLimit > 100) {
          errors.push({ field: 'limit', message: 'limit must be an integer between 1 and 100' });
        } else {
          limit = parsedLimit;
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ ok: false, errors });
    }

    const deviceId = rawDeviceId.trim();

    try {
      let source = null;
      let data = null;

      if (limit <= 10 && liveState && typeof liveState.getRecent === 'function') {
        try {
          const recent = await liveState.getRecent(deviceId);
          if (Array.isArray(recent) && recent.length >= 1) {
            source = 'valkey';
            data = recent.slice(0, limit).map(normalizeReading);
          }
        } catch {
          // Valkey failed, fallback to Mongo
        }
      }

      if (!data) {
        if (!readingsRepo || typeof readingsRepo.findRecent !== 'function') {
          throw new Error('readingsRepo unavailable');
        }
        const recent = await readingsRepo.findRecent(deviceId, limit);
        source = 'mongo';
        data = (recent || []).map(normalizeReading);
      }

      return res.status(200).json({
        ok: true,
        source,
        data
      });
    } catch {
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  // 4. GET /stats/hourly?deviceId=&hours=
  router.get('/stats/hourly', async (req, res) => {
    const errors = [];
    const rawDeviceId = req.query.deviceId;
    if (
      typeof rawDeviceId !== 'string' ||
      rawDeviceId.trim().length === 0 ||
      rawDeviceId.trim().length > 64
    ) {
      errors.push({ field: 'deviceId', message: 'deviceId is required and must be between 1 and 64 characters' });
    }

    let hours = 24;
    if (req.query.hours !== undefined) {
      const rawHours = String(req.query.hours).trim();
      if (!/^\d+$/.test(rawHours)) {
        errors.push({ field: 'hours', message: 'hours must be an integer between 1 and 168' });
      } else {
        const parsedHours = parseInt(rawHours, 10);
        if (parsedHours < 1 || parsedHours > 168) {
          errors.push({ field: 'hours', message: 'hours must be an integer between 1 and 168' });
        } else {
          hours = parsedHours;
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ ok: false, errors });
    }

    const deviceId = rawDeviceId.trim();

    try {
      if (!readingsRepo || typeof readingsRepo.hourlyStats !== 'function') {
        throw new Error('readingsRepo unavailable');
      }
      const data = await readingsRepo.hourlyStats(deviceId, hours);
      return res.status(200).json({
        ok: true,
        data
      });
    } catch {
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  // 5. GET /health
  router.get('/health', async (req, res) => {
    let mongoUp = false;
    let valkeyUp = false;

    try {
      if (health && typeof health.mongo === 'function') {
        mongoUp = Boolean(await health.mongo());
      } else if (readingsRepo && typeof readingsRepo.ping === 'function') {
        mongoUp = Boolean(await readingsRepo.ping());
      } else {
        mongoUp = true;
      }
    } catch {
      mongoUp = false;
    }

    try {
      if (health && typeof health.valkey === 'function') {
        valkeyUp = Boolean(await health.valkey());
      } else if (liveState && typeof liveState.ping === 'function') {
        valkeyUp = Boolean(await liveState.ping());
      } else {
        valkeyUp = true;
      }
    } catch {
      valkeyUp = false;
    }

    const mongoStatus = mongoUp ? 'up' : 'down';
    const valkeyStatus = valkeyUp ? 'up' : 'down';

    if (!mongoUp) {
      return res.status(503).json({
        status: 'down',
        mongo: mongoStatus,
        valkey: valkeyStatus
      });
    }

    if (!valkeyUp) {
      return res.status(200).json({
        status: 'degraded',
        mongo: mongoStatus,
        valkey: valkeyStatus
      });
    }

    return res.status(200).json({
      status: 'ok',
      mongo: mongoStatus,
      valkey: valkeyStatus
    });
  });

  return router;
}
