#!/usr/bin/env python3
import os
import subprocess
import sys
from datetime import datetime

REPO_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def run(cmd, check=True, capture_output=True):
    return subprocess.run(
        cmd,
        cwd=REPO_DIR,
        text=True,
        capture_output=capture_output,
        check=check,
    )


def ensure_repo():
    try:
        run(["git", "rev-parse", "--is-inside-work-tree"])
    except subprocess.CalledProcessError:
        print("[ERROR] Not a git repository:", REPO_DIR)
        sys.exit(1)


def ensure_temp_ignored():
    gitignore_path = os.path.join(REPO_DIR, ".gitignore")
    entry = ".tmp_skill_install/"

    if os.path.exists(gitignore_path):
        with open(gitignore_path, "r", encoding="utf-8") as f:
            lines = [line.rstrip("\n") for line in f.readlines()]
    else:
        lines = []

    if entry not in lines:
        with open(gitignore_path, "a", encoding="utf-8") as f:
            if lines and lines[-1] != "":
                f.write("\n")
            f.write(entry + "\n")
        print(f"[INFO] Added {entry} to .gitignore")


def has_changes():
    res = run(["git", "status", "--porcelain"])
    return bool(res.stdout.strip())


def main():
    ensure_repo()
    ensure_temp_ignored()

    # Stage all changes
    run(["git", "add", "-A"])

    # Nothing to commit
    if not has_changes():
        print("[INFO] No changes to sync.")
        return 0

    commit_msg = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %z")

    try:
        run(["git", "commit", "-m", commit_msg])
        print(f"[INFO] Committed: {commit_msg}")
    except subprocess.CalledProcessError as e:
        print("[ERROR] git commit failed")
        print(e.stdout or "")
        print(e.stderr or "")
        return 1

    try:
        push = run(["git", "push", "origin", "main"])
        print(push.stdout.strip())
        print(push.stderr.strip())
        print("[INFO] Push completed.")
    except subprocess.CalledProcessError as e:
        print("[ERROR] git push failed")
        print(e.stdout or "")
        print(e.stderr or "")
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
