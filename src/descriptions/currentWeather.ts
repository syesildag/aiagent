
import { z } from "zod";
import { Description } from "../utils/makeTool";

const WeatherParams = z.object({
   location: z.string().min(1).describe("Location for which weather information is needed"),
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
      return `La meteo actuelle à ${location} est: ${JSON.stringify(await response.json()) }

JSON format API response fields

coord
coord.lon Longitude of the location
coord.lat Latitude of the location
weather (more info Weather condition codes)
weather.id Weather condition id
weather.main Group of weather parameters (Rain, Snow, Clouds etc.)
weather.description Weather condition within the group. Please find more here. You can get the output in your language. Learn more
weather.icon Weather icon id
base Internal parameter
main
main.temp Temperature. Unit Default: Kelvin, Metric: Celsius, Imperial: Fahrenheit
main.feels_like Temperature. This temperature parameter accounts for the human perception of weather. Unit Default: Kelvin, Metric: Celsius, Imperial: Fahrenheit
main.pressure Atmospheric pressure on the sea level, hPa
main.humidity Humidity, %
main.temp_min Minimum temperature at the moment. This is minimal currently observed temperature (within large megalopolises and urban areas). Please find more info here. Unit Default: Kelvin, Metric: Celsius, Imperial: Fahrenheit
main.temp_max Maximum temperature at the moment. This is maximal currently observed temperature (within large megalopolises and urban areas). Please find more info here. Unit Default: Kelvin, Metric: Celsius, Imperial: Fahrenheit
main.sea_level Atmospheric pressure on the sea level, hPa
main.grnd_level Atmospheric pressure on the ground level, hPa
visibility Visibility, meter. The maximum value of the visibility is 10 km
wind
wind.speed Wind speed. Unit Default: meter/sec, Metric: meter/sec, Imperial: miles/hour
wind.deg Wind direction, degrees (meteorological)
wind.gust Wind gust. Unit Default: meter/sec, Metric: meter/sec, Imperial: miles/hour
clouds
clouds.all Cloudiness, %
rain
1h(where available)Precipitation, mm/h. Please note that only mm/h as units of measurement are available for this parameter
snow
1h(where available) Precipitation, mm/h. Please note that only mm/h as units of measurement are available for this parameter
dt Time of data calculation, unix, UTC
sys
sys.type Internal parameter
sys.id Internal parameter
sys.message Internal parameter
sys.country Country code (GB, JP etc.)
sys.sunrise Sunrise time, unix, UTC
sys.sunset Sunset time, unix, UTC
timezone Shift in seconds from UTC
id City ID. Please note that built-in geocoder functionality has been deprecated. Learn more here
name City name. Please note that built-in geocoder functionality has been deprecated. Learn more here
cod Internal parameter
      `;
   }
};

export default fetchCurrentWeather;