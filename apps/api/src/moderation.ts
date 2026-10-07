/** Pluggable content check. Replace via `setTextChecker` (e.g. external moderation API). */
export type TextChecker = (text: string) => boolean; // true = allowed

const BLOCKLIST = ["child porn", "cp links", "buy drugs", "порно с детьми", "купить наркотики"];

let checker: TextChecker = (text) => {
  const t = text.toLowerCase();
  return !BLOCKLIST.some((w) => t.includes(w));
};

export function setTextChecker(fn: TextChecker): void {
  checker = fn;
}

export function isTextAllowed(...texts: Array<string | undefined | null>): boolean {
  return texts.every((t) => !t || checker(t));
}
