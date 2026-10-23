import { render, renderWarnings } from './render';
import type { ToSandbox, ToUI } from './types';

figma.showUI(__html__, { width: 360, height: 440, themeColors: true });

const post = (m: ToUI) => figma.ui.postMessage(m);

figma.ui.onmessage = async (msg: ToSandbox) => {
  if (!msg || msg.type !== 'render') return;
  try {
    const { node, count } = await render(msg.payload.root);
    const c = figma.viewport.center;
    node.x = Math.round(c.x - node.width / 2);
    node.y = Math.round(c.y - node.height / 2);
    figma.currentPage.appendChild(node);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    const n = msg.payload.warnings.length + renderWarnings.length;
    figma.notify(`Created ${count} layers` + (n ? ` · ${n} warnings` : ''));
    post({ type: 'done', nodeCount: count, warnings: renderWarnings.slice() });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
