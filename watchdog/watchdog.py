#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "watchdog" / "PROGRESS.json"
HEARTBEAT = ROOT / "watchdog" / "heartbeat.json"
DAEMON = ROOT / "watchdog" / "daemon-status.json"
LOG = ROOT / "watchdog" / "watchdog.log"


def now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def atomic_write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def read_json(path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return fallback


def beat(args):
    progress = read_json(STATE, {})
    progress["updatedAt"] = now()
    if args.phase:
        progress["phase"] = args.phase
    if args.status:
        progress["status"] = args.status
    if args.step:
        progress["inProgress"] = args.step
    if args.next:
        progress["next"] = [item.strip() for item in args.next.split("|") if item.strip()]
    if args.blocker:
        progress["blockers"] = [item.strip() for item in args.blocker.split("|") if item.strip()]
    atomic_write(STATE, progress)
    heartbeat = {
        "at": now(),
        "epoch": time.time(),
        "phase": progress.get("phase", "unknown"),
        "step": progress.get("inProgress", ""),
        "status": progress.get("status", "in_progress"),
        "pid": os.getpid(),
    }
    atomic_write(HEARTBEAT, heartbeat)
    print(f"checkpoint: {heartbeat['phase']} · {heartbeat['step']}")


def status(args):
    progress = read_json(STATE, {})
    heartbeat = read_json(HEARTBEAT, {})
    stale_after = args.stale
    age = None if not heartbeat else max(0, time.time() - heartbeat.get("epoch", 0))
    stale = age is None or age > stale_after
    print(json.dumps({
        "project": progress.get("project", ROOT.name),
        "phase": progress.get("phase", "unknown"),
        "status": progress.get("status", "unknown"),
        "inProgress": progress.get("inProgress", ""),
        "heartbeatAgeSeconds": None if age is None else round(age, 1),
        "stale": stale,
        "next": progress.get("next", []),
        "blockers": progress.get("blockers", []),
    }, ensure_ascii=False, indent=2))
    return 2 if stale else 0


def resume(args):
    progress = read_json(STATE, {})
    heartbeat = read_json(HEARTBEAT, {})
    print("=== TanJi HG resume ===")
    print(f"phase: {progress.get('phase', 'unknown')}")
    print(f"status: {progress.get('status', 'unknown')}")
    print(f"in progress: {progress.get('inProgress', '')}")
    print(f"heartbeat: {heartbeat.get('at', 'none')}")
    print("\nnext:")
    for index, item in enumerate(progress.get("next", []), 1):
        print(f"  {index}. {item}")
    print("\nblockers:")
    blockers = progress.get("blockers") or ["none"]
    for item in blockers:
        print(f"  - {item}")
    print("\ndecisions:")
    for item in progress.get("decisions", []):
        print(f"  - {item.get('id')}: {item.get('decision')}")
    print("\nresume instructions:")
    for item in progress.get("resumeInstructions", []):
        print(f"  - {item}")


def daemon(args):
    previous = None
    while True:
        heartbeat = read_json(HEARTBEAT, {})
        age = None if not heartbeat else max(0, time.time() - heartbeat.get("epoch", 0))
        stale = age is None or age > args.stale
        current = "stale" if stale else "active"
        if current != previous:
            message = f"{now()} {current.upper()} age={age if age is not None else 'none'} phase={heartbeat.get('phase', 'unknown')} step={heartbeat.get('step', '')}"
            with LOG.open("a", encoding="utf-8") as handle:
                handle.write(message + "\n")
            atomic_write(DAEMON, {
                "at": now(),
                "state": current,
                "heartbeatAgeSeconds": None if age is None else round(age, 1),
                "phase": heartbeat.get("phase", "unknown"),
                "step": heartbeat.get("step", ""),
            })
            print(message, flush=True)
            previous = current
        time.sleep(args.interval)


def main():
    parser = argparse.ArgumentParser(description="TanJi HG durable checkpoint and stale-session watchdog")
    sub = parser.add_subparsers(dest="command", required=True)

    beat_parser = sub.add_parser("beat")
    beat_parser.add_argument("--phase")
    beat_parser.add_argument("--status")
    beat_parser.add_argument("--step")
    beat_parser.add_argument("--next")
    beat_parser.add_argument("--blocker")
    beat_parser.set_defaults(func=beat)

    status_parser = sub.add_parser("status")
    status_parser.add_argument("--stale", type=int, default=900)
    status_parser.set_defaults(func=status)

    resume_parser = sub.add_parser("resume")
    resume_parser.set_defaults(func=resume)

    daemon_parser = sub.add_parser("daemon")
    daemon_parser.add_argument("--interval", type=int, default=30)
    daemon_parser.add_argument("--stale", type=int, default=900)
    daemon_parser.set_defaults(func=daemon)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
