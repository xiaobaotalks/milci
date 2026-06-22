import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface FileIndex {
  path: string;
  size: number;
  mtime: string;
  functions: string[];
  imports: string[];
  exports: string[];
}

export interface ProjectIndex {
  scannedAt: string;
  totalFiles: number;
  files: FileIndex[];
}

const INDEX_FILE = '.mi-cc-index.json';
const IGNORE_PATTERNS = [
  'node_modules/**',
  'dist/**',
  '.git/**',
  'sessions/**',
  '.mi-cc-index.json',
  '*.log',
];

/**
 * 扫描项目并生成索引
 */
export async function scanProject(cwd: string = process.cwd()): Promise<ProjectIndex> {
  console.log('[索引] 扫描项目文件...');

  const files = await glob('**/*.{ts,js,json,md}', {
    cwd,
    ignore: IGNORE_PATTERNS,
    absolute: false,
  });

  const index: FileIndex[] = [];

  for (const file of files) {
    const fullPath = path.join(cwd, file);
    const stat = fs.statSync(fullPath);
    const content = fs.readFileSync(fullPath, 'utf-8');

    index.push({
      path: file,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      functions: extractFunctions(content),
      imports: extractImports(content),
      exports: extractExports(content),
    });
  }

  const projectIndex: ProjectIndex = {
    scannedAt: new Date().toISOString(),
    totalFiles: index.length,
    files: index,
  };

  fs.writeFileSync(path.join(cwd, INDEX_FILE), JSON.stringify(projectIndex, null, 2), 'utf-8');
  console.log(`[索引] 完成，共 ${index.length} 个文件，已保存到 ${INDEX_FILE}`);

  return projectIndex;
}

/**
 * 提取函数名（简单正则）
 */
function extractFunctions(content: string): string[] {
  const functions: string[] = [];
  // 匹配: function name( 或 const name = ( 或 export function name(
  const regex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    functions.push(match[1] || match[2]);
  }
  return [...new Set(functions)];
}

/**
 * 提取 import 路径
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  const regex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return [...new Set(imports)];
}

/**
 * 提取 export 名
 */
function extractExports(content: string): string[] {
  const exports: string[] = [];
  const regex = /export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  return [...new Set(exports)];
}

/**
 * 加载已有索引
 */
export function loadIndex(cwd: string = process.cwd()): ProjectIndex | null {
  const file = path.join(cwd, INDEX_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 基于关键词搜索索引
 */
export function searchIndex(query: string, index: ProjectIndex): FileIndex[] {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (keywords.length === 0) return [];

  const scored = index.files.map(f => {
    const text = `${f.path} ${f.functions.join(' ')} ${f.imports.join(' ')} ${f.exports.join(' ')}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    return { file: f, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.file);
}
