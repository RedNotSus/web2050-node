import Fastify from 'fastify';
import path from 'path';
import { promises as fs } from 'fs';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import mime from 'mime-types';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

import { streamPage } from './ai.js';
import { readAllFilesInDir } from './assets.js';
import { StreamingParser } from './streaming_parser.js';
import { searchFiles } from './search.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const INTERNET_DIR = path.join(ROOT_DIR, 'internet');

const fastify = Fastify({
  logger: true,
  disableRequestLogging: true
});

// Middleware for CSP
fastify.addHook('onRequest', async (request, reply) => {
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src *; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';";
  reply.header('Content-Security-Policy', csp);
});

// Generation Map: URL (string) -> Promise
const generationMap = new Map();

// Helper to split stream
// In Node web streams (returned by fetch) are not easily T-split without reading.
// We will read the source stream, parse it, and push to two destinations:
// 1. The HTTP response stream
// 2. The File write stream
// The StreamingParser needs to process the chunks first.

// Index Route
fastify.get('/', async (request, reply) => {
  const { q } = request.query;
  const content = !!q;

  let results = [];
  try {
     results = await searchFiles(q);
  } catch (e) {
      fastify.log.error(e);
      // fallback to empty
  }

  // HTML Construction
  let html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>web2050</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen flex items-center justify-center px-4 py-8">
  <main class="w-full max-w-2xl">
    <header class="mb-8 text-center">
      <h1 class="text-4xl font-bold text-blue-500">web2050 Index</h1>
      <p class="text-gray-400 mt-2">Append any URL minus the protocol (https://) to the end of this URL and watch AI generate it in real time.</p>
      <p class="text-gray-400 mt-2">Search the index of all AI-generated pages sorted descending by creation. <span id="counter">${results.length}</span> pages have been generated so far.</p>
    </header>
    <section class="mb-6 w-full flex space-x-2">
      <form method="get" class="flex w-full">
        <input
          type="text"
          name="q"
          id="search-input"
          value="${q || ''}"
          placeholder="Search by term or path..."
          class="flex-1 p-3 rounded-l-lg border border-gray-700 bg-gray-800 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" class="p-3 bg-blue-500 rounded-r-lg text-white hover:bg-blue-600 focus:ring-2 focus:ring-blue-400">
          Search by content
        </button>
      </form>
    </section>
    <ul id="list" class="space-y-2">`;

    // Script
    const script = `<script>
  const ul = document.getElementById("list");
  const counter = document.getElementById("counter");

  const observer = new MutationObserver((mutationsList) => {
    let newItems = 0;
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        newItems += mutation.addedNodes.length;
      }
    }
    if (newItems > 0) {
      counter.textContent = ul.querySelectorAll("li").length;
    }
  });

  observer.observe(ul, { childList: true });

    document.addEventListener("DOMContentLoaded", () => {
      const input = document.getElementById("search-input");
      const items = document.querySelectorAll("li");
      input.addEventListener("input", () => {
        const q = input.value.toLowerCase();
        items.forEach(el => {
          const path = el.children[0].getAttribute("href").slice(1);
          if (path && path.toLowerCase().includes(q)) {
            el.removeAttribute("style");
          } else {
            el.style.display = "none";
          }
        });
      });
    });
</script>`;
    html += script;

    if (content) {
        html += `<style>pre {
margin-top: calc(var(--spacing) * 2);
border-radius: var(--radius-md);
background-color: var(--color-gray-800);
padding: calc(var(--spacing) * 2);
overflow-wrap: break-word;
white-space: pre-wrap;
color: var(--color-gray-100);
}</style>`;
    }

    for (const line of results) {
        if (content) {
            const split = line.indexOf(':');
            if (split !== -1) {
                const p = line.slice(0, split);
                const snippet = line.slice(split + 1);
                // Simple escaping
                const escapedSnippet = snippet.replace(/&/g, "&amp;")
                                            .replace(/</g, "&lt;")
                                            .replace(/>/g, "&gt;")
                                            .replace(/"/g, "&quot;")
                                            .replace(/'/g, "&#039;");

                html += `<li><a href="/${p}">${p}</a><pre><code>${escapedSnippet}</code></pre></li>`;
            } else {
                 html += `<li><a href="/${line}">${line}</a></li>`;
            }
        } else {
            html += `<li><a href="/${line}">${line}</a></li>`;
        }
    }

    html += `</ul></main></body></html>`;

    reply.type('text/html').send(html);
});

// Serve static files from INTERNET_DIR if they exist, to handle successful generations later
// We use a wildcard route instead of fastify-static for the main logic because we need to intercept
// for generation if not found.
// Actually, fastify-static is good for serving already existing files, but we need to control the fallback.
// So we will implement custom logic.

fastify.get('/*', async (request, reply) => {
    let urlPath = request.params['*'];
    if (!urlPath) return reply.code(404).send('Not Found');

    // Remove leading slash if present (Fastify params usually don't have it)
    // urlPath = urlPath.replace(/^\//, '');

    // Check for "map" extension (from original code)
    if (path.extname(urlPath) === '.map') {
        return reply.code(400).send('Bad Request');
    }

    // Check if exactly this file exists in INTERNET_DIR
    // If it exists as a file, we serve it directly.
    let exactPath = path.join(INTERNET_DIR, urlPath);
    let exactStat = null;
    try {
        exactStat = await fs.stat(exactPath);
    } catch (e) {}

    // Default to index.html if directory or no extension
    // Logic from Rust:
    // (1, _) | (_, None) => (url.join("index.html"), "html")
    const parts = urlPath.split('/').filter(p => p.length > 0);
    const hasExtension = path.extname(urlPath).length > 0;

    if (exactStat && exactStat.isFile()) {
        // Serve exact file
    } else if (parts.length === 1) {
         // It is a domain root (or a file that doesn't exist yet).
         // We default to treating it as a directory with index.html
         // This fixes the issue where domains were created as files.
         urlPath = path.join(urlPath, 'index.html');
    } else if (!hasExtension) {
         urlPath = path.join(urlPath, 'index.html');
    }

    if (urlPath.length > 72) {
        return reply.code(414).send('URI Too Long'); // 414 URI Too Long
    }

    // Identify the domain key (first component)
    const key = urlPath.split('/')[0];
    if (!key) {
        return reply.code(400).send('Invalid Path');
    }

    // Check if we are generating this domain
    if (generationMap.has(key)) {
        // Wait for it to finish
        await generationMap.get(key);
    }

    // Check if file exists on disk
    const fsPath = path.join(INTERNET_DIR, urlPath);

    try {
        await fs.access(fsPath);
        // Exists, serve it
        // We need to set content type manually since we are streaming raw or using sendFile
        // but fastify-static is easier if we just used it.
        // Let's use sendFile from fastify-static manually if possible, or just fs.createReadStream
        // Note: we need to register fastify-static to use reply.sendFile

        const contentType = mime.lookup(fsPath) || 'text/html';
        const stream = createReadStream(fsPath);
        return reply.type(contentType).send(stream);

    } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
            request.log.error(err);
            return reply.code(500).send('Internal Server Error');
        }
        // File does not exist (or parent is file), Generate it!
    }

    // Locking
    let resolveGeneration;
    const generationPromise = new Promise(resolve => {
        resolveGeneration = resolve;
    });

    // Race condition check: check map again
    if (generationMap.has(key)) {
         await generationMap.get(key);
         // Recursively try again (it should exist now)
         // But to avoid infinite loops/stack overflow, let's just redirect or re-run logic.
         // Simpler: Just serve it now.
         const contentType = mime.lookup(fsPath) || 'text/html';
         try {
             const stream = createReadStream(fsPath);
             return reply.type(contentType).send(stream);
         } catch(e) {
             return reply.code(500).send('Generation failed or file not found after wait');
         }
    }

    generationMap.set(key, generationPromise);

    try {
        const fsDomain = path.join(INTERNET_DIR, key);
        const parentFsPath = path.dirname(fsPath);

        try {
            await fs.mkdir(parentFsPath, { recursive: true });
        } catch (e) {
            // Handle collision where a file exists where we want a directory
            if (e.code === 'EEXIST' || e.code === 'ENOTDIR') {
                // Check if the domain itself is a file
                try {
                    const stat = await fs.stat(fsDomain);
                    if (stat.isFile()) {
                        // Migration: Move existing domain file to domain/index.html
                        const tempPath = fsDomain + '.tmp';
                        await fs.rename(fsDomain, tempPath);
                        await fs.mkdir(fsDomain);
                        await fs.rename(tempPath, path.join(fsDomain, 'index.html'));

                        // Retry mkdir for the specific path we need
                        await fs.mkdir(parentFsPath, { recursive: true });
                    } else {
                        throw e;
                    }
                } catch (inner) {
                     // If still failing, throw original
                     request.log.error(inner);
                     throw e;
                }
            } else {
                throw e;
            }
        }

        // Fetch context assets
        let assets;
        try {
           assets = await readAllFilesInDir(fsDomain);
        } catch (e) {
            // Likely domain dir doesn't exist yet, that's fine
            assets = { toString: () => "" };
        }

        const aiStream = await streamPage(urlPath, assets);

        // Setup streaming response
        const contentType = mime.lookup(urlPath) || 'text/html';
        reply.type(contentType);

        // We need to write to file AND response
        const fileStream = createWriteStream(fsPath);

        const parser = new StreamingParser();

        // Transform stream for response
        const responseStream = new Readable({
            read() {}
        });

        reply.send(responseStream);

        // Process the AI stream (Node Fetch body is a ReadableStream (Web Standard) usually,
        // but depending on version/impl it might be Node stream.
        // `undici` (Fastify default) returns web stream usually?
        // `response.body` in Node 18+ `fetch` is a Web ReadableStream.

        const reader = aiStream.getReader();
        const decoder = new TextDecoder();

        // Buffer for NDJSON processing
        let buffer = "";

        function processChunk(chunk) {
            buffer += chunk;
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);

                if (line.length < 6) continue; // "data: " check

                const jsonStr = line.slice(6); // remove "data: "
                if (jsonStr === "[DONE]") continue;

                try {
                    const json = JSON.parse(jsonStr);
                    if (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) {
                        const contentChunk = json.choices[0].delta.content;

                        // Feed to parser (handles <_out> tags)
                        const output = parser.feed(contentChunk);

                        if (output) {
                            fileStream.write(output);
                            responseStream.push(output);
                        }
                    }
                } catch (e) {
                    // ignore parse errors (e.g. partial lines if logic wrong, but here we split by \n)
                }
            }
        }

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                // The AI response is NDJSON (lines of JSON)
                // We need to buffer lines to parse JSON?
                // The Rust code parsed NDJSON.
                // `while let Ok(Some(line)) = lines.next_line().await`

                // Wait, `streamPage` returns `response.body`.
                // The AI returns a stream of chunks.
                // The Rust code treated it as NDJSON.
                // We need to handle splitting by newline if chunks contain multiple lines or partial lines.

                processChunk(chunk);
            }
        } catch (e) {
            request.log.error(e);
        } finally {
            responseStream.push(null); // End response
            fileStream.end();
        }

    } catch (err) {
        request.log.error(err);
        generationMap.delete(key);
        resolveGeneration(); // Unlock
        if (!reply.sent) {
            reply.code(500).send('Internal Server Error');
        }
        return;
    }

    // Unlock
    generationMap.delete(key);
    resolveGeneration();
});

const start = async () => {
  try {
    let host = process.env.HOST || '0.0.0.0';
    let port = 3000;

    if (host.includes(':')) {
      const parts = host.split(':');
      host = parts[0];
      port = parseInt(parts[1], 10);
    }

    await fastify.listen({ port, host });
    console.log(`Server listening on ${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
