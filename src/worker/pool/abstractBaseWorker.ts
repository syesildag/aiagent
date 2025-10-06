import { MessagePort } from 'worker_threads';

export default abstract class AbstractBaseWorker<T, R> {
   protected parentPort: MessagePort | null;

   constructor(parentPort: null | MessagePort) {
      this.parentPort = parentPort;
      if (this.parentPort) {
         // Keep the event loop alive by referencing the port.
         // This prevents the worker from exiting after a task.
         this.parentPort.ref();

         this.parentPort.on('message', (task: T) => {
            this.parentPort!.postMessage(this.run(task));
         });
      }
   }

   abstract getFilename(): string;

   protected abstract run(task: T): R;
}