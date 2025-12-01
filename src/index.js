import Fastify from 'fastify';
import path from 'path';
import mime from 'mime-types';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import fs from 'fs';
import fastifyCookie from '@fastify/cookie';

import { streamPage } from './ai.js';
import { readAllFilesInDir } from './assets.js';
import { StreamingParser } from './streaming_parser.js';
import { searchFiles } from './search.js';
import { setup, getPage, savePage, deletePage } from './db.js';
import { getAuthUrl, exchangeCodeForToken } from './oauth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const INTERNET_DIR = path.join(ROOT_DIR, 'internet');

const fastify = Fastify({
  logger: true,
  disableRequestLogging: true
});

// Register Cookie Plugin
fastify.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET || 'supersecret-cookie-secret-that-must-be-long',
  hook: 'onRequest',
  parseOptions: {}
});

// Middleware for CSP
fastify.addHook('onRequest', async (request, reply) => {
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src *; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none';";
  reply.header('Content-Security-Policy', csp);
});

// Generation Map: URL (string) -> Promise
const generationMap = new Map();

// --- Auth Routes ---

fastify.get('/login', async (request, reply) => {
    if (request.cookies.token) {
        return reply.redirect('/');
    }
    const loginPagePath = path.join(__dirname, 'login.html');
    // Fallback if file doesn't exist, though strictly you should have login.html
    try {
        const content = await fs.promises.readFile(loginPagePath, 'utf-8');
        reply.type('text/html').send(content);
    } catch(e) {
        reply.send('Login Page Not Found');
    }
});

fastify.get('/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.redirect('/');
});

fastify.get('/oauth/login', async (request, reply) => {
    const authUrl = getAuthUrl();
    return reply.redirect(authUrl);
});

fastify.get('/oauth/callback', async (request, reply) => {
    const { code } = request.query;

    if (!code) {
        return reply.code(400).send('Missing authorization code');
    }

    try {
        const tokenData = await exchangeCodeForToken(code);
        reply.setCookie('token', tokenData.access_token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7 // 1 week
        });
        return reply.redirect('/');

    } catch (err) {
        request.log.error(err);
        return reply.code(500).send('Authentication failed');
    }
});


