from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"gh[pousr]_[A-Za-z0-9_]{30,}"),
    re.compile(r"(?i)(?:password|session_secret|api_key|token)\s*[:=]\s*[\"'][^\"']{12,}[\"']"),
)
ALLOW = {".env.example", "scripts/secret_scan.py"}


def main() -> int:
    files = subprocess.check_output(["git", "ls-files"], text=True, encoding="utf-8").splitlines()
    findings: list[str] = []
    for name in files:
        if name in ALLOW:
            continue
        path = Path(name)
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for number, line in enumerate(text.splitlines(), 1):
            if any(pattern.search(line) for pattern in PATTERNS):
                findings.append(f"{name}:{number}")
    if findings:
        print("疑似敏感信息：" + ", ".join(findings))
        return 1
    print("未在跟踪文件中发现常见密钥或明文凭据。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
