import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { createReadingsRepository } from '../src/repositories/readingsRepository.js';

describe('readingsRepository with mongodb-memory-server', () => {
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
    repo = createReadingsRepository(db);
  }, 60000);

  afterAll(async () => {
    if (client) {
      await closeMongo(client);
    }
    if (mongod) {
      await mongod.stop();
    }
  });

  it('creates the expected index { deviceId: 1, receivedAt: -1 }', async () => {
    await repo.ensureIndexes();

    const indexes = await db.collection('readings').indexes();
    const compoundIndex = indexes.find(
      idx => idx.key && idx.key.deviceId === 1 && idx.key.receivedAt === -1
    );

    expect(compoundIndex).toBeDefined();
  });

  it('inserts a reading, returns inserted id as string, and persists receivedAt Date', async () => {
    const readingValue = {
      deviceId: 'esp32_test',
      temperatura: 26.75,
      humedad: 55.4,
      nivelAgua: 3,
      nivelAguaPct: 75
    };

    const insertedId = await repo.insertReading(readingValue);
    expect(typeof insertedId).toBe('string');
    expect(insertedId.length).toBeGreaterThan(0);

    const doc = await db.collection('readings').findOne({ deviceId: 'esp32_test' });
    expect(doc).toBeDefined();
    expect(doc._id.toString()).toBe(insertedId);
    expect(doc.deviceId).toBe('esp32_test');
    expect(doc.temperatura).toBe(26.75);
    expect(doc.humedad).toBe(55.4);
    expect(doc.nivelAgua).toBe(3);
    expect(doc.nivelAguaPct).toBe(75);
    expect(doc.receivedAt).toBeInstanceOf(Date);
  });
});
