const wordPattern = new RegExp(['[A-Z][a-z]+', '[A-Z]+(?=[A-Z][a-z])', '[A-Z]+', '[a-z]+', '[0-9]+'].join('|'), 'g');

export function camelCase(string = ''): string {
   return words(string)
      .map((word, index) => (index === 0 ? toLower(word) : upperFirst(toLower(word))))
      .join('');
}

export function words(string = '', pattern?: RegExp | string): string[] {
   if (pattern === undefined) {
      return string.match(wordPattern) || [];
   }
   return string.match(pattern) || [];
}

export function upperCase(string = ''): string {
   return words(string)
      .map((word) => toUpper(word))
      .join(' ');
}

export function toUpper(string: string): string {
   return string.toUpperCase();
}

export function toLower(string: string): string {
   return string.toLowerCase();
}

export function upperFirst(string: string): string {
   return string.slice(0, 1).toUpperCase() + string.slice(1);
}