# Reference

This page holds no reference material of its own. It all lives in the [README](../README.md), and
what follows is a set of links into it.

- [Usage](../README.md#usage): connecting Buildx to the builder, and the audit-to-restrict flow
- [Inputs](../README.md#inputs): every input of the setup action, with its default and the engines it applies to
- [Operation modes](../README.md#operation-modes): what `audit` and `restrict` each do
- [Rule syntax](../README.md#rule-syntax): URL rules, host rules, wildcards, ports, regular expressions
- [Engines](../README.md#engines): what `inspect` and `universal` each enforce on (the deprecated `explicit` engine has [its own page](./explicit-engine.md))
- [CA trust and compatibility](../README.md#ca-trust-and-compatibility): the CA variables `inspect` sets, and what it cannot work with
- [Report action](../README.md#report-action): the Job Summary, its inputs, and failing the job on blocked connections
