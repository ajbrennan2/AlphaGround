import { useEffect, useRef, useState } from 'react';
import ControlIcon from './ControlIcon';
import { connectionUrl } from '../connectionSettings';

export default function ConnectionMenu({ settings, connect, disconnect, connection, error, webTest }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(settings);
    const [validation, setValidation] = useState('');
    const host = useRef(null);
    const trigger = useRef(null);
    useEffect(() => {
        if (!open) return;
        function dismiss(event) {
            if (event.type === 'keydown' && event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
            if (event.type === 'pointerdown' && !host.current?.contains(event.target)) setOpen(false);
        }
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', dismiss);
        return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss); };
    }, [open]);
    function submit(event) {
        event.preventDefault();
        try { connectionUrl(draft); connect(draft); setOpen(false); setValidation(''); trigger.current?.focus(); }
        catch (issue) { setValidation(issue.message); }
    }
    return <div className="console-connection-menu" ref={host}>
        <div className="console-connection-actions"><button ref={trigger} aria-expanded={open} aria-controls="connection-menu" onClick={() => { setDraft(settings); setValidation(''); setOpen(!open); }}><ControlIcon name="settings" />Connection…</button><button disabled={connection === 'Disconnected'} onClick={disconnect}><ControlIcon name="power" />Disconnect</button></div>
        {error && <p className="console-connection-error" role="alert">{error}</p>}
        {open && <form id="connection-menu" className="console-connection-popover" aria-label="Connection settings" onSubmit={submit}>
            <div className="dp-panel-head"><h2>Connection</h2><button type="button" className="console-text-button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Close</button></div>
            {webTest ? <p>Web test uses the local mock. Hardware connections are available in the normal app.</p> : <>
                <label>Connect via<select autoFocus value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value })}><option value="network">Network / IP</option><option value="serial">Serial bridge</option></select></label>
                <label>{draft.mode === 'serial' ? 'Bridge IP or WebSocket URL' : 'IP or WebSocket URL'}<input value={draft.endpoint} onChange={event => setDraft({ ...draft, endpoint: event.target.value })} placeholder="192.168.1.10:3333" required spellCheck={false} /></label>
                {draft.mode === 'serial' && <><label>Serial port<input value={draft.serialPort} onChange={event => setDraft({ ...draft, serialPort: event.target.value })} placeholder="/dev/ttyUSB0 or COM3" required spellCheck={false} /></label><p>The port is on the computer running External/monitor.py. For a local USB device, use localhost:3333 as the bridge address. Baud: 460800.</p></>}
            </>}
            {validation && <p role="alert" className="console-connection-error">{validation}</p>}
            <button type="submit">{connection === 'Disconnected' ? 'Connect' : 'Reconnect'}</button>
        </form>}
    </div>;
}
