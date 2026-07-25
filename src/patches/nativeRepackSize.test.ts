// Size-regression gate for the native repack path. Before the fix, every write
// pass relocated the Bun `.bun` section to nextVirtualAddress() (rounded up to a
// 256 MB boundary), leaving the old section stranded AND opening a huge file
// gap — so a single apply grew a ~275 MB binary by ~450 MB and repeated write
// passes (e.g. a downstream writer) accumulated without bound. The fix reuses
// the section's own slot, growing the file only by the blob's own delta.
//
// Asserts on RELATIVE deltas, never an absolute size threshold: the injected-JS
// delta plus a small page-alignment overhead — never a second copy of the blob.
//
// Gated behind a pristine native binary because it needs node-lief + a ~275 MB
// binary on disk. Point TWEAKCC_PRISTINE_BINARY at one (e.g. the `claude` file
// from `npm pack @anthropic-ai/claude-code-linux-x64@<ver>`).

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { readContent, writeContent } from '../lib/content';
import type { Installation } from '../lib/types';

const PRISTINE = process.env.TWEAKCC_PRISTINE_BINARY;
const run = PRISTINE && fs.existsSync(PRISTINE) ? describe : describe.skip;

run('native repack size regression', () => {
  let scratch: string;
  let work: string;
  let pristineSize: number;

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tweakcc-size-'));
    work = path.join(scratch, 'claude-copy');
    fs.copyFileSync(PRISTINE!, work); // never touch the provided pristine
    fs.chmodSync(work, 0o755);
    pristineSize = fs.statSync(work).size;
  });

  const inst = (): Installation => ({
    kind: 'native',
    path: work,
    version: '0.0.0',
  });

  it('grows the binary only by the injected-JS delta, not a whole blob copy', async () => {
    const { content, clearBytecode } = await readContent(inst());
    // A realistic patch: append a small marker comment to the module source.
    const patched = content + '\n// __tweakcc_size_test__\n';
    await writeContent(inst(), patched, clearBytecode);
    const afterApply = fs.statSync(work).size;

    const grewBy = afterApply - pristineSize;
    // The injected delta is a few dozen bytes; allow generous page-alignment
    // and structural overhead, but nowhere near a second copy of the ~200 MB
    // Bun blob. 8 MB is orders of magnitude below the old ~450 MB regression.
    expect(grewBy).toBeGreaterThanOrEqual(0);
    expect(grewBy).toBeLessThan(8 * 1024 * 1024);
    // And unambiguously far below "another full copy of the binary".
    expect(grewBy).toBeLessThan(pristineSize / 4);
  });

  it('does not accumulate across repeated write passes (downstream writer)', async () => {
    const sizeBefore = fs.statSync(work).size;
    // Model a second, independent writer (e.g. cc-quote) re-patching the
    // already-patched binary — the scenario that ballooned 723 MB -> 1.26 GB.
    const { content, clearBytecode } = await readContent(inst());
    await writeContent(inst(), content, clearBytecode);
    const sizeAfter = fs.statSync(work).size;
    // Re-writing identical content must not change the size at all.
    expect(sizeAfter).toBe(sizeBefore);
  });

  it('returns to ~pristine size when the original JS is written back', async () => {
    // Read the ORIGINAL pristine JS from a fresh copy so restore is meaningful.
    const freshCopy = path.join(scratch, 'claude-fresh');
    fs.copyFileSync(PRISTINE!, freshCopy);
    fs.chmodSync(freshCopy, 0o755);
    const { content: pristineJs } = await readContent({
      kind: 'native',
      path: freshCopy,
      version: '0.0.0',
    });

    const { clearBytecode } = await readContent(inst());
    await writeContent(inst(), pristineJs, clearBytecode);
    const restored = fs.statSync(work).size;

    // Restoring the original JS lands within a page or two of pristine — no
    // stranded blob keeping the file inflated.
    expect(Math.abs(restored - pristineSize)).toBeLessThan(1024 * 1024);
  });
});
