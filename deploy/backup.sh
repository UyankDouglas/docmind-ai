#!/usr/bin/env bash
# DocMind AI — backup do PostgreSQL (pg_dump) e dos arquivos do MinIO.
#
# Uso (no servidor, dentro do repositório):   sudo ./deploy/backup.sh [DIRETORIO] [DIAS_DE_RETENCAO]
# Padrão: ./backups e 7 dias. Agendamento diário (03:30):
#   echo "30 3 * * * root cd $(pwd) && ./deploy/backup.sh >> /var/log/docmind-backup.log 2>&1" \
#     | sudo tee /etc/cron.d/docmind-backup
# Restauração: docs/deploy.md, seção "Backup e restauração".
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml)
DEST="${1:-./backups}"
KEEP_DAYS="${2:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DEST"
chmod 700 "$DEST"
umask 077

echo "[$STAMP] pg_dump"
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "$DEST/docmind-db-$STAMP.dump"

echo "[$STAMP] arquivos do MinIO"
"${COMPOSE[@]}" exec -T minio tar -C /bitnami/minio/data -czf - . > "$DEST/docmind-files-$STAMP.tar.gz"

find "$DEST" -maxdepth 1 -name 'docmind-*' -type f -mtime "+$KEEP_DAYS" -delete
ls -lh "$DEST" | tail -n 6
echo "[$STAMP] backup concluído em $DEST"
