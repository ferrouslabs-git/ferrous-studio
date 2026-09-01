"""Server-side ordering keys compatible with the frontend's ``fractional-indexing``
package. Only the "append after the last key" case is needed here (new
personas and wireframes go at the end); the
frontend generates in-between keys itself when the user reorders.

Port of ``generateKeyBetween(a, undefined)`` from
https://github.com/rocicorp/fractional-indexing (same base-62 alphabet, same
integer-length encoding), so keys made on either side sort together.
"""

BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
FIRST_KEY = "a0"
_MAX_INTEGER = "z" + "z" * 26


def _integer_length(head: str) -> int:
    if "a" <= head <= "z":
        return ord(head) - ord("a") + 2
    if "A" <= head <= "Z":
        return ord("Z") - ord(head) + 2
    raise ValueError(f"invalid order key head {head!r}")


def _integer_part(key: str) -> str:
    n = _integer_length(key[0])
    if n > len(key):
        raise ValueError(f"invalid order key {key!r}")
    return key[:n]


def _increment_integer(x: str) -> str | None:
    head, digits = x[0], list(x[1:])
    for i in range(len(digits) - 1, -1, -1):
        d = BASE62.index(digits[i]) + 1
        if d == len(BASE62):
            digits[i] = "0"
        else:
            digits[i] = BASE62[d]
            return head + "".join(digits)
    # Carried all the way: lengthen (or shorten, in the capital range) the integer.
    if head == "Z":
        return "a0"
    if head == "z":
        return None
    next_head = chr(ord(head) + 1)
    if next_head > "a":
        digits.append("0")
    else:
        digits.pop()
    return next_head + "".join(digits)


def key_after(last: str | None) -> str:
    """A key that sorts after ``last`` (``None`` = the list is empty)."""
    if last is None:
        return FIRST_KEY
    integer = _integer_part(last)
    if integer == _MAX_INTEGER:
        # Practically unreachable (62^26 appends); extend the fractional part.
        return last + "V"
    nxt = _increment_integer(integer)
    if nxt is None:
        return last + "V"
    return nxt
