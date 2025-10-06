import { JobCallback, Spec } from "node-schedule";
import AbstractBaseWorker from "../worker/pool/abstractBaseWorker";
import WorkerPoolManager from "../worker/pool/workerPoolManager";
import JobFactory from "./jobFactory";

export default abstract class ThreadJobFactory extends JobFactory {
   protected abstract getSpec(): Spec;
   protected abstract getWorker(): AbstractBaseWorker<Date, void>;
   protected getName() {
      return this.constructor.name;
   }
   protected getJobCallback(): JobCallback {
      return (fireDate: Date) => {
         let manager = new WorkerPoolManager<Date, void>(this.getWorker(), { name: this.getName() }, 1);
         manager.run([fireDate], err => {
            if (err)
               console.error(this.getName() + ": " + err);
         });
      };
   }
}