import fetchCurrentWeather from "../descriptions/currentWeather";
import { AgentName } from "../agent";
import Instrumentation from "../utils/instrumentation";
import AbstractAgent from "./abstractAgent";

class WeatherAgent extends AbstractAgent {

   getName(): AgentName {
      return "weather";
   }

   getInstrumentation() {
      return new Instrumentation(fetchCurrentWeather);
   }
}

export default new WeatherAgent();