#!/usr/bin/env python3
"""Register and verify the local demo connections in the running Rowset app."""
import json
import os
import pathlib
import subprocess
import sys
sys.dont_write_bytecode = True
import urllib.request
from seed import container_env

DATA=pathlib.Path(os.environ.get('ROWSET_DESKTOP_DIR',str(pathlib.Path.home()/'Documents/rowset-try')))
state=json.loads((DATA/'instance.json').read_text())
BASE=f"http://127.0.0.1:{state['port']}"

def request(path,body=None,token=None):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    req=urllib.request.Request(BASE+'/api'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    with urllib.request.urlopen(req,timeout=60) as response:
        return json.load(response)

local=request('/local/open',{},state['key'])
session=request('/auth/local',{'ticket':local['ticket']})
token=session['accessToken']
existing=request('/connections',token=token).get('connections') or []
saved=request('/saved-queries',token=token).get('queries') or []
engines=[('postgres','PostgreSQL',55432,'rowset-e2e-pg'),('mysql','MySQL',53306,'rowset-e2e-mysql'),('mariadb','MariaDB',53307,'rowset-e2e-mariadb'),('sqlserver','SQL Server',51433,'rowset-e2e-mssql'),('clickhouse','ClickHouse',59000,'rowset-clickhouse-demo'),('mongodb','MongoDB',57017,'rowset-mongo-demo')]
for engine,label,port,container in engines:
    env=container_env(container)
    if engine=='postgres': user=env.get('POSTGRES_USER','postgres'); password=env.get('POSTGRES_PASSWORD','')
    elif engine in ('mysql','mariadb'):
        user=env.get('MYSQL_USER') or env.get('MARIADB_USER') or 'root'
        password=(env.get('MYSQL_PASSWORD') or env.get('MARIADB_PASSWORD') or '') if user!='root' else env.get('MYSQL_ROOT_PASSWORD') or env.get('MARIADB_ROOT_PASSWORD') or ''
    elif engine=='sqlserver': user='sa'; password=env.get('MSSQL_SA_PASSWORD') or env.get('SA_PASSWORD') or ''
    elif engine=='clickhouse': user='default'; password=''
    else: user=''; password=''
    connection=next((c for c in existing if c['engine']==engine and c['host']=='127.0.0.1' and c['port']==port and c['database']=='rowset_demo'),None)
    if connection is None:
        connection=request('/connections',{'name':label+' Demo','engine':engine,'host':'127.0.0.1','port':port,'database':'rowset_demo','environment':'development','tlsMode':'disable','connectionUsername':user,'password':password,'queryTimeoutSeconds':30},token)
    check=request('/connections/'+connection['id']+'/test',{},token)
    if not check.get('ok'): raise RuntimeError(label+' connection test failed: '+str(check.get('error')))
    if engine=='mongodb':
        query=json.dumps({'collection':'orders','filter':{'status':'paid'},'sort':{'created_at':-1},'limit':100},indent=2)
        result=request('/connections/'+connection['id']+'/documents/find',{'database':'rowset_demo',**json.loads(query)},token)
        assert len(result['documents'])==4
        assert all('$numberDecimal' in doc['total'] and '$numberLong' in doc['external_id'] for doc in result['documents'])
        count=len(result['documents'])
    else:
        query="SELECT id, customer_id, total, status, created_at\nFROM orders\nWHERE id >= 3001\nORDER BY id;"
        result=request('/connections/'+connection['id']+'/query',{'database':'rowset_demo','sql':query,'nodeRole':'primary','maxRows':100,'backup':False},token)
        assert result.get('rowCount')==12, label+' unexpected row count: '+str(result.get('rowCount'))
        count=result['rowCount']
    title=label+' demo — orders'
    if not any(q.get('name')==title and (q.get('connectionId') or q.get('connection_id'))==connection['id'] for q in saved):
        request('/saved-queries',{'connectionId':connection['id'],'name':title,'sql':query},token)
    print(label+f': connection OK, demo query returned {count} rows/documents',flush=True)
local=request('/local/open',{},state['key'])
subprocess.run(['open',BASE+'/connections#local='+local['ticket']],check=True)
print('Demo connections ready at '+BASE+'/connections')
