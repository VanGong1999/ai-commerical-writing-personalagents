#!/usr/bin/env python3
"""Smoke: create run core_hook_batch against live API + job-worker."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("API_BASE", "http://127.0.0.1:8000")


def http(method: str, path: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    health = http("GET", "/health")
    print("health", health)
    projects = http("GET", "/api/v1/projects")
    if not projects:
        print("no projects")
        return 1
    pid = projects[0]["id"]
    run = http(
        "POST",
        "/api/v1/runs",
        {
            "projectId": pid,
            "agentId": "topic.core_hook_batch",
            "inputJson": {
                "format": "manju",
                "count": 10,
                "gender": "男频",
                "genre": ["重生", "商业"],
            },
        },
    )
    print("run", run["id"], run["status"])
    # find job
    jobs = http("GET", f"/api/v1/jobs?project_id={pid}")
    job = next((j for j in jobs if j.get("resultRef") == run["id"] or j["payload"].get("runId") == run["id"]), None)
    if not job:
        print("job not found yet, listing", jobs[:2])
        return 1
    print("job", job["id"], job["status"])
    for _ in range(90):
        j = http("GET", f"/api/v1/jobs/{job['id']}")
        print("status", j["status"], j.get("error"))
        if j["status"] in {"succeeded", "failed", "dead", "cancelled"}:
            arts = http("GET", f"/api/v1/projects/{pid}/artifacts?type=core_hook")
            print("core_hooks", len(arts))
            return 0 if j["status"] == "succeeded" and len(arts) >= 1 else 2
        time.sleep(2)
    return 3


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.URLError as e:
        print("API not reachable:", e)
        raise SystemExit(4)
