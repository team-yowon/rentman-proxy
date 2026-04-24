import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const RENTMAN_TOKEN = process.env.RENTMAN_TOKEN;
const BASE_URL = "https://api.rentman.net";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const headers = () => ({
  Authorization: `Bearer ${RENTMAN_TOKEN}`,
  "Content-Type": "application/json",
});

/**
 * Fetch a collection with automatic cursor-based pagination.
 * Follows next_page_url until null or maxPages is reached.
 */
async function fetchAll(endpoint, params = {}, maxPages = 10) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  if (!qs.has("limit")) qs.set("limit", "300");

  let url = `${BASE_URL}${endpoint}?${qs.toString()}`;
  let all = [];
  let page = 0;

  while (url && page < maxPages) {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Rentman ${res.status} @ ${endpoint}: ${err}`);
    }
    const json = await res.json();
    all = all.concat(json.data || []);
    url = json.next_page_url || null;
    page++;
  }
  return all;
}

/** Fetch a single item by full path (e.g. /projects/42) */
async function fetchOne(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`Rentman ${res.status} @ ${path}`);
  return (await res.json()).data;
}

/** Build common pagination/field params */
function baseParams(args) {
  const p = {};
  if (args.limit)     p.limit  = args.limit;
  if (args.sort)      p.sort   = args.sort;
  if (args.fields)    p.fields = args.fields;
  return p;
}

/** Append date range filters like planperiod_start[gte] */
function dateRange(p, field, gte, lte) {
  if (gte) p[`${field}[gte]`] = gte;
  if (lte) p[`${field}[lte]`] = lte;
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify({ count: Array.isArray(data) ? data.length : 1, data }) }] };
}

// ─── MCP Server Factory ───────────────────────────────────────────────────────
// Each SSE connection gets its own McpServer instance to avoid the
// "Already connected to a transport" error on reconnects.
function createMcpServer() {
  const mcp = new McpServer({ name: "rentman-full", version: "3.0.0" });

// ══════════════════════════════════════════════════════════════════════════════
// PROJECTS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_projects",
  "Obtener lista de proyectos. Soporta filtros por fechas de plan/uso, estado, nombre y paginación automática.",
  {
    planperiod_start_gte:  z.string().optional().describe("planperiod_start >= (ISO 8601)"),
    planperiod_start_lte:  z.string().optional().describe("planperiod_start <="),
    planperiod_end_gte:    z.string().optional().describe("planperiod_end >="),
    planperiod_end_lte:    z.string().optional().describe("planperiod_end <="),
    usageperiod_start_gte: z.string().optional().describe("usageperiod_start >="),
    usageperiod_start_lte: z.string().optional().describe("usageperiod_start <="),
    usageperiod_end_gte:   z.string().optional().describe("usageperiod_end >="),
    usageperiod_end_lte:   z.string().optional().describe("usageperiod_end <="),
    status:    z.string().optional().describe("Estado del proyecto"),
    name:      z.string().optional().describe("Nombre exacto del proyecto"),
    number:    z.string().optional().describe("Número del proyecto"),
    sort:      z.string().optional().default("-id").describe("Ordenamiento ej: -planperiod_start"),
    fields:    z.string().optional().describe("Campos separados por coma"),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "planperiod_start",  args.planperiod_start_gte,  args.planperiod_start_lte);
    dateRange(p, "planperiod_end",    args.planperiod_end_gte,    args.planperiod_end_lte);
    dateRange(p, "usageperiod_start", args.usageperiod_start_gte, args.usageperiod_start_lte);
    dateRange(p, "usageperiod_end",   args.usageperiod_end_gte,   args.usageperiod_end_lte);
    if (args.status) p.status = args.status;
    if (args.name)   p.name   = args.name;
    if (args.number) p.number = args.number;
    return ok(await fetchAll("/projects", p, args.max_pages));
  }
);

mcp.tool("get_project", "Obtener detalle completo de un proyecto por ID.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/projects/${id}`))
);

