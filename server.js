const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3131;
const RENTMAN_BASE = 'api.rentman.net';

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Forward request to Rentman
  const options = {
    hostname: RENTMAN_BASE,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: RENTMAN_BASE,
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`✅ Rentman proxy corriendo en http://localhost:${PORT}`);
  console.log(`   Ejemplo: http://localhost:${PORT}/projects`);
});
