import path from "path";
import Logger from "./logger";
import { getAbsoluteFileNamesFromDir } from "./fileNames";
import { Constructor } from "./annotations";

/**
 * Generic function to initialize objects from a directory
 * @param basePath - The base path to search from (usually __dirname)
 * @param jobsPath - The path to the directory (relative to basePath)
 * @param consumer - Optional callback function to handle each initialized object
 */
export async function initFromPath<T>(
   basePath: string,
   jobsPath: string,
   consumer?: (instance: T) => void
) {
   const JOBS = await getAbsoluteFileNamesFromDir(path.join(basePath, jobsPath));
   const jobPromises = JOBS
      .filter(file => file.endsWith('.js'))
      .map(async (file) => {
         try {
            const module = await import(file);
            Logger.debug(`Loaded module from ${file}: hasDefault=${!!module.default}, type=${typeof module.default}`);

            // Handle both ES modules and CommonJS modules
            let ModuleClass: Constructor<T>;

            if (module.default && typeof module.default === 'function') {
               // ES module with default export as constructor
               ModuleClass = module.default as Constructor<T>;
            } else if (module.default && module.default.default && typeof module.default.default === 'function') {
               // CommonJS module wrapped by dynamic import
               ModuleClass = module.default.default as Constructor<T>;
            } else if (typeof module === 'function') {
               // Direct function export
               ModuleClass = module as Constructor<T>;
            } else {
               Logger.error(`No valid constructor found in module file: ${file}. hasDefault=${!!module.default}, defaultType=${typeof module.default}, hasNestedDefault=${!!(module.default && module.default.default)}, nestedDefaultType=${module.default && typeof module.default.default}`);
               return;
            }

            const instance: T = new ModuleClass();
            if (consumer) {
               consumer(instance);
            }

            Logger.info(`Successfully initialized module from ${file}`);
         } catch (error) {
            Logger.error(`Failed to load module from ${file}:`, error);
         }
      });

   return Promise.all(jobPromises);
}

/**
 * Convenience function for initializing from a path relative to a specific base directory
 * @param basePath - The base path (usually __dirname)
 * @param relativePath - Path relative to basePath
 * @param consumer - Optional callback function to handle each initialized object
 */
export function createInitializer<T>(basePath: string) {
   return (relativePath: string, consumer?: (instance: T) => void) => {
      return initFromPath<T>(basePath, relativePath, consumer);
   };
}