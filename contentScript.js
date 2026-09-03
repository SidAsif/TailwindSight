let panelEl;
window.__tw_selectedEl = null;
let lastHovered = null;
let inspectEnabled = false;
let highlightBox;
let undoStack = [];
let redoStack = [];

let tailwindClasses = [];

fetch(chrome.runtime.getURL("tailwind-classes.json"))
  .then((res) => res.json())
  .then((data) => {
    tailwindClasses = data;
  })
  // Only on genuine failure — autocomplete is empty, the rest still works.
  .catch((err) => console.error("TailwindSight: failed to load classes JSON", err));

// On load, check stored state
chrome.storage.local.get("isInspecting", (result) => {
  inspectEnabled = result.isInspecting || false;
  if (inspectEnabled) createRuler();
});

// Handle toggle messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TOGGLE_INSPECT_MODE") {
    inspectEnabled = message.payload;
    if (inspectEnabled) {
      createRuler();
    } else {
      removeHighlight();
      removePanel();
      removeRuler();
    }
  }
});

// ── Breakpoints ───────────────────────────────────────────────────────────
// Single source of truth for the ruler, the debugger and the AI context.
// Read from the page's own stylesheets where possible so projects with a
// custom `screens` config get real numbers instead of Tailwind's defaults.

const TW_DEFAULT_BREAKPOINTS = [
  { name: 'xs',  min: 0    },
  { name: 'sm',  min: 640  },
  { name: 'md',  min: 768  },
  { name: 'lg',  min: 1024 },
  { name: 'xl',  min: 1280 },
  { name: '2xl', min: 1536 },
];

// Variant prefixes that are not breakpoints, so a rule like `.dark\:flex`
// nested in a min-width query can't be mistaken for one.
const TW_NON_BP_PREFIXES = new Set([
  'hover','focus','active','visited','disabled','checked','required','invalid',
  'group','peer','dark','light','print','portrait','landscape','motion','rtl',
  'ltr','first','last','odd','even','only','empty','target','open','supports',
  'has','not','before','after','placeholder','file','marker','selection',
]);

let _bpCache = null;

function rootFontSize() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

// Browsers re-serialise selectors with CSS escapes: `.2xl\:grid` comes back as
// `.\32 xl\:grid` because an identifier can't start with a digit. Decode those
// hex escapes, but keep the escaped colon in `\:` form — matching on it is what
// stops a genuine pseudo-class like `.card:hover` being read as a prefix.
function decodeSelector(sel) {
  return sel
    .replace(/\\3a\s?/gi, '\\:')
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    );
}

// Walk the page's CSS looking for `.<prefix>\:` selectors inside min-width
// media queries. Tailwind emits exactly that shape, so the first match for a
// prefix gives us its real breakpoint — v4 sizes these in rem, hence the
// conversion. Cross-origin sheets throw on .cssRules and are skipped.
// Lower bound of a media condition, or null if it doesn't set one. v3 emits
// `(min-width: 640px)`; v4 emits range syntax, `(width >= 40rem)` — matching
// only the former found nothing at all on a v4 page.
function parseMinWidth(cond, rem) {
  const toPx = (val, unit) =>
    unit.toLowerCase() === 'px' ? parseFloat(val) : Math.round(parseFloat(val) * rem);

  let m = /min-width:\s*([\d.]+)(px|rem|em)/i.exec(cond);
  if (m) return toPx(m[1], m[2]);

  m = /\bwidth\s*>=\s*([\d.]+)(px|rem|em)/i.exec(cond);
  if (m) return toPx(m[1], m[2]);

  m = /\bwidth\s*>\s*([\d.]+)(px|rem|em)/i.exec(cond);
  if (m) return Math.ceil(toPx(m[1], m[2]));

  m = /([\d.]+)(px|rem|em)\s*<=\s*width\b/i.exec(cond);
  if (m) return toPx(m[1], m[2]);

  m = /([\d.]+)(px|rem|em)\s*<\s*width\b/i.exec(cond);
  if (m) return Math.ceil(toPx(m[1], m[2]));

  return null;
}

// Parse a CSS length into px. Returns null if it isn't one.
function lengthToPx(value, rem) {
  const m = /^([\d.]+)(px|rem|em)$/.exec((value || '').trim());
  if (!m) return null;
  return m[2].toLowerCase() === 'px'
    ? parseFloat(m[1])
    : Math.round(parseFloat(m[1]) * rem);
}

function scanBreakpoints() {
  const found = {};   // prefixes actually used in the CSS
  const vars = {};    // --breakpoint-* theme variables (Tailwind v4)
  const rem = rootFontSize();

  // Descend through any rule that has children, not just @media. Tailwind v4
  // wraps its utilities in `@layer utilities { @media … }`, and a walker that
  // only recognised @media never reached a single breakpoint rule on a v4 page.
  const visit = (rules, activeMin) => {
    for (const rule of rules) {
      let min = activeMin;

      const cond = rule.conditionText || (rule.media && rule.media.mediaText) || '';
      if (cond) {
        const parsed = parseMinWidth(cond, rem);
        if (parsed !== null) min = parsed;
      }

      if (rule.selectorText && min != null) {
        const selector = decodeSelector(rule.selectorText);
        const re = /\.([a-z0-9]+)\\:/gi;
        let hit;
        while ((hit = re.exec(selector))) {
          const name = hit[1].toLowerCase();
          if (TW_NON_BP_PREFIXES.has(name)) continue;
          if (found[name] === undefined) found[name] = min;
        }
      }

      // Tailwind v4 publishes its theme as custom properties, which lists
      // every breakpoint the config *defines* — including ones the page
      // never uses, and which therefore generate no media query to scan.
      if (rule.style && rule.style.length) {
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          if (!prop.startsWith('--breakpoint-')) continue;
          const name = prop.slice('--breakpoint-'.length).toLowerCase();
          const px = lengthToPx(rule.style.getPropertyValue(prop), rem);
          if (px !== null) vars[name] = px;
        }
      }

      // @layer, @supports, @container and CSS nesting all nest rules here.
      if (rule.cssRules) visit(rule.cssRules, min);
    }
  };

  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet — not readable
    }
    if (rules) visit(rules, null);
  }
  return { found, vars };
}

// Merge three sources, weakest first: Tailwind's defaults, then the media
// queries the page actually emits, then v4's theme variables. Defaults are
// kept as backfill because scanning can only see breakpoints the page *uses*
// — on a site that never writes an `xl:` class, xl generates no CSS, and
// omitting it made the ruler mark a lower breakpoint active at a wide viewport.
function getBreakpoints() {
  if (_bpCache) return _bpCache;

  const { found, vars } = scanBreakpoints();

  const merged = {};
  for (const bp of TW_DEFAULT_BREAKPOINTS) {
    if (bp.min > 0) merged[bp.name] = bp.min;
  }
  Object.assign(merged, found, vars);

  const list = [{ name: 'xs', min: 0 }]
    .concat(Object.keys(merged).map((name) => ({ name, min: merged[name] })))
    .sort((a, b) => a.min - b.min);

  _bpCache = {
    list,
    detected: Object.keys(found).length > 0 || Object.keys(vars).length > 0,
  };
  return _bpCache;
}

// Minimum width for a responsive prefix, or null if it isn't one.
function getBreakpointMin(prefix) {
  const bp = getBreakpoints().list.find((b) => b.name === prefix);
  return bp && bp.min > 0 ? bp.min : null;
}

function getActiveBp(width) {
  const list = getBreakpoints().list;
  let active = list[0];
  for (const bp of list) {
    if (width >= bp.min) active = bp;
  }
  return active;
}

function createRuler() {
  if (document.getElementById('tw-ruler')) return;

  // Re-scan once per inspection session; the page may have loaded more CSS
  // since the last time we looked.
  _bpCache = null;

  const ruler = document.createElement('div');
  ruler.id = 'tw-ruler';
  ruler.innerHTML = `
    <span id="tw-ruler-width"></span>
    <div class="tw-ruler-bps">
      ${getBreakpoints().list.map(bp =>
        `<span class="tw-ruler-bp" data-bp="${bp.name}">
          ${bp.name}${bp.min ? `<em>${bp.min}</em>` : ''}
        </span>`
      ).join('')}
    </div>
  `;
  document.body.appendChild(ruler);
  updateRuler();
}

function updateRuler() {
  const ruler = document.getElementById('tw-ruler');
  if (!ruler) return;
  const width = window.innerWidth;
  const active = getActiveBp(width);
  const widthEl = document.getElementById('tw-ruler-width');
  if (widthEl) widthEl.textContent = `${width}px`;
  ruler.querySelectorAll('.tw-ruler-bp').forEach(el => {
    el.classList.toggle('tw-bp-active', el.dataset.bp === active.name);
  });
}

