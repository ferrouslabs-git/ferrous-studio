"""Project keys: what a board's ids start with, and how one is chosen."""
import pytest
from pydantic import ValidationError

from app.studio.board.models import BOARD_KEYS, Requirement, keyed
from app.studio.board.schemas import BoardKeyWrite
from app.studio.board.service import derive_board_key


def test_a_key_is_the_initials_or_the_start_of_one_word():
    assert derive_board_key("Invoice Approvals", set()) == "IA"
    assert derive_board_key("Harbourside Community Trust Hub Portal", set()) == "HCTH"
    assert derive_board_key("Studio", set()) == "STU"
    assert derive_board_key("a", set()) == "AX"
    assert derive_board_key("3D printing", set()) == "P3P"
    assert derive_board_key("", set()) == "PX"


def test_a_taken_key_is_numbered_on():
    assert derive_board_key("Invoice Approvals", {"IA"}) == "IA2"
    assert derive_board_key("Invoice Approvals", {"IA", "IA2"}) == "IA3"


def test_ids_carry_the_key_of_the_board_they_belong_to():
    from uuid import uuid4

    board_id = uuid4()
    BOARD_KEYS[board_id] = "IA"
    try:
        assert keyed(board_id, "REQ-5") == "IA-REQ-5"
        assert Requirement(board_id=board_id, seq=5).human_id == "IA-REQ-5"
    finally:
        BOARD_KEYS.pop(board_id, None)
    assert keyed(uuid4(), "REQ-5") == "REQ-5"


def test_a_key_is_two_to_six_letters_or_digits_starting_with_a_letter():
    assert BoardKeyWrite(key=" ia2 ").key == "IA2"
    for bad in ["I", "2A", "TOOLONG", "I-A", ""]:
        with pytest.raises(ValidationError):
            BoardKeyWrite(key=bad)
