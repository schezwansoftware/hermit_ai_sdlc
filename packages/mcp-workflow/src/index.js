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
  getStage,
  onboardingStatus,
  writeOnboardingArtifact,
  readOnboardingArtifact,
  setOnboardingStatus,
  outputContract,
  renderBundle,
  ONBOARDING_ARTIFACTS,
  ONBOARDING_STATUS,
  checkOnboardingArtifact,
  resolveProjects,
  readJson
} from '@hermit/core';

const paths = layout(workspaceRoot());

function registry() {
  return loadRegistry(paths);
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

Gates are human-only. There is no tool here that approves one. A human runs
"hermit gate approve <id>" in a terminal. If a gate is open, stop and say so.`;

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
      'Open human gates and their history. READ ONLY BY DESIGN — no tool in this server can approve ' +
      'a gate. Approval happens when a person runs the Hermit CLI.',
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
          requestChangesWith: `hermit gate changes ${g.id} -m "what needs to change"`
        })),
        decided: run.gates
          .filter((g) => g.status !== 'open')
          .map((g) => ({ id: g.id, stage: g.stageId, decision: g.decision, by: g.decidedBy, at: g.decidedAt, comment: g.comment }))
      }))
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
      flags: z.array(z.string()).optional().describe('e.g. ["no-ui"] to skip the three UX stages')
    },
    handler: ({ intent, title, jiraKey, flags = [] }) => {
      const run = createRun(paths, { title: title ?? intent.slice(0, 80), intent, jiraKey: jiraKey ?? null, flags, registry: registry() });
      const stage = getStage(DEFAULT_PIPELINE, run.currentStage);
      // The specialist that will actually take the stage, not the pipeline default.
      const agent = run.stages[stage?.id]?.agent ?? stage?.agent;
      return {
        runId: run.id,
        firstStage: stage?.id,
        firstAgent: agent,
        message: `Run ${run.id} created. Call hermit_next_task to receive the ${agent} brief.`
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
  }
];

main(() => runServer({ name: 'hermit-workflow', version: '0.1.0', instructions: INSTRUCTIONS, tools }));
