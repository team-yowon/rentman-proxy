const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8080;
const RENTMAN_BASE = 'api.rentman.net';
const RENTMAN_TOKEN = process.env.RENTMAN_TOKEN || '';

// ─── HTTP helper (sin cambios respecto al original) ───────────────────────────

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

// ─── Nuevo helper: construye query string con filtros ─────────────────────────

function buildQuery(params = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', params.limit);
  if (params.offset != null) q.set('offset', params.offset);
  if (params.sort) q.set('sort', params.sort);
  if (params.filters) {
    for (const [field, ops] of Object.entries(params.filters)) {
      if (ops == null) continue;
      if (typeof ops === 'object') {
        for (const [op, val] of Object.entries(ops)) {
          if (val != null && val !== '') q.set(`filter[${field}][${op}]`, val);
        }
      } else {
        q.set(`filter[${field}][eq]`, ops);
      }
    }
  }
  const str = q.toString();
  return str ? '?' + str : '';
}

// ─── Definición de herramientas ───────────────────────────────────────────────

const TOOLS = [

  // ── Proyectos ──────────────────────────────────────────────────────────────

  {
    name: 'get_projects',
    description: 'Obtener lista de proyectos de Rentman. Soporta filtros por fecha, estado y nombre.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50, max 1500)' },
        offset:      { type: 'number', description: 'Desplazamiento para paginacion' },
        sort:        { type: 'string', description: 'Campo de orden. Prefijo - para DESC. Ej: -planperiod_start' },
        fecha_desde: { type: 'string', description: 'Fecha inicio minima ISO 8601, ej: 2026-04-01T00:00:00' },
        fecha_hasta: { type: 'string', description: 'Fecha inicio maxima ISO 8601, ej: 2026-04-30T23:59:59' },
        estado:      { type: 'string', description: 'Estado: option | confirmed | pencil | cancelled | inquiry | not_confirmed' },
        nombre:      { type: 'string', description: 'Filtrar por nombre (busqueda parcial)' },
        responsable: { type: 'string', description: 'Path del responsable, ej: /crew/5' },
      },
    },
  },
  {
    name: 'get_project',
    description: 'Obtener detalle de un proyecto por ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'ID del proyecto' } },
      required: ['id'],
    },
  },
  {
    name: 'get_confirmed_projects_this_month',
    description: 'Atajo: devuelve proyectos confirmados del mes y anio indicados.',
    inputSchema: {
      type: 'object',
      properties: {
        anio:  { type: 'number', description: 'Anio, ej: 2026' },
        mes:   { type: 'number', description: 'Mes 1-12, ej: 4 para abril' },
        limit: { type: 'number', description: 'Maximo de resultados (default 200)' },
      },
    },
  },

  // ── Contactos ──────────────────────────────────────────────────────────────

  {
    name: 'get_contacts',
    description: 'Obtener contactos y clientes. Soporta filtro por nombre y ciudad.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number', description: 'Maximo de resultados (default 50)' },
        offset: { type: 'number', description: 'Desplazamiento para paginacion' },
        nombre: { type: 'string', description: 'Filtrar por nombre o empresa (parcial)' },
        ciudad: { type: 'string', description: 'Filtrar por ciudad' },
      },
    },
  },
  {
    name: 'get_contact',
    description: 'Obtener detalle de un contacto por ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'ID del contacto' } },
      required: ['id'],
    },
  },

  // ── Personal ───────────────────────────────────────────────────────────────

  {
    name: 'get_crew',
    description: 'Obtener lista de personal. Soporta filtro por nombre.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number', description: 'Maximo de resultados (default 50)' },
        offset: { type: 'number', description: 'Desplazamiento para paginacion' },
        nombre: { type: 'string', description: 'Filtrar por nombre' },
      },
    },
  },
  {
    name: 'get_crew_planning',
    description: 'Obtener planificacion de personal. Soporta filtro por proyecto y fechas.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50)' },
        offset:      { type: 'number', description: 'Desplazamiento para paginacion' },
        fecha_desde: { type: 'string', description: 'Fecha minima ISO 8601' },
        fecha_hasta: { type: 'string', description: 'Fecha maxima ISO 8601' },
        proyecto_id: { type: 'number', description: 'Filtrar por ID de proyecto' },
        crew_id:     { type: 'number', description: 'Filtrar por ID de miembro' },
      },
    },
  },
  {
    name: 'get_project_crew',
    description: 'Listar asignaciones de personal a proyectos.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50)' },
        offset:      { type: 'number', description: 'Desplazamiento para paginacion' },
        proyecto_id: { type: 'number', description: 'Filtrar por ID de proyecto' },
      },
    },
  },

  // ── Equipos ────────────────────────────────────────────────────────────────

  {
    name: 'get_equipment',
    description: 'Obtener inventario de equipos. Soporta filtro por nombre y codigo.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number', description: 'Maximo de resultados (default 50)' },
        offset: { type: 'number', description: 'Desplazamiento para paginacion' },
        nombre: { type: 'string', description: 'Filtrar por nombre del equipo' },
        codigo: { type: 'string', description: 'Filtrar por codigo/referencia' },
      },
    },
  },
  {
    name: 'get_equipment_item',
    description: 'Obtener detalle de un equipo por ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'ID del equipo' } },
      required: ['id'],
    },
  },
  {
    name: 'get_equipment_shortages',
    description: 'Obtener escaseces de equipos. Soporta filtro por fechas.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50)' },
        fecha_desde: { type: 'string', description: 'Fecha minima ISO 8601' },
        fecha_hasta: { type: 'string', description: 'Fecha maxima ISO 8601' },
        equipo_id:   { type: 'number', description: 'Filtrar por ID de equipo' },
      },
    },
  },
  {
    name: 'get_project_equipment',
    description: 'Listar equipos asignados a un proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50)' },
        offset:      { type: 'number', description: 'Desplazamiento para paginacion' },
        proyecto_id: { type: 'number', description: 'Filtrar por ID de proyecto' },
        equipo_id:   { type: 'number', description: 'Filtrar por ID de equipo' },
      },
    },
  },
  {
    name: 'get_equipment_sets',
    description: 'Listar sets/grupos de equipos.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number', description: 'Maximo de resultados (default 50)' },
        nombre: { type: 'string', description: 'Filtrar por nombre del set' },
      },
    },
  },

  // ── Facturas ───────────────────────────────────────────────────────────────

  {
    name: 'get_invoices',
    description: 'Obtener facturas de Rentman. Soporta filtros por estado, fecha y proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50)' },
        offset:      { type: 'number', description: 'Desplazamiento para paginacion' },
        fecha_desde: { type: 'string', description: 'Fecha minima ISO 8601' },
        fecha_hasta: { type: 'string', description: 'Fecha maxima ISO 8601' },
        estado:      { type: 'string', description: 'Estado: draft | sent | paid | overdue | cancelled' },
        proyecto_id: { type: 'number', description: 'Filtrar por ID de proyecto' },
      },
    },
  },
  {
    name: 'get_invoice',
    description: 'Obtener detalle de una factura por ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'ID de la factura' } },
      required: ['id'],
    },
  },
  {
    name: 'get_invoice_lines',
    description: 'Obtener lineas de factura detalladas. Soporta filtro por factura y proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50)' },
        factura_id:  { type: 'number', description: 'Filtrar por ID de factura' },
        proyecto_id: { type: 'number', description: 'Filtrar por ID de proyecto' },
      },
    },
  },
  {
    name: 'get_quotes',
    description: 'Listar cotizaciones/presupuestos.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50)' },
        fecha_desde: { type: 'string', description: 'Fecha minima ISO 8601' },
        fecha_hasta: { type: 'string', description: 'Fecha maxima ISO 8601' },
        proyecto_id: { type: 'number', description: 'Filtrar por ID de proyecto' },
      },
    },
  },
  {
    name: 'get_quote_lines',
    description: 'Obtener lineas de cotizacion.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:         { type: 'number', description: 'Maximo de resultados (default 50)' },
        cotizacion_id: { type: 'number', description: 'Filtrar por ID de cotizacion' },
        proyecto_id:   { type: 'number', description: 'Filtrar por ID de proyecto' },
      },
    },
  },

  // ── Operaciones ────────────────────────────────────────────────────────────

  {
    name: 'get_time_registrations',
    description: 'Obtener registros de tiempo trabajado. Soporta filtro por proyecto y fechas.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50)' },
        offset:      { type: 'number', description: 'Desplazamiento para paginacion' },
        fecha_desde: { type: 'string', description: 'Fecha minima ISO 8601' },
        fecha_hasta: { type: 'string', description: 'Fecha maxima ISO 8601' },
        proyecto_id: { type: 'number', description: 'Filtrar por ID de proyecto' },
        crew_id:     { type: 'number', description: 'Filtrar por ID de miembro del personal' },
      },
    },
  },
  {
    name: 'get_subrentals',
    description: 'Listar subarriendos de equipos a proveedores externos.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:        { type: 'number', description: 'Maximo de resultados (default 50)' },
        fecha_desde:  { type: 'string', description: 'Fecha minima ISO 8601' },
        fecha_hasta:  { type: 'string', description: 'Fecha maxima ISO 8601' },
        proyecto_id:  { type: 'number', description: 'Filtrar por ID de proyecto' },
        proveedor_id: { type: 'number', description: 'Filtrar por ID de proveedor' },
      },
    },
  },
  {
    name: 'get_tasks',
    description: 'Listar tareas con filtros por proyecto, responsable y estado.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number',  description: 'Maximo de resultados (default 50)' },
        fecha_desde: { type: 'string',  description: 'Fecha de vencimiento minima ISO 8601' },
        fecha_hasta: { type: 'string',  description: 'Fecha de vencimiento maxima ISO 8601' },
        proyecto_id: { type: 'number',  description: 'Filtrar por ID de proyecto' },
        asignado_a:  { type: 'number',  description: 'Filtrar por ID de miembro del personal' },
        completada:  { type: 'boolean', description: 'true = completadas, false = pendientes' },
      },
    },
  },
  {
    name: 'get_vehicles',
    description: 'Listar vehiculos disponibles.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number', description: 'Maximo de resultados (default 50)' },
        nombre: { type: 'string', description: 'Filtrar por nombre o patente' },
      },
    },
  },
  {
    name: 'get_vehicle_planning',
    description: 'Obtener planificacion/reservas de vehiculos.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Maximo de resultados (default 50)' },
        fecha_desde: { type: 'string', description: 'Fecha minima ISO 8601' },
        fecha_hasta: { type: 'string', description: 'Fecha maxima ISO 8601' },
        vehiculo_id: { type: 'number', description: 'Filtrar por ID de vehiculo' },
        proyecto_id: { type: 'number', description: 'Filtrar por ID de proyecto' },
      },
    },
  },

  // ── Catalogos ──────────────────────────────────────────────────────────────

  {
    name: 'get_project_types',
    description: 'Listar tipos de proyecto disponibles.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } },
    },
  },
  {
    name: 'get_folders',
    description: 'Listar carpetas de organizacion de equipos.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Maximo de resultados (default 50)' } },
    },
  },
];

