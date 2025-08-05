import fetchSQL from "../descriptions/sql";
import Instrumentation from "../utils/instrumentation";
import { McpAgentFactory } from "./mcpFactory";

const factory = McpAgentFactory.getInstance();

factory.registerAgent({
   name: "database",
   instrumentation: new Instrumentation(fetchSQL),
   userPromptTemplate: (question: string) => `Given the following PostgreSQL schema ->
CREATE TABLE public.countries (
    id integer NOT NULL,
    iso character(2) NOT NULL,
    name character varying(80) NOT NULL,
    nicename character varying(80) NOT NULL,
    iso3 character(3) DEFAULT NULL::bpchar,
    numcode smallint,
    phonecode integer NOT NULL
);
      Question: ${question}`
});

export default factory.getAgent("database");