// Reset Endpoint
fastify.post('/reset', async (request, reply) => {
    const { path: rawPath } = request.body || {};
    if (!rawPath || typeof rawPath !== 'string' || rawPath.trim().length === 0) {
        return reply.code(400).send({ error: "Invalid 'path' in body" });
    }

    let urlPath = rawPath;
    if (urlPath.startsWith('/')) urlPath = urlPath.slice(1);

    const parts = urlPath.split('/').filter(p => p.length > 0);
    const hasExtension = path.extname(urlPath).length > 0;

    let targetPath = urlPath;
    if (parts.length === 1 || !hasExtension) {
         if (!urlPath.endsWith('.html')) {
             if (!urlPath.endsWith('index.html')) {
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

  // --- START HTML CONSTRUCTION ---
  let html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>web2050 Index</title>
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Google Fonts: Inter for UI, JetBrains Mono for Data -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['Inter', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace'],
                    },
                    colors: {
                        zinc: {
                            850: '#1f1f22',
                            950: '#09090b', // Base Body
                        },
                        orange: {
                            500: '#f97316', // Serious Minimalist Accent
                        }
                    }
                }
            }
        }
    </script>

    <style>
        /* Custom Scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #09090b; }
        ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
        
        /* Solid Panel Utility */
        .solid-panel {
            background: #18181b; 
            border: 1px solid #27272a; 
        }
        
        /* Input Autofill Fix for Dark Mode */
        input:-webkit-autofill,
        input:-webkit-autofill:hover, 
        input:-webkit-autofill:focus, 
        input:-webkit-autofill:active{
            -webkit-box-shadow: 0 0 0 30px #18181b inset !important;
            -webkit-text-fill-color: white !important;
            transition: background-color 5000s ease-in-out 0s;
        }

        /* Pre tag styling for snippets */
        pre {
            margin-top: 0.75rem;
            border-radius: 0.5rem;
            background-color: #09090b; /* zinc-950 */
            border: 1px solid #27272a;
            padding: 1rem;
            overflow-wrap: break-word;
            white-space: pre-wrap;
            color: #e4e4e7; /* zinc-200 */
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.875rem;
        }
    </style>
</head>
<body class="bg-zinc-950 text-zinc-200 font-sans min-h-screen flex flex-col items-center py-12 px-4 antialiased selection:bg-orange-500/20 selection:text-orange-200">

    <main class="w-full max-w-3xl space-y-8">
        
        <!-- Header Section -->
        <header class="text-center space-y-6">
            <h1 class="text-5xl md:text-6xl font-bold text-white tracking-tight">
                web<span class="text-orange-500">2050</span>
            </h1>
            
            <div class="max-w-xl mx-auto space-y-4">
                <p class="text-zinc-400 text-lg leading-relaxed">
                    Append any URL (minus <code class="bg-zinc-900 border border-zinc-800 px-1 py-0.5 rounded text-sm font-mono text-zinc-300">https://</code>) to generate AI content.
                </p>
                
                <!-- Stats Row -->
                <div class="flex items-center justify-center gap-6 text-sm">
                    <div class="flex items-center gap-2 text-zinc-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        <span>Pages Generated:</span>
                        <span id="counter" class="font-mono text-white font-medium">${results.length}</span>
                    </div>
                    <!-- Minimalist Login/Logout logic hidden in footer/omitted per request or small link here -->
                </div>
            </div>
        </header>

        <!-- Search & Interaction Area -->
        <section class="space-y-4">
            <form method="get" class="group relative flex items-center w-full">
                <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg class="h-5 w-5 text-zinc-500 group-focus-within:text-orange-500 transition-colors duration-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>
                
                <input
                    type="text"
                    name="q"
                    id="search-input"
                    value="${q || ''}"
                    placeholder="Search index..."
                    class="block w-full pl-11 pr-32 py-4 bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-500 rounded-xl focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition-all duration-300 font-sans"
                    autocomplete="off"
                />
                
                <button type="submit" class="absolute right-2 top-2 bottom-2 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-lg border border-zinc-700 hover:border-zinc-600 transition-all duration-200">
                    Filter
                </button>
            </form>
        </section>

        <!-- Results List -->
        <ul id="list" class="space-y-3">`;

    // --- LOOP AND GENERATE ITEMS ---
    for (const line of results) {
        let p = line;
        let snippet = "";
        
        if (content) {
            const split = line.indexOf(':');
            if (split !== -1) {
                p = line.slice(0, split);
                snippet = line.slice(split + 1)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            }
        }

        // Generate the minimalist card HTML
        html += `
        <li class="group">
            <a href="/${p}" class="block solid-panel p-4 rounded-lg hover:border-zinc-600 transition-all duration-300 group-hover:bg-zinc-800">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-3 overflow-hidden">
                        <div class="p-2 bg-zinc-800 rounded-md border border-zinc-700 text-zinc-400 group-hover:text-orange-500 group-hover:border-orange-500/30 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        </div>
                        <div class="truncate">
                            <h3 class="text-zinc-200 font-medium group-hover:text-white transition-colors truncate font-mono text-sm">/${p}</h3>
                        </div>
                    </div>
                    <div class="flex items-center space-x-4 text-xs font-mono text-zinc-500">
                        <span class="bg-zinc-900 border border-zinc-800 px-2 py-1 rounded text-zinc-400 group-hover:border-zinc-700 transition-colors">HTML</span>
                    </div>
                </div>
            </a>`;
        
        if (snippet) {
            html += `<pre><code>${snippet}</code></pre>`;
        }
        
        html += `</li>`;
    }

    // --- CLOSE HTML & ADD SCRIPT ---
    html += `</ul>
        
        <footer class="pt-12 text-center">
            <p class="text-zinc-600 text-xs">
                Infrastructure status: <span class="text-emerald-500">Operational</span> &bull; Latency: <span class="font-mono">12ms</span>
            </p>
        </footer>

    </main>

    <script>
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
                 // Recalculate based on current list state
                 counter.textContent = ul.querySelectorAll("li").length;
            }
        });

        observer.observe(ul, { childList: true });

        document.addEventListener("DOMContentLoaded", () => {
            const input = document.getElementById("search-input");
            
            input.addEventListener("input", () => {
                const q = input.value.toLowerCase();
                const items = document.querySelectorAll("#list li");
                
                items.forEach(el => {
                    // Find the path inside the anchor
                    const anchor = el.querySelector("a");
                    const pathText = anchor ? anchor.getAttribute("href") : "";
                    
                    // Also check snippet if it exists (pre tag)
                    const snippetText = el.querySelector("pre") ? el.querySelector("pre").textContent : "";
                    
                    if ((pathText && pathText.toLowerCase().includes(q)) || snippetText.toLowerCase().includes(q)) {
                        el.style.display = "block";
                        // Reset animation
                        el.style.animation = "none";
                        el.offsetHeight; /* trigger reflow */
                        el.style.animation = "fadeIn 0.3s ease-out";
                    } else {
                        el.style.display = "none";
                    }
                });
            });
        });
    </script>
