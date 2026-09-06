#!/usr/bin/env python3
"""Validate the public question dataset without reading private source files."""

from __future__ import annotations

import json
import sys
from pathlib import Path


REQUIRED = {
    "id",
    "subjectId",
    "module",
    "stem",
    "answer",
    "summary",
    "explanation",
    "decisiveFact",
    "trapAxis",
    "flipCondition",
    "source",
    "law",
    "lawStatus",
}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    data_path = Path(__file__).resolve().parents[1] / "app" / "data" / "subjects.json"
    try:
        payload = json.loads(data_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"dataset not found: {data_path}")
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON: {exc}")

    subjects = payload.get("subjects")
    if not isinstance(subjects, list) or not subjects:
        fail("subjects must be a non-empty array")

    subject_ids: set[str] = set()
    question_ids: set[str] = set()
    question_count = 0

    for subject in subjects:
        subject_id = subject.get("id")
        if not subject_id or subject_id in subject_ids:
            fail(f"duplicate or empty subject id: {subject_id!r}")
        subject_ids.add(subject_id)

        questions = subject.get("questions", [])
        if not isinstance(questions, list):
            fail(f"questions must be an array for subject {subject_id}")

        for question in questions:
            question_count += 1
            missing = sorted(REQUIRED - question.keys())
            if missing:
                fail(f"{question.get('id', '<unknown>')} is missing: {', '.join(missing)}")
            question_id = question["id"]
            if question_id in question_ids:
                fail(f"duplicate question id: {question_id}")
            question_ids.add(question_id)
            if question["subjectId"] != subject_id:
                fail(f"{question_id}: subjectId does not match its subject")
            if question["answer"] not in {"○", "×"}:
                fail(f"{question_id}: answer must be ○ or ×")
            for field in REQUIRED - {"answer"}:
                if not isinstance(question[field], str) or not question[field].strip():
                    fail(f"{question_id}: {field} must be a non-empty string")

    declared_count = payload.get("questionCount")
    if declared_count != question_count:
        fail(f"questionCount is {declared_count}, but {question_count} questions were found")

    print(f"OK: {len(subjects)} subjects, {question_count} questions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
