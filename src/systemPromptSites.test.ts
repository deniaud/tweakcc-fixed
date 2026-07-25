import { describe, it, expect } from 'vitest';
import {
  changedSpan,
  delimiterBefore,
  interpolationCodeIdentifiers,
  introducedRawNonAscii,
  leakedBuriedPlaceholders,
  leakedPromptPlaceholders,
  lintBacktickEscapes,
  literalProbeRuns,
  literalProbeWindows,
  OffsetMapper,
  pickMatchForSplice,
  presentLiterals,
  resolveCandidateSites,
  spanConflicts,
  SpanClaim,
} from './systemPromptSites';

const matchAt = (content: string, text: string, from = 0) => {
  const index = content.indexOf(text, from);
  const m = [text] as unknown as RegExpExecArray;
  m.index = index;
  return m;
};

const claim = (over: Partial<SpanClaim> & { start: number; end: number }) =>
  ({
    surface: 'prompt',
    id: 'x',
    site: 0,
    mutates: true,
    body: '',
    replacement: '',
    ...over,
  }) as SpanClaim;

describe('pickMatchForSplice', () => {
  it('returns null when nothing matched', () => {
    expect(pickMatchForSplice('abc', []).match).toBeNull();
  });

  it('disambiguates to the standalone string-literal value', () => {
    const content = 'x("hooks")+y=`prefix hooks suffix`';
    const matches = [
      matchAt(content, 'hooks', 0),
      matchAt(content, 'hooks', 12),
    ];
    const picked = pickMatchForSplice(content, matches);
    expect(picked.disambiguated).toBe(true);
    expect(picked.match?.index).toBe(content.indexOf('"hooks"') + 1);
  });

  it('keeps index 0 when ambiguous — sequential consumption of multi-site prompts', () => {
    // Two identical standalone sites: one catalogue entry splices each in turn,
    // so index 0 must stay the next unpatched site rather than becoming an error.
    const content = 'a="dup",b="dup"';
    const matches = [matchAt(content, 'dup', 0), matchAt(content, 'dup', 8)];
    const picked = pickMatchForSplice(content, matches);
    expect(picked.disambiguated).toBe(false);
    expect(picked.match).toBe(matches[0]);
  });
});

describe('resolveCandidateSites', () => {
  it('keeps every match when the count already equals the multiplicity', () => {
    const content = 'a="dup",b="dup"';
    const matches = [matchAt(content, 'dup', 0), matchAt(content, 'dup', 8)];
    expect(resolveCandidateSites(content, matches, 2)).toHaveLength(2);
  });

  it('narrows to the standalone sites when that hits the multiplicity', () => {
    const content = 'inline hooks here;x="hooks"';
    const matches = [
      matchAt(content, 'hooks', 0),
      matchAt(content, 'hooks', 12),
    ];
    const resolved = resolveCandidateSites(content, matches, 1);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].index).toBe(content.indexOf('"hooks"') + 1);
  });
});

describe('lintBacktickEscapes', () => {
  it('flags a lone backslash escape that the template literal would cook', () => {
    const findings = lintBacktickEscapes('use [\\s\\S] to match');
    expect(findings.map(f => f.offending)).toEqual(['\\s', '\\S']);
    expect(findings[0].kind).toBe('lossy');
    expect(findings[0].required).toBe('\\\\s');
  });

  it('flags the jq-style `\\(` that silently loses its backslash', () => {
    const findings = lintBacktickEscapes('--jq \'"\\(.user.login)"\'');
    expect(findings).toHaveLength(1);
    expect(findings[0].offending).toBe('\\(');
    expect(findings[0].kind).toBe('lossy');
  });

  it('flags a backslash-newline line continuation', () => {
    const findings = lintBacktickEscapes('first \\\nsecond');
    expect(findings).toHaveLength(1);
    expect(findings[0].offending).toBe('\\<newline>');
  });

  it('classifies a redundant quote escape separately', () => {
    const findings = lintBacktickEscapes('say \\"hello\\"');
    expect(findings).toHaveLength(2);
    expect(findings.every(f => f.kind === 'redundant')).toBe(true);
  });

  it('accepts the two escapes that protect source syntax', () => {
    expect(lintBacktickEscapes('a \\` b \\${NOT_A_SLOT} c')).toEqual([]);
  });

  it('accepts an even-parity run — the author already doubled it', () => {
    expect(lintBacktickEscapes('regex [\\\\s\\\\S] ok')).toEqual([]);
  });

  it('ignores backslashes inside a ${...} interpolation — that is JS, not prose', () => {
    expect(lintBacktickEscapes('${x.replace(/\\s+/g, " ")} tail')).toEqual([]);
  });

  it('does not treat an escaped \\${ as an interpolation opener', () => {
    // The `\n` after the escaped slot must still be reported: mistaking
    // `\${...}` for a real interpolation would swallow the rest of the line.
    const findings = lintBacktickEscapes('\\${CLAUDE_PLUGIN_ROOT} then \\n');
    expect(findings.map(f => f.offending)).toEqual(['\\n']);
  });

  it('reports the 1-based line and its text', () => {
    const findings = lintBacktickEscapes('line one\nline \\s two\nline three');
    expect(findings[0].line).toBe(2);
    expect(findings[0].lineText).toBe('line \\s two');
  });
});

