export function connectionUrl({ endpoint, mode = 'network', serialPort = '' }) {
    if (!['network', 'serial'].includes(mode)) throw new Error('Select network or serial bridge.');
    const address = endpoint.trim();
    if (!address) throw new Error('Enter an IP address or WebSocket URL.');
    let url;
    try {
        url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(address) ? address : `ws://${address}`);
    } catch { throw new Error('Enter a valid IP address or WebSocket URL.'); }
    if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
        throw new Error('Use a ws:// or wss:// address without credentials or a fragment.');
    }
    if (!url.port && !/^[a-z][a-z\d+.-]*:\/\//i.test(address)) url.port = '3333';
    if (url.pathname === '/') url.pathname = '/data';
    url.searchParams.delete('serial_port');
    if (mode === 'serial') {
        if (!serialPort.trim()) throw new Error('Enter the serial port on the bridge computer.');
        url.searchParams.set('serial_port', serialPort.trim());
    }
    return url.href;
}
