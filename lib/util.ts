/**
 * Escapes regexp special chars
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

/**
 * Trim trailing char
 */
export function chomp(str: string, char: string): string {
  return str.replace(new RegExp(escapeRegExp(char) + '+$'), '');
}
