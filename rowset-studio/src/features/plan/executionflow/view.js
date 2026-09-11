/* Adapted from executionflow (https://github.com/ynsuy/executionflow) by Yunus
   Uyanik, who contributes it to Rowset Studio under the Apache License 2.0. */
/* ============================================================
   view — render the plan diagram, property panel, and stats table
   ============================================================ */
import { $, el, esc, fmtNum, fmtInt, fmtCost, iconSvg, scoped } from './util.js';
import { eachNode } from './parsers/sqlserver.js';

/* ---------- layout ---------- */
const NODE_W = 168, NODE_H = 70, X_GAP = 220, Y_GAP = 92;
function layout(root){
  let leaf = 0;
  (function place(n, depth){
    n.x = depth * X_GAP;
    if(n.children.length===0){ n.y = leaf * Y_GAP; leaf++; }
    else { n.children.forEach(c=>place(c, depth+1)); n.y = n.children[0].y; }
  })(root,0);
  let maxX=0,maxY=0; eachNode(root,n=>{ maxX=Math.max(maxX,n.x); maxY=Math.max(maxY,n.y); });
  return { w: maxX + NODE_W + 20, h: maxY + NODE_H + 20 };
}

function arrowWidth(rows){
  if(rows==null || rows<=0) return 1.2;
  return Math.min(14, 1 + Math.log10(rows+1)*2.1);
}

function heatClass(pct){
  if(pct >= 50) return 'hot';
  if(pct >= 20) return 'warm';
  if(pct >= 5) return 'mild';
  return '';
}

