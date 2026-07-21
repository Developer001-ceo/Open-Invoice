import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Apply proper title-case capitalization to a string:
 * first letter of each word uppercase, rest lowercase.
 * CSS `text-transform: capitalize` only uppercases first letters
 * without lowercasing the rest, so "HELLO" stays "HELLO".
 * This function produces the expected "Hello" result.
 */
export function properCapitalize(text: string): string {
  return text.replace(/\S+/g, word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
}

/**
 * Apply proper title-case capitalization to HTML content.
 * Only transforms text nodes, preserving HTML tags and attributes.
 */
export function properCapitalizeHTML(html: string): string {
  // Process text between > and < (text nodes in HTML)
  return html.replace(/>([^<]*)</g, (match, text: string) => {
    return `>${properCapitalize(text)}<`;
  });
}
