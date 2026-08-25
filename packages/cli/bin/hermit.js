#!/usr/bin/env node
import {
  cmdInit, cmdSync, cmdStart, cmdStatus, cmdRuns, cmdNext,
  cmdGate, cmdResume, cmdArtifacts, cmdJournal, cmdDoctor, cmdProjects, cmdOnboard, cmdSecurity
} from '../src/commands.js';

const HELP = `
hermit — agentic SDLC pipeline for GitHub Copilot and Claude Code workspaces

  Setup
    hermit init [--force]              install agents and host configs into this workspace
        --harness <a,b>                copilot (default) · claude — remembered after the first run
    hermit sync [--force]              recompile .hermit/ into your harness's formats
        --onboard / --no-onboard       answer the onboarding prompt without being asked
    hermit doctor                      check configuration, credentials and pipeline integrity
    hermit projects                    list the projects in this repo and how they were classified
    hermit onboard [--status]          map the codebase — once per repo, outside any run
    hermit security [--status]         dependency map + code scan — once per repo, outside any run

  Runs
    hermit start "<intent>"            begin a run
        --jira <KEY>                   link a tracker item
        --project <a,b>                target specific projects in a monorepo
        --no-ui                        skip the three UX stages
        --skip <a,b>                   stand stages down: ux, planning, qa, docs, pr, …
        --with <a,b>                   turn on an off-by-default stage: security, tracker
        --title "<title>"

      The intent is read for the same instructions, so the sentence is usually
      enough:  hermit start "add cart persistence, skip the UX designs and no PR"
               hermit start "harden the upload path, and run a security scan"

      Requirements, architecture, review and delivery carry human gates and
      cannot be skipped by either route. Asking prints why and continues.
    hermit status [--run <id>]         where the run stands
    hermit runs                        list runs
    hermit next [--json]               print the current stage brief
    hermit resume [<run-id>]           reopen a blocked run

  Human gates
    hermit gate list                   what is waiting on you
    hermit gate approve [<gate-id>]    approve and advance
    hermit gate changes <gate-id> -m   send the stage back with a reason
    hermit gate reject <gate-id> -m    reject and block the run

  Inspect
    hermit artifacts [<name>]          list artifacts, or print one
    hermit journal [--limit n]         the run's audit trail

  Gate decisions are recorded against you (git user.name, or --by "<name>").
  No agent can approve a gate — that is the point.
`;

function parse(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else { opts[key] = next; i++; }
    } else if (a === '-m') {
      opts.message = argv[++i];
    } else if (a === '-h') {
      opts.help = true;
    } else {
      positional.push(a);
    }
  }
  if (opts.limit) opts.limit = Number(opts.limit);
  return { positional, opts };
}

const { positional, opts } = parse(process.argv.slice(2));
const [command, ...rest] = positional;

if (!command || opts.help || command === 'help') {
  console.log(HELP);
  process.exit(0);
}

const commands = {
  init: () => cmdInit(opts),
  onboard: () => cmdOnboard(opts),
  security: () => cmdSecurity(opts),
  sync: () => cmdSync(opts),
  doctor: () => cmdDoctor(opts),
  projects: () => cmdProjects(opts),
  start: () => cmdStart(rest.join(' '), opts),
  status: () => cmdStatus(opts),
  runs: () => cmdRuns(opts),
  next: () => cmdNext(opts),
  gate: () => cmdGate(rest[0], rest[1], opts),
  resume: () => cmdResume(rest[0], opts),
  artifacts: () => cmdArtifacts(rest[0], opts),
  journal: () => cmdJournal(opts)
};

const run = commands[command];
if (!run) {
  console.error(`\n  Unknown command "${command}".\n${HELP}`);
  process.exit(1);
}

try {
  await run();
} catch (err) {
  console.error(`\n  \x1b[31mError:\x1b[0m ${err.message}\n`);
  if (process.env.HERMIT_DEBUG) console.error(err.stack);
  process.exit(1);
}