function removeRuler() {
  const ruler = document.getElementById('tw-ruler');
  if (ruler) ruler.remove();
}
// ── End Breakpoint Ruler ───────────────────────────────────────────────────

function removeHighlight() {
  if (highlightBox) {
    highlightBox.remove();
    highlightBox = null;
  }
}

function removePanel() {
  if (panelEl) {
    panelEl.style.display = "none";
    window.__tw_selectedEl = null;
  }
}

function isInsidePanel(el) {
  return el.closest("#tw-inspector-panel") !== null;
}

function saveState(el) {
  if (!el) return;
  undoStack.push(el.getAttribute("class") || "");
  redoStack = [];
  syncHistoryButtons();
}

// Grey out undo/redo at the ends of the history so they don't look clickable
function syncHistoryButtons() {
  const undoBtn = document.getElementById("tw-undo");
  const redoBtn = document.getElementById("tw-redo");
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function validateTailwindClass(className) {
  // Remove leading/trailing whitespace
  className = className.trim();

  // Empty class is invalid
  if (!className) return false;

  // Remove ! prefix if present (important modifier)
  const classWithoutImportant = className.replace(/^!/, "");

  // Check for opacity modifier (e.g., text-gray-600/90)
  const parts = classWithoutImportant.split("/");
  let baseClass = parts[0];

  // Handle responsive/state prefixes (e.g., md:text-4xl, hover:bg-blue-500, dark:text-white)
  // Multiple prefixes are allowed: md:hover:text-4xl
  const prefixPattern = /^([a-z0-9]+:)+/;
  const coreClass = baseClass.replace(prefixPattern, "");

  // Check if core class exists in tailwindClasses
  if (tailwindClasses.includes(coreClass)) {
    return true;
  }

  // Check if base class (without prefixes) exists
  if (tailwindClasses.includes(baseClass)) {
    return true;
  }

  // Check for arbitrary values (e.g., text-[#123456], w-[100px], md:w-[100px])
  if (coreClass.includes("[") && coreClass.includes("]")) {
    // Extract the prefix before the bracket
    const prefix = coreClass.split("[")[0];
    // Check if any tailwind class starts with this prefix
    return tailwindClasses.some((cls) => cls.startsWith(prefix));
  }

  // Check if the full class (with opacity) exists
  if (tailwindClasses.includes(classWithoutImportant)) {
    return true;
  }

  return false;
}

function highlightElement(el) {
  if (!el) return;
  if (highlightBox) highlightBox.remove();

  const rect = el.getBoundingClientRect();

  highlightBox = document.createElement("div");
  Object.assign(highlightBox.style, {
    position: "absolute",
    top: `${rect.top + window.scrollY}px`,
    left: `${rect.left + window.scrollX}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: "2px solid #6366f1",
    borderRadius: "4px",
    boxShadow: "0 0 0 2px rgba(99, 102, 241, 0.2)",
    pointerEvents: "none",
    zIndex: "99998",
    background: "rgba(99, 102, 241, 0.05)",
    transition: "all 0.15s ease",
  });

  document.body.appendChild(highlightBox);
}

// ── CSS Explainer ──────────────────────────────────────────────────────────
const TW_SP = {
  '0':'0px','px':'1px','0.5':'0.125rem','1':'0.25rem','1.5':'0.375rem',
  '2':'0.5rem','2.5':'0.625rem','3':'0.75rem','3.5':'0.875rem','4':'1rem',
  '5':'1.25rem','6':'1.5rem','7':'1.75rem','8':'2rem','9':'2.25rem',
  '10':'2.5rem','11':'2.75rem','12':'3rem','14':'3.5rem','16':'4rem',
  '20':'5rem','24':'6rem','28':'7rem','32':'8rem','36':'9rem','40':'10rem',
  '44':'11rem','48':'12rem','52':'13rem','56':'14rem','60':'15rem',
  '64':'16rem','72':'18rem','80':'20rem','96':'24rem',
  'auto':'auto','full':'100%','screen':'100vw','min':'min-content','max':'max-content','fit':'fit-content',
};
const TW_FR = {
  '1/2':'50%','1/3':'33.333%','2/3':'66.667%','1/4':'25%','3/4':'75%',
  '1/5':'20%','2/5':'40%','3/5':'60%','4/5':'80%','1/6':'16.667%','5/6':'83.333%',
};

function getTailwindCSS(cls) {
  const m = cls.match(/^((?:[a-z0-9-]+:)+)/);
  const prefix = m ? m[1] : '';
  const core = cls.slice(prefix.length).replace(/^!/, '').split('/')[0];
  const arb = core.match(/^(.+?)-\[(.+)\]$/);
  if (arb) {
    const propMap = {
      'w':'width','h':'height','min-w':'min-width','max-w':'max-width','min-h':'min-height','max-h':'max-height',
      'p':'padding','px':'padding-inline','py':'padding-block','pt':'padding-top','pr':'padding-right','pb':'padding-bottom','pl':'padding-left',
      'm':'margin','mx':'margin-inline','my':'margin-block','mt':'margin-top','mr':'margin-right','mb':'margin-bottom','ml':'margin-left',
      'top':'top','right':'right','bottom':'bottom','left':'left','inset':'inset',
      'text':'font-size','leading':'line-height','tracking':'letter-spacing',
      'gap':'gap','z':'z-index','opacity':'opacity','duration':'transition-duration','delay':'transition-delay',
      'rotate':'transform','scale':'transform','translate-x':'transform','translate-y':'transform',
      'bg':'background-color','border':'border-color','rounded':'border-radius','shadow':'box-shadow',
    };
    const p = propMap[arb[1]];
    if (p) return wrapPrefix(`${p}: ${arb[2]}`, prefix);
  }
  const css = resolveCore(core);
  return css ? wrapPrefix(css, prefix) : null;
}

function wrapPrefix(css, prefix) {
  if (!prefix) return css;
  const bp = { sm:'640px', md:'768px', lg:'1024px', xl:'1280px', '2xl':'1536px' };
  const ctx = prefix.replace(/:$/, '').split(':')
    .map(p => bp[p] ? `@media (min-width: ${bp[p]})` : `${p}:`).join('  ');
  return `${ctx}\n  ${css.replace(/\n/g, '\n  ')}`;
}

function resolveCore(c) {
  const sp = TW_SP, fr = TW_FR;

  // Display
  const disp = { block:'block','inline-block':'inline-block',inline:'inline',flex:'flex','inline-flex':'inline-flex',grid:'grid','inline-grid':'inline-grid',hidden:'none',contents:'contents','flow-root':'flow-root',table:'table' };
  if (disp[c]) return `display: ${disp[c]}`;

  // Position / visibility
  if (['static','relative','absolute','fixed','sticky'].includes(c)) return `position: ${c}`;
  if (c==='visible') return 'visibility: visible';
  if (c==='invisible') return 'visibility: hidden';
  if (c==='sr-only') return 'position: absolute\nwidth: 1px; height: 1px\noverflow: hidden; clip: rect(0,0,0,0)\nwhite-space: nowrap; border: 0';

  // Overflow / z / float / object
  if (c.startsWith('overflow-')) { const v=c.slice(9); if(v.startsWith('x-'))return`overflow-x: ${v.slice(2)}`; if(v.startsWith('y-'))return`overflow-y: ${v.slice(2)}`; return`overflow: ${v}`; }
  if (c.startsWith('z-')) return `z-index: ${c.slice(2)}`;
  if (c.startsWith('float-')) return `float: ${c.slice(6)}`;
  if (c.startsWith('clear-')) return `clear: ${c.slice(6)}`;
  if (c.startsWith('object-')) { const v=c.slice(7); return['contain','cover','fill','none','scale-down'].includes(v)?`object-fit: ${v}`:`object-position: ${v.replace(/-/g,' ')}`; }
  if (c==='aspect-square') return 'aspect-ratio: 1 / 1';
  if (c==='aspect-video') return 'aspect-ratio: 16 / 9';

  // Flexbox
  const flexMap = { 'flex-row':'flex-direction: row','flex-col':'flex-direction: column','flex-row-reverse':'flex-direction: row-reverse','flex-col-reverse':'flex-direction: column-reverse','flex-wrap':'flex-wrap: wrap','flex-nowrap':'flex-wrap: nowrap','flex-wrap-reverse':'flex-wrap: wrap-reverse','flex-1':'flex: 1 1 0%','flex-auto':'flex: 1 1 auto','flex-none':'flex: none','flex-initial':'flex: 0 1 auto',grow:'flex-grow: 1','grow-0':'flex-grow: 0',shrink:'flex-shrink: 1','shrink-0':'flex-shrink: 0' };
  if (flexMap[c]) return flexMap[c];

  // Justify / Align
  const jv = { start:'flex-start',end:'flex-end',center:'center',between:'space-between',around:'space-around',evenly:'space-evenly',stretch:'stretch',baseline:'baseline' };
  if (c.startsWith('justify-items-')) return `justify-items: ${c.slice(14)}`;
  if (c.startsWith('justify-self-')) return `justify-self: ${c.slice(13)}`;
  if (c.startsWith('justify-')) { const v=c.slice(8); return jv[v]?`justify-content: ${jv[v]}`:null; }
  if (c.startsWith('items-')) { const v=c.slice(6); return jv[v]?`align-items: ${jv[v]}`:null; }
  if (c.startsWith('self-')) { const v=c.slice(5); const m={auto:'auto',...jv}; return m[v]?`align-self: ${m[v]}`:null; }
  if (c.startsWith('content-')) { const v=c.slice(8); return jv[v]?`align-content: ${jv[v]}`:null; }

  // Gap / Grid
  if (c.startsWith('gap-x-')) { const v=sp[c.slice(6)]; return v?`column-gap: ${v}`:null; }
  if (c.startsWith('gap-y-')) { const v=sp[c.slice(6)]; return v?`row-gap: ${v}`:null; }
  if (c.startsWith('gap-')) { const v=sp[c.slice(4)]; return v?`gap: ${v}`:null; }
  if (c.startsWith('grid-cols-')) { const v=c.slice(10); return v==='none'?'grid-template-columns: none':`grid-template-columns: repeat(${v}, minmax(0, 1fr))`; }
  if (c.startsWith('grid-rows-')) { const v=c.slice(10); return v==='none'?'grid-template-rows: none':`grid-template-rows: repeat(${v}, minmax(0, 1fr))`; }
  if (c.startsWith('col-span-')) { const v=c.slice(9); return v==='full'?'grid-column: 1 / -1':`grid-column: span ${v} / span ${v}`; }
  if (c.startsWith('row-span-')) return `grid-row: span ${c.slice(9)} / span ${c.slice(9)}`;

  // Padding
  for (const [k,p] of [['px','padding-inline'],['py','padding-block'],['pt','padding-top'],['pr','padding-right'],['pb','padding-bottom'],['pl','padding-left'],['p','padding']]) {
    if (c.startsWith(`${k}-`)) { const v=c.slice(k.length+1); if(sp[v])return`${p}: ${sp[v]}`; }
  }
  // Margin (including negative)
  for (const [k,p] of [['mx','margin-inline'],['my','margin-block'],['mt','margin-top'],['mr','margin-right'],['mb','margin-bottom'],['ml','margin-left'],['m','margin']]) {
    if (c.startsWith(`${k}-`)) { const v=c.slice(k.length+1); if(v==='auto')return`${p}: auto`; if(sp[v])return`${p}: ${sp[v]}`; }
    if (c.startsWith(`-${k}-`)) { const v=c.slice(k.length+2); if(sp[v]&&sp[v]!=='auto')return`${p}: -${sp[v]}`; }
  }
  if (c.startsWith('space-x-')) { const v=sp[c.slice(8)]; return v?`margin-left: ${v}  /* on children */`:null; }
  if (c.startsWith('space-y-')) { const v=sp[c.slice(8)]; return v?`margin-top: ${v}  /* on children */`:null; }

  // Sizing
  if (c.startsWith('w-')) { const v=c.slice(2); if(sp[v])return`width: ${sp[v]}`; if(fr[v])return`width: ${fr[v]}`; if(v==='screen')return'width: 100vw'; }
  if (c.startsWith('min-w-')) { const v=c.slice(6); if(sp[v])return`min-width: ${sp[v]}`; }
  if (c.startsWith('max-w-')) { const mw={none:'none',xs:'20rem',sm:'24rem',md:'28rem',lg:'32rem',xl:'36rem','2xl':'42rem','3xl':'48rem','4xl':'56rem','5xl':'64rem','6xl':'72rem','7xl':'80rem',full:'100%',screen:'100vw',prose:'65ch'}; const v=c.slice(6); if(mw[v])return`max-width: ${mw[v]}`; }
  if (c.startsWith('h-')) { const v=c.slice(2); if(sp[v])return`height: ${sp[v]}`; if(fr[v])return`height: ${fr[v]}`; if(v==='screen')return'height: 100vh'; }
  if (c.startsWith('min-h-')) { const v=c.slice(6); const m={full:'100%',screen:'100vh',fit:'fit-content','0':'0px'}; if(m[v])return`min-height: ${m[v]}`; }
  if (c.startsWith('max-h-')) { const v=c.slice(6); if(sp[v])return`max-height: ${sp[v]}`; if(v==='screen')return'max-height: 100vh'; }
  if (c.startsWith('size-')) { const v=c.slice(5); const s=sp[v]||fr[v]; if(s)return`width: ${s}\nheight: ${s}`; if(v==='full')return'width: 100%\nheight: 100%'; }

  // Inset
  for (const [k,p] of [['inset-x','left, right'],['inset-y','top, bottom'],['inset','inset'],['top','top'],['right','right'],['bottom','bottom'],['left','left']]) {
    if (c.startsWith(`${k}-`)) { const v=c.slice(k.length+1); if(v==='auto')return`${p}: auto`; if(sp[v])return`${p}: ${sp[v]}`; if(fr[v])return`${p}: ${fr[v]}`; }
  }

  // Typography
  const fsz = {xs:'0.75rem (12px)',sm:'0.875rem (14px)',base:'1rem (16px)',lg:'1.125rem (18px)',xl:'1.25rem (20px)','2xl':'1.5rem (24px)','3xl':'1.875rem (30px)','4xl':'2.25rem (36px)','5xl':'3rem (48px)','6xl':'3.75rem (60px)','7xl':'4.5rem (72px)','8xl':'6rem (96px)','9xl':'8rem (128px)'};
  const flh = {xs:'1rem',sm:'1.25rem',base:'1.5rem',lg:'1.75rem',xl:'1.75rem','2xl':'2rem','3xl':'2.25rem','4xl':'2.5rem','5xl':'1','6xl':'1','7xl':'1','8xl':'1','9xl':'1'};
  if (c.startsWith('text-')) {
    const v=c.slice(5);
    if(fsz[v])return`font-size: ${fsz[v]}\nline-height: ${flh[v]}`;
    if(['left','center','right','justify','start','end'].includes(v))return`text-align: ${v}`;
    if(v==='ellipsis')return'text-overflow: ellipsis';
    if(v==='nowrap')return'text-wrap: nowrap';
    if(v==='balance')return'text-wrap: balance';
    if(v==='uppercase'||v==='lowercase'||v==='capitalize')return`text-transform: ${v}`;
    if(v==='transparent')return'color: transparent';
    if(v==='black')return'color: #000';
    if(v==='white')return'color: #fff';
    if(v==='current')return'color: currentColor';
    return`color: (${v})`;
  }
  const fw = {thin:'100',extralight:'200',light:'300',normal:'400',medium:'500',semibold:'600',bold:'700',extrabold:'800',black:'900'};
  if (c.startsWith('font-')) { const v=c.slice(5); if(fw[v])return`font-weight: ${fw[v]}`; if(v==='sans')return'font-family: ui-sans-serif, system-ui, sans-serif'; if(v==='serif')return'font-family: ui-serif, Georgia, serif'; if(v==='mono')return'font-family: ui-monospace, monospace'; }
  if (c==='italic') return 'font-style: italic';
  if (c==='not-italic') return 'font-style: normal';
  if (c==='underline') return 'text-decoration-line: underline';
  if (c==='line-through') return 'text-decoration-line: line-through';
  if (c==='no-underline') return 'text-decoration-line: none';
  if (c==='uppercase') return 'text-transform: uppercase';
  if (c==='lowercase') return 'text-transform: lowercase';
  if (c==='capitalize') return 'text-transform: capitalize';
  if (c==='truncate') return 'overflow: hidden\ntext-overflow: ellipsis\nwhite-space: nowrap';
  if (c==='antialiased') return '-webkit-font-smoothing: antialiased\n-moz-osx-font-smoothing: grayscale';
  const leading = {none:'1',tight:'1.25',snug:'1.375',normal:'1.5',relaxed:'1.625',loose:'2'};
  if (c.startsWith('leading-')) { const v=c.slice(8); if(leading[v])return`line-height: ${leading[v]}`; if(sp[v])return`line-height: ${sp[v]}`; }
  const tracking = {tighter:'-0.05em',tight:'-0.025em',normal:'0em',wide:'0.025em',wider:'0.05em',widest:'0.1em'};
  if (c.startsWith('tracking-')) { const v=c.slice(9); if(tracking[v])return`letter-spacing: ${tracking[v]}`; }
  const ws = {normal:'normal',nowrap:'nowrap',pre:'pre','pre-line':'pre-line','pre-wrap':'pre-wrap','break-spaces':'break-spaces'};
  if (c.startsWith('whitespace-')) { const v=c.slice(11); if(ws[v])return`white-space: ${ws[v]}`; }
  if (c==='list-disc') return 'list-style-type: disc';
  if (c==='list-decimal') return 'list-style-type: decimal';
  if (c==='list-none') return 'list-style-type: none';

  // Backgrounds
  if (c.startsWith('bg-')) {
    const v=c.slice(3);
    const spec={transparent:'transparent',current:'currentColor',black:'#000',white:'#fff',none:'none'};
    if(spec[v])return`background-color: ${spec[v]}`;
    if(v==='fixed')return'background-attachment: fixed';
    if(v==='cover')return'background-size: cover';
    if(v==='contain')return'background-size: contain';
    if(v==='no-repeat')return'background-repeat: no-repeat';
    if(v.startsWith('gradient-to-'))return`background-image: linear-gradient(to ${v.slice(12).replace(/-/g,' ')}, ...)`;
    return`background-color: (${v})`;
  }

  // Borders
  if (c==='border') return 'border-width: 1px';
  const bw={'border-0':'0px','border-2':'2px','border-4':'4px','border-8':'8px'};
  if(bw[c])return`border-width: ${bw[c]}`;
  for(const [s,p] of [['t','top'],['r','right'],['b','bottom'],['l','left'],['x','inline'],['y','block']]) {
    if(c===`border-${s}`)return`border-${p}-width: 1px`;
    for(const w of ['0','2','4','8']){if(c===`border-${s}-${w}`)return`border-${p}-width: ${w}px`;}
  }
  if(c==='border-solid')return'border-style: solid';
  if(c==='border-dashed')return'border-style: dashed';
  if(c==='border-dotted')return'border-style: dotted';
  if(c==='border-none')return'border-style: none';
  const rnd={rounded:'0.25rem (4px)','rounded-none':'0px','rounded-sm':'0.125rem (2px)','rounded-md':'0.375rem (6px)','rounded-lg':'0.5rem (8px)','rounded-xl':'0.75rem (12px)','rounded-2xl':'1rem (16px)','rounded-3xl':'1.5rem (24px)','rounded-full':'9999px'};
  if(rnd[c])return`border-radius: ${rnd[c]}`;
  if(c.startsWith('border-')){const v=c.slice(7);const cs={transparent:'transparent',black:'#000',white:'#fff',current:'currentColor'};return cs[v]?`border-color: ${cs[v]}`:`border-color: (${v})`;}

  // Ring / Shadow
  if(c==='ring')return'box-shadow: 0 0 0 3px (ring-color)';
  if(c.startsWith('ring-')){const v=c.slice(5);const rw={'0':'0px','1':'1px','2':'2px','4':'4px','8':'8px'};return rw[v]?`box-shadow: 0 0 0 ${rw[v]} (ring-color)`:`ring-color: (${v})`;}
  const shd={shadow:'0 1px 3px rgba(0,0,0,0.1)','shadow-sm':'0 1px 2px rgba(0,0,0,0.05)','shadow-md':'0 4px 6px rgba(0,0,0,0.1)','shadow-lg':'0 10px 15px rgba(0,0,0,0.1)','shadow-xl':'0 20px 25px rgba(0,0,0,0.1)','shadow-2xl':'0 25px 50px rgba(0,0,0,0.25)','shadow-inner':'inset 0 2px 4px rgba(0,0,0,0.06)','shadow-none':'none'};
  if(shd[c])return`box-shadow: ${shd[c]}`;

  // Opacity / Blur
  if(c.startsWith('opacity-')){const n=parseInt(c.slice(8));if(!isNaN(n))return`opacity: ${n/100}`;}
  const blr={blur:'8px','blur-none':'0','blur-sm':'4px','blur-md':'12px','blur-lg':'16px','blur-xl':'24px','blur-2xl':'40px','blur-3xl':'64px'};
  if(blr[c])return`filter: blur(${blr[c]})`;
  const bdBlr={'backdrop-blur':'8px','backdrop-blur-none':'0','backdrop-blur-sm':'4px','backdrop-blur-md':'12px','backdrop-blur-lg':'16px','backdrop-blur-xl':'24px'};
  if(bdBlr[c])return`backdrop-filter: blur(${bdBlr[c]})`;

  // Transitions
  const trans={transition:'transition: color, background-color, border-color,\n  opacity, box-shadow, transform 150ms ease','transition-none':'transition-property: none','transition-all':'transition: all 150ms ease','transition-colors':'transition: color, background-color,\n  border-color 150ms ease','transition-opacity':'transition: opacity 150ms ease','transition-shadow':'transition: box-shadow 150ms ease','transition-transform':'transition: transform 150ms ease'};
  if(trans[c])return trans[c];
  if(c.startsWith('duration-'))return`transition-duration: ${c.slice(9)}ms`;
  if(c.startsWith('delay-'))return`transition-delay: ${c.slice(6)}ms`;
  const ease={'ease-linear':'linear','ease-in':'cubic-bezier(0.4, 0, 1, 1)','ease-out':'cubic-bezier(0, 0, 0.2, 1)','ease-in-out':'cubic-bezier(0.4, 0, 0.2, 1)'};
  if(ease[c])return`transition-timing-function: ${ease[c]}`;

  // Transforms
  if(c==='transform-none')return'transform: none';
  if(c.startsWith('scale-x-')){const n=parseInt(c.slice(8));return`transform: scaleX(${n/100})`;}
  if(c.startsWith('scale-y-')){const n=parseInt(c.slice(8));return`transform: scaleY(${n/100})`;}
  if(c.startsWith('scale-')){const n=parseInt(c.slice(6));if(!isNaN(n))return`transform: scale(${n/100})`;}
  if(c.startsWith('rotate-'))return`transform: rotate(${c.slice(7)}deg)`;
  if(c.startsWith('translate-x-')){const v=sp[c.slice(12)]||fr[c.slice(12)];return v?`transform: translateX(${v})`:null;}
  if(c.startsWith('translate-y-')){const v=sp[c.slice(12)]||fr[c.slice(12)];return v?`transform: translateY(${v})`:null;}
  if(c.startsWith('skew-x-'))return`transform: skewX(${c.slice(7)}deg)`;
  if(c.startsWith('skew-y-'))return`transform: skewY(${c.slice(7)}deg)`;

  // Interactivity
  if(c.startsWith('cursor-'))return`cursor: ${c.slice(7)}`;
  if(c==='pointer-events-none')return'pointer-events: none';
  if(c==='pointer-events-auto')return'pointer-events: auto';
  if(c.startsWith('select-'))return`user-select: ${c.slice(7)}`;
  if(c==='resize')return'resize: both';
  if(c==='resize-none')return'resize: none';
  if(c==='resize-x')return'resize: horizontal';
  if(c==='resize-y')return'resize: vertical';
  if(c==='appearance-none')return'appearance: none';
  if(c==='outline-none')return'outline: 2px solid transparent\noutline-offset: 2px';
  if(c==='outline')return'outline-style: solid';

  return null;
}

let _tipTimer = null;

function showCssTooltip(cls, targetEl) {
  clearTimeout(_tipTimer);
  _tipTimer = setTimeout(() => {
    const css = getTailwindCSS(cls);
    if (!css) return;

    let tip = document.getElementById('tw-css-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'tw-css-tip';
      document.body.appendChild(tip);
      Object.assign(tip.style, {
        position: 'fixed',
        background: '#0d1117',
        borderRadius: '6px',
        fontSize: '11.5px',
        fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
        lineHeight: '1.75',
        zIndex: '2147483647',
        pointerEvents: 'none',
        border: '1px solid #1e293b',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        padding: '7px 10px',
        whiteSpace: 'nowrap',
      });
    }

    tip.innerHTML = css.split('\n').map(line => {
      if (line.startsWith('@media') || line.startsWith('  @')) {
        return `<div style="color:#818cf8;font-size:10.5px;margin-bottom:2px;">${line}</div>`;
      }
      const colon = line.indexOf(':');
      if (colon === -1) return `<div style="color:#64748b;">${line}</div>`;
      const prop = line.slice(0, colon);
      const val  = line.slice(colon + 1).trim();
      return `<div><span style="color:#7dd3fc;">${prop}</span><span style="color:#334155;">:</span> <span style="color:#e2e8f0;">${val}</span></div>`;
    }).join('');

    tip.style.display = 'block';

    const r = targetEl.getBoundingClientRect();
    let left = r.right + 10;
    let top  = r.top;

    setTimeout(() => {
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      if (left + tw > window.innerWidth - 8) left = r.left - tw - 10;
      if (top  + th > window.innerHeight - 8) top = window.innerHeight - th - 8;
      if (top < 8) top = 8;
      tip.style.left = `${left}px`;
      tip.style.top  = `${top}px`;
    }, 0);
  }, 280);
}

function hideCssTooltip() {
  clearTimeout(_tipTimer);
  const tip = document.getElementById('tw-css-tip');
  if (tip) tip.style.display = 'none';
}
// ── End CSS Explainer ──────────────────────────────────────────────────────

function createPanel() {
  if (document.getElementById("tw-inspector-panel")) return;

  const panelHtml = `
<div id="tw-inspector-panel" style="display:none; position:absolute; z-index:99999;">
  <div class="tw-panel">
    <div class="tw-header">
      <span id="tw-class-count">ClassList</span>
        <div class="tw-actions">
       <!-- Undo -->
<button id="tw-undo" title="Undo" aria-label="Undo last class change">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 14H4v-5" />
    <path d="M20 20a9 9 0 0 0-16-6.7L4 9" />
  </svg>
</button>

<!-- Redo -->
<button id="tw-redo" title="Redo" aria-label="Redo last undone change">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 14h5v-5" />
    <path d="M4 20a9 9 0 0 1 16-6.7L20 9" />
  </svg>
</button>

<span class="tw-action-sep" aria-hidden="true"></span>

<!-- Copy -->
<button id="tw-copy" title="Copy classes" aria-label="Copy class list to clipboard">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
</button>

<!-- Copy HTML -->
<button id="tw-copy-html" title="Copy element HTML" aria-label="Copy element HTML to clipboard">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
</button>

<!-- Copy for AI -->
<button id="tw-copy-ai" class="tw-action-accent" title="Copy context for AI (paste into Claude, ChatGPT, Cursor...)" aria-label="Copy element context for AI assistants">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3z" />
    <path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15z" />
  </svg>
</button>

<span class="tw-action-sep" aria-hidden="true"></span>

<!-- Close -->
<button id="tw-close" class="tw-action-close" title="Close" aria-label="Close inspector panel">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
  </svg>
</button>

        </div>
      </div>
     <div class="tw-filter-wrap">
       <svg class="tw-filter-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
       </svg>
       <input id="tw-filter-input" type="text" placeholder="Filter classes..." />
     </div>
     <ul id="tw-class-list"></ul>
     <div id="tw-filter-empty">No classes match</div>
     <div id="tw-debug-output"></div>
     <div class="tw-legend">
       <span><span class="tw-status-dot tw-dot-active"></span> Active</span>
       <span><span class="tw-status-dot tw-dot-inactive"></span> Inactive / Overridden</span>
     </div>
   <div style="position:relative;">
      <input id="tw-add-input" type="text" placeholder="Add new class" />
      <ul id="tw-suggestions"></ul>
    </div>
<div id="tw-error-box"></div>
    <button id="tw-add-btn">Add Class</button>
    </div>
  </div>`;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = panelHtml;
  document.body.appendChild(wrapper);
  panelEl = document.getElementById("tw-inspector-panel");

  // Event handlers inside panel
  document.getElementById("tw-close").addEventListener("click", () => {
    panelEl.style.display = "none";
    window.__tw_selectedEl = null;
    hideCssTooltip();
    if (highlightBox) highlightBox.remove();
  });

  document.getElementById("tw-copy").addEventListener("click", () => {
    navigator.clipboard
      .writeText(window.__tw_selectedEl?.getAttribute("class") || "")
      .then(() => showToast("Classes copied!"))
      .catch(() => showToast("Copy failed", 2000, "error"));
  });

  document.getElementById("tw-copy-html").addEventListener("click", () => {
    navigator.clipboard
      .writeText(window.__tw_selectedEl?.outerHTML || "")
      .then(() => showToast("HTML copied!"))
      .catch(() => showToast("Copy failed", 2000, "error"));
  });

  document.getElementById("tw-copy-ai").addEventListener("click", () => {
    if (!window.__tw_selectedEl) return;
    navigator.clipboard
      .writeText(buildAIContext(window.__tw_selectedEl))
      .then(() => showToast("AI context copied — paste it into your assistant", 2200))
      .catch(() => showToast("Copy failed", 2000, "error"));
  });

  document.getElementById("tw-undo").addEventListener("click", () => {
    if (!window.__tw_selectedEl || undoStack.length === 0) return;
    redoStack.push(window.__tw_selectedEl.getAttribute("class") || "");
    window.__tw_selectedEl.setAttribute("class", undoStack.pop());
    updatePanel(window.__tw_selectedEl);
  });

  document.getElementById("tw-redo").addEventListener("click", () => {
    if (!window.__tw_selectedEl || redoStack.length === 0) return;
    undoStack.push(window.__tw_selectedEl.getAttribute("class") || "");
    window.__tw_selectedEl.setAttribute("class", redoStack.pop());
    updatePanel(window.__tw_selectedEl);
  });

  syncHistoryButtons();

  // Shared by the Add Class button and the Enter key so both behave identically
  function addClassFromInput() {
    const input = document.getElementById("tw-add-input");
    const newClass = input.value.trim();
    if (!newClass || !window.__tw_selectedEl) return;

    // Validate Tailwind class (support opacity modifiers, important, and arbitrary values)
    const isValidClass = validateTailwindClass(newClass);

    if (!isValidClass) {
      showError("❌ Invalid Tailwind class");
      return;
    }

    saveState(window.__tw_selectedEl);
    window.__tw_selectedEl.classList.add(newClass);
    input.value = "";
    hideError();
    updatePanel(window.__tw_selectedEl);
  }

  document.getElementById("tw-add-btn").addEventListener("click", addClassFromInput);

  const input = document.getElementById("tw-add-input");
  const suggestionBox = document.getElementById("tw-suggestions");

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      suggestionBox.style.display = "none";
      addClassFromInput();
    }
  });

  input.addEventListener("input", () => {
    const query = input.value.trim();
    suggestionBox.innerHTML = "";

    // Hide error if valid class (including opacity modifiers, etc.)
    if (validateTailwindClass(query)) {
      hideError();
    }

    if (!query) return (suggestionBox.style.display = "none");

    const matches = tailwindClasses
      .filter((cls) => cls.startsWith(query))
      .slice(0, 10);

    if (matches.length === 0) return (suggestionBox.style.display = "none");

    matches.forEach((match) => {
      const li = document.createElement("li");
      li.textContent = match;
      li.style.padding = "6px";
      li.style.cursor = "pointer";
      li.style.borderBottom = "1px solid #334155";

      li.addEventListener("mouseover", () => (li.style.background = "#334155"));
      li.addEventListener(
        "mouseout",
        () => (li.style.background = "transparent")
      );
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Prevent input from losing focus
        saveState(window.__tw_selectedEl);
        window.__tw_selectedEl.classList.add(match);
        input.value = "";
        suggestionBox.style.display = "none";
        updatePanel(window.__tw_selectedEl);
        hideError();
      });

      suggestionBox.appendChild(li);
    });

    suggestionBox.style.display = "block";
  });

  input.addEventListener("blur", () => {
    setTimeout(() => (suggestionBox.style.display = "none"), 200);
  });

  document.getElementById("tw-filter-input").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    let visible = 0;
    document.querySelectorAll("#tw-class-list li").forEach((li) => {
      const matches = query === "" || (li.dataset.cls || "").includes(query);
      li.style.display = matches ? "" : "none";
      if (matches) visible++;
    });
    const emptyEl = document.getElementById("tw-filter-empty");
    if (emptyEl) emptyEl.style.display = visible === 0 && query !== "" ? "block" : "none";
  });
}

function showToast(message = "Done!", duration = 1500, type = "success") {
  const isError = type === "error";

  const icon = isError
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" width="13" height="13">
        <path d="M18 6L6 18M6 6l12 12"/>
       </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#a3e635" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
        <path d="M5 13l4 4L19 7"/>
       </svg>`;

  const toast = document.createElement("div");
  toast.innerHTML = `
    <span style="display:flex;align-items:center;flex-shrink:0;">${icon}</span>
    <span>${message}</span>
  `;

  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%) translateY(6px)",
    background: "#111827",
    color: "#f1f5f9",
    padding: "9px 14px",
    borderRadius: "8px",
    fontSize: "12.5px",
    fontFamily: "Inter, sans-serif",
    fontWeight: "500",
    letterSpacing: "0.01em",
    zIndex: "2147483647",
    opacity: "0",
    transition: "opacity 0.15s ease, transform 0.15s ease",
    boxShadow: "0 2px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  });

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  }, 10);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(6px)";
    setTimeout(() => toast.remove(), 150);
  }, duration);
}

