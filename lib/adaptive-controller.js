/**
 * Adaptive PID Controller for Smart Thermostat
 *
 * Implements an adaptive PID controller with self-tuning capabilities
 * for smooth temperature regulation in heating and cooling systems.
 */

class AdaptiveController {
    constructor(config = {}) {
        // Configuration
        this.minTemp = config.minTemp || 15;
        this.maxTemp = config.maxTemp || 25;
        this.targetTemp = config.targetTemp || 21;
        this.baseTargetTemp = config.targetTemp || 21; // Original target before boost/away
        this.hysteresis = config.hysteresis || 0.2;
        this.sampleInterval = config.sampleInterval || 60000; // ms
        this.learningEnabled = config.learningEnabled !== false;
        this.maxOutputChange = config.maxOutputChange || 0.5; // max change per cycle

        // Thermostat precision (step size): 1, 0.5, 0.2, or 0.1 degrees
        this.precision = config.precision || 0.5;

        // Mode: 'heat', 'cool', or 'heat_cool' (Home Assistant HVAC compatible)
        this.mode = config.mode || 'heat';

        // Operating mode: 'manual', 'schedule', or 'off'
        this.operatingMode = config.operatingMode || 'manual';

        // Schedule: { monday: [{time: "06:00", temp: 21}, ...], ..., default: 19 }
        this.schedule = config.schedule || null;

        // Boost mode
        this.boostActive = false;
        this.boostTemp = null;
        this.boostEndTime = null;

        // Away mode
        this.awayMode = false;
        this.awayTemp = config.awayTemp || 16;

        // PID parameters (will be adapted)
        // Ki increased from 0.01 to 0.02 for better steady-state offset compensation
        this.Kp = config.Kp || 1.0;
        this.Ki = config.Ki || 0.02;
        this.Kd = config.Kd || 0.5;

        // State
        this.integral = 0;
        this.lastError = 0;
        this.lastTemp = null;
        this.lastOutput = null;
        this.lastUpdateTime = null;

        // Learning state
        this.learningPhase = this.learningEnabled;
        this.temperatureHistory = [];
        this.outputHistory = [];
        this.learningStartTime = null;
        this.learningComplete = false;
        this.samplesNeeded = 30; // minimum samples before adapting

        // Performance tracking for continuous adaptation
        this.performanceHistory = [];
        this.adaptationInterval = 100; // adapt every N samples

        // Trend detection
        this.trendWindow = [];
        this.trendWindowSize = 5;

        // Flag to indicate PID parameters changed (for persistence)
        this.parametersChanged = false;
    }

