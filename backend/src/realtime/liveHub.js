import WebSocket, { WebSocketServer } from 'ws';

/**
 * Creates a WebSocket hub attached to an existing HTTP server.
 *
 * @param {Object} options
 * @param {import('http').Server} options.server
 * @param {string} [options.path='/live']
 * @param {number} [options.heartbeatMs=30000]
 */
export function createLiveHub({ server, path = '/live', heartbeatMs = 30000 } = {}) {
  const wss = new WebSocketServer({
    server,
    path,
    maxPayload: 4096
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', () => {
      // Client messages are ignored; the feed is server-to-client only.
    });

    ws.on('error', () => {
      // Prevent unhandled socket errors from crashing the process.
    });

    try {
      ws.send(
        JSON.stringify({
          type: 'hello',
          data: { serverTime: new Date().toISOString() }
        })
      );
    } catch {
      // Ignore send failure on immediate disconnect.
    }
  });

  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {
        client.terminate();
      }
    }
  }, heartbeatMs);

  heartbeatInterval.unref?.();

  /**
   * Broadcasts a JSON-serializable object to all open WebSocket clients.
   *
   * @param {Object} obj
   */
  function broadcast(obj) {
    const payload = JSON.stringify(obj);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {
          // A failing send must not stop broadcasts to other clients.
        }
      }
    }
  }

  /**
   * Returns the number of currently connected WebSocket clients.
   *
   * @returns {number}
   */
  function clientCount() {
    return wss.clients.size;
  }

  /**
   * Stops the heartbeat, terminates all clients, and closes the WebSocket server.
   *
   * @returns {Promise<void>}
   */
  function close() {
    clearInterval(heartbeatInterval);
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // Ignore termination errors during shutdown.
      }
    }
    return new Promise((resolve) => {
      wss.close(() => resolve());
    });
  }

  return {
    broadcast,
    clientCount,
    close
  };
}
