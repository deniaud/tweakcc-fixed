import chalk from 'chalk';
import { debug, isVerbose, stringifyRegex, verbose } from '../utils';
import { showDiff, PatchResult, PatchGroup } from './index';
import {
  loadSystemPromptsWithRegex,
  reconstructContentFromPieces,
  encodeReplacementForDelimiter,
  loadIdentifierMapUnion,
} from '../systemPromptSync';
import {
  detectUnicodeEscaping,
  extractBuildTime,
  leakedPromptPlaceholders,
  leakedBuriedPlaceholders,
  pickMatchForSpliceAt,
} from '../systemPromptSites';
import { setAppliedHashes, computeMD5Hash } from '../systemPromptHashIndex';
import { MutableText } from '../mutableText';
import {
  findAllPromptPieceMatches,
  foldPromptMatchContent,
  PromptPieceMatcherCatalog,
  PromptMatchSpec,
} from '../systemPromptPieceMatcher';

export { isTweakccHumanName } from '../systemPromptSites';

/**
 * Result of applying system prompts
 */
export interface SystemPromptsResult {
  newContent: string;
  results: PatchResult[];
}

/**
 * Apply system prompt customizations to cli.js content
 * @param content - The current content of cli.js
 * @param version - The Claude Code version
 * @param escapeNonAscii - Whether to escape non-ASCII characters (auto-detected if not specified)
 * @param patchFilter - Optional list of patch/prompt IDs to apply (if provided, only matching prompts are applied)
 * @returns SystemPromptsResult with modified content and per-prompt results
 */