function showError(message) {
  const errorBox = document.getElementById("tw-error-box");
  if (errorBox) errorBox.textContent = message;
}

function hideError() {
  const errorBox = document.getElementById("tw-error-box");
  if (errorBox) errorBox.textContent = "";
}

// ── Class Debugger ────────────────────────────────────────────────────────────
function debugClass(cls, el, classList) {
  const parts = cls.split(':');
  const prefixes = parts.slice(0, -1);

  const core = parts[parts.length - 1];

  // 1. Responsive prefix too wide for the current viewport
  for (const p of prefixes) {
    const needed = getBreakpointMin(p);
    if (needed !== null) {
      const current = window.innerWidth;
      if (current < needed) {
        return {
          status: 'warn',
          label: 'Viewport too narrow',
          message: `\`${p}:\` needs ${needed}px — you're at ${current}px.`,
          hint: `Try \`${core}\` without the prefix, or widen the window.`
        };
      }
    }
  }

  // 2. State variant — only fires when that state is active
  const stateVariants = ['hover','focus','active','group-hover','focus-within','focus-visible','dark','disabled','placeholder','checked','visited'];
  const activeState = prefixes.find(p => stateVariants.includes(p));
  if (activeState) {
    return {
      status: 'info',
      label: 'State variant',
      message: `Fires on \`${activeState}\` only. Trigger that state to see it work.`,
      hint: null
    };
  }

  // 3. Overridden by a later class setting the same property
  const conflict = findOverrider(cls, classList);
  if (conflict) {
    return {
      status: 'warn',
      label: 'Conflict',
      message: `Both this and \`${conflict.overrider}\` set ${conflict.property}. Only one can apply, and Tailwind's CSS order decides which.`,
      hint: `Remove one of them — reordering the class attribute won't change the result.`
    };
  }

  // 3b. A responsive variant of the same property is active at this width.
  // Expected behaviour, not a fault — reported so the class doesn't look
  // broken, but not flagged as a problem.
  const variant = findActiveVariantOverrider(cls, classList);
  if (variant) {
    return {
      status: 'info',
      label: 'Superseded at this width',
      message: `\`${variant.overrider}\` takes over from ${variant.min}px and you're at ${window.innerWidth}px, so it sets ${variant.property} instead.`,
      hint: `This is expected — \`${cls}\` applies below ${variant.min}px.`
    };
  }

  // 4. Inline style on the element is winning the cascade
  const cssDef = getTailwindCSS(cls);
  if (cssDef && el.style) {
    const firstLine = cssDef.split('\n')[0].trim();
    if (!firstLine.startsWith('@')) {
      const colonIdx = firstLine.indexOf(':');
      if (colonIdx > -1) {
        const prop = firstLine.slice(0, colonIdx).trim();
        const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (el.style[camel]) {
          return {
            status: 'warn',
            label: 'Inline style wins',
            message: `An inline \`style="${prop}: ${el.style[camel]}"\` on this element beats any class.`,
            hint: `Clear the inline style, or use \`!${cls}\` to win anyway.`
          };
        }
      }
    }
  }

  // 5. The page's own stylesheet is overriding it — verify against computed style
  const expected = expectedComputed(core.replace(/^!/, ''));
  if (expected) {
    const actual = getComputedStyle(el).getPropertyValue(expected.prop).trim();
    if (!computedMatches(actual, expected.value)) {
      return {
        status: 'warn',
        label: 'Stylesheet override',
        message: `This should set \`${expected.prop}: ${expected.value}\`, but the browser computed \`${actual}\` — a page stylesheet rule with higher specificity is beating it.`,
        hint: `Check the ${expected.prop} rules in DevTools, or use \`!${cls}\` to override.`
      };
    }
  }

  // No issues detected
  return {
    status: 'ok',
    label: 'Applied',
    message: `No conflicts or overrides detected — \`${cls}\` is taking effect.`,
    hint: null
  };
}

