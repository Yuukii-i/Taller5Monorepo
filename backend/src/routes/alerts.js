import { Router } from 'express';

/**
 * Creates the router for alert retrieval.
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.alertsRepo
 * @returns {Router}
 */
export function createAlertsRouter({ alertsRepo } = {}) {
  const router = Router();

  router.get('/alerts', async (req, res) => {
    const errors = [];
    let deviceId;

    if (req.query.deviceId !== undefined) {
      const rawDeviceId = req.query.deviceId;
      if (
        typeof rawDeviceId !== 'string' ||
        rawDeviceId.trim().length === 0 ||
        rawDeviceId.trim().length > 64
      ) {
        errors.push({
          field: 'deviceId',
          message: 'deviceId must be between 1 and 64 characters'
        });
      } else {
        deviceId = rawDeviceId.trim();
      }
    }

    let limit = 20;
    if (req.query.limit !== undefined) {
      const rawLimit = String(req.query.limit).trim();
      if (!/^\d+$/.test(rawLimit)) {
        errors.push({
          field: 'limit',
          message: 'limit must be an integer between 1 and 100'
        });
      } else {
        const parsedLimit = parseInt(rawLimit, 10);
        if (parsedLimit < 1 || parsedLimit > 100) {
          errors.push({
            field: 'limit',
            message: 'limit must be an integer between 1 and 100'
          });
        } else {
          limit = parsedLimit;
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ ok: false, errors });
    }

    try {
      if (!alertsRepo || typeof alertsRepo.findRecent !== 'function') {
        throw new Error('alertsRepo unavailable');
      }

      const data = await alertsRepo.findRecent({
        ...(deviceId ? { deviceId } : {}),
        limit
      });

      return res.status(200).json({ ok: true, data });
    } catch {
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  return router;
}
