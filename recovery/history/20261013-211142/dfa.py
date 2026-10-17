"""DFA logic for Decider (AL102 automata theory midterm).

The machine recognises every binary string that ends in 1.

    delta(q0, 0) = q0     delta(q0, 1) = q1
    delta(q1, 0) = q0     delta(q1, 1) = q1

    q0  the input read so far is empty or ends in 0
    q1  the input read so far ends in 1

A string is accepted exactly when the state it finishes in is q1, which is the
same thing as saying the string ends in 1.

There is no dead state, and that is a property of this language rather than an
omission. An earlier build of this file recognised the single exact string "101"
and needed a trap, because any extra symbol had to be a failure; and a later
build recognised "contains 101" with an absorbing q3. Neither is this machine.
Here every state is reachable on both symbols and no input can ever be stuck, so
a trap would only reject perfectly good strings.

This module is the single source of truth. The application's figure is generated
from DFA["delta"] by script.js, and nothing in JavaScript decides anything.
"""

from typing import Any, Dict, List

# DFA definition, exactly as the assignment states it.
DFA = {
    "states": ["q0", "q1"],
    "alphabet": ["0", "1"],
    "start": "q0",
    "accepting": ["q1"],
    "delta": {
        "q0": {"0": "q0", "1": "q1"},
        "q1": {"0": "q0", "1": "q1"},
    },
}

ACCEPTED_DESCRIPTION = "This machine accepts every binary string that ends in 1."


def validate(input_str: str) -> Dict[str, Any]:
    """
    Validate that every character of input_str is in the alphabet {0, 1}.

    Args:
        input_str: the string to validate, unmodified (no trimming).

    Returns:
        {'valid': bool, 'invalid': [{'symbol', 'index'}, ...]} with 1-based
        positions. A space is reported as symbol ' ' and the interface renders
        that as "space".
    """
    invalid = [
        {"symbol": char, "index": i}
        for i, char in enumerate(input_str, start=1)
        if char not in DFA["alphabet"]
    ]
    return {"valid": not invalid, "invalid": invalid}


def simulate(input_str: str) -> Dict[str, Any]:
    """
    Simulate the machine over a valid input string, one symbol at a time.

    Args:
        input_str: a string containing only '0' and '1'.

    Returns:
        {'input', 'startState', 'steps', 'flow', 'finalState', 'accepted',
         'description'}.
        steps is [{'step', 'from', 'symbol', 'to'}] numbered from 1; flow has
        one more entry than steps, starting at the start state.
        Empty input yields steps [], flow ['q0'], finalState 'q0', and
        accepted False, because the empty string ends in nothing and is not a
        member of the language.
    """
    start_state = DFA["start"]

    def result(steps: List[Dict[str, Any]], flow: List[str], final_state: str) -> Dict[str, Any]:
        return {
            "input": input_str,
            "startState": start_state,
            "steps": steps,
            "flow": flow,
            "finalState": final_state,
            "accepted": final_state in DFA["accepting"],
            "description": ACCEPTED_DESCRIPTION,
        }

    # Empty input: no transitions at all, so the machine is still at the start.
    if not input_str:
        return result([], [start_state], start_state)

    steps: List[Dict[str, Any]] = []
    flow = [start_state]
    current = start_state

    for i, symbol in enumerate(input_str, start=1):
        nxt = DFA["delta"][current][symbol]
        steps.append({"step": i, "from": current, "symbol": symbol, "to": nxt})
        current = nxt
        flow.append(current)

    return result(steps, flow, current)


def check(input_str: str) -> Dict[str, Any]:
    """
    Validate, then simulate. This is what the bridge calls.

    Args:
        input_str: the string to check, unmodified.

    Returns:
        {'status': 'invalid', 'errors': [{'symbol', 'index'}, ...]} when any
        symbol is outside the alphabet - an invalid string is never reported as
        accepted or rejected, because the machine never saw it.
        Otherwise {'status': 'valid', 'input', 'start', 'steps', 'flow',
        'final', 'accepted', 'description'}.
    """
    validation = validate(input_str)
    if not validation["valid"]:
        return {"status": "invalid", "errors": validation["invalid"]}

    sim = simulate(input_str)
    return {
        "status": "valid",
        "input": sim["input"],
        "start": sim["startState"],
        "steps": sim["steps"],
        "flow": sim["flow"],
        "final": sim["finalState"],
        "accepted": sim["accepted"],
        "description": sim["description"],
    }


