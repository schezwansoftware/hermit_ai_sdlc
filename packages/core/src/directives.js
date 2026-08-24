/**
 * Reading run scope out of the sentence the user already typed.
 *
 * `hermit start "add cart persistence, skip the UX designs and don't open a PR"`
 * should not need three more flags to say what the sentence already said. This
 * module turns that sentence into a set of stages to stand down and a set to
 * turn on, and — this is the part that matters — records *which words* produced
 * each decision, so `hermit start` can print it back and the journal can hold it.
 *
 * Two rules keep this from becoming a way to talk the pipeline out of its job:
 *
 * 1. **Matching is mechanical.** Cue words and aliases, matched at word
 *    boundaries. No model reads this string and decides what the user "meant",
 *    so the same intent always produces the same run shape and a reviewer can
 *    check the decision by reading the table below.
 *
 * 2. **A stage with a human gate is `required` and cannot be skipped here.**
 *    Requirements, architecture, review and delivery are refused with a reason
 *    rather than silently ignored. A gate a sentence can dissolve is not a gate,
 *    and those four are the ones Hermit's whole claim rests on.
 *
 * Scope is decided once, at run creation, from the intent as written. Nothing
 * re-parses it mid-run: an agent cannot widen its own scope by rephrasing.
 */

/**
 * @typedef {Object} DirectiveTarget
 * @property {string} id            Stable name, usable with --skip / --with
 * @property {string[]} stages      Stage ids this target controls
 * @property {'default-on'|'default-off'|'required'} mode
 * @property {string} label         How it is described back to the user
 * @property {string} [reason]      Why a `required` target refuses to stand down
 * @property {string[]} aliases     Phrases that name it in prose
 */

/**
 * The vocabulary. Aliases are matched longest-first, so "backend implementation"
 * resolves to the services stage rather than to the broader "backend", and
 * "design doc" resolves to architecture rather than to the UX stages.
 *
 * @type {DirectiveTarget[]}
 */
