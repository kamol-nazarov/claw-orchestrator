#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep the build command portable across Windows, macOS, and Linux.
rmSync(resolve(process.cwd(), 'dist'), { recursive: true, force: true });