// Expected computed value for classes we can verify cheaply. Only covers
// properties where the computed value maps 1:1 to the class.
function expectedComputed(core) {
  const disp = { block:'block','inline-block':'inline-block',inline:'inline',flex:'flex','inline-flex':'inline-flex',grid:'grid','inline-grid':'inline-grid',hidden:'none' };
  if (disp[core]) return { prop: 'display', value: disp[core] };
  if (['static','relative','absolute','fixed','sticky'].includes(core)) return { prop: 'position', value: core };
  const fw = { thin:'100',extralight:'200',light:'300',normal:'400',medium:'500',semibold:'600',bold:'700',extrabold:'800',black:'900' };
  if (core.startsWith('font-') && fw[core.slice(5)]) return { prop: 'font-weight', value: fw[core.slice(5)] };
  const fszRem = { xs:0.75,sm:0.875,base:1,lg:1.125,xl:1.25,'2xl':1.5,'3xl':1.875,'4xl':2.25,'5xl':3,'6xl':3.75,'7xl':4.5,'8xl':6,'9xl':8 };
  if (core.startsWith('text-') && fszRem[core.slice(5)]) {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return { prop: 'font-size', value: `${fszRem[core.slice(5)] * rootPx}px` };
  }
  if (/^text-(left|center|right|justify)$/.test(core)) return { prop: 'text-align', value: core.slice(5) };
  if (['uppercase','lowercase','capitalize'].includes(core)) return { prop: 'text-transform', value: core };
  if (core === 'italic') return { prop: 'font-style', value: 'italic' };
  return null;
}

