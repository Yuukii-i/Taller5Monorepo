import { createApp } from './app.js';
import { config } from './config.js';
import { connectMongo, closeMongo } from './db/mongo.js';
import { createValkeyClient, createValkeySubscriber, closeValkey } from './db/valkey.js';
import { createReadingsRepository } from './repositories/readingsRepository.js';
import { createAlertsRepository } from './repositories/alertsRepository.js';
import { createLiveStateRepository } from './repositories/liveStateRepository.js';
import { createAlertService } from './services/alertService.js';
import { createIngestService } from './services/ingestService.js';
import { createLiveHub } from './realtime/liveHub.js';
import { createValkeyBridge } from './realtime/valkeyBridge.js';

let server;
let mongoClient;
let valkeyClient;
let valkeySubscriber;
let liveHub;
let valkeyBridge;

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

    const app = createApp({
      ingestService,
      readingsRepo,
      liveState,
      health,
      alertsRepo,
      liveHub: { clientCount: () => (liveHub ? liveHub.clientCount() : 0) }
    });

    server = app.listen(config.PORT, () => {
      console.log(`Server listening on port ${config.PORT}`);
    });

    liveHub = createLiveHub({ server });

    try {
      valkeySubscriber = createValkeySubscriber(config.VALKEY_URL);
      valkeyBridge = createValkeyBridge({ subscriber: valkeySubscriber, hub: liveHub });
      await valkeyBridge.start();
    } catch (err) {
      console.warn('Failed to initialize Valkey subscriber:', err.message);
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

async function shutdown() {
  console.log('Shutting down server...');
  if (valkeyBridge) {
    await valkeyBridge.stop();
  }
  if (valkeySubscriber) {
    await closeValkey(valkeySubscriber);
  }
  if (liveHub) {
    await liveHub.close();
  }
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
