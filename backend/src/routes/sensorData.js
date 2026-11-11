import { Router } from 'express';
import { validateSensorData } from '../validation/sensorData.js';

/**
 * Creates the router for sensor data ingestion.
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.ingestService
 * @returns {Router}
 */
export function createSensorDataRouter({ ingestService } = {}) {
  const router = Router();

  router.post('/sensor-data', async (req, res) => {
    const validation = validateSensorData(req.body);

    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        errors: validation.errors
      });
    }

    try {
      const result = await ingestService.ingest(validation.value);
      return res.status(201).json({
        ok: true,
        id: result.id
      });
    } catch (err) {
      console.error('Error saving sensor reading:', err);
      return res.status(500).json({
        ok: false,
        error: 'internal_error'
      });
    }
  });

  return router;
}
