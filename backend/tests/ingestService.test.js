import { describe, it, expect, vi } from 'vitest';
import { createIngestService } from '../src/services/ingestService.js';

describe('ingestService', () => {
  it('writes to both Mongo readings repository and Valkey live state', async () => {
    const fakeReadingsRepo = {
      insertReading: vi.fn().mockResolvedValue('mongo-id-abc')
    };
    const fakeLiveState = {
      saveReading: vi.fn().mockResolvedValue(undefined)
    };

    const service = createIngestService({
      readingsRepo: fakeReadingsRepo,
      liveState: fakeLiveState
    });

    const readingValue = {
      deviceId: 'esp32_1',
      temperatura: 24.5,
      humedad: 60.0,
      nivelAgua: 2,
      nivelAguaPct: 50
    };

    const result = await service.ingest(readingValue);

    expect(result).toEqual({ id: 'mongo-id-abc' });
    expect(fakeReadingsRepo.insertReading).toHaveBeenCalledTimes(1);
    const [insertedValue, receivedAt] = fakeReadingsRepo.insertReading.mock.calls[0];
    expect(insertedValue).toEqual(readingValue);
    expect(receivedAt).toBeInstanceOf(Date);

    expect(fakeLiveState.saveReading).toHaveBeenCalledTimes(1);
    expect(fakeLiveState.saveReading).toHaveBeenCalledWith({
      ...readingValue,
      receivedAt: receivedAt.toISOString()
    });
  });

  it('resolves and preserves Mongo record when Valkey throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeReadingsRepo = {
      insertReading: vi.fn().mockResolvedValue('mongo-id-saved')
    };
    const failingLiveState = {
      saveReading: vi.fn().mockRejectedValue(new Error('Valkey connection refused'))
    };

    const service = createIngestService({
      readingsRepo: fakeReadingsRepo,
      liveState: failingLiveState
    });

    const readingValue = {
      deviceId: 'esp32_1',
      temperatura: 22.0,
      humedad: 45.0,
      nivelAgua: 3,
      nivelAguaPct: 75
    };

    const result = await service.ingest(readingValue);

    expect(result).toEqual({ id: 'mongo-id-saved' });
    expect(fakeReadingsRepo.insertReading).toHaveBeenCalled();
    expect(failingLiveState.saveReading).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to save live state reading in Valkey:',
      'Valkey connection refused'
    );

    warnSpy.mockRestore();
  });

  it('rejects and does NOT call liveState.saveReading when Mongo throws', async () => {
    const fakeReadingsRepo = {
      insertReading: vi.fn().mockRejectedValue(new Error('MongoDB connection timeout'))
    };
    const fakeLiveState = {
      saveReading: vi.fn().mockResolvedValue(undefined)
    };

    const service = createIngestService({
      readingsRepo: fakeReadingsRepo,
      liveState: fakeLiveState
    });

    const readingValue = {
      deviceId: 'esp32_1',
      temperatura: 25.0,
      humedad: 55.0,
      nivelAgua: 1,
      nivelAguaPct: 25
    };

    await expect(service.ingest(readingValue)).rejects.toThrow('MongoDB connection timeout');
    expect(fakeReadingsRepo.insertReading).toHaveBeenCalled();
    expect(fakeLiveState.saveReading).not.toHaveBeenCalled();
  });

  it('calls alertService.process with receivedAt Date and swallows alertService errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeReadingsRepo = {
      insertReading: vi.fn().mockResolvedValue('mongo-id-alert-test')
    };
    const fakeLiveState = {
      saveReading: vi.fn().mockResolvedValue(undefined)
    };
    const failingAlertService = {
      process: vi.fn().mockRejectedValue(new Error('Alert failure'))
    };

    const service = createIngestService({
      readingsRepo: fakeReadingsRepo,
      liveState: fakeLiveState,
      alertService: failingAlertService
    });

    const readingValue = {
      deviceId: 'esp32_1',
      temperatura: 35.0,
      humedad: 55.0,
      nivelAgua: 1,
      nivelAguaPct: 25
    };

    const result = await service.ingest(readingValue);

    expect(result).toEqual({ id: 'mongo-id-alert-test' });
    expect(failingAlertService.process).toHaveBeenCalledTimes(1);
    const [processedArg] = failingAlertService.process.mock.calls[0];
    expect(processedArg.deviceId).toBe('esp32_1');
    expect(processedArg.receivedAt).toBeInstanceOf(Date);
    expect(warnSpy).toHaveBeenCalledWith('Failed to process alerts:', 'Alert failure');

    warnSpy.mockRestore();
  });
});
