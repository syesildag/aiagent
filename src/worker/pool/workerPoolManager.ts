import { WorkerOptions } from 'worker_threads';
import AbstractBaseWorker from './abstractBaseWorker';
import WorkerPool from './workerPool';

export type CallbackIndex<Result, This = any> = (this: This, err: null | Error, result: null | Result, index?: number) => void;

export default class WorkerPoolManager<T, R, This = any> {
   private pool: WorkerPool<T, R, This>;

   constructor(
      private instance: AbstractBaseWorker<T, R>,
      private options?: Omit<WorkerOptions, "eval">,
      private numThreads?: number) {
      // Create the worker pool once in the constructor and reuse it
      this.pool = new WorkerPool<T, R, This>(this.instance.getFilename(), this.options, this.numThreads);
   }

   run(tasks: T[], callback: CallbackIndex<R, This>): Promise<void> {

      if (!tasks || tasks.length === 0)
         return Promise.resolve();

      return new Promise((resolve, reject) => {
         // Reuse the existing pool instead of creating a new one each time
         this.pool.setMaxListeners(Math.max(this.pool.getMaxListeners(), tasks.length));
         
         const errorHandler = (error: Error) => {
            this.pool.removeListener('error', errorHandler);
            reject(error);
         };
         this.pool.onError(errorHandler);
         
         let finished = 0;
         for (let i = 0; i < tasks.length; i++) {
            this.pool.runTask(tasks[i], (err, result) => {
               callback.call(this as unknown as This, err, result, i);
               if (++finished === tasks.length) {
                  // Don't close the pool - keep it alive for reuse
                  this.pool.removeListener('error', errorHandler);
                  resolve();
               }
            });
         }
      });
   }

   close() {
      // Allow manual cleanup of the pool if needed
      this.pool.close();
   }
}