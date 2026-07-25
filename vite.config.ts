import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, mkdirSync, copyFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// Copies public/ to dist/ file-by-file so a single locked/unreadable file
// (like the sandbox-injected "logo_spark copy copy.png") never aborts the build.
function safeCopyPublicDir(): Plugin {
  let root = '';
  let isBuild = false;
  return {
    name: 'safe-copy-public-dir',
    configResolved(config) {
      root = config.root;
      isBuild = config.command === 'build';
    },
    closeBundle() {
      if (!isBuild) return;
      copyDirSafe(join(root, 'public'), join(root, 'dist'));
    },
  };
}

function copyDirSafe(src: string, dest: string) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    try {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      const stat = statSync(srcPath);
      if (stat.isDirectory()) {
        copyDirSafe(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    } catch {
      // Skip files the OS won't let us read (EAGAIN, permission errors, etc.)
    }
  }
}

export default defineConfig({
  plugins: [react(), safeCopyPublicDir()],
  build: {
    // Disable Vite's built-in public dir copy; safeCopyPublicDir handles it
    // with per-file error handling so locked sandbox files don't abort builds.
    copyPublicDir: false,
    // Explicitly disable sourcemaps in production. Without this, a future
    // accidental change to sourcemap: true would expose original source code.
    sourcemap: false,
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    port: 5173,
    host: true,
    open: true
  },
  preview: {
    port: 5173,
    host: true
  },
  define: {
    global: 'window',
  }
});
