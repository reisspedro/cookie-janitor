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
  still works if the download was blocked. It is unencrypted and stays until overwritten.
- `cookies-backup-*.json` is in `.gitignore` so it never reaches a commit by accident.

If you don't want either copy, untick **Backup before deleting** — you just lose the undo.

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
| `storage` | keep the protected list and the last-cleanup date |
| `browsingData` | clear site data (only when that option is ticked) |
| `<all_urls>` | without it the browser only hands over cookies for the active tab |

**No network request is ever made.** Everything runs locally; nothing leaves your machine.
There is no `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` anywhere in the source —
grep for them.

## How the measurements work

`chrome.history.search` returns **one entry per page, carrying that page's last visit** — not
a list of visits. Counting frequency by sweeping time windows with it produces wrong numbers,
and without `startTime: 0` the search only sees the last 24 hours.

Here each domain is resolved in two steps: `search` with `startTime: 0` lists the pages for
that host, and `chrome.history.getVisits` returns **every visit of every page**, timestamped.
That is where first visit, exact last visit and the window count come from.

When a domain has more pages than the query budget allows, the row gets a **⚠** and its
numbers should be read as a floor, never a total.

## Domain grouping

Cookies are grouped by registrable domain, and getting that boundary wrong would be serious:
merging `alice.github.io` with `bob.github.io` would make one selection delete cookies for two
independent sites. So IPv4, IPv6, `localhost` and single-label hosts are kept whole; there is
a list of public suffixes (`co.uk`, `com.br`) and of hosting domains where each subdomain is
its own site (`github.io`, `vercel.app`, `netlify.app`); plus a generic ccTLD rule.

This is not the full [Public Suffix List](https://publicsuffix.org/). When in doubt the
extension groups **less**, keeping hosts separate — erring toward showing two rows is
harmless; erring toward merging independent sites would delete data you never chose.

## License

MIT
