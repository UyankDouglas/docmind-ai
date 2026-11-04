import pytest

from app.rag.retrieval.fusion import reciprocal_rank_fusion
from app.services.retrieval_settings import RetrievalSettings, validate_retrieval_patch


def test_rrf_prefers_items_present_in_both_rankings():
    fused = reciprocal_rank_fusion({"vector": ["a", "b", "c"], "lexical": ["c", "d", "a"]}, k=60)
    keys = [f.key for f in fused]
    assert keys[0] in {"a", "c"} and set(keys[:2]) == {"a", "c"}
    assert keys[-1] in {"b", "d"}
    a = next(f for f in fused if f.key == "a")
    assert a.ranks == {"vector": 1, "lexical": 3}
    assert a.score == pytest.approx(1 / 61 + 1 / 63)


def test_rrf_is_deterministic_and_handles_single_ranking():
    only = reciprocal_rank_fusion({"vector": ["x", "y"]}, k=10)
    assert [f.key for f in only] == ["x", "y"]
    assert reciprocal_rank_fusion({}) == []
    with pytest.raises(ValueError):
        reciprocal_rank_fusion({"vector": ["x"]}, k=0)


def test_rrf_ignores_duplicate_keys_within_a_ranking():
    fused = reciprocal_rank_fusion({"vector": ["a", "a", "b"]})
    a = next(f for f in fused if f.key == "a")
    assert a.ranks == {"vector": 1}


def test_retrieval_settings_validation():
    assert validate_retrieval_patch({"mode": "hybrid", "top_k": 5}) == {
        "mode": "hybrid",
        "top_k": 5,
    }
    assert validate_retrieval_patch({"top_k": None}) == {}
    for bad in (
        {"mode": "magic"},
        {"top_k": 0},
        {"top_k": 31},
        {"min_similarity": 1.5},
        {"max_context_tokens": 100},
    ):
        with pytest.raises(Exception):
            validate_retrieval_patch(bad)
    defaults = RetrievalSettings()
    assert defaults.mode == "hybrid" and defaults.rrf_k == 60
