# Peak-shaving correction and acceptance

## Why the disabled test failed

The 31 October disabled populated-schedule test requested a state the owner app never saves. In `main.dart_43.baa9a2b9.js`, the peak-shaving screen's `ir()` save branch constructs `tP(stationId, 0, 0, [])` whenever control mode is zero. Disabling clears both the windows and peak-shaving reserve. The enabled branch serializes the entered windows and reserve. The observed POST path and DTO field names already match our client.

The earlier command remains `outcome_unknown`, and its independent readback stayed empty. This proves the requested populated schedule was not verified; it does not reveal the provider's internal rejection reason. The app branch establishes that a disabled populated-schedule test is not a valid acceptance condition. The baseline was restored and remains mode 0, reserve 0, no windows.

## Enforced contract

- `enabled:false` requires `slots:[]` and `reserveSocPercent:0`. It explicitly clears the schedule; it does not preserve a disabled draft. Invalid combinations fail during preparation before any provider mutation.
- An enabled schedule requires at least one window. New windows have unique weekday codes 1–7, ordered local times, no overlaps and at most twelve entries. Previously reviewed opaque/overnight windows retain the existing preservation-only rule.
- Enabled reserve must be at least both the current discharge cutoff and backup SOC, and at most the current charge cutoff. Unknown required bounds refuse the write. These limits are read during preparation and again immediately before execution. Disabling does not depend on the SOC endpoint being available.
- The persisted command schema remains unchanged, so historical reviews and uncertain receipts are still readable. The stricter rules apply to new preparations and unattempted execution; already attempted commands remain read-only reconciliation.

A shared SOC reader uses only `/device/energy-profile/battery/level/{station}` for the enabled reserve check. It also supplies the existing complete battery-settings read, preserving nullable values, percentage validation and output field order. Peak-shaving validation does not fetch unrelated power/export settings.

## Primary app evidence

The previously captured owner-app bundle contains the relevant code:

| Source | Evidence |
| --- | --- |
| `main.dart_43.baa9a2b9.js`, `ir()` | Disabled save writes control mode 0, reserve 0 and an empty task list. Enabled save uses the form values. |
| Same file, `aId()` | Reserve cannot exceed charge SOC or be below backup/discharge SOC. |
| Same file, `bIc()` | Refuses adding a thirteenth window. |
| `main.dart.d390de04.js`, `tP.E()` / `pU.E()` | `stationId`, `controlMode`, `shavingSOC`, `settingList`; each task contains `whichDay`, `startTime`, `endTime`, `peakPower`. |
| Same file, `ldT()` | Maps the reserve-bound fields to charge, discharge and backup SOC. |

SHA-256: `main.dart_43.baa9a2b9.js` = `4817629feaf5c23f09e9c1ed0cb87ab0742accbed138aa043d2f300ce54cfce5`; `main.dart.d390de04.js` = `12af3891429bf8448dc15c5cae36740131005e00160e05c442f5e28d11c83e10`.

## Live test prepared for separate approval

The prior approval covered disabled schedules only. A populated save now requires a brief enabled test. The concrete proposed change is one weekly Monday **01:00–01:15** window, **2500 W**, **20% peak-shaving reserve**, using the station's returned `Europe/London` timezone. Fresh battery limits observed on 31 October were discharge 20%, backup 20%, charge 100%.

Before execution, confirm that the test is outside that window and all baseline values still match. Save and independently verify the enabled schedule, then immediately disable it with reserve 0 and no windows. Compare the complete final mode/profile, battery, schedules, saving settings and grant inventory against the protected baseline. Do not wait for the scheduled window or claim proof of physical peak-shaving performance. Keep peak-shaving dispatch disabled until this bounded test is authorized; keep it enabled afterward only if the populated save and restoration are verified.

The test remains pending. The original failed receipt must not be replayed; use a fresh command and immutable once approval for each bounded change.
