import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def test_database_path_can_use_a_persistent_container_volume(tmp_path):
    database_path = tmp_path / "focus-timer.sqlite3"
    environment = {
        **os.environ,
        "DATABASE_PATH": str(database_path),
        "DEBUG": "True",
        "SECRET_KEY": "deployment-test-secret",
    }

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from django.conf import settings; print(settings.DATABASES['default']['NAME'])",
        ],
        cwd=PROJECT_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout.strip() == str(database_path)
