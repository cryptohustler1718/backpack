# Backpack Capital Composer

A static JavaScript scenario planner for exploring how one pool of capital could be composed across Backpack products.

## Run locally

```bash
npm run dev
```

Open `http://localhost:4173`.

## Deploy to Vercel

Import this directory as a project. No build command is required; the project is static. If a build command is preferred, use `npm run build` and set the output directory to `dist`.

The live connection uses `api/backpack.js` as a Vercel serverless function. The browser sends a read-only API key and secret over HTTPS for a single snapshot; the function does not persist them. Keep the Backpack key set to **Read Only** with trading and withdrawal permissions disabled. Local `file://` preview supports demo mode; the live endpoint requires running through Vercel (or another HTTPS Node host).

### Security boundary

- Credentials are not written to local storage, cookies, a database, or plan-share URLs.
- The frontend clears both fields after every request and when the connection dialog closes.
- The API response is marked `no-store`; the function does not log or persist credentials.
- This does not make a secret mathematically impossible to compromise: the serverless provider processes the request briefly. For a zero-secret architecture, use a Backpack-supported OAuth/session authorization flow if one becomes available.
- Users should create a dedicated read-only key and revoke it in Backpack Exchange after use. Our site cannot revoke or expire a Backpack key on the exchange’s behalf.

## Important product note

The current calculator uses clearly labeled illustrative assumptions for stress and lending estimates. It does not place trades, connect a wallet, or promise returns. The next production integration should read public Backpack market/rate data through a server-side proxy, then preserve the same conservative presentation and disclaimers.
