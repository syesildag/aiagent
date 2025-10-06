import { WorkerOptions } from 'worker_threads';
import AbstractBaseWorker from './abstractBaseWorker';
import WorkerPool from './workerPool';

export type CallbackIndex<Result, This = any> = (this: This, err: null | Error, result: null | Result, index?: number) => void;

export default class WorkerPoolManager<T, R, This = any> {
   constructor(
      private instance: AbstractBaseWorker<T, R>,
      private options?: Omit<WorkerOptions, "eval">,
      private numThreads?: number) {
   }

   run(tasks: T[], callback: CallbackIndex<R, This>): Promise<void> {

      if (!tasks || tasks.length === 0)
         return Promise.resolve();

      return new Promise((resolve, reject) => {
         const pool = new WorkerPool<T, R, This>(this.instance.getFilename(), this.options, this.numThreads);
         pool.setMaxListeners(tasks.length);
         pool.onError(error => reject(error));
         let finished = 0;
         for (let i = 0; i < tasks.length; i++) {
            pool.runTask(tasks[i], (err, result) => {
               callback.call(this as unknown as This, err, result, i);
               if (++finished === tasks.length) {
                  pool.close();
                  resolve();
               }
            });
         }
      });
   }
}