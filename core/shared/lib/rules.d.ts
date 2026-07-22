export function splitRuleTokens(rulesInput: string | undefined): string[];

export function buildRules(rulesInput: string): string[];

export function parseAndValidateRules(rulesInput: string | undefined): string[];

export function convertRule(rule: string): string;

export function wildcardToRegex(pattern: string): string;