function computedMatches(actual, expected) {
  if (actual === expected) return true;
  const a = parseFloat(actual), e = parseFloat(expected);
  if (!isNaN(a) && !isNaN(e)) return Math.abs(a - e) < 0.6;
  return false;
}

function inlineCode(str) {
  return str.replace(/`([^`]+)`/g, '<code>$1</code>');
}

function showDebugResult(cls, el, classList) {
  const output = document.getElementById('tw-debug-output');
  if (!output) return;

  const { status, label, message, hint } = debugClass(cls, el, classList);

  output.className = `tw-debug-result tw-debug-${status}`;
  output.innerHTML = `
    <div class="tw-debug-header">
      <span class="tw-debug-dot"></span>
      <span class="tw-debug-label">${label}</span>
      <code class="tw-debug-cls">${cls}</code>
    </div>
    <p class="tw-debug-msg">${inlineCode(message)}</p>
    ${hint ? `<p class="tw-debug-hint">${inlineCode(hint)}</p>` : ''}
  `;
  output.style.display = 'block';
}
// ── End Class Debugger ────────────────────────────────────────────────────────

// ── Copy for AI ───────────────────────────────────────────────────────────────
// Which Tailwind major version the page is built with. An assistant that
// guesses wrong hands back classes that silently don't work — v4 renamed
// utilities and moved the theme into CSS custom properties.
function detectTailwindVersion() {
  const rs = getComputedStyle(document.documentElement);
  const has = (v) => rs.getPropertyValue(v).trim() !== '';

  // v4 exposes its theme as custom properties on :root. v3 never does.
  if (['--spacing', '--color-red-500', '--radius-lg', '--default-font-family']
      .some(has)) {
    return '4';
  }

  // v3 preflight sets these on the universal selector. Checked second because
  // v4 registers some --tw-* props via @property, which also resolve here.
  if (['--tw-ring-offset-shadow', '--tw-shadow', '--tw-translate-x'].some(has)) {
    return '3';
  }

  return null;
}

// Builds a structured context block about the selected element that the user
// can paste into an AI assistant. Includes the live-browser data an AI can't
// see on its own: computed styles, debugger diagnoses, viewport state.
function buildAIContext(el) {
  const classList = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
  const cs = getComputedStyle(el);

  // Run the debugger on every class and collect real problems
  const issues = [];
  for (const cls of classList) {
    const d = debugClass(cls, el, classList);
    if (d.status === 'warn') issues.push(`- \`${cls}\`: ${d.message}${d.hint ? ` ${d.hint}` : ''}`);
  }

  // Curated computed styles; skip values that carry no information. The old
  // exact-match noise list let shorthands through as pure filler — `border`
  // resolves to "0px none rgb(0, 0, 0)" on an element with no border at all.
  const props = ['display','position','width','height','padding','margin','font-size','font-weight','line-height','letter-spacing','text-align','text-transform','text-wrap','color','background-color','border','border-radius','box-shadow','flex-direction','align-items','justify-content','gap','overflow','z-index','opacity'];
  const display = cs.getPropertyValue('display').trim();
  const isFlexOrGrid = /(flex|grid)/.test(display);
  const layoutOnly = new Set(['flex-direction', 'align-items', 'justify-content', 'gap']);

  const isNoise = (p, v) => {
    if (!v) return true;
    if (p === 'display') return false;                     // always meaningful
    // Flex/grid properties resolve to a value on every element; they only
    // mean something when the element actually lays out that way.
    if (layoutOnly.has(p) && !isFlexOrGrid) return true;
    if (/^0px(\s|$)/.test(v)) return true;                 // 0px, "0px none rgb(0, 0, 0)"
    if (['auto', 'none', 'normal', 'rgba(0, 0, 0, 0)'].includes(v)) return true;
    if (p === 'position' && v === 'static') return true;   // the default
    if (p === 'overflow' && v === 'visible') return true;  // the default
    if (p === 'opacity' && v === '1') return true;
    return false;
  };
  const computed = props
    .map(p => [p, cs.getPropertyValue(p).trim()])
    .filter(([p, v]) => !isNoise(p, v))
    .map(([p, v]) => `${p}: ${v};`)
    .join('\n');

  let html = el.outerHTML;
  if (html.length > 1200) html = html.slice(0, 1200) + '… (truncated)';

  const parent = el.parentElement;
  const parentDesc = parent
    ? `<${parent.tagName.toLowerCase()}${parent.getAttribute('class') ? ` class="${parent.getAttribute('class')}"` : ''}>`
    : '(none)';

  const bp = getActiveBp(window.innerWidth);
  const version = detectTailwindVersion();
  const bpInfo = getBreakpoints();

  const bpLine = bpInfo.detected
    ? bpInfo.list.filter(b => b.min > 0).map(b => `${b.name}: ${b.min}px`).join(', ')
    : 'Tailwind defaults (no custom screens detected)';

  // The computed styles above are whichever colour scheme is live, so say
  // which one — otherwise `dark:` classes look like they aren't working.
  const root = document.documentElement;
  const darkByClass = root.classList.contains('dark');
  const darkByMedia = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = darkByClass || darkByMedia;
  const schemeLine = `${isDark ? 'dark' : 'light'} (${
    darkByClass ? '`dark` class on <html>' : `prefers-color-scheme: ${darkByMedia ? 'dark' : 'light'}`
  }) — the computed styles above reflect this mode`;

  return `Here is a live element from my webpage, captured with TailwindSight:

## Element HTML
\`\`\`html
${html}
\`\`\`

## Applied Tailwind classes (${classList.length})
${classList.join(' ') || '(none)'}

${issues.length ? `## Issues detected on the live page
${issues.join('\n')}

