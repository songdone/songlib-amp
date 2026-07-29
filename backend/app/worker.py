from __future__ import annotations

import signal

from .config import settings
from .db import init_db
from .jobs import manager


def main():
    errors = settings.validate()
    if errors:
        raise RuntimeError("；".join(errors))
    init_db()

    def stop(*_):
        manager.stop_event.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    manager.run_forever()


if __name__ == "__main__":
    main()
