import { RecurrenceRule } from "node-schedule";
import ThreadJobFactory from "../utils/threadJobFactory";
import AbstractBaseWorker from "../worker/pool/abstractBaseWorker";
import sessionTimeoutWorker from "../worker/sessionTimeoutWorker";

export default class SessionTimeout extends ThreadJobFactory {

   constructor() {
      super();
      this.setEnable(true);
   }

   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.minute = 0;
      return rule;
   }

   protected getWorker(): AbstractBaseWorker<Date, void> {
      return sessionTimeoutWorker;
   }
}