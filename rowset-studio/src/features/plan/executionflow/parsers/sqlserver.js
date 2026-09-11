/* Adapted from executionflow (https://github.com/ynsuy/executionflow) by Yunus
   Uyanik, who contributes it to Rowset Studio under the Apache License 2.0. */
/* ============================================================
   parsers/sqlserver — ShowPlanXML -> plan tree + findings,
   and SET STATISTICS IO/TIME -> aggregates.
   ============================================================ */
import { attr, numAttr, child, childrenOf, scoped, childRelOps, esc, fmtNum, fmtInt, opCategory } from '../util.js';

/* ---------- build node model from a RelOp ---------- */
function buildNode(relop){
  const phys = attr(relop,'PhysicalOp');
  const logical = attr(relop,'LogicalOp');
  const node = {
    relop, phys, logical,
    nodeId: attr(relop,'NodeId'),
    estRows: numAttr(relop,'EstimateRows'),
    estRowsRead: numAttr(relop,'EstimatedRowsRead'),
    avgRowSize: numAttr(relop,'AvgRowSize'),
    estCPU: numAttr(relop,'EstimateCPU'),
    estIO: numAttr(relop,'EstimateIO'),
    subtree: numAttr(relop,'EstimatedTotalSubtreeCost') || 0,
    parallel: attr(relop,'Parallel')==='true',
    children: [],
    warnings: []
  };
  // actuals (sum across threads of THIS op's RunTimeInformation)
  const rti = child(relop,'RunTimeInformation');
  if(rti){
    let aRows=0, aExec=0, aReads=0, aRowsRead=0, hasAct=false, threads=0;
    for(const t of childrenOf(rti,'RunTimeCountersPerThread')){
      hasAct = true; threads++;
      aRows     += numAttr(t,'ActualRows')||0;
      aExec     += numAttr(t,'ActualExecutions')||0;
      aReads    += numAttr(t,'ActualLogicalReads')||0;
      aRowsRead += (numAttr(t,'ActualRowsRead')!=null?numAttr(t,'ActualRowsRead'):0);
    }
    if(hasAct){
      node.actRows = aRows; node.actExec = aExec; node.actReads = aReads;
      node.actRowsRead = aRowsRead; node.threads = threads;
      const last = childrenOf(rti,'RunTimeCountersPerThread').slice(-1)[0];
      node.actJoinType = attr(last,'ActualJoinType');
    }
  }
  // object (table / index)
  const obj = scoped(relop,'Object')[0];
  if(obj){
    node.objTable = (attr(obj,'Table')||'').replace(/[\[\]]/g,'');
    node.objIndex = (attr(obj,'Index')||'').replace(/[\[\]]/g,'');
    node.objSchema = (attr(obj,'Schema')||'').replace(/[\[\]]/g,'');
  }
  return node;
}

function buildTree(relop){
  const node = buildNode(relop);
  const kids = childRelOps(relop).map(buildTree);
  node.children = kids;
  const childSum = kids.reduce((s,k)=>s + (k.subtree||0), 0);
  node.ownCost = Math.max(0, (node.subtree||0) - childSum);
  return node;
}

export function eachNode(node, fn){ fn(node); node.children.forEach(c=>eachNode(c,fn)); }

