#!/usr/bin/env python3
"""
MLX Setup Script — Auto-install dependencies for local translation pipeline.

Creates a Python venv, installs required packages, and pre-downloads models.
Reports progress via JSON lines to stdout for the Tauri frontend.

Usage:
    python3 setup_mlx.py [--check] [--env-dir DIR]

    --check     Only check if setup is complete (exit 0=ready, 1=not ready)
    --env-dir   Custom venv directory (default: ~/Library/Application Support/My Translator/mlx-env)
"""

import json
import os
import subprocess
import sys
import argparse
import shutil


def emit(data):
    """Print JSON line to stdout for Tauri to read."""
    print(json.dumps(data, ensure_ascii=False), flush=True)


def get_default_env_dir():
    """Get default venv directory."""
    app_support = os.path.expanduser("~/Library/Application Support/My Translator")
    return os.path.join(app_support, "mlx-env")


def get_marker_path(env_dir):
    """Path to the setup-complete marker file."""
    return os.path.join(env_dir, ".setup_complete")


def is_setup_complete(env_dir):
    """Check if MLX setup is already done."""
    marker = get_marker_path(env_dir)
    if not os.path.exists(marker):
        return False
    # Check venv python exists
    venv_python = os.path.join(env_dir, "bin", "python3")
    if not os.path.exists(venv_python):
        return False
    # Check marker version
    try:
        with open(marker) as f:
            data = json.load(f)
            return data.get("version") == 2  # Bump this on dependency changes
    except Exception:
        return False


def check_system_python():
    """Find a suitable Python 3.10+ for creating venv."""
    home = os.path.expanduser("~")
    candidates = [
        os.path.join(home, ".pyenv", "shims", "python3"),
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        os.path.join(home, "miniconda3", "bin", "python3"),
        os.path.join(home, "anaconda3", "bin", "python3"),
        shutil.which("python3"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            try:
                result = subprocess.run(
                    [path, "--version"],
                    capture_output=True, text=True, timeout=5
                )
                version = result.stdout.strip().split()[-1]
                major, minor = map(int, version.split(".")[:2])
                if major >= 3 and minor >= 10:
                    return path, version
            except Exception:
                continue
    return None, None


def create_venv(python_path, env_dir):
    """Create a Python virtual environment."""
    emit({"type": "progress", "step": "venv", "message": "Creating Python environment..."})

    os.makedirs(env_dir, exist_ok=True)

    result = subprocess.run(
        [python_path, "-m", "venv", env_dir, "--clear"],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to create venv: {result.stderr}")

    # Upgrade pip
    venv_pip = os.path.join(env_dir, "bin", "pip3")
    subprocess.run(
        [venv_pip, "install", "--upgrade", "pip"],
        capture_output=True, text=True, timeout=120
    )

    emit({"type": "progress", "step": "venv", "message": "Python environment created ✓", "done": True})


def install_packages(env_dir):
    """Install required Python packages."""
    venv_pip = os.path.join(env_dir, "bin", "pip3")

    packages = [
        ("numpy", "Array processing"),
        ("mlx", "Apple Silicon ML framework"),
        ("mlx-lm", "LLM inference"),
        ("mlx-whisper", "Whisper ASR"),
    ]

    total = len(packages)
    for i, (pkg, desc) in enumerate(packages):
        emit({
            "type": "progress",
            "step": "packages",
            "message": f"Installing {pkg} ({i+1}/{total})... {desc}",
            "progress": (i / total) * 100,
        })

        result = subprocess.run(
            [venv_pip, "install", pkg],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode != 0:
            raise RuntimeError(f"Failed to install {pkg}: {result.stderr[:500]}")

    emit({
        "type": "progress",
        "step": "packages",
        "message": "All packages installed ✓",
        "progress": 100,
        "done": True,
    })


def download_models(env_dir):
    """Pre-download ML models using the venv Python."""
    venv_python = os.path.join(env_dir, "bin", "python3")

    models = [
        ("mlx-community/whisper-large-v3-turbo", "Whisper ASR (~1.5GB)"),
        ("mlx-community/gemma-3-4b-it-qat-4bit", "Gemma Translation (~3GB)"),
    ]

    total = len(models)
    for i, (model_id, desc) in enumerate(models):
        emit({
            "type": "progress",
            "step": "models",
            "message": f"Downloading {desc} ({i+1}/{total})...",
            "progress": (i / total) * 100,
        })

        # Use huggingface_hub to download
        script = f"""
import sys
try:
    from huggingface_hub import snapshot_download
    snapshot_download("{model_id}")
    print("OK", flush=True)
except Exception as e:
    print(f"ERROR: {{e}}", file=sys.stderr, flush=True)
    sys.exit(1)
"""
        result = subprocess.run(
            [venv_python, "-c", script],
            capture_output=True, text=True, timeout=1800  # 30 min timeout
        )
        if result.returncode != 0:
            raise RuntimeError(f"Failed to download {model_id}: {result.stderr[:500]}")

    emit({
        "type": "progress",
        "step": "models",
        "message": "All models downloaded ✓",
        "progress": 100,
        "done": True,
    })


def write_marker(env_dir):
    """Write setup-complete marker file."""
    marker = get_marker_path(env_dir)
    with open(marker, "w") as f:
        json.dump({
            "version": 2,
            "python": os.path.join(env_dir, "bin", "python3"),
            "models": [
                "mlx-community/whisper-large-v3-turbo",
                "mlx-community/gemma-3-4b-it-qat-4bit",
            ],
        }, f, indent=2)


def main():
    parser = argparse.ArgumentParser(description="MLX Setup")
    parser.add_argument("--check", action="store_true", help="Check if setup is complete")
    parser.add_argument("--env-dir", default=None, help="Custom venv directory")
    args = parser.parse_args()

    env_dir = args.env_dir or get_default_env_dir()

    if args.check:
        if is_setup_complete(env_dir):
            emit({"type": "check", "ready": True, "env_dir": env_dir,
                  "python": os.path.join(env_dir, "bin", "python3")})
            sys.exit(0)
        else:
            emit({"type": "check", "ready": False, "env_dir": env_dir})
            sys.exit(1)

    # Full setup
    emit({"type": "start", "message": "Starting MLX setup...", "env_dir": env_dir})

    try:
        # Step 1: Check system Python
        python_path, python_version = check_system_python()
        if not python_path:
            emit({"type": "error", "message": "Python 3.10+ not found. Please install Python via Homebrew: brew install python"})
            sys.exit(1)

        emit({"type": "progress", "step": "check", "message": f"Found Python {python_version} at {python_path} ✓"})

        # Step 2: Create venv
        create_venv(python_path, env_dir)

        # Step 3: Install packages
        install_packages(env_dir)

        # Step 4: Download models
        download_models(env_dir)

        # Step 5: Write marker
        write_marker(env_dir)

        emit({
            "type": "complete",
            "message": "MLX setup complete! Ready to translate.",
            "python": os.path.join(env_dir, "bin", "python3"),
            "env_dir": env_dir,
        })

    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
