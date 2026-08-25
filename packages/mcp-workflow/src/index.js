#!/usr/bin/env node
import { z } from 'zod';
import { main, runServer } from '@hermit/mcp-shared';
import { workspaceRoot } from '@hermit/mcp-shared';
import {
  layout,
  loadRegistry,
  DEFAULT_PIPELINE,
  createRun,
  loadRun,
  requireActiveRun,
  activeRunId,
  listRuns,
  saveRun,
  readJournal,
  nextTask,
  submitArtifact,
  requestHandoff,
  runStatus,
  readArtifact,
  openGates,
  getGate,
  getStage,
  decideGate,
  resolveDecider,
  onboardingStatus,
  writeOnboardingArtifact,
  readOnboardingArtifact,
  setOnboardingStatus,
  outputContract,
  renderBundle,
  ONBOARDING_ARTIFACTS,
  ONBOARDING_STATUS,
  checkOnboardingArtifact,
  securityStatus,
  writeSecurityArtifact,
  setSecurityStatus,
  SECURITY_ARTIFACTS,
  SECURITY_STATUS,
  checkSecurityArtifact,
  MANIFEST_FILES,
  parseDirectives,
  resolveTargets,
  resolveProjects,
  readJson
} from '@hermit/core';
import fs from 'node:fs';
import path from 'node:path';

const paths = layout(workspaceRoot());

function registry() {
  return loadRegistry(paths);
}

/** Dependency manifests present at the repo root, for the baseline staleness check. */
function manifestPaths() {
  return MANIFEST_FILES.map((f) => path.join(paths.root, f)).filter((f) => fs.existsSync(f));
}

/**
 * Every mutating tool reloads the run from disk. Two Copilot surfaces may be
 * driving the same run; in-memory state would diverge silently.
 */
function withRun(fn) {
  const run = requireActiveRun(paths);
  const result = fn(run, registry());
  return result;
}

const INSTRUCTIONS = `Hermit workflow ledger.

This server stores pipeline state; it makes no decisions. The orchestrator agent
decides what happens next — ask this server what the state IS, never what it
should be.

Normal agent loop:
  1. hermit_next_task      receive your stage brief and the context you may use
  2. hermit_submit_artifact  once per declared output
  3. hermit_request_handoff  ask to advance

Gates are human-only. A person can decide one from a terminal at any time
("hermit gate approve <id>"), or the orchestrator can call hermit_decide_gate
from chat — but only in the same turn a human has explicitly said what to
decide, and only after they confirm the call when the host asks. Role agents
never see that tool; if a gate is open and you are not the orchestrator, stop
and report it.`;

