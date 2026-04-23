const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8080;
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
const TOOLS = [
  {
    name: 'get_projects',
    description: 'Obtener lista de proyectos de Rentman. Puede filtrar por estado, fecha o nombre.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de resultados (default 50)' },
        status: { type: 'string', description: 'Filtrar por estado del proyecto' },
      },
    },
  },
  {
    name: 'get_project',
    description: 'Obtener detalle completo de un proyecto específico por ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID del proyecto' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_invoices',
    description: 'Obtener facturas. Permite filtrar por estado, fecha, cliente.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de resultados (default 50)' },
        status: { type: 'string', description: 'Filtrar por estado: open, paid, cancelled' },
      },
    },
  },
  {
    name: 'get_invoice_lines',
    description: 'Obtener líneas de factura detalladas para análisis de ventas por producto/servicio.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de resultados (default 50)' },
      },
    },
  },
  {
    name: 'get_equipment',
    description: 'Obtener inventario de equipos y materiales disponibles en Rentman.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de resultados (default 50)' },
      },
    },
  },
  {
    name: 'get_equipment_shortages',
    description: 'Obtener escaseces de equipos — items con demanda mayor a la disponibilidad.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de resultados (default 50)' },
      },
    },
  },
  {
    name: 'get_crew',
    description: 'Obtener lista de personal (crew members) de Rentman.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de resultados (default 50)' },
      },
    },
  },
  {
    name: 'get_crew_planning',
    description: 'Obtener planificación y asignaciones de personal a proyectos.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de resultados (default 50)' },
      },
    },
  },
  {
    name: 'get_time_registrations',
    description: 'Obtener registros de tiempo trabajado por el personal.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de resultados (default 50)' },
      },
    },
  },
  {
    name: 'get_contacts',
    description: 'Obtener contactos y clientes de Rentman.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de resultados (default 50)' },
      },
    },
  },
];

// Execute tool
async function executeTool(name, args) {
  const limit = args.limit || 50;
  try {
    switch (name) {
      case 'get_projects':
        return await rentmanRequest(`/projects?limit=${limit}`);
      case 'get_project':
        return await rentmanRequest(`/projects/${args.id}`);
      case 'get_invoices':
        return await rentmanRequest(`/invoices?limit=${limit}`);
      case 'get_invoice_lines':
        return await rentmanRequest(`/invoicelines?limit=${limit}`);
      case 'get_equipment':
        return await rentmanRequest(`/equipment?limit=${limit}`);
      case 'get_equipment_shortages':
        return await rentmanRequest(`/equipment/shortages?limit=${limit}`);
      case 'get_crew':
        return await rentmanRequest(`/crewmembers?limit=${limit}`);
      case 'get_crew_planning':
        return await rentmanRequest(`/projectcrew?limit=${limit}`);
      case 'get_time_registrations':
        return await rentmanRequest(`/time?limit=${limit}`);
      case 'get_contacts':
        return await rentmanRequest(`/contacts?limit=${limit}`);
      default:
        return { error: `Tool ${name} not found` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// CORS headers helper
function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id');
}

// Sessions store
const sessions = {};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS preflight
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── SSE endpoint ──────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/sse') {
    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id',
    });

    // Primer evento: le dice a Claude dónde enviar los mensajes
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

    sessions[sessionId] = res;

    // Heartbeat cada 30s para mantener conexión viva en Railway
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      delete sessions[sessionId];
    });

    return;
  }

  // ── Messages endpoint ─────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/messages') {
    const sessionId = url.searchParams.get('sessionId');
    const sseRes = sessions[sessionId];

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);

        // Notificaciones sin respuesta
        if (!msg.id) {
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
        } else if (msg.method === 'tools/list') {
          result = { tools: TOOLS };
        } else if (msg.method === 'tools/call') {
          const toolResult = await executeTool(msg.params.name, msg.params.arguments || {});
          result = {
            content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
          };
        } else {
          const errorResponse = {
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32601, message: 'Method not found' },
          };
          if (sseRes) {
            sseRes.write(`event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`);
          }
          res.writeHead(202);
          res.end();
          return;
        }

        const response = { jsonrpc: '2.0', id: msg.id, result };

        // Enviar respuesta por el canal SSE
        if (sseRes) {
          sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        }

        res.writeHead(202);
        res.end();

      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Health check ──────────────────────────────────────────────
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'rentman-mcp', version: 'v2-sse', tools: TOOLS.length }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Rentman MCP server corriendo en puerto ${PORT}`);
  console.log(`   Tools disponibles: ${TOOLS.map(t => t.name).join(', ')}`);
});
