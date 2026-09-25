// A request is observed only in a later board frame; sending is not acknowledgment.
// Offline intent is never replayed or marked as a successfully sent command.
export function resolveValveRequests(requests, frame) {
    if (frame.serial_connected === false) return requests;
    let next = requests;
    for (const [index, request] of Object.entries(requests)) {
        if (request.sent && frame.frameId > request.afterFrame && frame.solenoids[index] === request.value) {
            if (next === requests) next = { ...requests };
            delete next[index];
        }
    }
    return next;
}

export const VALVE_RESPONSE_DELAY_MS = 1000;

// Keep the reported position visible during normal command round trips.
export function waitingValveRequests(requests, solenoids, available, now) {
    return Object.fromEntries(Object.entries(requests).filter(([index, request]) =>
        !available || (solenoids[index] !== 0 && solenoids[index] !== 1)
        || now - request.requestedAt >= VALVE_RESPONSE_DELAY_MS));
}
