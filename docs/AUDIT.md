# Repository audit — 2026-10-27

Baseline commit: `65592e57901c` plus the local preparation changes.

**Architecture: 8/10. Overall engineering maturity: 7/10.** Scores describe
the audited working source. This is the broadest and least release-proven product.

## Architecture

Ajnas consumes shared DSP, theory and UI rather than copying Watar. The Rust
runtime owns audio/session orchestration and guarded dataset import. Imports use
a native picker, a 2 MiB bound and validation before replacement. The camera
pipeline runs MediaPipe in a worker and separates capture, hand selection,
smoothing, calibration, geometry and fusion. Audio remains the measured truth;
vision supplies consistency evidence. CSP and minimal window capabilities reduce
the webview's surface. Microphone/camera and maqam analysis are opt-in.

Evidence: [runtime and import](../src-tauri/src/lib.rs),
[live processing](../src-tauri/src/live.rs), [teaching](../src-tauri/src/teach.rs),
[vision modules](../src/vision), [worker](../public/vision/hand-worker.js),
[asset preparation](../scripts/prepare-vision.mjs), [CSP](../src-tauri/tauri.conf.json).

## Findings and changes

| Priority | Finding | Result |
| --- | --- | --- |
| Medium | README and frontend CI referenced naghma v0.4.0 while Cargo used v0.5.0. | Aligned instructions and CI to v0.5.0. |
| Privacy | Public progress notes exposed internal account/billing information. | Removed it from current docs. Older history still retains previous text. |
| High | Fresh builds failed to resolve React from the sibling shared-UI source. | Added a locked shared-UI dependency install to instructions and CI; verified in isolation. |
| Medium | Cross-repo authentication was built around a private dependency token. | Replaced with public Git fetches and read-only workflow permissions. |
| Medium | Generated vendor assets lacked an adjacent notice bundle. | Preparation now copies Apache license text and third-party notices beside the assets and verifies their hashes too. |
| Medium | README was dense and attribution incomplete. | Added simple first-session steps, definitions, credits and an expanded practice guide. |
| Privacy | Personal Git email metadata and historical internal notes remain in history. | Added a clean source exporter; downloaded assets and Git history are excluded. |

## Remaining release risks

- Confirm the exact separately downloaded Hand Landmarker model's redistribution
  terms before publishing binaries containing it. The npm runtime declares
  Apache-2.0; that declaration alone does not establish model terms. Source
  exports omit the model and vendor runtime; development preparation downloads
  the pinned model and verifies its hash.
- Linux inherits GLib 0.18.5 through Tauri/GTK, flagged by
  [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html),
  plus an unmaintained `proc-macro-error` warning. Resolve or review/backport the
  GLib fix and validate that platform before a Linux release. The audit did not
  establish affected-method reachability in Ajnas; warnings are not suppressed.
- Release new shared-library tags and update the app before claiming that the
  current library safety fixes are included in the product.
- The 771-line App.tsx coordinates many independent concerns. Split session,
  settings, dataset and teaching orchestration into focused hooks as the product
  grows; keep the tested camera modules separate.
- Validate WKWebView/WebView2 inference, physical permission flows, device loss,
  audio/camera clock alignment, calibration accuracy, occlusion and sustained
  performance. Existing synthetic/video measurements do not prove string contact.
- Maqam ranking is heuristic. Review source illustrations with musicians and
  evaluate wider independent recordings, especially Sikah and modulation.
- Complete accessibility checks, signing, notarization and distribution checks.

## Validation

On macOS, Rust 1.99.1 and Node 26.12.1: **11 Rust + 55 frontend tests**, TypeScript,
production Vite build, Rust formatting and Clippy with warnings denied pass.
Vision model/vendor/license/notice asset verification passes. RustSec reports no
vulnerability-class findings, with the two informational warnings above. npm
audit reports zero known vulnerabilities. Gitleaks 8.30.1 finds no credentials
in scanned history or exported source.

This pass did not rerun the recorded-video/corpus evaluation, launch a native
camera session, build/sign a release bundle or execute hosted CI. See
[release preparation](OPEN_SOURCE.md).
