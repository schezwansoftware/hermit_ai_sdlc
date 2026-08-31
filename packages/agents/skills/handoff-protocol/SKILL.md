---
name: handoff-protocol
description: The three-call contract every Hermit agent follows to receive work, submit output and advance.
metadata:
  hermit: true
  title: Handoff protocol
---

You never call another agent. You call the workflow server, and the orchestrator routes.

## The three calls

```
hermit_next_task                      receive your brief + scoped context
hermit_submit_artifact  <id> <body>   write one declared output
hermit_request_handoff                ask to advance
```

## Receiving work

`hermit_next_task` returns your playbook, your context bundle, and your output contract. That bundle is **all** the context you are entitled to. If something you want is listed under `withheld`, it is out of your role's scope — do not ask another agent or the human to paste it in. If something under `missingInputs` is genuinely required, that is an upstream gap: say so and request handoff, which will fail with a precise reason. That failure is the signal, and it is more useful than you improvising.

## Submitting

One call per artifact. Submit the complete document, not a diff or a patch. The server rejects artifacts your stage does not declare and artifacts your role is not entitled to write — a rejection means you have misread your contract, not that you should retry with different wording.

## Requesting handoff

Three possible answers:

| Answer | Meaning | What you do |
|---|---|---|
| `blocked` | An exit criterion failed | Read the named failures, fix them, submit again |
| `awaiting_gate` | Criteria passed; a human must approve | **Stop.** Report the gate id and the CLI command |
| `advanced` | Criteria passed; run moved on | You are done. Do not start the next stage |

**Always pass `thinking` on the call that gets you `awaiting_gate` or `advanced`.** Hermit has no other way to know why you made the choices you made — there is no channel from your reasoning to the journal except what you write down yourself. A short paragraph: what you chose, what you considered and rejected, and anything you are genuinely unsure of. This is what a human debugging this stage reads through `hermit_trace` when the result looks wrong later; an empty `thinking` field is a debugging session with nothing to go on.

## Rules

- Exit criteria are mechanical, not a judgement of quality. Passing them means your output is structurally complete, nothing more.
- Never decide a gate on your own judgement. If you are a role agent, you have no tool that can. If you are the orchestrator, `hermit_decide_gate` exists but only relays a decision a human just gave you explicitly, in this conversation — it is never a stand-in for your own read that the work looks ready, and the host will ask them to confirm before it runs.
- Never write another agent's artifact, even if you can see what it should say.
- If you are sent back with reviewer feedback, address it explicitly in the resubmission. Silent resubmission of the same content wastes a full cycle.
