import { lazy, memo, Suspense, useState } from "react";
import { useTelemetry } from "./useTelemetry";

const Datachart = lazy(() => import("./Datachart"));

const Databox = memo(function Databox({ title, store, group }) {
    const data = useTelemetry(store, group);
    const [hovered, sethovered] = useState(null);

    return (
        <div
            style={{
                width: "100%",
                backgroundColor: "var(--dark-blue)",
                overflow: "hidden",
                marginTop: "10px",
                flex: 1,
                fontFamily: "Space Mono",
                fontWeight: "400",
                fontStyle: "normal",
            }}
            className="glow"
        >
            <div
                style={{
                    textAlign: "center",
                    color: "var(--dark-yellow)",
                    margin: "10px",
                    fontSize: "20px",
                }}
            >
                <b>
                    <i>{title}</i>
                </b>
            </div>
            <ul
                style={{
                    listStyleType: "none",
                    margin: "0px",
                    marginBottom: "20px",
                    padding: "0px",
                    textAlign: "Center",
                }}
            >
                {data.map((item, index) => {
                    return (
                        <li
                            key={index}
                            onMouseEnter={() => sethovered(index)}
                            onMouseLeave={() => sethovered(null)}
                            className="lihover"
                        >
                            <p style={{ margin: "2px" }}>
                                {index}: {Number.isFinite(item) ? item.toFixed(2) : "--"}
                            </p>
                            {hovered === index ? (
                                <Suspense fallback={<div style={{ height: 200 }}>Loading chart…</div>}>
                                    <Datachart store={store} group={group} index={index} />
                                </Suspense>
                            ) : (
                                <></>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
});

export default Databox;
