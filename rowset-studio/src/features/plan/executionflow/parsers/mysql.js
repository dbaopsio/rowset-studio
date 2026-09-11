/* Adapted from executionflow (https://github.com/ynsuy/executionflow) by Yunus
   Uyanik, who contributes it to Rowset Studio under the Apache License 2.0. */
/* ============================================================
   parsers/mysql — EXPLAIN FORMAT=JSON + EXPLAIN ANALYZE text
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
  const start = text.indexOf('{');
  if(start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for(let i=start; i<text.length; i++){
    const ch = text[i];
    if(inStr){
      if(esc) esc = false;
      else if(ch === '\\') esc = true;
      else if(ch === '"') inStr = false;
      continue;
    }
    if(ch === '"') inStr = true;
    else if(ch === '{') depth++;
    else if(ch === '}'){
      depth--;
      if(depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function accessName(t){
  const a = (t.access_type || '').toLowerCase();
  if(a === 'all') return 'Table Scan';
  if(a === 'index') return 'Index Scan';
  if(a === 'range') return 'Index Range Scan';
  if(a === 'ref') return 'Index Lookup';
  if(a === 'eq_ref') return 'Single-row Index Lookup';
  if(a === 'const' || a === 'system') return 'Constant Lookup';
  return t.access_type ? 'Access: ' + t.access_type : 'Table Access';
}

let nodeSeq = 0;
function makeNode(phys, logical, props){
  return {
    engine: 'mysql',
    phys,
    logical: logical || phys,
    nodeId: String(++nodeSeq),
    children: [],
    warnings: [],
    ownCost: 0,
    subtree: 0,
    costPct: 0,
    props: props || {}
  };
}

function tableNode(t){
  const cost = t.cost_info || {};
  const read = num(cost.read_cost) || 0;
  const evalCost = num(cost.eval_cost) || 0;
  const prefix = num(cost.prefix_cost);
  const n = makeNode(accessName(t), t.access_type || 'table', {
    access_type: t.access_type,
    possible_keys: Array.isArray(t.possible_keys) ? t.possible_keys.join(', ') : '',
    used_key_parts: Array.isArray(t.used_key_parts) ? t.used_key_parts.join(', ') : '',
    key_length: t.key_length,
    ref: Array.isArray(t.ref) ? t.ref.join(', ') : '',
    filtered: t.filtered,
    attached_condition: t.attached_condition,
    data_read_per_join: cost.data_read_per_join
  });
  n.objTable = t.table_name;
  n.objIndex = t.key || '';
  n.estRows = num(t.rows_produced_per_join);
  if(n.estRows == null) n.estRows = num(t.rows);
  n.estRowsRead = num(t.rows_examined_per_scan);
  n.ownCost = read + evalCost;
  if(!t.cost_info && num(t.cost) != null) n.ownCost = num(t.cost);
  n.subtree = prefix != null ? prefix : n.ownCost;
  // MariaDB ANALYZE: r_rows is the average per loop.
  const rRows = num(t.r_rows), rLoops = num(t.r_loops);
  if(rRows != null){
    n.actExec = rLoops != null ? rLoops : 1;
    n.actRows = rRows * n.actExec;
  }
  if(num(t.r_table_time_ms) != null) n.props.table_time_ms = t.r_table_time_ms;
  if((t.access_type || '').toUpperCase() === 'ALL'){
    n.warnings.push('warn');
  }
  if(t.attached_condition) n.predicate = t.attached_condition;
  return n;
}

function opNode(phys, logical, child, opts){
  const n = makeNode(phys, logical, opts && opts.props);
  n.children = child ? [child] : [];
  const childCost = child ? (child.subtree || 0) : 0;
  n.ownCost = opts && opts.cost != null ? opts.cost : 0.05;
  n.subtree = childCost + n.ownCost;
  if(opts && opts.warn) n.warnings.push(opts.warn);
  return n;
}

function buildJsonTree(obj, findings){
  const qb = obj.query_block || obj;
  let totalCost = num(qb.cost_info && qb.cost_info.query_cost);
  if(totalCost == null) totalCost = num(qb.cost);

  function walkBlock(block){
    if(block.ordering_operation){
      const oo = block.ordering_operation;
      const child = walkBlock(oo);
      const n = opNode('Sort', 'ORDER BY', child, {
        warn: oo.using_filesort ? 'warn' : null,
        props: { using_filesort: oo.using_filesort ? 'true' : 'false' }
      });
      if(oo.using_filesort) findings.push({sev:'warn',node:n,title:'Filesort',msg:'MySQL used filesort for ORDER BY. For larger data sets, review the ordering/grouping indexes.'});
      return n;
    }
    if(block.grouping_operation){
      const go = block.grouping_operation;
      const child = walkBlock(go);
      const n = opNode('Aggregate', 'GROUP BY', child, {
        warn: go.using_temporary_table ? 'warn' : null,
        props: {
          using_temporary_table: go.using_temporary_table ? 'true' : 'false',
          using_filesort: go.using_filesort ? 'true' : 'false'
        }
      });
      if(go.using_temporary_table) findings.push({sev:'warn',node:n,title:'Temporary table',msg:'GROUP BY used a temporary table. This is common, but can become expensive as rows grow.'});
      return n;
    }
    // MariaDB wraps the join in filesort / temporary_table / read_sorted_file.
    if(block.filesort){
      const fs = block.filesort;
      const n = opNode('Sort', 'filesort', walkBlock(fs), {
        warn: 'warn',
        props: { sort_key: fs.sort_key, output_rows: fs.r_output_rows, sort_mode: fs.r_sort_mode }
      });
      findings.push({sev:'warn',node:n,title:'Filesort',msg:'MariaDB sorts with filesort on '+escHtml(fs.sort_key || 'the result')+'. For larger data sets, review the ordering/grouping indexes.'});
      return n;
    }
    if(block.read_sorted_file) return walkBlock(block.read_sorted_file);
    if(block.temporary_table){
      const n = opNode('Temporary Table', 'temporary table', walkBlock(block.temporary_table), { warn: 'warn' });
      findings.push({sev:'warn',node:n,title:'Temporary table',msg:'The query materialises a temporary table. This is common, but can become expensive as rows grow.'});
      return n;
    }
    if(block.duplicates_removal) return opNode('Duplicate Removal', 'DISTINCT', walkBlock(block.duplicates_removal));
    if(Array.isArray(block.nested_loop)){
      const n = makeNode('Nested Loop', 'JOIN', { join_order: block.nested_loop.map(x => x.table && x.table.table_name).filter(Boolean).join(' -> ') });
      n.children = block.nested_loop.map(x => x.table ? tableNode(x.table) : walkBlock(x));
      n.subtree = Math.max(...n.children.map(c => c.subtree || 0), 0);
      n.ownCost = Math.max(0.01, (totalCost || n.children.reduce((s,c)=>s+(c.ownCost||0),0)) - n.subtree);
      return n;
    }
    if(block.table) return tableNode(block.table);
    return makeNode('Query Block', 'SELECT');
  }

  const root = walkBlock(qb);
  if(totalCost != null) root.subtree = totalCost;
  return root;
}

function parseAnalyze(text){
  const lines = text.split(/\r?\n/).filter(l => /->\s*/.test(l));
  if(!lines.length) return null;
  const stack = [];
  let root = null;
  for(const line of lines){
    const marker = line.indexOf('->');
    if(marker < 0) continue;
    const depth = marker;
    const body = line.slice(marker + 2).trim();
    const label = body.replace(/\s+\((?:cost|actual time)=.*$/i, '').trim();
    const n = makeNode(label, 'EXPLAIN ANALYZE', { detail: body });
    const cost = body.match(/\(cost=([\d.]+)\s+rows=([\d.]+)/i);
    if(cost){ n.subtree = num(cost[1]) || 0; n.ownCost = n.subtree; n.estRows = num(cost[2]); }
    const actual = body.match(/\(actual time=([\d.]+)\.\.([\d.]+)\s+rows=([\d.]+)\s+loops=([\d.]+)\)/i);
    if(actual){
      n.actTimeStart = num(actual[1]);
      n.actTimeEnd = num(actual[2]);
      n.actRows = num(actual[3]);
      n.actExec = num(actual[4]);
    }
    const tbl = label.match(/\bon\s+([A-Za-z0-9_`]+)\b/i);
    if(tbl) n.objTable = tbl[1].replace(/`/g,'');
    const key = label.match(/\busing\s+([A-Za-z0-9_`]+)\b/i);
    if(key) n.objIndex = key[1].replace(/`/g,'');
    if(/table scan/i.test(label)) n.warnings.push('warn');
    while(stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if(stack.length) stack[stack.length - 1].node.children.push(n);
    else root = n;
    stack.push({depth, node:n});
  }
  return root;
}

function eachNode(node, fn){ fn(node); node.children.forEach(c => eachNode(c, fn)); }

function detect(root, findings){
  const total = root.subtree || root.ownCost || 1;
  eachNode(root, n => {
    n.costPct = total > 0 ? ((n.ownCost || 0) / total) * 100 : 0;
    if((n.phys || '').toLowerCase().includes('table scan')){
      findings.push({sev:'warn',node:n,title:'Full table scan',msg:'MySQL scanned '+escHtml(n.objTable || 'a table')+'. Check whether predicates and join columns are supported by indexes.'});
    }
    if(n.estRowsRead != null && n.estRows != null && n.estRowsRead > n.estRows * 10 && n.estRowsRead > 1000){
      findings.push({sev:'warn',node:n,title:'Rows examined amplification',msg:'Rows examined per scan is much higher than produced rows.'});
    }
    if(n.actRows != null && n.estRows != null && n.estRows > 0){
      const ratio = n.actRows / n.estRows;
      if(ratio >= 10 || ratio <= 0.1){
        n.warnings.push('warn');
        findings.push({sev:'warn',node:n,title:'Estimate vs actual mismatch',msg:'Estimated '+n.estRows+' rows, actual '+n.actRows+' rows.'});
      }
    }
  });
}

function mergeActuals(jsonRoot, analyzeRoot){
  if(!jsonRoot || !analyzeRoot) return;
  const actualByTable = new Map();
  eachNode(analyzeRoot, n => {
    if(n.objTable && n.actRows != null) actualByTable.set(n.objTable, n);
  });
  eachNode(jsonRoot, n => {
    const a = n.objTable ? actualByTable.get(n.objTable) : null;
    if(!a) return;
    n.actRows = a.actRows;
    n.actExec = a.actExec;
    n.actTimeStart = a.actTimeStart;
    n.actTimeEnd = a.actTimeEnd;
    n.props.actual_detail = a.props.detail;
  });
}

export function parsePlan(text){
  nodeSeq = 0;
  if(!text || !String(text).trim()){
    return { ok:false, error:'Paste a MySQL EXPLAIN FORMAT=JSON or EXPLAIN ANALYZE output first.', statements:[] };
  }
  const findings = [];
  let root = null;
  const jsonText = extractFirstJson(text);
  const analyzeRoot = parseAnalyze(text);

  if(jsonText){
    try {
      root = buildJsonTree(JSON.parse(jsonText), findings);
      mergeActuals(root, analyzeRoot);
    } catch(err){
      return { ok:false, error:'Could not parse the MySQL EXPLAIN FORMAT=JSON output.', statements:[] };
    }
  } else if(analyzeRoot){
    root = analyzeRoot;
  }

  if(!root) return { ok:false, error:'Could not find a MySQL EXPLAIN FORMAT=JSON or EXPLAIN ANALYZE plan in that input.', statements:[] };
  detect(root, findings);
  return {
    ok: true,
    statements: [{
      engine: 'mysql',
      root,
      text: 'MySQL EXPLAIN plan',
      findings,
      missingIndexPct: null
    }]
  };
}
