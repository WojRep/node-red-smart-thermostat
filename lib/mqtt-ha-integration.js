/**
 * MQTT Home Assistant Integration
 *
 * Provides MQTT Discovery for Home Assistant climate entities.
 * Creates a climate device in HA with temperature control, presets (away, boost), and mode switching.
 */

class MqttHaIntegration {
    constructor(config) {
        this.nodeId = config.nodeId;
        this.baseTopic = config.baseTopic || 'homeassistant';
        this.deviceName = config.deviceName || 'Smart Thermostat';
        this.uniqueId = `smart_thermostat_${this.nodeId}`;

        // Topic prefix for state/command
        this.topicPrefix = `smart-thermostat/${this.nodeId}`;

        // Controller config for discovery payload
        this.minTemp = config.minTemp || 15;
        this.maxTemp = config.maxTemp || 25;
        this.precision = config.precision || 0.5;
        this.modes = config.modes || ['off', 'heat'];

        // MQTT client reference
        this.mqttClient = null;
        this.subscribed = false;

        // Callback for handling commands from HA
        this.onCommand = null;
    }

    /**
     * Get MQTT discovery topic for climate entity
     */
    getDiscoveryTopic() {
        return `${this.baseTopic}/climate/${this.uniqueId}/config`;
    }

    /**
     * Get MQTT discovery payload for Home Assistant
     */
    getDiscoveryPayload() {
        // Build modes array based on controller mode
        const modes = ['off'];
        if (this.modes.includes('heat') || this.modes.includes('heat_cool')) {
            modes.push('heat');
        }
        if (this.modes.includes('cool') || this.modes.includes('heat_cool')) {
            modes.push('cool');
        }
        if (this.modes.includes('heat_cool')) {
            modes.push('heat_cool');
        }

        return {
            name: this.deviceName,
            unique_id: this.uniqueId,

            // Modes
            modes: modes,
            mode_command_topic: `${this.topicPrefix}/mode/set`,
            mode_state_topic: `${this.topicPrefix}/mode/state`,

            // Temperature
            temperature_command_topic: `${this.topicPrefix}/temperature/set`,
            temperature_state_topic: `${this.topicPrefix}/temperature/state`,
            current_temperature_topic: `${this.topicPrefix}/current_temp`,

            // Action (what the thermostat is currently doing)
            action_topic: `${this.topicPrefix}/action`,

            // Presets (away, boost) - 'none' is implicit, must not be listed
            preset_modes: ['away', 'boost'],
            preset_mode_command_topic: `${this.topicPrefix}/preset/set`,
            preset_mode_state_topic: `${this.topicPrefix}/preset/state`,

            // Temperature limits
            min_temp: this.minTemp,
            max_temp: this.maxTemp,
            temp_step: this.precision,

            // Temperature unit
            temperature_unit: 'C',

            // Device info
            device: {
                identifiers: [this.uniqueId],
                name: this.deviceName,
                model: 'Adaptive PID Controller',
                manufacturer: 'node-red-contrib-smart-thermostat',
                sw_version: '2.0.0'
            },

            // Availability
            availability_topic: `${this.topicPrefix}/availability`,
            payload_available: 'online',
            payload_not_available: 'offline'
        };
    }

    /**
     * Get command topics to subscribe
     */
    getCommandTopics() {
        return [
            `${this.topicPrefix}/mode/set`,
            `${this.topicPrefix}/temperature/set`,
            `${this.topicPrefix}/preset/set`
        ];
    }

    /**
     * Publish discovery config to Home Assistant
     */
    publishDiscovery(mqttClient) {
        if (!mqttClient || !mqttClient.connected) {
            return false;
        }

        this.mqttClient = mqttClient;

        const discoveryTopic = this.getDiscoveryTopic();
        const discoveryPayload = JSON.stringify(this.getDiscoveryPayload());

        mqttClient.publish(discoveryTopic, discoveryPayload, { retain: true });

        // Publish availability
        mqttClient.publish(`${this.topicPrefix}/availability`, 'online', { retain: true });

        return true;
    }

