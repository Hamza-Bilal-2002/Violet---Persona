"""Returns current UTC timestamp in the format used across the project.

Usage:
    python scripts/timestamp.py          → prints: 20260314_214523_872
    python scripts/timestamp.py --copy   → copies to clipboard (Windows)

Format: YYYYMMDD_HHMMSS_fff (milliseconds for collision avoidance)
"""

import sys
from datetime import datetime, timezone

ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}"

print(ts)

if "--copy" in sys.argv:
    try:
        import subprocess
        subprocess.run(["clip"], input=ts.encode(), check=True)
        print("(copied to clipboard)")
    except Exception:
        pass
