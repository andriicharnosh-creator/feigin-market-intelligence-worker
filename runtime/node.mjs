import http from 'node:http';
import worker from '../worker.js';

const required = ['ANTHROPIC_KEY', 'MI_TRIGGER_TOKEN', 'MISSION_CONTROL_API_KEY'];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/healthz' || url.pathname === '/readyz') {
    const missing = required.filter(key => !process.env[key]?.trim());
    res.writeHead(url.pathname === '/readyz' && missing.length ? 503 : 200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ service: 'feigin-market-intelligence-worker', runtime: 'AWS_NODE', stage: process.env.FEIGIN_RUNTIME_STAGE || 'SHADOW', ready: !missing.length, missing }));
  }
  if (!['GET', 'POST'].includes(req.method)) {
    res.writeHead(405); return res.end('Method not allowed');
  }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 262144) { res.writeHead(413); return res.end('Request too large'); }
      chunks.push(chunk);
    }
    const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
    const response = await worker.fetch(request, process.env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end('Worker request failed');
  }
});
server.requestTimeout = 30_000;
server.listen(Number(process.env.PORT || 18171), '127.0.0.1');
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
