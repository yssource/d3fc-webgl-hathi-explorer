import { webglBufferBuilder, webglProgramBuilder, webglUniform } from 'd3fc';
import pingPongTexture from './pingPongTexture';

function copyBuffer(programBuilderSource, programBuilderDestination, type, name) {
    programBuilderDestination.buffers()
    [type](
        name,
        programBuilderSource.buffers()
        [type](name)
    );
}

// const PING_PONG_TEXTURE_SIZE = Math.pow(2, 12);
const PING_PONG_TEXTURE_SIZE = 943;// HACK

const mapVertexShader = () => `
precision mediump float;

uniform vec2 uPoint;
uniform sampler2D uTexture;
attribute float aCrossValue;
attribute float aMainValue;
attribute vec2 aIndex;
varying vec4 vFragColor;

void main() {
    float textureSize = ${PING_PONG_TEXTURE_SIZE.toFixed(1)};
    vec2 coord = vec2(mod(aIndex[0], textureSize), floor(aIndex[0] / textureSize));
    // center on pixels
    coord = coord + 0.5;
    // convert to clip space
    coord = coord / (textureSize / 2.0) - 1.0;

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

uniform sampler2D uTexture;
attribute vec2 aIndex;
varying vec4 vFragColor;

void main() {
    float textureSize = ${PING_PONG_TEXTURE_SIZE.toFixed(1)};
    float index1 = aIndex[0] * 4.0 + 0.0;
    vec2 sourceCoord1 = vec2(mod(index1, textureSize), floor(index1 / textureSize));
    sourceCoord1 = (sourceCoord1 + 0.5) / textureSize;
    
    float index2 = aIndex[0] * 4.0 + 1.0;
    vec2 sourceCoord2 = vec2(mod(index2, textureSize), floor(index2 / textureSize));
    sourceCoord2 = (sourceCoord2 + 0.5) / textureSize;
    
    float index3 = aIndex[0] * 4.0 + 2.0;
    vec2 sourceCoord3 = vec2(mod(index3, textureSize), floor(index3 / textureSize));
    sourceCoord3 = (sourceCoord3 + 0.5) / textureSize;
    
    float index4 = aIndex[0] * 4.0 + 3.0;
    vec2 sourceCoord4 = vec2(mod(index4, textureSize), floor(index4 / textureSize));
    sourceCoord4 = (sourceCoord4 + 0.5) / textureSize;

    vec4 source = texture2D(uTexture, sourceCoord1);
    vec4 temp = texture2D(uTexture, sourceCoord2);
    source = source.a > temp.a ? source : temp;
    temp = texture2D(uTexture, sourceCoord3);
    source = source.a > temp.a ? source : temp;
    temp = texture2D(uTexture, sourceCoord4);
    vFragColor = source.a > temp.a ? source : temp;


    vec2 coord = vec2(mod(aIndex[0], textureSize), floor(aIndex[0] / textureSize));
    // center on pixels
    coord = coord + 0.5;
    // convert to clip space
    coord = coord / (textureSize / 2.0) - 1.0;

    gl_Position = vec4(coord.x, coord.y, 0.0, 1.0);
    gl_PointSize = 1.0;
}
`;

const fragmentShader = () => `
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
    const mapReduceProgramBuilder = webglProgramBuilder();

    const thing = function (programBuilder, data, { x = 0, y = 0 }, indexAttribute) {
        const dataLength = data.length;

        mapReduceProgramBuilder.context(programBuilder.context())
            .pixelRatio(programBuilder.pixelRatio())
            .mode(programBuilder.context().POINTS)
            .fragmentShader(fragmentShader);

        pointUniform.data([x, y]);
        texture.enable(true);

        copyBuffer(programBuilder, mapReduceProgramBuilder, 'attribute', 'aMainValue');
        copyBuffer(programBuilder, mapReduceProgramBuilder, 'attribute', 'aCrossValue');

        mapReduceProgramBuilder.buffers()
            .uniform(`uTexture`, texture)
            .uniform(`uPoint`, pointUniform)
            .attribute(`aIndex`, indexAttribute);
        mapReduceProgramBuilder.vertexShader(mapVertexShader);
        mapReduceProgramBuilder(dataLength);

        mapReduceProgramBuilder.buffers(webglBufferBuilder())
            .buffers()
            .uniform(`uTexture`, texture)
            .attribute(`aIndex`, indexAttribute);
        mapReduceProgramBuilder.vertexShader(reduceVertexShader);

        let i = dataLength;
        do {
            i = Math.ceil(i / 4);
            mapReduceProgramBuilder(i);
        }
        while (i > 1)
        texture.enable(false);

        const pixels = new Uint8Array(1 * 4);
        texture.toArray(mapReduceProgramBuilder, pixels, 1);
        const index = pixels[0] << 16 | pixels[1] << 8 | pixels[2];
        const distance = (1 - (pixels[3] / 256)) * 3;

        return {
            index,
            distance
        };
    };

    return thing;
}