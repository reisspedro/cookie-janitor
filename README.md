# 🧹 Cookie Janitor

A browser extension (Manifest V3 — Chrome, Brave, Edge) that answers one simple question:
**which sites keep cookies in your browser that you no longer use?**

It cross-references every cookie with your browsing history and separates *recency* from
*frequency* — because they are different things: some site you visited yesterday but only
opened once all month.

![panel](icones/icone-128.png)

> **Interface language:** the UI is currently in Brazilian Portuguese. Everything documented
> here works the same regardless; `_locales` support is planned. Issues and PRs in English are
> welcome.

## What the panel shows

For every domain holding a cookie, three independent measures:

- **First visit** — how far back this site goes in your life, with date and time.
- **Last visit** — when you were last there, with date and time.
- **Usage in window** — how many visits, across how many distinct days, in the last 7 or 30 days.

Status comes from recency:

| Status | Criterion |
|---|---|
| `active` | visited in the last 30 days |
| `idle` | 31–90 days without a visit |
| `old` | 91+ days without a visit |
| `no record` | no visit found in history |

Frequency is classified as `frequent`, `regular` and **`barely used`** — the cross-reference
that reveals the interesting case: a site you opened recently but hardly ever used.

`no record` does **not** mean abandoned: it can be cleared history, private browsing, or a
cookie set by embedded content. That is why nothing is pre-selected — ticking a box is always
an explicit act on your part.

## ⚠️ About the backup file

Before deleting, the extension can save a backup. **That backup contains the `value` of every
cookie — which is to say, live session credentials.** Anyone holding that file can replay your
logged-in sessions for as long as those cookies remain valid.

Consequences worth taking seriously:

- The `.json` lands in your **Downloads folder in plain text**. Treat it exactly like a
  password file: don't sync it, don't attach it to an issue, don't paste it into a chat, and
  delete it once you're satisfied with the cleanup.
- A second copy is kept inside the extension (`chrome.storage.local`) so *Undo last cleanup*
  still works if the download was blocked. It is unencrypted, it survives clearing your cache
  and history, and it normally only disappears when the extension is uninstalled. Use
  **Delete stored backup** to wipe it as soon as you no longer need the undo.
- If the backup is larger than ~4 MB the internal copy is skipped — the panel now says so
  explicitly, because otherwise you would believe you had an undo you don't have.
- `cookies-backup-*.json` is in `.gitignore` so it never reaches a commit by accident.

If you don't want either copy, untick **Backup before deleting** — you just lose the undo.

Restoring works the other way round: a backup file writes session cookies into your browser,
so importing someone else's file would plant *their* sessions in *your* browser. The file
picker asks for confirmation, but the real rule is simple — only restore files you generated
yourself.

## Safety

Deleting a cookie logs you out of that site, so there are four brakes:

1. **Nothing is pre-selected.** Ticking is always explicit.
2. **Protected list** — domains that can never be selected. Ships with Brazilian government
   and banking domains, plus PayPal and Binance. Editable via the padlock on each row, saved
   locally.
3. **Double backup** — see the warning above.
4. **Confirmation** stating how many cookies and domains are affected, and an honest report
   afterwards: how many were deleted, how many no longer existed, how many failed.

It can optionally also clear localStorage, IndexedDB, cache and service workers for the
selected domains (off by default).

## Install

1. Open `chrome://extensions` (or `brave://extensions`)
2. Enable **Developer mode**
3. **Load unpacked** and select this folder
4. Click the cookie icon → **Open panel**

When upgrading, hit reload on the extension card — new manifest permissions only take effect
after a reload.

## Permissions

| Permission | Why |
|---|---|
| `cookies` | read and delete cookies |
| `history` | find out which sites you visited and how often |
| `storage` | keep the protected list, the last-cleanup date, **and the undo copy of the backup — which contains cookie values** |
| `browsingData` | clear site data (only when that option is ticked) |
| `<all_urls>` | without it the browser only hands over cookies for the active tab |

**No network request is ever made.** Everything runs locally; nothing leaves your machine.
There is no `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` anywhere in the source —
grep for them.

## How the measurements work

`chrome.history.search` returns **one entry per page, carrying that page's last visit** — not
a list of visits. Counting frequency by sweeping time windows with it produces wrong numbers,
and without `startTime: 0` the search only sees the last 24 hours.

Its `text` parameter is a **free-text query**, not a domain filter: Chrome tokenises it and
matches loosely against URL *and* title, so querying one domain at a time silently returned
nothing for many of them — leaving both date columns empty. So the history is read **once**,
with `text: ''` and `startTime: 0`, and grouped by domain locally. Exact, and one query
instead of hundreds.

Then `chrome.history.getVisits` returns **every visit of every page**, timestamped. That is
where first visit, exact last visit and the window count come from.

If `getVisits` is unavailable or the query budget runs out, the panel falls back to each
page's `lastVisitTime` — a real floor rather than an empty column — and marks the row **⚠**.
Any row with **⚠** should be read as a minimum, never a total.

**Ceiling worth knowing:** Chrome only retains browsing history for about 90 days by default.
"First visit" therefore means *the earliest visit still in your history*, not the first time
ever. If your oldest dates all cluster around three months back, that's the browser's
retention limit, not the extension's.

## Domain grouping

Cookies are grouped by registrable domain, and getting that boundary wrong would be serious:
merging `alice.github.io` with `bob.github.io` would make one selection delete cookies for two
independent sites. So IPv4, IPv6, `localhost` and single-label hosts are kept whole; there is
a list of public suffixes (`co.uk`, `com.br`) and of hosting domains where each subdomain is
its own site (`github.io`, `vercel.app`, `netlify.app`); plus a generic ccTLD rule.

This is not the full [Public Suffix List](https://publicsuffix.org/), and it is worth being
precise about the limitation: for a **known** hosting domain each subdomain stays its own row,
but for a multi-tenant platform that is *not* on the list the fallback keeps the last two
labels and therefore groups its subdomains together. So the rule is "keep hosts separate
wherever we can recognise the case", not a guarantee for every platform that exists.

Erring toward showing two rows is harmless; erring toward merging independent sites would
delete data you never chose. If you hit a platform that groups wrongly, adding it to
`SUFIXOS_PRIVADOS` is a one-line fix — issues welcome.

## License

MIT