    /**
     * Subscribe to command topics from Home Assistant
     */
    subscribeCommands(mqttClient, callback) {
        if (!mqttClient || this.subscribed) {
            return false;
        }

        this.mqttClient = mqttClient;
        this.onCommand = callback;

        const topics = this.getCommandTopics();
        topics.forEach(topic => {
            mqttClient.subscribe(topic);
        });

        // Handle incoming messages
        mqttClient.on('message', (topic, message) => {
            if (topics.includes(topic)) {
                this.handleCommand(topic, message.toString());
            }
        });

        this.subscribed = true;
        return true;
    }

    /**
     * Handle command from Home Assistant
     */
    handleCommand(topic, payload) {
        if (!this.onCommand) return;

        const command = {};

        if (topic.endsWith('/mode/set')) {
            // Mode command: off, heat, cool, heat_cool
            const mode = payload.toLowerCase();
            if (mode === 'off') {
                command.operatingMode = 'off';
            } else {
                command.operatingMode = 'manual';
                command.mode = mode;
            }
        } else if (topic.endsWith('/temperature/set')) {
            // Temperature setpoint command
            const temp = parseFloat(payload);
            if (!isNaN(temp)) {
                command.setpoint = temp;
            }
        } else if (topic.endsWith('/preset/set')) {
            // Preset command: none, away, boost
            const preset = payload.toLowerCase();
            if (preset === 'none') {
                command.away = false;
                command.boost = false;
            } else if (preset === 'away') {
                command.away = true;
                command.boost = false;
            } else if (preset === 'boost') {
                // Default boost: +3°C for 60 minutes
                command.boost = { temp: null, duration: 60, relative: 3 };
                command.away = false;
            }
        }

        if (Object.keys(command).length > 0) {
            this.onCommand(command);
        }
    }

    /**
     * Publish current state to Home Assistant
     */
    publishState(mqttClient, state) {
        if (!mqttClient || !mqttClient.connected) {
            return false;
        }

        const debug = state.debug || state;

        // Mode state
        let modeState = debug.mode || 'heat';
        if (debug.operatingMode === 'off') {
            modeState = 'off';
        }
        mqttClient.publish(`${this.topicPrefix}/mode/state`, modeState, { retain: true });

        // Temperature state (target)
        const targetTemp = debug.targetTemp || debug.setpoint;
        if (targetTemp !== undefined) {
            mqttClient.publish(`${this.topicPrefix}/temperature/state`, String(targetTemp), { retain: true });
        }

        // Current temperature
        if (debug.currentTemp !== undefined) {
            mqttClient.publish(`${this.topicPrefix}/current_temp`, String(debug.currentTemp), { retain: true });
        }

        // Action state (what it's doing now)
        let action = 'idle';
        if (debug.operatingMode === 'off') {
            action = 'off';
        } else if (debug.trend === 'heating' || (debug.activeMode === 'heat' && Math.abs(debug.error || 0) >= 0.2)) {
            action = 'heating';
        } else if (debug.trend === 'cooling' || (debug.activeMode === 'cool' && Math.abs(debug.error || 0) >= 0.2)) {
            action = 'cooling';
        }
        mqttClient.publish(`${this.topicPrefix}/action`, action, { retain: true });

        // Preset state
        let preset = 'none';
        if (debug.boostActive) {
            preset = 'boost';
        } else if (debug.awayMode) {
            preset = 'away';
        }
        mqttClient.publish(`${this.topicPrefix}/preset/state`, preset, { retain: true });

        return true;
    }

    /**
     * Publish offline status and remove discovery (on node close)
     */
    unpublish(mqttClient, removeDiscovery = false) {
        if (!mqttClient || !mqttClient.connected) {
            return false;
        }

        // Publish offline
        mqttClient.publish(`${this.topicPrefix}/availability`, 'offline', { retain: true });

        // Optionally remove discovery config
        if (removeDiscovery) {
            mqttClient.publish(this.getDiscoveryTopic(), '', { retain: true });
        }

        return true;
    }

    /**
     * Update configuration (e.g., when node config changes)
     */
    updateConfig(config) {
        if (config.deviceName) this.deviceName = config.deviceName;
        if (config.minTemp) this.minTemp = config.minTemp;
        if (config.maxTemp) this.maxTemp = config.maxTemp;
        if (config.precision) this.precision = config.precision;
        if (config.modes) this.modes = config.modes;
    }
}

module.exports = MqttHaIntegration;
