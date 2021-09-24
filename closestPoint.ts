import { rebind, webglProgramBuilder, webglUniform } from 'd3fc';
import drawModes from '@d3fc/d3fc-webgl/src/program/drawModes';
import pingPongTexture from './pingPongTexture';
import readTexture_ from './readTexture';
import rebindCurry from '@d3fc/d3fc-webgl/src/rebindCurry';

const mapVertexShader = () => `
precision mediump float;

uniform vec2 uPoint;
uniform float uMaxDistance;
uniform vec2 uViewportSize;
attribute float aCrossValue;
attribute float aMainValue;
attribute vec2 aIndex;
varying vec4 vFragColor;

void main() {
    // (0, 0) pixel-aligned and converted to clip-space
    vec2 coord = (vec2(0, 0) + 0.5) / (uViewportSize[0] / 2.0) - 1.0;

    // distance calculated and converted to [0, 1]
    float distance = min(distance(uPoint, vec2(aCrossValue, aMainValue)), uMaxDistance) / uMaxDistance;

    // 24-bit index split into 3 bytes and converted to [0, 1]
    vec3 index = vec3(mod(aIndex[1], 256.0), floor(aIndex[0] / 256.0), mod(aIndex[0], 256.0)) / 255.0;

    gl_PointSize = 1.0;
    gl_Position = vec4(coord.x, coord.y, distance, 1.0);

    vFragColor = vec4(index.x, index.y, index.z, distance);
}
`;

const mapFragmentShader = () => `
precision mediump float;

varying vec4 vFragColor;

void main() {
    gl_FragColor = vFragColor;
}
`;

export default function (maxByteLength) {
    const maxDistance = 20;
    const size = [1, 1];
    const texture = pingPongTexture()
        .size(size);
    const pointUniform = webglUniform();
    const programBuilder = webglProgramBuilder()
        .fragmentShader(mapFragmentShader)
        .vertexShader(mapVertexShader)
        .mode(drawModes.POINTS);
    programBuilder.buffers()
        .uniform(`uViewportSize`, webglUniform(size))
        .uniform(`uTexture`, texture)
        .uniform(`uPoint`, pointUniform)
        .uniform(`uMaxDistance`, webglUniform([maxDistance]));
    const readTexture = readTexture_()
        .texture(texture)
        .size(size);

    const closestPoint = function (count, { x = 0, y = 0 }) {
        const context = programBuilder.context();
        programBuilder.context(context);
        readTexture.context(context);

        pointUniform.data([x, y]);
        texture.enable(true);
        context.enable(context.DEPTH_TEST);
        context.depthFunc(context.LESS);

        programBuilder(count);

        context.disable(context.DEPTH_TEST);
        texture.enable(false);

        const pixels = readTexture(1);
        const index = pixels[0] << 16 | pixels[1] << 8 | pixels[2];
        const distance = (pixels[3] / 256) * maxDistance;

        return {
            index,
            distance
        };
    };

    rebind(closestPoint, programBuilder, 'context');
    rebindCurry(
        closestPoint,
        'mainValueAttribute',
        programBuilder.buffers(),
        'attribute',
        'aMainValue'
    );
    rebindCurry(
        closestPoint,
        'crossValueAttribute',
        programBuilder.buffers(),
        'attribute',
        'aCrossValue'
    );
    rebindCurry(
        closestPoint,
        'indexValueAttribute',
        programBuilder.buffers(),
        'attribute',
        'aIndex'
    );

    return closestPoint;
}