# Refactor the widget parser

Status: ready-for-agent

## What to build

Extract the widget parsing logic into its own module with proper error handling.

## Acceptance criteria

- [ ] Widget parser is a separate module
- [ ] Error cases return typed errors, not thrown exceptions
- [ ] Existing tests still pass
