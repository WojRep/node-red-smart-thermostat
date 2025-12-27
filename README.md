# @wrepinski/node-red-smart-thermostat

A Node-RED node for intelligent temperature control of Zigbee 3.0 radiator valve thermostats and AC units. Uses an adaptive PID algorithm to provide smooth, battery-friendly temperature regulation instead of simple ON/OFF control.

**[Dokumentacja po polsku / Polish documentation](README_POLISH.md)**

## Features

- **Home Assistant HVAC Compatible** - Uses `heat`, `cool`, `heat_cool` modes
- **Weekly Schedule** - Flexible time slots for each day of the week
- **Boost Mode** - Temporary temperature override for N minutes
- **Away Mode** - Temperature limiting when not at home
- **MQTT Discovery** - Automatic climate entity creation in Home Assistant
- **Thermostat Precision** - Configurable step size (1°C, 0.5°C, 0.2°C, 0.1°C)
- **Adaptive PID Control** - Automatically learns optimal control parameters
- **Battery-Friendly** - Smooth output changes minimize valve motor activations
- **Rate Limiting** - Prevents rapid temperature setpoint changes that drain batteries
- **Hysteresis Control** - Dead-band prevents oscillation near the target temperature
- **Active Regulation Output** - Third output indicates when actively regulating
- **Persistent State** - Learned parameters and schedule saved to file

## Installation

### Via Node-RED Palette Manager

1. Open Node-RED
2. Go to **Menu -> Manage palette -> Install**
3. Search for `@wrepinski/node-red-smart-thermostat`
4. Click Install

### Via npm

```bash
cd ~/.node-red
npm install @wrepinski/node-red-smart-thermostat
```

### Manual/Offline Installation

```bash
cd ~/.node-red
npm install /path/to/wrepinski-node-red-smart-thermostat-2.0.6.tgz
```

## Usage

### Basic Setup

