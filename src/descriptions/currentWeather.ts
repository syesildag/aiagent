
import { z } from "zod";
import { Description } from "../utils/makeTool";

const WeatherParams = z.object({
   location: z.string().describe("Location for which weather information is needed"),
   units: z.enum(["celcius", "fahrenheit"]).optional().describe("Units for temperature. Default is celcius"),
});

const fetchCurrentWeather: Description<typeof WeatherParams> = {
   name: "fetchCurrentWeather",
   description: "Fetch Current Weather Information",
   parameters: WeatherParams,
   implementation: async ({ location, units }) => {
      const apiKey = process.env.OPENWEATHER_API_KEY;
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${location}&appid=${apiKey}&units=metric`;
      const response = await fetch(url);
      return `Current weather information for ${location} is: ${JSON.stringify(await response.json()) }`;
   }
};

export default fetchCurrentWeather;