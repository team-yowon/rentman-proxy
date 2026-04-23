const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8080;
const RENTMAN_BASE = 'api.rentman.net';
const RENTMAN_TOKEN = process.env.RENTMAN_TOKEN || '';

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

const TOOLS = [
  {
    name: 'get_projects',
    description: 'Obtener lista de proyectos de Rentman.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } } },
  },
  {
    name: 'get_project',
    description: 'Obtener detalle de un proyecto por ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'ID del proyecto' } }, required: ['id'] },
  },
  {
    name: 'get_invoices',
    description: 'Obtener facturas de Rentman.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } } },
  },
  {
    name: 'get_invoice_lines',
    description: 'Obtener lineas de factura detalladas.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } } },
  },
  {
    name: 'get_equipment',
    description: 'Obtener inventario de equipos.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } } },
  },
  {
    name: 'get_equipment_shortages',
    description: 'Obtener escaseces de equipos.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } } },
  },
  {
    name: 'get_crew',
    description: 'Obtener lista de personal.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } } },
  },
  {
    name: 'get_crew_planning',
    description: 'Obtener planificacion de personal.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } } },
  },
  {
    name: 'get_time_registrations',
    description: 'Obtener registros de tiempo trabajado.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } } },
  },
  {
    name: 'get_contacts',
    description: 'Obtener contactos y clientes.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } } },
  },
];

async function executeTool(name, args) {
  const limit = args.limit || 50;
  try {
    switch (name) {
      case 'get_projects':            return await rentmanRequest(`/projects?limit=${limit}`);
      case 'get_project':             return await rentmanRequest(`/projects/${args.id}`);
      case 'get_invoices':            return await rentmanRequest(`/invoices?limit=${limit}`);
      case 'get_invoice_lines':       return await rentmanRequest(`/invoicelines?limit=${limit}`);
      case 'get_equipment':           return await rentmanRequest(`/equipment?limit=${limit}`);
      case 'get_equipment_shortages': return await rentmanRequest(`/equipment/shortages?limit=${limit}`);
      case 'get_crew':                return await rentmanRequest(`/crewmembers?limit=${limit}`);
      case 'get_crew_planning':       return await rentmanRequest(`/projectcrew?limit=${limit}`);
      case 'get_time_registrations':  return await rentmanRequest(`/time?limit=${limit}`);
      case 'get_contacts':            return await rentmanRequest(`/contacts?limit=${limit}`);
      default: return { error: `Tool ${name} not found` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

const sessions = {};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── SSE ──────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/sse') {
    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    console.log(`[SSE] Nueva conexion. SessionId: ${sessionId}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
    console.log(`[SSE] Endpoint event enviado: /messages?sessionId=${sessionId}`);

    sessions[sessionId] = res;

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25000);

    req.on('close', () => {
      console.log(`[SSE] Conexion cerrada. SessionId: ${sessionId}`);
      clearInterval(heartbeat);
      delete sessions[sessionId];
    });

    return;
  }

  // ── Messages ─────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/messages') {
    const sessionId = url.searchParams.get('sessionId');
    const sseRes = sessions[sessionId];
    console.log(`[MSG] POST /messages | sessionId: ${sessionId} | sseActivo: ${!!sseRes}`);

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);
        console.log(`[MSG] Metodo: ${msg.method} | id: ${msg.id}`);

        if (msg.id === undefined || msg.id === null) {
          console.log(`[MSG] Notificacion sin id: ${msg.method}`);
          res.writeHead(202);
          res.end();
          return;
        }

        let result;

        if (msg.method === 'initialize') {
          result = {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'rentman-mcp', version: '1.0.0' },
            capabilities: { tools: {} },
          };
          console.log(`[MSG] Initialize OK`);

        } else if (msg.method === 'tools/list') {
          result = { tools: TOOLS };
          console.log(`[MSG] tools/list: enviando ${TOOLS.length} tools`);

        } else if (msg.method === 'tools/call') {
          console.log(`[MSG] tools/call: ${msg.params.name}`);
          const toolResult = await executeTool(msg.params.name, msg.params.arguments || {});
          result = {
            content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
          };

        } else {
          const errorResp = { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
          console.log(`[MSG] Metodo desconocido: ${msg.method}`);
          if (sseRes) sseRes.write(`event: message\ndata: ${JSON.stringify(errorResp)}\n\n`);
          res.writeHead(202);
          res.end();
          return;
        }

        const response = { jsonrpc: '2.0', id: msg.id, result };

        if (sseRes) {
          sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
          console.log(`[MSG] Respuesta enviada por SSE`);
        } else {
          console.log(`[MSG] WARNING: sseRes no encontrado para sessionId: ${sessionId}`);
          // Si no hay SSE activo, respondemos directamente por HTTP como fallback
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
          return;
        }

        res.writeHead(202);
        res.end();

      } catch (e) {
        console.log(`[MSG] Error parseando mensaje: ${e.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Health check ──────────────────────────────────────────────
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'rentman-mcp', version: 'v3-debug', tools: TOOLS.length }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Rentman MCP server corriendo en puerto ${PORT}`);
  console.log(`   Tools disponibles: ${TOOLS.map(t => t.name).join(', ')}`);
});
