export const GROUPS = {
    pressures: { label: 'Pressures', prefix: 'PT', count: 12, unit: 'raw' },
    temps: { label: 'Temperatures', prefix: 'TC', count: 4, unit: 'raw' },
    thrusts: { label: 'Thrust', prefix: 'LC', count: 1, unit: 'raw' },
    acc: { label: 'Orientation', count: 3, unit: '°' },
};
export const AXES = ['Yaw', 'Pitch', 'Roll'];
export const STAGES = [
    { label: 'Standby' },
    { label: 'Fire received' },
    { label: 'Ignite' },
    { label: 'Burning' },
    { label: 'Cooldown' },
];
export function channelName(group, index) {
    return group === 'acc' ? AXES[index] : `${GROUPS[group].prefix}-${String(index + 1).padStart(2, '0')}`;
}
export function reading(value, places = 2) { return Number.isFinite(value) ? value.toFixed(places) : '--'; }
