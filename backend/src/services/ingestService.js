/**
 * Ingest service orchestrating persistent storage (MongoDB) and live state caching (Valkey).
 *
 * @param {Object} params
 * @param {Object} params.readingsRepo - MongoDB readings repository
 * @param {Object} [params.liveState] - Valkey live state repository
 * @param {Object} [params.alertService] - Alert service
 */
export function createIngestService({ readingsRepo, liveState, alertService } = {}) {
  /**
   * Ingests a validated sensor reading.
   *
   * @param {Object} value - Validated sensor reading
   * @returns {Promise<{ id: string }>}
   */
  async function ingest(value) {
    const receivedAt = new Date();
    const id = await readingsRepo.insertReading(value, receivedAt);

    try {
      if (liveState && typeof liveState.saveReading === 'function') {
        await liveState.saveReading({
          ...value,
          receivedAt: receivedAt.toISOString()
        });
      }
    } catch (err) {
      console.warn('Failed to save live state reading in Valkey:', err?.message || err);
    }

    if (alertService && typeof alertService.process === 'function') {
      try {
        await alertService.process({
          ...value,
          receivedAt
        });
      } catch (err) {
        console.warn('Failed to process alerts:', err?.message || err);
      }
    }

    return { id };
  }

  return {
    ingest
  };
}
