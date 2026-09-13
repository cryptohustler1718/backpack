const crypto = require('node:crypto');

const BASE = 'https://api.backpack.exchange';
const routes = {
  balances: ['/api/v1/capital', 'balanceQuery'],
  positions: ['/api/v1/position', 'positionQuery'],
  collateral: ['/api/v1/collateral', 'collateralQuery'],
  borrowLend: ['/api/v1/borrowLend/positions', 'borrowLendPositionQuery']
};

function privateKeyFromSeed(seed) {
  const raw = Buffer.from(seed, 'base64');
  if (raw.length !== 32) throw new Error('API secret must be a base64 ED25519 seed');
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return crypto.createPrivateKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'pkcs8' });
}

function signature(secret, instruction, search = '') {
  const timestamp = Date.now();
  const window = 5000;
  const message = `instruction=${instruction}${search ? `&${search}` : ''}&timestamp=${timestamp}&window=${window}`;
  const signed = crypto.sign(null, Buffer.from(message), privateKeyFromSeed(secret));
  return { timestamp, window, signature: signed.toString('base64') };
}

async function backpackGet(path, instruction, apiKey, apiSecret) {
  const auth = signature(apiSecret, instruction);
  const response = await fetch(`${BASE}${path}`, { headers: { 'X-API-KEY': apiKey, 'X-SIGNATURE': auth.signature, 'X-TIMESTAMP': String(auth.timestamp), 'X-WINDOW': String(auth.window) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Backpack returned ${response.status}`);
  return body;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const { apiKey, apiSecret } = req.body || {};
    if (typeof apiKey !== 'string' || typeof apiSecret !== 'string' || !apiKey || !apiSecret) return res.status(400).json({ error: 'Read-only API key and secret are required' });
    const entries = await Promise.all(Object.entries(routes).map(async ([name, [path, instruction]]) => [name, await backpackGet(path, instruction, apiKey, apiSecret)]));
    const data = Object.fromEntries(entries);
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    return res.status(401).json({ error: 'Could not read Backpack account. Check the key, secret, and Read Only permission.' });
  }
};