export const applySystemPrompts = async (
  content: string,
  version: string,
  escapeNonAscii?: boolean,
  patchFilter?: string[] | null,
  // The binary as it was BEFORE any override splicing (inline-blob, reminders).
  // Lets us distinguish a prompt clobbered by tweakcc's own earlier splice
  // (matched the pristine binary but not the current one → silent skip) from
  // genuine anchor drift (never matched the pristine binary → warn). When
  // omitted, every non-match is treated as drift (pre-existing behavior).
  pristineContent?: string
): Promise<SystemPromptsResult> => {
  // Auto-detect if we should escape non-ASCII characters based on cli.js content
  const shouldEscapeNonAscii = escapeNonAscii ?? detectUnicodeEscaping(content);

  if (shouldEscapeNonAscii) {
    debug(
      'Detected Unicode escaping in cli.js - will escape non-ASCII characters in prompts'
    );
  }

  // Extract BUILD_TIME from cli.js content
  const buildTime = extractBuildTime(content);
  if (buildTime) {
    debug(`Extracted BUILD_TIME from cli.js: ${buildTime}`);
  }

  // Load system prompts and generate regexes
  const systemPrompts = await loadSystemPromptsWithRegex(
    version,
    shouldEscapeNonAscii,
    buildTime
  );
  debug(`Loaded ${systemPrompts.length} system prompts with regexes`);
  const matchSpecs = new Map<string, PromptMatchSpec>();
  for (const entry of systemPrompts) {
    matchSpecs.set(entry.regex, {
      regex: entry.regex,
      pieces: entry.pieces,
      version,
      buildTime,
    });
  }
  const matchCatalog = new PromptPieceMatcherCatalog([...matchSpecs.values()]);
  matchCatalog.index(content, foldPromptMatchContent(content));
  const lastMatchUse = new Map<string, number>();
  systemPrompts.forEach((entry, index) => {
    lastMatchUse.set(entry.regex, index);
  });
  const expiringMatches = new Map<number, string[]>();
  for (const [regex, index] of lastMatchUse) {
    const current = expiringMatches.get(index);
    if (current) current.push(regex);
    else expiringMatches.set(index, [regex]);
  }
  const working = new MutableText(content);
  let contentChanged =
    pristineContent !== undefined && pristineContent !== content;

  // The set of every tweakcc human-name the leaf has ever used as a
  // placeholder, unioned across all bundled prompt JSONs. Used below to detect
  // a leaked (unsubstituted) human-name surviving into a backtick template
  // literal. Loaded once per apply.
  const identifierMapUnion = await loadIdentifierMapUnion();

  // Per-id union of identifierMap names across same-id entries. A prompt that
  // exists at multiple code-sites yields one entry per site sharing one id and
  // one .md; when the sites have different shapes (e.g. a template wrapper vs
  // plain string copies), an .md authored against the richer shape carries
  // placeholders the plain entries cannot resolve — injecting it there writes
  // the placeholder names as literal text into the binary (silent content
  // corruption; quote contexts never crash). Used below to skip those sites.
  const groupNames = new Map<string, Set<string>>();
  for (const sp of systemPrompts) {
    let names = groupNames.get(sp.promptId);
    if (!names) {
      names = new Set();
      groupNames.set(sp.promptId, names);
    }
    for (const v of Object.values(sp.identifierMap)) names.add(v);
  }

  // Track per-prompt results
  const results: PatchResult[] = [];
  const appliedHashUpdates: Record<string, string> = {};
  const hashResultIndexes: number[] = [];

  // Search for and replace each prompt in cli.js
  for (const [promptIndex, entry] of systemPrompts.entries()) {
    for (const expired of expiringMatches.get(promptIndex - 1) ?? []) {
      matchCatalog.delete(expired);
    }
    const {
      promptId,
      prompt,
      regex,
      getInterpolatedContent,
      pieces,
      identifiers,
      identifierMap,
    } = entry;
    // Skip prompts not in the filter (if filter is provided)
    if (patchFilter && !patchFilter.includes(promptId)) {
      results.push({
        id: promptId,
        name: prompt.name,
        group: PatchGroup.SYSTEM_PROMPTS,
        applied: false,
        skipped: true,
      });
      continue;
    }

    debug(`Applying system prompt: ${prompt.name}`);
    const pattern = new RegExp(regex, 'si'); // 's' flag for dotAll mode, 'i' because of casing inconsistencies in unicode escape sequences (e.g. `\u201C` in the regex vs `\u201C` in the file)

    // Some short prompts (e.g. tool-description-bash-git-never-skip-hooks) hold
    // text that Anthropic also inlines verbatim into a longer prompt
    // (PowerShell tool description). The first occurrence in cli.js is the
    // inlined one; the standalone variable lives later. Pick the match that
    // looks like a complete string-literal value (surrounded by matching
    // " ' or ` delimiters) when more than one occurrence exists.
    const allMatches = await matchCatalog.matchCurrent(regex, working);
    // pickMatchForSplice keeps the sequential-consumption contract: when the
    // standalone filter can't narrow to one, index 0 is the next UNPATCHED site
    // of a multi-site prompt. Cardinality is verified up-front by the preflight.
    const { match, disambiguated } = pickMatchForSpliceAt(allMatches, index =>
      working.charAt(index)
    );
    if (disambiguated) {
      debug(
        `Disambiguated ${allMatches.length} matches \u2192 1 standalone for "${prompt.name}"`
      );
    }

    if (match && match.index !== undefined) {
      // Generate the interpolated content using the actual variables from the match
      const interpolatedContent = getInterpolatedContent(match);

      // Fail-closed guard against tweakcc's own unresolved-identifier sentinel.
      //
      // When a prompt's identifierMap has no entry for a captured label index,
      // reconstructContentFromPieces / applyIdentifierMapping fall back to the
      // literal human-name `UNKNOWN_<idx>` (see systemPromptSync.ts). If that
      // survives interpolation and gets baked into the bundle inside a `${...}`
      // template slot, CC crashes at runtime with "UNKNOWN_1 is not defined"
      // (confirmed live on CC 2.1.204 for skill-code-review-* and
      // system-reminder-askuserquestion-* overrides out of sync with this build).
      //
      // Detect any surviving multi-segment `${SCREAMING_SNAKE}` placeholder that
      // the override INTRODUCED (i.e. is NOT already a `${...}` slot in the
      // pristine bundle) and SKIP the prompt rather than ship a boot-crashing
      // reference. Both the `UNKNOWN_<idx>` sentinel and named human-name
      // placeholders such as `${CRON_DURABLE_FLAG}` / `${GITHUB_TOKEN}` were
      // observed leaking live on CC 2.1.204 (out-of-sync overrides) and each
      // crashes at runtime ("X is not defined"); the identifierMap-union guard
      // below only covers KNOWN human-names, so they slipped past it. Requiring
      // ≥2 segments avoids short minified runtime vars (never SCREAMING_SNAKE).
      // The pristine-bundle presence check keeps a placeholder that the override
      // legitimately references as a genuine runtime binding (present verbatim in
      // the original) — over-skipping only truly-introduced, unbound refs.
      // Negative lookbehind excludes an escaped `\${...}` (literal text).
      const bundleHasSlot = (id: string) =>
        new RegExp('\\$\\{\\s*' + id + '\\s*\\}').test(content);
      const leakedSet = new Set<string>();
      for (const m of interpolatedContent.matchAll(
        /(?<!\\)\$\{\s*([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*\}/g
      )) {
        const id = m[1];
        // Always skip the `UNKNOWN_<idx>` mapping-failure sentinel. Otherwise this
        // guard handles only NON-union names (known human-names are left to the
        // identifierMap-union guard below, which also handles same-id sibling
        // shapes): skip a non-union placeholder only when the override INTRODUCED
        // it (no matching `${...}` slot in the pristine bundle). A name present
        // verbatim in the original is a genuine runtime binding and must still
        // apply; an introduced non-union name (e.g. an out-of-sync `CRON_DURABLE_FLAG`
        // or an unescaped `GITHUB_TOKEN` env-var doc) bakes a boot-crashing ref.
        if (
          /^UNKNOWN_[0-9]+$/.test(id) ||
          (!identifierMapUnion.has(id) && !bundleHasSlot(id))
        ) {
          leakedSet.add(id);
        }
      }
      const leakedIdentifiers = [...leakedSet];
      if (leakedIdentifiers.length > 0) {
        console.log(
          chalk.yellow(
            `Skipping "${prompt.name}": unresolved identifier(s) ${leakedIdentifiers.join(', ')} — override out of sync with this CC build`
          )
        );
        results.push({
          id: promptId,
          name: prompt.name,
          group: PatchGroup.SYSTEM_PROMPTS,
          applied: false,
          details: `unresolved identifiers: ${leakedIdentifiers.join(', ')}`,
        });
        continue;
      }

      // Check the delimiter character before the match to determine string type
      const matchIndex = match.index;
      const delimiter = working.charAt(matchIndex - 1);

      // Guard: a tweakcc human-name placeholder that survives interpolation into
      // a `${...}` template-literal slot is invalid JS and ReferenceErrors at
      // launch (or when the prompt's code path first runs). This happens when the
      // prompt-data identifierMap vocabulary changed between CC versions (e.g.
      // PROMPT_VAR_N -> *_TOOL_NAME at 2.1.168, or a renamed semantic name like
      // OPTIONAL_TAIL_NOTE) while the markdown still references the old name, so
      // applyIdentifierMapping finds nothing to substitute and leaves the
      // placeholder verbatim. Detect a surviving `${NAME}` whose NAME is a member
      // of the identifierMap union (the set of every human-name the leaf has ever
      // used as a placeholder) and that appears unchanged in BOTH the markdown
      // source and the interpolated output. Validating against the union -- rather
      // than guessing an ALL_CAPS_WITH_UNDERSCORE grammar -- catches single-word
      // names like ${VERSION} the grammar missed and never false-positives on real
      // minified vars (e.g. `${HL7}`), which are never human-names. Only dangerous
      // inside backtick template literals; the same token in a plain '...'/"..."
      // string is inert. Skip the prompt and keep CC's original blob rather than
      // shipping a binary that won't boot.
      {
        // Only UNescaped `${NAME}` is dangerous: a backslash-escaped
        // `\${NAME}` is intentional literal text (e.g. the env-var docs
        // `\${CLAUDE_PLUGIN_ROOT}` in the cowork plugin prompts, which have an
        // empty identifierMap) and survives into the template literal verbatim.
        // The negative lookbehind excludes those so they aren't false-flagged.
        // The name is captured wherever a `${...}` slot OPENS with it, not just
        // when a `}` follows: `${NAME.prop}`, `${NAME(arg)}` and
        // `${NAME.x||"y"}` are equally undefined identifiers inside a template
        // literal. Anchoring on `\}` missed exactly those — CC 2.1.206 shipped
        // `${SYSTEM_PROMPT_AGENT_RESUMED_WAS_STOPPED_COMPLETED_VAR_2.finalText
        // ||"(no text output)"}` into the binary because of it.
        // Slot-open guard (`${NAME…`) PLUS, for backtick template-literal
        // splices only, a buried-identifier guard: a dangling human-name used as
        // a bare reference INSIDE an interpolation expression (e.g.
        // `${x.entries(CONTEXT_ENTRY_LIMIT)}`) ReferenceErrors at runtime just
        // like a slot-open one, but is invisible to the slot-open regex. Inside
        // a plain '…'/"…" string the same `${...}` is inert text, so the buried
        // scan is gated on the backtick delimiter.
        const leaked = [
          ...new Set([
            ...leakedPromptPlaceholders(
              interpolatedContent,
              prompt.content,
              identifierMapUnion
            ),
            ...(delimiter === '`'
              ? leakedBuriedPlaceholders(
                  interpolatedContent,
                  prompt.content,
                  identifierMapUnion
                )
              : []),
          ]),
        ];

        // Every leaked name resolvable by a same-id sibling entry (and none by
        // this one) means the .md is authored against a different shape of
        // this multi-site prompt. Expected per-site situation, not drift:
        // leave this site pristine, quietly.
        const ownNames = new Set(Object.values(identifierMap));
        const siblingNames = groupNames.get(promptId);
        if (
          leaked.length > 0 &&
          leaked.every(n => !ownNames.has(n) && siblingNames?.has(n))
        ) {
          debug(
            `"${prompt.name}": placeholders resolve via a same-id sibling shape — leaving this site pristine`
          );
          results.push({
            id: promptId,
            name: prompt.name,
            group: PatchGroup.SYSTEM_PROMPTS,
            applied: false,
            skipped: true,
          });
          continue;
        }

        // A leaked name this entry should have resolved (or that no sibling
        // can): genuine vocabulary drift. Inside a backtick template literal
        // it is invalid JS that ReferenceErrors at launch — skip loudly. In
        // '…'/"…" strings the same token is inert text and can be intentional
        // (e.g. data-anthropic-cli's literal ${VERSION}), so it passes through
        // unchanged there.
        if (delimiter === '`' && leaked.length > 0) {
          console.log(
            chalk.red(
              `Unresolved placeholder \${${leaked[0]}} in "${prompt.name}" (markdown vocabulary out of sync with CC ${version} prompt data) - skipping`
            )
          );
          results.push({
            id: promptId,
            name: prompt.name,
            group: PatchGroup.SYSTEM_PROMPTS,
            applied: false,
            details: `unresolved placeholder \${${leaked[0]}} - markdown out of sync with prompt data`,
          });
          continue;
        }
      }

      // Calculate character counts for this prompt (both with human-readable placeholders)
      // Note: trim() to match how markdown files are parsed and how whitespace is applied
      const originalBaselineContent = reconstructContentFromPieces(
        pieces,
        identifiers,
        identifierMap
      ).trim();
      const originalLength = originalBaselineContent.length;
      const newLength = prompt.content.trim().length;

      const verboseOldContent = isVerbose() ? working.toString() : null;
      const matchLength = match[0].length;

      const encoded = encodeReplacementForDelimiter(
        interpolatedContent,
        delimiter,
        shouldEscapeNonAscii
      );
      if (encoded.incomplete) {
        console.log(
          chalk.red(
            `Incomplete backtick escaping for "${prompt.name}" (unclosed interpolation) - skipping`
          )
        );
        results.push({
          id: promptId,
          name: prompt.name,
          group: PatchGroup.SYSTEM_PROMPTS,
          applied: false,
          details: 'incomplete escaping: unclosed interpolation detected',
        });
        continue;
      }
      if (encoded.autoEscaped) {
        // Successful auto-repair, not an actionable condition: the override
        // applies correctly. Keep it out of the apply log (0-warnings bar).
        debug(`Auto-escaped unescaped backticks in "${prompt.name}"`);
      }
      const replacementContent = encoded.content;

      // Replace the matched content with the interpolated content from the markdown file.
      // Splice at the match offset (rather than `content.replace(pattern, fn)`)
      // so the disambiguation above isn't undone by replace() always matching
      // the first hit.
      if (replacementContent !== match[0]) {
        working.splice(
          matchIndex,
          matchIndex + matchLength,
          replacementContent
        );
        contentChanged = true;
        matchCatalog.recordSplice(working, {
          start: matchIndex,
          end: matchIndex + matchLength,
          replacementLength: replacementContent.length,
        });
      }

      // Store the hash of the applied prompt content
      const appliedHash = computeMD5Hash(prompt.content);
      appliedHashUpdates[promptId] = appliedHash;

      // Show diff in debug mode
      if (verboseOldContent !== null) {
        showDiff(
          verboseOldContent,
          working.toString(),
          replacementContent,
          matchIndex,
          matchIndex + matchLength
        );
      }

      // Track this prompt's result
      const charDiff = originalLength - newLength;
      const applied = replacementContent !== match[0];

      let details: string;
      if (charDiff > 0) {
        details = chalk.green(`${charDiff} fewer chars`);
      } else if (charDiff < 0) {
        details = chalk.red(`${Math.abs(charDiff)} more chars`);
      } else {
        details = 'unchanged';
      }

      const resultIndex = results.length;
      results.push({
        id: promptId,
        name: prompt.name,
        group: PatchGroup.SYSTEM_PROMPTS,
        applied,
        details,
      });
      hashResultIndexes.push(resultIndex);
    } else {
      // Shadowed prompts (owned by inline-blob, system-reminders, or a wider
      // named-prompt) are filtered upstream in loadSystemPromptsWithRegex via
      // the `shadows:` frontmatter on the owning override.
      //
      // A prompt can also be shadowed implicitly: its text lives inside a
      // region an inline-blob/reminder override already replaced this apply
      // (e.g. a "## Types of memory" array element, a "# System" bullet). The
      // override author may not have enumerated every named id its region
      // consumes. Detect this by re-matching against the pristine snapshot:
      // if the regex matched the binary BEFORE any splicing but not now, our
      // own earlier override clobbered it — its curated content was
      // intentionally superseded, so skip silently (no drift warning, no
      // spurious "Could not find"). Only a prompt that matched neither the
      // pristine nor the current binary is genuine anchor drift worth
      // surfacing.
      let clobberedByEarlierSplice = false;
      if (pristineContent !== undefined && contentChanged) {
        try {
          const spec = matchSpecs.get(regex);
          const matchedPristine = spec
            ? await findAllPromptPieceMatches(spec, pristineContent)
            : [];
          clobberedByEarlierSplice = matchedPristine.length > 0;
        } catch {
          clobberedByEarlierSplice = false;
        }
      }

      if (clobberedByEarlierSplice) {
        debug(
          `"${prompt.name}": region consumed by an earlier inline-blob/reminder override — leaving superseded, no warning`
        );
        results.push({
          id: promptId,
          name: prompt.name,
          group: PatchGroup.SYSTEM_PROMPTS,
          applied: false,
          skipped: true,
        });
        continue;
      }

      // Genuine drift — a regex anchor that no longer matches the binary
      // shape. Surface it so the owning override can be fixed.
      if (
        !prompt.name.startsWith('Data:') &&
        prompt.name !== 'Skill: Build with Claude API'
      ) {
        console.log(
          chalk.yellow(
            `Could not find system prompt "${prompt.name}" in cli.js (using regex ${stringifyRegex(pattern)})`
          )
        );
      }

      if (isVerbose()) {
        verbose(`\n  Debug info for ${prompt.name}:`);
        verbose(
          `  Regex pattern (first 200 chars): ${regex.substring(0, 200).replace(/\n/g, '\\n')}...`
        );
        verbose(`  Trying to match pattern in cli.js...`);
        try {
          const testMatch = working
            .toString()
            .match(new RegExp(regex.substring(0, 100)));
          verbose(
            `  Partial match result: ${testMatch ? 'found partial' : 'no match'}`
          );
        } catch {
          verbose(`  Partial match failed (regex truncation issue)`);
        }
      }
    }
  }

  try {
    await setAppliedHashes(appliedHashUpdates);
  } catch (error) {
    debug(`Failed to store applied prompt hashes: ${error}`);
    for (const index of hashResultIndexes) {
      const result = results[index];
      if (!result) continue;
      result.failed = true;
      result.details = result.details
        ? `${result.details} (hash storage failed)`
        : 'hash storage failed';
    }
  }

  return {
    newContent: working.toString(),
    results,
  };
};
