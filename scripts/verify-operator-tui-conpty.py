import argparse
import json
import os
import select
import sys
import time
from urllib.parse import urlparse

from winpty.enums import Backend
from winpty.ptyprocess import PtyProcess


def child_environment(api_url, api_token):
    allowed = ("APPDATA", "COMSPEC", "LOCALAPPDATA", "PATHEXT", "PATH", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR")
    environment = {key: os.environ[key] for key in allowed if os.environ.get(key)}
    environment["TERM"] = "xterm-256color"
    parsed = urlparse(api_url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("invalid local API endpoint")
    if not isinstance(api_token, str) or len(api_token) < 24:
        raise ValueError("invalid API credential")
    environment["SERVICE_LASSO_API_URL"] = api_url
    environment["SERVICE_LASSO_API_TOKEN"] = api_token
    return environment


def wait_for(process, text, expected, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if all(value in text for value in expected):
            return True, text
        readable, _, _ = select.select([process], [], [], min(0.1, max(0, deadline - time.monotonic())))
        if readable:
            try:
                text += process.read()
            except EOFError:
                break
    return all(value in text for value in expected), text


def emit(result):
    print(json.dumps(result, separators=(",", ":")))


def fail(stage):
    emit({"ok": False, "stage": stage})
    return 1


def close_owned_process(process):
    try:
        process.close(force=True)
        return not process.isalive()
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--executable", required=True)
    parser.add_argument("--mode", choices=("unavailable", "connected"), required=True)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--api-token", required=True)
    args = parser.parse_args()

    stage = "setup"
    process = None
    try:
        stage = "launch"
        process = PtyProcess.spawn([args.executable], cwd=os.path.dirname(args.executable), env=child_environment(args.api_url, args.api_token), dimensions=(40, 120), backend=Backend.ConPTY)
        text = ""
        stage = "startup"
        expected = "Runtime identity:" if args.mode == "connected" else "Runtime API unavailable"
        startup_ok, text = wait_for(process, text, ("Service Lasso TUI", expected), 20)
        if not startup_ok:
            return fail(stage)
        if args.mode == "connected" and "Runtime API unavailable" in text:
            return fail(stage)
        if args.mode == "connected":
            stage = "navigation"
            process.write("d?")
            navigation_ok, text = wait_for(process, text, ("d dashboard", "esc back"), 5)
            if not navigation_ok:
                return fail(stage)
        stage = "exit"
        process.write("q")
        deadline = time.monotonic() + 5
        while process.isalive() and time.monotonic() < deadline:
            try:
                readable, _, _ = select.select([process], [], [], 0.1)
                if readable:
                    text += process.read()
            except EOFError:
                break
        if process.isalive():
            return fail(stage)
        if not close_owned_process(process):
            process = None
            return fail("cleanup")
        process = None
        if args.mode == "unavailable":
            emit({"ok": True, "mode": "unavailable", "startup": "unavailable", "navigation": "not_applicable", "exit": "q"})
        else:
            emit({"ok": True, "mode": "connected", "startup": "connected", "navigation": "help", "exit": "q"})
        return 0
    except Exception:
        return fail(stage)
    finally:
        if process is not None:
            close_owned_process(process)


if __name__ == "__main__":
    sys.exit(main())
