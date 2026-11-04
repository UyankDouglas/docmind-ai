"""Fusão de rankings (Reciprocal Rank Fusion).

RRF(d) = Σ_r 1 / (k + rank_r(d)) para cada ranking r em que d aparece (rank 1-based).
Escolhido por ser robusto a escalas de score distintas (similaridade cosseno vs. ts_rank_cd).
"""

from __future__ import annotations

from collections.abc import Hashable, Sequence
from dataclasses import dataclass, field


@dataclass(slots=True)
class FusedItem:
    key: Hashable
    score: float
    ranks: dict[str, int] = field(default_factory=dict)


def reciprocal_rank_fusion(
    rankings: dict[str, Sequence[Hashable]], *, k: int = 60
) -> list[FusedItem]:
    """`rankings` mapeia o nome do ranking para a lista ordenada de chaves (melhor primeiro)."""
    if k < 1:
        raise ValueError("k deve ser >= 1")
    acc: dict[Hashable, FusedItem] = {}
    for name, ordered in rankings.items():
        for position, key in enumerate(ordered, start=1):
            item = acc.get(key)
            if item is None:
                item = FusedItem(key=key, score=0.0)
                acc[key] = item
            if name in item.ranks:  # chave duplicada no mesmo ranking: mantém a melhor posição
                continue
            item.ranks[name] = position
            item.score += 1.0 / (k + position)
    # Desempate determinístico: mais rankings, depois melhor posição mínima
    return sorted(
        acc.values(),
        key=lambda it: (-it.score, -len(it.ranks), min(it.ranks.values())),
    )
