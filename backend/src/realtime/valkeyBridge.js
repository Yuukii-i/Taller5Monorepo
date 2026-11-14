/**
 * Bridges Valkey pub/sub channels to a WebSocket liveHub.
 *
 * @param {Object} options
 * @param {Object} options.subscriber - ioredis subscriber client
 * @param {Object} options.hub - liveHub instance with broadcast(obj)
 * @param {string[]} [options.channels=['readings', 'alerts']]
 */
export function createValkeyBridge({ subscriber, hub, channels = ['readings', 'alerts'] } = {}) {
  let started = false;

  function onMessage(channel, rawMessage) {
    if (!channels.includes(channel)) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      console.warn(`Invalid JSON on Valkey channel "${channel}"`);
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.type !== 'string') {
      console.warn(`Invalid message shape on Valkey channel "${channel}"`);
      return;
    }

    try {
      hub.broadcast(parsed);
    } catch (err) {
      console.warn(`Failed to broadcast message from "${channel}":`, err?.message || String(err));
    }
  }

  /**
   * Subscribes to configured channels and starts forwarding messages.
   *
   * @returns {Promise<void>}
   */
  async function start() {
    if (!subscriber || started) {
      return;
    }
    started = true;
    subscriber.on('message', onMessage);
    try {
      await subscriber.subscribe(...channels);
    } catch (err) {
      console.warn('Valkey bridge subscribe error:', err?.message || String(err));
    }
  }

  /**
   * Unsubscribes from channels and detaches the message listener.
   *
   * @returns {Promise<void>}
   */
  async function stop() {
    if (!subscriber) {
      return;
    }
    started = false;
    subscriber.removeListener('message', onMessage);
    try {
      await subscriber.unsubscribe(...channels);
    } catch {
      // Ignore unsubscribe errors during shutdown.
    }
  }

  return {
    start,
    stop
  };
}
