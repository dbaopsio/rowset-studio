# Small local database lab

All six existing containers stay available on loopback. Each is limited to
0.5 CPU, with swap disabled for the container. The limits below are ceilings,
not reserved memory. SQL Server also has a 512 MB database-engine memory limit;
its other processes need additional memory within the 2 GB container ceiling.

| Rowset connection | Local port | Container RAM ceiling |
| --- | --- | --- |
| MongoDB Demo | 57017 | 512 MB |
| ClickHouse Demo | 59000 | 768 MB |
| PostgreSQL Demo | 55432 | 192 MB |
| MySQL Demo | 53306 | 512 MB |
| MariaDB Demo | 53307 | 256 MB |
| SQL Server Demo | 51433 | 2 GB |

Each connection opens `rowset_demo`. Relational engines have six customers,
six products, twelve orders and a `customer_summary` view. ClickHouse has
products, orders and `sales_by_status`. MongoDB has customers, products and
orders, including nested fields, arrays, dates, Decimal128 and Int64 values.
Example orders queries are saved in Rowset. Existing databases are preserved.

```sh
sh scripts/demo-lab.sh status
sh scripts/demo-lab.sh stop   # retains containers and their data
sh scripts/demo-lab.sh start
sh scripts/demo-lab.sh seed   # adds missing demo records and connections
```

These scripts manage this existing Docker lab, rather than provisioning all
six engines on a fresh machine. `mongo-demo.sh` also supports creating MongoDB.
The seed/connection scripts read the existing container credentials internally;
no passwords are stored in these files. They target the desktop installation
in `~/Documents/rowset-try` by default (`ROWSET_DESKTOP_DIR` overrides it).

MySQL and MariaDB use the small configuration files here, copied into their
containers. PostgreSQL settings persist through `ALTER SYSTEM`. ClickHouse
mounts both XML files from this directory: keep them available while it runs.
MongoDB's WiredTiger cache is 256 MB. MongoDB and ClickHouse retain their old
data volumes, use persistent containers and rotate Docker logs at 1 MB × 2.
ClickHouse's internal diagnostic table logging is disabled for this tiny lab.
Existing engine images are reused; database volumes are never pruned.

MongoDB example for the Query editor:

```json
{
  "collection": "orders",
  "filter": { "status": "paid" },
  "sort": { "created_at": -1 },
  "limit": 100
}
```

All SQL demo queries include a WHERE predicate to satisfy the existing SELECT
policy. Large SQL workloads and high-concurrency tests need larger limits.
