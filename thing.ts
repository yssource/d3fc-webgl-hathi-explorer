import { webglBufferBuilder, webglProgramBuilder, webglUniform } from 'd3fc';
import drawModes from '@d3fc/d3fc-webgl/src/program/drawModes';
import pingPongTexture from './pingPongTexture';

function copyBuffer(programBuilderSource, programBuilderDestination, type, name) {
    programBuilderDestination.buffers()
    [type](
        name,
        programBuilderSource.buffers()
        [type](name)
    );
}

const PING_PONG_TEXTURE_SIZE = Math.pow(2, 12);

const mapVertexShader = () => `
precision mediump float;

uniform vec2 uPoint;
uniform vec2 uTextureSize;
uniform sampler2D uTexture;
attribute float aCrossValue;
attribute float aMainValue;
attribute vec2 aIndex;
varying vec4 vFragColor;

void main() {
    vec2 coord = vec2(mod(aIndex[0], uTextureSize[0]), floor(aIndex[0] / uTextureSize[0]));
    // center on pixels
    coord = coord + 0.5;
    // convert to clip space
    coord = coord / (uTextureSize[0] / 2.0) - 1.0;

    gl_Position = vec4(coord.x, coord.y, 0.0, 1.0);
    gl_PointSize = 1.0;

    vFragColor = vec4(0, 0, 0, 1);
    vFragColor.r = mod(aIndex[1], 256.0) / 255.0;
    vFragColor.g = floor(aIndex[0] / 256.0) / 255.0;
    vFragColor.b = mod(aIndex[0], 256.0) / 255.0;
    vFragColor.a = 1.0 - min(distance(uPoint, vec2(aCrossValue, aMainValue)), 3.0) / 3.0;
}
`;

const reduceVertexShader = () => `
precision mediump float;

uniform vec2 uTextureSize;
uniform sampler2D uTexture;
attribute vec2 aIndex;
varying vec4 vFragColor;

void main() {
    float index1 = aIndex[0] * 4.0 + 0.0;
    vec2 sourceCoord1 = vec2(mod(index1, uTextureSize[0]), floor(index1 / uTextureSize[0]));
    sourceCoord1 = (sourceCoord1 + 0.5) / uTextureSize[0];
    
    float index2 = aIndex[0] * 4.0 + 1.0;
    vec2 sourceCoord2 = vec2(mod(index2, uTextureSize[0]), floor(index2 / uTextureSize[0]));
    sourceCoord2 = (sourceCoord2 + 0.5) / uTextureSize[0];
    
    float index3 = aIndex[0] * 4.0 + 2.0;
    vec2 sourceCoord3 = vec2(mod(index3, uTextureSize[0]), floor(index3 / uTextureSize[0]));
    sourceCoord3 = (sourceCoord3 + 0.5) / uTextureSize[0];
    
    float index4 = aIndex[0] * 4.0 + 3.0;
    vec2 sourceCoord4 = vec2(mod(index4, uTextureSize[0]), floor(index4 / uTextureSize[0]));
    sourceCoord4 = (sourceCoord4 + 0.5) / uTextureSize[0];

    vec4 source = texture2D(uTexture, sourceCoord1);
    vec4 temp = texture2D(uTexture, sourceCoord2);
    source = source.a > temp.a ? source : temp;
    temp = texture2D(uTexture, sourceCoord3);
    source = source.a > temp.a ? source : temp;
    temp = texture2D(uTexture, sourceCoord4);
    vFragColor = source.a > temp.a ? source : temp;


    vec2 coord = vec2(mod(aIndex[0], uTextureSize[0]), floor(aIndex[0] / uTextureSize[0]));
    // center on pixels
    coord = coord + 0.5;
    // convert to clip space
    coord = coord / (uTextureSize[0] / 2.0) - 1.0;

    gl_Position = vec4(coord.x, coord.y, 0.0, 1.0);
    gl_PointSize = 1.0;
}
`;

const mapFragmentShader = () => `
precision mediump float;

varying vec4 vFragColor;

void main() {
    gl_FragColor = vFragColor;
}
`;

const reduceFragmentShader = () => `
precision mediump float;

varying vec4 vFragColor;

void main() {
    gl_FragColor = vFragColor;
}
`;

export default function (maxByteLength) {
    const texture = pingPongTexture()
        .width(PING_PONG_TEXTURE_SIZE)
        .height(PING_PONG_TEXTURE_SIZE);
    const pointUniform = webglUniform();
    const mapProgramBuilder = webglProgramBuilder()
        .fragmentShader(mapFragmentShader)
        .vertexShader(mapVertexShader)
        .mode(drawModes.POINTS);
    mapProgramBuilder.buffers()
        .uniform(`uTextureSize`, webglUniform([texture.width(), texture.height()]))
        .uniform(`uTexture`, texture)
        .uniform(`uPoint`, pointUniform);
    const reduceProgramBuilder = webglProgramBuilder()
        .fragmentShader(reduceFragmentShader)
        .vertexShader(reduceVertexShader)
        .mode(drawModes.POINTS);
    reduceProgramBuilder.buffers()
        .uniform(`uTextureSize`, webglUniform([texture.width(), texture.height()]))
        .uniform(`uTexture`, texture)
        .uniform(`uPoint`, pointUniform);

    const thing = function (programBuilder, data, { x = 0, y = 0 }, indexAttribute) {
        const dataLength = data.length;

        const context = programBuilder.context();

        mapProgramBuilder.context(context);
        reduceProgramBuilder.context(context);

        mapProgramBuilder.buffers()
            .attribute(`aIndex`, indexAttribute);

        reduceProgramBuilder.buffers()
            .attribute(`aIndex`, indexAttribute);

        pointUniform.data([x, y]);
        texture.enable(true);

        copyBuffer(programBuilder, mapProgramBuilder, 'attribute', 'aMainValue');
        copyBuffer(programBuilder, mapProgramBuilder, 'attribute', 'aCrossValue');

        mapProgramBuilder(dataLength);

        let i = dataLength;
        do {
            i = Math.ceil(i / 4);
            reduceProgramBuilder(i);
        }
        while (i > 1)
        texture.enable(false);

        const count = 1;
        const pixels = new Uint8Array(count * 4);
        texture.toArray(context, pixels, count);
        const index = pixels[0] << 16 | pixels[1] << 8 | pixels[2];
        const distance = (1 - (pixels[3] / 256)) * 3;

        return {
            index,
            distance
        };
    };

    return thing;
}