/* ---------- warning detection ---------- */
function detectWarnings(root, stmtFindings){
  const total = root.subtree || 1;
  eachNode(root, n => {
    n.costPct = total>0 ? (n.ownCost/total)*100 : 0;

    // explicit <Warnings> element
    const w = scoped(n.relop,'Warnings')[0];
    if(w){
      for(const c of w.children){
        const ln = c.localName;
        if(ln==='SpillToTempDb'){ n.warnings.push('crit'); stmtFindings.push({sev:'crit',node:n,title:'Spill to tempdb',msg:(n.phys||'Operator')+' spilled to tempdb (level '+(attr(c,'SpillLevel')||'?')+') — memory grant too small.'}); }
        else if(ln==='SortSpillDetails'||ln==='HashSpillDetails'){ n.warnings.push('crit'); stmtFindings.push({sev:'crit',node:n,title:'Operator spill',msg:(n.phys||'Operator')+' spilled working data to disk.'}); }
        else if(ln==='ColumnsWithNoStatistics'){ n.warnings.push('warn'); stmtFindings.push({sev:'warn',node:n,title:'Columns with no statistics',msg:'Optimizer is guessing — missing column statistics on '+(n.objTable||'a table')+'.'}); }
        else if(ln==='NoJoinPredicate'){ n.warnings.push('crit'); stmtFindings.push({sev:'crit',node:n,title:'No join predicate',msg:'Cartesian product — join has no predicate.'}); }
        else if(ln==='PlanAffectingConvert'){ n.warnings.push('warn'); stmtFindings.push({sev:'warn',node:n,title:'Plan-affecting conversion',msg:esc(attr(c,'Expression')||'Implicit conversion may prevent index seeks.')}); }
        else { n.warnings.push('warn'); stmtFindings.push({sev:'warn',node:n,title:ln,msg:'Operator warning: '+ln}); }
      }
    }

    // cardinality misestimate (per-execution actual vs estimate)
    if(n.actRows!=null && n.estRows!=null && n.actExec){
      const actPer = n.actRows / Math.max(1,n.actExec);
      const est = n.estRows;
      if(est>0 && (actPer>200 || est>200)){
        const ratio = actPer/est;
        if(ratio>=10 || ratio<=0.1){
          n.warnings.push('warn');
          stmtFindings.push({sev: (ratio>=100||ratio<=0.01)?'crit':'warn', node:n,
            title:'Cardinality misestimate',
            msg:(n.phys||'Operator')+' on '+(n.objTable||'?')+': estimated '+fmtNum(est)+' rows/exec, actual '+fmtNum(actPer)+' ('+(ratio>=1?ratio.toFixed(0)+'× high':(1/ratio).toFixed(0)+'× low')+').'});
        }
      }
    }

    // read amplification on seeks/scans (rows read >> rows output)
    if(n.estRowsRead!=null && n.estRows!=null && n.estRowsRead > n.estRows*10 && n.estRowsRead>1000){
      n.warnings.push('warn');
      stmtFindings.push({sev:'warn',node:n,title:'Residual / read amplification',
        msg:(n.phys||'Operator')+' on '+(n.objTable||'?')+' reads ~'+fmtNum(n.estRowsRead)+' rows but returns ~'+fmtNum(n.estRows)+' — predicate not fully covered by the index.'});
    }
    if(n.actRowsRead!=null && n.actRows!=null && n.actRowsRead > n.actRows*10 && n.actRowsRead>10000){
      if(!n.warnings.length) n.warnings.push('warn');
      stmtFindings.push({sev:'warn',node:n,title:'Read amplification (actual)',
        msg:(n.phys||'Operator')+' on '+(n.objTable||'?')+' actually read '+fmtNum(n.actRowsRead)+' rows to return '+fmtNum(n.actRows)+'.'});
    }

    // heavy I/O
    if(n.actReads!=null && n.actReads > 100000){
      n.warnings.push(n.actReads>1000000?'crit':'warn');
      stmtFindings.push({sev:n.actReads>1000000?'crit':'warn',node:n,title:'Expensive I/O',
        msg:(n.phys||'Operator')+' on '+(n.objTable||'?')+' did '+fmtInt(n.actReads)+' logical reads'+(n.actExec>1?' across '+fmtInt(n.actExec)+' executions':'')+'.'});
    }

    // key/RID lookup
    if(opCategory(n.phys)==='lookup'){
      n.warnings.push('warn');
      stmtFindings.push({sev:'warn',node:n,title:'Key / RID lookup',msg:'Lookup on '+(n.objTable||'?')+' — a covering index could remove it.'});
    }
  });

  // estimated-vs-actual join type switch (adaptive)
  eachNode(root, n=>{
    if(n.actJoinType && n.phys && n.phys.includes('Adaptive')){
      stmtFindings.push({sev:'info',node:n,title:'Adaptive join resolved to '+n.actJoinType,msg:'Optimizer chose '+n.actJoinType+' at runtime.'});
    }
  });
}

/* ---------- missing-index CREATE script (ix_dbaops_ prefix) ---------- */
function missingIndexSql(idx){
  const schema = (idx.getAttribute('Schema')||'[dbo]').replace(/[\[\]]/g,'');
  const table  = (idx.getAttribute('Table')||'').replace(/[\[\]]/g,'');
  const eq=[], ineq=[], inc=[];
  [...idx.getElementsByTagName('*')].forEach(grp=>{
    if(grp.localName!=='ColumnGroup') return;
    const usage = grp.getAttribute('Usage');
    [...grp.getElementsByTagName('*')].forEach(c=>{
      if(c.localName!=='Column') return;
      const n = (c.getAttribute('Name')||'').replace(/[\[\]]/g,'');
      if(!n) return;
      if(usage==='EQUALITY') eq.push(n);
      else if(usage==='INEQUALITY') ineq.push(n);
      else if(usage==='INCLUDE') inc.push(n);
    });
  });
  const keys = [...eq, ...ineq];
  if(!table || !keys.length) return null;
  const name = 'ix_dbaops_' + table + '_' + keys.join('_');
  let sql = 'CREATE NONCLUSTERED INDEX [' + name + ']\n'
          + '    ON [' + schema + '].[' + table + '] (' + keys.map(k=>'['+k+']').join(', ') + ')';
  if(inc.length) sql += '\n    INCLUDE (' + inc.map(k=>'['+k+']').join(', ') + ')';
  sql += ';';
  return sql;
}

