// Port of assets.rs
import { promises as fs } from 'fs';
import path from 'path';

export async function readAllFilesInDir(dir) {
  const assets = [];

  try {
    const files = await getFiles(dir);

    for (const filePath of files) {
      // Skip if somehow not a file (though getFiles filters)
      const content = await fs.readFile(filePath, 'utf-8');
      assets.push({ path: filePath, content });
    }
  } catch (err) {
    // If directory doesn't exist, just return empty list
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  return new AssetList(assets);
}

async function getFiles(dir) {
  let results = [];
  const list = await fs.readdir(dir, { withFileTypes: true });

  for (const dirent of list) {
    const res = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      results = results.concat(await getFiles(res));
    } else {
      results.push(res);
    }
  }
  return results;
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
