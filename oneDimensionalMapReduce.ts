import { webglProgramBuilder } from 'd3fc';
import { drawModes } from '@d3fc/d3fc-webgl/src/program/drawModes';
import pingPongTexture from './pingPongTexture';

export default (framebufferSize) => {
    const texture = pingPongTexture()
    let pixelRatio = 1;
    let context = null;
    let debug = null; // set to e.g. console.log to capture partial results

    const mapProgram = webglProgramBuilder()
        .mode(drawModes.POINTS);

    const reduceProgram = webglProgramBuilder()
        .mode(drawModes.POINTS);

    const oneDimensionalMapReduce = () => {
        mapProgram.pixelRatio(pixelRatio)
            .context(context);
        reduceProgram.pixelRatio(pixelRatio)
            .context(context);


        return oneDimensionalMapReduce;
    };

    return oneDimensionalMapReduce;
};