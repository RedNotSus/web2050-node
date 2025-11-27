import { getDomainPages } from './db.js';

export async function readAllFilesInDir(dir) {
  // dir is the domain path, e.g. "internet/google.com" (from old logic) or just "google.com" (logical).
  // The caller in index.js does:
  // const fsDomain = path.join(INTERNET_DIR, key);
  // await readAllFilesInDir(fsDomain);

  // We need to change the caller to pass the logical domain key, not the filesystem path.
  // But for now, let's assume the caller might still pass a path and we strip it?
  // Or better, we update the caller in the next step.
  // Let's implement this function expecting `dir` to be the domain key (e.g. "google.com").

  // Wait, I should make sure I update the caller.
  // Since I am refactoring assets.js now, let's assume `dir` is the domain string.

  try {
     const rows = await getDomainPages(dir);
     const assets = rows.map(row => ({
         path: row.path,
         content: row.content
     }));
     return new AssetList(assets);
  } catch (e) {
      // Return empty if error
      return new AssetList([]);
  }
}

class AssetList {
  constructor(assets) {
    this.assets = assets;
  }

  toString() {
    return this.assets.map(asset => {
      return `${asset.path}\n\`\`\`\n${asset.content}\n\`\`\``;
    }).join('\n\n');
  }
}
