#!/usr/bin/env node

/**
 * MCP Fetch Server — scrapes and extracts article text from any URL.
 *
 * Uses Mozilla Readability (the same engine as Firefox Reader Mode) to strip
 * navigation, ads, and boilerplate, returning clean article text.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import Logger from "../../utils/logger.js";

/** Maximum characters returned per article to avoid token bloat */
const MAX_CONTENT_CHARS = 3000;

/** Request timeout in milliseconds */
const FETCH_TIMEOUT_MS = 10_000;

/** Browser-like User-Agent to avoid basic bot blocks */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const FetchUrlInputSchema = z.object({
  url: z
    .string()
    .url("Must be a valid URL")
    .describe("The URL of the article or page to fetch and extract text from"),
  maxChars: z
    .number()
    .int()
    .min(200)
    .max(10_000)
    .optional()
    .describe(
      `Maximum number of characters to return (default: ${MAX_CONTENT_CHARS})`
    ),
});

// ---------------------------------------------------------------------------
// Core fetching logic
// ---------------------------------------------------------------------------

async function fetchAndExtract(
  url: string,
  maxChars: number
): Promise<{ title: string; textContent: string; excerpt: string; url: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("xhtml")) {
      throw new Error(
        `Unsupported content type "${contentType}". Only HTML pages are supported.`
      );
    }

    html = await response.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }

  // Parse with JSDOM and extract with Readability
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    throw new Error("Could not extract article content from this page.");
  }

  const trimmed =
    article.textContent.replace(/\s+/g, " ").trim().slice(0, maxChars) +
    (article.textContent.length > maxChars ? "…" : "");

  return {
    title: article.title ?? "",
    textContent: trimmed,
    excerpt: article.excerpt ?? trimmed.slice(0, 200),
    url,
  };
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  try {
    const server = new McpServer({
      name: "fetch-server",
      version: "1.0.0",
    });

    server.registerTool(
      "fetch_url",
      {
        title: "Fetch URL",
        description:
          "Fetches a web page and returns the main article text, stripped of ads, " +
          "navigation and boilerplate. Use this after getting a URL from a search " +
          "result to read the actual content of a news article or web page.",
        inputSchema: FetchUrlInputSchema,
      },
      async ({ url, maxChars }) => {
        const limit = maxChars ?? MAX_CONTENT_CHARS;
        Logger.info(`[fetch-server] Fetching: ${url}`);

        try {
          const result = await fetchAndExtract(url, limit);
          Logger.info(
            `[fetch-server] Extracted ${result.textContent.length} chars from "${result.title}"`
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          Logger.warn(`[fetch-server] Failed to fetch ${url}: ${message}`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: message,
                  url,
                  title: "",
                  textContent: "",
                  excerpt: "",
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);

    Logger.info("Fetch MCP Server started successfully");
  } catch (error) {
    Logger.error("Failed to start Fetch server:", error);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  Logger.info("Shutting down Fetch MCP Server...");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  Logger.error("Unhandled server error:", error);
  process.exit(1);
});
