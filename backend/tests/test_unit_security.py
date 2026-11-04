from app.core.security import (
    constant_time_equals,
    generate_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)


def test_argon2id_hash_roundtrip():
    h = hash_password("minha-senha-segura")
    assert h.startswith("$argon2id$")
    assert verify_password("minha-senha-segura", h)
    assert not verify_password("outra", h)
    assert not verify_password("minha-senha-segura", "hash-invalido")


def test_session_token_is_hashed_and_random():
    t1, t2 = generate_session_token(), generate_session_token()
    assert t1 != t2 and len(t1) >= 40
    assert hash_session_token(t1) != t1
    assert len(hash_session_token(t1)) == 64


def test_constant_time_equals():
    assert constant_time_equals("abc", "abc")
    assert not constant_time_equals("abc", "abd")
    assert not constant_time_equals(None, "abc")
    assert not constant_time_equals("", "")
