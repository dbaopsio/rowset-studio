#!/bin/sh
# Small local MongoDB playground. Stop/start keeps its data; no new image is
# pulled when the existing MongoDB 8.0 image is already available.
set -eu
name=rowset-mongo-demo
legacy=rowset-codex-mongo
case "${1:-start}" in
  stop) docker stop "$name"; exit 0 ;;
  start) ;;
  *) printf 'Usage: %s [start|stop]\n' "$0" >&2; exit 1 ;;
esac
if ! docker container inspect "$name" >/dev/null 2>&1; then
  data_volume=rowset-mongo-demo-data
  config_volume=rowset-mongo-demo-config
  if docker container inspect "$legacy" >/dev/null 2>&1; then
    data_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Name}}{{end}}{{end}}' "$legacy")
    config_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data/configdb"}}{{.Name}}{{end}}{{end}}' "$legacy")
    [ -n "$data_volume" ] && [ -n "$config_volume" ]
  fi
  # Reference both volumes BEFORE stopping the old --rm container so Docker
  # retains them. This moves the existing data without copying or deleting it.
  docker create --name "$name" --label io.rowset.purpose=local-demo \
    --memory=512m --memory-swap=512m --cpus=0.5 \
    --restart=no --log-driver=json-file --log-opt max-size=1m --log-opt max-file=2 \
    -p 127.0.0.1:57017:27017 \
    --mount "type=volume,src=$data_volume,dst=/data/db" \
    --mount "type=volume,src=$config_volume,dst=/data/configdb" \
    mongo:8.0 mongod --wiredTigerCacheSizeGB 0.25 --bind_ip_all >/dev/null
fi
if docker container inspect "$legacy" >/dev/null 2>&1; then
  docker stop --time 30 "$legacy" >/dev/null
fi
docker start "$name" >/dev/null
printf 'MongoDB demo: 127.0.0.1:57017 (512 MB RAM, 0.5 CPU, data preserved)\n'
