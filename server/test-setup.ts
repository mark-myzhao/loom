// Tests that touch the store work in a scratch data directory, never the owner's.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DASH_DATA_DIR = mkdtempSync(join(tmpdir(), "loom-test-"));
