import fetchSQL from "../descriptions/sql";
import { AgentName } from "../agent";
import Instrumentation from "../utils/instrumentation";
import AbstractAgent from "./abstractAgent";

class DatabaseAgent extends AbstractAgent {

   getName(): AgentName {
      return "database";
   }

   getInstrumentation() {
      return new Instrumentation(fetchSQL);
   }

   getUserPrompt(question: string): string {
      return `Given the following PostgreSQL schema ->
CREATE TABLE public.countries (
    id integer NOT NULL,
    iso character(2) NOT NULL,
    name character varying(80) NOT NULL,
    nicename character varying(80) NOT NULL,
    iso3 character(3) DEFAULT NULL::bpchar,
    numcode smallint,
    phonecode integer NOT NULL
);
      Question: ${question}`;
   }
}

export default new DatabaseAgent();