import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(cors());

// Point to the extracted docs folder at the root of the project
const DOCS_DIR = path.resolve(process.cwd(), "docs");

const server = new Server(
  { name: "webspatial-docs-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Define the available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_webspatial_docs",
      description: "List all available WebSpatial documentation files.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "read_webspatial_doc",
      description: "Read a specific WebSpatial documentation file to understand spatialized HTML and React SDK implementations.",
      inputSchema: {
        type: "object",
        properties: { filename: { type: "string", description: "The exact filename, e.g., getting-started.md" } },
        required: ["filename"]
      }
    }
  ]
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "list_webspatial_docs") {
    try {
      const files = await fs.readdir(DOCS_DIR);
      const markdownFiles = files.filter(f => f.endsWith('.md'));
      return { content: [{ type: "text", text: `Available files:\n${markdownFiles.join('\n')}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: "Error reading docs directory." }], isError: true };
    }
  }

  if (request.params.name === "read_webspatial_doc") {
    try {
      const filePath = path.join(DOCS_DIR, String(request.params.arguments?.filename));
      // Security check to prevent directory traversal
      if (!filePath.startsWith(DOCS_DIR)) {
        throw new Error("Invalid file path");
      }
      const content = await fs.readFile(filePath, "utf-8");
      return { content: [{ type: "text", text: content }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Documentation file not found.` }], isError: true };
    }
  }

  throw new Error("Tool not found");
});

// Setup SSE Transport
let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
  console.log("Client connected via SSE");
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(500).send("SSE connection not established");
  }
});

// Railway provides the PORT environment variable dynamically
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WebSpatial MCP Server running on port ${PORT}`);
});