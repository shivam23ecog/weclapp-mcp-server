// weclapp-mcp-server
//
// A minimal remote MCP server that exposes a handful of read/write
// tools backed by the weclapp REST API, so Claude can call them
// through a "custom connector".
//
// Your weclapp API token lives ONLY in this server's environment.
// Claude never sees it - it just calls this server's tools.

import "dotenv/config";
import { webcrypto } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}
const {
  WECLAPP_BASE_URL,
  WECLAPP_API_TOKEN,
  MCP_SHARED_SECRET,
  PORT = 3000,
} = process.env;

if (!WECLAPP_BASE_URL || !WECLAPP_API_TOKEN) {
  console.error(
    "Missing WECLAPP_BASE_URL or WECLAPP_API_TOKEN. Copy .env.example to .env and fill it in."
  );
  process.exit(1);
}

// ---------------------------------------------------------------
// Small helper for calling the weclapp REST API
// ---------------------------------------------------------------
async function weclappRequest(path, { method = "GET", query, body } = {}) {
  const url = new URL(`${WECLAPP_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      AuthenticationToken: WECLAPP_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(
      `weclapp API error ${res.status}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    );
  }

  return data;
}

// ---------------------------------------------------------------
// Build the MCP server and register tools
// ---------------------------------------------------------------
function buildServer() {
  const server = new McpServer({
    name: "weclapp-mcp-server",
    version: "1.0.0",
  });

  // --- Customers -------------------------------------------------
  server.registerTool(
    "list_customers",
    {
      title: "List weclapp customers",
      description:
        "List customers from weclapp. Supports basic paging and an optional name filter.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Filter: customer name contains this text"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ name, page, pageSize }) => {
      const query = {
        page,
        pageSize,
      };
      if (name) query["name-like"] = `%${name}%`;
      const data = await weclappRequest("/customer", { query });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_customer",
    {
      title: "Get a weclapp customer",
      description: "Fetch one customer by its weclapp ID.",
      inputSchema: { customerId: z.string().describe("weclapp customer ID") },
    },
    async ({ customerId }) => {
      const data = await weclappRequest(`/customer/id/${customerId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Invoices ----------------------------------------------------
  server.registerTool(
    "list_invoices",
    {
      title: "List weclapp invoices",
      description:
        "List sales invoices from weclapp. Optionally filter by customer ID or status.",
      inputSchema: {
        customerId: z.string().optional(),
        status: z
          .string()
          .optional()
          .describe("e.g. OPEN, PAID, CANCELED - matches weclapp's invoiceStatus values"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ customerId, status, page, pageSize }) => {
      const query = { page, pageSize };
      if (customerId) query["customerId-eq"] = customerId;
      if (status) query["status-eq"] = status;
      const data = await weclappRequest("/salesInvoice", { query });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Get a weclapp invoice",
      description: "Fetch one sales invoice by its weclapp ID.",
      inputSchema: { invoiceId: z.string() },
    },
    async ({ invoiceId }) => {
      const data = await weclappRequest(`/salesInvoice/id/${invoiceId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Articles / products ----------------------------------------
  server.registerTool(
    "list_articles",
    {
      title: "List weclapp articles",
      description: "List articles/products from weclapp, optionally filtered by name.",
      inputSchema: {
        name: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ name, page, pageSize }) => {
      const query = { page, pageSize };
      if (name) query["name-like"] = `%${name}%`;
      const data = await weclappRequest("/article", { query });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Generic escape hatch -----------------------------------------
  // Handy while you're building this out: lets Claude hit any GET
  // endpoint in the weclapp API docs without you writing a tool for it.
  server.registerTool(
    "weclapp_generic_get",
    {
      title: "Generic weclapp GET request",
      description:
        "Advanced/fallback tool: perform an arbitrary GET request against the weclapp API, " +
        "for endpoints that don't have a dedicated tool yet. Path should start with '/', " +
        "e.g. '/salesOrder' or '/party'.",
      inputSchema: {
        path: z.string().describe("API path, e.g. /salesOrder"),
        query: z
          .record(z.string())
          .optional()
          .describe("Query params as key-value strings, e.g. {\"page\": \"1\"}"),
      },
    },
    async ({ path, query }) => {
      const data = await weclappRequest(path, { query });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

// ---------------------------------------------------------------
// HTTP transport with a simple shared-secret check
// ---------------------------------------------------------------
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  if (MCP_SHARED_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${MCP_SHARED_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: fine for this simple use case
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/", (_req, res) => {
  res.send("weclapp-mcp-server is running. MCP endpoint is POST /mcp");
});

app.listen(PORT, () => {
  console.log(`weclapp-mcp-server listening on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
