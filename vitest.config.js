import { defineConfig } from 'vitest/config';

/**
 * Inline Vite plugin: load `.md` files as raw text strings, so
 * `import chatPrompt from './prompts/chat.md'` returns the file's contents in
 * tests — mirroring the wrangler `[[rules]] type = "Text"` rule that does the
 * same in the Worker bundle. The import specifier is identical in both (no
 * `?raw` suffix), so prompts.js works unchanged under vitest and wrangler.
 */
function rawMarkdownPlugin() {
  return {
    name: 'raw-markdown',
    transform(code, id) {
      if (!id.endsWith('.md')) return null;
      return {
        code: `export default ${JSON.stringify(code)};`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [rawMarkdownPlugin()],
});