describe('changedSpan / OffsetMapper', () => {
  it('returns null for identical content', () => {
    expect(changedSpan('abc', 'abc')).toBeNull();
  });

  it('locates the replaced span', () => {
    expect(changedSpan('aaXXbb', 'aaYYYbb')).toEqual({ start: 2, end: 4 });
  });

  it('survives a span longer than the comparison chunk', () => {
    const pad = 'p'.repeat(200_000);
    expect(changedSpan(pad + 'XX' + pad, pad + 'Y' + pad)).toEqual({
      start: 200_000,
      end: 200_002,
    });
  });

  it('maps working offsets back to pristine after earlier splices', () => {
    const mapper = new OffsetMapper();
    mapper.record({ start: 10, end: 20 }, 4); // 10 chars -> 4
    expect(mapper.toPristine(4)).toBe(4);
    expect(mapper.toPristine(14)).toBe(20);
    expect(mapper.spanToPristine({ start: 30, end: 40 })).toEqual({
      start: 36,
      end: 46,
    });
  });
});

describe('spanConflicts', () => {
  const never = () => false;

  it('reports the later claim when an earlier surface owns the bytes', () => {
    const owner = claim({
      start: 0,
      end: 100,
      surface: 'inline-blob',
      id: 'blob',
    });
    const loser = claim({ start: 10, end: 20, id: 'prompt-a', body: 'mine' });
    const conflicts = spanConflicts([owner, loser], never);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].claim.id).toBe('prompt-a');
    expect(conflicts[0].owner.id).toBe('blob');
  });

  it('ignores a loser whose content the owner already carries', () => {
    const owner = claim({
      start: 0,
      end: 100,
      surface: 'inline-blob',
      id: 'blob',
      body: 'intro\n  <when>text</when>\noutro',
    });
    const loser = claim({
      start: 10,
      end: 20,
      id: 'prompt-a',
      body: '<when>text</when>',
    });
    expect(spanConflicts([owner, loser], never)).toEqual([]);
  });

  it('ignores a pristine passthrough loser', () => {
    const owner = claim({ start: 0, end: 100, id: 'blob' });
    const loser = claim({
      start: 10,
      end: 20,
      id: 'p',
      mutates: false,
      body: 'x',
    });
    expect(spanConflicts([owner, loser], never)).toEqual([]);
  });

  it('honours an explicit shadows: declaration', () => {
    const owner = claim({ start: 0, end: 100, id: 'blob' });
    const loser = claim({ start: 10, end: 20, id: 'p', body: 'x' });
    const shadowedBy = (o: string, v: string) => o === 'blob' && v === 'p';
    expect(spanConflicts([owner, loser], shadowedBy)).toEqual([]);
  });

  it('does not report disjoint claims or the same id at several sites', () => {
    const a = claim({ start: 0, end: 10, id: 'p', site: 0, body: 'x' });
    const b = claim({ start: 20, end: 30, id: 'p', site: 1, body: 'x' });
    expect(spanConflicts([a, b], never)).toEqual([]);
  });
});

describe('literalProbeRuns', () => {
  it('returns the runs outside interpolations, longest first', () => {
    const runs = literalProbeRuns(
      'a shorter run ${VAR} a much longer literal run of prose here',
      10
    );
    expect(runs).toEqual([
      'a much longer literal run of prose here',
      'a shorter run',
    ]);
  });

  it('drops runs under the minimum length', () => {
    expect(literalProbeRuns('a ${X} b ${Y} c', 10)).toEqual([]);
  });

  it('is empty when the replacement is nothing but interpolations', () => {
    expect(literalProbeRuns('${A}${B.c(d)}${E}', 25)).toEqual([]);
  });

  it('does not mistake an escaped ${ for an interpolation', () => {
    expect(
      literalProbeRuns('\\${NOT_A_SLOT} and the rest of the line', 10)
    ).toEqual(['\\${NOT_A_SLOT} and the rest of the line']);
  });

  it('keeps ${...} probeable when the containing site is quoted', () => {
    expect(
      literalProbeRuns('authored ${LITERAL} quoted text', 10, false)
    ).toEqual(['authored ${LITERAL} quoted text']);
  });
});

describe('literalProbeWindows', () => {
  it('keeps partial delivery observable inside one long literal run', () => {
    const opening = 'opening authored region '.repeat(8);
    const tail = 'later delivered region '.repeat(8);
    const windows = literalProbeWindows(opening + tail, 25, 80);
    expect(windows.length).toBeGreaterThan(2);
    expect(windows.some(window => opening.includes(window))).toBe(true);
    expect(windows.some(window => tail.includes(window))).toBe(true);
  });

  it('covers chunk boundaries so separately present halves are not delivery', () => {
    const left = 'L'.repeat(80);
    const right = 'R'.repeat(80);
    const windows = literalProbeWindows(left + right, 25, 80);
    expect(
      windows.some(window => window.includes('L') && window.includes('R'))
    ).toBe(true);
  });

  it('retains a unique full run when every fixed-size window is old text', () => {
    const run = `${'A'.repeat(80)}${'B'.repeat(80)}`;
    expect(literalProbeWindows(run, 25, 80)).toContain(run);
  });

  it('does not turn interpolation-only content into evidence', () => {
    expect(literalProbeWindows('${A}${B.c(d)}${E}', 25, 80)).toEqual([]);
  });
});

