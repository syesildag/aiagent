import fetchCurrentWeather from "../descriptions/currentWeather";
import { AIAgentName } from "../utils/aiAgent";
import Instrumentation from "../utils/instrumentation";
import AbstractAgent from "./abstractAgent";

class WeatherAgent extends AbstractAgent {

   getName(): AIAgentName {
      return "weather";
   }

   getInstrumentation() {
      return new Instrumentation(fetchCurrentWeather);
   }
}

export default new WeatherAgent();