export const DIRECTIVE_TARGETS = [
  {
    id: 'requirements',
    stages: ['requirements'],
    mode: 'required',
    label: 'Requirements analysis',
    reason: 'every later stage is measured against the spec it produces',
    aliases: ['requirements', 'requirement', 'specification', 'the spec', 'acceptance criteria', 'requirements analysis']
  },
  {
    id: 'architecture',
    stages: ['architecture'],
    mode: 'required',
    label: 'Technical architecture',
    reason: 'it carries a human gate',
    aliases: ['architecture', 'architectural', 'design doc', 'design document', 'adr', 'architecture stage']
  },
  {
    id: 'ux',
    stages: ['ux_lofi', 'ux_midfi', 'ux_hifi'],
    mode: 'default-on',
    label: 'the three UX stages',
    aliases: [
      'ux', 'ux design', 'ux designs', 'ux stage', 'ux stages', 'ux work',
      'design', 'designs', 'design stage', 'design stages',
      'wireframe', 'wireframes', 'wireframing', 'mockup', 'mockups',
      'lofi', 'midfi', 'hifi', 'low fidelity', 'mid fidelity', 'high fidelity'
    ]
  },
  {
    id: 'ux_lofi',
    stages: ['ux_lofi'],
    mode: 'default-on',
    label: 'UX — low fidelity',
    aliases: ['low fidelity ux', 'lofi ux', 'lo-fi wireframes']
  },
  {
    id: 'ux_midfi',
    stages: ['ux_midfi'],
    mode: 'default-on',
    label: 'UX — mid fidelity',
    aliases: ['mid fidelity ux', 'midfi ux', 'mid-fi wireframes']
  },
  {
    id: 'ux_hifi',
    stages: ['ux_hifi'],
    mode: 'default-on',
    label: 'UX — high fidelity',
    aliases: ['high fidelity ux', 'hifi ux', 'visual design', 'design tokens']
  },
  {
    // The umbrella `--no-ui` has always meant: no interface to design *and* none
    // to build. Prose that says "no UI" means the same thing.
    id: 'ui',
    stages: ['ux_lofi', 'ux_midfi', 'ux_hifi', 'implementation_ui'],
    mode: 'default-on',
    label: 'everything interface-related',
    aliases: ['ui', 'the ui', 'interface', 'front end', 'front-end', 'frontend']
  },
  {
    id: 'planning',
    stages: ['planning'],
    mode: 'default-on',
    label: 'Work breakdown',
    aliases: ['planning', 'the plan', 'work plan', 'work breakdown', 'breakdown', 'planning stage']
  },
  {
    id: 'tracker',
    stages: ['tracker'],
    mode: 'default-off',
    label: 'Tracker items (epic, stories, tasks)',
    aliases: [
      'epic', 'epics', 'create an epic', 'create epics',
      'stories', 'user stories', 'create stories', 'jira stories',
      'story breakdown', 'break into stories', 'stories and tasks',
      'subtasks', 'sub-tasks', 'jira tickets', 'tracker items'
    ]
  },
  {
    id: 'implementation_ui',
    stages: ['implementation_ui'],
    mode: 'default-on',
    label: 'Implementation — interface',
    aliases: [
      'ui implementation', 'ui impl', 'implementation_ui', 'interface implementation',
      'frontend implementation', 'frontend impl', 'front-end implementation',
      'building the ui', 'ui build'
    ]
  },
  {
    id: 'implementation_backend',
    stages: ['implementation_backend'],
    mode: 'default-on',
    label: 'Implementation — services',
    aliases: [
      'backend implementation', 'backend impl', 'implementation_backend', 'backend_impl',
      'services implementation', 'service implementation', 'server implementation',
      'backend', 'back-end', 'server side', 'server-side', 'building the backend', 'backend build'
    ]
  },
  {
    id: 'security',
    stages: ['security'],
    mode: 'default-off',
    label: 'Dependency and vulnerability scan',
    aliases: [
      'security scan', 'security review', 'security check', 'security audit', 'security pass',
      'cve', 'cve scan', 'cve check', 'vulnerability scan', 'vulnerability check',
      'dependency scan', 'dependency audit', 'dependency check',
      'audit dependencies', 'scan dependencies', 'check dependencies'
    ]
  },
  {
    id: 'review',
    stages: ['review'],
    mode: 'required',
    label: 'Code review',
    reason: 'it carries a human gate',
    aliases: ['review', 'code review', 'peer review', 'the review']
  },
  {
    id: 'qa',
    stages: ['qa'],
    mode: 'default-on',
    label: 'QA and verification',
    aliases: ['qa', 'test', 'tests', 'testing', 'test plan', 'verification', 'qa stage']
  },
  {
    id: 'documentation',
    stages: ['documentation'],
    mode: 'default-on',
    label: 'Documentation update',
    aliases: ['docs', 'doc', 'documentation', 'documenting', 'the docs', 'doc update']
  },
  {
    id: 'delivery',
    stages: ['delivery'],
    mode: 'required',
    label: 'Delivery sign-off',
    reason: 'it carries a human gate',
    aliases: ['delivery', 'sign off', 'sign-off', 'signoff', 'release notes', 'delivery stage']
  },
  {
    id: 'pull_request',
    stages: ['pull_request'],
    mode: 'default-on',
    label: 'Pull request',
    aliases: [
      'pr', 'the pr', 'a pr', 'pull request', 'pull-request', 'pullrequest',
      'merge request', 'opening a pr', 'open a pr', 'create a pr', 'creating a pr', 'raise a pr'
    ]
  }
];

export const TARGETS_BY_ID = Object.fromEntries(DIRECTIVE_TARGETS.map((t) => [t.id, t]));