1. Drag the **smart thermostat** node from the palette to your flow
2. Select the operating mode (heat/cool/heat_cool)
3. Set the thermostat precision (matches your device's step size)
4. Connect your temperature sensor output to the node input
5. Connect output 1 to your Zigbee thermostat's set-temperature input
6. Configure the node with your desired min/max/target temperatures

### Example Flow

```
                                    ┌─→ [Zigbee Thermostat]
[Temperature Sensor] → [Smart Thermostat] ─→ [Debug Node]
                                    └─→ [Active Indicator]
```

### Input Messages

| Property | Type | Description |
|----------|------|-------------|
| `payload` | number | Current temperature reading (required) |
| `setpoint` | number | Override target temperature (optional) |
| `mode` | string | HVAC mode: `heat`, `cool`, or `heat_cool` (optional) |
| `operatingMode` | string | Operating mode: `manual`, `schedule`, or `off` (optional) |
| `schedule` | object | Weekly schedule (see Schedule section) |
| `boost` | object/boolean | Boost mode: `{temp: 24, duration: 60}` or `false` |
| `away` | boolean/number | Away mode: `true`, `false`, or specific temperature |

### Output Messages

**Output 1 - Temperature Setpoint:**
```javascript
{
    payload: 21.5,  // Setpoint to send to thermostat (rounded to precision)
    topic: "thermostat/setpoint"
}
```

**Output 2 - Debug/Status:**
```javascript
{
    payload: {
        currentTemp: 20.8,
        targetTemp: 21.0,
        setpoint: 21.5,        // calculated setpoint
        error: 0.2,
        trend: "heating",      // "heating", "cooling", "stable", or "idle"
        mode: "heat_cool",     // configured mode
        activeMode: "heat",    // current active mode (for heat_cool)
        precision: 0.5,        // thermostat step size
        state: "running",      // "learning" or "running"
        learningComplete: true,
        pid: {
            Kp: 1.2,
            Ki: 0.015,
            Kd: 0.8
        },
        pidTerms: {
            P: 0.24,
            I: 0.08,
            D: -0.02
        }
    }
}
```

**Output 3 - Active Regulation:**
```javascript
{
    payload: true,  // or false, or 1/0 depending on config
    topic: "thermostat/active"
}
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| **Mode** | heat | Operating mode: `heat`, `cool`, or `heat_cool` (HA HVAC compatible) |
| **Precision** | 0.5°C | Thermostat step size: 1, 0.5, 0.2, or 0.1°C |
| **Target Temp** | 21°C | Default target temperature |
| **Min Temp** | 15°C | Minimum allowed setpoint |
| **Max Temp** | 25°C | Maximum allowed setpoint |
| **Hysteresis** | 0.2°C | Dead-band to prevent oscillation |
| **Max Change** | 0.5°C/cycle | Maximum temperature change per update |
| **Sample Interval** | 60s | Expected time between temperature readings |
| **Auto-tuning** | Enabled | Enable adaptive learning of PID parameters |
| **Active Output** | Boolean | Format for output 3: Boolean (true/false) or Number (1/0) |

## Operating Modes (Home Assistant HVAC Compatible)

### heat
For radiator valves and heating systems. When the room is cold (below target), the setpoint is set **above target** by at least one precision step to trigger heating.

### cool
For AC units and cooling systems. When the room is hot (above target), the setpoint is set **below target** by at least one precision step to trigger cooling.

### heat_cool
Automatically switches between heat and cool based on the current temperature error. Useful for heat pump systems or buildings with both heating and cooling.

## How It Works

### Setpoint Calculation with Precision

The controller respects your thermostat's precision setting:

- **When actively heating**: setpoint = target + (at least one precision step)
- **When actively cooling**: setpoint = target - (at least one precision step)
- **When stable**: setpoint = target (rounded to precision)

Example with precision = 0.5°C:
```
Target: 21.0°C
Room temp: 20.5°C (need heating)
Setpoint: 21.5°C (target + 0.5°C minimum)

Room temp: 20.9°C (within hysteresis)
Setpoint: 21.0°C (stable, matches target)
```

### Adaptive Algorithm

The controller uses an adaptive PID (Proportional-Integral-Derivative) algorithm that:

1. **Learning Phase** (first ~1 hour):
   - Observes how the room temperature responds to setpoint changes
   - Estimates the thermal time constant of the room
   - Calculates optimal PID parameters using Cohen-Coon tuning

2. **Running Phase**:
   - Applies PID control with learned parameters
   - Continuously fine-tunes parameters based on performance
   - Detects and responds to temperature trends

### Battery Saving

Traditional ON/OFF thermostats cause frequent valve motor activations, which drains batteries quickly. This node:

- **Limits rate of change** - Maximum 0.5°C change per cycle
- **Uses hysteresis** - No adjustment when within dead-band
- **Smooth transitions** - Gradual setpoint changes instead of step changes

## Home Assistant Integration

### MQTT Climate Discovery (Recommended)

Enable automatic creation of a climate entity in Home Assistant:

1. **Enable MQTT Discovery** in node configuration
2. **Select your MQTT broker** (must be the same broker used by Home Assistant)
3. **Set device name** (will appear in Home Assistant)
4. **Deploy** - the climate entity will appear automatically in HA

**What you get in Home Assistant:**

- Native thermostat card support
- Temperature control slider
- Preset modes: `away`, `boost`
- Mode switching: `heat`, `cool`, `off`
- Current temperature display
- Action indicator (heating/cooling/idle)

**Requirements:**

- MQTT broker configured in Node-RED
- MQTT integration in Home Assistant (with discovery enabled)
- Same broker for both Node-RED and HA

**Example Lovelace card:**

```yaml
type: thermostat
entity: climate.smart_thermostat_xxxxx
```

### Using node-red-contrib-home-assistant-websocket

To send the calculated setpoint to a Home Assistant climate entity, use the **Call Service** (action) node from `node-red-contrib-home-assistant-websocket`.

**Configuration:**

1. Connect the first output of Smart Thermostat to the HA action node
2. Configure the action node:
   - **Action**: `climate.set_temperature`
   - **Target**: Select your climate device (e.g., `climate.living_room_thermostat`)
   - **Data** (set type to `J:` JSONata):
     ```
     {"temperature": $.payload}
     ```

**Example flow:**
```
[Temperature Sensor] → [Smart Thermostat] → [HA: climate.set_temperature]
```

**JSONata expressions for different scenarios:**

Basic temperature setting:
```jsonata
{"temperature": $.payload}
```

With explicit HVAC mode:
```jsonata
{"temperature": $.payload, "hvac_mode": "heat"}
```

For heat_cool mode with high/low targets (using second output debug data):
```jsonata
{
  "target_temp_high": $.payload.targetTemp + 1,
  "target_temp_low": $.payload.targetTemp - 1,
  "hvac_mode": "heat_cool"
}
```

**Available climate.set_temperature parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `temperature` | number | Target temperature (for heat or cool mode) |
| `target_temp_high` | number | Upper target (for heat_cool mode) |
| `target_temp_low` | number | Lower target (for heat_cool mode) |
| `hvac_mode` | string | `heat`, `cool`, `heat_cool`, `off`, `auto` |

### Direct MQTT Publishing (Zigbee2MQTT)

For direct control via MQTT (e.g., Zigbee2MQTT), use an **mqtt out** node.

**Configuration:**

1. Connect the first output of Smart Thermostat to an **mqtt out** node
2. Configure the mqtt out node:
   - **Topic**: `zigbee2mqtt/YOUR_DEVICE_NAME/set`
   - **QoS**: 1

3. Add a **change** node between them to format the payload:
   - Set `msg.payload` to JSONata expression:
     ```jsonata
     {"current_heating_setpoint": $.payload}
     ```

**Example flow:**
```
[Temperature Sensor] → [Smart Thermostat] → [Change Node] → [MQTT Out]
```

**Alternative: Using function node:**
```javascript
msg.payload = {
    current_heating_setpoint: msg.payload
};
return msg;
```

**Common Zigbee2MQTT thermostat properties:**
| Property | Description |
|----------|-------------|
| `current_heating_setpoint` | Target temperature for heating |
| `occupied_heating_setpoint` | Setpoint when occupied |
| `system_mode` | `off`, `heat`, `cool`, `auto` |
| `running_state` | Current running state |

> **Note:** Property names vary by device. Check your device's Zigbee2MQTT exposes page for exact property names.

### Creating Climate Entity via WebSocket (ha-entity)

If you prefer WebSocket integration over MQTT, you can create a virtual climate entity in Home Assistant using the **ha-entity** node from `node-red-contrib-home-assistant-websocket`. This method doesn't require MQTT broker configuration.

**Requirements:**

- `node-red-contrib-home-assistant-websocket` installed in Node-RED
- Home Assistant with Node-RED integration configured

**Setup:**

1. Connect the **second output** (debug) of Smart Thermostat to a **function** node
2. Connect the function node to an **ha-entity** node configured as climate

**Function node code:**

```javascript
// Map Smart Thermostat debug output to HA climate entity
const debug = msg.payload;

// Determine HVAC action
let action = 'idle';
if (debug.operatingMode === 'off') {
    action = 'off';
} else if (debug.trend === 'heating' || (debug.activeMode === 'heat' && Math.abs(debug.error) >= 0.2)) {
    action = 'heating';
} else if (debug.trend === 'cooling' || (debug.activeMode === 'cool' && Math.abs(debug.error) >= 0.2)) {
    action = 'cooling';
}

// Determine preset
let preset = 'none';
if (debug.boostActive) {
    preset = 'boost';
} else if (debug.awayMode) {
    preset = 'away';
}

msg.payload = {
    state: debug.operatingMode === 'off' ? 'off' : debug.mode,
    attributes: {
        current_temperature: debug.currentTemp,
        temperature: debug.targetTemp,
        hvac_action: action,
        hvac_modes: ['off', 'heat', 'cool', 'heat_cool'],
        min_temp: 15,
        max_temp: 25,
        target_temp_step: debug.precision || 0.5,
        preset_mode: preset,
        preset_modes: ['none', 'away', 'boost'],
        friendly_name: 'Smart Thermostat'
    }
};
return msg;
```

**ha-entity node configuration:**

| Setting | Value |
|---------|-------|
| Type | climate |
| State | `msg.payload.state` |
| State Type | `msg` |
| Attributes | `msg.payload.attributes` |
| Resend state | Enable |
| Override payload | Enable |

**Handling commands from Home Assistant:**

To receive commands from Home Assistant (temperature changes, mode switches), add an **events: state** node that listens to your climate entity:

```javascript
// In a function node after events:state node
const newState = msg.payload;
const data = msg.data;

// Check what changed
if (data.new_state.attributes.temperature !== data.old_state.attributes.temperature) {
    return { setpoint: data.new_state.attributes.temperature };
}

if (data.new_state.state !== data.old_state.state) {
    if (data.new_state.state === 'off') {
        return { operatingMode: 'off' };
    } else {
        return {
            operatingMode: 'manual',
            mode: data.new_state.state
        };
    }
}

if (data.new_state.attributes.preset_mode !== data.old_state.attributes.preset_mode) {
    const preset = data.new_state.attributes.preset_mode;
    if (preset === 'boost') {
        return { boost: { temp: 24, duration: 60 } };
    } else if (preset === 'away') {
        return { away: true };
    } else {
        return { boost: false, away: false };
    }
}

return null;
```

**Example flow diagram:**

```
                                                    ┌──→ [function] → [ha-entity: climate]
[Temperature Sensor] → [Smart Thermostat] ──────────┤
                              ↑                     └──→ [Zigbee Thermostat]
                              │
[events:state] → [function: parse HA commands] ─────┘
```

**Comparison: MQTT Discovery vs ha-entity**

| Feature | MQTT Discovery | ha-entity (WebSocket) |
|---------|---------------|----------------------|
| Setup complexity | Easier | More configuration |
| MQTT broker required | Yes | No |
| Real-time updates | Yes | Yes |
| Bidirectional control | Yes | Yes |
| Works offline | Partially | No |
| Entity persistence | Automatic | Requires HA restart |

## Schedule, Boost & Away Modes

### Weekly Schedule

Set a weekly schedule with flexible time slots per day:

```javascript
msg.schedule = {
    "monday": [
        {"time": "06:00", "temp": 21},
        {"time": "08:30", "temp": 19},
        {"time": "17:00", "temp": 21},
        {"time": "22:00", "temp": 18}
    ],
    "tuesday": [
        {"time": "06:00", "temp": 21},
        {"time": "22:00", "temp": 18}
    ],
    "wednesday": [
        {"time": "06:00", "temp": 21},
        {"time": "22:00", "temp": 18}
    ],
    // ... other days (sunday, monday, tuesday, wednesday, thursday, friday, saturday)
    "default": 18  // Fallback temperature when no slot matches
};
msg.operatingMode = "schedule";  // Activate schedule mode
```

Each day can have any number of time slots. The controller uses the most recent slot before the current time.

### Boost Mode

Temporarily override the temperature for a specified duration:

```javascript
// Activate boost: 24°C for 60 minutes
msg.boost = { temp: 24, duration: 60 };

// Deactivate boost
msg.boost = false;
```

Boost has the highest priority and overrides both schedule and away modes.

### Away Mode

Limit the maximum temperature when not at home:

```javascript
// Enable away mode (uses configured away temperature)
msg.away = true;

// Enable away with specific temperature
msg.away = 16;

// Disable away mode
msg.away = false;
```

### Temperature Priority

1. **Boost** - Highest priority, overrides everything
2. **Away** - Limits maximum temperature
3. **Schedule** - Uses scheduled temperature for current time
4. **Manual** - Uses configured target temperature

## Dynamic Control

You can change settings dynamically by sending messages:

```javascript
// Change target temperature
msg.setpoint = 22.5;
msg.payload = 20.1;  // Current temperature reading
return msg;

// Change HVAC mode
msg.mode = "cool";
msg.payload = 24.5;
return msg;

// Change operating mode
msg.operatingMode = "schedule";
return msg;
```

This is useful for:
- Time-based schedules
- Presence detection
- Season-based mode switching
- Energy saving modes

## Active Regulation Output

The third output indicates whether the thermostat is actively working to reach the target temperature:

- **true/1** - Actively heating or cooling toward target
- **false/0** - Idle (target reached, within hysteresis, or wrong mode for current conditions)

Use cases:
- Control circulation pumps
- Trigger notifications
- Energy monitoring
- Display active status on dashboards

## Persistent Storage

Learned PID parameters are automatically saved to files and restored after Node-RED restart.

**Storage location:** `~/.node-red/.smart-thermostat/state-<node-id>.json`

**What is saved:**

- PID parameters (Kp, Ki, Kd)
- Learning state and progress
- Temperature history for adaptation
- Current operating mode

**When is state saved:**

- When PID parameters change (after learning completes)
- When continuous adaptation adjusts parameters
- When node is closed/restarted

## Resetting Learned Parameters

If the controller behaves unexpectedly or if your heating/cooling system changes:

1. Open the node configuration in Node-RED editor
2. Click the **Reset Learned Parameters** button
3. Deploy the flow
4. The controller will restart the learning phase

This deletes the state file and resets all learned parameters.

## Troubleshooting

### Output oscillates rapidly
- Increase the **Hysteresis** value (try 0.3-0.5°C)
- Decrease **Max Change** to limit rate of change

### Response is too slow
- Disable **Auto-tuning** and manually set PID parameters
- Decrease **Hysteresis** value

### Temperature overshoots target
- Wait for learning phase to complete (at least 1 hour)
- If persists after learning, reset and try again with more stable input data

### Mode not changing
- Ensure you're sending `msg.mode` with the temperature reading
- Valid values: `heat`, `cool`, `heat_cool` (case insensitive)
- Legacy values also accepted: `heating`, `cooling`, `auto`

## Changelog

### v2.0.13

- **New Schedule Configuration Tab** - Graphical weekly schedule editor directly in Node-RED UI
  - Configure default heating/cooling schedule without external automation
  - Intuitive day-by-day time slot editor with add/remove buttons
  - Copy buttons: "Copy Mon → Tue-Fri" and "Copy Sat → Sun" for quick setup
  - Default temperature setting for times outside defined slots
  - Timezone support: Local time or UTC
  - Can be overridden by `msg.schedule` from Home Assistant or MQTT
- **Reorganized Configuration Interface** - Settings now organized in tabs
  - Settings tab: Temperature, PID, and general configuration
  - Schedule tab: Default weekly schedule editor
  - MQTT tab: Home Assistant MQTT Discovery settings

### v2.0.12

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

### v2.0.8

- **Fixed Active Output (Output 3)** - Improved logic for heating/cooling activation signal
- Now correctly indicates when boiler/AC should be active
- Implemented hysteresis with "latch" memory - prevents rapid on/off cycling
- Active output now properly tracks target achievement state

### v2.0.7

- Fixed npm package metadata (repository URL)
- Fixed package name in installation instructions

### v2.0.6

- **Repository Migration** - Moved to new repository: node-red-smart-thermostat
- Updated all repository URLs and references

### v2.0.0

- **Weekly Schedule** - Flexible time slots for each day of the week
- **Boost Mode** - Temporary temperature override with countdown timer
- **Away Mode** - Temperature limiting when not at home
- **MQTT Discovery** - Automatic climate entity creation in Home Assistant
- **Operating Modes** - Switch between manual, schedule, and off
- **Enhanced Status** - Node status shows boost timer, away mode, schedule info
- **Preset Modes** - Home Assistant presets: away, boost
- New input properties: `msg.schedule`, `msg.boost`, `msg.away`, `msg.operatingMode`
- Extended debug output with schedule/boost/away information

### v1.4.1

- Added Home Assistant integration documentation (JSONata examples)
- Added Zigbee2MQTT / MQTT publishing examples
- Documentation improvements

### v1.4.0

- **Breaking**: Changed mode names to Home Assistant HVAC format (`heat`, `cool`, `heat_cool`)
- Added thermostat precision setting (1°C, 0.5°C, 0.2°C, 0.1°C)
- Renamed `output` to `setpoint` in debug output for clarity
- Setpoint now guarantees minimum step above/below target when actively regulating
- Setpoint equals target when stable (within hysteresis)
- Legacy mode names (`heating`, `cooling`, `auto`) still accepted for backward compatibility

### v1.3.0

- Added file-based persistent storage for learned parameters
- State survives Node-RED restarts
- Automatic migration from context storage
- Smart save: only when PID parameters actually change

### v1.2.0

- Added cooling mode support
- Added auto mode (automatic heating/cooling switching)
- Added third output for active regulation status
- Added output format selection (boolean/number)
- Updated documentation

### v1.1.0

- Added cooling mode
- Added mode selection in UI

### v1.0.0

- Initial release with heating support

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/WojRep/node-red-smart-thermostat).
