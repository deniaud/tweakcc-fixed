# Citation Modal Selection Hook — WIP, not yet implemented

This is the UI half of the citation feature. The backbone (parser + expander

- runtime registry) is shipped in:

* `citationPlaceholderParser.ts`
* `citationExpanderOnSend.ts`

The UI hook is deferred because it requires interactive UI testing (mouse
selection inside a terminal that supports OSC 52, modal-with-keyboard
interaction, then verification that the placeholder appears in the prompt
input). That cannot be validated from a non-interactive task runner.

## What it needs to do

When the user selects text inside the CC TUE, instead of the current
behaviour (silent OSC 52 copy + toast `sent N chars via OSC 52 …`),
show an **inline prompt**:

```
Selected N chars · [c]opy · [q]uote · [esc]
```

- `c` → run the original OSC 52 copy path (existing UT function), then close.
- `q` → open a one-line inline input for the user's comment; on Enter,
  call `globalThis.__cc_citations__.insertPlaceholder(text, comment)`
  and insert the returned placeholder into the main TextInput at the
  caret. The registry + insertPlaceholder are already injected by
  `citationExpanderOnSend.ts`.
- `esc` → close, do nothing.

## Anchors confirmed in CC 2.1.143 bundle

(line numbers refer to `~/.tweakcc/native-claudejs-orig.js`)

### 1. OSC 52 copy hub — `async function UT(H)` (line 550)

```js
async function UT(H) {
  let $ = q76.Buffer.from(H, 'utf8').toString('base64'),
    q = pj(GO.CLIPBOARD, 'c', $);
  if (!process.env.SSH_CONNECTION) hR1(H); // pbcopy / wl-copy / xclip / xsel
  if (await ER1(H)) return NR1(`${Ak}]52;c;${$}${BT}`); // OSC 52 escape
  return q;
}
```

This is the **single point of entry** for clipboard copy across all back-ends
(native, tmux-buffer, osc52). Patching here disables auto-copy uniformly.

Patch strategy:

```js
async function UT(H){
  if (globalThis.__cc_on_selection) {
    return globalThis.__cc_on_selection(H, /* originalUT */ async function(){
      let $ = q76.Buffer.from(H,"utf8").toString("base64"),
          q = pj(GO.CLIPBOARD,"c",$);
      if (!process.env.SSH_CONNECTION) hR1(H);
      if (await ER1(H)) return NR1(`${Ak}]52;c;${$}${BT}`);
      return q
    });
  }
  // (fallback to original body if hook not installed)
  ...
}
```

`globalThis.__cc_on_selection` is the new router. It registers the pending
selection (text, callback) for the modal component to pick up.

### 2. Toast formatter — line 9437

```js
let $ = Zr$(), // returns "native" | "tmux-buffer" | "osc52"
  q = sXH(H), // char count
  K = q === 1 ? 'char' : 'chars',
  _;
switch ($) {
  case 'native':
    _ = `copied ${q} ${K} to clipboard`;
    break;
  case 'tmux-buffer':
    _ = `copied ${q} ${K} to tmux buffer · paste with prefix + ]`;
    break;
  case 'osc52':
    _ = `sent ${q} ${K} via OSC 52 · check terminal clipboard settings if paste fails`;
    break;
}
return {
  key: 'selection-copied',
  text: _,
  color: 'suggestion',
  priority: 'immediate',
  timeoutMs: $ === 'native' ? 2000 : 4000,
};
```

This is **after** copy; we only want to suppress it when our modal took over.
Cleanest fix: keep this formatter as-is, but have the modal short-circuit
the `UT` call until the user picks Copy.

### 3. Selection state machine — `function rZ8(H, $, q)` (line 9437, after toast)

```js
function rZ8(H,$,q){
  let K = PtH.useRef(!1),
      _ = PtH.useRef(q);
  _.current = q;
  PtH.useEffect(() => {
    if (!$) return;
    return H.subscribe(() => {
      let z = H.getState(),
          Y = H.hasSelection();
      if (z?.isDragging) { K.current = !1; return; }
      ...
    });
  });
}
```

`H` is the selection store (with `subscribe`, `getState`, `hasSelection`).
`PtH` is the React module. This hook runs once the drag finishes and
hasSelection becomes true. The actual `UT(text)` call happens further down
in this useEffect callback — that's the entry to copy.

Patching here (instead of UT) is more surgical: skip the UT call entirely
when the modal feature flag is on, and instead push to the modal store.

## Modal component injection

CC TUI is Ink + React. The Ink components Box and Text and the `useInput`
hook are available — `tweakcc-fixed/src/patches/helpers.ts` already exports
`findBoxComponent`, `findTextComponent`, `getReactVar`. For `useInput`, no
helper exists yet — discover it via the pattern:

```
function ([$\w]+)\(\)\{return\(0,[$\w]+\.useInput\)
```

or inline through the React module: `(0,REACT.useInput)(handler, {isActive})`.

Place the modal at App-root level so it overlays the prompt. Subscribe to a
new store `globalThis.__cc_selection_pending__` and render only when set.

## Suggested patch file layout

- `citationModalSelectionHook.ts`
  - Patch UT (or rZ8) to push selection into `__cc_selection_pending__`
    instead of copying.
  - Inject the modal component definition + an App-root render hook.
  - Wire keyboard actions (`c`, `q`, `esc`) via useInput.
  - Custom action: render inline TextInput, on Enter call
    `__cc_citations__.insertPlaceholder(text, comment)` and dispatch the
    returned placeholder to the prompt-input's setText action.

## Verification plan (when ready to ship)

1. Build with tweakcc apply.
2. Launch claude in alacritty / kitty / gnome-terminal (terminals with OSC 52
   support).
3. Select text in the model's response with the mouse → confirm the inline
   prompt appears (not the OSC 52 toast).
4. `c` → confirm `xclip -o` returns the selected text; modal disappears.
5. `q` → confirm input field opens; type a comment; Enter →
   `[Pasted citation #1 "preview…"]` appears in the prompt input.
6. Send the message; in `~/.claude/projects/<dir>/*.jsonl` find the latest
   `user` event and confirm `message.content` contains the
   `<assistant-quotes-with-comments>` block.
7. Send a message containing two citations (one with comment, one without)
   and confirm grouping rules match the format in `wise-hugging-valiant.md`.
