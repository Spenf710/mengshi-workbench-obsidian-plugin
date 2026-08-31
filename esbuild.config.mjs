import esbuild from 'esbuild';
import { copyFileSync, watchFile, existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const prod = process.argv[2] === 'production';

// ===== 输出目录探测（支持他人构建，不再硬编码本机路径） =====
// 优先级：环境变量 OBSIDIAN_VAULT → 当前目录下 .obsidian/plugins/mengshi-workbench → dist/
const PLUGIN_DIR = 'mengshi-workbench';

function resolveOutDir() {
  // 1. 环境变量指定的 vault 仓库
  const vault = process.env.OBSIDIAN_VAULT;
  if (vault && existsSync(path.resolve(vault, '.obsidian'))) {
    return path.resolve(vault, '.obsidian', 'plugins', PLUGIN_DIR);
  }
  // 2. 当前工作目录是 vault 根（或仓库含 .obsidian/plugins 输出位）
  const cwdOut = path.resolve('.obsidian', 'plugins', PLUGIN_DIR);
  if (existsSync(path.resolve('.obsidian'))) {
    return cwdOut;
  }
  // 3. 兜底：源码目录下的 dist/
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, 'dist');
}

const OUT = resolveOutDir();

// 确保输出目录存在
import { mkdirSync } from 'fs';
mkdirSync(OUT, { recursive: true });

// 复制静态文件
function copyStatic() {
  copyFileSync('manifest.json', OUT + '/manifest.json');
  copyFileSync('styles.css', OUT + '/styles.css');
}
copyStatic();

// esbuild 构建上下文
const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', 'child_process', 'fs', 'path', 'os', 'stream'],
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  outfile: OUT + '/main.js',
  sourcemap: prod ? false : 'inline',
  minify: prod,
  treeShaking: false, // 关闭 tree-shaking，避免 React 动态引用链被误删
  loader: { '.css': 'text' },
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('✅ 生产构建完成');
  console.log(`   输出目录：${OUT}`);
} else {
  watchFile('manifest.json', () => {
    copyFileSync('manifest.json', OUT + '/manifest.json');
    console.log('  📋 manifest.json 已同步');
  });
  watchFile('styles.css', () => {
    copyFileSync('styles.css', OUT + '/styles.css');
    console.log('  🎨 styles.css 已同步');
  });
  await ctx.watch();
  console.log('👁  watch 模式已启动（含静态文件监听）');
  console.log(`   输出目录：${OUT}`);
}