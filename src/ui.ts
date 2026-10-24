import { convert } from './parse';
import { CHECKS_COMMAND, checksReport, testImage } from './checksUi';
import type { ConvertResult, IRNode, ToUI } from './types';

const KEY = 'paste-to-layers:last';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const code = $<HTMLTextAreaElement>('code');
const editor = $('editor');
const btn = $<HTMLButtonElement>('convert');
const clearBtn = $<HTMLButtonElement>('clear');
const statusEl = $('status');
const statusMsg = statusEl.querySelector('.msg') as HTMLElement;
const warnBox = $<HTMLDetailsElement>('warnings');
const warnCount = $('warnCount');
const warnList = $('warnList');

const EXAMPLE = `export default function Card() {
  return (
    <div className="flex flex-col gap-4 p-6 w-80 bg-white rounded-2xl shadow-lg border border-gray-200">
      <div className="w-full h-32 bg-gray-200 rounded-xl" />
      <h2 className="text-xl font-bold text-gray-900">Mountain retreat</h2>
      <p className="text-sm text-gray-500 leading-relaxed">
        A quiet cabin with a <b>view of the valley</b>.
      </p>
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold text-indigo-600">$240</span>
        <button className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg">Book now</button>
      </div>
    </div>
  );
}
`;

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
if (!isMac) btn.querySelector('kbd')!.textContent = 'Ctrl+↵';

type Kind = 'idle' | 'ok' | 'error' | 'busy';
function setStatus(kind: Kind, msg: string) {
  statusEl.dataset.kind = kind;
  statusMsg.textContent = msg;
  if (kind === 'error' && /\(\d+:\d+\)\s*$/.test(msg)) statusEl.title = 'Click to jump to this spot';
  else statusEl.removeAttribute('title');
}

function showWarnings(warnings: string[]) {
  warnList.textContent = '';
  if (!warnings.length) { warnBox.hidden = true; return; }
  warnCount.textContent = `${warnings.length} thing${warnings.length === 1 ? '' : 's'} won't carry over`;
  for (const w of warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    warnList.appendChild(li);
  }
  warnBox.hidden = false;
}

function countLayers(n: IRNode): number {
  return 1 + (n.kind === 'frame' ? n.children.reduce((a, c) => a + countLayers(c), 0) : 0);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Babel messages end with "(line:col)"; turn that into a caret position. */
function errorOffset(msg: string): number | null {
  const m = /\((\d+):(\d+)\)\s*$/.exec(msg);
  if (!m) return null;
  const lines = code.value.split('\n');
  const line = Math.min(+m[1], lines.length) - 1;
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i].length + 1;
  return off + +m[2];
}

let result: ConvertResult | null = null;
let busy = false;

/** Validate inline while typing so problems surface before the user commits. */
function validate() {
  const src = code.value.trim();
  editor.classList.toggle('has-code', !!src);
  clearBtn.disabled = !src;
  editor.classList.remove('invalid');
  result = null;
  if (!src) {
    setStatus('idle', '');
    showWarnings([]);
  } else if (src === CHECKS_COMMAND) {
    setStatus('idle', 'Press Create layers to run the built-in checks (about 15 seconds)');
    showWarnings([]);
    btn.disabled = busy;
    return;
  } else {
    try {
      result = convert(src);
      setStatus('idle', `${result.root.name} · ${plural(countLayers(result.root), 'layer')}`);
      showWarnings(result.warnings);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      editor.classList.add('invalid');
      setStatus('error', msg);
      showWarnings([]);
    }
  }
  btn.disabled = busy || !result;
}

let frame = 0;
function scheduleValidate() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(validate);
}

function save() {
  try { localStorage.setItem(KEY, code.value); } catch { /* storage unavailable in some Figma contexts */ }
}

try { code.value = localStorage.getItem(KEY) || ''; } catch { /* ignore */ }
validate();
if (!code.value) code.focus();

code.addEventListener('input', () => { save(); scheduleValidate(); });

function setCode(v: string) {
  code.value = v;
  save();
  validate();
  code.focus();
  code.setSelectionRange(0, 0);
  code.scrollTop = 0;
}

$('example').addEventListener('click', () => setCode(EXAMPLE));
clearBtn.addEventListener('click', () => setCode(''));

// Clicking an error moves the caret to where the parser stopped.
statusEl.addEventListener('click', () => {
  if (statusEl.dataset.kind !== 'error') return;
  const off = errorOffset(statusMsg.textContent || '');
  if (off === null) return;
  code.focus();
  code.setSelectionRange(off, off);
});

let checkImage: Uint8Array | null = null;

async function runChecks() {
  busy = true;
  btn.disabled = true;
  setStatus('busy', 'Running checks…');
  checkImage = await testImage();
  parent.postMessage({ pluginMessage: { type: 'checks', image: checkImage } }, '*');
}

function run() {
  if (busy) return;
  if (code.value.trim() === CHECKS_COMMAND) { void runChecks(); return; }
  validate();
  if (!result) {
    if (!code.value.trim()) setStatus('error', 'Paste a component first.');
    return;
  }
  busy = true;
  btn.disabled = true;
  setStatus('busy', 'Creating layers…');
  parent.postMessage({ pluginMessage: { type: 'render', payload: result } }, '*');
}

btn.addEventListener('click', run);
code.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); return; }
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end');
    code.dispatchEvent(new Event('input'));
  }
});

window.onmessage = (ev: MessageEvent) => {
  const msg = ev.data && (ev.data.pluginMessage as ToUI | undefined);
  if (!msg) return;
  busy = false;
  btn.disabled = !result;
  if (msg.type === 'checks') {
    setStatus('busy', 'Comparing with the browser…');
    checksReport(msg.results, checkImage!).then((report) => {
      code.value = report;
      editor.classList.add('has-code');
      code.select();
      setStatus('ok', 'Checks done. The report is selected above; copy it.');
      showWarnings([]);
    }, (e) => setStatus('error', 'Checks failed: ' + String(e)));
    return;
  }
  if (msg.type === 'done') {
    setStatus('ok', `Added ${plural(msg.nodeCount, 'layer')} to the canvas`);
    const all = [...(result?.warnings ?? []), ...(msg.warnings ?? [])];
    showWarnings(all);
  } else {
    setStatus('error', msg.message);
  }
};
