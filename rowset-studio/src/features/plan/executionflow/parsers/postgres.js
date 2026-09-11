/* Adapted from executionflow (https://github.com/ynsuy/executionflow) by Yunus
   Uyanik, who contributes it to Rowset Studio under the Apache License 2.0. */
/* ============================================================
   parsers/postgres — EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
   ============================================================ */

function num(v){
  if(v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g,''));
  return Number.isFinite(n) ? n : null;
}

function escHtml(s){
  return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function extractFirstJson(text){
  const obj = text.indexOf('{');
  const arr = text.indexOf('[');
  let start = -1;
  if(obj >= 0 && arr >= 0) start = Math.min(obj, arr);
  else start = Math.max(obj, arr);
  if(start < 0) return null;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for(let i = start; i < text.length; i++){
    const ch = text[i];
    if(inStr){
      if(esc) esc = false;
      else if(ch === '\\') esc = true;
      else if(ch === '"') inStr = false;
      continue;
    }
    if(ch === '"') inStr = true;
    else if(ch === open) depth++;
    else if(ch === close){
      depth--;
      if(depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

let nodeSeq = 0;
function readBuffers(p){
  return [
    'Shared Hit Blocks',
    'Shared Read Blocks',
    'Shared Dirtied Blocks',
    'Shared Written Blocks',
    'Local Hit Blocks',
    'Local Read Blocks',
    'Local Dirtied Blocks',
    'Local Written Blocks',
    'Temp Read Blocks',
    'Temp Written Blocks'
  ].reduce((sum, k) => sum + (num(p[k]) || 0), 0);
}

function opName(p){
  const type = p['Node Type'] || 'Plan Node';
  if(type === 'Aggregate' && p.Strategy) return p.Strategy + ' Aggregate';
  if(type === 'Join' && p['Join Type']) return p['Join Type'] + ' Join';
  return type;
}

function buildNode(p){
  const n = {
    engine: 'postgres',
    phys: opName(p),
    logical: p['Parent Relationship'] || p['Node Type'] || opName(p),
    nodeId: String(++nodeSeq),
    children: (p.Plans || []).map(buildNode),
    warnings: [],
    props: {}
  };

  n.estRows = num(p['Plan Rows']);
  n.avgRowSize = num(p['Plan Width']);
  n.subtree = num(p['Total Cost']) || 0;
  n.ownCost = Math.max(0, n.subtree - n.children.reduce((s, c) => s + (c.subtree || 0), 0));

  const actualRows = num(p['Actual Rows']);
  const loops = num(p['Actual Loops']);
  if(actualRows != null){
    n.actRows = actualRows * Math.max(1, loops || 1);
    n.actExec = loops;
  }
  n.actTimeStart = num(p['Actual Startup Time']);
  n.actTimeEnd = num(p['Actual Total Time']);
  n.actRowsRead = n.actRows != null && p['Rows Removed by Filter'] != null
    ? n.actRows + (num(p['Rows Removed by Filter']) || 0)
    : null;
  n.actReads = readBuffers(p);

  n.objTable = p['Relation Name'] || null;
  n.objSchema = p.Schema || null;
  n.objIndex = p['Index Name'] || null;
  n.parallel = p['Parallel Aware'] === true;

  const preds = [
    p.Filter,
    p['Index Cond'],
    p['Recheck Cond'],
    p['Hash Cond'],
    p['Merge Cond'],
    p['Join Filter']
  ].filter(Boolean);
  if(preds.length) n.predicate = preds.join('\n');

  [
    'Strategy',
    'Join Type',
    'Partial Mode',
    'Parallel Aware',
    'Async Capable',
    'Workers Planned',
    'Workers Launched',
    'Rows Removed by Filter',
    'Rows Removed by Join Filter',
    'Sort Key',
    'Sort Method',
    'Sort Space Used',
    'Sort Space Type',
    'Hash Buckets',
    'Hash Batches',
    'Peak Memory Usage',
    'Shared Hit Blocks',
    'Shared Read Blocks',
    'Temp Read Blocks',
    'Temp Written Blocks'
  ].forEach(k => {
    if(p[k] != null) n.props[k] = Array.isArray(p[k]) ? p[k].join(', ') : String(p[k]);
  });

  return n;
}

function eachNode(node, fn){ fn(node); node.children.forEach(c => eachNode(c, fn)); }

function detect(root, findings){
  const total = root.subtree || 1;
  eachNode(root, n => {
    n.costPct = total > 0 ? ((n.ownCost || 0) / total) * 100 : 0;

    if((n.phys || '').toLowerCase().includes('seq scan') && n.objTable){
      n.warnings.push('warn');
      findings.push({
        sev: 'warn',
        node: n,
        title: 'Sequential scan',
        msg: 'PostgreSQL scanned ' + escHtml(n.objTable) + '. Check whether predicates and join columns are supported by selective indexes.'
      });
    }

    if(n.actRows != null && n.estRows != null && n.actExec){
      const actPer = n.actRows / Math.max(1, n.actExec);
      const est = n.estRows;
      if(est > 0 && (actPer > 200 || est > 200)){
        const ratio = actPer / est;
        if(ratio >= 10 || ratio <= 0.1){
          n.warnings.push('warn');
          findings.push({
            sev: ratio >= 100 || ratio <= 0.01 ? 'crit' : 'warn',
            node: n,
            title: 'Estimate vs actual mismatch',
            msg: 'Estimated ' + est + ' rows/loop, actual ' + Math.round(actPer) + ' rows/loop.'
          });
        }
      }
    }

    const removed = num(n.props['Rows Removed by Filter']) || 0;
    if(removed > 10000 && n.actRows != null && removed > n.actRows * 2){
      n.warnings.push('warn');
      findings.push({
        sev: 'warn',
        node: n,
        title: 'Rows removed by filter',
        msg: (n.phys || 'Operator') + ' removed ' + Math.round(removed).toLocaleString('en-US') + ' rows after reading them.'
      });
    }

    if(n.actReads > 50000){
      n.warnings.push(n.actReads > 500000 ? 'crit' : 'warn');
      findings.push({
        sev: n.actReads > 500000 ? 'crit' : 'warn',
        node: n,
        title: 'High buffer usage',
        msg: (n.phys || 'Operator') + ' touched ' + Math.round(n.actReads).toLocaleString('en-US') + ' buffer blocks.'
      });
    }

    const tempBlocks = (num(n.props['Temp Read Blocks']) || 0) + (num(n.props['Temp Written Blocks']) || 0);
    if(tempBlocks > 0 || /external/i.test(n.props['Sort Method'] || '') || (num(n.props['Hash Batches']) || 1) > 1){
      n.warnings.push('crit');
      findings.push({
        sev: 'crit',
        node: n,
        title: 'Disk spill / batching',
        msg: (n.phys || 'Operator') + ' used temporary disk blocks or multiple hash batches. Review work_mem and row estimates.'
      });
    }
  });
}

export function parsePlan(text){
  nodeSeq = 0;
  if(!text || !String(text).trim()){
    return { ok:false, error:'Paste a PostgreSQL EXPLAIN FORMAT JSON output first.', statements:[] };
  }
  const jsonText = extractFirstJson(text);
  if(!jsonText) return { ok:false, error:'Could not find PostgreSQL EXPLAIN FORMAT JSON output in that input.', statements:[] };

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch(err){
    return { ok:false, error:'Could not parse the PostgreSQL EXPLAIN FORMAT JSON output.', statements:[] };
  }

  const docs = Array.isArray(parsed) ? parsed : [parsed];
  const statements = [];
  docs.forEach((doc, i) => {
    const plan = doc && (doc.Plan || (doc[0] && doc[0].Plan));
    if(!plan) return;
    const root = buildNode(plan);
    const findings = [];
    detect(root, findings);
    const planning = num(doc['Planning Time']);
    const execution = num(doc['Execution Time']);
    const suffix = [
      planning != null ? 'planning ' + planning + ' ms' : null,
      execution != null ? 'execution ' + execution + ' ms' : null
    ].filter(Boolean).join(', ');
    statements.push({
      engine: 'postgres',
      root,
      text: 'PostgreSQL EXPLAIN plan' + (suffix ? ' (' + suffix + ')' : '') + (docs.length > 1 ? ' #' + (i + 1) : ''),
      findings,
      missingIndexPct: null
    });
  });

  if(!statements.length){
    return { ok:false, error:'Could not find a PostgreSQL plan node in that JSON output.', statements:[] };
  }
  return { ok: true, statements };
}
