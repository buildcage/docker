export interface LogEntry {
  host: string;
  port: string;
  ruleType: string;
  reason: string;
}

export interface AggregatedEntry extends LogEntry {
  count: number;
}

export function aggregate(filtered: LogEntry[]): AggregatedEntry[];
