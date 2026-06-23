import js from '@eslint/js';
import unusedImports from 'eslint-plugin-unused-imports';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', '.wrangler/**', 'dist/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.worker,
        ...globals.es2021,
      },
    },
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'smart'],
      'no-eval': 'error',
      'no-shadow': 'error',
      'no-underscore-dangle': 'error',
      'unused-imports/no-unused-imports': 'error',
      'prefer-arrow-callback': 'error',
      'object-shorthand': 'error',
      // Allow underscore-prefixed vars to be intentionally unused (e.g. the
      // rest-spread idiom that strips a field off an object).
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['test/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
  // Disables ESLint rules that conflict with Prettier; keep last.
  prettier,
];
