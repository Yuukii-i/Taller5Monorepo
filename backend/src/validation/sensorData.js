/**
 * Precision-safe rounding to 2 decimal places.
 * Handles exponent-form numbers (e.g. 1e-7, 1e21) and normalizes -0 to 0.
 * e.g., 24.555 -> 24.56, 1.005 -> 1.01
 */
function roundTo2Decimals(num) {
  if (!Number.isFinite(num)) {
    return NaN;
  }
  const parts = num.toString().split('e');
  const exp = 2;
  const shifted = Math.round(Number(parts[0] + 'e' + (parts[1] ? Number(parts[1]) + exp : exp)));
  if (!Number.isFinite(shifted)) {
    return NaN;
  }
  const shiftedParts = shifted.toString().split('e');
  const result = Number(shiftedParts[0] + 'e' + (shiftedParts[1] ? Number(shiftedParts[1]) - exp : -exp));
  if (!Number.isFinite(result)) {
    return NaN;
  }
  return result === 0 ? 0 : result;
}

/**
 * Parses a number or numeric string. Rejects null, boolean, empty strings,
 * non-finite values, and invalid numeric string formats.
 */
function parseDecimal(val) {
  if (typeof val === 'boolean' || val === null || val === undefined) {
    return null;
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
      return null;
    }
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Validates sensor data payload according to Taller 5 requirements.
 * Pure function: returns { ok: true, value } or { ok: false, errors: [{ field, message }] }.
 */
export function validateSensorData(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      errors: [{ field: 'body', message: 'body must be a plain object' }]
    };
  }

  const errors = [];
  let validDeviceId;
  let validTemperatura;
  let validHumedad;
  let validNivelAgua;

  // 1. deviceId: non-empty string, trimmed, 1-64 chars
  if (body.deviceId === undefined) {
    errors.push({ field: 'deviceId', message: 'deviceId is required' });
  } else if (typeof body.deviceId !== 'string') {
    errors.push({ field: 'deviceId', message: 'deviceId must be a string' });
  } else {
    const trimmed = body.deviceId.trim();
    if (trimmed.length < 1 || trimmed.length > 64) {
      errors.push({ field: 'deviceId', message: 'deviceId must be between 1 and 64 characters' });
    } else {
      validDeviceId = trimmed;
    }
  }

  // 2. temperatura: number or numeric string, range -50..150, rounded to 2 decimals
  if (body.temperatura === undefined) {
    errors.push({ field: 'temperatura', message: 'temperatura is required' });
  } else {
    const num = parseDecimal(body.temperatura);
    if (num === null) {
      errors.push({ field: 'temperatura', message: 'temperatura must be a valid number' });
    } else {
      const rounded = roundTo2Decimals(num);
      if (!Number.isFinite(rounded)) {
        errors.push({ field: 'temperatura', message: 'temperatura must be a valid number' });
      } else if (rounded < -50 || rounded > 150) {
        errors.push({ field: 'temperatura', message: 'temperatura must be between -50 and 150' });
      } else {
        validTemperatura = rounded;
      }
    }
  }

  // 3. humedad: number or numeric string, range 0..100, rounded to 2 decimals
  if (body.humedad === undefined) {
    errors.push({ field: 'humedad', message: 'humedad is required' });
  } else {
    const num = parseDecimal(body.humedad);
    if (num === null) {
      errors.push({ field: 'humedad', message: 'humedad must be a valid number' });
    } else {
      const rounded = roundTo2Decimals(num);
      if (!Number.isFinite(rounded)) {
        errors.push({ field: 'humedad', message: 'humedad must be a valid number' });
      } else if (rounded < 0 || rounded > 100) {
        errors.push({ field: 'humedad', message: 'humedad must be between 0 and 100' });
      } else {
        validHumedad = rounded;
      }
    }
  }

  // 4. nivelAgua: integer 0..4, number or integer string
  if (body.nivelAgua === undefined) {
    errors.push({ field: 'nivelAgua', message: 'nivelAgua is required' });
  } else {
    let intVal = null;
    if (typeof body.nivelAgua === 'number' && Number.isInteger(body.nivelAgua)) {
      intVal = body.nivelAgua;
    } else if (typeof body.nivelAgua === 'string') {
      const trimmed = body.nivelAgua.trim();
      if (/^-?\d+$/.test(trimmed)) {
        intVal = Number.parseInt(trimmed, 10);
      }
    }

    if (intVal === null) {
      errors.push({ field: 'nivelAgua', message: 'nivelAgua must be an integer between 0 and 4' });
    } else if (intVal < 0 || intVal > 4) {
      errors.push({ field: 'nivelAgua', message: 'nivelAgua must be between 0 and 4' });
    } else {
      validNivelAgua = intVal;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      deviceId: validDeviceId,
      temperatura: validTemperatura,
      humedad: validHumedad,
      nivelAgua: validNivelAgua,
      nivelAguaPct: validNivelAgua * 25
    }
  };
}
