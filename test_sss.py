"""Test that /sss/ serves its index.html correctly."""
import sys
import httpx

import os
BASE = os.environ.get("TEST_BASE", "http://127.0.0.1:8000")

def check(label, url, expected_status, body_contains=None):
    r = httpx.get(url, follow_redirects=True, timeout=5)
    status_ok = r.status_code == expected_status
    body_ok = True
    if body_contains:
        body_ok = body_contains in r.text
    passed = status_ok and body_ok
    mark = "PASS" if passed else "FAIL"
    print(f"[{mark}] {label}")
    print(f"       URL:    {url}")
    print(f"       Status: {r.status_code} (expected {expected_status})")
    if body_contains:
        snippet = r.text[:120].replace("\n", " ")
        print(f"       Body:   {snippet!r}")
        print(f"       Contains {body_contains!r}: {body_ok}")
    return passed

results = []
results.append(check("GET /sss/ (200 HTML)",  f"{BASE}/sss/",        200, "<!DOCTYPE html>"))
results.append(check("GET /sss  (200 HTML)",  f"{BASE}/sss",         200, "<!DOCTYPE html>"))
results.append(check("GET /sss/app.js (200)", f"{BASE}/sss/app.js",  200))
results.append(check("GET /sss/missing (404)",f"{BASE}/sss/missing", 404))
results.append(check("SSS active nav present", f"{BASE}/sss/",        200, 'class="active">SSS</a>'))

passed = sum(results)
total  = len(results)
print(f"\n{'='*40}")
print(f"  {passed}/{total} passed")
sys.exit(0 if passed == total else 1)