/**
 * Phrases that turn a stage name into an instruction to stand it down.
 *
 * Deliberately narrow: something must actually read as a refusal. "add a review
 * comment endpoint" contains "review" but no cue, so the review stage stays.
 */
export const NEGATION_CUES = [
  'do not', "don't", 'dont', 'no need for', 'no need to', 'not needed',
  'skip', 'skipping', 'without', 'omit', 'omitting', 'exclude', 'excluding',
  'bypass', 'leave out', 'leaving out', 'drop', 'dropping', 'no', 'none of',
  'never mind', 'forget'
];

/** How far past a cue an alias still counts as governed by it. */
const WINDOW = 72;

/** Sentence boundaries end a cue's reach — a new clause is a new instruction. */
const TERMINATORS = /[.;!?\n]/;

/**
 * Phrases that also end a cue's reach, because they turn the sentence around.
 *
 * "...don't open a PR, but run a security scan" is two instructions, and without
 * this the second one sits inside the first one's window and is read as part of
 * the refusal. Plain "and" is deliberately absent — "skip ux and qa" is one
 * instruction covering two stages, and that has to keep working.
 */
const TURN_PHRASES = [
  'but', 'however', 'though', 'although', 'yet', 'instead', 'otherwise', 'whereas',
  'plus', 'as well as',
  'and run', 'and create', 'and add', 'and also', 'and include', 'and raise',
  'and write', 'and open', 'and do', 'also run', 'also create', 'also add'
];

function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every word-boundary occurrence of `phrase` in `text`, as [start, end) spans. */
function spansOf(text, phrase) {
  const re = new RegExp(`(?<![a-z0-9])${escapeRe(phrase)}(?![a-z0-9])`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push([m.index, m.index + m[0].length]);
    re.lastIndex = m.index + 1;
  }
  return out;
}

/**
 * The stretch of text a cue governs: from just after the cue to the end of the
 * clause, capped at WINDOW characters.
 *
 * The clause ends at sentence punctuation or at whichever turn phrase comes
 * first — whichever of the two is nearer.
 */
function windowAfter(text, end) {
  const slice = text.slice(end, end + WINDOW);

  let stop = slice.search(TERMINATORS);
  if (stop === -1) stop = slice.length;
  for (const phrase of TURN_PHRASES) {
    const at = spansOf(slice, phrase)[0];
    if (at && at[0] < stop) stop = at[0];
  }
  return { text: slice.slice(0, stop), offset: end };
}

/**
 * Which targets does this stretch of text name?
 *
 * Longest match wins: a span contained inside a longer one is dropped, so
 * "ui implementation" does not also fire the broader "ui" target.
 */
