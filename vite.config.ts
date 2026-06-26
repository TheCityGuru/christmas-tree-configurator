import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/** Vite plugin: dev-only API to save placement JSON to public/settings/ */
function placementSavePlugin(): Plugin {
  return {
    name: 'placement-save',
    configureServer(server) {
      server.middlewares.use('/api/save-placement', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const incoming = JSON.parse(body);
            const filePath = path.resolve(__dirname, 'public/settings/placements.json');
            // Read existing file and merge
            let existing: Record<string, unknown> = {};
            if (fs.existsSync(filePath)) {
              existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
            // Merge by tree path key
            const treeKey = incoming.tree as string;
            existing[treeKey] = incoming;
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    placementSavePlugin(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
    // Deduplicate Three.js to avoid multiple instances
    dedupe: ['three'],
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})