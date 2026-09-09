import { journal } from './state.js';
import { criterionApplies } from './criteria.js';

/**
 * P1-2: Pre-Stage Context Audit.
 *
 * A missing fact is cheapest to catch before work starts and most expensive to
 * catch at the gate — a full rework cycle. The stages that do real design and
 * build work therefore carry a short audit: pointed "did you read X, did you
 * check Y" questions the agent must answer through `hermit_context_audit`
 * before `hermit_request_handoff` will let the stage advance. The answers, and
 * any gap the agent flags, are journalled so a feedback loop can see over time
 * which items actually catch real gaps.
 *
 * This is not a judgement of quality — like exit criteria it is mechanical. It
 * only refuses a handoff when a required item was never answered, and it never
 * inspects *what* the agent answered. An item answered `confirmed: false` is a
 * gap the agent has declared, recorded and surfaced, not a blocker: a stage
 * that starts knowing what it is missing is the point.
 *
 * Audit items may be conditional. `when` is evaluated against the same run
 * facts as a conditional exit criterion (`criteriaContext` in engine.js —
 * `monorepo`, `backend`, `ui`, `tracker`); `whenAttempt: 'reentry'` restricts
 * an item to attempts after the first, where reviewer feedback is in play.
 */
export const STAGE_AUDITS = {
  architecture: [
    { id: 'read-requirements', question: 'Read the full requirements-spec and every acceptance criterion, not just the summary?' },
    { id: 'read-index', question: 'Read codebase-map — the Index and Module Boundaries — for what already exists to reuse or extend rather than rebuild?' },
    { id: 'checked-constraints', question: 'Checked project-context Known Constraints, and any ADRs, for decisions this design must not contradict?' },
    { id: 'user-flow', question: 'Settled the user flow end to end, so the UX stages can draw screens against it?', when: { ui: true } },
    { id: 'reviewer-feedback', question: 'Re-read the reviewer feedback from the last attempt and listed every change it asks for?', whenAttempt: 'reentry' }
  ],
  planning: [
    { id: 'read-architecture', question: 'Read the ratified architecture-spec, including the section for each side that will be built?' },
    { id: 'read-impact', question: 'Read impact-analysis — blast radius, risks, rollback — so the plan sequences around them?' },
    { id: 'traced-acs', question: 'Confirmed every acceptance criterion maps to at least one work package?' },
    { id: 'read-ux', question: 'Read ux-hifi so interface packages match the approved screens and tokens?', when: { ui: true } }
  ],
  implementation_ui: [
    { id: 'read-design-section', question: 'Read the architecture-spec ## Frontend Design section addressed to you before the rest of the spec?' },
    { id: 'read-surrounding-code', question: 'Read the surrounding code — naming, error handling, layering, test style — for each area you will touch?' },
    { id: 'mapped-acs', question: 'Mapped each work package to the acceptance criteria it satisfies?' },
    { id: 'design-tokens', question: 'Located the named design tokens and components in ux-hifi you are expected to use?', when: { ui: true } },
    { id: 'monorepo-scope', question: 'Confirmed which projects are in scope and found each one\'s own test command?', when: { monorepo: true } },
    { id: 'reviewer-feedback', question: 'Identified every change the reviewer feedback from the last attempt asks for?', whenAttempt: 'reentry' }
  ],
  implementation_backend: [
    { id: 'read-design-section', question: 'Read the architecture-spec ## Backend Design section addressed to you before the rest of the spec?' },
    { id: 'read-contract-gaps', question: 'Read change-set-ui ## Contract Gaps first — the interface was built before you and flagged what the contract did not promise?' },
    { id: 'read-surrounding-code', question: 'Read the surrounding code — naming, error handling, layering, test style — for each area you will touch?' },
    { id: 'mapped-acs', question: 'Mapped each work package to the acceptance criteria it satisfies?' },
    { id: 'monorepo-scope', question: 'Confirmed which projects are in scope and found each one\'s own test command?', when: { monorepo: true } },
    { id: 'reviewer-feedback', question: 'Identified every change the reviewer feedback from the last attempt asks for?', whenAttempt: 'reentry' }
  ],
  ux_lofi: [
    { id: 'read-user-flow', question: 'Read architecture-spec ## User Flow — the screens are drawn against the ratified flow, not invented alongside it?' },
    { id: 'read-requirements', question: 'Read the requirements-spec and acceptance criteria for what each screen has to let a user do?' },
    { id: 'unhappy-paths', question: 'Noted the empty, error, loading and unauthorised states each screen needs, not only the happy path?' }
  ]
};

/** Does this run have an audit for this stage at all? */
export function stageHasAudit(stageId) {
  return Array.isArray(STAGE_AUDITS[stageId]) && STAGE_AUDITS[stageId].length > 0;
}

/**
 * The audit items that actually apply to this stage for this run and attempt.
 * Conditional items whose `when` does not hold, and reentry-only items on a
 * first attempt, are dropped — the same discipline the output contract uses so
 * a brief never asks for something the handoff check will not.
 */
export function auditForStage(stageId, { context = {}, attempt = 1 } = {}) {
  const items = STAGE_AUDITS[stageId] ?? [];
  return items.filter((item) => {
    if (item.whenAttempt === 'reentry' && attempt <= 1) return false;
    if (item.when && !criterionApplies({ when: item.when }, context)) return false;
    return true;
  });
}

/** The audit record for a given stage attempt, if one has been submitted. */
export function getContextAudit(run, stageId, attempt) {
  return (run.contextAudits ?? []).find((a) => a.stageId === stageId && a.attempt === attempt) ?? null;
}

/**
 * Where a stage attempt stands against its audit.
 * `required` — an applicable audit exists for this attempt.
 * `satisfied` — every applicable item has an answer on record.
 * `missing` — applicable item ids with no answer yet.
 * `gaps` — items the agent answered `confirmed: false`, with the note it gave.
 */
