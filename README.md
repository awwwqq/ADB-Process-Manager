# Phone Task Manager · 0.2.1 preview

A Windows desktop app for inspecting an Android phone through ADB, with a familiar Task Manager layout. It works locally and requires no root or phone companion app.

## Open the portable app

Open **Phone Task Manager.exe** in the `PhoneTaskManager-Windows` folder. Keep the whole folder together. When using the ZIP, extract it first. This is an unsigned development build.

Connect your Android phone with a USB data cable, enable **Developer options → USB debugging**, and accept the authorization prompt on the phone. The app automatically scans on launch. Use the device selector for multiple phones, or the scan button to retry. USB debugging grants this PC debugging access; turn it off on your phone when you no longer need it.

## Included

- Live process groups with CPU %, memory, subprocess counts, and foreground/background/cached state where reported.
- Sort columns, search names or package IDs, and filter apps/background/system processes.
- Resize columns by dragging the header dividers, including Status. Arrow keys also adjust focused dividers; double-click a divider to reset all widths. Sizes are saved locally and adapt when the window changes.
- A process table that fills the remaining window height, with separately laid-out metric graphs and captions.
- Total CPU and memory graphs, swap, free storage, uptime, battery and available CPU temperatures.
- Installed, disabled, and removed package inventory for Android user 0.
- Force stop for user apps, disable/re-enable controls, and retained-data user removal/restore for four reviewed Xiaomi extras.
- Native confirmation before every phone change, with specific feature consequences where known.
- Local action history and restore controls for successful disable/removal actions performed in this app.
- Persistent light/dark mode, available in the title bar and Settings.
- Boxed 0–100% charts with visible ceiling, floor, grid, and shaded usage area.
- Hardware & sensors view with chipset, CPU architecture, GPU, identified NPU/AI accelerator, current thermal/power channels, and sensor inventory.

Chipset identities are shown from device-reported IDs; the SM8635 name and accelerator mapping are verified against [Xiaomi's POCO F6 processor specifications](https://www.mi.com/uk/support/faq/details/KA-165333/) and [Qualcomm's SM8635 product brief](https://docs.qualcomm.com/doc/87-73942-1/87-73942-1_REV_B_Snapdragon_8s_Gen_3_Mobile_Platform_Product_Brief.pdf). Unknown hardware retains its raw identifier rather than being guessed. GPU model comes from the device when available. GPU utilization and clock are shown only if readable; blocked readings remain unavailable. NPU identification does not imply utilization is measurable. Device sensor names include physical, virtual, and wake-up variants; this app lists them without collecting live motion events. Thermal/power sensor units are retained by type, so voltage and charge channels are not mislabeled as temperatures.

The reviewed Xiaomi packages are `com.miui.msa.global`, `com.miui.analytics`, `com.mi.appfinder`, and `com.mi.globalminusscreen`. Manufacturer restrictions can block disabling. The app reports the failure and never silently switches to removal. Removal has its own button and confirmation. Previously removed system packages appear in Apps with restoration available when their system copies remain on the device.

## Measurements and limits

CPU is normalized to 0–100% across all CPU cores, based on the last sampled `top` interval. App CPU sums the package's processes. RAM is process RSS in MB, including shared pages; adding all rows can double count shared memory. The total memory card uses `MemAvailable`, so reclaimable cache is not treated as unavailable memory. Swap shows logical compressed swap usage, not additional physical RAM. Cached processes are normal and are not automatically stopped. Process states are snapshots and can change between commands. Thermal status uses the system's current status, and CPU temperatures use current HAL readings rather than cached readings.

The backend reads diagnostic commands, so polling itself introduces some load. A five-second default interval limits that overhead. Change it in Settings or pause updates. Some phones restrict metrics; unavailable sensors display a dash. Exact per-app network traffic, disk activity, energy consumption, and per-app GPU utilization are not provided. Global GPU utilization and clock are shown only when the firmware exposes readable measurements. Package display names use a built-in mapping; unknown apps retain their exact package identifier. This is not a malware scanner. Only Android user 0 is managed. No iPhone support.

Essential packages, the current home launcher, and current keyboard are protected. Other unreviewed system packages are inspection-only. Restoring a removed app requires its package to remain on the device; retaining app data is not a backup. Force stop can interrupt background work and notifications. Restore/re-enable controls apply to package state, not recovery of lost unsaved work.

No phone mutations are performed at startup. No telemetry is uploaded. Action history is stored locally in Electron's user-data folder (`%APPDATA%\phone-task-manager\changes.json`), and includes device identifiers and package names. The ADB server can remain running after the app closes.

## Develop

Install Node.js 22.12 or later. In this source directory:

```powershell
npm install
npx install-electron
powershell -NoProfile -File scripts/setup-adb.ps1
npm start
npm test
npm run test:ui
npm run build
```

The setup script downloads Android Platform Tools directly from Google into the ignored `platform-tools` directory. Source control excludes dependencies, downloaded binaries, local diagnostics, credentials, and build output. `npm run build` creates the sibling `PhoneTaskManager-Windows` portable folder. The portable build includes ADB and its Windows DLLs with their notice. Electron and Chromium notices ship with the portable runtime. Main-process commands use fixed argument arrays rather than a host shell. The renderer has no Node integration, uses context isolation and sandboxing, and cannot execute arbitrary ADB commands.

## Validation

Parser and action guard tests cover eight-core CPU normalization, Toybox CPU headers, available memory, process grouping/states, injection rejection, confirmation, and protected packages. The live UI was checked against a POCO F6 running Android 16 / HyperOS 3: connection, process search, graph navigation, removed-package discovery, settings, native-process filtering, and cancellation of an action without modifying the phone. Successful mutation flows are tested with simulated ADB responses; the UI validation itself makes no changes to the phone. Broader manufacturer testing is still needed.

`npm run test:ui` runs deterministic Electron layout checks with fixture data and disabled phone-action handlers. It verifies non-overlapping metric cards, process-panel height at four window sizes, column dragging, keyboard resizing, persistence after reload, and reset. The test does not need an attached phone. Screenshots and isolated test profiles are stored in the ignored `.cache` directory.

After building, `npm run test:ui -- --packaged` runs the same regression checks against the portable executable.