# The oracle. Every case states the expected acceptance AND the expected final
# state, because accepting with the wrong final state would mean the transition
# function and the acceptance rule had drifted apart.
TEST_CASES = [
    # The ten cases named in the assignment brief.
    {"input": "1", "expected": "ACCEPTED", "final": "q1"},
    {"input": "0", "expected": "REJECTED", "final": "q0"},
    {"input": "11", "expected": "ACCEPTED", "final": "q1"},
    {"input": "10", "expected": "REJECTED", "final": "q0"},
    {"input": "101", "expected": "ACCEPTED", "final": "q1"},
    {"input": "100", "expected": "REJECTED", "final": "q0"},
    {"input": "111", "expected": "ACCEPTED", "final": "q1"},
    {"input": "110", "expected": "REJECTED", "final": "q0"},
    {"input": "10101", "expected": "ACCEPTED", "final": "q1"},
    {"input": "10100", "expected": "REJECTED", "final": "q0"},
    # The cases that show "ends in 1" is not "is exactly 101".
    {"input": "0101", "expected": "ACCEPTED", "final": "q1"},
    {"input": "1010", "expected": "REJECTED", "final": "q0"},
    {"input": "0001", "expected": "ACCEPTED", "final": "q1"},
    {"input": "11000", "expected": "REJECTED", "final": "q0"},
    {"input": "11111", "expected": "ACCEPTED", "final": "q1"},
    {"input": "00000", "expected": "REJECTED", "final": "q0"},
    # Single symbols, and longer runs of each.
    {"input": "0111111", "expected": "ACCEPTED", "final": "q1"},
    {"input": "0000000000000", "expected": "REJECTED", "final": "q0"},
    {"input": "101101", "expected": "ACCEPTED", "final": "q1"},
    {"input": "1101011", "expected": "ACCEPTED", "final": "q1"},
    # Empty input: no symbol read, still at the start, not accepted.
    {"input": "", "expected": "REJECTED", "final": "q0"},
    # Validation runs before the automaton, so none of these reach it.
    {"input": "1021", "expected": "INVALID", "final": None},
    {"input": "10a1", "expected": "INVALID", "final": None},
    {"input": "10 1", "expected": "INVALID", "final": None},
    {"input": "1 1", "expected": "INVALID", "final": None},
    {"input": "101 ", "expected": "INVALID", "final": None},
    {"input": "2", "expected": "INVALID", "final": None},
    {"input": "abc", "expected": "INVALID", "final": None},
    {"input": " ", "expected": "INVALID", "final": None},
]


def run_tests() -> Dict[str, Any]:
    """
    Run every case in TEST_CASES through check().

    Returns:
        {'total', 'passed', 'results'} where each result is
        {'input', 'expected', 'actual', 'final', 'finalOk', 'pass'}. `actual`
        always comes from check(), never from looking at the last character.
    """
    results = []
    passed = 0

    for case in TEST_CASES:
        value = case["input"]
        expected = case["expected"]
        result = check(value)

        if result["status"] == "invalid":
            actual = "INVALID"
            final_ok = True
        else:
            actual = "ACCEPTED" if result["accepted"] else "REJECTED"
            # The final state is part of the expectation, not just accept/reject.
            final_ok = case["final"] is None or result["final"] == case["final"]

        ok = actual == expected and final_ok
        if ok:
            passed += 1

        results.append({
            "input": value,
            "expected": expected,
            "actual": actual,
            "final": None if result["status"] == "invalid" else result["final"],
            "finalOk": final_ok,
            "pass": ok,
        })

    return {"total": len(TEST_CASES), "passed": passed, "results": results}


if __name__ == "__main__":
    report = run_tests()
    for number, row in enumerate(report["results"], start=1):
        label = row["input"] if row["input"] else "(empty)"
        final = row["final"] or "-"
        mark = "PASS" if row["pass"] else "FAIL"
        print(f"{number:>2}  {label!r:<18} expected {row['expected']:<9}"
              f" actual {row['actual']:<9} final {final:<4} {mark}")
    print(f"\n{report['passed']} of {report['total']} passed.")
