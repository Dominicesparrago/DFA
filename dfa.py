from typing import Any, Dict, List

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
    invalid = [
        {"symbol": char, "index": i}
        for i, char in enumerate(input_str, start=1)
        if char not in DFA["alphabet"]
    ]
    return {"valid": not invalid, "invalid": invalid}


def simulate(input_str: str) -> Dict[str, Any]:
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


TEST_CASES = [
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
    {"input": "0101", "expected": "ACCEPTED", "final": "q1"},
    {"input": "1010", "expected": "REJECTED", "final": "q0"},
    {"input": "0001", "expected": "ACCEPTED", "final": "q1"},
    {"input": "11000", "expected": "REJECTED", "final": "q0"},
    {"input": "11111", "expected": "ACCEPTED", "final": "q1"},
    {"input": "00000", "expected": "REJECTED", "final": "q0"},
    {"input": "0111111", "expected": "ACCEPTED", "final": "q1"},
    {"input": "0000000000000", "expected": "REJECTED", "final": "q0"},
    {"input": "101101", "expected": "ACCEPTED", "final": "q1"},
    {"input": "1101011", "expected": "ACCEPTED", "final": "q1"},
    {"input": "", "expected": "REJECTED", "final": "q0"},
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
