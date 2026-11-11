/**
 * Repository for storing, querying, and aggregating sensor readings in MongoDB.
 */
export function createReadingsRepository(db) {
  const collection = db.collection('readings');

  /**
   * Ensures the compound index { deviceId: 1, receivedAt: -1 } exists.
   */
  async function ensureIndexes() {
    await collection.createIndex({ deviceId: 1, receivedAt: -1 });
  }

  /**
   * Inserts a validated reading value along with receivedAt timestamp.
   * Returns the generated document id as a string.
   */
  async function insertReading(value, receivedAt = new Date()) {
    const doc = {
      ...value,
      receivedAt
    };
    const result = await collection.insertOne(doc);
    return result.insertedId.toString();
  }

  /**
   * Retrieves the latest reading for a given deviceId, sorted newest first.
   * Returns normalized reading shape or null if not found.
   */
  async function findLatest(deviceId) {
    const doc = await collection.findOne(
      { deviceId },
      { sort: { receivedAt: -1 } }
    );
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

  /**
   * Retrieves recent readings for a deviceId sorted newest first up to limit.
   */
  async function findRecent(deviceId, limit = 10) {
    const docs = await collection
      .find({ deviceId })
      .sort({ receivedAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((doc) => ({
      deviceId: doc.deviceId,
      temperatura: doc.temperatura,
      humedad: doc.humedad,
      nivelAgua: doc.nivelAgua,
      nivelAguaPct: doc.nivelAguaPct,
      receivedAt:
        doc.receivedAt instanceof Date
          ? doc.receivedAt.toISOString()
          : new Date(doc.receivedAt).toISOString()
    }));
  }

  /**
   * Aggregates readings into hourly stats for a device within a given lookback window.
   */
  async function hourlyStats(deviceId, hours = 24, now = new Date()) {
    const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const pipeline = [
      {
        $match: {
          deviceId,
          receivedAt: { $gte: cutoff }
        }
      },
      {
        $group: {
          _id: {
            $dateTrunc: { date: '$receivedAt', unit: 'hour' }
          },
          count: { $sum: 1 },
          tempAvg: { $avg: '$temperatura' },
          tempMin: { $min: '$temperatura' },
          tempMax: { $max: '$temperatura' },
          humAvg: { $avg: '$humedad' },
          humMin: { $min: '$humedad' },
          humMax: { $max: '$humedad' },
          waterAvg: { $avg: '$nivelAgua' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ];

    const results = await collection.aggregate(pipeline).toArray();
    return results.map((row) => ({
      hour:
        row._id instanceof Date
          ? row._id.toISOString()
          : new Date(row._id).toISOString(),
      count: row.count,
      temperatura: {
        avg: Math.round(row.tempAvg * 100) / 100,
        min: row.tempMin,
        max: row.tempMax
      },
      humedad: {
        avg: Math.round(row.humAvg * 100) / 100,
        min: row.humMin,
        max: row.humMax
      },
      nivelAguaAvg: Math.round(row.waterAvg * 100) / 100
    }));
  }

  /**
   * Lists distinct deviceIds present in the database, sorted ascending.
   */
  async function listDeviceIds() {
    const ids = await collection.distinct('deviceId');
    return (ids || []).slice().sort();
  }

  /**
   * Checks database connectivity. Never throws; returns boolean.
   */
  async function ping() {
    try {
      await db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  return {
    ensureIndexes,
    insertReading,
    findLatest,
    findRecent,
    hourlyStats,
    listDeviceIds,
    ping
  };
}
