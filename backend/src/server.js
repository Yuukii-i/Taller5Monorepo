import { createApp } from './app.js';
import { config } from './config.js';
import { connectMongo, closeMongo } from './db/mongo.js';
import { createValkeyClient, closeValkey } from './db/valkey.js';
import { createReadingsRepository } from './repositories/readingsRepository.js';
import { createAlertsRepository } from './repositories/alertsRepository.js';
import { createLiveStateRepository } from './repositories/liveStateRepository.js';
import { createAlertService } from './services/alertService.js';
import { createIngestService } from './services/ingestService.js';

let server;
let mongoClient;
let valkeyClient;

async function start() {
  try {
    const { client, db } = await connectMongo(config.MONGO_URI);
    mongoClient = client;

    const readingsRepo = createReadingsRepository(db);
    await readingsRepo.ensureIndexes();

    const alertsRepo = createAlertsRepository(db);
    await alertsRepo.ensureIndexes();

    try {
      valkeyClient = createValkeyClient(config.VALKEY_URL);
    } catch (err) {
      console.warn('Failed to initialize Valkey client:', err.message);
    }

    const liveState = valkeyClient
      ? createLiveStateRepository(valkeyClient, {
          onlineTtlSeconds: config.ONLINE_TTL_SECONDS
        })
      : null;

    const alertService = createAlertService({
      alertsRepo,
      liveState,
      thresholds: {
        tempMax: config.ALERT_TEMP_MAX,
        waterMinLevel: config.ALERT_WATER_MIN_LEVEL
      },
      cooldownSeconds: config.ALERT_COOLDOWN_SECONDS
    });

    const ingestService = createIngestService({ readingsRepo, liveState, alertService });

    const health = {
      mongo: () => (readingsRepo ? readingsRepo.ping() : Promise.resolve(false)),
      valkey: () => (liveState ? liveState.ping() : Promise.resolve(false))
    };

    const app = createApp({ ingestService, readingsRepo, liveState, health, alertsRepo });

    server = app.listen(config.PORT, () => {
      console.log(`Server listening on port ${config.PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

async function shutdown() {
  console.log('Shutting down server...');
  if (server) {
    server.close();
  }
  if (valkeyClient) {
    await closeValkey(valkeyClient);
  }
  if (mongoClient) {
    await closeMongo(mongoClient);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