    /**
     * Process a new temperature reading and calculate output
     * @param {number} currentTemp - Current temperature reading
     * @returns {object} - { output, debug }
     */
    update(currentTemp) {
        const now = Date.now();
        const dt = this.lastUpdateTime ? (now - this.lastUpdateTime) / 1000 : this.sampleInterval / 1000;
        this.lastUpdateTime = now;

        // Check boost expiry
        this.checkBoostExpiry();

        // Calculate effective target temperature based on mode priorities
        this.calculateEffectiveTarget();

        // Handle OFF mode
        if (this.operatingMode === 'off') {
            const offOutput = this.roundToPrecision(this.minTemp);
            return this.createOutput(offOutput, currentTemp, 0, 'off', null, this.mode);
        }

        // Record temperature for learning and trend detection
        this.recordTemperature(currentTemp, now);

        // Calculate error (positive = need heating, negative = need cooling)
        const error = this.targetTemp - currentTemp;

        // Determine active mode for heat_cool (auto)
        let activeMode = this.mode;
        if (this.mode === 'heat_cool') {
            activeMode = error > 0 ? 'heat' : 'cool';
        }

        // Check if within hysteresis zone - mark as stable but CONTINUE with PID
        // This allows the integral term to accumulate and maintain steady-state offset
        const inHysteresis = Math.abs(error) < this.hysteresis;

        // Check if action is needed based on mode
        if (this.mode === 'heat' && error < 0) {
            // In heat mode, room is too warm - set to target and let it cool naturally
            const output = this.roundToPrecision(this.targetTemp);
            this.lastOutput = output;
            // Reset integral to prevent windup when overshooting
            this.integral = Math.max(0, this.integral - Math.abs(error));
            return this.createOutput(output, currentTemp, error, 'idle', null, activeMode);
        }
        if (this.mode === 'cool' && error > 0) {
            // In cool mode, room is too cold - set to target and let it warm naturally
            const output = this.roundToPrecision(this.targetTemp);
            this.lastOutput = output;
            // Reset integral to prevent windup when undershooting
            this.integral = Math.max(0, this.integral - Math.abs(error));
            return this.createOutput(output, currentTemp, error, 'idle', null, activeMode);
        }

        // Learning phase logic
        if (this.learningPhase && !this.learningComplete) {
            this.learn(currentTemp, error, dt);
        }

        // Calculate PID terms
        const pidResult = this.calculatePID(error, dt, activeMode);

        // Calculate raw output based on mode
        // PID adjustment determines how much above/below target the setpoint should be
        let rawOutput;
        if (activeMode === 'cool') {
            // For cooling, setpoint should be below target
            rawOutput = this.targetTemp - pidResult.adjustment;
            // Only enforce minimum step when NOT in hysteresis (actively cooling)
            if (!inHysteresis) {
                const maxCool = this.targetTemp - this.precision;
                if (rawOutput > maxCool) {
                    rawOutput = maxCool;
                }
            }
        } else {
            // For heating, setpoint should be above target
            rawOutput = this.targetTemp + pidResult.adjustment;
            // Only enforce minimum step when NOT in hysteresis (actively heating)
            // In hysteresis, allow PID to settle at a lower offset for steady-state
            if (!inHysteresis) {
                const minHeat = this.targetTemp + this.precision;
                if (rawOutput < minHeat) {
                    rawOutput = minHeat;
                }
            }
        }

        // Apply rate limiting
        if (this.lastOutput !== null) {
            const maxChange = this.maxOutputChange;
            const change = rawOutput - this.lastOutput;
            if (Math.abs(change) > maxChange) {
                rawOutput = this.lastOutput + Math.sign(change) * maxChange;
            }
        }

        // Clamp to min/max and round to precision
        const output = this.roundToPrecision(this.clamp(rawOutput, this.minTemp, this.maxTemp));

        // Store for next iteration
        this.lastError = error;
        this.lastTemp = currentTemp;
        this.lastOutput = output;

        // Track performance for continuous adaptation
        if (!this.learningPhase) {
            this.trackPerformance(error);
        }

        // Determine trend - use "stable" when in hysteresis zone
        const trend = inHysteresis ? 'stable' : this.detectTrend();

        return this.createOutput(output, currentTemp, error, trend, pidResult, activeMode);
    }

    /**
     * Calculate PID control terms
     */
    calculatePID(error, dt, activeMode) {
        // For proportional term, use absolute error (always positive)
        const absError = Math.abs(error);

        // Proportional term
        const P = this.Kp * absError;

        // Integral term with signed error - allows integral to decrease when overshooting
        // For heating: error > 0 (too cold) increases integral, error < 0 (too warm) decreases it
        // For cooling: opposite - error < 0 (too warm) increases integral
        if (activeMode === 'heat') {
            this.integral += error * dt;
        } else {
            // For cooling, invert the error sign
            this.integral += (-error) * dt;
        }

        // Anti-windup: clamp integral to [0, limit] - don't allow negative integral
        const integralLimit = (this.maxTemp - this.minTemp) / (2 * this.Ki || 1);
        this.integral = this.clamp(this.integral, 0, integralLimit);
        const I = this.Ki * this.integral;

        // Derivative term (on error change, not measurement)
        const errorChange = Math.abs(error) - Math.abs(this.lastError);
        const derivative = dt > 0 ? errorChange / dt : 0;
        const D = this.Kd * derivative;

        // Total adjustment
        const adjustment = P + I + D;

        return { P, I, D, adjustment };
    }

    /**
     * Record temperature for analysis
     */
    recordTemperature(temp, timestamp) {
        this.temperatureHistory.push({ temp, timestamp });

        // Keep only last hour of data for learning
        const oneHourAgo = timestamp - 3600000;
        this.temperatureHistory = this.temperatureHistory.filter(t => t.timestamp > oneHourAgo);

        // Update trend window
        this.trendWindow.push(temp);
        if (this.trendWindow.length > this.trendWindowSize) {
            this.trendWindow.shift();
        }
    }

