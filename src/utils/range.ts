export default function* range(start = 0, end = Infinity, step = 1) {
   let count = 0;
   for (let i = start; i < end; i += step) {
      count++;
      yield i;
   }
   return count;
}