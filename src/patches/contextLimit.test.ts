import { describe, it, expect, vi } from 'vitest';
import { writeContextLimit } from './contextLimit';

const OVERRIDE = '(+process.env.CLAUDE_CODE_CONTEXT_LIMIT||200000)';

describe('writeContextLimit', () => {
  it('overrides BOTH 200000 constants in the CC >=2.1.21x five-constant shape', () => {
    // CC ~2.1.21x dropped the 20000 constant and appended the 1e6 (1M-context)
    // ceiling; the trailing three must survive verbatim.
    const input =
      'q=1;var _er=200000,bRe=200000,$Rg=32000,URg=128000,jRg=1e6;z=2;';
    const out = writeContextLimit(input);
    expect(out).toBe(
      `q=1;var _er=${OVERRIDE},bRe=${OVERRIDE},$Rg=32000,URg=128000,jRg=1e6;z=2;`
    );
  });

  it('preserves $-prefixed minified identifiers verbatim in the replacement', () => {
    // `$$` and `$1` are special in a String.replace replacement string, so the
    // writer must use a replacer function.
    const input = 'var $a=200000,$$b=200000,$c=32000,$1=128000,$e=1e6;';
    const out = writeContextLimit(input);
    expect(out).toBe(
      `var $a=${OVERRIDE},$$b=${OVERRIDE},$c=32000,$1=128000,$e=1e6;`
    );
  });

  it('overrides BOTH 200000 constants in the CC >=2.1.18x two-constant shape', () => {
    // The window is min(o-from-fkt, KQ), so both must be overridden or the
    // override would be capped by the un-overridden one.
    const input =
      'q=1;var fkt=200000,KQ=200000,Akt=20000,MWu=32000,NWu=128000;z=2;';
    const out = writeContextLimit(input);
    expect(out).toBe(
      `q=1;var fkt=${OVERRIDE},KQ=${OVERRIDE},Akt=20000,MWu=32000,NWu=128000;z=2;`
    );
  });

  it('accepts the 64000 fourth-constant variant', () => {
    const input = 'var a=200000,b=200000,c=20000,d=32000,e=64000;';
    const out = writeContextLimit(input);
    expect(out).toContain(
      `var a=${OVERRIDE},b=${OVERRIDE},c=20000,d=32000,e=64000;`
    );
  });

  it('falls back to the older single-200000 shape', () => {
    const input = 'var aa=200000,bb=20000,cc=32000,dd=128000;';
    const out = writeContextLimit(input);
    expect(out).toBe(`var aa=${OVERRIDE},bb=20000,cc=32000,dd=128000;`);
  });

  it('returns null (logging) when neither shape is present', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(writeContextLimit('function unrelated(){return 1}')).toBeNull();
    errSpy.mockRestore();
  });

  it('produces a valid JS declaration', () => {
    const out = writeContextLimit(
      'var fkt=200000,KQ=200000,Akt=20000,MWu=32000,NWu=128000;'
    )!;
    expect(() => new Function(out + 'return 1;')).not.toThrow();
  });

  // A readable (non-minified) declaration whose first constant is literally
  // `CONTEXT_ENTRY_LIMIT` — the shape the CC 2.1.220 crash report attributed the
  // `CONTEXT_ENTRY_LIMIT is not defined` failure to. The writer must do a
  // VALUE-only replacement: keep every captured identifier name verbatim (no
  // rename) so downstream references stay bound and no dangling ref is left.
  it('preserves a readable CONTEXT_ENTRY_LIMIT identifier (value-only, no rename)', () => {
    const input =
      'var CONTEXT_ENTRY_LIMIT=200000,MODEL_WINDOW=200000,MAX_OUT=32000,MAX_OUT_UPPER=128000,MEGA=1e6;' +
      'function windowFor(n){return Math.min(Math.floor(CONTEXT_ENTRY_LIMIT*n),MODEL_WINDOW)}';
    const out = writeContextLimit(input)!;
    expect(out).not.toBeNull();
    // The declaration keeps the readable names; only the 200000 values change.
    expect(out).toContain(
      `var CONTEXT_ENTRY_LIMIT=${OVERRIDE},MODEL_WINDOW=${OVERRIDE},MAX_OUT=32000,MAX_OUT_UPPER=128000,MEGA=1e6;`
    );
    // Every reference to the preserved identifiers is still declared — no
    // `CONTEXT_ENTRY_LIMIT is not defined`.
    expect(() => new Function(out + 'return 1;')).not.toThrow();
    // The identifier the crash blamed is present as a real binding (declared),
    // never dropped or renamed.
    expect(out).toMatch(/var CONTEXT_ENTRY_LIMIT=/);
  });
});
