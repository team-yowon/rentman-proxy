const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3131;
const RENTMAN_BASE = 'api.rentman.net';
const RENTMAN_TOKEN = process.env.RENTMAN_TOKEN || '';

// Helper: call Rentman API
function rentmanRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: RENTMAN_BASE,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${RENTMAN_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ raw: data }); }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// MCP Tools definition
const TOOLS = [ /* ... igual que antes ... */ ];

// Execute tool
async function executeTool(name, args) { /* ... igual que antes ... */ }

// Sessions store
const sessions = {};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ✅ SSE endpoint — el handshake correcto
  if (req.method === 'GET' && url.pathname === '/sse') {
    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // importante para Railway/nginx
    });

    // ✅ PRIMER EVENTO: decirle a Claude dónde enviar los mensajes
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

    // Guardar la sesión con su res para poder enviarle eventos
    sessions[sessionId] = res;

    // Heartbeat para mantener la conexión viva en Railway
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      delete sessions[sessionId];
    });

    return;
  }

  // ✅ Endpoint de mensajes MCP
  if (req.method === 'POST' && url.pathname === '/messages') {
    const sessionId = url.searchParams.get('sessionId');
    const sseRes = sessions[sessionId];

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);
        let result;

        if (msg.method === 'initialize') {
          result = {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'rentman-mcp', version: '1.0.0' },
            capabilities: { tools: {} },
          };
        } else if (msg.method === 'notifications/initialized') {
          // notificación sin respuesta
          res.writeHead(202);
          res.end();
          return;
        } else if (msg.method === 'tools/list') {
          result = { tools: TOOLS };
        } else if (msg.method === 'tools/call') {
          const toolResult = await executeTool(msg.params.name, msg.params.arguments || {});
          result = {
            content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
          };
        } else {
          // Responder con error JSON-RPC
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: msg.id,
            error: { code: -32601, message: 'Method not found' },
          }));
          return;
        }

        const response = { jsonrpc: '2.0', id: msg.id, result };

        // ✅ Enviar la respuesta por SSE al cliente
        if (sseRes) {
          sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        }

        // Confirmar recepción con 202
        res.writeHead(202);
        res.end();

      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Health check
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'rentman-mcp', tools: TOOLS.length }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Rentman MCP server corriendo en puerto ${PORT}`);
  console.log(`   Tools disponibles: ${TOOLS.map(t => t.name).join(', ')}`);
});