describe('presentLiterals', () => {
  it('finds overlapping needles in one content pass', () => {
    expect(
      presentLiterals('the authored region reaches the final site', [
        'authored region',
        'region reaches',
        'missing region',
      ])
    ).toEqual(new Set(['authored region', 'region reaches']));
  });
});

describe('introducedRawNonAscii', () => {
  it('reports only codepoints the pristine text lacks', () => {
    expect(introducedRawNonAscii('a — b', 'a — b … c')).toEqual(['U+2026']);
  });

  it('is silent when everything is escaped', () => {
    expect(introducedRawNonAscii('a — b', 'a \\u2014 b')).toEqual([]);
  });
});

describe('delimiterBefore', () => {
  it('reads the character immediately before the match', () => {
    expect(delimiterBefore('x=`body`', 3)).toBe('`');
    expect(delimiterBefore('body', 0)).toBe('');
  });
});

describe('interpolationCodeIdentifiers', () => {
  it('collects value-position identifiers inside ${...} interpolations', () => {
    // The exact shape of the CC 2.1.220 question-context reminder override.
    const body =
      '<system-reminder>\nAs you answer:\n' +
      '${QUESTION_CONTEXT.entries(CONTEXT_ENTRY_LIMIT).map(([CE_TITLE,CE_BODY])=>`# ${CE_TITLE}\n${CE_BODY}`).join(`\n`)}\n';
    const ids = interpolationCodeIdentifiers(body);
    expect(ids.has('QUESTION_CONTEXT')).toBe(true);
    expect(ids.has('CONTEXT_ENTRY_LIMIT')).toBe(true); // buried as a call arg
    expect(ids.has('CE_TITLE')).toBe(true);
    expect(ids.has('CE_BODY')).toBe(true);
    // Property-access names are NOT free variables.
    expect(ids.has('entries')).toBe(false);
    expect(ids.has('map')).toBe(false);
    expect(ids.has('join')).toBe(false);
  });

  it('ignores identifiers that are literal string content, not code', () => {
    const ids = interpolationCodeIdentifiers('${fn("NOT_A_VAR", OTHER_VAR)}');
    expect(ids.has('OTHER_VAR')).toBe(true);
    expect(ids.has('NOT_A_VAR')).toBe(false); // inside a string literal
  });

  it('ignores SCREAMING_SNAKE tokens outside interpolations (literal text)', () => {
    const ids = interpolationCodeIdentifiers('plain text CONTEXT_ENTRY_LIMIT here');
    expect(ids.has('CONTEXT_ENTRY_LIMIT')).toBe(false);
  });

  it('descends into nested template literals', () => {
    const ids = interpolationCodeIdentifiers('${a.map(x=>`v=${INNER_VAR}`)}');
    expect(ids.has('INNER_VAR')).toBe(true);
  });
});

describe('leakedBuriedPlaceholders', () => {
  const union = new Set(['CONTEXT_ENTRY_LIMIT', 'QUESTION_CONTEXT']);
  // After substitution QUESTION_CONTEXT/title/body resolved to minified names,
  // but CONTEXT_ENTRY_LIMIT (absent from the override's variables list) survived
  // verbatim as a bare call argument.
  const interpolated =
    '${t.entries(CONTEXT_ENTRY_LIMIT).map(([q,K])=>`# ${q}\n${K}`).join(`\n`)}';
  const markdown =
    '${QUESTION_CONTEXT.entries(CONTEXT_ENTRY_LIMIT).map(([CE_TITLE,CE_BODY])=>`# ${CE_TITLE}\n${CE_BODY}`).join(`\n`)}';

  it('flags a dangling human-name buried in an interpolation expression', () => {
    expect(leakedBuriedPlaceholders(interpolated, markdown, union)).toEqual([
      'CONTEXT_ENTRY_LIMIT',
    ]);
  });

  it('is the ONLY guard that catches it — the slot-open guard misses it', () => {
    // Regression proof: leakedPromptPlaceholders looks only at `${NAME`, so it
    // cannot see a name buried as a call argument. This is exactly why the
    // reference leaked into patched CC 2.1.220 and crashed the worker.
    expect(
      leakedPromptPlaceholders(interpolated, markdown, union)
    ).not.toContain('CONTEXT_ENTRY_LIMIT');
  });

  it('does not flag a name that was properly substituted (did not survive)', () => {
    const resolved = '${t.entries(Q9).map(([q,K])=>`# ${q}`)}';
    expect(leakedBuriedPlaceholders(resolved, markdown, union)).toEqual([]);
  });

  it('does not flag a name absent from the identifierMap union', () => {
    expect(
      leakedBuriedPlaceholders(interpolated, markdown, new Set(['SOMETHING_ELSE']))
    ).toEqual([]);
  });
});
