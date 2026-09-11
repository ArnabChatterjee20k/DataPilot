#!/usr/bin/env python
"""Fail if the Docker image has grown past its budget.

The image was 718MB before it was worked on and is a little over 300MB now.
Most of that saving came from things that crept in without anyone noticing -
a build toolchain that stayed in the final layer, a CLI nobody runs - so the
useful guard is a number that has to be raised deliberately.

    python scripts/check_image_size.py           # measure what is there
    python scripts/check_image_size.py --build   # build it first
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: What the image may weigh, uncompressed. Raise it on purpose, with a reason.
BUDGET_MB = 400

#: The layers worth naming when it goes over, since one of them is the cause.
INTERESTING = ("COPY", "RUN", "ADD")

TAG = "datapilot:size-check"


def run(*command: str) -> subprocess.CompletedProcess:
    return subprocess.run(command, capture_output=True, text=True, cwd=ROOT)


UNITS = {"B": 1e-6, "KB": 1e-3, "MB": 1.0, "GB": 1000.0, "TB": 1_000_000.0}


def parse_size(text: str) -> float:
    """Read `docker images`' human size into megabytes.

    `docker image inspect` reports something much smaller under the containerd
    image store - it counts one manifest rather than what the image occupies -
    so the number a person sees is the one to hold to account.
    """
    cleaned = text.strip().replace(" ", "").upper()
    for unit in ("TB", "GB", "MB", "KB", "B"):
        if cleaned.endswith(unit):
            return round(float(cleaned[: -len(unit)]) * UNITS[unit], 1)
    raise ValueError(f"Cannot read a size out of {text!r}")


def image_size(tag: str) -> float:
    result = run("docker", "images", tag, "--format", "{{.Size}}")
    if result.returncode != 0 or not result.stdout.strip():
        raise SystemExit(
            f"No image tagged {tag}. Build it first, or pass --build.\n"
            f"{result.stderr.strip()}"
        )
    return parse_size(result.stdout.splitlines()[0])


def layers(tag: str) -> list[tuple[str, str]]:
    """Every build step with its size, heaviest first."""
    result = run("docker", "history", tag, "--no-trunc", "--format", "{{json .}}")
    if result.returncode != 0:
        return []

    found = []
    for line in result.stdout.splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        raw = str(entry.get("Size", "0B"))
        try:
            weight = parse_size(raw)
        except ValueError:
            weight = 0.0
        found.append((weight, raw, str(entry.get("CreatedBy", ""))))

    found.sort(key=lambda item: item[0], reverse=True)
    return [(raw, command) for _weight, raw, command in found]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", help="build the image first")
    parser.add_argument(
        "--budget", type=int, default=BUDGET_MB, help="the limit, in megabytes"
    )
    parser.add_argument("--tag", default=TAG)
    arguments = parser.parse_args()

    if arguments.build:
        print(f"Building {arguments.tag}…")
        build = subprocess.run(
            ["docker", "build", "-t", arguments.tag, "."], cwd=ROOT
        )
        if build.returncode != 0:
            return build.returncode

    size = image_size(arguments.tag)
    print(f"\n{arguments.tag}: {size}MB (budget {arguments.budget}MB)")

    if size > arguments.budget:
        print("\nThe biggest steps:")
        for raw, command in layers(arguments.tag)[:8]:
            if any(command.startswith(prefix) or f" {prefix} " in command
                   for prefix in INTERESTING):
                print(f"  {raw:>10}  {command[:100]}")
        print(
            "\nOver budget. Either something that belongs in a builder stage is "
            "shipping, or a dependency came in that is not used at runtime.\n"
            "Raise the budget only once you know which, and why it is worth it."
        )
        return 1

    print("Within budget.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
