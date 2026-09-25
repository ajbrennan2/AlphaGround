const paths = {
    power: <path d="M12 2v9M6 5a9 9 0 1 0 12 0" />,
    settings: <><path d="M4 7h2m6 0h8M4 17h8m6 0h2" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    fire: <path d="M13 2c1 6-4 6-2 10 2-1 3-3 3-5 4 4 5 6 5 9a7 7 0 0 1-14 0c0-4 4-7 8-14Z" />,
    stop: <><path d="m8 3-5 5v8l5 5h8l5-5V8l-5-5Z" /><path d="M9 9h6v6H9z" /></>,
    key: <><circle cx="8" cy="9" r="5" /><path d="m12 13 8 8m-3-3 3-3m-6 0 3-3" /></>,
    circuit: <path d="M2 12h5l3-7 4 14 3-7h5" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
};
export default function ControlIcon({ name, ...props }) {
    return <svg className="console-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