` : ''}## Computed styles (as actually rendered in the browser)
\`\`\`css
${computed}
\`\`\`

## Context
- Tailwind version: ${version ? `v${version} (detected on the page)` : 'could not be detected — ask me before using version-specific syntax'}
- Breakpoints: ${bpLine}
- Colour scheme: ${schemeLine}
- Parent element: ${parentDesc}
- Viewport: ${window.innerWidth}px (\`${bp.name}\` breakpoint active)

## Task
[Describe what you want to change or fix]
`;
}
// ── End Copy for AI ───────────────────────────────────────────────────────────

function updatePanel(el) {
  hideCssTooltip();
  const debugOutput = document.getElementById('tw-debug-output');
  if (debugOutput) { debugOutput.style.display = 'none'; delete debugOutput.dataset.debugCls; }
  const classList = (el.getAttribute("class") || "").trim().split(/\s+/).filter(cls => cls);

  const countEl = document.getElementById("tw-class-count");
  if (countEl) countEl.textContent = `ClassList (${classList.length})`;

  syncHistoryButtons();

  const list = document.getElementById("tw-class-list");
  list.innerHTML = "";

  // Get computed styles to check if classes are actually applied
  const computedStyle = window.getComputedStyle(el);

  // Find conflicting classes (later ones override earlier ones)
  const conflicts = findConflictingClasses(classList);

  classList.forEach((cls, index) => {
    const li = document.createElement("li");

    // Check if this class is overridden by a later conflicting class
    const isOverridden = conflicts[index];

    // Check if this class is likely having an effect
    const isActive = !isOverridden && isClassActive(cls, el, computedStyle);

    // Run the debugger up front so a class with a real problem advertises it,
    // instead of hiding the diagnosis behind a click the user has no reason
    // to make on a class that looks fine.
    const diag = debugClass(cls, el, classList);
    const flagged = diag.status === 'warn';

    li.dataset.cls = cls;
    li.innerHTML = `
      <span class="tw-cls-label${isActive ? '' : ' tw-cls-inactive'}">
        <span class="tw-status-dot ${isActive ? 'tw-dot-active' : 'tw-dot-inactive'}" title="${isActive ? 'Active' : 'Overridden or inactive'}"></span>
        <span class="tw-cls-name">${cls}</span>
      </span>
      <div class="tw-cls-actions">
        <button class="tw-debug-btn${flagged ? ' tw-debug-btn--flag' : ''}" data-debug="${cls}" title="${flagged ? `${diag.label} — click for details` : `Debug ${cls}`}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
          </svg>
        </button>
        <button class="tw-remove-btn" data-remove="${cls}" title="Remove ${cls}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>`;

    li.addEventListener('mouseenter', () => showCssTooltip(cls, li));
    li.addEventListener('mouseleave', hideCssTooltip);

    list.appendChild(li);
  });

  list.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const clsToRemove = e.target.closest("button[data-remove]").dataset.remove;
      saveState(el);
      el.classList.remove(clsToRemove);
      updatePanel(el);
    });
  });

  list.querySelectorAll("button[data-debug]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cls = e.target.closest("button[data-debug]").dataset.debug;
      const output = document.getElementById('tw-debug-output');
      if (output && output.dataset.debugCls === cls && output.style.display !== 'none') {
        output.style.display = 'none';
        delete output.dataset.debugCls;
        return;
      }
      showDebugResult(cls, el, classList);
      if (output) output.dataset.debugCls = cls;
    });
  });

  // Reapply active filter after re-render
  const filterInput = document.getElementById("tw-filter-input");
  if (filterInput && filterInput.value.trim()) {
    const query = filterInput.value.toLowerCase().trim();
    let visible = 0;
    list.querySelectorAll("li").forEach((li) => {
      const matches = (li.dataset.cls || "").includes(query);
      li.style.display = matches ? "" : "none";
      if (matches) visible++;
    });
    const emptyEl = document.getElementById("tw-filter-empty");
    if (emptyEl) emptyEl.style.display = visible === 0 ? "block" : "none";
  }
}

