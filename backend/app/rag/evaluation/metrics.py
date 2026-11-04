"""Métricas de recuperação reutilizáveis em testes e no futuro módulo de avaliação."""

from __future__ import annotations

from collections.abc import Hashable, Sequence


def recall_at_k(retrieved: Sequence[Hashable], relevant: set[Hashable], k: int) -> float:
    if not relevant:
        return 0.0
    hits = sum(1 for item in list(retrieved)[:k] if item in relevant)
    return hits / len(relevant)


def precision_at_k(retrieved: Sequence[Hashable], relevant: set[Hashable], k: int) -> float:
    top = list(retrieved)[:k]
    if not top:
        return 0.0
    return sum(1 for item in top if item in relevant) / len(top)


def reciprocal_rank(retrieved: Sequence[Hashable], relevant: set[Hashable]) -> float:
    for i, item in enumerate(retrieved, start=1):
        if item in relevant:
            return 1.0 / i
    return 0.0
