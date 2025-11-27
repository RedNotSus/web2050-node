import Fastify from 'fastify';
import path from 'path';
import mime from 'mime-types';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

import { streamPage } from './ai.js';
import { readAllFilesInDir } from './assets.js';
import { StreamingParser } from './streaming_parser.js';
import { searchFiles } from './search.js';
import { setup, getPage, savePage, deletePage } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
// INTERNET_DIR is no longer used for storage

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

// Reset Endpoint
fastify.post('/reset', async (request, reply) => {
    const { path: rawPath } = request.body || {};
    if (!rawPath) {
        return reply.code(400).send({ error: "Missing 'path' in body" });
    }

    // Normalize path logic (same as in serve)
    let urlPath = rawPath;
    if (urlPath.startsWith('/')) urlPath = urlPath.slice(1);

    // We try to guess normalization to match what was saved.
    // If user passes "google.com", we saved "google.com/index.html".
    // If user passes "google.com/index.html", we saved "google.com/index.html".

    // Let's just try to delete exactly what is passed first?
    // Or apply the same normalization.
    const parts = urlPath.split('/').filter(p => p.length > 0);
    const hasExtension = path.extname(urlPath).length > 0;

    let targetPath = urlPath;
    if (parts.length === 1 || !hasExtension) {
         if (!urlPath.endsWith('.html')) {
             // Avoid double .html if user typed google.com/index
             if (!urlPath.endsWith('index.html')) {
                // If it ends in slash or just domain
                targetPath = path.join(urlPath, 'index.html');
             }
         }
    }

    await deletePage(targetPath);
    return { success: true, deleted: targetPath };
});


// Index Route
fastify.get('/', async (request, reply) => {
  const { q } = request.query;
  const content = !!q;

  let results = [];
  try {
     results = await searchFiles(q);
  } catch (e) {
      fastify.log.error(e);
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

fastify.get('/*', async (request, reply) => {
    let urlPath = request.params['*'];
    if (!urlPath) return reply.code(404).send('Not Found');

    if (path.extname(urlPath) === '.map') {
        return reply.code(400).send('Bad Request');
    }

    // Normalization logic
    const parts = urlPath.split('/').filter(p => p.length > 0);
    const hasExtension = path.extname(urlPath).length > 0;

    // First, check if exact match exists in DB (e.g. style.css)
    let page = await getPage(urlPath);

    if (!page) {
        // Apply default logic
        if (parts.length === 1) {
             urlPath = path.join(urlPath, 'index.html');
        } else if (!hasExtension) {
             urlPath = path.join(urlPath, 'index.html');
        }

        // Check again with normalized path
        page = await getPage(urlPath);
    }

    if (urlPath.length > 72) {
        return reply.code(414).send('URI Too Long');
    }

    // Identify the domain key (first component)
    const key = urlPath.split('/')[0];
    if (!key) {
        return reply.code(400).send('Invalid Path');
    }

    // Check if we are generating this domain
    if (generationMap.has(key)) {
        await generationMap.get(key);
        // Try to fetch again
        page = await getPage(urlPath);
    }

    if (page) {
        const contentType = mime.lookup(urlPath) || 'text/html';
        return reply.type(contentType).send(page.content);
    }

    // Generation Logic
    let resolveGeneration;
    const generationPromise = new Promise(resolve => {
        resolveGeneration = resolve;
    });

    // Double check lock
    if (generationMap.has(key)) {
         await generationMap.get(key);
         page = await getPage(urlPath);
         if (page) {
             const contentType = mime.lookup(urlPath) || 'text/html';
             return reply.type(contentType).send(page.content);
         }
         return reply.code(500).send('Generation failed or file not found after wait');
    }

    generationMap.set(key, generationPromise);

    try {
        // Fetch context assets from DB
        let assets;
        try {
           assets = await readAllFilesInDir(key);
        } catch (e) {
            assets = { toString: () => "" };
        }

        const aiStream = await streamPage(urlPath, assets);

        const contentType = mime.lookup(urlPath) || 'text/html';
        reply.type(contentType);

        const parser = new StreamingParser();

        const responseStream = new Readable({
            read() {}
        });

        reply.send(responseStream);

        // Accumulate content for DB
        let fullContent = "";

        const reader = aiStream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        function processChunk(chunk) {
            buffer += chunk;
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);

                if (line.length < 6) continue;

                const jsonStr = line.slice(6);
                if (jsonStr === "[DONE]") continue;

                try {
                    const json = JSON.parse(jsonStr);
                    if (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) {
                        const contentChunk = json.choices[0].delta.content;
                        const output = parser.feed(contentChunk);

                        if (output) {
                            fullContent += output;
                            responseStream.push(output);
                        }
                    }
                } catch (e) {
                }
            }
        }

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                processChunk(chunk);
            }
        } catch (e) {
            request.log.error(e);
        } finally {
            responseStream.push(null);

            // Save to DB
            if (fullContent.length > 0) {
                try {
                    await savePage(urlPath, fullContent);
                } catch (saveErr) {
                    request.log.error({ err: saveErr, path: urlPath }, 'Failed to save generated page to DB');
                }
            }
        }

    } catch (err) {
        request.log.error(err);
        generationMap.delete(key);
        resolveGeneration();
        if (!reply.sent) {
            reply.code(500).send('Internal Server Error');
        }
        return;
    }

    generationMap.delete(key);
    resolveGeneration();
});

const start = async () => {
  try {
    await setup(); // Init DB

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