/* ---------- render one statement's plan ---------- */
let SEL = null;
export function renderPlan(stmt, idx){
  const root = stmt.root;
  const dims = layout(root);
  const warningsByNode = new Map();
  (stmt.findings || []).forEach(f => {
    if(!f.node) return;
    const arr = warningsByNode.get(f.node) || [];
    arr.push(f.title);
    warningsByNode.set(f.node, arr);
  });

  const block = el('div');
  const head = el('div','stmt-head');
  head.innerHTML = `<h3>Statement ${idx+1} · ${esc(root.phys||'Query')}</h3>`
    + `<span class="cost">est. subtree cost ${fmtCost(root.subtree)}</span>`
    + (stmt.missingIndexPct!=null?`<span class="tag tag-cyan">Missing index: +${stmt.missingIndexPct}% impact</span>`:'');
  block.appendChild(head);
  if(stmt.text){ const s=el('div','stmt-sql'); s.textContent=stmt.text; block.appendChild(s); }

  // findings
  if(stmt.findings.length){
    const fwrap = el('div','findings');
    const order = {crit:0,warn:1,info:2};
    stmt.findings.sort((a,b)=>order[a.sev]-order[b.sev]).slice(0,18).forEach(f=>{
      const d = el('div','finding '+f.sev);
      const fic = f.sev==='info'
        ? `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.4v3.4"/><path d="M8 5h.01"/></svg>`
        : `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2L15 14H1z"/><path d="M8 6.2v3.4"/><path d="M8 11.8h.01"/></svg>`;
      d.innerHTML = `<span class="ic">${fic}</span>`
        + `<div class="ft"><strong>${esc(f.title)}</strong><span>${f.msg}</span>`
        + (f.sql?`<pre class="finding-sql">${esc(f.sql)}</pre><button class="copy-sql" type="button">Copy CREATE INDEX</button>`:'')
        + `</div>`
        + (f.node?`<span class="nid">Node ${esc(f.node.nodeId)}</span>`:'');
      if(f.node) d.addEventListener('click',()=>selectNode(f.node, block));
      if(f.sql){
        const btn = d.querySelector('.copy-sql');
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          navigator.clipboard.writeText(f.sql).then(()=>{ btn.textContent='Copied'; setTimeout(()=>btn.textContent='Copy CREATE INDEX',1500); });
        });
      }
      fwrap.appendChild(d);
    });
    block.appendChild(fwrap);
  }

  // diagram + props
  const grid = el('div','plan-wrap');
  const dbox = el('div','diagram-box');
  dbox.innerHTML = `<div class="diagram-tools">
      <button class="ztool" data-z="out" type="button" aria-label="Zoom out">−</button>
      <input class="zslider" type="range" min="25" max="200" value="100" aria-label="Zoom level"/>
      <button class="ztool" data-z="in" type="button" aria-label="Zoom in">+</button>
      <button class="ztool" data-z="fit" type="button" aria-label="Fit diagram">⤢</button></div>`;
  const tipBox = el('div','diagram-tip');
  dbox.appendChild(tipBox);
  const scroll = el('div','diagram-scroll');
  scroll.style.setProperty('--diagram-h', Math.max(220, Math.min(620, dims.h + 48)) + 'px');
  const canvas = el('div','canvas');
  canvas.style.width = dims.w+'px'; canvas.style.height = dims.h+'px';

  const svgNS='http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('class','links');
  svg.setAttribute('width',dims.w); svg.setAttribute('height',dims.h);
  canvas.appendChild(svg);

  const maxCost = Math.max(...(()=>{const a=[];eachNode(root,n=>a.push(n.ownCost));return a;})());
  // links (child -> parent). children are to the right, arrow flows left into parent.
  eachNode(root, n=>{
    n.children.forEach(c=>{
      const x1 = c.x, y1 = c.y + NODE_H/2;              // child left edge
      const x2 = n.x + NODE_W, y2 = n.y + NODE_H/2;     // parent right edge
      const mx = (x1+x2)/2;
      const path = document.createElementNS(svgNS,'path');
      path.setAttribute('d',`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
      path.setAttribute('fill','none');
      const rows = c.actRows!=null ? c.actRows : (c.estRows!=null?c.estRows:0);
      path.setAttribute('class', 'flow-edge');
      path.setAttribute('stroke-width', arrowWidth(rows));
      path.setAttribute('stroke-linecap','round');
      svg.appendChild(path);
      const lbl = el('div','arrow-lbl');
      lbl.style.left = mx+'px'; lbl.style.top = ((y1+y2)/2 - 9)+'px';
      lbl.textContent = fmtNum(rows);
      canvas.appendChild(lbl);
    });
  });

  // nodes
  eachNode(root, n=>{
    const box = el('div','pnode');
    n._box = box;
    box.style.left = n.x+'px'; box.style.top = n.y+'px';
    const sev = n.warnings.includes('crit')?'crit':(n.warnings.includes('warn')?'warn':null);
    const pct = n.costPct||0;
    const heat = heatClass(maxCost>0 && n.ownCost===maxCost ? Math.max(pct, 35) : pct);
    if(heat) box.classList.add('heat-' + heat);
    if(sev) box.classList.add('sev-' + sev);
    const tip = warningsByNode.has(n) ? warningsByNode.get(n).join(' · ') : 'Operator warning';
    box.innerHTML = `
      ${sev?`<div class="pn-warn ${sev==='crit'?'crit':''}" data-tip="${esc(tip)}">!</div>`:''}
      <div class="pn-top">${iconSvg(n.phys)}<div><div class="pn-name">${esc(n.phys||'Operator')}</div></div></div>
      ${n.objTable?`<div class="pn-obj">${esc(n.objTable)}${n.objIndex?'.'+esc(n.objIndex):''}</div>`:''}
      <div class="pn-meta"><span class="pn-cost">${pct.toFixed(0)}%</span><span>${fmtNum(n.actRows!=null?n.actRows:n.estRows)} rows</span></div>
      <div class="costbar"><i style="width:${Math.min(100,pct)}%"></i></div>`;
    box.addEventListener('click',()=>selectNode(n, block));
    const warn = box.querySelector('.pn-warn');
    if(warn){
      warn.addEventListener('pointerenter', () => showTip(warn, tip));
      warn.addEventListener('pointerleave', hideTip);
      warn.addEventListener('focus', () => showTip(warn, tip));
      warn.addEventListener('blur', hideTip);
    }
    canvas.appendChild(box);
  });

  scroll.appendChild(canvas);
  dbox.appendChild(scroll);

  const legend = el('div','legend');
  legend.innerHTML = `<span>Arrow thickness and colour = row pressure</span><span>Card heat = operator cost</span><span>! = warning</span><span>Data flows right to left</span>`;

  const props = el('div','props');
  props.innerHTML = `<div class="placeholder">Click any operator to see its full properties — estimates vs. actuals, predicates, object, and cost breakdown.</div>`;
  block._props = props;

  grid.appendChild(dbox);
  grid.appendChild(props);
  block.appendChild(grid);
  block.appendChild(legend);

  /* zoom / pan */
  let zoom = 1;
  const slider = dbox.querySelector('.zslider');
  function applyZoom(){
    canvas.style.transform = `scale(${zoom})`;
    canvas.style.width = (dims.w * zoom)+'px';
    canvas.style.height = (dims.h * zoom)+'px';
    svg.setAttribute('width',dims.w);
    svg.setAttribute('height',dims.h);
    slider.value = Math.round(zoom * 100);
  }
  function fit(){
    const aw = scroll.clientWidth - 48, ah = scroll.clientHeight - 48;
    zoom = Math.min(1, Math.min(aw/dims.w, ah/dims.h));
    if(!isFinite(zoom)||zoom<=0) zoom=1;
    applyZoom();
    scroll.scrollLeft = 0;
    scroll.scrollTop = 0;
  }
  function zoomAt(next, cx, cy){
    const old = zoom;
    next = Math.max(.25, Math.min(2, next));
    if(next === old) return;
    const rect = scroll.getBoundingClientRect();
    const x = cx - rect.left + scroll.scrollLeft;
    const y = cy - rect.top + scroll.scrollTop;
    zoom = next;
    applyZoom();
    scroll.scrollLeft = (x / old) * zoom - (cx - rect.left);
    scroll.scrollTop = (y / old) * zoom - (cy - rect.top);
  }
  dbox.querySelectorAll('.ztool').forEach(b=>b.addEventListener('click',()=>{
    const z=b.dataset.z;
    if(z==='fit') return fit();
    const rect = scroll.getBoundingClientRect();
    zoomAt(z==='in' ? zoom*1.18 : zoom/1.18, rect.left + rect.width/2, rect.top + rect.height/2);
  }));
  slider.addEventListener('input', () => {
    const rect = scroll.getBoundingClientRect();
    zoomAt(Number(slider.value) / 100, rect.left + rect.width/2, rect.top + rect.height/2);
  });
  scroll.addEventListener('wheel', e=>{
    if(e.ctrlKey || e.metaKey || e.shiftKey){
      e.preventDefault();
      zoomAt(zoom * (e.deltaY < 0 ? 1.08 : .92), e.clientX, e.clientY);
    }
  }, {passive:false});
  // drag to pan
  let down=false,sx,sy,sl,st;
  scroll.addEventListener('pointerdown',e=>{ if(e.target.closest('.pnode')) return; down=true; scroll.setPointerCapture(e.pointerId); scroll.classList.add('panning'); sx=e.clientX; sy=e.clientY; sl=scroll.scrollLeft; st=scroll.scrollTop; });
  scroll.addEventListener('pointermove',e=>{ if(!down) return; scroll.scrollLeft=sl-(e.clientX-sx); scroll.scrollTop=st-(e.clientY-sy); });
  scroll.addEventListener('pointerup',()=>{ down=false; scroll.classList.remove('panning'); });
  scroll.addEventListener('pointercancel',()=>{ down=false; scroll.classList.remove('panning'); });
  setTimeout(fit,30);

  function showTip(anchor, text){
    tipBox.textContent = text;
    tipBox.classList.add('show');
    const a = anchor.getBoundingClientRect();
    const d = dbox.getBoundingClientRect();
    const topSpace = a.top - d.top;
    const below = topSpace < 76;
    tipBox.classList.toggle('below', below);
    tipBox.style.top = (below ? a.bottom - d.top + 8 : a.top - d.top - 8) + 'px';
    tipBox.style.left = '0px';
    tipBox.style.maxWidth = Math.min(320, d.width - 28) + 'px';
    requestAnimationFrame(() => {
      const t = tipBox.getBoundingClientRect();
      const desired = a.left - d.left + a.width / 2 - t.width / 2;
      const left = Math.min(d.width - t.width - 14, Math.max(14, desired));
      tipBox.style.left = left + 'px';
    });
  }
  function hideTip(){ tipBox.classList.remove('show'); }

  // auto-select costliest
  let costly=root; eachNode(root,n=>{ if(n.ownCost> (costly.ownCost||0)) costly=n; });
  stmt._defaultSel = costly; stmt._block = block;
  setTimeout(()=>selectNode(costly, block), 40);

  return block;
}

function propRow(k,v,cls){ return `<div class="prow"><span class="k">${esc(k)}</span><span class="v ${cls||''}">${v}</span></div>`; }

function selectNode(n, block){
  if(SEL && SEL._box) SEL._box.classList.remove('sel');
  SEL = n; if(n._box){ n._box.classList.add('sel'); n._box.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'}); }
  const p = block._props;
  let html = `<h4>${esc(n.phys||'Operator')}</h4><div class="sub">${esc(n.logical||'')} · Node ${esc(n.nodeId)}</div>`;

  html += `<div class="pgroup">Cost</div>`;
  html += propRow('Operator cost', (n.costPct||0).toFixed(1)+'%');
  html += propRow('Operator subtree cost', fmtCost(n.ownCost));
  html += propRow('Estimated subtree cost', fmtCost(n.subtree));
  if(n.estCPU!=null) html += propRow('Estimated CPU cost', fmtCost(n.estCPU));
  if(n.estIO!=null)  html += propRow('Estimated I/O cost', fmtCost(n.estIO));

  html += `<div class="pgroup">Rows</div>`;
  html += propRow('Estimated rows (per exec)', fmtNum(n.estRows));
  if(n.estRowsRead!=null) html += propRow('Estimated rows read', fmtNum(n.estRowsRead));
  if(n.actRows!=null){
    html += propRow('Actual rows (total)', fmtInt(n.actRows));
    if(n.actExec!=null) html += propRow('Number of executions', fmtInt(n.actExec));
    if(n.actExec){
      const per = n.actRows/Math.max(1,n.actExec);
      let cls=''; if(n.estRows>0){ const r=per/n.estRows; if(r>=10||r<=0.1) cls='bad'; }
      html += propRow('Actual rows / exec', fmtNum(per), cls);
    }
    if(n.actRowsRead!=null) html += propRow('Actual rows read', fmtInt(n.actRowsRead), (n.actRows!=null && n.actRowsRead>n.actRows*10)?'bad':'');
  }
  if(n.avgRowSize!=null) html += propRow('Avg row size (B)', fmtInt(n.avgRowSize));

  if(n.actReads!=null){
    html += `<div class="pgroup">I/O</div>`;
    html += propRow('Actual logical reads', fmtInt(n.actReads), n.actReads>100000?'bad':'');
  }
  if(n.actTimeEnd!=null){
    html += `<div class="pgroup">Runtime</div>`;
    html += propRow('Actual time start', fmtCost(n.actTimeStart)+' ms');
    html += propRow('Actual time end', fmtCost(n.actTimeEnd)+' ms');
  }

  if(n.objTable){
    html += `<div class="pgroup">Object</div>`;
    html += propRow('Table', esc(n.objTable));
    if(n.objIndex) html += propRow('Index', esc(n.objIndex));
    if(n.actJoinType) html += propRow('Actual join type', esc(n.actJoinType));
  }

  if(n.props && Object.keys(n.props).length){
    html += `<div class="pgroup">Operator properties</div>`;
    Object.entries(n.props).forEach(([k,v])=>{
      if(v==null || v==='') return;
      const val = typeof v === 'string' && v.length > 90 ? `<div class="pcode">${esc(v)}</div>` : propRow(k.replace(/_/g,' '), esc(v));
      html += val;
    });
  }

  // predicates
  const preds = [];
  if(n.relop){
    scoped(n.relop,'SeekPredicateNew').forEach(sp=>{ const so=sp.querySelector('[ScalarString]'); if(so) preds.push(['Seek predicate', so.getAttribute('ScalarString')]); });
    scoped(n.relop,'Predicate').forEach(pr=>{ const so=pr.querySelector('[ScalarString]'); if(so) preds.push(['Predicate', so.getAttribute('ScalarString')]); });
    scoped(n.relop,'ProbeResidual').forEach(pr=>{ const so=pr.querySelector('[ScalarString]'); if(so) preds.push(['Probe residual', so.getAttribute('ScalarString')]); });
  }
  if(n.predicate) preds.push(['Attached condition', n.predicate]);
  if(preds.length){
    html += `<div class="pgroup">Predicates</div>`;
    preds.forEach(([k,v])=>{ html += `<div class="prow"><span class="k">${esc(k)}</span></div><div class="pcode">${esc(v)}</div>`; });
  }

  p.innerHTML = html;
}

/* ---------- render stats ---------- */
let statsSort = {key:'logical',dir:-1};
export function renderStats(s){
  const out = $('#statsOut');
  out.innerHTML='';
  const cards = el('div','stat-cards');
  function card(lbl,big,unit,sub){ return `<div class="stat-card"><div class="lbl">${lbl}</div><div class="big">${big}<span class="u">${unit||''}</span></div>${sub?`<div class="sub">${sub}</div>`:''}</div>`; }
  let ch='';
  if(s.hasTime){
    ch += card('Execution CPU', fmtInt(s.execCpu), ' ms', 'compile: '+fmtInt(s.compileCpu)+' ms');
    ch += card('Execution elapsed', fmtInt(s.execElapsed), ' ms', s.execElapsed>0 && s.execCpu/s.execElapsed<0.6 ? 'CPU &lt; elapsed → waits/IO bound' : 'mostly CPU bound');
  }
  if(s.hasIo){
    ch += card('Total logical reads', fmtInt(s.totalLogical), '', fmtInt(s.totalLogical*8/1024)+' MB touched');
    ch += card('Total physical reads', fmtInt(s.totalPhysical), '', s.totalPhysical>0?'cold cache / eviction':'all from cache');
  }
  if(s.rowsAffected) ch += card('Rows returned', fmtInt(s.rowsAffected),'');
  cards.innerHTML = ch;
  out.appendChild(cards);

  if(s.hasIo && s.tables.length){
    const max = Math.max(...s.tables.map(t=>t.logical));
    const wrap = el('div');
    wrap.innerHTML = `<h3 style="font-size:.95rem;font-weight:600;margin-bottom:.6rem">Logical reads by table</h3>`;
    const tbl = el('table','iotable');
    const cols = [['table','Table',false],['logical','Logical reads',true],['__bar','',false],['physical','Physical',true],['readAhead','Read-ahead',true],['scan','Scans',true]];
    const sorted = s.tables.slice().sort((a,b)=> statsSort.dir * ((a[statsSort.key]>b[statsSort.key])?1:(a[statsSort.key]<b[statsSort.key]?-1:0)));
    let th='<tr>'; cols.forEach(c=>{ th+=`<th class="${c[2]?'num':''}" data-k="${c[0]}">${c[1]}${c[0]===statsSort.key?(statsSort.dir<0?' ▾':' ▴'):''}</th>`; }); th+='</tr>';
    let body='';
    sorted.forEach(t=>{
      const pctOfTotal = s.totalLogical>0 ? (t.logical/s.totalLogical*100) : 0;
      const hot = pctOfTotal>=50 || t.logical===max && max>50000;
      body += `<tr class="${hot?'hot':''}">`
        + `<td class="tname">${esc(t.table)}</td>`
        + `<td class="num">${fmtInt(t.logical)}</td>`
        + `<td class="iobar-cell"><div class="iobar ${hot?'hot':''}"><i style="width:${max>0?(t.logical/max*100):0}%"></i></div></td>`
        + `<td class="num">${fmtInt(t.physical)}</td>`
        + `<td class="num">${fmtInt(t.readAhead)}</td>`
        + `<td class="num">${fmtInt(t.scan)}</td></tr>`;
    });
    tbl.innerHTML = th+body;
    tbl.querySelectorAll('th[data-k]').forEach(h=>{ if(h.dataset.k==='__bar'||h.dataset.k==='table') return; h.addEventListener('click',()=>{ const k=h.dataset.k; if(statsSort.key===k) statsSort.dir*=-1; else { statsSort.key=k; statsSort.dir=-1; } renderStats(s); }); });
    wrap.appendChild(tbl);
    const note = el('div','reads-note');
    const worst = s.tables.slice().sort((a,b)=>b.logical-a.logical)[0];
    if(worst) note.innerHTML = `<strong>${esc(worst.table)}</strong> accounts for ${(worst.logical/s.totalLogical*100).toFixed(0)}% of all logical reads (${fmtInt(worst.logical)} pages ≈ ${fmtInt(worst.logical*8/1024)} MB). Focus indexing there first.`;
    wrap.appendChild(note);
    out.appendChild(wrap);
  }
}
