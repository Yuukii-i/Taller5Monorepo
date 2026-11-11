import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { createAlertsRepository } from '../src/repositories/alertsRepository.js';

describe('alertsRepository with mongodb-memory-server', () => {
  let mongod;
  let client;
  let db;
  let repo;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    const connection = await connectMongo(uri);
    client = connection.client;
    db = connection.db;
    repo = createAlertsRepository(db);
  }, 60000);

  afterAll(async () => {
    if (client) {
      await closeMongo(client);
    }
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(async () => {
    await db.collection('alerts').deleteMany({});
  });

  it('creates the expected indexes: { createdAt: -1 } and { deviceId: 1, createdAt: -1 }', async () => {
    await repo.ensureIndexes();

    const indexes = await db.collection('alerts').indexes();
    const createdAtIndex = indexes.find(
      (idx) => idx.key && idx.key.createdAt === -1 && Object.keys(idx.key).length === 1
    );
    const compoundIndex = indexes.find(
      (idx) => idx.key && idx.key.deviceId === 1 && idx.key.createdAt === -1
    );

    expect(createdAtIndex).toBeDefined();
    expect(compoundIndex).toBeDefined();
  });

  it('inserts an alert document and returns string id with Date createdAt persisted', async () => {
    const alertDoc = {
      deviceId: 'esp32_rep1',
      type: 'temp_high',
      value: 32.5,
      threshold: 30,
      message: 'Temperatura alta: 32.5 C (limite 30 C)',
      createdAt: new Date('2026-11-11T12:00:00Z')
    };

    const insertedId = await repo.insertAlert(alertDoc);
    expect(typeof insertedId).toBe('string');
    expect(insertedId).toMatch(/^[0-9a-fA-F]{24}$/);

    const docInDb = await db.collection('alerts').findOne({ _id: new (await import('mongodb')).ObjectId(insertedId) });
    expect(docInDb).toBeDefined();
    expect(docInDb.deviceId).toBe('esp32_rep1');
    expect(docInDb.createdAt).toBeInstanceOf(Date);
  });

  it('finds recent alerts ordered newest first and normalized (no _id, id is string, createdAt is ISO)', async () => {
    await repo.insertAlert({
      deviceId: 'esp32_1',
      type: 'temp_high',
      value: 31.0,
      threshold: 30,
      message: 'alert 1',
      createdAt: new Date('2026-11-11T10:00:00Z')
    });

    await repo.insertAlert({
      deviceId: 'esp32_1',
      type: 'temp_high',
      value: 32.0,
      threshold: 30,
      message: 'alert 2',
      createdAt: new Date('2026-11-11T11:00:00Z')
    });

    await repo.insertAlert({
      deviceId: 'esp32_1',
      type: 'temp_high',
      value: 33.0,
      threshold: 30,
      message: 'alert 3',
      createdAt: new Date('2026-11-11T12:00:00Z')
    });

    const results = await repo.findRecent();
    expect(results).toHaveLength(3);

    // Newest first
    expect(results[0].message).toBe('alert 3');
    expect(results[1].message).toBe('alert 2');
    expect(results[2].message).toBe('alert 1');

    // Normalized
    for (const item of results) {
      expect(item._id).toBeUndefined();
      expect(typeof item.id).toBe('string');
      expect(typeof item.createdAt).toBe('string');
      expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('filters recent alerts by deviceId', async () => {
    await repo.insertAlert({
      deviceId: 'esp32_A',
      type: 'temp_high',
      value: 31.0,
      threshold: 30,
      message: 'A alert',
      createdAt: new Date()
    });
    await repo.insertAlert({
      deviceId: 'esp32_B',
      type: 'water_low',
      value: 0,
      threshold: 1,
      message: 'B alert',
      createdAt: new Date()
    });

    const resultsA = await repo.findRecent({ deviceId: 'esp32_A' });
    expect(resultsA).toHaveLength(1);
    expect(resultsA[0].deviceId).toBe('esp32_A');

    const resultsB = await repo.findRecent({ deviceId: 'esp32_B' });
    expect(resultsB).toHaveLength(1);
    expect(resultsB[0].deviceId).toBe('esp32_B');

    const resultsC = await repo.findRecent({ deviceId: 'esp32_nonexistent' });
    expect(resultsC).toHaveLength(0);
  });

  it('respects limit parameter and defaults to 20', async () => {
    for (let i = 1; i <= 25; i++) {
      await repo.insertAlert({
        deviceId: 'esp32_limit',
        type: 'temp_high',
        value: 30 + i,
        threshold: 30,
        message: `alert ${i}`,
        createdAt: new Date(1700000000000 + i * 1000)
      });
    }

    const defaultLimit = await repo.findRecent();
    expect(defaultLimit).toHaveLength(20);

    const customLimit = await repo.findRecent({ limit: 5 });
    expect(customLimit).toHaveLength(5);
    expect(customLimit[0].message).toBe('alert 25');
  });
});