</body>
</html>`;

  reply.type('text/html').send(html);
});

fastify.get('/*', async (request, reply) => {
    let urlPath = request.params['*'];
    if (!urlPath) return reply.code(404).send('Not Found');

    // Static file serving from internet/ directory
    try {
        const potentialFile = path.join(INTERNET_DIR, urlPath);
        if (potentialFile.startsWith(INTERNET_DIR + path.sep)) {
            const stats = await fs.promises.stat(potentialFile);
            if (stats.isFile()) {
                const contentType = mime.lookup(potentialFile) || 'application/octet-stream';
                return reply.type(contentType).send(fs.createReadStream(potentialFile));
            }
        }
    } catch (e) {
        // Ignore errors, proceed to DB/AI
    }

    if (path.extname(urlPath) === '.map') {
        return reply.code(400).send('Bad Request');
    }

    const parts = urlPath.split('/').filter(p => p.length > 0);
    const hasExtension = path.extname(urlPath).length > 0;

    let page = await getPage(urlPath);

    if (!page) {
        if (parts.length === 1) {
             urlPath = path.join(urlPath, 'index.html');
        } else if (!hasExtension) {
             urlPath = path.join(urlPath, 'index.html');
        }
        page = await getPage(urlPath);
    }

    if (urlPath.length > 72) {
        return reply.code(414).send('URI Too Long');
    }

    const key = urlPath.split('/')[0];
    if (!key) {
        return reply.code(400).send('Invalid Path');
    }

    if (generationMap.has(key)) {
        await generationMap.get(key);
        page = await getPage(urlPath);
    }

    if (page) {
        const contentType = mime.lookup(urlPath) || 'text/html';
        return reply.type(contentType).send(page.content);
    }

    // --- Authentication Check ---
    if (!request.cookies.token) {
        return reply.redirect('/login');
    }

    // Check if client requested a stream (Shell logic)
    const isStreamRequest = request.query.stream === 'true';

    // If valid user but page not generated yet, and this IS NOT a stream request,
    // Serve the "Loading Shell" which will then request ?stream=true
    if (!isStreamRequest) {
        try {
            const loadingPath = path.join(__dirname, 'loading.html');
            const content = await fs.promises.readFile(loadingPath, 'utf-8');
            return reply.type('text/html').send(content);
        } catch (e) {
            request.log.error(e, "Failed to load loading.html");
            return reply.code(500).send("Loading Error");
        }
    }

    // --- Generation Logic (Only for ?stream=true) ---
    let resolveGeneration;
    const generationPromise = new Promise(resolve => {
        resolveGeneration = resolve;
    });

    if (generationMap.has(key)) {
         // If already generating, wait for it.
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
        const responseStream = new Readable({ read() {} });

        reply.send(responseStream);

        let fullContent = "";
        let hasError = false;

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

                        // Push RAW content to the client (shell needs thoughts + code)
                        responseStream.push(contentChunk);

                        // Feed parser to extract ONLY the clean file content for DB
                        const output = parser.feed(contentChunk);
                        if (output) {
                            fullContent += output;
                        }
                    }
                } catch (e) {}
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
            hasError = true;
            request.log.error(e);
        } finally {
            responseStream.push(null);
            if (!hasError && fullContent.length > 0) {
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
    await setup(); 
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
