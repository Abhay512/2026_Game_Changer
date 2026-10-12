"""CSV → Parquet ingest pipeline. Run with `python -m ingest` from the backend/ directory."""

# Bump when the on-disk store format or derived formulas change: forces a full rebuild.
PIPELINE_VERSION = 3
