import { searchPages } from './db.js';

export async function searchFiles(query) {
  const rows = await searchPages(query);

  if (!query) {
      return rows; // searchPages returns list of paths if no query
  }

  // If query exists, rows is list of { path, content }
  const results = [];
  const lowerQuery = query.toLowerCase();

  for (const row of rows) {
      // Check content match for snippet
      const content = row.content;
      if (content.toLowerCase().includes(lowerQuery)) {
          const snippet = extractSnippet(content, lowerQuery);
          results.push(`${row.path}:${snippet}`);
      } else {
          // Must have matched on path
          results.push(row.path);
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
