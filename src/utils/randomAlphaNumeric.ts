import { z } from "zod";
import range from "./range";

export const SPECIAL_CHARS = "$%&'()*+,-./:;<=>?@[]^_`{|}~";

export function getRandomSpecialChar(): string {
   return SPECIAL_CHARS[Math.floor(Math.random() * SPECIAL_CHARS.length)];
}

const minTimes = z.number().min(1); // 0.5

export default function randomAlphaNumeric(times: number = 1): string {
   // Validate input and ensure it is an integer
   times = Math.floor(minTimes.parse(times));
   let concat = "";
   for (const _ of range(0, times))
      concat += Math.random().toString(36).slice(2);
   return concat;
}