export function contextAuditStatus(run, stageId, { context = {}, attempt = 1 } = {}) {
  const items = auditForStage(stageId, { context, attempt });
  if (!items.length) return { required: false, satisfied: true, missing: [], gaps: [], items: [] };

  const record = getContextAudit(run, stageId, attempt);
  const answered = new Map((record?.findings ?? []).map((f) => [f.id, f]));
  const missing = items.filter((i) => !answered.has(i.id)).map((i) => i.id);
  const gaps = items
    .filter((i) => answered.get(i.id)?.confirmed === false)
    .map((i) => ({ id: i.id, question: i.question, note: answered.get(i.id).note ?? null }));

  return { required: true, satisfied: missing.length === 0, missing, gaps, items };
}

/**
 * Record an agent's answers to the pre-stage audit for the current attempt.
 *
 * Every applicable item must be answered — a partial audit is refused with the
 * ids still outstanding, exactly as a handoff is refused for a failing exit
 * criterion. `confirmed` is a boolean per item; `note` is optional context and
 * is expected on any item answered `false`. Re-submitting for the same attempt
 * replaces the earlier record (an agent that went back and did the reading).
 */
export function recordContextAudit(paths, run, { stageId, attempt = 1, agentId = null, findings = [], context = {} }) {
  const items = auditForStage(stageId, { context, attempt });
  if (!items.length) {
    throw new Error(`Stage "${stageId}" has no context audit for this attempt — nothing to record.`);
  }

  const byId = new Map((Array.isArray(findings) ? findings : []).map((f) => [f?.id, f]));
  const unknown = [...byId.keys()].filter((id) => !items.some((i) => i.id === id));
  if (unknown.length) {
    throw new Error(
      `Unknown audit item(s) for "${stageId}": ${unknown.join(', ')}. ` +
        `Expected: ${items.map((i) => i.id).join(', ')}`
    );
  }
  const outstanding = items.filter((i) => {
    const f = byId.get(i.id);
    return !f || typeof f.confirmed !== 'boolean';
  });
  if (outstanding.length) {
    throw new Error(
      `Context audit incomplete — answer every item with a boolean \`confirmed\`. ` +
        `Still outstanding: ${outstanding.map((i) => i.id).join(', ')}`
    );
  }

  const normalised = items.map((i) => {
    const f = byId.get(i.id);
    return {
      id: i.id,
      confirmed: f.confirmed === true,
      note: typeof f.note === 'string' && f.note.trim() ? f.note.trim() : null
    };
  });
  const gapItems = normalised.filter((f) => !f.confirmed);

  const record = {
    stageId,
    attempt,
    agentId: agentId ?? null,
    recordedAt: new Date().toISOString(),
    findings: normalised
  };
  run.contextAudits ??= [];
  const idx = run.contextAudits.findIndex((a) => a.stageId === stageId && a.attempt === attempt);
  if (idx >= 0) run.contextAudits[idx] = record;
  else run.contextAudits.push(record);

  // Ids and gap flags only — the feedback loop needs which items were asked and
  // which the agent could not confirm, not a copy of every note.
  journal(paths, run.id, {
    event: 'context.audited',
    stage: stageId,
    agent: agentId ?? null,
    attempt,
    items: normalised.map((f) => f.id),
    gaps: gapItems.map((f) => f.id)
  });

  return { record, gaps: gapItems.map((f) => ({ id: f.id, note: f.note })) };
}

/** Render the audit as the block the stage brief carries. */
export function renderContextAuditSection(stageId, { context = {}, attempt = 1 } = {}) {
  const items = auditForStage(stageId, { context, attempt });
  if (!items.length) return '';

  const out = [];
  out.push('## Before you start: context audit');
  out.push('');
  out.push(
    'Answer each item below with `hermit_context_audit` **before** you request handoff. ' +
      'A missing fact caught here costs nothing; the same fact caught at the gate costs a full ' +
      'rework cycle. Answer `confirmed: true` once you have genuinely done the thing, or ' +
      '`confirmed: false` with a short note naming the gap — a `false` is not a blocker, it is a ' +
      'gap you have surfaced and can now design around or escalate.'
  );
  out.push('');
  for (const item of items) out.push(`- [ ] \`${item.id}\` — ${item.question}`);
  out.push('');
  out.push(
    'Call: `hermit_context_audit { agent, findings: [{ id, confirmed, note? }, …] }`. ' +
      'The handoff is refused until every item here has an answer.'
  );
  out.push('');
  return out.join('\n');
}

/**
 * Feedback loop (ticket step 3): which audit items catch real gaps, aggregated
 * over the runs given. `askedCount` is how often an item was put to an agent;
 * `gapCount` how often the agent answered it `false`. A high gap rate is a
 * signal the item is pulling its weight; a permanent zero is a candidate to
 * drop. Reads the journal `context.audited` events already written per attempt.
 */
export function auditFindingsSummary(runs = []) {
  const byItem = new Map();
  const bump = (id, key) => {
    if (!byItem.has(id)) byItem.set(id, { id, askedCount: 0, gapCount: 0 });
    byItem.get(id)[key] += 1;
  };
  for (const run of runs) {
    for (const audit of run.contextAudits ?? []) {
      for (const f of audit.findings ?? []) {
        bump(f.id, 'askedCount');
        if (f.confirmed === false) bump(f.id, 'gapCount');
      }
    }
  }
  return [...byItem.values()]
    .map((r) => ({ ...r, gapRate: r.askedCount ? Math.round((r.gapCount / r.askedCount) * 100) : 0 }))
    .sort((a, b) => b.gapRate - a.gapRate || b.askedCount - a.askedCount);
}
