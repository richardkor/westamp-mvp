## Code Review Rules (MANDATORY)
Before marking any task as complete, Claude Code must:

1. Re-read every file it created or modified in this session
2. Check for:
   - Hardcoded credentials, IDs, or secrets (must always be in .env)
   - Missing error handling (every API call and Playwright action needs try/catch)
   - Missing TypeScript types (no `any` unless explicitly approved)
   - Console.log statements left in production code (use a proper logger)
   - Incomplete functions (no TODO stubs left unfinished)
   - Anything that would break the existing pipeline layers already built

3. Run the following before finishing:
   - `npx tsc --noEmit` to check TypeScript errors
   - `npm run lint` if ESLint is configured
   - Re-read the task requirement and confirm the code actually does what was asked

4. State explicitly at the end:
   "Code review complete. Files changed: [list]. Issues found and fixed: [list or 'none']."

## General Coding Rules
- Never use `any` in TypeScript without a comment explaining why
- Every .env variable must have a corresponding entry in .env.example
- Every new file must have a comment at the top explaining what it does
- Never delete existing code without asking first — comment it out instead
- Always handle the case where an API returns unexpected data

## Before Writing New Code
- Check if a similar function already exists in the codebase
- If modifying an existing file, read the whole file first, not just the section being changed
- If adding a new dependency, state why it was chosen over alternatives