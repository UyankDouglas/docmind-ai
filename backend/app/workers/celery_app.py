"""Configuração do Celery (broker e backend Redis)."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "docmind",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,  # se o worker morrer no meio, a tarefa volta para a fila
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_time_limit=15 * 60,  # limite rígido por documento
    task_soft_time_limit=12 * 60,
    result_expires=24 * 3600,
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=True,
    broker_connection_retry_on_startup=True,
    task_default_queue="documents",
    beat_schedule={
        "apply-retention-daily": {
            "task": "maintenance.apply_retention",
            "schedule": crontab(hour=settings.retention_run_hour_utc, minute=15),
        },
    },
)
