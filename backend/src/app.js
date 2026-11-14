import express from 'express';
import { lenientJsonBody } from './middleware/lenientJson.js';
import { createSensorDataRouter } from './routes/sensorData.js';
import { createQueryRouter } from './routes/queries.js';
import { createAlertsRouter } from './routes/alerts.js';

export function createApp({ ingestService, readingsRepo, liveState, health, alertsRepo, liveHub } = {}) {
  const app = express();

  app.post('/sensor-data', lenientJsonBody());

  // Error middleware for malformed JSON or payload errors
  app.use((err, req, res, next) => {
    if (
      err &&
      (err.status === 413 || err.statusCode === 413 || err.type === 'entity.too.large')
    ) {
      return res.status(413).json({
        ok: false,
        errors: [{ field: 'body', message: 'payload too large' }]
      });
    }
    if (
      err &&
      (err.type === 'entity.parse.failed' ||
        (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400)))
    ) {
      return res.status(400).json({
        ok: false,
        errors: [{ field: 'body', message: 'invalid JSON' }]
      });
    }
    next(err);
  });

  app.use(createQueryRouter({ readingsRepo, liveState, health, liveHub }));
  app.use(createSensorDataRouter({ ingestService }));
  app.use(createAlertsRouter({ alertsRepo }));

  return app;
}
