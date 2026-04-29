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

// A map to store the active transport streams for each connected client (e.g., Cursor)
const transports = new Map<string, SSEServerTransport>();

// 1. The endpoint Cursor hits to open the SSE stream
app.get("/sse", async (req, res) => {
  // Create a fresh Server instance for EVERY new connection
  const server = new Server(
    { name: "webspatial-docs-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // Define tools for THIS specific server instance
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
        if (!filePath.startsWith(DOCS_DIR)) throw new Error("Invalid file path");
        
        const content = await fs.readFile(filePath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Documentation file not found.` }], isError: true };
      }
    }
    
    throw new Error("Tool not found");
  });

  // Create the SSE transport 
  const transport = new SSEServerTransport("/messages", res);
  
  // The MCP SDK automatically generates a sessionId. Store the transport using this ID.
  transports.set(transport.sessionId, transport);
  
  // Handle cleanup when Cursor disconnects to prevent memory leaks
  res.on("close", () => {
    console.log(`Client disconnected: ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  });

  // Connect the server to the transport!
  await server.connect(transport);
  console.log(`New client connected: ${transport.sessionId}`);
});

// 2. The endpoint Cursor hits to actually call the tools
app.post("/messages", async (req, res) => {
  // Cursor automatically includes the sessionId in the URL query
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  
  if (!transport) {
    res.status(404).send("Session not found.");
    return;
  }

  // Pass the message to the correct active stream
  await transport.handlePostMessage(req, res);
});

// Bind to 0.0.0.0 so Railway's router can properly send traffic to the Express app
// Convert the string environment variable to a Number
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WebSpatial MCP Server running on port ${PORT}`);
});