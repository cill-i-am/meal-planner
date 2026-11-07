# Active profile parameters and time-of-use activation

Both commands use `prepare_command`, `approve_command` with `once` or `always`, then `execute_command`. Approval is bound to the saved review. Execution rereads the settings, refuses a conflict and records the attempt before making one provider request. An ambiguous outcome is reconciled by readback. Production dispatch for these commands requires separate live acceptance.

## Active profile parameters

`set_active_energy_profile_parameters` accepts the same typed battery SOC, battery power, grid import/export and solar groups as [saved profile parameters](profile-parameters.md). Omitted groups and ancillary settings are carried forward from the current profile. The target is either `{kind:"built_in",providerMode:0|1|5}` or `{kind:"custom",profileId:…}`.

A built-in edit requires the matching operating mode, the default profile sentinel in the mode response and a null profile ID in the current settings. The provider receives a full settings PUT for that default profile. Built-in modes can share station settings. A custom edit requires mode 9, a listed profile ID and a matching active ID and marker in the current settings. The client checks the mode before and after reading settings. The full edited profile and its active identity must match on readback. This command has a separate approval scope for each built-in mode or custom profile ID.

## Time of use

`get_time_of_use_settings` reads the saved timetable, the station timezone and provider configuration. Limits retain provider values in kW and percent. mySigen displays null and omitted limits as equipment defaults. `activate_time_of_use_mode` requires the station to advertise mode 2 and have a nonempty, nonoverlapping manual timetable with known slot modes and valid limits. An empty timetable can be configured in mySigen. The write sends a mode switch with `profileId: -1` and `fromPlatform: 1`. The saved timetable is part of the immutable review and must still match after activation. A reusable activation grant applies only to this operation and station.

The adapter currently covers residential manual TOU activation. Timetable editing, tariff-generated TOU and Remote EMS are separate contracts.

## Protocol evidence

The pinned [EU mySigen app bundle](https://files-app-eu.sigencloud.com/flutter-app/releases/cdn-eu-b148-fee0b7a4adfa/main.dart.38d261ea.js) reads and saves the current profile at lines 83260–83326 and 209326–209338. The current-settings editor uses the full PUT serializer near lines 639955–639982. The mode UI calls `W9` with mode 2 and profile ID -1 near lines 819596 and 819903–819910. Its `bm3` helper sends `fromPlatform: 1` to the mode endpoint. The separate saved timetable and configuration reads appear near lines 91370–91390 and 91462–91495. Manual rows use `currType: 1`, with charge/discharge/self-consumption codes 0, 1 and 3. The adapter does not infer behavior from missing rules or unknown values.
