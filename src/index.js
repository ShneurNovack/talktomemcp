import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const UPSTREAM_BASE_URL = "https://talktome-text-api.shneur.workers.dev";
const NO_TOKEN_MESSAGE =
  "No bearer token configured. Add ?bearer_token=your_token to your MCP server URL.";

const TOOLS = [
  {
    name: "set_text",
    description:
      "Requires Authorization: Bearer <API_TOKEN>. Only one text value is stored at a time — every write replaces the previous value.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to store as the latest value.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "get_text",
    description: "No auth required (CORS-enabled for browser/widget use).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

async function setText(fetcher, bearerToken, args) {
  if (!bearerToken) {
    return { isError: true, content: [{ type: "text", text: NO_TOKEN_MESSAGE }] };
  }
  const response = await fetcher.fetch(`${UPSTREAM_BASE_URL}/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: args?.text }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      `Upstream API returned ${response.status}: ${JSON.stringify(result)}`
    );
  }
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

async function getText(fetcher) {
  const response = await fetcher.fetch(`${UPSTREAM_BASE_URL}/text`, {
    method: "GET",
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      `Upstream API returned ${response.status}: ${JSON.stringify(result)}`
    );
  }
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

function createMcpServer(fetcher, bearerToken) {
  const server = new Server(
    { name: "talktomemcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case "set_text":
          return await setText(fetcher, bearerToken, args);
        case "get_text":
          return await getText(fetcher);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  });

  return server;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const bearerToken = url.searchParams.get("bearer_token");

    // Use the Service Binding to reach the upstream Worker directly.
    // A plain fetch() by workers.dev URL is blocked here with Cloudflare
    // error 1042 (Workers cannot fetch another Worker on workers.dev
    // within the same account via the public edge).
    const fetcher = env.TEXT_API ?? { fetch };

    const server = createMcpServer(fetcher, bearerToken);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
