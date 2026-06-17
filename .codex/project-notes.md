# Codex Project Notes

## Project Context

ReviewFlow is a planned business dataflow review tool. It will analyze backend business code and turn endpoint behavior into a replayable graph for faster code review, onboarding, bug investigation, and impact analysis.

## Current Stage

The project is in setup stage. The current repository contents should be documentation and tracking files only.

## Default MVP Stack

- Backend target for analysis: Node.js endpoint code using Prisma
- UI direction: React with SVG or Canvas graph rendering
- Initial precision target: table/model-level read/write operations
- Required trust feature: every graph node or edge that comes from source code should include source location where possible

## Workspace Boundary

All edits must stay inside `D:\dev\ReviewFlow`. The git root is `D:\dev`, and parent directories may contain unrelated changes. Do not modify, clean, reset, or revert files outside this project directory.

## Skill Usage

- Use the Browser in-app browser skill when validating future local React UI behavior, screenshots, console logs, or interactions.
- Do not use Documents, Spreadsheets, Presentations, or GitHub skills unless a future task explicitly needs them.
- If publishing to GitHub or opening a PR is requested later, load the GitHub/yeet workflow first.