const tools = [
  {
    name: 'hermit_status',
    title: 'Run status',
    description:
      'Current run: stage, progress, per-stage status, open gates and artifacts produced. ' +
      'The single source of truth for where a run stands — never infer stage from conversation history.',
    readOnly: true,
    input: { runId: z.string().optional().describe('Defaults to the active run') },
    handler: ({ runId }) => {
      const id = runId ?? activeRunId(paths);
      if (!id) {
        return {
          state: 'no_active_run',
          message: 'No active Hermit run. A human starts one with: hermit start "<intent>" [--jira PROJ-123]',
          recentRuns: listRuns(paths).slice(0, 5).map((r) => ({ id: r.id, title: r.title, status: r.status }))
        };
      }
      return runStatus({ paths, run: loadRun(paths, id) });
    }
  },
  {
    name: 'hermit_next_task',
    title: 'Next task',
    description:
      'Receive the brief for the current stage: your playbook, the scoped context bundle you are ' +
      'entitled to, and the output contract. Returns awaiting_gate instead if a human decision is pending.',
    input: {
      agent: z.string().optional().describe('Your agent id, to verify you own this stage'),
      format: z.enum(['markdown', 'json']).optional().describe('markdown (default) returns the rendered brief')
    },
    handler: ({ agent, format = 'markdown' }) =>
      withRun((run, reg) => {
        const task = nextTask({ paths, run, registry: reg });
        if (task.state !== 'task') return { state: task.state, message: task.message, gate: task.gate ?? null };

        if (agent && agent !== task.agent.id) {
          return {
            state: 'wrong_agent',
            message:
              `Stage "${task.stage.id}" belongs to "${task.agent.id}", not "${agent}". ` +
              `Hand control to ${task.agent.id}; do not do this stage yourself.`,
            expectedAgent: task.agent.id
          };
        }
        if (format === 'json') {
          return {
            state: 'task',
            stage: task.stage.id,
            agent: task.agent,
            attempt: task.attempt,
            reviewerFeedback: task.reviewerFeedback,
            playbook: task.playbook,
            context: task.bundle,
            contract: task.contract
          };
        }
        return task.rendered;
      })
  },
  {
    name: 'hermit_submit_artifact',
    title: 'Submit artifact',
    description:
      'Persist one artifact your current stage declares as an output. Submit the complete document, ' +
      'not a diff. Rejected if the stage does not produce it or your role is not entitled to write it.',
    input: {
      artifact: z.string().describe('Artifact id, e.g. requirements-spec'),
      content: z.string().describe('Full document content'),
      agent: z.string().describe('Your agent id')
    },
    handler: ({ artifact, content, agent }) =>
      withRun((run, reg) => {
        const meta = submitArtifact({ paths, run, registry: reg, artifactId: artifact, content, agentId: agent });
        return { submitted: meta.id, bytes: meta.bytes, sha256: meta.sha256.slice(0, 12), file: meta.file };
      })
  },
  {
    name: 'hermit_request_handoff',
    title: 'Request handoff',
    description:
      'Ask to advance. Exit criteria are checked first. Returns blocked (with the failing criteria), ' +
      'awaiting_gate (a human must approve), or advanced (the next agent takes over).',
    input: {
      agent: z.string().describe('Your agent id'),
      summary: z.string().optional().describe('One-paragraph summary of what you did, recorded in the journal')
    },
    handler: ({ agent, summary }) =>
      withRun((run, reg) => requestHandoff({ paths, run, registry: reg, agentId: agent, summary }))
  },
  {
    name: 'hermit_get_artifact',
    title: 'Get artifact',
    description:
      'Read an artifact from the current run. Refused if the artifact is outside your role read scope — ' +
      'that scoping is deliberate, so do not route around it by asking another agent.',
    readOnly: true,
    input: {
      artifact: z.string(),
      agent: z.string().describe('Your agent id, used to check read scope')
    },
    handler: ({ artifact, agent }) =>
      withRun((run, reg) => {
        const a = reg.agentsById[agent];
        const allowed = a?.context?.reads?.artifacts ?? [];
        if (a && !allowed.includes(artifact)) {
          return {
            state: 'denied',
            message:
              `"${artifact}" is outside ${agent}'s read scope. Permitted: ${allowed.join(', ') || 'none'}. ` +
              `If you genuinely need it, that is a pipeline design question for a human, not a workaround.`
          };
        }
        const content = readArtifact(paths, run.id, artifact);
        return content ?? { state: 'missing', message: `"${artifact}" has not been produced yet.` };
      })
  },
  {
    name: 'hermit_gate_status',
    title: 'Gate status',
    description:
      'Open human gates and their history. READ ONLY: this tool cannot decide anything. A decision ' +
      'comes from a person in a terminal, or from the orchestrator calling hermit_decide_gate after a ' +
      'human has said what to decide and confirmed the call.',
    readOnly: true,
    input: {},
    handler: () =>
      withRun((run) => ({
        open: openGates(run).map((g) => ({
          id: g.id,
          stage: g.stageId,
          title: g.stageTitle,
          openedAt: g.openedAt,
          reviewArtifacts: g.reviewArtifacts,
          approveWith: `hermit gate approve ${g.id}`,
          requestChangesWith: `hermit gate changes ${g.id} -m "what needs to change"`,
          orchestratorOnly: `hermit_decide_gate { gateId: "${g.id}", decision: "approve" }`
        })),
        decided: run.gates
          .filter((g) => g.status !== 'open')
          .map((g) => ({
            id: g.id, stage: g.stageId, decision: g.decision,
            by: g.decidedBy, at: g.decidedAt, comment: g.comment, source: g.source ?? 'cli'
          }))
      }))
  },
  {
    name: 'hermit_decide_gate',
    title: 'Decide a gate — orchestrator only, requires human confirmation',
    description:
      'Approve, request changes on, or reject an open gate, from chat instead of a terminal. This is ' +
      'not a shortcut for your own judgement: call it only in the same turn a human has explicitly told ' +
      'you what to decide and why. The host will ask them to confirm before it runs — that confirmation ' +
      'is the human decision Hermit records, not anything you inferred. Reachable by the orchestrator ' +
      'only; a role agent that finds an open gate reports it and stops instead.',
    destructive: true,
    input: {
      gateId: z.string().optional().describe('Defaults to the single open gate, if there is exactly one'),
      decision: z.enum(['approve', 'changes_requested', 'reject']).describe('What the human told you to do'),
      comment: z.string().optional().describe('Required for changes_requested and reject; the human\'s reason'),
      decidedBy: z.string().optional().describe('The human\'s name. Defaults to the workspace git identity'),
      agent: z.string().describe('Must be "orchestrator" — role agents cannot decide a gate')
    },
    handler: ({ gateId, decision, comment, decidedBy, agent }) =>
      withRun((run) => {
        if (agent !== 'orchestrator') {
          return {
            state: 'denied',
            message:
              'Only the orchestrator decides a gate. If you are a role agent, stop and report the ' +
              'open gate to the orchestrator instead of trying to resolve it yourself.'
          };
        }
        const open = openGates(run);
        const target = gateId ?? (open.length === 1 ? open[0].id : null);
        if (!target) {
          return open.length
            ? { state: 'ambiguous', message: `Multiple gates are open: ${open.map((g) => g.id).join(', ')}. Name one.` }
            : { state: 'no_open_gate', message: 'No gate is currently open.' };
        }
        if (!getGate(run, target)) {
          return { state: 'not_found', message: `Gate "${target}" not found in this run.` };
        }

        const by = resolveDecider(paths.root, decidedBy);
        if (!by) {
          return { state: 'denied', message: 'Could not determine who is deciding. Ask the human for their name and pass decidedBy.' };
        }

        let gate;
        try {
          gate = decideGate(paths, run, target, decision, { decidedBy: by, comment: comment ?? null, source: 'chat' });
        } catch (err) {
          return { state: 'refused', message: err.message };
        }
        saveRun(paths, run);

        return {
          decided: gate.id,
          decision: gate.decision,
          by: gate.decidedBy,
          message: `${gate.decision} recorded for "${gate.stageTitle}" via chat, decided by ${by}.`
        };
      })
  },
  {
    name: 'hermit_list_agents',
    title: 'List agents',
    description: 'Every agent in this workspace, the stages it owns, and what it is entitled to read and write.',
    readOnly: true,
    input: {},
    handler: () =>
      registry().agents.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        stages: a.stages,
        reads: a.context?.reads?.artifacts ?? [],
        writes: a.context?.writes?.artifacts ?? [],
        mcpTools: a.context?.reads?.mcp ?? []
      }))
  },
  {
    name: 'hermit_get_agent',
    title: 'Get agent playbook',
    description:
      'Full playbook for an agent, with its skills and knowledge packs inlined. Use this on hosts that ' +
      'do not load .github/agents files — the playbook is the same text either way.',
    readOnly: true,
    input: { agent: z.string() },
    handler: ({ agent }) => {
      const reg = registry();
      const a = reg.agentsById[agent];
      if (!a) {
        return { state: 'not_found', message: `No agent "${agent}". Known: ${reg.agents.map((x) => x.id).join(', ')}` };
      }
      const packs = [...(a.skills ?? []).map((id) => reg.skillsById[id]), ...(a.knowledge ?? []).map((id) => reg.knowledgeById[id])].filter(Boolean);
      return [
        `# ${a.name}`,
        '',
        `**Role**: ${a.role}`,
        `**Stages**: ${a.stages.join(', ') || 'none'}`,
        '',
        a.playbook,
        ...packs.flatMap((p) => ['', `---`, '', `## Pack: ${p.name}`, '', p.body])
      ].join('\n');
    }
  },
  {
    name: 'hermit_journal',
    title: 'Run journal',
    description: 'Append-only audit trail: stage transitions, artifact submissions and gate decisions with timestamps.',
    readOnly: true,
    input: { runId: z.string().optional(), limit: z.number().optional() },
    handler: ({ runId, limit = 100 }) => {
      const id = runId ?? activeRunId(paths);
      if (!id) return { state: 'no_active_run' };
      return readJournal(paths, id).slice(-limit);
    }
  },
  {
    name: 'hermit_start_run',
    title: 'Start run',
    description:
      'Begin a new pipeline run. Prefer having a human run "hermit start" so intent is recorded deliberately; ' +
      'use this only when the user has clearly asked you to begin new work.',
    input: {
      intent: z.string().describe('What is being built, in the user own words'),
      title: z.string().optional(),
      jiraKey: z.string().optional().describe('Tracker key, e.g. PROJ-412'),
      flags: z.array(z.string()).optional().describe('e.g. ["no-ui"] to skip the three UX stages'),
      skip: z.array(z.string()).optional().describe(
        'Stages to stand down, e.g. ["ux","pr"]. Only ever pass what the user actually asked for. ' +
        'Requirements, architecture, review and delivery carry human gates and are refused.'
      ),
      with: z.array(z.string()).optional().describe(
        'Off-by-default stages to turn on: "security" (dependency and CVE scan), "tracker" (epic/stories/tasks).'
      )
    },
    handler: ({ intent, title, jiraKey, flags = [], skip = [], with: include = [] }) => {
      // The intent sentence is read the same way `hermit start` reads it, so a run
      // begun by an agent and one begun by a person land on the same scope.
      const parsed = parseDirectives(intent);
      const explicitSkip = resolveTargets(skip, { action: 'skip' });
      const explicitWith = resolveTargets(include, { action: 'include' });

      const run = createRun(paths, {
        title: title ?? intent.slice(0, 80),
        intent,
        jiraKey: jiraKey ?? null,
        flags,
        skip: [...parsed.skip, ...explicitSkip.stages],
        include: [...parsed.include, ...explicitWith.stages],
        directives: [...parsed.decisions, ...explicitSkip.decisions, ...explicitWith.decisions],
        registry: registry()
      });
      const stage = getStage(DEFAULT_PIPELINE, run.currentStage);
      // The specialist that will actually take the stage, not the pipeline default.
      const agent = run.stages[stage?.id]?.agent ?? stage?.agent;
      const refused = [...parsed.refused, ...explicitSkip.refused];
      const skipped = Object.entries(run.stages).filter(([, v]) => v.status === 'skipped').map(([k]) => k);

      return {
        runId: run.id,
        firstStage: stage?.id,
        firstAgent: agent,
        skippedStages: skipped,
        refusedSkips: refused,
        message:
          `Run ${run.id} created. Call hermit_next_task to receive the ${agent} brief.` +
          (refused.length
            ? `\n\nRefused: ${refused.map((r) => `${r.target} (${r.reason})`).join('; ')}. ` +
              'These stages carry human gates and cannot be skipped. Tell the user plainly rather than trying another route.'
            : '')
      };
    }
  },
  {
    name: 'hermit_onboarding_task',
    title: 'Onboarding brief',
    description:
      'The project onboarding brief. Onboarding is not a pipeline stage — it maps the repository ' +
      'once and every run reads the result. Call this only when asked to onboard the project.',
    input: {},
    handler: () => {
      const state = onboardingStatus(paths);
      const agent = registry().agentsById.onboarding;
      if (!agent) return { error: 'No onboarding agent is installed in this workspace.' };

      if (state.complete) {
        return {
          status: state.status,
          complete: true,
          artifacts: state.present,
          message:
            'This repository is already onboarded. Re-run only if the codebase has drifted ' +
            'materially; submitting again overwrites the existing map.'
        };
      }

      const contract = {
        outputs: ONBOARDING_ARTIFACTS.map((id) => ({ id, required: true })),
        exitCriteria: []
      };
      return {
        status: state.status,
        complete: false,
        missing: state.missing,
        agent: { id: agent.id, name: agent.name, role: agent.role },
        playbook: agent.playbook,
        contract,
        message:
          `Produce ${state.missing.join(', ')} and submit each with hermit_submit_onboarding. ` +
          'There is no stage and no gate; when all three exist onboarding is complete.'
      };
    }
  },
  {
    name: 'hermit_submit_onboarding',
    title: 'Submit onboarding artifact',
    description:
      'Record one onboarding artifact for the repository. These live outside any run, in ' +
      '.hermit/onboarding/, because onboarding is mapped once and read by every run.',
    input: {
      artifact: z.enum(['project-context', 'codebase-map', 'glossary']),
      content: z.string().describe('The full markdown body'),
      agent: z.string().optional()
    },
    handler: ({ artifact, content, agent }) => {
      // Same discipline as a stage handoff: refuse structurally incomplete work
      // with the reason, rather than storing it and surprising the next reader.
      const monorepo = resolveProjects(paths.root, readJson(paths.config, {})).monorepo;
      const check = checkOnboardingArtifact(artifact, content, { monorepo });
      if (!check.ok) {
        return {
          submitted: null,
          accepted: false,
          failed: check.failed,
          message:
            `Refused — ${check.failed.length} check(s) not met:\n` +
            check.failed.map((f) => `  - ${f.id}: ${f.detail}`).join('\n')
        };
      }
      const meta = writeOnboardingArtifact(paths, artifact, content, agent ?? 'onboarding');
      const state = onboardingStatus(paths);
      return {
        submitted: artifact,
        sha256: meta.sha256,
        bytes: meta.bytes,
        complete: state.complete,
        missing: state.missing,
        message: state.complete
          ? 'Onboarding complete. Every run in this repository now reads these three documents.'
          : `Recorded. Still missing: ${state.missing.join(', ')}.`
      };
    }
  },
  {
    name: 'hermit_security_task',
    title: 'Security baseline brief',
    description:
      'The repository security baseline brief — the dependency map and the one-time code scan. ' +
      'These live outside any run, like onboarding. Call this only when asked to run `hermit security`. ' +
      'For the per-run CVE scan use hermit_next_task instead; that is a pipeline stage.',
    input: {},
    handler: () => {
      const state = securityStatus(paths, { manifests: manifestPaths() });
      const agent = registry().agentsById.security;
      if (!agent) return { error: 'No security agent is installed in this workspace.' };

      if (state.complete && !state.stale) {
        return {
          status: state.status,
          complete: true,
          artifacts: state.present,
          message:
            'This repository already has a security baseline. Re-run only if dependencies or the ' +
            'codebase have moved materially; submitting again overwrites the existing baseline.'
        };
      }

      return {
        status: state.status,
        complete: false,
        stale: state.stale,
        missing: state.missing,
        agent: { id: agent.id, name: agent.name, role: agent.role },
        playbook: agent.playbook,
        contract: { outputs: SECURITY_ARTIFACTS.map((id) => ({ id, required: true })), exitCriteria: [] },
        message:
          (state.stale
            ? 'A dependency manifest is newer than the recorded map — the baseline is out of date. '
            : '') +
          `Produce ${(state.missing.length ? state.missing : SECURITY_ARTIFACTS).join(', ')} and submit each ` +
          'with hermit_submit_security. There is no stage and no gate here.'
      };
    }
  },
  {
    name: 'hermit_submit_security',
    title: 'Submit security baseline artifact',
    description:
      'Record one repository-level security artifact. These live in .hermit/security/, outside any run, ' +
      'because they describe the repository rather than a change. The per-run cve-report goes through ' +
      'hermit_submit_artifact instead.',
    input: {
      artifact: z.enum(['dependency-map', 'security-baseline']),
      content: z.string().describe('The full markdown body'),
      agent: z.string().optional()
    },
    handler: ({ artifact, content, agent }) => {
      const monorepo = resolveProjects(paths.root, readJson(paths.config, {})).monorepo;
      const check = checkSecurityArtifact(artifact, content, { monorepo });
      if (!check.ok) {
        return {
          submitted: null,
          accepted: false,
          failed: check.failed,
          message:
            `Refused — ${check.failed.length} check(s) not met:\n` +
            check.failed.map((f) => `  - ${f.id}: ${f.detail}`).join('\n')
        };
      }
      const meta = writeSecurityArtifact(paths, artifact, content, agent ?? 'security');
      const state = securityStatus(paths, { manifests: manifestPaths() });
      return {
        submitted: artifact,
        sha256: meta.sha256,
        bytes: meta.bytes,
        complete: state.complete,
        missing: state.missing,
        message: state.complete
          ? 'Security baseline complete. Every run that opts into the security stage now reads these.'
          : `Recorded. Still missing: ${state.missing.join(', ')}.`
      };
    }
  }
];

main(() => runServer({ name: 'hermit-workflow', version: '0.1.0', instructions: INSTRUCTIONS, tools }));