function targetsIn(text) {
  const hits = [];
  for (const target of DIRECTIVE_TARGETS) {
    for (const alias of target.aliases) {
      for (const [start, end] of spansOf(text, alias)) hits.push({ target, alias, start, end });
    }
  }
  const kept = hits.filter(
    (h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start)
  );

  const seen = new Set();
  return kept.filter((h) => {
    const key = `${h.target.id}:${h.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every [start, end) span in `text` that sits inside some cue's window. */
function negationWindows(text) {
  const windows = [];
  for (const cue of NEGATION_CUES) {
    for (const [start, end] of spansOf(text, cue)) {
      const w = windowAfter(text, end);
      windows.push({ cue, cueStart: start, from: w.offset, to: w.offset + w.text.length, text: w.text });
    }
  }
  return windows;
}

/**
 * Parse an intent sentence into run scope.
 *
 * @param {string} intent
 * @returns {{
 *   skip: string[],
 *   include: string[],
 *   decisions: Array<{ target:string, label:string, stages:string[], action:'skip'|'include'|'refused', phrase:string, reason?:string }>,
 *   refused: Array<{ target:string, label:string, phrase:string, reason:string }>
 * }}
 */
export function parseDirectives(intent) {
  const text = normalise(intent);
  const decisions = [];
  const skip = new Set();
  const include = new Set();
  const refused = [];
  const negated = negationWindows(text);
  const claimed = new Set();

  // Pass 1 — negations. "skip the ux designs", "don't open a pr", "no backend".
  const decided = new Set();
  for (const w of negated) {
    for (const hit of targetsIn(w.text)) {
      if (decided.has(hit.target.id)) continue;
      decided.add(hit.target.id);
      const phrase = `${w.cue} … ${hit.alias}`;

      if (hit.target.mode === 'required') {
        const entry = { target: hit.target.id, label: hit.target.label, phrase, reason: hit.target.reason };
        refused.push(entry);
        decisions.push({ ...entry, stages: hit.target.stages, action: 'refused' });
        continue;
      }
      for (const s of hit.target.stages) skip.add(s);
      decisions.push({ target: hit.target.id, label: hit.target.label, stages: hit.target.stages, action: 'skip', phrase });
    }
    // Mark the whole window consumed so pass 2 does not read "no security scan"
    // as a request for one.
    for (let i = w.from; i < w.to; i++) claimed.add(`pos:${i}`);
  }

  // Pass 2 — opt-ins. An off-by-default stage turns on when the intent names it
  // outside any negation window.
  for (const hit of targetsIn(text)) {
    if (hit.target.mode !== 'default-off') continue;
    if (claimed.has(`pos:${hit.start}`)) continue;
    if (hit.target.stages.every((s) => include.has(s))) continue;
    for (const s of hit.target.stages) include.add(s);
    decisions.push({
      target: hit.target.id,
      label: hit.target.label,
      stages: hit.target.stages,
      action: 'include',
      phrase: hit.alias
    });
  }

  return { skip: [...skip], include: [...include], decisions, refused };
}

/**
 * Resolve an explicit `--skip a,b` / `--with a,b` list.
 *
 * Accepts target ids, stage ids and any alias, so `--skip pr` and
 * `--skip pull_request` both work. Unknown names throw rather than being
 * ignored: a typo that silently changes nothing is worse than an error.
 */
export function resolveTargets(names = [], { action = 'skip' } = {}) {
  const wanted = (Array.isArray(names) ? names : String(names).split(',')).map((n) => String(n).trim().toLowerCase()).filter(Boolean);
  const stages = new Set();
  const decisions = [];
  const refused = [];
  const unknown = [];

  for (const name of wanted) {
    const target =
      TARGETS_BY_ID[name] ??
      DIRECTIVE_TARGETS.find((t) => t.stages.includes(name)) ??
      DIRECTIVE_TARGETS.find((t) => t.aliases.includes(name));

    if (!target) {
      unknown.push(name);
      continue;
    }
    if (action === 'skip' && target.mode === 'required') {
      const entry = { target: target.id, label: target.label, phrase: `--skip ${name}`, reason: target.reason };
      refused.push(entry);
      decisions.push({ ...entry, stages: target.stages, action: 'refused' });
      continue;
    }
    for (const s of target.stages) stages.add(s);
    decisions.push({ target: target.id, label: target.label, stages: target.stages, action, phrase: `--${action === 'skip' ? 'skip' : 'with'} ${name}` });
  }

  if (unknown.length) {
    throw new Error(
      `Unknown stage name(s): ${unknown.join(', ')}\n  Known: ${DIRECTIVE_TARGETS.map((t) => t.id).join(', ')}`
    );
  }
  return { stages: [...stages], decisions, refused };
}

/** The stage ids a prompt or flag is allowed to stand down. */
export function skippableStages() {
  return [...new Set(DIRECTIVE_TARGETS.filter((t) => t.mode === 'default-on').flatMap((t) => t.stages))];
}

/** The stage ids that are off unless something turns them on. */
export function optInStages() {
  return [...new Set(DIRECTIVE_TARGETS.filter((t) => t.mode === 'default-off').flatMap((t) => t.stages))];
}
