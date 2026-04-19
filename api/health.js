// Vercel serverless function: /api/health
//
// Lightweight health check that verifies upstream Climatiq + Gemini keys
// are set and reachable, without any disk/DB state.

const CLIMATIQ_API_KEY = process.env.CLIMATIQ_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DEDALUS_API_KEY = process.env.DEDALUS_API_KEY || '';
const STARTED_AT = Date.now();

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const ctrl = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c; };

  const probes = await Promise.allSettled([
    CLIMATIQ_API_KEY
      ? fetch('https://api.climatiq.io/data/v1/data-versions', {
          headers: { authorization: `Bearer ${CLIMATIQ_API_KEY}` },
          signal: ctrl(2000).signal
        }).then((r) => (r.ok ? 'ok' : `http_${r.status}`))
      : Promise.resolve('unconfigured'),
    GEMINI_API_KEY
      ? fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}&pageSize=1`,
          { signal: ctrl(2000).signal }
        ).then((r) => (r.ok ? 'ok' : `http_${r.status}`))
      : Promise.resolve('unconfigured')
  ]);

  res.status(200).json({
    status: 'ok',
    runtime: 'vercel_serverless',
    uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000),
    now: new Date().toISOString(),
    gemini_key: GEMINI_API_KEY ? 'set' : 'missing',
    dedalus_key: DEDALUS_API_KEY ? 'set' : 'missing',
    climatiq_key: CLIMATIQ_API_KEY ? 'set' : 'missing',
    upstream: {
      climatiq: probes[0].status === 'fulfilled' ? probes[0].value : 'down',
      gemini: probes[1].status === 'fulfilled' ? probes[1].value : 'down'
    }
  });
}
