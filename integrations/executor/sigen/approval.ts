import { always, never } from "apps/operations/approval";

const reads = new Set([
  "get_backup_history",
  "get_energy_saving_settings",
  "list_aio_devices",
  "get_aio_power_status",
  "connection_status",
  "get_station",
  "get_energy_flow",
  "get_operating_mode",
  "get_battery_settings",
  "get_automation_settings",
  "get_grid_settings",
  "get_solar_settings",
  "list_operating_modes",
  "get_peak_shaving_schedule",
  "get_manual_override",
  "get_topology",
  "get_station_status",
  "get_gateway",
  "list_grid_devices",
  "get_device_info",
  "get_device_values",
  "list_alarms",
  "get_energy_history",
  "get_forecast",
  "get_station_income",
  "get_tariffs",
  "get_prediction_plan",
  "get_command",
  "list_approval_grants",
]);

/** Approvals are requested once here; the server enforces saved approvals and never replays dispatch. */
export const sigenApproval = (
  name: string,
  readOnlyHint: boolean | undefined
) => {
  if (name === "approve_command") {
    return always();
  }
  if (
    ["prepare_command", "execute_command", "revoke_approval_grant"].includes(
      name
    )
  ) {
    return never();
  }
  if (reads.has(name) && readOnlyHint === true) {
    return never();
  }
  return always();
};
