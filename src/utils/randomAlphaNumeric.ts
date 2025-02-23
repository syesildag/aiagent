import { z } from "zod";
import range from "./range";

const minTimes = z.number().min(1); // 0.5

export default function randomAlphaNumeric(times: number = 1): string {
   // Validate input and ensure it is an integer
   times = Math.floor(minTimes.parse(times));
   let concat = "";
   for (const _ of range(0, times))
      concat += once();
   return concat;
}

function once(): string {
   return Math.random().toString(36).slice(2);
}