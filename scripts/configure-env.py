#!/usr/bin/env python3
import os
import secrets
from pathlib import Path

project = Path(__file__).resolve().parent.parent
env_file = project / ".env"
template = project / ".env.example"
credentials_file = project / ".initial-admin-credentials"

if not env_file.exists():
    if not template.exists():
        raise SystemExit("Missing .env.example; cannot create application configuration.")
    env_file.write_text(template.read_text())

lines = env_file.read_text().splitlines()
values = {}
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip()

generated = {
    "POSTGRES_PASSWORD": secrets.token_hex(32),
    "JWT_SECRET": secrets.token_hex(48),
    "ADMIN_PASSWORD": secrets.token_hex(20),
}

placeholders = {
    "POSTGRES_PASSWORD": "CHANGE_ME_LONG_RANDOM_DATABASE_PASSWORD",
    "JWT_SECRET": "CHANGE_ME_AT_LEAST_64_RANDOM_CHARACTERS",
    "ADMIN_PASSWORD": "CHANGE_ME_STRONG_INITIAL_ADMIN_PASSWORD",
}

for key, fresh in generated.items():
    current = values.get(key, "")
    if not current or current == placeholders[key] or current.startswith("CHANGE_ME"):
        values[key] = fresh

requested_email = os.environ.get("VRM_ADMIN_EMAIL", "").strip()
if requested_email:
    values["ADMIN_EMAIL"] = requested_email
elif not values.get("ADMIN_EMAIL"):
    values["ADMIN_EMAIL"] = "admin@example.com"

defaults = {
    "POSTGRES_DB": "vendo",
    "POSTGRES_USER": "vendo",
    "HTTP_PORT": "8080",
    "CORS_ORIGIN": "*",
}
for key, value in defaults.items():
    values.setdefault(key, value)

# Preserve comments and ordering while replacing managed key/value entries.
managed = set(values)
written = set()
out = []
for line in lines:
    stripped = line.strip()
    if stripped and not stripped.startswith("#") and "=" in line:
        key = line.split("=", 1)[0].strip()
        if key in managed:
            out.append(f"{key}={values[key]}")
            written.add(key)
            continue
    out.append(line)

for key in values:
    if key not in written:
        out.append(f"{key}={values[key]}")

env_file.write_text("\n".join(out).rstrip() + "\n")
os.chmod(env_file, 0o600)

if not credentials_file.exists():
    credentials_file.write_text(
        "VENDO REVENUE MANAGER - INITIAL ADMIN LOGIN\n"
        f"ADMIN_EMAIL={values['ADMIN_EMAIL']}\n"
        f"ADMIN_PASSWORD={values['ADMIN_PASSWORD']}\n"
        "\nKeep this file private. Change the initial password after first login.\n"
    )
    os.chmod(credentials_file, 0o600)

print(f"Configuration: {env_file}")
print(f"Initial admin email: {values['ADMIN_EMAIL']}")
print(f"Credentials file: {credentials_file}")
