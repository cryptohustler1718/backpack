const crypto = require('node:crypto');

const BASE = 'https://api.backpack.exchange';
const WINDOW = 60000;

// Keep the balance call first: it is the smallest authenticated snapshot and
// proves that the supplied key pair is valid before optional reads are made.
const routes = {
  balances: ['/api/v1/capital', 'balanceQuery'],
  account: ['/api/v1/account', 'accountQuery'],
  positions: ['/api/v1/position', 'positionQuery'],
  collateral: ['/api/v1/capital/collateral', 'collateralQuery'],
  borrowLend: ['/api/v1/borrowLend/positions', 'borrowLendPositionQuery']
};

function privateKeyFromSeed(seed) {
  const raw = Buffer.from(String(seed).trim(), 'base64');
  // Backpack documents a 32-byte seed. Some key generators return a 64-byte
  // secret-key buffer (seed + public key), so accepting its first 32 bytes is
  // compatible with Backpack's own reference client as well.
  if (raw.length !== 32 && raw.length !== 64) throw new Error('API secret must be a base64 ED25519 seed');
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return crypto.createPrivateKey({ key: Buffer.concat([prefix, raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
}

function signature(secret, instruction, search = '') {
  const timestamp = Date.now();
  const window = WINDOW;
  const message = `instruction=${instruction}${search ? `&${search}` : ''}&timestamp=${timestamp}&window=${window}`;
  const signed = crypto.sign(null, Buffer.from(message), privateKeyFromSeed(secret));
  return { timestamp, window, signature: signed.toString('base64') };
}

async function backpackGet(path, instruction, apiKey, apiSecret) {
  const url = new URL(path, BASE);
  const search = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const auth = signature(apiSecret, instruction, search);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-API-KEY': apiKey,
      'X-SIGNATURE': auth.signature,
      'X-TIMESTAMP': String(auth.timestamp),
      'X-WINDOW': String(auth.window)
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.message || body?.error || `Backpack returned ${response.status}`);
    error.status = response.status;
    error.code = body?.code || `HTTP_${response.status}`;
    error.path = path;
    throw error;
  }
  return body;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const { apiKey, apiSecret } = req.body || {};
    if (typeof apiKey !== 'string' || typeof apiSecret !== 'string' || !apiKey.trim() || !apiSecret.trim()) {
      return res.status(400).json({ ok: false, error: 'Read-only API key and secret are required', code: 'MISSING_CREDENTIALS' });
    }

    const cleanKey = apiKey.trim();
    const cleanSecret = apiSecret.trim();

    // An authentication failure here means the pair cannot be trusted. Do not
    // hide it behind Promise.all, and do not expose the exchange response body.
    let balances;
    try {
      balances = await backpackGet(...routes.balances, cleanKey, cleanSecret);
    } catch (error) {
      const status = error?.status === 400 ? 400 : 401;
      return res.status(status).json({
        ok: false,
        error: 'Backpack rejected the read-only request. Check that the API key matches the secret and that the key is enabled for Read Only.',
        code: error?.code === 'HTTP_400' ? 'BACKPACK_BAD_REQUEST' : 'BACKPACK_AUTH_FAILED'
      });
    }

    const optionalEntries = Object.entries(routes).filter(([name]) => name !== 'balances');
    const optionalResults = await Promise.all(optionalEntries.map(async ([name, [path, instruction]]) => {
      try {
        return { name, value: await backpackGet(path, instruction, cleanKey, cleanSecret) };
      } catch (error) {
        // A missing capability or empty product must not block the rest of the
        // account snapshot. Return only a non-sensitive diagnostic.
        return { name, value: null, warning: { name, status: error?.status || 500, code: error?.code || 'READ_FAILED' } };
      }
    }));

    const data = { balances };
    const warnings = [];
    optionalResults.forEach(({ name, value, warning }) => {
      data[name] = value;
      if (warning) warnings.push(warning);
    });
    return res.status(200).json({ ok: true, data, warnings });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'The account snapshot could not be completed. Try again in a moment.', code: 'SNAPSHOT_FAILED' });
  }
};