mcp.tool("get_project_contracts", "Contratos asociados a un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/contracts`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_costs", "Costos adicionales de un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/costs`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_crew", "Crew planificado en un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/projectcrew`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_equipment", "Equipos planificados en un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/projectequipment`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_equipment_groups", "Grupos de equipos de un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/projectequipmentgroup`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_function_groups", "Grupos de funciones de un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/projectfunctiongroups`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_functions", "Funciones de crew de un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/projectfunctions`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_vehicles", "Vehículos planificados en un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/projectvehicles`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_quotes", "Cotizaciones de un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/quotes`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_subprojects", "Subproyectos de un proyecto.",
  { project_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ project_id, fields, max_pages }) => ok(await fetchAll(`/projects/${project_id}/subprojects`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_project_files", "Archivos adjuntos de un proyecto.",
  { project_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ project_id, max_pages }) => ok(await fetchAll(`/projects/${project_id}/files`, {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// SUBPROJECTS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_subprojects",
  "Obtener subproyectos con filtros de fecha y paginación.",
  {
    planperiod_start_gte:  z.string().optional(),
    planperiod_start_lte:  z.string().optional(),
    planperiod_end_gte:    z.string().optional(),
    planperiod_end_lte:    z.string().optional(),
    usageperiod_start_gte: z.string().optional(),
    usageperiod_start_lte: z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "planperiod_start",  args.planperiod_start_gte, args.planperiod_start_lte);
    dateRange(p, "planperiod_end",    args.planperiod_end_gte,   args.planperiod_end_lte);
    dateRange(p, "usageperiod_start", args.usageperiod_start_gte, args.usageperiod_start_lte);
    return ok(await fetchAll("/subprojects", p, args.max_pages));
  }
);

mcp.tool("get_subproject", "Detalle de un subproyecto.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/subprojects/${id}`))
);

mcp.tool("get_subproject_crew", "Crew de un subproyecto.",
  { subproject_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ subproject_id, fields, max_pages }) => ok(await fetchAll(`/subprojects/${subproject_id}/projectcrew`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_subproject_equipment", "Equipos de un subproyecto.",
  { subproject_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ subproject_id, fields, max_pages }) => ok(await fetchAll(`/subprojects/${subproject_id}/projectequipment`, fields ? { fields } : {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT TYPES
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_project_types", "Tipos de proyecto disponibles. type: regular|supplier|transfer|shifts",
  { fields: z.string().optional(), max_pages: z.number().optional().default(3) },
  async ({ fields, max_pages }) => ok(await fetchAll("/projecttypes", fields ? { fields } : {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT CREW (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_projectcrew",
  "Planificación global de crew con filtros de fecha de planificación.",
  {
    planperiod_start_gte: z.string().optional().describe("planperiod_start >= (ISO 8601)"),
    planperiod_start_lte: z.string().optional(),
    planperiod_end_gte:   z.string().optional(),
    planperiod_end_lte:   z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "planperiod_start", args.planperiod_start_gte, args.planperiod_start_lte);
    dateRange(p, "planperiod_end",   args.planperiod_end_gte,   args.planperiod_end_lte);
    return ok(await fetchAll("/projectcrew", p, args.max_pages));
  }
);

mcp.tool("get_projectcrew_item", "Detalle de una asignación de crew.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/projectcrew/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT EQUIPMENT (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_projectequipment",
  "Equipos planificados globalmente con filtros de fecha.",
  {
    planperiod_start_gte: z.string().optional(),
    planperiod_start_lte: z.string().optional(),
    planperiod_end_gte:   z.string().optional(),
    planperiod_end_lte:   z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "planperiod_start", args.planperiod_start_gte, args.planperiod_start_lte);
    dateRange(p, "planperiod_end",   args.planperiod_end_gte,   args.planperiod_end_lte);
    return ok(await fetchAll("/projectequipment", p, args.max_pages));
  }
);

mcp.tool("get_projectequipment_item", "Detalle de un ítem de equipo planificado.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/projectequipment/${id}`))
);

mcp.tool("get_projectequipmentgroup",
  "Grupos de equipo planificados globalmente.",
  {
    sort: z.string().optional().default("-id"),
    fields: z.string().optional(),
    limit: z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => ok(await fetchAll("/projectequipmentgroup", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_projectfunctions",
  "Funciones de crew globalmente. type: crew_function|transport_function|remark|shift",
  {
    planperiod_start_gte: z.string().optional(),
    planperiod_start_lte: z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "planperiod_start", args.planperiod_start_gte, args.planperiod_start_lte);
    return ok(await fetchAll("/projectfunctions", p, args.max_pages));
  }
);

mcp.tool("get_projectfunction_crew", "Crew de una función específica.",
  { function_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ function_id, fields, max_pages }) => ok(await fetchAll(`/projectfunctions/${function_id}/projectcrew`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_projectfunctiongroups", "Grupos de funciones globalmente.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(10) },
  async (args) => ok(await fetchAll("/projectfunctiongroups", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT VEHICLES
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_projectvehicles",
  "Vehículos planificados globalmente con filtros de fecha.",
  {
    planningperiod_start_gte: z.string().optional(),
    planningperiod_start_lte: z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "planningperiod_start", args.planningperiod_start_gte, args.planningperiod_start_lte);
    return ok(await fetchAll("/projectvehicles", p, args.max_pages));
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT REQUESTS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_projectrequests",
  "Solicitudes de proyecto. status: accepted|declined|open. source: rentaround|rentman|zoef|api",
  {
    status:    z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    if (args.status) p.status = args.status;
    return ok(await fetchAll("/projectrequests", p, args.max_pages));
  }
);

mcp.tool("get_projectrequest", "Detalle de una solicitud de proyecto.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/projectrequests/${id}`))
);

mcp.tool("get_projectrequest_equipment", "Equipos de una solicitud de proyecto.",
  { request_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ request_id, fields, max_pages }) => ok(await fetchAll(`/projectrequests/${request_id}/projectrequestequipment`, fields ? { fields } : {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_equipment",
  "Inventario de equipos. type: set|case|item. rental_sales: Sale|Rental. stock_management: Track stock | Exclude from stock tracking",
  {
    name:           z.string().optional(),
    code:           z.string().optional(),
    type:           z.string().optional().describe("set | case | item"),
    rental_sales:   z.string().optional().describe("Sale | Rental"),
    sort:           z.string().optional().default("+name"),
    fields:         z.string().optional(),
    limit:          z.number().optional().default(300),
    max_pages:      z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    if (args.name)         p.name         = args.name;
    if (args.code)         p.code         = args.code;
    if (args.type)         p.type         = args.type;
    if (args.rental_sales) p.rental_sales  = args.rental_sales;
    return ok(await fetchAll("/equipment", p, args.max_pages));
  }
);

mcp.tool("get_equipment_item", "Detalle de un ítem de equipo.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/equipment/${id}`))
);

mcp.tool("get_equipment_accessories", "Accesorios de un equipo.",
  { equipment_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ equipment_id, fields, max_pages }) => ok(await fetchAll(`/equipment/${equipment_id}/accessories`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_equipment_sets_content", "Contenido de un set/case de equipo.",
  { equipment_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ equipment_id, fields, max_pages }) => ok(await fetchAll(`/equipment/${equipment_id}/equipmentsetscontent`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_equipment_serial_numbers", "Números de serie de un equipo.",
  { equipment_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ equipment_id, fields, max_pages }) => ok(await fetchAll(`/equipment/${equipment_id}/serialnumbers`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_equipment_repairs", "Reparaciones de un equipo.",
  { equipment_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ equipment_id, fields, max_pages }) => ok(await fetchAll(`/equipment/${equipment_id}/repairs`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_equipment_stock_movements", "Movimientos de stock de un equipo.",
  { equipment_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ equipment_id, fields, max_pages }) => ok(await fetchAll(`/equipment/${equipment_id}/stockmovements`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_equipment_files", "Archivos de un equipo.",
  { equipment_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ equipment_id, max_pages }) => ok(await fetchAll(`/equipment/${equipment_id}/files`, {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// ACCESSORIES (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_accessories", "Lista global de accesorios.",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/accessories", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT SETS CONTENT (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_equipmentsetscontent", "Contenido global de sets de equipo.",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/equipmentsetscontent", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// SERIAL NUMBERS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_serial_numbers", "Números de serie globalmente.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(10) },
  async (args) => ok(await fetchAll("/serialnumbers", baseParams(args), args.max_pages))
);

mcp.tool("get_serial_number", "Detalle de un número de serie.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/serialnumbers/${id}`))
);

mcp.tool("get_serial_number_actual_content", "Contenido actual de un serial (combinaciones).",
  { serial_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ serial_id, max_pages }) => ok(await fetchAll(`/serialnumbers/${serial_id}/actualcontent`, {}, max_pages))
);

mcp.tool("get_serial_number_assigned_serials", "Seriales asignados a un serial.",
  { serial_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ serial_id, max_pages }) => ok(await fetchAll(`/serialnumbers/${serial_id}/equipmentassignedserials`, {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT ASSIGNED SERIALS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_equipment_assigned_serials", "Seriales asignados globalmente.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/equipmentassignedserials", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// ACTUAL CONTENT
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_actual_content", "Contenido actual de combinaciones serializadas.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/actualcontent", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// REPAIRS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_repairs",
  "Reparaciones. repair_status: in-progress|completed|unrepairable",
  {
    repair_status:       z.string().optional(),
    repairperiod_start_gte: z.string().optional(),
    repairperiod_start_lte: z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    if (args.repair_status) p.repair_status = args.repair_status;
    dateRange(p, "repairperiod_start", args.repairperiod_start_gte, args.repairperiod_start_lte);
    return ok(await fetchAll("/repairs", p, args.max_pages));
  }
);

mcp.tool("get_repair", "Detalle de una reparación.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/repairs/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// STOCK MOVEMENTS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_stock_movements",
  "Movimientos de stock. type: manual|equipment_lost|equipment_found|serial_created|serial_deleted|...",
  {
    date_gte:  z.string().optional().describe("date >= (ISO 8601)"),
    date_lte:  z.string().optional().describe("date <="),
    type:      z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "date", args.date_gte, args.date_lte);
    if (args.type) p.type = args.type;
    return ok(await fetchAll("/stockmovements", p, args.max_pages));
  }
);

mcp.tool("get_stock_movement", "Detalle de un movimiento de stock.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/stockmovements/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// STOCK LOCATIONS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_stock_locations", "Ubicaciones de stock. type: plannable|nonplannable",
  { type: z.string().optional(), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => {
    const p = baseParams(args);
    if (args.type) p.type = args.type;
    return ok(await fetchAll("/stocklocations", p, args.max_pages));
  }
);

mcp.tool("get_stock_location", "Detalle de una ubicación de stock.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/stocklocations/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// CONTACTS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_contacts",
  "Contactos/clientes. type: private|company",
  {
    name:      z.string().optional(),
    country:   z.string().optional().describe("Código de país (ar, us, gb, etc.)"),
    type:      z.string().optional().describe("private | company"),
    city:      z.string().optional(),
    sort:      z.string().optional().default("+name"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    if (args.name)    p.name    = args.name;
    if (args.country) p.country = args.country;
    if (args.type)    p.type    = args.type;
    if (args.city)    p.city    = args.city;
    return ok(await fetchAll("/contacts", p, args.max_pages));
  }
);

mcp.tool("get_contact", "Detalle de un contacto.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/contacts/${id}`))
);

mcp.tool("get_contact_persons_of_contact", "Personas de contacto de un contacto.",
  { contact_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ contact_id, fields, max_pages }) => ok(await fetchAll(`/contacts/${contact_id}/contactpersons`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_contact_files", "Archivos de un contacto.",
  { contact_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ contact_id, max_pages }) => ok(await fetchAll(`/contacts/${contact_id}/files`, {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// CONTACT PERSONS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_contact_persons", "Personas de contacto globalmente.",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(10) },
  async (args) => ok(await fetchAll("/contactpersons", baseParams(args), args.max_pages))
);

mcp.tool("get_contact_person", "Detalle de una persona de contacto.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/contactpersons/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// CREW
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_crew", "Lista de personal/crew.",
  { sort: z.string().optional().default("+displayname"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/crew", baseParams(args), args.max_pages))
);

mcp.tool("get_crew_member", "Detalle de un miembro del crew.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/crew/${id}`))
);

mcp.tool("get_crew_appointments", "Citas de un miembro del crew.",
  { crew_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ crew_id, fields, max_pages }) => ok(await fetchAll(`/crew/${crew_id}/appointments`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_crew_availability", "Disponibilidad de un miembro del crew.",
  {
    crew_id: z.number(),
    start_gte: z.string().optional(),
    start_lte: z.string().optional(),
    fields:    z.string().optional(),
    max_pages: z.number().optional().default(5),
  },
  async ({ crew_id, start_gte, start_lte, fields, max_pages }) => {
    const p = {};
    dateRange(p, "start", start_gte, start_lte);
    if (fields) p.fields = fields;
    return ok(await fetchAll(`/crew/${crew_id}/crewavailability`, p, max_pages));
  }
);

mcp.tool("get_crew_rates", "Tarifas de un miembro del crew.",
  { crew_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ crew_id, fields, max_pages }) => ok(await fetchAll(`/crew/${crew_id}/crewrates`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_crew_invitations", "Invitaciones de un miembro del crew.",
  { crew_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ crew_id, fields, max_pages }) => ok(await fetchAll(`/crew/${crew_id}/invitations`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_crew_files", "Archivos de un miembro del crew.",
  { crew_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ crew_id, max_pages }) => ok(await fetchAll(`/crew/${crew_id}/files`, {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// CREW AVAILABILITY (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_crewavailability",
  "Disponibilidad global de crew. status: B (blocked) | N (not available) | O (available)",
  {
    start_gte: z.string().optional(),
    start_lte: z.string().optional(),
    end_gte:   z.string().optional(),
    end_lte:   z.string().optional(),
    status:    z.string().optional().describe("B | N | O"),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "start", args.start_gte, args.start_lte);
    dateRange(p, "end",   args.end_gte,   args.end_lte);
    if (args.status) p.status = args.status;
    return ok(await fetchAll("/crewavailability", p, args.max_pages));
  }
);

mcp.tool("get_crewavailability_item", "Detalle de disponibilidad de crew.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/crewavailability/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// CREW RATES (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_crewrates", "Tarifas de crew globalmente. type: price|cost. subtype: global|flat|temp",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/crewrates", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// APPOINTMENTS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_appointments",
  "Citas/appointments con filtros de fecha.",
  {
    start_gte: z.string().optional(),
    start_lte: z.string().optional(),
    end_gte:   z.string().optional(),
    end_lte:   z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "start", args.start_gte, args.start_lte);
    dateRange(p, "end",   args.end_gte,   args.end_lte);
    return ok(await fetchAll("/appointments", p, args.max_pages));
  }
);

mcp.tool("get_appointment", "Detalle de una cita.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/appointments/${id}`))
);

mcp.tool("get_appointment_crew", "Crew de una cita.",
  { appointment_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ appointment_id, fields, max_pages }) => ok(await fetchAll(`/appointments/${appointment_id}/appointmentcrew`, fields ? { fields } : {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// APPOINTMENT CREW (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_appointmentcrew", "Crew asignado a citas globalmente.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/appointmentcrew", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// INVITATIONS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_invitations",
  "Invitaciones de crew. type: availability|reservation|final_planning|draft_planning. emailstatus: pending|new|newremind|inprogress|processed",
  {
    type:        z.string().optional(),
    emailstatus: z.string().optional(),
    start_gte:   z.string().optional(),
    start_lte:   z.string().optional(),
    sort:        z.string().optional().default("-id"),
    fields:      z.string().optional(),
    limit:       z.number().optional().default(300),
    max_pages:   z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    if (args.type)        p.type        = args.type;
    if (args.emailstatus) p.emailstatus = args.emailstatus;
    dateRange(p, "start", args.start_gte, args.start_lte);
    return ok(await fetchAll("/invitations", p, args.max_pages));
  }
);

mcp.tool("get_invitation", "Detalle de una invitación.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/invitations/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// INVOICES
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_invoices",
  "Facturas con filtros de fecha. invoicetype: C (credit) | F (factura)",
  {
    date_gte:     z.string().optional().describe("date >= (ISO 8601)"),
    date_lte:     z.string().optional(),
    invoicetype:  z.string().optional().describe("C | F"),
    sort:         z.string().optional().default("-id"),
    fields:       z.string().optional(),
    limit:        z.number().optional().default(300),
    max_pages:    z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "date", args.date_gte, args.date_lte);
    if (args.invoicetype) p.invoicetype = args.invoicetype;
    return ok(await fetchAll("/invoices", p, args.max_pages));
  }
);

mcp.tool("get_invoice", "Detalle de una factura.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/invoices/${id}`))
);

mcp.tool("get_invoice_lines_of_invoice", "Líneas de detalle de una factura.",
  { invoice_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ invoice_id, fields, max_pages }) => ok(await fetchAll(`/invoices/${invoice_id}/invoicelines`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_invoice_payments", "Pagos de una factura.",
  { invoice_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ invoice_id, fields, max_pages }) => ok(await fetchAll(`/invoices/${invoice_id}/payments`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_invoice_files", "Archivos de una factura.",
  { invoice_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ invoice_id, max_pages }) => ok(await fetchAll(`/invoices/${invoice_id}/files`, {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// INVOICE LINES (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_invoice_lines", "Líneas de factura globalmente.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(10) },
  async (args) => ok(await fetchAll("/invoicelines", baseParams(args), args.max_pages))
);

mcp.tool("get_invoice_line", "Detalle de una línea de factura.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/invoicelines/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_payments",
  "Pagos con filtros de fecha. payment_import_source: none|exactonline|quickbooks|xero|publicapi",
  {
    moment_gte: z.string().optional().describe("moment >= (ISO 8601)"),
    moment_lte: z.string().optional(),
    sort:       z.string().optional().default("-id"),
    fields:     z.string().optional(),
    limit:      z.number().optional().default(300),
    max_pages:  z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "moment", args.moment_gte, args.moment_lte);
    return ok(await fetchAll("/payments", p, args.max_pages));
  }
);

mcp.tool("get_payment", "Detalle de un pago.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/payments/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// CONTRACTS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_contracts", "Contratos.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(10) },
  async (args) => ok(await fetchAll("/contracts", baseParams(args), args.max_pages))
);

mcp.tool("get_contract", "Detalle de un contrato.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/contracts/${id}`))
);

mcp.tool("get_contract_invoice_lines", "Líneas de factura de un contrato.",
  { contract_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ contract_id, fields, max_pages }) => ok(await fetchAll(`/contracts/${contract_id}/invoicelines`, fields ? { fields } : {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// QUOTES
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_quotes", "Cotizaciones.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(10) },
  async (args) => ok(await fetchAll("/quotes", baseParams(args), args.max_pages))
);

mcp.tool("get_quote", "Detalle de una cotización.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/quotes/${id}`))
);

mcp.tool("get_quote_invoice_lines", "Líneas de una cotización.",
  { quote_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ quote_id, fields, max_pages }) => ok(await fetchAll(`/quotes/${quote_id}/invoicelines`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_quote_files", "Archivos de una cotización.",
  { quote_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ quote_id, max_pages }) => ok(await fetchAll(`/quotes/${quote_id}/files`, {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// COSTS (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_costs", "Costos adicionales globalmente.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(10) },
  async (args) => ok(await fetchAll("/costs", baseParams(args), args.max_pages))
);

mcp.tool("get_cost", "Detalle de un costo adicional.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/costs/${id}`))
);

// ══════════════════════════════════════════════════════════════════════════════
// TIME REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_time_registrations",
  "Registros de tiempo trabajado. status: pending|approved|rejected",
  {
    start_gte: z.string().optional(),
    start_lte: z.string().optional(),
    end_gte:   z.string().optional(),
    end_lte:   z.string().optional(),
    status:    z.string().optional().describe("pending | approved | rejected"),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "start", args.start_gte, args.start_lte);
    dateRange(p, "end",   args.end_gte,   args.end_lte);
    if (args.status) p.status = args.status;
    return ok(await fetchAll("/timeregistration", p, args.max_pages));
  }
);

mcp.tool("get_time_registration", "Detalle de un registro de tiempo.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/timeregistration/${id}`))
);

mcp.tool("get_time_registration_activities", "Actividades de un registro de tiempo.",
  { timeregistration_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ timeregistration_id, max_pages }) => ok(await fetchAll(`/timeregistration/${timeregistration_id}/timeregistrationactivities`, {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// TIME REGISTRATION ACTIVITIES (colección global)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_timeregistration_activities_all", "Actividades de registros de tiempo globalmente.",
  {
    from_gte: z.string().optional(),
    from_lte: z.string().optional(),
    sort:     z.string().optional().default("-id"),
    fields:   z.string().optional(),
    limit:    z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "from", args.from_gte, args.from_lte);
    return ok(await fetchAll("/timeregistrationactivities", p, args.max_pages));
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// LEAVE
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_leave_requests",
  "Solicitudes de ausencia. approval_status: pending|approved|rejected|canceled",
  {
    approval_status: z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    if (args.approval_status) p.approval_status = args.approval_status;
    return ok(await fetchAll("/leaverequest", p, args.max_pages));
  }
);

mcp.tool("get_leave_request", "Detalle de una solicitud de ausencia.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/leaverequest/${id}`))
);

mcp.tool("get_leave_mutations", "Mutaciones de ausencia globalmente.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(10) },
  async (args) => ok(await fetchAll("/leavemutation", baseParams(args), args.max_pages))
);

mcp.tool("get_leave_types", "Tipos de ausencia disponibles.",
  { fields: z.string().optional(), max_pages: z.number().optional().default(3) },
  async ({ fields, max_pages }) => ok(await fetchAll("/leavetypes", fields ? { fields } : {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// SUBRENTALS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_subrentals",
  "Subrentas (alquiler de equipo externo). type: Pick up | Delivery at warehouse | Delivery at location",
  {
    planperiod_start_gte: z.string().optional(),
    planperiod_start_lte: z.string().optional(),
    planperiod_end_gte:   z.string().optional(),
    planperiod_end_lte:   z.string().optional(),
    sort:      z.string().optional().default("-id"),
    fields:    z.string().optional(),
    limit:     z.number().optional().default(300),
    max_pages: z.number().optional().default(10),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "planperiod_start", args.planperiod_start_gte, args.planperiod_start_lte);
    dateRange(p, "planperiod_end",   args.planperiod_end_gte,   args.planperiod_end_lte);
    return ok(await fetchAll("/subrentals", p, args.max_pages));
  }
);

mcp.tool("get_subrental", "Detalle de una subrenta.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/subrentals/${id}`))
);

mcp.tool("get_subrental_equipment", "Equipos de una subrenta.",
  { subrental_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ subrental_id, fields, max_pages }) => ok(await fetchAll(`/subrentals/${subrental_id}/subrentalequipment`, fields ? { fields } : {}, max_pages))
);

mcp.tool("get_subrental_equipment_groups", "Grupos de equipos de una subrenta.",
  { subrental_id: z.number(), fields: z.string().optional(), max_pages: z.number().optional().default(5) },
  async ({ subrental_id, fields, max_pages }) => ok(await fetchAll(`/subrentals/${subrental_id}/subrentalequipmentgroup`, fields ? { fields } : {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// SUBRENTAL EQUIPMENT (colecciones globales)
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_subrental_equipment_all", "Equipos de subrentas globalmente.",
  {
    planperiod_start_gte: z.string().optional(),
    planperiod_start_lte: z.string().optional(),
    sort: z.string().optional().default("-id"),
    fields: z.string().optional(),
    limit: z.number().optional().default(300),
    max_pages: z.number().optional().default(5),
  },
  async (args) => {
    const p = baseParams(args);
    dateRange(p, "planperiod_start", args.planperiod_start_gte, args.planperiod_start_lte);
    return ok(await fetchAll("/subrentalequipment", p, args.max_pages));
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// VEHICLES
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_vehicles", "Vehículos disponibles.",
  { sort: z.string().optional().default("+name"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/vehicles", baseParams(args), args.max_pages))
);

mcp.tool("get_vehicle", "Detalle de un vehículo.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/vehicles/${id}`))
);

mcp.tool("get_vehicle_files", "Archivos de un vehículo.",
  { vehicle_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ vehicle_id, max_pages }) => ok(await fetchAll(`/vehicles/${vehicle_id}/files`, {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// RATES & FACTORS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_rates", "Tarifas de crew.",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/rates", baseParams(args), args.max_pages))
);

mcp.tool("get_rate", "Detalle de una tarifa.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/rates/${id}`))
);

mcp.tool("get_rate_factors", "Factores de una tarifa.",
  { rate_id: z.number(), max_pages: z.number().optional().default(5) },
  async ({ rate_id, max_pages }) => ok(await fetchAll(`/rates/${rate_id}/ratefactors`, {}, max_pages))
);

mcp.tool("get_ratefactors", "Factores de tarifa globalmente.",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/ratefactors", baseParams(args), args.max_pages))
);

mcp.tool("get_factor_groups", "Grupos de factores.",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/factorgroups", baseParams(args), args.max_pages))
);

mcp.tool("get_factors", "Factores globalmente.",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/factors", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// TAX CLASSES & LEDGER CODES
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_tax_classes", "Clases de impuestos. type: vat|tax|notax",
  { fields: z.string().optional(), max_pages: z.number().optional().default(3) },
  async ({ fields, max_pages }) => ok(await fetchAll("/taxclasses", fields ? { fields } : {}, max_pages))
);

mcp.tool("get_ledger_codes", "Códigos de libro mayor.",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/ledgercodes", baseParams(args), args.max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// STATUSES
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_statuses", "Estados de proyectos disponibles.",
  { fields: z.string().optional(), max_pages: z.number().optional().default(3) },
  async ({ fields, max_pages }) => ok(await fetchAll("/statuses", fields ? { fields } : {}, max_pages))
);

// ══════════════════════════════════════════════════════════════════════════════
// FILES & FOLDERS
// ══════════════════════════════════════════════════════════════════════════════

mcp.tool("get_files", "Archivos globalmente.",
  { sort: z.string().optional().default("-id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/files", baseParams(args), args.max_pages))
);

mcp.tool("get_file", "Detalle de un archivo.",
  { id: z.number() },
  async ({ id }) => ok(await fetchOne(`/files/${id}`))
);

mcp.tool("get_file_folders", "Carpetas de archivos.",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/file_folders", baseParams(args), args.max_pages))
);

mcp.tool("get_folders", "Carpetas de plantillas. itemtype: equipment|contact|vehicle|user|container|project template|default function",
  { sort: z.string().optional().default("+id"), fields: z.string().optional(), limit: z.number().optional().default(300), max_pages: z.number().optional().default(5) },
  async (args) => ok(await fetchAll("/folders", baseParams(args), args.max_pages))
);

  return mcp;
} // end createMcpServer

// ──────────────────────────────────────────────────────────────────────────────
// Express + SSE
// ──────────────────────────────────────────────────────────────────────────────
const app = express();

// Map sessionId → { transport, server } so each connection is independent
const sessions = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const server = createMcpServer(); // fresh instance per connection
  sessions[transport.sessionId] = { transport, server };
  res.on("close", () => delete sessions[transport.sessionId]);
  await server.connect(transport);
});

app.post("/messages", express.json(), async (req, res) => {
  const sessionId = new URL(req.url, "http://localhost").searchParams.get("sessionId");
  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ error: "Session not found" });
  await session.transport.handlePostMessage(req, res, req.body);
});

app.get("/health", (_, res) =>
  res.json({ status: "ok", version: "3.0.0", activeSessions: Object.keys(sessions).length })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Rentman MCP v3 running on port ${PORT}`));
