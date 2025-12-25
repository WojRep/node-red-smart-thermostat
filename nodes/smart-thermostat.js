const AdaptiveController = require('../lib/adaptive-controller');
const MqttHaIntegration = require('../lib/mqtt-ha-integration');
const fs = require('fs');
const path = require('path');

module.exports = function(RED) {
    // Get user directory for persistent storage
    const userDir = RED.settings.userDir || process.env.HOME || process.env.USERPROFILE;
    const storageDir = path.join(userDir, '.smart-thermostat');

    // Ensure storage directory exists
    if (!fs.existsSync(storageDir)) {
        try {
            fs.mkdirSync(storageDir, { recursive: true });
        } catch (err) {
            RED.log.warn('smart-thermostat: Could not create storage directory: ' + err.message);
        }
    }

    /**
     * Get state file path for a node
     */
    function getStateFilePath(nodeId) {
        return path.join(storageDir, `state-${nodeId}.json`);
    }

    /**
     * Load state from file
     */
    function loadStateFromFile(nodeId) {
        const filePath = getStateFilePath(nodeId);
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (err) {
            RED.log.warn('smart-thermostat: Could not load state from file: ' + err.message);
        }
        return null;
    }

    /**
     * Save state to file (async to not block)
     */
    function saveStateToFile(nodeId, state) {
        const filePath = getStateFilePath(nodeId);
        try {
            const data = JSON.stringify(state, null, 2);
            fs.writeFileSync(filePath, data, 'utf8');
        } catch (err) {
            RED.log.warn('smart-thermostat: Could not save state to file: ' + err.message);
        }
    }

    /**
     * Delete state file
     */
    function deleteStateFile(nodeId) {
        const filePath = getStateFilePath(nodeId);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            RED.log.warn('smart-thermostat: Could not delete state file: ' + err.message);
        }
    }

    function SmartThermostatNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Parse configuration
        // Map legacy mode names to HA HVAC names
        const modeMap = { 'heating': 'heat', 'cooling': 'cool', 'auto': 'heat_cool' };
        const configMode = config.mode || 'heat';
        const normalizedMode = modeMap[configMode] || configMode;

        const controllerConfig = {
            minTemp: parseFloat(config.minTemp) || 15,
            maxTemp: parseFloat(config.maxTemp) || 25,
            targetTemp: parseFloat(config.targetTemp) || 21,
            hysteresis: parseFloat(config.hysteresis) || 0.2,
            sampleInterval: (parseFloat(config.sampleInterval) || 60) * 1000,
            learningEnabled: config.learningEnabled !== false,
            maxOutputChange: parseFloat(config.maxOutputChange) || 0.5,
            precision: parseFloat(config.precision) || 0.5,
            mode: normalizedMode,
            operatingMode: config.operatingMode || 'manual',
            awayTemp: parseFloat(config.awayTemp) || 16
        };

        // Output format for active regulation indicator
        const activeOutputFormat = config.activeOutputFormat || 'boolean';

        // Create controller
        const controller = new AdaptiveController(controllerConfig);

        // MQTT Home Assistant Integration (optional)
        const mqttEnabled = config.mqttEnabled === true;
        let mqttIntegration = null;
        let mqttBrokerNode = null;
        let mqttClient = null;

        if (mqttEnabled && config.mqttBroker) {
            node.log('MQTT Discovery enabled, broker ID: ' + config.mqttBroker);
            mqttBrokerNode = RED.nodes.getNode(config.mqttBroker);

            if (mqttBrokerNode) {
                node.log('MQTT broker node found: ' + (mqttBrokerNode.name || mqttBrokerNode.id));

                mqttIntegration = new MqttHaIntegration({
                    nodeId: node.id,
                    baseTopic: config.mqttBaseTopic || 'homeassistant',
                    deviceName: config.haDeviceName || config.name || 'Smart Thermostat',
                    minTemp: controllerConfig.minTemp,
                    maxTemp: controllerConfig.maxTemp,
                    precision: controllerConfig.precision,
                    modes: [controllerConfig.mode]
                });

                // Function to setup MQTT when client is available
                const setupMqtt = (client) => {
                    if (!client) {
                        node.warn('MQTT client is null');
                        return;
                    }

                    mqttClient = client;

                    const doSetup = () => {
                        // Publish discovery
                        const discoveryTopic = mqttIntegration.getDiscoveryTopic();
                        node.log('Publishing MQTT discovery to: ' + discoveryTopic);
                        mqttIntegration.publishDiscovery(client);
                        node.log('MQTT HA Discovery published');

                        // Subscribe to commands
                        mqttIntegration.subscribeCommands(client, (command) => {
                            // Handle commands from Home Assistant
                            if (command.operatingMode !== undefined) {
                                controller.setOperatingMode(command.operatingMode);
                            }
                            if (command.mode !== undefined) {
                                controller.setMode(command.mode);
                            }
                            if (command.setpoint !== undefined) {
                                controller.setSetpoint(command.setpoint);
                            }
                            if (command.away !== undefined) {
                                controller.setAwayMode(command.away);
                            }
                            if (command.boost !== undefined) {
                                if (command.boost === false) {
                                    controller.setBoost(false);
                                } else if (command.boost && command.boost.relative) {
                                    // Relative boost: add X degrees to current target
                                    const boostTemp = controller.targetTemp + command.boost.relative;
                                    controller.setBoost({ temp: boostTemp, duration: command.boost.duration });
                                } else {
                                    controller.setBoost(command.boost);
                                }
                            }
                            node.log('MQTT command received from HA');
                        });
                    };

                    if (client.connected) {
                        doSetup();
                    } else {
                        node.log('MQTT client not connected yet, waiting...');
                        client.once('connect', doSetup);
                    }
                };

                // Try different ways to get MQTT client (different Node-RED MQTT implementations)
                if (mqttBrokerNode.client) {
                    // Standard node-red built-in mqtt
                    node.log('Using mqttBrokerNode.client');
                    setupMqtt(mqttBrokerNode.client);
                } else if (mqttBrokerNode.brokerConn && mqttBrokerNode.brokerConn.client) {
                    // Some implementations use brokerConn
                    node.log('Using mqttBrokerNode.brokerConn.client');
                    setupMqtt(mqttBrokerNode.brokerConn.client);
                } else {
                    // Client might not be available yet, register for when it connects
                    node.log('MQTT client not immediately available, registering for connection event');

                    // Try to register for broker connection
                    if (typeof mqttBrokerNode.register === 'function') {
                        mqttBrokerNode.register(node);
                        node.log('Registered with MQTT broker');
                    }

                    // Check periodically if client becomes available
                    let checkCount = 0;
                    const checkInterval = setInterval(() => {
                        checkCount++;
                        if (mqttBrokerNode.client) {
                            clearInterval(checkInterval);
                            node.log('MQTT client now available after ' + checkCount + ' checks');
                            setupMqtt(mqttBrokerNode.client);
                        } else if (checkCount > 30) {
                            clearInterval(checkInterval);
                            node.warn('MQTT client not available after 30 seconds');
                        }
                    }, 1000);
                }
            } else {
                node.warn('MQTT broker node not found for ID: ' + config.mqttBroker);
            }
        } else if (mqttEnabled && !config.mqttBroker) {
            node.warn('MQTT Discovery enabled but no broker selected');
        }

        // Try to restore state: first from file, then from context (migration)
        let savedState = loadStateFromFile(node.id);
        if (!savedState) {
            // Try context for backward compatibility
            savedState = node.context().get('controllerState');
            if (savedState) {
                // Migrate to file storage
                saveStateToFile(node.id, savedState);
                node.context().set('controllerState', null);
                node.log('Migrated controller state from context to file');
            }
        }

        if (savedState) {
            controller.setState(savedState);
            node.log('Restored controller state (Kp=' + savedState.Kp + ', Ki=' + savedState.Ki + ', Kd=' + savedState.Kd + ')');
        }

        // Update node status
        function updateStatus(result) {
            const state = result.debug.state;
            const error = result.debug.error;
            const trend = result.debug.trend;
            const operatingMode = result.debug.operatingMode;
            const boostActive = result.debug.boostActive;
            const awayMode = result.debug.awayMode;

            let fill = 'grey';
            let shape = 'ring';
            let text = '';

            const activeMode = result.debug.activeMode || 'heat';
            const modeIcon = activeMode === 'cool' ? '❄' : '🔥';

            // Status prefix for special modes
            let prefix = '';
            if (boostActive) {
                prefix = `🚀 BOOST (${result.debug.boostRemaining}m) `;
                fill = 'yellow';
                shape = 'dot';
            } else if (awayMode) {
                prefix = '🏠 AWAY ';
            } else if (operatingMode === 'schedule') {
                prefix = '📅 ';
            } else if (operatingMode === 'off') {
                fill = 'grey';
                shape = 'ring';
                node.status({ fill, shape, text: '⏹ OFF' });
                return;
            }

            if (state === 'learning') {
                fill = boostActive ? 'yellow' : 'yellow';
                shape = 'dot';
                text = `${prefix}Learning... (${result.debug.currentTemp}°C → ${result.output}°C)`;
            } else if (trend === 'idle') {
                fill = boostActive ? 'yellow' : 'grey';
                text = `${prefix}Idle at ${result.debug.currentTemp}°C`;
            } else if (trend === 'off') {
                fill = 'grey';
                text = '⏹ OFF';
            } else {
                if (Math.abs(error) < controllerConfig.hysteresis) {
                    fill = boostActive ? 'yellow' : 'green';
                    text = `${prefix}Stable at ${result.debug.currentTemp}°C (setpoint: ${result.output}°C)`;
                } else if (activeMode === 'heat') {
                    fill = boostActive ? 'yellow' : 'red';
                    text = `${prefix}${modeIcon} Heat: ${result.debug.currentTemp}°C → ${result.output}°C`;
                } else {
                    fill = boostActive ? 'yellow' : 'blue';
                    text = `${prefix}${modeIcon} Cool: ${result.debug.currentTemp}°C → ${result.output}°C`;
                }
            }

            node.status({ fill, shape, text });
        }

        // Handle input messages
        node.on('input', function(msg, send, done) {
            // Use send function or fallback for older Node-RED
            send = send || function() { node.send.apply(node, arguments); };

            let stateChanged = false;

            // Handle schedule change
            if (msg.schedule !== undefined) {
                controller.setSchedule(msg.schedule);
                stateChanged = true;
                node.log('Schedule updated');
            }

            // Handle boost mode
            if (msg.boost !== undefined) {
                controller.setBoost(msg.boost);
                if (msg.boost === false) {
                    node.log('Boost mode disabled');
                } else if (msg.boost && msg.boost.temp && msg.boost.duration) {
                    node.log(`Boost mode: ${msg.boost.temp}°C for ${msg.boost.duration} minutes`);
                }
            }

            // Handle away mode
            if (msg.away !== undefined) {
                controller.setAwayMode(msg.away);
                if (msg.away === false) {
                    node.log('Away mode disabled');
                } else {
                    node.log(`Away mode enabled (${typeof msg.away === 'number' ? msg.away + '°C' : 'default temp'})`);
                }
            }

            // Handle operating mode change
            if (msg.operatingMode !== undefined) {
                const newOpMode = String(msg.operatingMode).toLowerCase();
                if (['manual', 'schedule', 'off'].includes(newOpMode)) {
                    controller.setOperatingMode(newOpMode);
                    stateChanged = true;
                    node.log(`Operating mode changed to ${newOpMode}`);
                }
            }

            // Handle setpoint change
            if (msg.setpoint !== undefined) {
                const newSetpoint = parseFloat(msg.setpoint);
                if (!isNaN(newSetpoint)) {
                    controller.setSetpoint(newSetpoint);
                    node.log(`Setpoint changed to ${newSetpoint}°C`);
                }
            }

            // Handle mode change (accepts both HA HVAC and legacy names)
            if (msg.mode !== undefined) {
                const newMode = String(msg.mode).toLowerCase();
                const legacyMap = { 'heating': 'heat', 'cooling': 'cool', 'auto': 'heat_cool' };
                const normalizedNewMode = legacyMap[newMode] || newMode;
                if (['heat', 'cool', 'heat_cool'].includes(normalizedNewMode)) {
                    controller.setMode(normalizedNewMode);
                    node.log(`Mode changed to ${normalizedNewMode}`);
                }
            }

            // Save state if schedule or operating mode changed
            if (stateChanged) {
                saveStateToFile(node.id, controller.getState());
            }

            // Get temperature from payload
            const currentTemp = parseFloat(msg.payload);

            if (isNaN(currentTemp)) {
                node.warn('Invalid temperature value received: ' + msg.payload);
                if (done) done();
                return;
            }

            // Process temperature through controller
            const result = controller.update(currentTemp);

            // Save state only when PID parameters changed (after learning or adaptation)
            if (controller.hasParametersChanged()) {
                saveStateToFile(node.id, controller.getState());
                node.log('PID parameters updated and saved (Kp=' + result.debug.pid.Kp + ', Ki=' + result.debug.pid.Ki + ', Kd=' + result.debug.pid.Kd + ')');
            }

            // Update node status
            updateStatus(result);

            // Publish state to MQTT if enabled
            if (mqttIntegration && mqttClient && mqttClient.connected) {
                mqttIntegration.publishState(mqttClient, result);
            }

            // Determine if actively regulating (not idle, not stable)
            const isActive = result.debug.trend !== 'idle' &&
                             result.debug.trend !== 'stable' &&
                             Math.abs(result.debug.error) >= controllerConfig.hysteresis;

            // Send output messages
            const msg1 = {
                payload: result.output,
                topic: msg.topic || 'thermostat/setpoint'
            };

            const msg2 = {
                payload: result.debug,
                topic: msg.topic ? msg.topic + '/debug' : 'thermostat/debug'
            };

            const msg3 = {
                payload: activeOutputFormat === 'number' ? (isActive ? 1 : 0) : isActive,
                topic: msg.topic ? msg.topic + '/active' : 'thermostat/active'
            };

            send([msg1, msg2, msg3]);

            if (done) done();
        });

        // Handle node close
        node.on('close', function(removed, done) {
            // Save state before closing
            saveStateToFile(node.id, controller.getState());
            node.log('Controller state saved to file');

            // Unpublish MQTT availability (mark as offline)
            if (mqttIntegration && mqttClient && mqttClient.connected) {
                mqttIntegration.unpublish(mqttClient, removed);
                node.log('MQTT availability set to offline');
            }

            // If node is being removed (not just restarted), optionally keep the file
            // for now we keep it - user can reset manually

            if (done) done();
        });

        // Set initial status
        node.status({ fill: 'grey', shape: 'ring', text: 'Waiting for input...' });
    }

    RED.nodes.registerType('smart-thermostat', SmartThermostatNode);

    // HTTP endpoint for resetting controller
    RED.httpAdmin.post('/smart-thermostat/:id/reset', RED.auth.needsPermission('smart-thermostat.write'), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node) {
            // Delete state file
            deleteStateFile(req.params.id);
            // Node will need to be restarted to apply reset
            res.sendStatus(200);
        } else {
            // Try to delete file even if node not found
            deleteStateFile(req.params.id);
            res.sendStatus(200);
        }
    });
};
