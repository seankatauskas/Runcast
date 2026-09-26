import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.RUNCAST_OPEN_METEO_PROXY_PORT ?? 8098);
const upstreamBase = 'https://api.open-meteo.com/v1/forecast';

const server = http.createServer(async (request, response) => {
  const incoming = new URL(request.url ?? '/', `http://${host}`);
  if (request.method !== 'GET' || incoming.pathname !== '/v1/forecast') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: true, reason: 'Not found' }));
    return;
  }

  try {
    const upstream = new URL(upstreamBase);
    upstream.search = incoming.search;
    const result = await fetch(upstream, { headers: { accept: 'application/json' } });
    const body = Buffer.from(await result.arrayBuffer());
    response.writeHead(result.status, {
      'content-type': result.headers.get('content-type') ?? 'application/json',
      'cache-control': result.headers.get('cache-control') ?? 'no-store',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: true,
        reason: error instanceof Error ? error.message : 'Provider bridge failed',
      }),
    );
  }
});

server.listen(port, host, () => {
  console.log(`Open-Meteo development bridge listening on http://${host}:${port}`);
});
