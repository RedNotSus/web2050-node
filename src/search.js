// Replacement for rg logic
import { promises as fs } from 'fs';
import path from 'path';

// "internet" is the root dir for generated files
const INTERNET_DIR = path.resolve('internet');

export async function searchFiles(query) {
  const allFiles = await getAllFiles(INTERNET_DIR);

  // Sort by creation time (birthtime) descending - newest first
  // Note: Rust code used --sortr=created
  allFiles.sort((a, b) => b.birthtime - a.birthtime);

  if (!query) {
    // If no query, return list of relative paths
    return allFiles.map(f => path.relative(INTERNET_DIR, f.path));
  }

  const results = [];
  const lowerQuery = query.toLowerCase();

  for (const file of allFiles) {
    const relativePath = path.relative(INTERNET_DIR, file.path);

    // Check filename match
    if (relativePath.toLowerCase().includes(lowerQuery)) {
      // Just list it
       results.push(relativePath);
       continue;
    }

    // Check content match
    try {
      const content = await fs.readFile(file.path, 'utf-8');
      if (content.toLowerCase().includes(lowerQuery)) {
        // Find snippet
        const snippet = extractSnippet(content, lowerQuery);
        // Format: path:snippet
        results.push(`${relativePath}:${snippet}`);
      }
    } catch (e) {
      // Ignore read errors
    }
  }

  return results;
}

async function getAllFiles(dir) {
  let results = [];
  try {
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of list) {
      const res = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        results = results.concat(await getAllFiles(res));
      } else {
        const stats = await fs.stat(res);
        results.push({ path: res, birthtime: stats.birthtimeMs });
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(err);
    }
  }
  return results;
}

function extractSnippet(content, query) {
  const lowerContent = content.toLowerCase();
  const index = lowerContent.indexOf(query);
  if (index === -1) return "";

  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + query.length + 40);

  // Clean up newlines for display
  return content.slice(start, end).replace(/\n/g, ' ');
}
