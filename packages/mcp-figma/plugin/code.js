/**
 * Hermit Design Bridge — Figma plugin main thread.
 *
 * The WebSocket lives in ui.html because Figma's main thread has no network
 * access. This file receives commands over postMessage and builds the scene.
 */
figma.showUI(__html__, { width: 320, height: 220 });

figma.ui.postMessage({
  type: 'context',
  fileKey: figma.fileKey || null,
  fileName: figma.root.name,
  user: figma.currentUser ? figma.currentUser.name : null
});

figma.ui.onmessage = async (msg) => {
  if (msg.type !== 'command') return;
  const { id, command, payload } = msg;
  try {
    if (command !== 'createDesign') throw new Error('Unknown command: ' + command);
    const result = await createDesign(payload);
    figma.ui.postMessage({ type: 'result', id, ok: true, result });
  } catch (err) {
    figma.ui.postMessage({ type: 'result', id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};

async function createDesign({ page, frames }) {
  const target = findOrCreatePage(page);
  figma.currentPage = target;

  const variables = await collectVariables();
  const created = [];
  let cursorX = 0;

  for (const spec of frames) {
    const frame = figma.createFrame();
    frame.name = spec.name;
    frame.resize(spec.width || 1440, spec.height || 900);
    frame.x = cursorX;
    frame.y = 0;
    cursorX += frame.width + 120;

    if (spec.layout) applyLayout(frame, spec.layout, variables);
    for (const child of spec.children || []) {
      const node = await buildNode(child, variables);
      if (node) frame.appendChild(node);
    }
    target.appendChild(frame);
    created.push({ id: frame.id, name: frame.name });
  }

  figma.viewport.scrollAndZoomIntoView(created.map((c) => figma.getNodeById(c.id)).filter(Boolean));
  return { page: target.name, pageId: target.id, frames: created, unresolvedTokens: variables.unresolved };
}

function findOrCreatePage(name) {
  const existing = figma.root.children.filter((p) => p.name === name)[0];
  if (existing) return existing;
  const p = figma.createPage();
  p.name = name;
  return p;
}

/** Build a token-name → variable lookup so specs never carry literal values. */
async function collectVariables() {
  const map = {};
  try {
    const all = await figma.variables.getLocalVariablesAsync();
    for (const v of all) map[v.name] = v;
  } catch (e) {
    /* older API or restricted plan — fall through to unresolved */
  }
  return { map: map, unresolved: [] };
}

function bindToken(node, field, tokenName, variables) {
  const v = variables.map[tokenName];
  if (!v) {
    if (variables.unresolved.indexOf(tokenName) === -1) variables.unresolved.push(tokenName);
    return false;
  }
  try {
    node.setBoundVariable(field, v);
    return true;
  } catch (e) {
    if (variables.unresolved.indexOf(tokenName) === -1) variables.unresolved.push(tokenName);
    return false;
  }
}

function applyLayout(node, layout, variables) {
  if (layout.mode) node.layoutMode = layout.mode;
  if (typeof layout.spacing === 'number') node.itemSpacing = layout.spacing;
  else if (typeof layout.spacing === 'string') bindToken(node, 'itemSpacing', layout.spacing, variables);
  if (typeof layout.padding === 'number') {
    node.paddingTop = node.paddingBottom = node.paddingLeft = node.paddingRight = layout.padding;
  }
  if (layout.align) node.counterAxisAlignItems = layout.align;
  if (layout.justify) node.primaryAxisAlignItems = layout.justify;
}

async function buildNode(spec, variables) {
  if (spec.type === 'INSTANCE' && spec.componentKey) {
    const component = await figma.importComponentByKeyAsync(spec.componentKey);
    const instance = component.createInstance();
    if (spec.name) instance.name = spec.name;
    if (spec.overrides) applyOverrides(instance, spec.overrides);
    return instance;
  }

  if (spec.type === 'TEXT') {
    const text = figma.createText();
    const family = spec.fontFamily || 'Inter';
    const style = spec.fontStyle || 'Regular';
    await figma.loadFontAsync({ family: family, style: style });
    text.fontName = { family: family, style: style };
    text.characters = spec.characters || '';
    if (spec.name) text.name = spec.name;
    if (spec.color) bindToken(text, 'fills', spec.color, variables);
    return text;
  }

  if (spec.type === 'FRAME' || spec.type === 'GROUP') {
    const frame = figma.createFrame();
    frame.name = spec.name || 'Frame';
    if (spec.width || spec.height) frame.resize(spec.width || 100, spec.height || 100);
    if (spec.layout) applyLayout(frame, spec.layout, variables);
    if (spec.fill) bindToken(frame, 'fills', spec.fill, variables);
    for (const child of spec.children || []) {
      const node = await buildNode(child, variables);
      if (node) frame.appendChild(node);
    }
    return frame;
  }

  if (spec.type === 'RECTANGLE') {
    const rect = figma.createRectangle();
    rect.name = spec.name || 'Rectangle';
    rect.resize(spec.width || 100, spec.height || 100);
    if (spec.fill) bindToken(rect, 'fills', spec.fill, variables);
    return rect;
  }

  return null;
}

function applyOverrides(instance, overrides) {
  const texts = instance.findAll((n) => n.type === 'TEXT');
  for (const key of Object.keys(overrides)) {
    const match = texts.filter((t) => t.name === key)[0] || texts[0];
    if (!match) continue;
    figma.loadFontAsync(match.fontName).then(() => { match.characters = String(overrides[key]); });
  }
}
