import fetchCurrentWeather from "../descriptions/currentWeather";
import Instrumentation from "../utils/instrumentation";
import { McpAgentFactory } from "./mcpFactory";

const factory = McpAgentFactory.getInstance();

factory.registerAgent({
   name: "weather",
   instrumentation: new Instrumentation(fetchCurrentWeather)
});

export default factory.getAgent("weather");