    /**
     * Learning phase: estimate system characteristics
     */
    learn(currentTemp, error, dt) {
        if (!this.learningStartTime) {
            this.learningStartTime = Date.now();
        }

        // Need enough samples
        if (this.temperatureHistory.length < this.samplesNeeded) {
            return;
        }

        // Calculate thermal characteristics
        const characteristics = this.estimateThermalCharacteristics();

        if (characteristics.timeConstant > 0 && characteristics.deadTime > 0) {
            // Ziegler-Nichols tuning based on estimated characteristics
            this.adaptPIDParameters(characteristics);
            this.learningComplete = true;
            this.learningPhase = false;
        }

        // Timeout: use conservative defaults after 1 hour
        const learningDuration = Date.now() - this.learningStartTime;
        if (learningDuration > 3600000) {
            this.learningComplete = true;
            this.learningPhase = false;
        }
    }

    /**
     * Estimate thermal time constant and dead time from collected data
     */
    estimateThermalCharacteristics() {
        if (this.temperatureHistory.length < 10) {
            return { timeConstant: 0, deadTime: 0 };
        }

        const temps = this.temperatureHistory.map(t => t.temp);
        const times = this.temperatureHistory.map(t => t.timestamp);

        // Find temperature change events
        let maxChange = 0;
        let changeStartIdx = 0;
        let changeEndIdx = 0;

        for (let i = 1; i < temps.length; i++) {
            const change = Math.abs(temps[i] - temps[0]);
            if (change > maxChange) {
                maxChange = change;
                changeEndIdx = i;
            }
        }

        if (maxChange < 0.5) {
            // Not enough temperature variation for estimation
            return { timeConstant: 0, deadTime: 0 };
        }

        // Find 63% point for time constant (first-order system approximation)
        const target63 = temps[0] + 0.632 * (temps[changeEndIdx] - temps[0]);
        let timeConstantIdx = changeEndIdx;

        for (let i = 0; i < changeEndIdx; i++) {
            if ((temps[0] < temps[changeEndIdx] && temps[i] >= target63) ||
                (temps[0] > temps[changeEndIdx] && temps[i] <= target63)) {
                timeConstantIdx = i;
                break;
            }
        }

        // Calculate time constant in seconds
        const timeConstant = (times[timeConstantIdx] - times[0]) / 1000;

        // Estimate dead time as time before 10% change
        const target10 = temps[0] + 0.1 * (temps[changeEndIdx] - temps[0]);
        let deadTimeIdx = 0;

        for (let i = 0; i < changeEndIdx; i++) {
            if ((temps[0] < temps[changeEndIdx] && temps[i] >= target10) ||
                (temps[0] > temps[changeEndIdx] && temps[i] <= target10)) {
                deadTimeIdx = i;
                break;
            }
        }

        const deadTime = (times[deadTimeIdx] - times[0]) / 1000;

        return { timeConstant, deadTime };
    }

    /**
     * Adapt PID parameters based on estimated thermal characteristics
     * Using modified Ziegler-Nichols tuning for thermal systems
     */
    adaptPIDParameters(characteristics) {
        const { timeConstant, deadTime } = characteristics;

        if (timeConstant <= 0 || deadTime <= 0) {
            return;
        }

        // Cohen-Coon tuning (better for thermal systems)
        const ratio = deadTime / timeConstant;

        if (ratio < 0.1) {
            // Fast system - use aggressive tuning
            this.Kp = 1.35 / ratio;
            this.Ki = this.Kp / (2.5 * deadTime);
            this.Kd = this.Kp * 0.37 * deadTime;
        } else if (ratio < 0.5) {
            // Moderate system
            this.Kp = (1.35 + 0.25 * ratio) / ratio;
            this.Ki = this.Kp / ((2.5 - 2.0 * ratio) * deadTime);
            this.Kd = this.Kp * (0.37 - 0.3 * ratio) * deadTime;
        } else {
            // Slow system - use conservative tuning
            this.Kp = 0.9 / ratio;
            this.Ki = this.Kp / (3.3 * deadTime);
            this.Kd = this.Kp * 0.2 * deadTime;
        }

        // Limit gains to reasonable values
        this.Kp = this.clamp(this.Kp, 0.1, 5.0);
        this.Ki = this.clamp(this.Ki, 0.001, 0.5);
        this.Kd = this.clamp(this.Kd, 0.0, 2.0);

        // Mark that parameters changed (for persistence)
        this.parametersChanged = true;
    }