/* ---------- parse full ShowPlanXML ---------- */
export function parsePlan(text){
  if(!text || !String(text).trim()){
    return { ok:false, error:'Paste a SQL Server ShowPlanXML plan first.', statements:[] };
  }
  const start = text.search(/<\s*ShowPlanXML[\s>]/i);
  if(start<0) return { ok:false, error:'Could not find SQL Server ShowPlanXML in that input.', statements:[] };
  let xml = text.slice(start);
  const endIdx = xml.search(/<\/\s*ShowPlanXML\s*>/i);
  if(endIdx>=0){ const m=xml.match(/<\/\s*ShowPlanXML\s*>/i); xml = xml.slice(0, endIdx + m[0].length); }
  xml = '<' + xml.replace(/^</,''); // keep
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if(doc.querySelector('parsererror')) return { ok:false, error:'Could not parse the ShowPlanXML (malformed XML).', statements:[] };

  const stmts = [];
  const stmtEls = [...doc.getElementsByTagName('*')].filter(e=>e.localName==='StmtSimple');
  for(const s of stmtEls){
    const qp = [...s.children].find(c=>c.localName==='QueryPlan');
    if(!qp) continue;
    const rootRelop = [...qp.children].find(c=>c.localName==='RelOp');
    if(!rootRelop) continue;
    const root = buildTree(rootRelop);
    const findings = [];
    detectWarnings(root, findings);

    // statement-level extras — missing indexes + CREATE script (ix_dbaops_ prefix)
    const mi = [...qp.children].find(c=>c.localName==='MissingIndexes');
    let missingIndexPct = null;
    if(mi){
      [...mi.getElementsByTagName('*')].filter(e=>e.localName==='MissingIndexGroup').forEach(g=>{
        const impact = Math.round(parseFloat(g.getAttribute('Impact')||'0'));
        if(missingIndexPct==null) missingIndexPct = impact;
        const idx = [...g.getElementsByTagName('*')].find(e=>e.localName==='MissingIndex');
        if(!idx) return;
        const sql = missingIndexSql(idx);
        const tbl = (idx.getAttribute('Table')||'').replace(/[\[\]]/g,'');
        findings.unshift({ sev:'crit', node:null,
          title:'Missing index ('+impact+'% estimated improvement)',
          msg:'SQL Server suggests a new nonclustered index on '+esc(tbl)+'. Review selectivity before creating it in production:',
          sql: sql });
      });
    }
    // implicit conversion scan (whole statement text region)
    if(/CONVERT_IMPLICIT/i.test(s.outerHTML)){
      findings.push({sev:'warn',node:null,title:'Implicit conversion',msg:'CONVERT_IMPLICIT found — a data-type mismatch may be preventing index seeks.'});
    }

    stmts.push({
      root,
      text: (attr(s,'StatementText')||'').replace(/\s+/g,' ').trim().slice(0,1200),
      subtree: numAttr(s,'StatementSubTreeCost'),
      findings, missingIndexPct
    });
  }
  if(!stmts.length){
    return { ok:false, error:'Could not find a SQL Server statement plan in that ShowPlanXML.', statements:[] };
  }
  return { ok:true, statements: stmts };
}

/* ---------- parse STATISTICS IO / TIME ---------- */
export function parseStats(text){
  if(!/Scan count|SQL Server Execution Times|parse and compile/i.test(text)) return null;
  const res = { compileCpu:0, compileElapsed:0, execCpu:0, execElapsed:0, rowsAffected:0, tables:[], hasTime:false, hasIo:false };

  const comp = text.match(/parse and compile time:\s*[\r\n]+\s*CPU time\s*=\s*(\d+)\s*ms,\s*elapsed time\s*=\s*(\d+)\s*ms/i);
  if(comp){ res.compileCpu=+comp[1]; res.compileElapsed=+comp[2]; res.hasTime=true; }

  // sum all execution-time blocks
  const reExec = /SQL Server Execution Times:\s*[\r\n]+\s*CPU time\s*=\s*(\d+)\s*ms,\s*elapsed time\s*=\s*(\d+)\s*ms/gi;
  let m;
  while((m = reExec.exec(text))){ res.execCpu += +m[1]; res.execElapsed += +m[2]; res.hasTime=true; }

  let rows=0; const reRows=/\((\d[\d,]*)\s+rows? affected\)/gi;
  while((m=reRows.exec(text))){ rows += +m[1].replace(/,/g,''); }
  res.rowsAffected = rows;

  // per-table IO lines
  const tmap = {};
  const reTab = /Table '([^']+)'\.\s*Scan count (\d+),\s*logical reads (\d+),\s*physical reads (\d+)(?:,\s*page server reads \d+)?,\s*read-ahead reads (\d+)[^.]*?(?:lob logical reads (\d+))?[^.]*?\./gi;
  while((m = reTab.exec(text))){
    const name=m[1];
    const o = tmap[name] || (tmap[name]={table:name,scan:0,logical:0,physical:0,readAhead:0,lob:0});
    o.scan += +m[2]; o.logical += +m[3]; o.physical += +m[4]; o.readAhead += +(m[5]||0); o.lob += +(m[6]||0);
    res.hasIo = true;
  }
  res.tables = Object.values(tmap);
  res.totalLogical = res.tables.reduce((s,t)=>s+t.logical,0);
  res.totalPhysical = res.tables.reduce((s,t)=>s+t.physical,0);
  if(!res.hasTime && !res.hasIo) return null;
  return res;
}
