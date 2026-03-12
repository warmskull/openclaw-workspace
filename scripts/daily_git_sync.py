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


def ensure_git_identity():
    name = run(["git", "config", "--get", "user.name"], check=False).stdout.strip()
    email = run(["git", "config", "--get", "user.email"], check=False).stdout.strip()

    default_name = os.getenv("GIT_SYNC_USER_NAME", "WARMSKULL")
    default_email = os.getenv("GIT_SYNC_USER_EMAIL", "7410993772+openclaw@users.noreply.github.com")

    if not name:
        run(["git", "config", "user.name", default_name])
        print(f"[INFO] Set repo git user.name={default_name}")
    if not email:
        run(["git", "config", "user.email", default_email])
        print(f"[INFO] Set repo git user.email={default_email}")


def ensure_credential_helper():
    helper = run(["git", "config", "--global", "--get", "credential.helper"], check=False).stdout.strip()
    if not helper:
        run(["git", "config", "--global", "credential.helper", "store"])
        print("[INFO] Set global git credential.helper=store")


def has_changes():
    res = run(["git", "status", "--porcelain"])
    return bool(res.stdout.strip())


def origin_https_to_ssh(url: str) -> str:
    # https://github.com/owner/repo.git -> git@github.com:owner/repo.git
    if url.startswith("https://github.com/"):
        return "git@github.com:" + url[len("https://github.com/"):]
    return ""


def push_main():
    try:
        push = run(["git", "push", "origin", "main"])
        print(push.stdout.strip())
        if push.stderr.strip():
            print(push.stderr.strip())
        print("[INFO] Push completed.")
        return 0
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        stdout = (e.stdout or "").strip()

        # HTTPS remote without credential helper/token
        if "could not read Username for 'https://github.com'" in stderr:
            remote_url = run(["git", "remote", "get-url", "origin"]).stdout.strip()
            ssh_url = origin_https_to_ssh(remote_url)
            if ssh_url:
                print("[WARN] HTTPS push lacks credentials; trying SSH remote fallback...")
                try:
                    run(["git", "push", ssh_url, "main"])
                    print("[INFO] Push completed via SSH fallback.")
                    print("[INFO] Tip: you can switch origin to SSH to avoid HTTPS credential prompts.")
                    return 0
                except subprocess.CalledProcessError as e2:
                    print("[ERROR] git push failed (HTTPS + SSH fallback both failed)")
                    if e2.stdout:
                        print(e2.stdout.strip())
                    if e2.stderr:
                        print(e2.stderr.strip())
                    print("[HINT] Configure either:")
                    print("       1) HTTPS credentials (PAT + credential helper), or")
                    print("       2) SSH key for GitHub, then set origin to git@github.com:<owner>/<repo>.git")
                    return 2

        print("[ERROR] git push failed")
        if stdout:
            print(stdout)
        if stderr:
            print(stderr)
        return 2


def main():
    ensure_repo()
    ensure_temp_ignored()
    ensure_git_identity()
    ensure_credential_helper()

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

    return push_main()


if __name__ == "__main__":
    raise SystemExit(main())