    /**
     * Track performance for continuous adaptation
     */
    trackPerformance(error) {
        this.performanceHistory.push(Math.abs(error));

        // Keep last 1000 samples
        if (this.performanceHistory.length > 1000) {
            this.performanceHistory.shift();
        }

        // Periodic adaptation
        if (this.performanceHistory.length >= this.adaptationInterval &&
            this.performanceHistory.length % this.adaptationInterval === 0) {
            this.continuousAdaptation();
        }
    }

    /**
     * Continuous adaptation based on performance
     */
    continuousAdaptation() {
        if (this.performanceHistory.length < this.adaptationInterval) {
            return;
        }

        // Calculate average error over recent period
        const recentErrors = this.performanceHistory.slice(-this.adaptationInterval);
        const avgError = recentErrors.reduce((a, b) => a + b, 0) / recentErrors.length;

        // Calculate variance (oscillation indicator)
        const variance = recentErrors.reduce((sum, e) => sum + Math.pow(e - avgError, 2), 0) / recentErrors.length;
        const stdDev = Math.sqrt(variance);

        // Adapt based on performance
        const oldKp = this.Kp;
        const oldKd = this.Kd;

        if (stdDev > avgError * 0.5) {
            // High oscillation - reduce Kp and Kd
            this.Kp *= 0.95;
            this.Kd *= 0.95;
        } else if (avgError > this.hysteresis * 2) {
            // Slow response - increase Kp
            this.Kp *= 1.02;
        }

        // Limit gains
        this.Kp = this.clamp(this.Kp, 0.1, 5.0);
        this.Ki = this.clamp(this.Ki, 0.001, 0.5);
        this.Kd = this.clamp(this.Kd, 0.0, 2.0);

        // Mark if parameters actually changed
        if (this.Kp !== oldKp || this.Kd !== oldKd) {
            this.parametersChanged = true;
        }
    }

    /**
     * Detect temperature trend
     */
    detectTrend() {
        if (this.trendWindow.length < 3) {
            return 'unknown';
        }

        const first = this.trendWindow[0];
        const last = this.trendWindow[this.trendWindow.length - 1];
        const diff = last - first;

        if (diff > 0.1) {
            return 'heating';
        } else if (diff < -0.1) {
            return 'cooling';
        }
        return 'stable';
    }

    /**
     * Round value to thermostat precision
     */
    roundToPrecision(value) {
        return Math.round(value / this.precision) * this.precision;
    }

    /**
     * Create output object
     */
    createOutput(output, currentTemp, error, trend, pidResult = null, activeMode = null) {
        const debug = {
            currentTemp,
            targetTemp: this.targetTemp,
            baseTargetTemp: this.baseTargetTemp,
            setpoint: this.roundToPrecision(output),
            error: Math.round(error * 100) / 100,
            trend,
            mode: this.mode,
            activeMode: activeMode || this.mode,
            precision: this.precision,
            state: this.learningPhase ? 'learning' : 'running',
            learningComplete: this.learningComplete,
            pid: {
                Kp: Math.round(this.Kp * 1000) / 1000,
                Ki: Math.round(this.Ki * 1000) / 1000,
                Kd: Math.round(this.Kd * 1000) / 1000
            },
            // Schedule, boost, away info
            operatingMode: this.operatingMode,
            scheduleActive: this.operatingMode === 'schedule' && this.schedule !== null,
            currentScheduleSlot: this.getCurrentScheduleSlot(),
            boostActive: this.boostActive,
            boostTemp: this.boostTemp,
            boostEndTime: this.boostEndTime,
            boostRemaining: this.boostActive && this.boostEndTime
                ? Math.max(0, Math.round((this.boostEndTime - Date.now()) / 60000))
                : 0,
            awayMode: this.awayMode,
            awayTemp: this.awayTemp
        };

        if (pidResult) {
            debug.pidTerms = {
                P: Math.round(pidResult.P * 100) / 100,
                I: Math.round(pidResult.I * 100) / 100,
                D: Math.round(pidResult.D * 100) / 100
            };
        }

        return {
            output: this.roundToPrecision(output),
            debug
        };
    }

    /**
     * Set new target temperature
     */
    setSetpoint(temp) {
        if (typeof temp === 'number' && !isNaN(temp)) {
            this.baseTargetTemp = this.clamp(temp, this.minTemp, this.maxTemp);
            this.targetTemp = this.baseTargetTemp;
            // Reset integral to prevent windup from setpoint change
            this.integral = 0;
        }
    }