// Property groups that conflict with each other. Each entry is
// [human-readable property name, matcher]. The label is used by the
// debugger to say exactly which property two classes are fighting over.
const TW_VARIANTS = '(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*';
const TW_PROPERTY_GROUPS = [
  ['font-size',        new RegExp(`^${TW_VARIANTS}text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$`)],
  ['font-weight',      new RegExp(`^${TW_VARIANTS}font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$`)],
  ['text-align',       new RegExp(`^${TW_VARIANTS}text-(left|center|right|justify|start|end)$`)],
  // Colors must be color-{shade} or a keyword; excludes text-pretty, text-5xl, text-left, etc.
  ['text color',       new RegExp(`^${TW_VARIANTS}(text-(transparent|current|black|white|inherit)|text-[a-z]+-\\d+(\\/\\d+)?)$`)],
  ['background color', new RegExp(`^${TW_VARIANTS}(bg-(transparent|current|black|white|inherit|none)|bg-[a-z]+-\\d+(\\/\\d+)?)$`)],
  ['display',          new RegExp(`^${TW_VARIANTS}(block|inline|inline-block|flex|inline-flex|grid|inline-grid|hidden)$`)],
  ['position',         new RegExp(`^${TW_VARIANTS}(static|relative|absolute|fixed|sticky)$`)],
  ['width',            new RegExp(`^${TW_VARIANTS}w-`)],
  ['height',           new RegExp(`^${TW_VARIANTS}h-`)],
  ['padding',          new RegExp(`^${TW_VARIANTS}p-`)],
  ['horizontal padding', new RegExp(`^${TW_VARIANTS}px-`)],
  ['vertical padding', new RegExp(`^${TW_VARIANTS}py-`)],
  ['padding-top',      new RegExp(`^${TW_VARIANTS}pt-`)],
  ['padding-bottom',   new RegExp(`^${TW_VARIANTS}pb-`)],
  ['padding-left',     new RegExp(`^${TW_VARIANTS}pl-`)],
  ['padding-right',    new RegExp(`^${TW_VARIANTS}pr-`)],
  ['margin',           new RegExp(`^${TW_VARIANTS}m-`)],
  ['horizontal margin', new RegExp(`^${TW_VARIANTS}mx-`)],
  ['vertical margin',  new RegExp(`^${TW_VARIANTS}my-`)],
  ['margin-top',       new RegExp(`^${TW_VARIANTS}mt-`)],
  ['margin-bottom',    new RegExp(`^${TW_VARIANTS}mb-`)],
  ['margin-left',      new RegExp(`^${TW_VARIANTS}ml-`)],
  ['margin-right',     new RegExp(`^${TW_VARIANTS}mr-`)],
  // gap- must not swallow gap-x-/gap-y-, which set different properties
  ['gap',              new RegExp(`^${TW_VARIANTS}gap-(?!x-|y-)`)],
  ['column gap',       new RegExp(`^${TW_VARIANTS}gap-x-`)],
  ['row gap',          new RegExp(`^${TW_VARIANTS}gap-y-`)],
  ['max-width',        new RegExp(`^${TW_VARIANTS}max-w-`)],
  ['min-width',        new RegExp(`^${TW_VARIANTS}min-w-`)],
  // All-corner radius only; rounded-t-lg etc. set different properties
  ['border-radius',    new RegExp(`^${TW_VARIANTS}rounded(-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full))?$`)],
  ['border width',     new RegExp(`^${TW_VARIANTS}border(-\\d+)?$`)],
  ['border color',     new RegExp(`^${TW_VARIANTS}(border-(transparent|current|black|white|inherit)|border-[a-z]+-\\d+(\\/\\d+)?)$`)],
  ['line-height',      new RegExp(`^${TW_VARIANTS}leading-`)],
  ['letter-spacing',   new RegExp(`^${TW_VARIANTS}tracking-`)],
  ['flex-direction',   new RegExp(`^${TW_VARIANTS}flex-(row|row-reverse|col|col-reverse)$`)],
  ['justify-content',  new RegExp(`^${TW_VARIANTS}justify-(start|end|center|between|around|evenly|normal|stretch)$`)],
  ['align-items',      new RegExp(`^${TW_VARIANTS}items-(start|end|center|baseline|stretch)$`)],
  ['text-transform',   new RegExp(`^${TW_VARIANTS}(uppercase|lowercase|capitalize|normal-case)$`)],
  ['opacity',          new RegExp(`^${TW_VARIANTS}opacity-`)],
  ['z-index',          new RegExp(`^${TW_VARIANTS}z-`)],
  ['overflow',         new RegExp(`^${TW_VARIANTS}overflow-(auto|hidden|clip|visible|scroll)$`)],
  // object-fit and object-position are separate properties — object-cover and
  // object-center are meant to be used together and must not read as a clash
  ['object-fit',       new RegExp(`^${TW_VARIANTS}object-(contain|cover|fill|none|scale-down)$`)],
  ['object-position',  new RegExp(`^${TW_VARIANTS}object-(bottom|center|left|left-bottom|left-top|right|right-bottom|right-top|top)$`)],
  // Likewise the bg- prefix spans four unrelated properties
  ['background-size',  new RegExp(`^${TW_VARIANTS}bg-(auto|cover|contain)$`)],
  ['background-repeat', new RegExp(`^${TW_VARIANTS}bg-(repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space)$`)],
  ['background-attachment', new RegExp(`^${TW_VARIANTS}bg-(fixed|local|scroll)$`)],
  ['text-decoration',  new RegExp(`^${TW_VARIANTS}(underline|overline|line-through|no-underline)$`)],
  ['font-style',       new RegExp(`^${TW_VARIANTS}(italic|not-italic)$`)],
  ['flex-wrap',        new RegExp(`^${TW_VARIANTS}flex-(wrap|wrap-reverse|nowrap)$`)],
];

