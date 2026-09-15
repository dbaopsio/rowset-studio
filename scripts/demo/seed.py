#!/usr/bin/env python3
"""Seed small, repeatable demo datasets in the existing local Docker lab.
Credentials are read from local container configuration and never printed.
"""
import json
import subprocess
import time

DB = 'rowset_demo'
CUSTOMERS = [(1001,'Deniz Kaya','deniz@example.test','Istanbul'),(1002,'Ece Demir','ece@example.test','Ankara'),(1003,'Can Yilmaz','can@example.test','Izmir'),(1004,'Ada Celik','ada@example.test','Bursa'),(1005,'Mert Aydin','mert@example.test','Antalya'),(1006,'Selin Aras','selin@example.test','Istanbul')]
PRODUCTS = [(2001,'Mechanical keyboard','1299.90',18),(2002,'USB-C hub','649.50',35),(2003,'Desk lamp','899.00',12),(2004,'Notebook','89.90',120),(2005,'Monitor stand','1190.00',8),(2006,'Wireless mouse','749.90',24)]
ORDERS = [(3001+i,1001+i%6,['1299.90','739.40','899.00','89.90','1190.00','749.90'][i%6],['paid','shipped','pending'][i%3],f'2026-09-{1+i:02d} 10:30:00') for i in range(12)]

def docker(args, input=None):
    result = subprocess.run(['docker', *args], input=input, text=True, capture_output=True)
    if result.returncode:
        # Do not include docker inspect output or command arguments in errors.
        raise RuntimeError('Docker operation failed: '+result.stderr[-1500:])
    return result.stdout.strip()

def container_env(name):
    info = json.loads(docker(['inspect',name]))[0]
    return dict(value.split('=',1) for value in info['Config']['Env'] if '=' in value)

def query(engine, sql, database=None):
    if engine == 'postgres':
        env=container_env('rowset-e2e-pg')
        return docker(['exec','-i','rowset-e2e-pg','psql','-U',env.get('POSTGRES_USER','postgres'),'-d',database or 'postgres','-v','ON_ERROR_STOP=1','-At'],sql)
    if engine in ('mysql','mariadb'):
        name='rowset-e2e-'+engine
        client='mysql' if engine=='mysql' else 'mariadb'
        command='export MYSQL_PWD="${MARIADB_ROOT_PASSWORD:-$MYSQL_ROOT_PASSWORD}"; exec '+client+' -uroot --default-character-set=utf8mb4 --batch --skip-column-names'
        return docker(['exec','-i',name,'sh','-c',command],sql)
    if engine == 'sqlserver':
        command='export SQLCMDPASSWORD="${MSSQL_SA_PASSWORD:-$SA_PASSWORD}"; if [ -x /opt/mssql-tools18/bin/sqlcmd ]; then exec /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b; else exec /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -C -b; fi'
        return docker(['exec','-i','rowset-e2e-mssql','sh','-c',command],sql)
    if engine == 'clickhouse':
        return docker(['exec','-i','rowset-clickhouse-demo','clickhouse-client','--multiquery'],sql)
    raise ValueError(engine)

def literal(value, engine):
    if isinstance(value,int): return str(value)
    return ('N' if engine=='sqlserver' else '')+"'"+value.replace("'","''")+"'"