// ─── Ejecución de herramientas ────────────────────────────────────────────────

async function executeTool(name, args) {
  const limit = args.limit || 50;
  const offset = args.offset || null;

  try {
    switch (name) {

      case 'get_projects':
        return await rentmanRequest('/projects' + buildQuery({
          limit, offset,
          sort: args.sort || '-planperiod_start',
          filters: {
            planperiod_start: {
              ...(args.fecha_desde ? { gte: args.fecha_desde } : {}),
              ...(args.fecha_hasta ? { lte: args.fecha_hasta } : {}),
            },
            ...(args.estado      ? { status:          { eq: args.estado } }                : {}),
            ...(args.nombre      ? { name:             { like: `%${args.nombre}%` } }       : {}),
            ...(args.responsable ? { account_manager:  { eq: args.responsable } }           : {}),
          },
        }));

      case 'get_project':
        return await rentmanRequest(`/projects/${args.id}`);

      case 'get_confirmed_projects_this_month': {
        const anio = args.anio || new Date().getFullYear();
        const mes  = args.mes  || (new Date().getMonth() + 1);
        const pad  = (n) => String(n).padStart(2, '0');
        const days = new Date(anio, mes, 0).getDate();
        return await rentmanRequest('/projects' + buildQuery({
          limit: args.limit || 200,
          sort: 'planperiod_start',
          filters: {
            planperiod_start: {
              gte: `${anio}-${pad(mes)}-01T00:00:00`,
              lte: `${anio}-${pad(mes)}-${days}T23:59:59`,
            },
            status: { eq: 'confirmed' },
          },
        }));
      }

      case 'get_contacts':
        return await rentmanRequest('/contacts' + buildQuery({
          limit, offset,
          filters: {
            ...(args.nombre ? { displayname: { like: `%${args.nombre}%` } } : {}),
            ...(args.ciudad ? { city:        { like: `%${args.ciudad}%` } } : {}),
          },
        }));

      case 'get_contact':
        return await rentmanRequest(`/contacts/${args.id}`);

      case 'get_crew':
        return await rentmanRequest('/crewmembers' + buildQuery({   // ruta original preservada
          limit, offset,
          filters: {
            ...(args.nombre ? { displayname: { like: `%${args.nombre}%` } } : {}),
          },
        }));

      case 'get_crew_planning':
        return await rentmanRequest('/crewplanning' + buildQuery({
          limit, offset,
          filters: {
            ...(args.fecha_desde ? { start:   { gte: args.fecha_desde } }                    : {}),
            ...(args.fecha_hasta ? { end:     { lte: args.fecha_hasta } }                    : {}),
            ...(args.proyecto_id ? { project: { eq: `/projects/${args.proyecto_id}` } }      : {}),
            ...(args.crew_id     ? { crew:    { eq: `/crewmembers/${args.crew_id}` } }        : {}),
          },
        }));

      case 'get_project_crew':
        return await rentmanRequest('/projectcrew' + buildQuery({   // ruta original preservada
          limit, offset,
          filters: {
            ...(args.proyecto_id ? { project: { eq: `/projects/${args.proyecto_id}` } } : {}),
          },
        }));

      case 'get_equipment':
        return await rentmanRequest('/equipment' + buildQuery({
          limit, offset,
          filters: {
            ...(args.nombre ? { name: { like: `%${args.nombre}%` } } : {}),
            ...(args.codigo ? { code: { like: `%${args.codigo}%` } } : {}),
          },
        }));

      case 'get_equipment_item':
        return await rentmanRequest(`/equipment/${args.id}`);

      case 'get_equipment_shortages':
        return await rentmanRequest('/equipment/shortages' + buildQuery({   // ruta original preservada
          limit,
          filters: {
            ...(args.fecha_desde ? { start:     { gte: args.fecha_desde } }               : {}),
            ...(args.fecha_hasta ? { end:       { lte: args.fecha_hasta } }               : {}),
            ...(args.equipo_id   ? { equipment: { eq: `/equipment/${args.equipo_id}` } }  : {}),
          },
        }));

      case 'get_project_equipment':
        return await rentmanRequest('/projectequipment' + buildQuery({
          limit, offset,
          filters: {
            ...(args.proyecto_id ? { project:   { eq: `/projects/${args.proyecto_id}` } }  : {}),
            ...(args.equipo_id   ? { equipment: { eq: `/equipment/${args.equipo_id}` } }    : {}),
          },
        }));

      case 'get_equipment_sets':
        return await rentmanRequest('/equipmentsets' + buildQuery({
          limit,
          filters: {
            ...(args.nombre ? { name: { like: `%${args.nombre}%` } } : {}),
          },
        }));

      case 'get_invoices':
        return await rentmanRequest('/invoices' + buildQuery({
          limit, offset,
          sort: args.sort || '-date',
          filters: {
            ...(args.fecha_desde ? { date:    { gte: args.fecha_desde } }                : {}),
            ...(args.fecha_hasta ? { date:    { lte: args.fecha_hasta } }                : {}),
            ...(args.estado      ? { status:  { eq: args.estado } }                      : {}),
            ...(args.proyecto_id ? { project: { eq: `/projects/${args.proyecto_id}` } }  : {}),
          },
        }));

      case 'get_invoice':
        return await rentmanRequest(`/invoices/${args.id}`);

      case 'get_invoice_lines':
        return await rentmanRequest('/invoicelines' + buildQuery({
          limit,
          filters: {
            ...(args.factura_id  ? { invoice: { eq: `/invoices/${args.factura_id}` } }    : {}),
            ...(args.proyecto_id ? { project: { eq: `/projects/${args.proyecto_id}` } }   : {}),
          },
        }));

      case 'get_quotes':
        return await rentmanRequest('/quotes' + buildQuery({
          limit,
          filters: {
            ...(args.fecha_desde ? { date:    { gte: args.fecha_desde } }                : {}),
            ...(args.fecha_hasta ? { date:    { lte: args.fecha_hasta } }                : {}),
            ...(args.proyecto_id ? { project: { eq: `/projects/${args.proyecto_id}` } }  : {}),
          },
        }));

      case 'get_quote_lines':
        return await rentmanRequest('/quotationlines' + buildQuery({
          limit,
          filters: {
            ...(args.cotizacion_id ? { quote:   { eq: `/quotes/${args.cotizacion_id}` } }  : {}),
            ...(args.proyecto_id   ? { project: { eq: `/projects/${args.proyecto_id}` } }  : {}),
          },
        }));

      case 'get_time_registrations':
        return await rentmanRequest('/time' + buildQuery({   // ruta original preservada
          limit, offset,
          filters: {
            ...(args.fecha_desde ? { start:   { gte: args.fecha_desde } }                : {}),
            ...(args.fecha_hasta ? { end:     { lte: args.fecha_hasta } }                : {}),
            ...(args.proyecto_id ? { project: { eq: `/projects/${args.proyecto_id}` } }  : {}),
            ...(args.crew_id     ? { crew:    { eq: `/crewmembers/${args.crew_id}` } }   : {}),
          },
        }));

      case 'get_subrentals':
        return await rentmanRequest('/subrentals' + buildQuery({
          limit,
          filters: {
            ...(args.fecha_desde   ? { planperiod_start: { gte: args.fecha_desde } }             : {}),
            ...(args.fecha_hasta   ? { planperiod_start: { lte: args.fecha_hasta } }             : {}),
            ...(args.proyecto_id   ? { project:          { eq: `/projects/${args.proyecto_id}` } } : {}),
            ...(args.proveedor_id  ? { contact:          { eq: `/contacts/${args.proveedor_id}` } } : {}),
          },
        }));

      case 'get_tasks':
        return await rentmanRequest('/tasks' + buildQuery({
          limit,
          filters: {
            ...(args.fecha_desde ? { due_date: { gte: args.fecha_desde } }               : {}),
            ...(args.fecha_hasta ? { due_date: { lte: args.fecha_hasta } }               : {}),
            ...(args.proyecto_id ? { project:  { eq: `/projects/${args.proyecto_id}` } } : {}),
            ...(args.asignado_a  ? { assignee: { eq: `/crewmembers/${args.asignado_a}` } } : {}),
            ...(args.completada != null ? { is_done: { eq: args.completada ? 1 : 0 } }  : {}),
          },
        }));

      case 'get_vehicles':
        return await rentmanRequest('/vehicles' + buildQuery({
          limit,
          filters: {
            ...(args.nombre ? { name: { like: `%${args.nombre}%` } } : {}),
          },
        }));

      case 'get_vehicle_planning':
        return await rentmanRequest('/vehicleplanning' + buildQuery({
          limit,
          filters: {
            ...(args.fecha_desde ? { start:   { gte: args.fecha_desde } }                : {}),
            ...(args.fecha_hasta ? { end:     { lte: args.fecha_hasta } }                : {}),
            ...(args.vehiculo_id ? { vehicle: { eq: `/vehicles/${args.vehiculo_id}` } }  : {}),
            ...(args.proyecto_id ? { project: { eq: `/projects/${args.proyecto_id}` } }  : {}),
          },
        }));

      case 'get_project_types':
        return await rentmanRequest(`/projecttypes?limit=${limit}`);

      case 'get_folders':
        return await rentmanRequest(`/folders?limit=${limit}`);

      default:
        return { error: `Tool ${name} not found` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Servidor HTTP (misma lógica SSE que el original, sin cambios) ────────────

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
            serverInfo: { name: 'rentman-mcp', version: '2.0.0' },
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

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'rentman-mcp', version: '2.0.0', tools: TOOLS.length }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Rentman MCP server v2.0 corriendo en puerto ${PORT}`);
  console.log(`   Tools disponibles (${TOOLS.length}): ${TOOLS.map(t => t.name).join(', ')}`);
});
