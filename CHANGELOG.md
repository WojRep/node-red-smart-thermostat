# Changelog

All notable changes to this project will be documented in this file.

## v2.0.18

- **Fixed Operating Mode Priority** - `operatingMode` now correctly controls temperature source
  - **Manual mode**: External setpoint (from Home Assistant via `msg.setpoint`) takes full priority, built-in schedule is ignored
  - **Schedule mode**: Built-in schedule controls temperature, but external setpoint creates a temporary override
  - Previously, schedule always overrode setpoint regardless of operating mode, causing heating not to activate when expected
- **Temporary Schedule Override** - In schedule mode, setting temperature via `msg.setpoint` creates a temporary override
  - Override remains active until the next schedule slot change
  - Automatically reverts to schedule when a new time slot begins
  - Visual indicator in node status: `📅🔧` shows when override is active
- **New debug output field** - Added `scheduleOverrideActive` to debug output (output 2)
- **State persistence** - Schedule override state is now saved and restored across Node-RED restarts

## v2.0.16-2.0.17

- **Fixed Schedule Synchronization on Startup** - Schedule now applies immediately when Node-RED starts or node is deployed
  - Previously, schedule temperature was only applied when a new temperature reading arrived
  - Now correctly synchronizes with current schedule slot on startup
- **Fixed Schedule Independence from Operating Mode** - Local schedule now works regardless of `operatingMode` setting
  - `operatingMode` (manual/schedule/off) controls external integration behavior
  - Local schedule (enabled via "Enable default schedule" checkbox) now works independently
  - Schedule applies when enabled, even in `manual` mode
- **Added `syncSchedule()` method** - Synchronizes target temperature with current schedule slot without requiring temperature input
- **Added `getStatus()` method** - Returns current controller status for UI updates when config changes

## v2.0.13-2.0.15

- **New Schedule Configuration Tab** - Graphical weekly schedule editor directly in Node-RED UI
  - Configure default heating/cooling schedule without external automation
  - Intuitive day-by-day time slot editor with add/remove buttons
  - Copy buttons: "Copy Mon → Tue-Fri" and "Copy Sat → Sun" for quick setup
  - Timezone support: Local time, UTC, or IANA timezone names (e.g., `Europe/Warsaw`)
  - Temperature carries over midnight from previous day's last slot
  - Can be overridden by `msg.schedule` from Home Assistant or MQTT
- **Reorganized Configuration Interface** - Settings now organized in tabs
  - Settings tab: Temperature, PID, and general configuration
  - Schedule tab: Default weekly schedule editor
  - MQTT tab: Home Assistant MQTT Discovery settings
- **Fixed multi-node instance isolation** - Schedule configuration no longer shared between multiple node instances
- **Release script enhancement** - Automatic Node-RED Flow Library refresh after npm publish

## v2.0.9-2.0.12

- **Enhanced node status display** - Status now shows all temperature values with icons
  - Format: `🌡️21°C → 🎯22°C → 🔥28°C` (current → target → setpoint)
  - 🌡️ = current temperature, 🎯 = target temperature, 🔥 = heating setpoint, ❄️ = cooling setpoint
  - Stable state: `✅ 🌡️22°C (🎯22°C)` - shows current and target when stable
- **Proactive heating/cooling activation** - Output 3 (isActive) now activates earlier for better energy efficiency
  - When PID requests heating AND temperature is falling AND below target, boiler/heat pump starts proactively
  - Prevents "empty heating" cycles where radiator valves open but heat source is off
  - Especially beneficial for heat pumps: maintains higher COP, smoother inverter operation, avoids backup heater activation
  - Same proactive logic applied to cooling mode
- **Fixed critical integral windup bug** - Integral term now properly decreases when temperature overshoots target
  - Now uses signed error instead of absolute error
  - Setpoint no longer climbs indefinitely; stabilizes at correct offset for heat loss compensation
- **Improved PID steady-state control** - Removed premature "stable" bypass that caused oscillations
  - PID runs continuously, allowing integral term to accumulate offset
  - Increased default Ki from 0.01 to 0.02 for better steady-state performance

## v2.0.8

- **Fixed Active Output (Output 3)** - Improved logic for heating/cooling activation signal
- Now correctly indicates when boiler/AC should be active
- Implemented hysteresis with "latch" memory - prevents rapid on/off cycling
- Active output now properly tracks target achievement state

## v2.0.7

- Fixed npm package metadata (repository URL)
- Fixed package name in installation instructions

## v2.0.6

- **Repository Migration** - Moved to new repository: node-red-smart-thermostat
- Updated all repository URLs and references

## v2.0.0

- **Weekly Schedule** - Flexible time slots for each day of the week
- **Boost Mode** - Temporary temperature override with countdown timer
- **Away Mode** - Temperature limiting when not at home
- **MQTT Discovery** - Automatic climate entity creation in Home Assistant
- **Operating Modes** - Switch between manual, schedule, and off
- **Enhanced Status** - Node status shows boost timer, away mode, schedule info
- **Preset Modes** - Home Assistant presets: away, boost
- New input properties: `msg.schedule`, `msg.boost`, `msg.away`, `msg.operatingMode`
- Extended debug output with schedule/boost/away information

## v1.4.1

- Added Home Assistant integration documentation (JSONata examples)
- Added Zigbee2MQTT / MQTT publishing examples
- Documentation improvements

## v1.4.0

- **Breaking**: Changed mode names to Home Assistant HVAC format (`heat`, `cool`, `heat_cool`)
- Added thermostat precision setting (1°C, 0.5°C, 0.2°C, 0.1°C)
- Renamed `output` to `setpoint` in debug output for clarity
- Setpoint now guarantees minimum step above/below target when actively regulating
- Setpoint equals target when stable (within hysteresis)
- Legacy mode names (`heating`, `cooling`, `auto`) still accepted for backward compatibility

## v1.3.0

- Added file-based persistent storage for learned parameters
- State survives Node-RED restarts
- Automatic migration from context storage
- Smart save: only when PID parameters actually change

## v1.2.0

- Added cooling mode support
- Added auto mode (automatic heating/cooling switching)
- Added third output for active regulation status
- Added output format selection (boolean/number)
- Updated documentation

## v1.1.0

- Added cooling mode
- Added mode selection in UI

## v1.0.0

- Initial release with heating support
