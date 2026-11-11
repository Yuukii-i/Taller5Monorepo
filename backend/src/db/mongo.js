import { MongoClient } from 'mongodb';

/**
 * Connects to MongoDB with the given URI.
 * Returns an object containing the MongoClient and Db instances.
 */
export async function connectMongo(uri) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  return { client, db };
}

/**
 * Closes the MongoClient connection cleanly if open.
 */
export async function closeMongo(client) {
  if (client) {
    await client.close();
  }
}