function twPrefixOf(cls) {
  return cls.match(/^([a-z0-9-]+:)*/)?.[0] || '';
}

// Returns { overrider, property } if a later class with the same prefix sets
// the same property as cls, else null.
// A later class whose responsive prefix is active at the current width and
// which sets the same property — e.g. `text-5xl` beside `sm:text-6xl` above
// 640px. findOverrider deliberately only compares same-prefix classes, so
// without this the computed-style check below blames a page stylesheet for
// what is just responsive design working correctly.
function findActiveVariantOverrider(cls, classList) {
  const idx = classList.indexOf(cls);
  if (idx === -1) return null;
  const ownPrefix = twPrefixOf(cls);

  for (let j = idx + 1; j < classList.length; j++) {
    const later = classList[j];
    if (twPrefixOf(later) === ownPrefix) continue; // findOverrider's job

    const prefixes = later.split(':').slice(0, -1);
    if (prefixes.length === 0) continue;

    // Every prefix must be a breakpoint that is currently satisfied; a state
    // variant like `hover:` isn't "active" in any checkable sense.
    let min = 0;
    let allResponsive = true;
    for (const p of prefixes) {
      const m = getBreakpointMin(p);
      if (m === null) { allResponsive = false; break; }
      min = Math.max(min, m);
    }
    if (!allResponsive || window.innerWidth < min) continue;

    for (const [property, re] of TW_PROPERTY_GROUPS) {
      if (re.test(cls) && re.test(later)) return { overrider: later, property, min };
    }
  }
  return null;
}

function findOverrider(cls, classList) {
  const idx = classList.indexOf(cls);
  if (idx === -1) return null;
  const prefix = twPrefixOf(cls);
  for (let j = idx + 1; j < classList.length; j++) {
    const later = classList[j];
    if (twPrefixOf(later) !== prefix) continue;
    for (const [property, re] of TW_PROPERTY_GROUPS) {
      if (re.test(cls) && re.test(later)) return { overrider: later, property };
    }
  }
  return null;
}

function findConflictingClasses(classList) {
  // Returns an array where true means the class at that index is overridden
  return classList.map(cls => findOverrider(cls, classList) !== null);
}

function isClassActive(className, el, computedStyle) {
  // Simple heuristic to check if a class is likely active
  // This checks for common Tailwind patterns

  // Hidden class check
  if (className.includes('hidden') || className.includes('invisible')) {
    return computedStyle.display === 'none' || computedStyle.visibility === 'hidden';
  }

  // Display classes
  if (className.match(/^(block|inline|flex|grid|table)/)) {
    return true; // Display classes are usually active if element is visible
  }

  // Color classes (text, bg, border)
  if (className.match(/^(text|bg|border)-/)) {
    return true; // Color classes are typically active
  }

  // Spacing classes (p, m, gap, space)
  if (className.match(/^(p|m|gap|space)-/)) {
    return true;
  }

  // Size classes
  if (className.match(/^(w|h|min|max)-/)) {
    return true;
  }

  // Responsive classes - assume active (can't easily check)
  if (className.includes(':')) {
    return true; // Show as active since we can't determine responsiveness easily
  }

  // Default: assume active for most Tailwind classes
  return true;
}

// Escape unwinds one layer at a time: open suggestions first, then a filled
// input, then the panel itself — so it never destroys your selection while
// you are still mid-edit.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !panelEl || panelEl.style.display === "none") return;

  const suggestionBox = document.getElementById("tw-suggestions");
  if (suggestionBox && suggestionBox.style.display !== "none") {
    suggestionBox.style.display = "none";
    return;
  }

  const addInput = document.getElementById("tw-add-input");
  const filterInput = document.getElementById("tw-filter-input");
  const focused = document.activeElement;

  if (focused === addInput && addInput.value !== "") {
    addInput.value = "";
    hideError();
    return;
  }

  if (focused === filterInput && filterInput.value !== "") {
    filterInput.value = "";
    filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  panelEl.style.display = "none";
  window.__tw_selectedEl = null;
  removeHighlight();
});

window.addEventListener("resize", () => {
  if (inspectEnabled) updateRuler();
});

document.addEventListener("click", (e) => {
  if (!inspectEnabled) return;

  const el = e.target;
  if (!el || isInsidePanel(el)) return;
  if (lastHovered === el) return;
  lastHovered = el;

  if (!el.getAttribute("class")) return;

  window.__tw_selectedEl = el;
  highlightElement(el);

  if (!panelEl) createPanel();

  const filterInput = document.getElementById("tw-filter-input");
  if (filterInput) filterInput.value = "";

  updatePanel(el);

  const rect = el.getBoundingClientRect();
  const panelWidth = 270;
  const panelHeight = 220;

  let left = rect.left + window.scrollX + rect.width / 2 - panelWidth / 2 + 45;
  let top = rect.top + window.scrollY + rect.height / 2 - panelHeight / 2 + 35;

  if (left < 0) left = 10;
  if (top < 0) top = 10;
  if (left + panelWidth > window.innerWidth) {
    left = window.innerWidth - panelWidth - 10;
  }

  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  panelEl.style.display = "block";
});
