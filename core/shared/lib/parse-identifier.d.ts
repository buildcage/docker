export interface ParsedIdentifier {
  scheme: string;
  host: string;
  port: string;
}

export function parseIdentifier(identifier: string): ParsedIdentifier | null;
