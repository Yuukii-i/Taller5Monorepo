export const VALID_MODES = ['fixed', 'random', 'alert'];

const DEFAULTS = {
  baseUrl: 'http://localhost:3000',
  deviceId: 'esp32_1',
  intervalMs: 10000,
  mode: 'fixed',
  count: 0,
  numbers: false
};

const ALERT_CYCLE = [
  { temperatura: 24.5, humedad: 60, nivelAgua: 3 },
  { temperatura: 35.2, humedad: 55, nivelAgua: 3 },
  { temperatura: 25, humedad: 58, nivelAgua: 0 },
  { temperatura: 36, humedad: 50, nivelAgua: 1 }
];

function parseIntStrict(raw, name) {
  const str = String(raw).trim();
  if (str === '' || !/^-?\d+$/.test(str)) {
    throw new Error(
      `Valor inválido para ${name}: "${raw}". Debe ser un número entero.`
    );
  }
  return Number.parseInt(str, 10);
}

export function parseArgs(argv = [], env = {}) {
  const opts = {
    baseUrl: env.BASE_URL || DEFAULTS.baseUrl,
    deviceId: env.DEVICE_ID || DEFAULTS.deviceId,
    intervalMs:
      env.INTERVAL_MS !== undefined
        ? parseIntStrict(env.INTERVAL_MS, 'INTERVAL_MS')
        : DEFAULTS.intervalMs,
    mode: env.MODE || DEFAULTS.mode,
    count:
      env.COUNT !== undefined
        ? parseIntStrict(env.COUNT, 'COUNT')
        : DEFAULTS.count,
    numbers: DEFAULTS.numbers
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--numbers') {
      opts.numbers = true;
      continue;
    }

    const eqIdx = arg.indexOf('=');
    const flag = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
    const readValue = () => {
      if (eqIdx !== -1) return arg.slice(eqIdx + 1);
      if (i + 1 >= argv.length) {
        throw new Error(`Falta el valor para la opción ${flag}.`);
      }
      i += 1;
      return argv[i];
    };

    if (flag === '--url') {
      opts.baseUrl = readValue();
    } else if (flag === '--device') {
      opts.deviceId = readValue();
    } else if (flag === '--interval') {
      opts.intervalMs = parseIntStrict(readValue(), '--interval');
    } else if (flag === '--mode') {
      opts.mode = readValue();
    } else if (flag === '--count') {
      opts.count = parseIntStrict(readValue(), '--count');
    } else {
      throw new Error(
        `Opción desconocida: "${arg}". Opciones válidas: --url, --device, --interval, --mode (${VALID_MODES.join(', ')}), --count, --numbers.`
      );
    }
  }

  if (!opts.baseUrl || String(opts.baseUrl).trim() === '') {
    throw new Error('La URL base (--url) no puede estar vacía.');
  }
  if (!opts.deviceId || String(opts.deviceId).trim() === '') {
    throw new Error('El identificador de dispositivo (--device) no puede estar vacío.');
  }
  if (opts.intervalMs < 100) {
    throw new Error(
      `Intervalo inválido (${opts.intervalMs} ms). Debe ser >= 100 ms.`
    );
  }
  if (opts.count < 0) {
    throw new Error(
      `Cantidad inválida (${opts.count}). Debe ser >= 0 (0 = infinito).`
    );
  }
  if (!VALID_MODES.includes(opts.mode)) {
    throw new Error(
      `Modo inválido: "${opts.mode}". Modos válidos: ${VALID_MODES.join(', ')}.`
    );
  }

  return opts;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createPayloadGenerator(mode, { rng = Math.random } = {}) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(
      `Modo inválido: "${mode}". Modos válidos: ${VALID_MODES.join(', ')}.`
    );
  }

  if (mode === 'fixed') {
    return {
      next() {
        return { temperatura: 24.5, humedad: 60, nivelAgua: 2 };
      }
    };
  }

  if (mode === 'alert') {
    let step = 0;
    return {
      next() {
        const sample = ALERT_CYCLE[step % ALERT_CYCLE.length];
        step += 1;
        return { ...sample };
      }
    };
  }

  let temperatura = 24.5;
  let humedad = 60.0;
  let nivelAgua = 2;
  let step = 0;

  return {
    next() {
      if (step > 0) {
        const tempDelta = (rng() * 2 - 1) * 0.8;
        const humDelta = (rng() * 2 - 1) * 2;
        temperatura = round2(clamp(temperatura + tempDelta, 15, 40));
        humedad = round2(clamp(humedad + humDelta, 30, 90));

        if (step % 3 === 0) {
          const waterStep = Math.floor(rng() * 3) - 1;
          nivelAgua = clamp(nivelAgua + waterStep, 0, 4);
        }
      }
      step += 1;
      return { temperatura, humedad, nivelAgua };
    }
  };
}

export function formatPayload(deviceId, values, { numbers = false } = {}) {
  const temp = round2(Number(values.temperatura));
  const hum = round2(Number(values.humedad));
  const nivelAgua = Math.round(Number(values.nivelAgua));

  return {
    deviceId,
    temperatura: numbers ? temp : temp.toFixed(2),
    humedad: numbers ? hum : hum.toFixed(2),
    nivelAgua
  };
}
