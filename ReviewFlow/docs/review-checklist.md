# Review Checklist

Use this checklist when reviewing AI-generated or unfamiliar backend changes with ReviewFlow.

## Endpoint Behavior

- Confirm the selected endpoint or use case is the intended review target.
- Check which controller, service, and repository functions are reached.
- Verify graph items can point back to source files and lines.

## Data Reads

- List every table/model read by the endpoint.
- Check whether reads happen before required validation or permission checks.
- Watch for surprising extra reads that may indicate wrong business scope.

## Data Writes

- List every table/model created, updated, deleted, or upserted.
- Confirm the write targets match the requirement.
- Check whether writes happen inside the expected transaction boundary.
- Flag writes that occur before a branch that can still fail.

## Branches and Errors

- Review validation, guard clauses, permission checks, and domain rules.
- Confirm each rejection path returns or throws the expected error.
- Check whether exception paths leave partial side effects.

## Side Effects

- Identify external API calls, emails, notifications, queues, files, and events.
- Confirm side effects happen at the correct time relative to DB writes.
- Check retry, rollback, or compensation behavior where applicable.

## AI Coding Risk Checks

- Did the change read or write the wrong table/model?
- Did it skip an existing validation or permission check?
- Did it add a new side effect without an obvious requirement?
- Did it move code across a transaction boundary?
- Did it hide behavior in helper functions that the graph cannot resolve?
- Did it introduce a raw SQL or dynamic Prisma access pattern that the analyzer may miss?
