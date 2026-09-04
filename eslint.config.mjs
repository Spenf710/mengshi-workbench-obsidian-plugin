import tseslint from 'typescript-eslint';
import pluginObsidian from 'eslint-plugin-obsidianmd';

// 本地复刻 Obsidian 社区审核的两个 Error 级规则，用于改前/改后对照
export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'main.js', 'styles.css'] },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [tseslint.configs.recommended],
    plugins: { obsidian: pluginObsidian },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'obsidian/no-static-styles-assignment': 'error',
      'obsidian/no-unsupported-api': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);