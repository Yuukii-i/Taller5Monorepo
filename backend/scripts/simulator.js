import { pathToFileURL } from 'node:url';
import {
  createPayloadGenerator,
  formatPayload,
  parseArgs
} from './simulatorCore.js';

const FETCH_TIMEOUT_MS = 10000;

function printUsage(log = console.log) {
  log(
    'Uso: node scripts/simulator.js [--url URL] [--device ID] [--interval MS] [--mode fixed|random|alert] [--count N] [--numbers]'
  );
}

function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runSimulator(
  options,
  { fetchImpl = fetch, log = console.log, sleep } = {}
) {
  const { baseUrl, deviceId, intervalMs, mode, count, numbers } = options;
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/sensor-data`;
  const generator = createPayloadGenerator(mode);

  const stopController = new AbortController();
  let stopped = false;

  const onSigint = () => {
    stopped = true;
    stopController.abort();
  };
  process.on('SIGINT', onSigint);

  let sent = 0;
  let ok = 0;
  let failed = 0;

  try {
    while (!stopped && (count === 0 || sent < count)) {
      const payload = formatPayload(deviceId, generator.next(), { numbers });
      const time = new Date().toISOString();
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);

      sent += 1;
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: timeoutController.signal
        });
        if (res.ok) {
          ok += 1;
        } else {
          failed += 1;
        }
        log(
          `[${time}] HTTP ${res.status} | temp=${payload.temperatura} hum=${payload.humedad} nivel=${payload.nivelAgua}`
        );
      } catch (err) {
        failed += 1;
        const msg = err?.name === 'AbortError' ? 'tiempo de espera agotado' : err?.message || String(err);
        log(
          `[${time}] ERROR (${msg}) | temp=${payload.temperatura} hum=${payload.humedad} nivel=${payload.nivelAgua}`
        );
      } finally {
        clearTimeout(timer);
      }

      if (stopped || (count > 0 && sent >= count)) {
        break;
      }

      if (sleep) {
        await sleep(intervalMs);
      } else {
        await defaultSleep(intervalMs, stopController.signal);
      }
    }
  } finally {
    process.off('SIGINT', onSigint);
  }

  log(`Resumen: ${sent} enviadas / ${ok} ok / ${failed} fallidas`);
  return { sent, ok, failed };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    printUsage(console.error);
    process.exitCode = 1;
    return;
  }

  await runSimulator(options);
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main();
}
