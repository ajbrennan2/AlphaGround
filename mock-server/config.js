// Shape of one synthetic channel. `mode` decides how `value` is animated.
//   fixed - hold `value`
//   sine  - value + amp * sin(2pi * t / period)
//   ramp  - sweep value -> value + amp across `period`, then snap back
//   noise - value +/- amp, resampled every frame
//   walk  - random walk that drifts by up to `amp` per second
const ch = (value, mode = "fixed", amp = 0, period = 4) => ({
    mode,
    value,
    amp,
    period,
});

// Channel counts are dictated by App.jsx: it indexes temps[0..3], acc[0..2],
// pressures[0..11] unconditionally, and reads thrusts[0] for its chart.
export const COUNTS = { temps: 4, pressures: 12, thrusts: 1, acc: 3 };

export const STATES = [
    "STANDBY",
    "FIRE_RECIEVED",
    "IGNITE",
    "BURNING",
    "COOLDOWN",
    "ABORT",
];

export const COMMANDS = {
    0: "S1_ON",
    1: "S1_OFF",
    2: "S2_ON",
    3: "S2_OFF",
    4: "S3_ON",
    5: "S3_OFF",
    6: "S4_ON",
    7: "S4_OFF",
    8: "FIRE",
    9: "RST",
    10: "ABRT",
};

export function defaultConfig() {
    return {
        rate: 30, // frames per second pushed to the app
        running: true,
        serialConnected: true,
        autoSequence: true, // let FIRE walk the state machine on its own
        channels: {
            temps: Array.from({ length: COUNTS.temps }, () =>
                ch(22, "walk", 1.5),
            ),
            // Idle pressures sit just above zero. The UI plots all finite raw
            // values; negative samples are useful for checking zero crossings.
            pressures: [ch(0.9, "walk", 0.2), ch(120, "walk", 6)].concat(
                Array.from({ length: COUNTS.pressures - 2 }, () => ch(60, "walk", 4)),
            ),
            thrusts: Array.from({ length: COUNTS.thrusts }, () => ch(4, "walk", 1.5)),
            acc: [ch(0, "sine", 180, 20), ch(0, "sine", 25, 7), ch(0, "sine", 15, 5)],
        },
        solenoids: [0, 0, 0, 0],
        keys: [1],
        burn: [1],
        going: 0,
        state: 0,
    };
}

// Web testing starts with steady values, so manual edits stay exactly where set.
export function manualConfig() {
    const config = defaultConfig();
    config.autoSequence = false;
    for (const channels of Object.values(config.channels)) {
        for (const channel of channels) { channel.mode = "fixed"; channel.amp = 0; }
    }
    return config;
}

// Named starting points. Each one is a partial config merged over the default.
export const SCENARIOS = {
    manual: { label: "Manual / fixed", apply: manualConfig },
    idle: {
        label: "Idle on the pad",
        apply: () => defaultConfig(),
    },
    pressurized: {
        label: "Tanks pressurized",
        apply: () => {
            const c = defaultConfig();
            c.channels.pressures[0] = ch(2.4, "walk", 0.08);
            c.channels.pressures[1] = ch(620, "walk", 12);
            for (let i = 2; i < COUNTS.pressures; i++) {
                c.channels.pressures[i] = ch(480 - i * 20, "walk", 8);
            }
            c.solenoids = [1, 0, 0, 0];
            return c;
        },
    },
    burn: {
        label: "Mid burn",
        apply: () => {
            const c = defaultConfig();
            c.state = 3; // BURNING
            c.going = 1;
            c.channels.temps = c.channels.temps.map((_, i) =>
                ch(310 + i * 40, "walk", 14),
            );
            c.channels.pressures[0] = ch(3.1, "sine", 0.25, 1.5);
            c.channels.pressures[1] = ch(850, "sine", 70, 1.5);
            for (let i = 2; i < COUNTS.pressures; i++) {
                c.channels.pressures[i] = ch(700 - i * 30, "walk", 25);
            }
            c.channels.thrusts = [ch(940, "sine", 60, 0.8)];
            c.solenoids = [1, 1, 0, 0];
            return c;
        },
    },
    abort: {
        label: "Abort",
        apply: () => {
            const c = defaultConfig();
            c.state = 5; // ABORT
            c.channels.temps = c.channels.temps.map(() => ch(180, "walk", 20));
            c.burn = [0];
            c.keys = [0];
            return c;
        },
    },
    stress: {
        label: "Stress the charts",
        apply: () => {
            const c = defaultConfig();
            c.rate = 60;
            c.channels.temps = c.channels.temps.map((_, i) =>
                ch(250, "sine", 240, 1 + i * 0.4),
            );
            c.channels.pressures = c.channels.pressures.map((_, i) =>
                ch(2400, "sine", 2300, 0.7 + i * 0.25),
            );
            c.channels.thrusts = [ch(600, "sine", 580, 0.5)];
            c.channels.acc = [
                ch(0, "ramp", 360, 6),
                ch(0, "sine", 80, 3),
                ch(0, "sine", 60, 2),
            ];
            return c;
        },
    },
};
