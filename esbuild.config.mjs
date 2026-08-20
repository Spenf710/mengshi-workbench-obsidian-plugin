import esbuild from 'esbuild';
import { copyFileSync, watchFile } from 'fs';

const prod = process.argv[2] === 'production';

// 输出到 Obsidian vault 插件目录（源码已迁出 vault）
const OUT = 'E:/obsidian_md/猛士科技/.obsidian/plugins/mengshi-workbench';

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
