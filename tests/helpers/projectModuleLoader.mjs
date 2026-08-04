import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function createProjectModuleLoader() {
  const vite = await createServer({
    root: repositoryRoot,
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true },
    resolve: { alias: { "@": path.join(repositoryRoot, "src") } },
  });
  return {
    load: (modulePath) => vite.ssrLoadModule(modulePath),
    close: () => vite.close(),
  };
}
