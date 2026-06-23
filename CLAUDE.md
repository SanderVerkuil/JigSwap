# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

These guidelines blend a practical "reduce mistakes" checklist with Andrej Karpathy's framing of working with LLMs: English is now a programming interface (Software 3.0), the model is a capable but **fallible collaborator with jagged intelligence** — superhuman in places, prone to basic mistakes in others — and your job is to keep it on a **tight leash** inside a fast **generation → verification loop** that you, the human, stay in control of.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 0. The Generation–Verification Loop

**You own the code. The loop is the unit of work — not the diff.**

Karpathy's core insight: an LLM is a fast _generator_, but value only lands when each generation is _verified_. Optimize the whole loop, not just generation speed.

- **Keep each generation small** so verification stays fast and complete. A 50-line change you can fully check beats a 500-line change you skim.
- **Make verification cheap and concrete** before generating: a failing test, a type error, a visible UI state, a command whose output you can read.
- **Read every line you ship.** "Looks plausible" is not verified. If you can't verify it, you can't claim it works.
- **Don't chase autonomy past your ability to verify.** Going faster than you can check just produces bugs faster.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

The model has jagged intelligence — confident and wrong is a real failure mode. Counter it by making your reasoning legible _before_ you act.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- Prefer the **concrete and specific** over the abstract. "Add a `quantity` field to the swap form and validate it's ≥ 1" beats "improve the swap form." Specific asks are easier to generate and far easier to verify.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

Less code is also less to verify. Every line you don't write is a line you don't have to read, test, or maintain.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

This is what "tight leash" means in practice: small, reviewable, intentional diffs the human can fully hold in their head.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals — this is what makes the generation–verification loop run:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Match Autonomy to the Task (the Autonomy Slider)

**Choose how much to do per turn based on how well you can verify it.**

Karpathy's "autonomy slider": don't run fully autonomous on everything, and don't ask permission for everything either. Calibrate.

- **High autonomy** — well-specified, well-tested, low-blast-radius changes (e.g. a pure function with tests, a mechanical rename). Generate, verify, proceed.
- **Low autonomy / check in often** — ambiguous requirements, schema/migration/auth changes, anything hard to reverse or hard to verify. Make one small move, show it, confirm direction.
- **Surface the irreversible.** For actions that are hard to undo or outward-facing (deploys, deletes, data migrations, anything that publishes externally), confirm first unless explicitly told to proceed.
- When unsure where the slider sits, slide it toward less autonomy and a shorter loop.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, clarifying questions come before implementation rather than after mistakes, and every "it works" claim is backed by a verification you actually ran.
