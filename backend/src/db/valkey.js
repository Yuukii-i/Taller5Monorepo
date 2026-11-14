import Redis from 'ioredis';

function attachErrorLogger(client) {
  const seenErrors = new Set();

  client.on('error', (err) => {
    const msg = err?.message || String(err);
    if (!seenErrors.has(msg)) {
      seenErrors.add(msg);
      console.warn(`Valkey connection error: ${msg}`);
    }
  });
}

/**
 * Creates a Valkey (Redis-compatible) client.
 *
 * @param {string} url - Valkey / Redis connection URL.
 * @returns {Redis}
 */
export function createValkeyClient(url) {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });

  attachErrorLogger(client);

  return client;
}

/**
 * Creates a dedicated Valkey subscriber client for pub/sub.
 * Queues subscribe commands until connected and auto-resubscribes on reconnect.
 *
 * @param {string} url - Valkey / Redis connection URL.
 * @returns {Redis}
 */
export function createValkeySubscriber(url) {
  const client = new Redis(url, {
    enableOfflineQueue: true,
    maxRetriesPerRequest: null,
    autoResubscribe: true
  });

  attachErrorLogger(client);

  return client;
}

/**
 * Safely closes the Valkey client.
 *
 * @param {Redis} client
 */
export async function closeValkey(client) {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
