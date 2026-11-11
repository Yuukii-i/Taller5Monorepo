/**
 * Repository for storing and retrieving alerts in MongoDB.
 *
 * @param {import('mongodb').Db} db
 */
export function createAlertsRepository(db) {
  const collection = db.collection('alerts');

  /**
   * Ensures indexes on createdAt and { deviceId: 1, createdAt: -1 }.
   */
  async function ensureIndexes() {
    await collection.createIndex({ createdAt: -1 });
    await collection.createIndex({ deviceId: 1, createdAt: -1 });
  }

  /**
   * Inserts an alert document. Returns inserted id as a string.
   *
   * @param {Object} doc - { deviceId, type, value, threshold, message, createdAt }
   * @returns {Promise<string>}
   */
  async function insertAlert(doc) {
    const docToInsert = {
      ...doc,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt
          : new Date(doc.createdAt || Date.now())
    };
    const result = await collection.insertOne(docToInsert);
    return result.insertedId.toString();
  }

  /**
   * Finds recent alerts, optionally filtered by deviceId, newest first.
   * Normalized: no _id, createdAt as ISO string.
   *
   * @param {Object} [options]
   * @param {string} [options.deviceId]
   * @param {number} [options.limit=20]
   * @returns {Promise<Array<Object>>}
   */
  async function findRecent({ deviceId, limit = 20 } = {}) {
    const query = {};
    if (deviceId) {
      query.deviceId = deviceId;
    }

    const docs = await collection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((doc) => ({
      id: doc._id.toString(),
      deviceId: doc.deviceId,
      type: doc.type,
      value: doc.value,
      threshold: doc.threshold,
      message: doc.message,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : new Date(doc.createdAt).toISOString()
    }));
  }

  return {
    ensureIndexes,
    insertAlert,
    findRecent
  };
}
