from app.studio.positions import key_after


def test_sequence_sorts_ascending_and_matches_fractional_indexing():
    # Values from rocicorp/fractional-indexing's generateKeyBetween(a, undefined).
    keys = ["a0"]
    for _ in range(70):
        keys.append(key_after(keys[-1]))
    assert keys[:3] == ["a0", "a1", "a2"]
    assert keys[10] == "aA"
    assert keys[36] == "aa"
    assert keys[62] == "b00"
    assert keys == sorted(keys)
    assert key_after(None) == "a0"


def test_after_a_fractional_key_stays_ordered():
    assert key_after("a0V") == "a1"
    assert key_after("Zz") == "a0"
