/* Adapted from executionflow (https://github.com/ynsuy/executionflow) by Yunus
   Uyanik, who contributes it to Rowset Studio under the Apache License 2.0. */
/* ============================================================
   util — DOM, formatting, namespace-agnostic XML, operator icons
   ============================================================ */

/* ---------- DOM ---------- */
export const $ = s => document.querySelector(s);
export const el = (t, c) => { const e = document.createElement(t); if(c) e.className = c; return e; };

/* ---------- number / format helpers ---------- */
export function fmtNum(n){
  if(n==null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if(a >= 1e9) return (n/1e9).toFixed(2).replace(/\.?0+$/,'')+'B';
  if(a >= 1e6) return (n/1e6).toFixed(2).replace(/\.?0+$/,'')+'M';
  if(a >= 1e3) return (n/1e3).toFixed(2).replace(/\.?0+$/,'')+'K';
  return (Math.round(n*100)/100).toString();
}
export function fmtInt(n){ return n==null||isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'); }
export function fmtCost(n){ return n==null||isNaN(n) ? '—' : (Math.round(n*1000)/1000).toString(); }
export function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ---------- XML helpers (namespace-agnostic) ---------- */
export function child(node, name){ for(const c of node.children) if(c.localName===name) return c; return null; }
export function childrenOf(node, name){ return [...node.children].filter(c=>c.localName===name); }
export function attr(node, n, d){ return node && node.hasAttribute(n) ? node.getAttribute(n) : (d===undefined?null:d); }
export function numAttr(node, n){ const v = attr(node,n); return v==null ? null : parseFloat(v); }
// descendants matching localName whose nearest RelOp ancestor is `root` (stops at nested RelOps)
export function scoped(root, name){
  const out = [];
  (function walk(e){
    for(const c of e.children){
      if(c.localName==='RelOp') continue;
      if(c.localName===name) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}
export function childRelOps(relop){
  const out = [];
  (function walk(e){
    for(const c of e.children){
      if(c.localName==='RelOp'){ out.push(c); }
      else walk(c);
    }
  })(relop);
  return out;
}

/* ---------- operator icons (uniform monochrome line style) ---------- */
export function opCategory(phys){
  const p = (phys||'').toLowerCase();
  if(p.includes('seek')) return 'seek';
  if(p.includes('scan')) return 'scan';
  if(p.includes('lookup')) return 'lookup';
  if(p.includes('hash match')||p==='hash match') return 'hash';
  if(p.includes('merge')) return 'merge';
  if(p.includes('nested')||p.includes('adaptive')) return 'loop';
  if(p.includes('sort')) return 'sort';
  if(p.includes('aggregate')||p.includes('stream agg')) return 'agg';
  if(p.includes('compute')) return 'compute';
  if(p.includes('filter')) return 'filter';
  if(p.includes('top')) return 'top';
  if(p.includes('parallel')||p.includes('gather')||p.includes('repartition')||p.includes('distribute')) return 'par';
  if(p.includes('insert')||p.includes('update')||p.includes('delete')||p.includes('merge ')) return 'dml';
  return 'gen';
}
const ICONS = {
  seek:    `<rect x="3" y="4" width="11" height="14" rx="1.5"/><path d="M5.5 8h6M5.5 11h5M5.5 14h4"/><circle cx="15" cy="14" r="3"/><path d="M17.2 16.2l2.4 2.4"/>`,
  scan:    `<rect x="4" y="4" width="14" height="14" rx="1.5"/><path d="M7 8h8M7 11h8M7 14h5"/>`,
  lookup:  `<rect x="3" y="4" width="11" height="14" rx="1.5"/><path d="M5.5 8h6M5.5 11h5"/><path d="M12.5 14.5l2.2 2.2 4.3-4.7"/>`,
  hash:    `<path d="M8 4l-1.6 14M15.6 4L14 18M5 9h13M4.2 13h13"/>`,
  merge:   `<path d="M4 5l8 6M4 17l8-6"/><path d="M12 11h6"/>`,
  loop:    `<circle cx="9" cy="11" r="4"/><circle cx="14" cy="11" r="4"/>`,
  sort:    `<path d="M5 7h9M5 11h6M5 15h3"/><path d="M16 8v8M13.6 13.6L16 16l2.4-2.4"/>`,
  agg:     `<path d="M6 5h10l-6 6 6 6H6l5-6z"/>`,
  compute: `<rect x="5" y="5" width="12" height="12" rx="1.5"/><path d="M8.5 9.5h5M8.5 12.5h5"/>`,
  filter:  `<path d="M4 5h14l-5 6v6l-4-2v-4z"/>`,
  top:     `<path d="M11 5l4 6h-8z"/><path d="M6 15h10"/>`,
  par:     `<path d="M11 4v14M5 8l6-4 6 4M5 14l6 4 6-4"/>`,
  dml:     `<rect x="3" y="4" width="11" height="14" rx="1.5"/><path d="M5.5 8h6M5.5 11h6"/><path d="M13 16l5-5 2 2-5 5h-2z"/>`,
  gen:     `<circle cx="11" cy="11" r="7"/><circle cx="11" cy="11" r="2.5"/>`
};
export function iconSvg(phys){
  return `<svg viewBox="0 0 22 22" class="pn-ic" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${ICONS[opCategory(phys)]||ICONS.gen}</svg>`;
}
