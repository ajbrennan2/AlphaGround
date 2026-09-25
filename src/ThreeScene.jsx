import { Canvas, useThree } from "@react-three/fiber";
import { Rocketship } from "./Rocketship";
import { memo, Suspense, useLayoutEffect, useRef } from "react";
import { Euler, MathUtils } from "three";
import { useTelemetry } from "./useTelemetry";

function OrientedRocket({ store }) {
    const orientation = useTelemetry(store, "acc");
    const rocketRef = useRef();
    const euler = useRef(new Euler(0, 0, 0, "ZYX"));
    const invalidate = useThree(state => state.invalidate);

    useLayoutEffect(() => {
        if (!rocketRef.current || !orientation.every(Number.isFinite)) return;
        // Preserve the existing display axes pending hardware calibration.
        const [yaw, pitch, roll] = orientation.map(MathUtils.degToRad);
        euler.current.set(-pitch, -yaw, -roll, "ZYX");
        rocketRef.current.quaternion.setFromEuler(euler.current);
        invalidate();
    }, [orientation, invalidate]);

    return <Rocketship ref={rocketRef} />;
}

const ThreeScene = memo(function ThreeScene({ store }) {
    return (
        <Canvas resize={{ offsetSize: true }} dpr={1} gl={{ antialias: false, powerPreference: "low-power", stencil: false }} frameloop="demand" style={{ width: "100%", height: "100%" }} camera={{ fov: 10 }}>
            <Suspense fallback={null}>
                <OrientedRocket store={store} />
            </Suspense>
            <ambientLight intensity={5} />
            <directionalLight position={[0, 0, 5]} />
        </Canvas>
    );
});

export default ThreeScene;
