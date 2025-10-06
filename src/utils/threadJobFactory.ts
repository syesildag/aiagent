import { JobCallback, Spec } from "node-schedule";
import AbstractBaseWorker from "../worker/pool/abstractBaseWorker";
import WorkerPoolManager from "../worker/pool/workerPoolManager";
import JobFactory from "./jobFactory";

export default abstract class ThreadJobFactory extends JobFactory {
   private manager: WorkerPoolManager<Date, void>;

   constructor() {
      super();
      this.manager = new WorkerPoolManager<Date, void>(this.getWorker(), { name: this.getName() }, 1);
   }

   protected abstract getSpec(): Spec;
   protected abstract getWorker(): AbstractBaseWorker<Date, void>;
   protected getName() {
      return this.constructor.name;
   }
   protected getJobCallback(): JobCallback {
      return (fireDate: Date) => {
         this.manager.run([fireDate], err => {
            if (err)
               console.error(this.getName() + ": " + err);
         });
      };
   }

   close() {
      if (this.manager) {
         this.manager.close();
      }
   }
}