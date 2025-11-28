import { getDomainPages } from './db.js';

export async function readAllFilesInDir(dir) {
  try {
     const rows = await getDomainPages(dir);
     const assets = rows.map(row => ({
         path: row.path,
         content: row.content
     }));
     return new AssetList(assets);
  } catch (e) {
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