    /**
     * Set operating mode: 'manual', 'schedule', or 'off'
     */
    setOperatingMode(mode) {
        if (['manual', 'schedule', 'off'].includes(mode)) {
            this.operatingMode = mode;
            // Reset integral when switching modes
            this.integral = 0;
        }
    }

    /**
     * Set weekly schedule
     * @param {object} schedule - { monday: [{time: "06:00", temp: 21}, ...], default: 19 }
     */
    setSchedule(schedule) {
        if (schedule && typeof schedule === 'object') {
            this.schedule = schedule;
        }
    }

    /**
     * Set boost mode
     * @param {object|boolean} boost - { temp: 24, duration: 60 } or false to disable
     */
    setBoost(boost) {
        if (boost === false) {
            this.boostActive = false;
            this.boostTemp = null;
            this.boostEndTime = null;
        } else if (boost && typeof boost === 'object') {
            const temp = parseFloat(boost.temp);
            const duration = parseInt(boost.duration, 10);
            if (!isNaN(temp) && !isNaN(duration) && duration > 0) {
                this.boostActive = true;
                this.boostTemp = this.clamp(temp, this.minTemp, this.maxTemp);
                this.boostEndTime = Date.now() + (duration * 60 * 1000);
            }
        }
    }

    /**
     * Set away mode
     * @param {boolean|number} away - true/false or specific temperature
     */
    setAwayMode(away) {
        if (away === false) {
            this.awayMode = false;
        } else if (away === true) {
            this.awayMode = true;
        } else if (typeof away === 'number' && !isNaN(away)) {
            this.awayMode = true;
            this.awayTemp = this.clamp(away, this.minTemp, this.maxTemp);
        }
    }

    /**
     * Check if boost mode has expired
     */
    checkBoostExpiry() {
        if (this.boostActive && this.boostEndTime && Date.now() > this.boostEndTime) {
            this.boostActive = false;
            this.boostTemp = null;
            this.boostEndTime = null;
        }
    }

    /**
     * Get time components for a given timezone
     * Supports: 'local', 'UTC', or IANA timezone names (e.g., 'Europe/Warsaw')
     */
    getTimeInTimezone(timezone) {
        const now = new Date();

        if (!timezone || timezone === 'local') {
            return {
                dayIndex: now.getDay(),
                hours: now.getHours(),
                minutes: now.getMinutes()
            };
        }

        if (timezone === 'UTC') {
            return {
                dayIndex: now.getUTCDay(),
                hours: now.getUTCHours(),
                minutes: now.getUTCMinutes()
            };
        }

        // IANA timezone (e.g., 'Europe/Warsaw', 'America/New_York')
        try {
            const options = { timeZone: timezone, hour12: false };
            const formatter = new Intl.DateTimeFormat('en-US', {
                ...options,
                weekday: 'short',
                hour: 'numeric',
                minute: 'numeric'
            });

            const parts = formatter.formatToParts(now);
            const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

            let dayIndex = 0, hours = 0, minutes = 0;
            for (const part of parts) {
                if (part.type === 'weekday') dayIndex = weekdayMap[part.value] || 0;
                if (part.type === 'hour') hours = parseInt(part.value, 10);
                if (part.type === 'minute') minutes = parseInt(part.value, 10);
            }

            // Handle midnight edge case (hour: 24 -> 0)
            if (hours === 24) hours = 0;

            return { dayIndex, hours, minutes };
        } catch (e) {
            // Fallback to local time if timezone is invalid
            return {
                dayIndex: now.getDay(),
                hours: now.getHours(),
                minutes: now.getMinutes()
            };
        }
    }