def seed_sql(engine):
    if engine=='postgres':
        if query(engine,"SELECT 1 FROM pg_database WHERE datname='rowset_demo'") != '1': query(engine,'CREATE DATABASE rowset_demo')
        prefix=''
    elif engine=='sqlserver':
        query(engine,"IF DB_ID('rowset_demo') IS NULL CREATE DATABASE rowset_demo;\nGO\nEXEC sp_configure 'show advanced options',1; RECONFIGURE; EXEC sp_configure 'max server memory (MB)',512; RECONFIGURE;\nGO\n")
        prefix='USE rowset_demo;\nGO\n'
    else:
        query(engine,'CREATE DATABASE IF NOT EXISTS rowset_demo CHARACTER SET utf8mb4;')
        prefix='USE rowset_demo;\n'
    varchar='NVARCHAR' if engine=='sqlserver' else 'VARCHAR'
    timestamp='DATETIME2' if engine=='sqlserver' else 'TIMESTAMP' if engine=='postgres' else 'DATETIME'
    definitions={
        'customers':f'id INTEGER PRIMARY KEY, name {varchar}(80) NOT NULL, email {varchar}(120), city {varchar}(40)',
        'products':f'id INTEGER PRIMARY KEY, name {varchar}(80) NOT NULL, price DECIMAL(12,2) NOT NULL, stock INTEGER NOT NULL',
        'orders':f'id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, total DECIMAL(12,2) NOT NULL, status {varchar}(20) NOT NULL, created_at {timestamp} NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(id)',
    }
    statements=[prefix]
    for table,definition in definitions.items():
        statements.append((f"IF OBJECT_ID('dbo.{table}','U') IS NULL CREATE TABLE {table}" if engine=='sqlserver' else f'CREATE TABLE IF NOT EXISTS {table}')+f' ({definition});')
    for table,rows in [('customers',CUSTOMERS),('products',PRODUCTS),('orders',ORDERS)]:
        for row in rows:
            values=','.join(literal(v,engine) for v in row)
            if engine=='postgres': statement=f'INSERT INTO {table} VALUES ({values}) ON CONFLICT (id) DO NOTHING;'
            elif engine=='sqlserver': statement=f'IF NOT EXISTS(SELECT 1 FROM {table} WHERE id={row[0]}) INSERT INTO {table} VALUES ({values});'
            else: statement=f'INSERT IGNORE INTO {table} VALUES ({values});'
            statements.append(statement)
    query(engine,'\n'.join(statements),DB)
    view='SELECT c.id, c.name, c.city, COUNT(o.id) AS order_count, COALESCE(SUM(o.total),0) AS total_spent FROM customers c LEFT JOIN orders o ON o.customer_id=c.id GROUP BY c.id,c.name,c.city'
    query(engine,prefix+('CREATE OR ALTER VIEW' if engine=='sqlserver' else 'CREATE OR REPLACE VIEW')+' customer_summary AS '+view+';',DB)
    if engine in ('mysql','mariadb'):
        env=container_env('rowset-e2e-'+engine); user=env.get('MYSQL_USER') or env.get('MARIADB_USER')
        if user: query(engine,"GRANT ALL PRIVILEGES ON rowset_demo.* TO "+literal(user,engine)+"@'%';")
    print(engine+': customers=6, products=6, orders=12, customer_summary view',flush=True)

def seed_clickhouse():
    query('clickhouse','CREATE DATABASE IF NOT EXISTS rowset_demo; CREATE TABLE IF NOT EXISTS rowset_demo.orders(id UInt32, customer_id UInt32, total Decimal(12,2), status String, created_at DateTime) ENGINE=MergeTree ORDER BY id; CREATE TABLE IF NOT EXISTS rowset_demo.products(id UInt32, name String, price Decimal(12,2), stock UInt32) ENGINE=MergeTree ORDER BY id;')
    for table,rows in [('orders',ORDERS),('products',PRODUCTS)]:
        existing=set(query('clickhouse',f'SELECT id FROM rowset_demo.{table} FORMAT TSV').split())
        missing=[row for row in rows if str(row[0]) not in existing]
        if missing: query('clickhouse',f'INSERT INTO rowset_demo.{table} VALUES '+','.join('('+','.join(literal(v,'clickhouse') for v in row)+')' for row in missing))
    query('clickhouse','CREATE VIEW IF NOT EXISTS rowset_demo.sales_by_status AS SELECT status,count() AS order_count,sum(total) AS revenue FROM rowset_demo.orders GROUP BY status;')
    print('clickhouse: products=6, orders=12, sales_by_status view',flush=True)

def seed_mongo():
    script='const demo=db.getSiblingDB("rowset_demo");\n'
    for table,rows,fields in [('customers',CUSTOMERS,['id','name','email','city']),('products',PRODUCTS,['id','name','price','stock']),('orders',ORDERS,['id','customer_id','total','status','created_at'])]:
        for row in rows:
            doc=dict(zip(fields,row)); doc['_id']=doc.pop('id')
            if table=='customers': doc['preferences']={'newsletter':row[0]%2==0,'language':'tr'}
            if table=='products': doc['tags']=['office','demo']; doc['price']={'$numberDecimal':doc['price']}
            if table=='orders': doc['total']={'$numberDecimal':doc['total']}; doc['created_at']={'$date':doc['created_at'].replace(' ','T')+'Z'}; doc['external_id']={'$numberLong':str(9007199254740993+row[0])}
            encoded=json.dumps(doc)
            script+=f'demo.{table}.updateOne({{_id:{row[0]}}}, {{$setOnInsert:EJSON.parse({json.dumps(encoded)}, {{relaxed:false}})}}, {{upsert:true}});\n'
    script+='demo.orders.createIndex({customer_id:1}); demo.products.createIndex({name:1}); print("MongoDB: customers="+demo.customers.countDocuments({})+", products="+demo.products.countDocuments({})+", orders="+demo.orders.countDocuments({}));'
    print(docker(['exec','-i','rowset-mongo-demo','mongosh','--quiet','--file','/dev/stdin'],script),flush=True)

if __name__=='__main__':
    for engine in ['postgres','mysql','mariadb','sqlserver']: seed_sql(engine)
    seed_clickhouse()
    seed_mongo()
