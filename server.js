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
    description: 'Obtener facturas. Permite filtrar por estado, fecha, cliente. Útil para informes de ventas y contabilidad.',
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
    description: 'Obtener escaseces de equipos — items que tienen demanda mayor a la disponibilidad.',
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
      case 'get_projects': {
        const data = await rentmanRequest(`/projects?limit=${limit}`);
        return data;
      }
      case 'get_project': {
        const data = await rentmanRequest(`/projects/${args.id}`);
        return data;
      }
      case 'get_invoices': {
        const data = await rentmanRequest(`/invoices?limit=${limit}`);
        return data;
      }
      case 'get_invoice_lines': {
        const data = await rentmanRequest(`/invoicelines?limit=${limit}`);
        return data;
      }
      case 'get_equipment': {
        const data = await rentmanRequest(`/equipment?limit=${limit}`);
        return data;
      }
      case 'get_equipment_shortages': {
        const data = await rentmanRequest(`/equipment/shortages?limit=${limit}`);
        return data;
      }
      case 'get_crew': {
        const data = await rentmanRequest(`/crewmembers?limit=${limit}`);
        return data;
      }
      case 'get_crew_planning': {
        const data = await rentmanRequest(`/projectcrew?limit=${limit}`);
        return data;
      }
      case 'get_time_registrations': {
        const data = await rentmanRequest(`/time?limit=${limit}`);
        return data;
      }
      case 'get_contacts': {
        const data = await rentmanRequest(`/contacts?limit=${limit}`);
        return data;
      }
      default:
        return { error: `Tool ${name} not found` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// MCP over HTTP (SSE transport)
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

  // SSE endpoint for MCP
  if (req.method === 'GET' && url.pathname === '/sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send server info
    const serverInfo = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {
        serverInfo: { name: 'rentman-mcp', version: '1.0.0' },
        capabilities: { tools: {} },
      },
    };
    res.write(`data: ${JSON.stringify(serverInfo)}\n\n`);

    req.on('close', () => res.end());
    return;
  }

  // Main MCP POST endpoint
  if (req.method === 'POST' && url.pathname === '/mcp') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);
        let response;

        if (msg.method === 'initialize') {
          response = {
            jsonrpc: '2.0', id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'rentman-mcp', version: '1.0.0' },
              capabilities: { tools: {} },
            },
          };
        } else if (msg.method === 'tools/list') {
          response = {
            jsonrpc: '2.0', id: msg.id,
            result: { tools: TOOLS },
          };
        } else if (msg.method === 'tools/call') {
          const result = await executeTool(msg.params.name, msg.params.arguments || {});
          response = {
            jsonrpc: '2.0', id: msg.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            },
          };
        } else {
          response = {
            jsonrpc: '2.0', id: msg.id,
            error: { code: -32601, message: 'Method not found' },
          };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
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