    /**
     * Get temperature from schedule for current time
     * Supports timezone configuration: 'local', 'UTC', or IANA timezone names
     */
    getScheduledTemp() {
        if (!this.schedule) return this.baseTargetTemp;

        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const { dayIndex, hours, minutes } = this.getTimeInTimezone(this.schedule.timezone);

        const daySchedule = this.schedule[dayNames[dayIndex]];

        // If no slots for today, try to get last slot from previous day
        if (!daySchedule || !Array.isArray(daySchedule) || daySchedule.length === 0) {
            // Look for last slot from yesterday
            const yesterdayIndex = (dayIndex + 6) % 7;
            const yesterdaySchedule = this.schedule[dayNames[yesterdayIndex]];
            if (yesterdaySchedule && Array.isArray(yesterdaySchedule) && yesterdaySchedule.length > 0) {
                return yesterdaySchedule[yesterdaySchedule.length - 1].temp;
            }
            // No schedule anywhere - use target temp from Settings
            return this.baseTargetTemp;
        }

        const currentTime = hours * 60 + minutes;

        // Find last slot before or at current time
        let activeSlot = null;
        for (const slot of daySchedule) {
            if (slot.time && slot.temp !== undefined) {
                const [slotHours, slotMins] = slot.time.split(':').map(Number);
                const slotMinutes = slotHours * 60 + (slotMins || 0);
                if (slotMinutes <= currentTime) {
                    activeSlot = slot;
                }
            }
        }

        // If no slot before current time (e.g., 00:30 and first slot is 06:00),
        // use last slot from previous day (temperature carries over midnight)
        if (!activeSlot) {
            const yesterdayIndex = (dayIndex + 6) % 7;
            const yesterdaySchedule = this.schedule[dayNames[yesterdayIndex]];
            if (yesterdaySchedule && Array.isArray(yesterdaySchedule) && yesterdaySchedule.length > 0) {
                activeSlot = yesterdaySchedule[yesterdaySchedule.length - 1];
            }
        }

        if (activeSlot && activeSlot.temp !== undefined) {
            return activeSlot.temp;
        }

        // Fallback to target temp from Settings
        return this.baseTargetTemp;
    }

    /**
     * Calculate effective target temperature based on priority:
     * 1. BOOST (highest priority)
     * 2. AWAY (limits max temp)
     * 3. SCHEDULE (if in schedule mode)
     * 4. MANUAL (base target)
     */
    calculateEffectiveTarget() {
        let effectiveTemp = this.baseTargetTemp;

        // Apply schedule if enabled (schedule exists), regardless of operatingMode
        // operatingMode controls external behavior, local schedule is separate
        if (this.schedule) {
            effectiveTemp = this.getScheduledTemp();
        }

        // Away mode limits max temperature
        if (this.awayMode) {
            effectiveTemp = Math.min(effectiveTemp, this.awayTemp);
        }

        // Boost overrides everything
        if (this.boostActive && this.boostTemp !== null) {
            effectiveTemp = this.boostTemp;
        }

        this.targetTemp = this.clamp(effectiveTemp, this.minTemp, this.maxTemp);
    }

    /**
     * Synchronize with current schedule state without requiring temperature input.
     * Call this on startup or when configuration changes to ensure targetTemp is current.
     * @returns {number} Current target temperature
     */
    syncSchedule() {
        this.calculateEffectiveTarget();
        return this.targetTemp;
    }

    /**
     * Get current status without running full update cycle.
     * Useful for status updates when config changes but no temperature input is available.
     * @returns {Object} Status object similar to update() return value
     */
    getStatus() {
        this.calculateEffectiveTarget();
        return {
            output: this.lastOutput !== null ? this.lastOutput : this.targetTemp,
            debug: {
                currentTemp: this.currentTemp,
                targetTemp: this.targetTemp,
                error: this.currentTemp !== null ? this.targetTemp - this.currentTemp : 0,
                state: this.state,
                trend: this.trend,
                operatingMode: this.operatingMode,
                activeMode: this.activeMode,
                boostActive: this.boostActive,
                boostRemaining: this.boostRemaining,
                awayMode: this.awayMode,
                pid: { Kp: this.Kp, Ki: this.Ki, Kd: this.Kd }
            }
        };
    }

    /**
     * Get current schedule slot info
     */
    getCurrentScheduleSlot() {
        if (!this.schedule) return null;

        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const { dayIndex, hours, minutes } = this.getTimeInTimezone(this.schedule.timezone);

        const daySchedule = this.schedule[dayNames[dayIndex]];

        if (!daySchedule || !Array.isArray(daySchedule) || daySchedule.length === 0) {
            return null;
        }

        const currentTime = hours * 60 + minutes;

        for (let i = daySchedule.length - 1; i >= 0; i--) {
            const slot = daySchedule[i];
            if (slot.time) {
                const [hours, mins] = slot.time.split(':').map(Number);
                const slotMinutes = hours * 60 + (mins || 0);
                if (slotMinutes <= currentTime) {
                    return slot;
                }
            }
        }

        return null;
    }

    /**
     * Check if parameters changed and need saving
     * Clears the flag after checking
     */
    hasParametersChanged() {
        const changed = this.parametersChanged;
        this.parametersChanged = false;
        return changed;
    }

