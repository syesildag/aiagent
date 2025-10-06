import { MessagePort } from 'worker_threads';

export default abstract class AbstractBaseWorker<T, R> {

   constructor(parentPort: null | MessagePort) {
      if (parentPort)
         parentPort.on('message', (task: T) => {
            parentPort!.postMessage(this.run(task));
         });
   }

   abstract getFilename(): string;

   protected abstract run(task: T): R;
}