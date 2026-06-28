// vite.config.ts
import { defineConfig } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.js";
import { readdirSync, mkdirSync, copyFileSync, statSync, existsSync } from "fs";
import { join } from "path";
function safeCopyPublicDir() {
  let root = "";
  let isBuild = false;
  return {
    name: "safe-copy-public-dir",
    configResolved(config) {
      root = config.root;
      isBuild = config.command === "build";
    },
    closeBundle() {
      if (!isBuild) return;
      copyDirSafe(join(root, "public"), join(root, "dist"));
    }
  };
}
function copyDirSafe(src, dest) {
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
    }
  }
}
var vite_config_default = defineConfig({
  plugins: [react(), safeCopyPublicDir()],
  build: {
    // Disable Vite's built-in public dir copy; safeCopyPublicDir handles it
    // with per-file error handling so locked sandbox files don't abort builds.
    copyPublicDir: false
  },
  optimizeDeps: {
    exclude: ["lucide-react"]
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
    global: "window"
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIHR5cGUgUGx1Z2luIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHsgcmVhZGRpclN5bmMsIG1rZGlyU3luYywgY29weUZpbGVTeW5jLCBzdGF0U3luYywgZXhpc3RzU3luYyB9IGZyb20gJ2ZzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuLy8gQ29waWVzIHB1YmxpYy8gdG8gZGlzdC8gZmlsZS1ieS1maWxlIHNvIGEgc2luZ2xlIGxvY2tlZC91bnJlYWRhYmxlIGZpbGVcbi8vIChsaWtlIHRoZSBzYW5kYm94LWluamVjdGVkIFwibG9nb19zcGFyayBjb3B5IGNvcHkucG5nXCIpIG5ldmVyIGFib3J0cyB0aGUgYnVpbGQuXG5mdW5jdGlvbiBzYWZlQ29weVB1YmxpY0RpcigpOiBQbHVnaW4ge1xuICBsZXQgcm9vdCA9ICcnO1xuICBsZXQgaXNCdWlsZCA9IGZhbHNlO1xuICByZXR1cm4ge1xuICAgIG5hbWU6ICdzYWZlLWNvcHktcHVibGljLWRpcicsXG4gICAgY29uZmlnUmVzb2x2ZWQoY29uZmlnKSB7XG4gICAgICByb290ID0gY29uZmlnLnJvb3Q7XG4gICAgICBpc0J1aWxkID0gY29uZmlnLmNvbW1hbmQgPT09ICdidWlsZCc7XG4gICAgfSxcbiAgICBjbG9zZUJ1bmRsZSgpIHtcbiAgICAgIGlmICghaXNCdWlsZCkgcmV0dXJuO1xuICAgICAgY29weURpclNhZmUoam9pbihyb290LCAncHVibGljJyksIGpvaW4ocm9vdCwgJ2Rpc3QnKSk7XG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gY29weURpclNhZmUoc3JjOiBzdHJpbmcsIGRlc3Q6IHN0cmluZykge1xuICBpZiAoIWV4aXN0c1N5bmMoc3JjKSkgcmV0dXJuO1xuICBta2RpclN5bmMoZGVzdCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGZvciAoY29uc3QgZW50cnkgb2YgcmVhZGRpclN5bmMoc3JjKSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzcmNQYXRoID0gam9pbihzcmMsIGVudHJ5KTtcbiAgICAgIGNvbnN0IGRlc3RQYXRoID0gam9pbihkZXN0LCBlbnRyeSk7XG4gICAgICBjb25zdCBzdGF0ID0gc3RhdFN5bmMoc3JjUGF0aCk7XG4gICAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgIGNvcHlEaXJTYWZlKHNyY1BhdGgsIGRlc3RQYXRoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvcHlGaWxlU3luYyhzcmNQYXRoLCBkZXN0UGF0aCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBTa2lwIGZpbGVzIHRoZSBPUyB3b24ndCBsZXQgdXMgcmVhZCAoRUFHQUlOLCBwZXJtaXNzaW9uIGVycm9ycywgZXRjLilcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCksIHNhZmVDb3B5UHVibGljRGlyKCldLFxuICBidWlsZDoge1xuICAgIC8vIERpc2FibGUgVml0ZSdzIGJ1aWx0LWluIHB1YmxpYyBkaXIgY29weTsgc2FmZUNvcHlQdWJsaWNEaXIgaGFuZGxlcyBpdFxuICAgIC8vIHdpdGggcGVyLWZpbGUgZXJyb3IgaGFuZGxpbmcgc28gbG9ja2VkIHNhbmRib3ggZmlsZXMgZG9uJ3QgYWJvcnQgYnVpbGRzLlxuICAgIGNvcHlQdWJsaWNEaXI6IGZhbHNlLFxuICB9LFxuICBvcHRpbWl6ZURlcHM6IHtcbiAgICBleGNsdWRlOiBbJ2x1Y2lkZS1yZWFjdCddLFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTczLFxuICAgIGhvc3Q6IHRydWUsXG4gICAgb3BlbjogdHJ1ZVxuICB9LFxuICBwcmV2aWV3OiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBob3N0OiB0cnVlXG4gIH0sXG4gIGRlZmluZToge1xuICAgIGdsb2JhbDogJ3dpbmRvdycsXG4gIH1cbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF5TixTQUFTLG9CQUFpQztBQUNuUSxPQUFPLFdBQVc7QUFDbEIsU0FBUyxhQUFhLFdBQVcsY0FBYyxVQUFVLGtCQUFrQjtBQUMzRSxTQUFTLFlBQVk7QUFJckIsU0FBUyxvQkFBNEI7QUFDbkMsTUFBSSxPQUFPO0FBQ1gsTUFBSSxVQUFVO0FBQ2QsU0FBTztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sZUFBZSxRQUFRO0FBQ3JCLGFBQU8sT0FBTztBQUNkLGdCQUFVLE9BQU8sWUFBWTtBQUFBLElBQy9CO0FBQUEsSUFDQSxjQUFjO0FBQ1osVUFBSSxDQUFDLFFBQVM7QUFDZCxrQkFBWSxLQUFLLE1BQU0sUUFBUSxHQUFHLEtBQUssTUFBTSxNQUFNLENBQUM7QUFBQSxJQUN0RDtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsWUFBWSxLQUFhLE1BQWM7QUFDOUMsTUFBSSxDQUFDLFdBQVcsR0FBRyxFQUFHO0FBQ3RCLFlBQVUsTUFBTSxFQUFFLFdBQVcsS0FBSyxDQUFDO0FBQ25DLGFBQVcsU0FBUyxZQUFZLEdBQUcsR0FBRztBQUNwQyxRQUFJO0FBQ0YsWUFBTSxVQUFVLEtBQUssS0FBSyxLQUFLO0FBQy9CLFlBQU0sV0FBVyxLQUFLLE1BQU0sS0FBSztBQUNqQyxZQUFNLE9BQU8sU0FBUyxPQUFPO0FBQzdCLFVBQUksS0FBSyxZQUFZLEdBQUc7QUFDdEIsb0JBQVksU0FBUyxRQUFRO0FBQUEsTUFDL0IsT0FBTztBQUNMLHFCQUFhLFNBQVMsUUFBUTtBQUFBLE1BQ2hDO0FBQUEsSUFDRixRQUFRO0FBQUEsSUFFUjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLEdBQUcsa0JBQWtCLENBQUM7QUFBQSxFQUN0QyxPQUFPO0FBQUE7QUFBQTtBQUFBLElBR0wsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixTQUFTLENBQUMsY0FBYztBQUFBLEVBQzFCO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsRUFDUjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLEVBQ1I7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLFFBQVE7QUFBQSxFQUNWO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