    /**
     * Get current state (for persistence)
     */
    getState() {
        return {
            // Configuration
            minTemp: this.minTemp,
            maxTemp: this.maxTemp,
            targetTemp: this.targetTemp,
            baseTargetTemp: this.baseTargetTemp,
            hysteresis: this.hysteresis,
            learningEnabled: this.learningEnabled,
            mode: this.mode,

            // PID parameters
            Kp: this.Kp,
            Ki: this.Ki,
            Kd: this.Kd,

            // State
            integral: this.integral,
            lastError: this.lastError,
            lastTemp: this.lastTemp,
            lastOutput: this.lastOutput,

            // Learning state
            learningPhase: this.learningPhase,
            learningComplete: this.learningComplete,
            temperatureHistory: this.temperatureHistory,
            performanceHistory: this.performanceHistory,

            // Schedule, boost, away
            operatingMode: this.operatingMode,
            schedule: this.schedule,
            boostActive: this.boostActive,
            boostTemp: this.boostTemp,
            boostEndTime: this.boostEndTime,
            awayMode: this.awayMode,
            awayTemp: this.awayTemp
        };
    }

    /**
     * Restore state (from persistence)
     */
    setState(state) {
        if (!state) return;

        // Restore PID parameters
        if (state.Kp !== undefined) this.Kp = state.Kp;
        if (state.Ki !== undefined) this.Ki = state.Ki;
        if (state.Kd !== undefined) this.Kd = state.Kd;

        // Restore state
        if (state.integral !== undefined) this.integral = state.integral;
        if (state.lastError !== undefined) this.lastError = state.lastError;
        if (state.lastTemp !== undefined) this.lastTemp = state.lastTemp;
        if (state.lastOutput !== undefined) this.lastOutput = state.lastOutput;

        // Restore learning state
        if (state.learningPhase !== undefined) this.learningPhase = state.learningPhase;
        if (state.learningComplete !== undefined) this.learningComplete = state.learningComplete;
        if (Array.isArray(state.temperatureHistory)) this.temperatureHistory = state.temperatureHistory;
        if (Array.isArray(state.performanceHistory)) this.performanceHistory = state.performanceHistory;

        // Restore mode
        if (state.mode !== undefined) this.mode = state.mode;

        // Restore base target
        if (state.baseTargetTemp !== undefined) this.baseTargetTemp = state.baseTargetTemp;

        // Restore schedule, boost, away
        if (state.operatingMode !== undefined) this.operatingMode = state.operatingMode;
        if (state.schedule !== undefined) this.schedule = state.schedule;
        if (state.boostActive !== undefined) this.boostActive = state.boostActive;
        if (state.boostTemp !== undefined) this.boostTemp = state.boostTemp;
        if (state.boostEndTime !== undefined) this.boostEndTime = state.boostEndTime;
        if (state.awayMode !== undefined) this.awayMode = state.awayMode;
        if (state.awayTemp !== undefined) this.awayTemp = state.awayTemp;
    }

    /**
     * Set operating mode (Home Assistant HVAC compatible)
     * Accepts: 'heat', 'cool', 'heat_cool' (or legacy: 'heating', 'cooling', 'auto')
     */
    setMode(mode) {
        // Map legacy mode names to HA HVAC names
        const modeMap = {
            'heating': 'heat',
            'cooling': 'cool',
            'auto': 'heat_cool'
        };
        const normalizedMode = modeMap[mode] || mode;

        if (['heat', 'cool', 'heat_cool'].includes(normalizedMode)) {
            this.mode = normalizedMode;
            // Reset integral when switching modes
            this.integral = 0;
        }
    }

    /**
     * Reset controller to initial state
     */
    reset() {
        this.integral = 0;
        this.lastError = 0;
        this.lastTemp = null;
        this.lastOutput = null;
        this.lastUpdateTime = null;

        this.learningPhase = this.learningEnabled;
        this.temperatureHistory = [];
        this.outputHistory = [];
        this.learningStartTime = null;
        this.learningComplete = false;
        this.performanceHistory = [];
        this.trendWindow = [];

        // Reset PID to defaults
        this.Kp = 1.0;
        this.Ki = 0.01;
        this.Kd = 0.5;
    }

    /**
     * Clamp value between min and max
     */
    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}

module.exports = AdaptiveController;
