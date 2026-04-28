#!/bin/bash
set -e

echo "Running migrations..."
alembic upgrade head

echo "Starting API..."
exec gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 --timeout 120 --access-logfile - --error-logfile -
