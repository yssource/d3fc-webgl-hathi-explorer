import { rebind, webglAttribute, webglProgramBuilder, webglUniform } from 'd3fc';
import defaultArrayViewFactory from '@d3fc/d3fc-webgl/src/buffer/arrayViewFactory'

const vertexShader = () => `
precision mediump float;

uniform float uCount;
uniform vec2 uCanvasSize;
attribute vec2 aVertex;

void main() {
    vec4 position = vec4(aVertex.xy, 0.0, 1.0);
    if (position.y == 1.0) {
        position.y = ceil(uCount / uCanvasSize[0]) / uCanvasSize[1];
        position.y = position.y * 2.0 - 1.0;
    }
    // This is non-optimal if uCount < uCanvasSize -
    // position.x could be trimmed in a similar manner
    gl_Position = position;
}
`;

const fragmentShader = () => `
precision mediump float;

uniform sampler2D uTexture;
uniform vec2 uTextureSize;
uniform vec2 uCanvasSize;

void main() {
    float index = (gl_FragCoord.y - 0.5) * uCanvasSize[0] + (gl_FragCoord.x - 0.5) / uCanvasSize[0];
    vec2 coord = vec2(mod(index, uTextureSize[0]), floor(index / uTextureSize[0]));
    gl_FragColor = texture2D(uTexture, coord);
}
`;

export default () => {
    const programBuilder = webglProgramBuilder()
        .fragmentShader(fragmentShader)
        .vertexShader(vertexShader);
    programBuilder.buffers()
        .attribute('aVertex', webglAttribute()
            .size(2)
            .data([
                [-1, -1],
                [1, 1],
                [-1, 1],
                [-1, -1],
                [1, 1],
                [1, -1]
            ])
        );

    let texture = null;
    let size = null;
    let arrayViewFactory = defaultArrayViewFactory();

    const readTexture = count => {

        const gl = programBuilder.context();

        const array = arrayViewFactory.type(gl.UNSIGNED_BYTE)(count * 4);
        
        if (count == null || count > size[0] * size[1]) {
            throw new Error('Invalid length');
        }

        if (gl.canvas.width * gl.canvas.height < count) {
            throw new Error('Texture too large to extract in one pass');
        }

        programBuilder.buffers()
            .uniform('uTexture', texture)
            .uniform('uCanvasSize', webglUniform([gl.canvas.width, gl.canvas.height]))
            .uniform('uTextureSize', webglUniform(size))
            .uniform('uCount', webglUniform([count]));

        programBuilder(6);

        for (let offset = 0; offset < count; offset += gl.canvas.width) {
            // This is non-optimal if length >= context.canvas.width * 2 -
            // reading 2 rectangles (one large of n rows and 1 partial row) 
            // would be more efficient
            gl.readPixels(
                0,
                0,
                Math.min(count - offset, gl.canvas.width),
                1,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                array.subarray(offset)
            );
        }

        return array;
    };

    readTexture.texture = (...args) => {
        if (!args.length) {
            return texture;
        }
        texture = args[0];
        return readTexture;
    };

    readTexture.size = (...args) => {
        if (!args.length) {
            return size;
        }
        size = args[0];
        return readTexture;
    };

    readTexture.arrayViewFactory = (...args) => {
        if (!args.length) {
            return arrayViewFactory;
        }
        arrayViewFactory = args[0];
        return readTexture;
    };

    rebind(readTexture, programBuilder, 'context');

    return readTexture;
};