const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const deviceId = `smoke_${Date.now()}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
let failures = 0;

function report(name, ok, details = '') {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${details ? ` - ${details}` : ''}`);
  }
}

async function runSmoke() {
  console.log(`Running smoke test against ${BASE_URL} (deviceId: ${deviceId})\n`);

  // 1. GET /health -> 200, body.status "ok", mongo "up", valkey "up"
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const body = await res.json();
    const ok = res.status === 200 &&
      body.status === 'ok' &&
      body.mongo === 'up' &&
      body.valkey === 'up';
    report('GET /health', ok);
  } catch (err) {
    report('GET /health', false, err.message);
  }

  // 2. POST /sensor-data x15 (~50ms apart) + 1 extra with text/plain -> 201
  let lastPost = null;
  let allPostsOk = true;

  for (let i = 0; i < 15; i++) {
    if (i > 0) await sleep(50);
    const reading = {
      deviceId,
      temperatura: 20.00 + i * 0.5,
      humedad: 50.00,
      nivelAgua: i % 5
    };
    try {
      const res = await fetch(`${BASE_URL}/sensor-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reading)
      });
      const body = await res.json();
      if (res.status !== 201 || !body.ok || !body.id) {
        allPostsOk = false;
      }
      lastPost = reading;
    } catch {
      allPostsOk = false;
    }
  }
  report('POST /sensor-data x15', allPostsOk);

  let extraPostOk = false;
  try {
    await sleep(50);
    const extraReading = {
      deviceId,
      temperatura: 20.00 + 15 * 0.5,
      humedad: 50.00,
      nivelAgua: 15 % 5
    };
    const res = await fetch(`${BASE_URL}/sensor-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(extraReading)
    });
    const body = await res.json();
    if (res.status === 201 && body.ok && body.id) {
      extraPostOk = true;
      lastPost = extraReading;
    }
  } catch {
    extraPostOk = false;
  }
  report('POST /sensor-data text/plain', extraPostOk);

  // 3. POST invalid (nivelAgua 9) -> 400; POST broken JSON {bad -> 400
  try {
    const res = await fetch(`${BASE_URL}/sensor-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        temperatura: 25.0,
        humedad: 50.0,
        nivelAgua: 9
      })
    });
    report('POST /sensor-data invalid nivelAgua -> 400', res.status === 400);
  } catch (err) {
    report('POST /sensor-data invalid nivelAgua -> 400', false, err.message);
  }

  try {
    const res = await fetch(`${BASE_URL}/sensor-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad'
    });
    report('POST /sensor-data broken JSON -> 400', res.status === 400);
  } catch (err) {
    report('POST /sensor-data broken JSON -> 400', false, err.message);
  }

  // 4. GET /readings/latest?deviceId=<id> -> 200, source "valkey", numeric last temperatura
  try {
    const res = await fetch(`${BASE_URL}/readings/latest?deviceId=${encodeURIComponent(deviceId)}`);
    const body = await res.json();
    const ok = res.status === 200 &&
      body.source === 'valkey' &&
      typeof body.data?.temperatura === 'number' &&
      lastPost !== null &&
      body.data?.temperatura === lastPost.temperatura;
    report('GET /readings/latest?deviceId=<id>', ok);
  } catch (err) {
    report('GET /readings/latest?deviceId=<id>', false, err.message);
  }

  // 5. GET /readings/recent?deviceId=<id> -> 200, source "valkey", exactly 10, newest first, first equals last post
  try {
    const res = await fetch(`${BASE_URL}/readings/recent?deviceId=${encodeURIComponent(deviceId)}`);
    const body = await res.json();
    let nonIncreasing = true;
    if (Array.isArray(body.data)) {
      for (let i = 0; i < body.data.length - 1; i++) {
        if (new Date(body.data[i].receivedAt).getTime() < new Date(body.data[i + 1].receivedAt).getTime()) {
          nonIncreasing = false;
          break;
        }
      }
    }
    const firstEqualsLast = body.data?.[0]?.temperatura === lastPost?.temperatura;
    const ok = res.status === 200 &&
      body.source === 'valkey' &&
      Array.isArray(body.data) &&
      body.data.length === 10 &&
      nonIncreasing &&
      firstEqualsLast;
    report('GET /readings/recent?deviceId=<id>', ok);
  } catch (err) {
    report('GET /readings/recent?deviceId=<id>', false, err.message);
  }

  // 6. GET /readings/recent?deviceId=<id>&limit=100 -> source "mongo", exactly 16 items
  try {
    const res = await fetch(`${BASE_URL}/readings/recent?deviceId=${encodeURIComponent(deviceId)}&limit=100`);
    const body = await res.json();
    const ok = res.status === 200 &&
      body.source === 'mongo' &&
      Array.isArray(body.data) &&
      body.data.length === 16;
    report('GET /readings/recent?deviceId=<id>&limit=100', ok);
  } catch (err) {
    report('GET /readings/recent?deviceId=<id>&limit=100', false, err.message);
  }

  // 7. GET /stats/hourly?deviceId=<id>&hours=1 -> 200, data length >= 1, sum of counts == 16, min <= avg <= max
  try {
    const res = await fetch(`${BASE_URL}/stats/hourly?deviceId=${encodeURIComponent(deviceId)}&hours=1`);
    const body = await res.json();
    let validStats = false;
    if (res.status === 200 && Array.isArray(body.data) && body.data.length >= 1) {
      const totalCount = body.data.reduce((sum, item) => sum + (item.count || 0), 0);
      const validTemps = body.data.every((item) => {
        const t = item.temperatura;
        return t &&
          typeof t.min === 'number' &&
          typeof t.avg === 'number' &&
          typeof t.max === 'number' &&
          t.min <= t.avg &&
          t.avg <= t.max;
      });
      validStats = totalCount === 16 && validTemps;
    }
    report('GET /stats/hourly?deviceId=<id>&hours=1', validStats);
  } catch (err) {
    report('GET /stats/hourly?deviceId=<id>&hours=1', false, err.message);
  }

  // 8. GET /devices -> contains the smoke device with online true
  try {
    const res = await fetch(`${BASE_URL}/devices`);
    const body = await res.json();
    const found = Array.isArray(body.devices) && body.devices.find((d) => d.deviceId === deviceId);
    const ok = res.status === 200 && Boolean(found && found.online === true);
    report('GET /devices', ok);
  } catch (err) {
    report('GET /devices', false, err.message);
  }

  // 9. GET /readings/latest?deviceId=nonexistent_<Date.now()> -> 404
  try {
    const nonexistent = `nonexistent_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/readings/latest?deviceId=${encodeURIComponent(nonexistent)}`);
    report('GET /readings/latest nonexistent -> 404', res.status === 404);
  } catch (err) {
    report('GET /readings/latest nonexistent -> 404', false, err.message);
  }

  console.log(`\nSummary: ${passed} passed, ${failures} failed`);
  if (failures > 0) {
    process.exit(1);
  }
}

runSmoke();
